// The Web Worker that runs WingCLIP (see core.ts for why it is a worker). Started by backend.ts:
//   new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
// It keeps one VisionCore, answers requests in the order they come, and never touches the DOM.

import { VisionCore } from './core'
import type { VisionRequest, VisionResponse } from './protocol'

interface WorkerScope {
  onmessage: ((event: MessageEvent<VisionRequest>) => void) | null
  postMessage(message: VisionResponse, options?: { transfer?: Transferable[] }): void
}

const scope = self as unknown as WorkerScope

let core: VisionCore | undefined
let queue: Promise<void> = Promise.resolve()

function reply(message: VisionResponse): void {
  scope.postMessage(message)
}

async function handle(request: VisionRequest): Promise<void> {
  try {
    switch (request.type) {
      case 'ping':
        reply({ type: 'pong', id: request.id })
        break
      case 'init': {
        await core?.dispose()
        core = undefined
        core = await VisionCore.create(request.init)
        reply({ type: 'ready', id: request.id, info: core.info })
        break
      }
      case 'run': {
        if (!core) throw new Error('The vision worker has no model yet')
        reply({ type: 'scores', id: request.id, scores: await core.run(request.frame, request.options) })
        break
      }
      case 'dispose':
        await core?.dispose()
        core = undefined
        reply({ type: 'disposed', id: request.id })
        break
    }
  } catch (error) {
    const known = error instanceof Error ? error : new Error(String(error))
    reply({ type: 'error', id: request.id, name: known.name, message: known.message })
  }
}

// The queue keeps requests in order even though handling one of them waits for the model.
scope.onmessage = (event) => {
  queue = queue.then(() => handle(event.data))
}
