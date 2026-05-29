import { Nova } from '@/model/runtime/app/Nova'
import type { NovaSyncScope } from '@/model/runtime/sync/NovaSyncScope'

export const NovaSyncScopeToken = Nova.createContextToken<NovaSyncScope>('Nova.SyncScope')
