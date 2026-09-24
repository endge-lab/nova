import type { EventList } from '@endge/utils'
import type { RaphKernel } from '@raphy-js/raph/path'
import type { RaphSchedulerMode } from '@raphy-js/raph/runtime'
import type { NovaNodeProperties } from '@/domain/types/base.types'
import type { NovaApp } from '@/model/runtime/app/NovaApp'
import type { NovaRaphPhase, NovaRaphPhaseContext } from '@/model/runtime/app/NovaRaphRuntime'
import {
  readNovaRaphAfterHandlers,
  readNovaRaphPhases,
  readNovaRaphProperties,
} from '@/model/runtime/app/nova-raph-metadata'
import { NovaRaphRuntime, processDirtyNodes } from '@/model/runtime/app/NovaRaphRuntime'
import { NovaNode } from '@/model/runtime/tree/NovaNode'

interface CreateNovaRaphRuntimeOptions {
  kernel?: RaphKernel
  runtimeId?: string
  scheduler: RaphSchedulerMode
}

// Builds one Next runtime with Nova's scene-owned local phase lanes.
export function createNovaRaphRuntime<E extends EventList>(
  app: NovaApp<E>,
  options: CreateNovaRaphRuntimeOptions,
): NovaRaphRuntime<NovaNodeProperties> {
  const nodePrototype = Object.create(NovaNode.prototype) as NovaNode<E>
  const descriptors = readNovaRaphProperties(nodePrototype)
  const hooks = readNovaRaphAfterHandlers(nodePrototype)
  const phaseMap = new Map<string, NovaRaphPhase<NovaNodeProperties>>()

  for (const handler of readNovaRaphPhases(app)) {
    phaseMap.set(handler.name, {
      name: handler.name,
      mode: handler.mode,
      priority: handler.priority,
      always: handler.always,
      properties: [],
      process: payload => (app as unknown as Record<string, (value: NovaRaphPhaseContext) => void>)[handler.methodName](payload),
    })
  }
  for (const descriptor of descriptors) {
    if (phaseMap.has(descriptor.phase)) { continue }
    phaseMap.set(descriptor.phase, {
      name: descriptor.phase,
      mode: 'dirty',
      priority: 0,
      always: false,
      properties: [],
      process: payload => processDirtyNodes({ payload }),
    })
  }
  for (const [name, method] of hooks) {
    const phase = phaseMap.get(name)
    if (phase) { phase.afterProcess = node => (node as unknown as Record<string, () => void>)[method]?.() }
  }

  const runtime = new NovaRaphRuntime<NovaNodeProperties>({
    id: options.runtimeId ?? 'nova',
    kernel: options.kernel,
    scheduler: options.scheduler,
  })
  runtime.init([...phaseMap.values()], descriptors)
  return runtime
}
