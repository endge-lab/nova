/**
 * Описывает стандартные фазы Nova runtime pipeline.
 */
export const NovaPhase = {
  Before: 'before',
  PreUpdate: 'preupdate',
  Update: 'update',
  Matrix: 'matrix',
  Render: 'render',
  Flush: 'flush',
  After: 'after',
} as const

/**
 * Описывает имя стандартной фазы Nova runtime pipeline.
 */
export type NovaPhaseName = typeof NovaPhase[keyof typeof NovaPhase]
