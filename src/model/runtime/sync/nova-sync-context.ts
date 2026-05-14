import { createNovaContextToken } from '@/model/runtime/context/nova-context'
import type { NovaSyncScope } from '@/model/runtime/sync/NovaSyncScope'

export const NovaSyncScopeToken = createNovaContextToken<NovaSyncScope>('Nova.SyncScope')
