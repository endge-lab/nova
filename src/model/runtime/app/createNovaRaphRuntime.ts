import type { RaphKernel, RaphLocalPhaseContext, RaphLocalPhaseDefinition, RaphLocalPropertyDescriptor, RaphSchedulerType } from '@endge/raph'
import type { EventList } from '@endge/utils'
import type { NovaNodeProperties } from '@/domain/types/base.types'
import type { NovaApp } from '@/model/runtime/app/NovaApp'
import {
  extractRaphLocalAfterHandlers,
  extractRaphLocalPhases,
  extractRaphLocalProperties,
  Raph,
  RaphApp,

  RaphLocalPhaseRuntime,

  RaphLocalPropertyRuntime,
  RaphPropagation,

} from '@endge/raph'
import { NovaNode } from '@/model/runtime/tree/NovaNode'

/**
 * Описывает параметры создания Raph runtime для Nova.
 */
interface CreateNovaRaphRuntimeOptions {
  kernel?: RaphKernel
  runtimeId?: string
  scheduler: RaphSchedulerType
}

/**
 * Создает Raph runtime lane с зарегистрированными Nova local phases и properties.
 */
export function createNovaRaphRuntime<E extends EventList>(
  appInstance: NovaApp<E>,
  options: CreateNovaRaphRuntimeOptions,
): RaphApp<NovaNodeProperties> {
  const nodeInstance = Object.create(NovaNode.prototype) as NovaNode<E>
  const handlers = extractRaphLocalPhases<NovaNodeProperties>(appInstance)
  const nodeHooks = extractRaphLocalAfterHandlers(nodeInstance)
  const propDescriptors = extractRaphLocalProperties<NovaNodeProperties>(nodeInstance)
  const phaseMap = new Map<string, {
    process?: (payload: RaphLocalPhaseContext<NovaNodeProperties>) => void
    always: boolean
    mode: 'dirty' | 'all'
    priority: number
  }>()

  for (const handler of handlers) {
    phaseMap.set(handler.name, {
      process: handler.process,
      always: handler.always ?? false,
      mode: handler.mode ?? 'dirty',
      priority: handler.priority ?? 0,
    })
  }

  for (const prop of propDescriptors) {
    if (!phaseMap.has(prop.phase)) {
      phaseMap.set(prop.phase, {
        process: payload => Raph.processDirtyNodes({ payload }),
        always: false,
        mode: 'dirty',
        priority: 0,
      })
    }
  }

  const runtime = new RaphApp<NovaNodeProperties>({
    kernel: options.kernel,
    id: options.runtimeId ?? 'nova',
  })
  runtime.options({
    priority: 'legacy-depth-weight-asc',
    scheduler: options.scheduler,
  })

  const phases: Record<string, RaphLocalPhaseDefinition<NovaNodeProperties>> = {}
  const orderedPhases = [...phaseMap.entries()].sort(
    (a, b) => a[1].priority - b[1].priority,
  )

  for (const [name, config] of orderedPhases) {
    const phase = new RaphLocalPhaseRuntime<NovaNodeProperties>(
      name,
      config.mode,
      config.process ?? (payload => Raph.processDirtyNodes({ payload })),
      undefined,
      undefined,
      config.always,
      config.priority,
    )
    phases[name] = phase
    runtime.addLocalPhase(phase)
  }

  for (const { phase, methodName } of nodeHooks) {
    const targetPhase = phases[phase]
    if (!targetPhase) {
      continue
    }

    targetPhase.afterProcess = (node, localPhase) => {
      const fn = (node as any)[methodName]
      if (typeof fn === 'function') {
        fn.call(node, localPhase)
      }
    }
  }

  for (const descriptor of propDescriptors) {
    runtime.addLocalProperty(createNovaLocalProperty(descriptor))
  }

  runtime.init()
  return runtime
}

/**
 * Создает runtime local property из decorator descriptor.
 */
function createNovaLocalProperty<K extends keyof NovaNodeProperties>(
  descriptor: RaphLocalPropertyDescriptor<NovaNodeProperties, K>,
): RaphLocalPropertyRuntime<NovaNodeProperties, K> {
  return new RaphLocalPropertyRuntime(
    descriptor.name,
    descriptor.phase,
    descriptor.propagation ?? RaphPropagation.None,
    descriptor.compute,
    descriptor.dependsOn ?? [],
    descriptor.defaultValue,
  )
}
