import type { NovaNodeProperties } from '@/domain/types/base.types'
import type { NovaNode } from '@/model/runtime/tree/NovaNode'

export type NovaRaphPropagation = 'none' | 'down' | 'up'

export interface NovaRaphPropertyDescriptor<K extends keyof NovaNodeProperties = keyof NovaNodeProperties> {
  name: K
  phase: string
  defaultValue?: NovaNodeProperties[K]
  propagation: NovaRaphPropagation
  dependsOn: Array<keyof NovaNodeProperties>
  compute?: (node: NovaNode<any>) => NovaNodeProperties[K]
}

export interface NovaRaphPhaseDescriptor {
  name: string
  priority: number
  always: boolean
  mode: 'dirty' | 'all'
  methodName: string
}

const properties = new WeakMap<object, Map<string, NovaRaphPropertyDescriptor>>()
const phases = new WeakMap<object, Map<string, NovaRaphPhaseDescriptor>>()
const afterHandlers = new WeakMap<object, Map<string, string>>()

export const RaphPropagation = {
  None: 'none',
  Down: 'down',
  Up: 'up',
} as const

export function RaphProperty(options: {
  phase: string
  default?: unknown
  propagation?: NovaRaphPropagation
  dependsOn?: Array<keyof NovaNodeProperties>
  compute?: (node: NovaNode<any>) => unknown
}): PropertyDecorator {
  return (target, key) => {
    const entries = properties.get(target.constructor) ?? new Map()
    entries.set(String(key), {
      name: String(key) as keyof NovaNodeProperties,
      phase: options.phase,
      defaultValue: options.default as NovaNodeProperties[keyof NovaNodeProperties],
      propagation: options.propagation ?? RaphPropagation.None,
      dependsOn: options.dependsOn ?? [],
      compute: options.compute,
    })
    properties.set(target.constructor, entries)
  }
}

export function RaphLocalPhase(options: { name: string, priority?: number, always?: boolean, mode?: 'dirty' | 'all' }): MethodDecorator {
  return (target, key) => {
    const entries = phases.get(target.constructor) ?? new Map()
    entries.set(String(key), {
      name: options.name,
      priority: options.priority ?? 0,
      always: options.always ?? false,
      mode: options.mode ?? 'dirty',
      methodName: String(key),
    })
    phases.set(target.constructor, entries)
  }
}

export function RaphAfter(options: { phase: string }): MethodDecorator {
  return (target, key) => {
    const entries = afterHandlers.get(target.constructor) ?? new Map()
    entries.set(options.phase, String(key))
    afterHandlers.set(target.constructor, entries)
  }
}

export function readNovaRaphProperties(instance: object): NovaRaphPropertyDescriptor[] {
  return [...(properties.get(instance.constructor) ?? new Map()).values()]
}

export function readNovaRaphPhases(instance: object): NovaRaphPhaseDescriptor[] {
  return [...(phases.get(instance.constructor) ?? new Map()).values()]
}

export function readNovaRaphAfterHandlers(instance: object): ReadonlyMap<string, string> {
  return afterHandlers.get(instance.constructor) ?? new Map()
}
