// BirdNET V2.4 on LiteRT.js: 3 seconds of 48 kHz audio in, a score for each of the 6522 outputs out.
//
// The model takes the raw samples (floats between about -1 and 1) and computes its own spectrogram, so no
// preprocessing is needed. The numbers it returns are logits; sigmoid() in scores.ts turns them into scores.

import { WINDOW_SAMPLES } from '../audio/windowing'
import { compileFloatModel, ModelLoadError, wasmMemoryBytes, type FloatModel } from '../runtime/litert'
import { BIRDNET_OUTPUTS, scoresFromLogits } from './scores'
import type { WindowScorer } from './scorerProtocol'

/** BirdNET compiled in this thread (the page, or the worker's own thread). */
export class BirdnetModel implements WindowScorer {
  readonly mode = 'main'
  private readonly model: FloatModel

  private constructor(model: FloatModel) {
    this.model = model
  }

  /** Compiles the model from its file (the bytes from the model store). */
  static async load(bytes: Uint8Array): Promise<BirdnetModel> {
    const model = await compileFloatModel(bytes)
    const [batch, samples] = model.inputShape
    if (model.inputShape.length !== 2 || batch !== 1 || samples !== WINDOW_SAMPLES || model.outputLength !== BIRDNET_OUTPUTS) {
      model.delete()
      throw new ModelLoadError(`This is not BirdNET V2.4: input [${model.inputShape.join(', ')}], ${model.outputLength} outputs`)
    }
    return new BirdnetModel(model)
  }

  /** Scores (0 to 1) for one 3 second window of 48 kHz mono audio. */
  async scores(window: Float32Array): Promise<Float32Array> {
    if (window.length !== WINDOW_SAMPLES) throw new RangeError(`BirdNET needs ${WINDOW_SAMPLES} samples, got ${window.length}`)
    const logits = await this.model.run(window)
    return scoresFromLogits(logits, logits) // in place: the array is ours
  }

  delete(): void {
    this.model.delete()
  }

  wasmMemory(): Promise<number> {
    return wasmMemoryBytes()
  }

  get deleted(): boolean {
    return this.model.deleted
  }
}
