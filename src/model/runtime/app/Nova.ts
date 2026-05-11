import type { EventList, OneOrMany } from '@endge/utils'
import { NovaApp } from '@/model/runtime/app/NovaApp'
import type { NovaAppCreateOptions } from '@/domain/types/base.types'
import type { NovaElementConstructor } from '@/domain/types/component.types'
import type { NovaSchemaRegistry } from '@/model/runtime/components/NovaSchemaRegistry'
import {
  defineNovaComponent,
  registerDefinedComponents,
  type NovaDefinedComponentInput,
  type NovaDefinedComponentOptions,
} from '@/model/runtime/components/NovaDefinedComponent'

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
   * Привязывает component metadata к class-конструктору без глобальной регистрации.
   */
  static defineComponent<E extends EventList = Record<string, any>, T extends NovaElementConstructor<E> = NovaElementConstructor<E>>(
    component: T,
    options: NovaDefinedComponentOptions<E> = {},
  ): T {
    return defineNovaComponent(component, options)
  }

  /**
   * Регистрирует один или несколько class-компонентов в конкретном schema registry.
   */
  static registerComponents<E extends EventList = Record<string, any>>(
    registry: NovaSchemaRegistry,
    definitions: OneOrMany<NovaElementConstructor<E> | NovaDefinedComponentInput<E>>,
  ): void {
    registerDefinedComponents(registry, definitions)
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
