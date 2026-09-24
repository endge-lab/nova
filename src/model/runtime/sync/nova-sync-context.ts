import type { NovaSyncScope } from '@/model/runtime/sync/NovaSyncScope'
import { Nova } from '@/model/runtime/app/Nova'

export const NovaSyncScopeToken = Nova.createContextToken<NovaSyncScope>('Nova.SyncScope')
