// BirdNET in a Web Worker. The page sends the model file once ('load') and then windows of audio ('run'); the worker
// answers with the scores. This keeps the 100 to 300 ms that a window takes (and 350 MB of working memory) away from the
// page: the level meter and the buttons stay smooth, and shutting the worker down gives the memory back.
//
// It is built as a classic worker (Vite's default for workers), because LiteRT.js loads its WebAssembly glue with
// importScripts(), which module workers do not have. Created by scorer.ts.

import { BirdnetModel } from './birdnet'
import { wasmMemoryBytes } from '../runtime/litert'
import { computeGeoScores } from './geo'
import type { WorkerRequest, WorkerResponse } from './scorerProtocol'

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void
  close(): void
}
const scope = self as unknown as WorkerScope

let model: BirdnetModel | undefined
// Requests are handled one after the other, in the order they arrive.
let queue: Promise<void> = Promise.resolve()

async function handle(request: WorkerRequest): Promise<void> {
  try {
    switch (request.type) {
      case 'load':
        model?.delete()
        model = await BirdnetModel.load(new Uint8Array(request.bytes))
        scope.postMessage({ type: 'loaded' })
        break
      case 'run': {
        if (!model) throw new Error('BirdNET is not loaded in the worker')
        const scores = await model.scores(request.window)
        scope.postMessage({ type: 'scores', id: request.id, scores }, [scores.buffer])
        break
      }
      case 'geo': {
        // The location model is loaded, run and freed next to BirdNET, so the page never has to start LiteRT.js for it.
        const scores = await computeGeoScores(new Uint8Array(request.bytes), request.lat, request.lon, request.week)
        scope.postMessage({ type: 'scores', id: request.id, scores }, [scores.buffer])
        break
      }
      case 'memory':
        scope.postMessage({ type: 'memory', id: request.id, wasmBytes: await wasmMemoryBytes() })
        break
      case 'dispose':
        model?.delete()
        model = undefined
        scope.close()
        break
    }
  } catch (error) {
    scope.postMessage({ type: 'failed', id: request.type === 'run' || request.type === 'geo' || request.type === 'memory' ? request.id : undefined, message: error instanceof Error ? `${error.name}: ${error.message}` : String(error) })
  }
}

scope.onmessage = (event) => {
  queue = queue.then(() => handle(event.data))
}
