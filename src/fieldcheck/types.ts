export type Status = 'idle' | 'running' | 'pass' | 'warn' | 'fail'

export interface CheckState {
  status: Status
  lines: string[]
}

export type CheckId = 'environment' | 'microphone' | 'camera' | 'location' | 'storage' | 'offline' | 'models'

export const CHECK_ORDER: CheckId[] = ['environment', 'microphone', 'camera', 'location', 'storage', 'offline', 'models']

export const CHECK_TITLES: Record<CheckId, string> = {
  environment: 'Device and browser',
  microphone: 'Microphone',
  camera: 'Camera',
  location: 'Location',
  storage: 'Storage',
  offline: 'Offline',
  models: 'Model speed',
}

export const idleState = (): CheckState => ({ status: 'idle', lines: [] })
