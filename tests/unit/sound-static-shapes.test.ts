import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { makeShapesStatic } from '../../src/ml/sound/staticShapes'

// A tiny FlatBuffer writer, just enough to make a TensorFlow Lite-shaped file: Model { subgraphs } -> SubGraph { tensors }
// -> Tensor { shape, shape_signature }. Objects are laid out front to back, so all offsets point forward.

class FlatWriter {
  readonly view = new DataView(new ArrayBuffer(8192))
  length = 0

  private align4(): void {
    while (this.length % 4 !== 0) this.view.setUint8(this.length++, 0)
  }

  /** Writes a table with the given field ids; returns where it starts and where each field's 4-byte slot is. */
  table(ids: number[]): { start: number; slots: Map<number, number> } {
    const count = Math.max(...ids) + 1
    const vtableSize = 4 + 2 * count
    this.align4()
    const vtable = this.length
    this.view.setUint16(vtable, vtableSize, true)
    this.view.setUint16(vtable + 2, 4 + 4 * ids.length, true)
    ids.forEach((id, i) => this.view.setUint16(vtable + 4 + 2 * id, 4 + 4 * i, true))
    this.length = vtable + vtableSize
    this.align4()
    const start = this.length
    this.view.setInt32(start, start - vtable, true) // the vtable is before the table
    const slots = new Map<number, number>()
    ids.forEach((id, i) => slots.set(id, start + 4 + 4 * i))
    this.length = start + 4 + 4 * ids.length
    return { start, slots }
  }

  /** Points the 4-byte slot at a position further on in the file. */
  point(slot: number, target: number): void {
    this.view.setUint32(slot, target - slot, true)
  }

  int32Vector(values: number[]): { start: number; first: number } {
    this.align4()
    const start = this.length
    this.view.setUint32(start, values.length, true)
    values.forEach((value, i) => this.view.setInt32(start + 4 + 4 * i, value, true))
    this.length = start + 4 + 4 * values.length
    return { start, first: start + 4 }
  }

  tableVector(count: number): { start: number; slots: number[] } {
    this.align4()
    const start = this.length
    this.view.setUint32(start, count, true)
    this.length = start + 4 + 4 * count
    return { start, slots: Array.from({ length: count }, (_, i) => start + 4 + 4 * i) }
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.view.buffer.slice(0, this.length))
  }
}

interface TensorSpec {
  shape: number[]
  signature?: number[]
}

/** Returns the file and, for each tensor with a signature, where the first number of its signature is stored. */
function buildModel(tensors: TensorSpec[]): { bytes: Uint8Array; signatureAt: number[] } {
  const w = new FlatWriter()
  w.length = 4 // the root offset comes first
  const model = w.table([2])
  w.view.setUint32(0, model.start, true)
  const subgraphVector = w.tableVector(1)
  w.point(model.slots.get(2)!, subgraphVector.start)
  const subgraph = w.table([0])
  w.point(subgraphVector.slots[0], subgraph.start)
  const tensorVector = w.tableVector(tensors.length)
  w.point(subgraph.slots.get(0)!, tensorVector.start)
  const signatureAt: number[] = []
  tensors.forEach((spec, i) => {
    const ids = spec.signature ? [0, 7] : [0]
    const tensor = w.table(ids)
    w.point(tensorVector.slots[i], tensor.start)
    w.point(tensor.slots.get(0)!, w.int32Vector(spec.shape).start)
    if (spec.signature) {
      const signature = w.int32Vector(spec.signature)
      w.point(tensor.slots.get(7)!, signature.start)
      signatureAt.push(signature.first)
    }
  })
  return { bytes: w.bytes(), signatureAt }
}

const readInt32 = (bytes: Uint8Array, at: number) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt32(at, true)

