import type { DataPathDef } from '@endge/raph'
import type { NovaPhaseName } from '@/domain/constants/nova-phase'
import type { NovaNode } from '@/model/runtime/tree/NovaNode'
import {
  normalizeNovaStorePhases,
  type NovaStorePhaseInput,
} from '@/model/runtime/state/nova-store-decorators'

export type NovaStoreTrackingPhase = 'update' | 'matrix' | 'render'

export type NovaStoreReadMap = Map<NovaStoreTrackingPhase, Set<string>>

interface NovaStoreTrackingContext {
  node: NovaNode<any>
  defaultPhase: NovaStoreTrackingPhase
  reads: NovaStoreReadMap
  touchedPhases: Set<NovaStoreTrackingPhase>
}

const trackingStack: Array<NovaStoreTrackingContext> = []

/**
 * Начинает сбор reactive store reads для lifecycle phase.
 */
export function beginNovaStoreTracking(
  node: NovaNode<any>,
  defaultPhase: NovaStoreTrackingPhase,
): void {
  trackingStack.push({
    node,
    defaultPhase,
    reads: new Map(),
    touchedPhases: new Set([defaultPhase]),
  })
}

/**
 * Завершает сбор reads и синхронизирует Raph data observers ноды.
 */
export function endNovaStoreTracking(): void {
  const context = trackingStack.pop()
  if (!context) return
  compactBranchReads(context.reads)
  context.node.syncReactiveStoreReads(context.reads, context.touchedPhases)
}

/**
 * Регистрирует чтение store data path в текущем tracking context.
 */
export function trackNovaStoreRead(path: DataPathDef, phaseInput?: NovaStorePhaseInput): void {
  const context = trackingStack[trackingStack.length - 1]
  if (!context) return

  const phases = normalizeNovaStorePhases(phaseInput, context.defaultPhase as NovaPhaseName)
  for (const phase of phases) {
    context.touchedPhases.add(phase)
    let reads = context.reads.get(phase)
    if (!reads) {
      reads = new Set()
      context.reads.set(phase, reads)
    }
    reads.add(String(path))
  }
}

function compactBranchReads(readsByPhase: NovaStoreReadMap): void {
  for (const reads of readsByPhase.values()) {
    for (const path of [...reads]) {
      if (!path.endsWith('.*')) continue
      const prefix = path.slice(0, -1)
      const hasLeafRead = [...reads].some(candidate => candidate !== path && candidate.startsWith(prefix))
      if (hasLeafRead) reads.delete(path)
    }
  }
}
