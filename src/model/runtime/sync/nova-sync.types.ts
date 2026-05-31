import type { NovaNode } from '@/model/runtime/tree/NovaNode'

export type NovaSyncSchedule = 'immediate' | 'microtask' | 'frame'
export type NovaSyncPortMap = Record<string, NovaSyncPort<any>>
export type NovaSyncEndpointInput = string | NovaSyncPort<any>

export interface NovaSyncTransaction {
  id: number
  origin: string
  path: Set<string>
}

export interface NovaSyncPort<T = unknown> {
  id?: string
  owner?: NovaNode<any>
  type?: string
  writable?: boolean
  schedule?: NovaSyncSchedule
  meta?: Record<string, unknown>
  read: () => T
  write: (value: T, transaction: NovaSyncTransaction) => void
  equals?: (left: T, right: T) => boolean
}

export interface NovaSyncLinkConfig<TFrom = unknown, TTo = TFrom> {
  id?: string
  from: NovaSyncEndpointInput
  to: NovaSyncEndpointInput
  schedule?: NovaSyncSchedule
  bidirectional?: boolean
  transform?: (value: TFrom, transaction: NovaSyncTransaction) => TTo
  filter?: (value: TFrom, transaction: NovaSyncTransaction) => boolean
  equals?: (left: TTo, right: TTo) => boolean
}

export interface NovaSyncLink {
  id: string
  from: string
  to: string
  schedule: NovaSyncSchedule
  bidirectional: boolean
  dispose: () => void
}

export interface NovaSyncRegisteredPort {
  endpoint: string
  name: string
  node: NovaNode<any>
  port: NovaSyncPort<any>
}

export interface NovaSyncScopeOptions {
  id?: string
  scheduler?: NovaSyncSchedule
}
