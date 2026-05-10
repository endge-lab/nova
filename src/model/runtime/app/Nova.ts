import type { EventList } from '@endge/utils'
import { NovaApp } from '@/model/runtime/app/NovaApp'
import type { NovaAppCreateOptions } from '@/domain/types/base.types'
import type { NovaSchemaRegistry } from '@/model/runtime/components/NovaSchemaRegistry'

export type NovaSchemaPlugin = (registry: NovaSchemaRegistry) => void

/**
 * Предоставляет статические фабрики для создания Nova runtime и связанных объектов.
 */
export class Nova {
  //
  // Глобальные schema-плагины, которые применяются к каждому новому NovaApp.
  private static readonly _schemaPlugins = new Set<NovaSchemaPlugin>()
  private static _uiKitPlugin: NovaSchemaPlugin | null = null

  /**
   * Создает app.
   */
  static createApp<E extends EventList = Record<string, any>>(options: NovaAppCreateOptions<E>): NovaApp<E> {
    const app = new NovaApp(options)
    this.applySchemaPlugins(app.schema)
    return app
  }

  /**
   * Подключает schema-плагин ко всем новым NovaApp.
   */
  static use(plugin: NovaSchemaPlugin): void {
    this._schemaPlugins.add(plugin)
  }

  /**
   * Подключает Nova UI Kit ко всем новым NovaApp.
   */
  static useUIKit(plugin?: NovaSchemaPlugin): void {
    if (plugin) this._uiKitPlugin = plugin
    if (!this._uiKitPlugin) {
      throw new Error('[Nova] UI Kit plugin is not configured. Pass registerNovaUIKit to Nova.useUIKit().')
    }

    this.use(this._uiKitPlugin)
  }

  /**
   * Применяет глобальные schema-плагины к registry конкретного app.
   */
  private static applySchemaPlugins(registry: NovaSchemaRegistry): void {
    for (const plugin of this._schemaPlugins) {
      plugin(registry)
    }
  }
}
