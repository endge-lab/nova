import { NovaApp } from '@/model/app/NovaApp'
import type { NovaAppCreateOptions } from '@/domain/types/base-types'
import type { EventList } from '@endge/utils'

/**
 * Предоставляет статические фабрики для создания Nova runtime и связанных объектов.
 */
export class Nova {
  /**
   * Создает app.
   */
  static createApp<E extends EventList = Record<string, any>>(options: NovaAppCreateOptions<E>): NovaApp<E> {
    return new NovaApp(options)
  }
}
