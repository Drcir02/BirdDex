// The messages between the main thread and the vision worker (worker.ts). Plain data, no DOM.

import type { InitInfo, VisionFrame, VisionInit, VisionRunOptions, VisionScores } from './core'

export type VisionRequest =
  /** "Are you up?" The model files are only sent once the worker has answered, so a worker that fails to start loses nothing. */
  | { type: 'ping'; id: number }
  | { type: 'init'; id: number; init: VisionInit }
  | { type: 'run'; id: number; frame: VisionFrame; options?: VisionRunOptions }
  | { type: 'dispose'; id: number }

export type VisionResponse =
  | { type: 'pong'; id: number }
  | { type: 'ready'; id: number; info: InitInfo }
  | { type: 'scores'; id: number; scores: VisionScores }
  | { type: 'disposed'; id: number }
  | { type: 'error'; id: number; name: string; message: string }
