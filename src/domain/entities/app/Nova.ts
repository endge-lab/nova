import { NovaApp } from '@/domain/entities/app/NovaApp'
import type { NovaAppCreateOptions } from '@/domain/types/base-types'
import type { EventList } from '@endge/utils'

export class Nova {
  static createApp<E extends EventList = Record<string, any>>(options: NovaAppCreateOptions<E>): NovaApp<E> {
    return new NovaApp(options)
  }
}
