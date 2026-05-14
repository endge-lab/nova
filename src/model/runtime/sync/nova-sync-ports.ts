import type { EventList } from '@endge/utils'
import type { NovaComponentNode } from '@/model/runtime/components/NovaComponentNode'
import type { NovaSyncPort, NovaSyncPortMap } from '@/model/runtime/sync/nova-sync.types'

export function createNovaSyncPort<T>(input: Omit<NovaSyncPort<T>, 'id' | 'owner'>): NovaSyncPort<T> {
  return input
}

export function createNovaComponentPropSyncPorts<
  TProps extends Record<string, any>,
  E extends EventList,
>(
  node: NovaComponentNode<TProps, unknown, Record<string, unknown>, TProps, E>,
): NovaSyncPortMap {
  const fields = node.descriptor.fields
  if (!fields || typeof fields !== 'object') return {}

  const ports: NovaSyncPortMap = {}
  for (const name of Object.keys(fields)) {
    ports[name] = createNovaSyncPort({
      read: () => node.getProps()[name],
      write: value => node.setProps({ [name]: value } as Partial<TProps>),
    })
  }
  return ports
}
