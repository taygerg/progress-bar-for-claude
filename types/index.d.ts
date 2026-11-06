export type Progress = {
  isActive: boolean
  now: number
  total: number
  done: number
  current: string
  firstStartAt: number
  lastDoneAt: number
  doneInTurn: number
  workMs: number
  /** Share shown before the last change, so the bar can glide from it. */
  prevShown?: number
}

declare module 'claude-code' {
  interface PluginState {
    'glass-progress': { progress: Progress; backdropOff: boolean }
  }
}
