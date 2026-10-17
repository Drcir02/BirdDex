// BirdNET's location model (birdnet-v2.4-geo-fp16.tflite) was saved with a "dynamic batch size": every tensor carries
// the shape signature [-1, ...] next to its real shape [1, ...]. The TensorFlow Lite interpreter in Python does not
// mind. LiteRT.js compares the tensors we give it with the signature and refuses [1, 3] against [-1, 3].
//
// The fix is to say in the file that the batch size is 1, which is the only size we ever use: the numbers in
// `shape_signature` that are -1 become the number in `shape` at the same place. Nothing else in the file changes (no
// weights, no operators), so the results are the same as in Python (checked in tests/e2e/sound-engine.spec.ts).
//
// A .tflite file is a FlatBuffer. To find the tensors we walk Model -> subgraphs -> tensors -> shape_signature with the
// few lines of FlatBuffer reading below. The field numbers come from TensorFlow Lite's schema.fbs:
//   Model:    subgraphs is field 2
//   SubGraph: tensors is field 0
//   Tensor:   shape is field 0, shape_signature is field 7

const MODEL_SUBGRAPHS = 2
const SUBGRAPH_TENSORS = 0
const TENSOR_SHAPE = 0
const TENSOR_SHAPE_SIGNATURE = 7

class FlatReader {
  readonly bytes: Uint8Array
  private readonly view: DataView

  constructor(bytes: Uint8Array) {
    this.bytes = bytes
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  u16(position: number): number {
    return this.view.getUint16(position, true)
  }
  u32(position: number): number {
    return this.view.getUint32(position, true)
  }
  i32(position: number): number {
    return this.view.getInt32(position, true)
  }

  /** Position of a field of the table that starts at `table`, or undefined when the file leaves that field out. */
  field(table: number, id: number): number | undefined {
    const vtable = table - this.i32(table)
    const slot = 4 + 2 * id
    if (slot >= this.u16(vtable)) return undefined
    const offset = this.u16(vtable + slot)
    return offset === 0 ? undefined : table + offset
  }

  /** Where the vector stored in a field starts (its first element) and how long it is. */
  vector(table: number, id: number): { first: number; length: number } | undefined {
    const at = this.field(table, id)
    if (at === undefined) return undefined
    const start = at + this.u32(at)
    return { first: start + 4, length: this.u32(start) }
  }

  /** The table that element `index` of a vector of tables points to. */
  tableAt(first: number, index: number): number {
    const at = first + 4 * index
    return at + this.u32(at)
  }
}

/** Tensors whose shape signature has a -1, as the positions of the numbers to change and their replacement. */
function findDynamicDimensions(reader: FlatReader): Array<{ position: number; value: number }> {
  const changes: Array<{ position: number; value: number }> = []
  const root = reader.u32(0)
  const subgraphs = reader.vector(root, MODEL_SUBGRAPHS)
  if (!subgraphs) return changes
  // A damaged file can claim absurd sizes; real models have a handful of subgraphs and tensors of at most a few dimensions.
  if (subgraphs.length > 64) throw new RangeError('Too many subgraphs')
  for (let s = 0; s < subgraphs.length; s++) {
    const subgraph = reader.tableAt(subgraphs.first, s)
    const tensors = reader.vector(subgraph, SUBGRAPH_TENSORS)
    if (!tensors) continue
    if (tensors.length > reader.bytes.length / 4) throw new RangeError('Too many tensors')
    for (let t = 0; t < tensors.length; t++) {
      const tensor = reader.tableAt(tensors.first, t)
      const shape = reader.vector(tensor, TENSOR_SHAPE)
      const signature = reader.vector(tensor, TENSOR_SHAPE_SIGNATURE)
      if (!shape || !signature || signature.length !== shape.length || signature.length > 16) continue
      for (let d = 0; d < signature.length; d++) {
        if (reader.i32(signature.first + 4 * d) === -1) changes.push({ position: signature.first + 4 * d, value: reader.i32(shape.first + 4 * d) })
      }
    }
  }
  return changes
}

export interface StaticShapes {
  bytes: Uint8Array
  /** Number of dimensions that were changed from -1. Zero means the file was already static and is returned as it is. */
  patched: number
}

/**
 * Returns the model with every dynamic dimension (-1 in a shape signature) set to the size in its shape. The input is
 * not changed; a patched copy is returned only when there is something to patch. If the file cannot be read as a
 * TensorFlow Lite file, it is returned untouched and the compiler gives the real error.
 */
export function makeShapesStatic(bytes: Uint8Array): StaticShapes {
  let changes: Array<{ position: number; value: number }>
  try {
    changes = findDynamicDimensions(new FlatReader(bytes))
  } catch {
    return { bytes, patched: 0 }
  }
  if (changes.length === 0) return { bytes, patched: 0 }
  const copy = bytes.slice()
  const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength)
  for (const { position, value } of changes) view.setInt32(position, value, true)
  return { bytes: copy, patched: changes.length }
}