describe('makeShapesStatic', () => {
  const tensors: TensorSpec[] = [
    { shape: [1, 3], signature: [-1, 3] }, // the model input
    { shape: [1, 48], signature: [-1, 48] },
    { shape: [5] }, // no signature at all
    { shape: [1, 2], signature: [1, 2] }, // already static
    { shape: [1, 1, 7], signature: [-1, -1, 7] }, // two dynamic dimensions
  ]

  it('sets every -1 in a shape signature to the size in the shape, and nothing else', () => {
    const { bytes, signatureAt } = buildModel(tensors)
    const before = bytes.slice()
    const result = makeShapesStatic(bytes)
    expect(result.patched).toBe(4)
    expect(readInt32(result.bytes, signatureAt[0])).toBe(1)
    expect(readInt32(result.bytes, signatureAt[0] + 4)).toBe(3)
    expect(readInt32(result.bytes, signatureAt[1])).toBe(1)
    expect(readInt32(result.bytes, signatureAt[1] + 4)).toBe(48)
    expect(readInt32(result.bytes, signatureAt[2])).toBe(1) // [1, 2] was fine
    expect(readInt32(result.bytes, signatureAt[3])).toBe(1)
    expect(readInt32(result.bytes, signatureAt[3] + 4)).toBe(1)
    expect(readInt32(result.bytes, signatureAt[3] + 8)).toBe(7)
    // Only the four numbers changed.
    let differing = 0
    result.bytes.forEach((byte, i) => {
      if (byte !== before[i]) differing++
    })
    expect(differing).toBeGreaterThan(0)
    expect(differing).toBeLessThanOrEqual(4 * 4)
    // The file that was passed in is untouched.
    expect(Array.from(bytes)).toEqual(Array.from(before))
    expect(readInt32(bytes, signatureAt[0])).toBe(-1)
  })

  it('has nothing to do the second time, and returns the very same bytes', () => {
    const once = makeShapesStatic(buildModel(tensors).bytes)
    const twice = makeShapesStatic(once.bytes)
    expect(twice.patched).toBe(0)
    expect(twice.bytes).toBe(once.bytes)
  })

  it('returns a file that is already static as it is, without making a copy', () => {
    const { bytes } = buildModel([{ shape: [1, 3], signature: [1, 3] }, { shape: [2] }])
    const result = makeShapesStatic(bytes)
    expect(result.patched).toBe(0)
    expect(result.bytes).toBe(bytes)
  })

  it('does not choke on files that are not TensorFlow Lite files', () => {
    for (const garbage of [new Uint8Array(0), new Uint8Array(3), new Uint8Array(64), Uint8Array.from({ length: 500 }, (_, i) => (i * 37 + 11) % 256), new TextEncoder().encode('not a model at all, just text')]) {
      const result = makeShapesStatic(garbage)
      expect(result.bytes).toBe(garbage)
      expect(result.patched).toBe(0)
    }
  })

  it('stops at a damaged file that claims absurd sizes', () => {
    const { bytes } = buildModel(tensors)
    const damaged = bytes.slice()
    // The first vector of tables is the subgraph list: make it claim a million subgraphs.
    const view = new DataView(damaged.buffer)
    for (let at = 4; at < damaged.length - 4; at += 4) if (view.getUint32(at, true) === 1 && at > 8) { view.setUint32(at, 1_000_000, true); break }
    expect(() => makeShapesStatic(damaged)).not.toThrow()
  })

  const geoFile = 'public/models/birdnet-v2.4-geo-fp16.tflite'

  it.skipIf(!existsSync(geoFile))('fixes the real location model: 38 tensors say "any batch size", afterwards none does', () => {
    const original = new Uint8Array(readFileSync(geoFile))
    const result = makeShapesStatic(original)
    // The 38 tensors come from the Python inspection in docs/notes/sound-engine.md (one dynamic batch dimension each).
    expect(result.patched).toBe(38)
    expect(result.bytes.length).toBe(original.length)
    expect(makeShapesStatic(result.bytes).patched).toBe(0)
    let differing = 0
    for (let i = 0; i < original.length; i++) if (original[i] !== result.bytes[i]) differing++
    expect(differing).toBe(38 * 4) // -1 (ff ff ff ff) became 1 (01 00 00 00)
  })
})
