import type { EventList, OneOrMany } from '@endge/utils'
import { NovaApp } from '@/model/runtime/app/NovaApp'
import type { NovaAppCreateOptions } from '@/domain/types/base.types'
import type { NovaElementConstructor } from '@/domain/types/component.types'
import type { NovaSchemaRegistry } from '@/model/runtime/components/NovaSchemaRegistry'
import type { NovaSurface } from '@/model/runtime/tree/NovaSurface'
import {
  defineNovaComponent,
  registerDefinedComponents,
  type NovaDefinedComponentInput,
  type NovaDefinedComponentOptions,
} from '@/model/runtime/components/NovaDefinedComponent'
import {
  createNovaRef,
  createNovaRefMap,
  createNovaScope,
  type NovaRef,
  type NovaRefMap,
  type NovaScope,
} from '@/model/runtime/refs/NovaRef'
import type { NovaCompiledNodeConstructor } from '@/model/runtime/template/NovaTemplateRuntime'

export type NovaSchemaPlugin = (registry: NovaSchemaRegistry) => void

export interface NovaMountOptions<E extends EventList = Record<string, any>> {
  app: NovaApp<E>
  surface: NovaSurface<E>
  scope?: NovaScope
  props?: Record<string, unknown>
  listeners?: Record<string, (...args: Array<any>) => void>
  slots?: Record<string, (...args: Array<any>) => Array<any>>
}

export interface NovaMountHandle {
  node: {
    setProps?: (patch: Record<string, unknown>) => unknown
    setListeners?: (listeners: Record<string, (...args: Array<any>) => void>) => unknown
    remove: () => void
  }
  updateProps(patch: Record<string, unknown>): void
  updateListeners(listeners: Record<string, (...args: Array<any>) => void>): void
  destroy(): void
}

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
   * Создает proxy-ref на публичный API Nova component.
   */
  static ref<T extends object>(name?: string): NovaRef<T> {
    return createNovaRef<T>(name)
  }

  /**
   * Создает коллекцию refs для keyed template nodes.
   */
  static refMap<T extends object>(): NovaRefMap<T> {
    return createNovaRefMap<T>()
  }

  /**
   * Создает scope refs для template runtime.
   */
  static createScope(input: Partial<NovaScope> = {}): NovaScope {
    return createNovaScope(input)
  }

  /**
   * Монтирует compiled Nova template в существующий app/surface.
   */
  static mount<E extends EventList = Record<string, any>>(
    component: NovaCompiledNodeConstructor<E>,
    options: NovaMountOptions<E>,
  ): NovaMountHandle {
    const props = {
      ...(options.props ?? {}),
      novaRefs: options.scope?.refs ?? {},
    }
    const node = options.surface.createNode(
      component,
      props,
      options.listeners ?? {},
      options.slots ?? {},
    ) as NovaMountHandle['node']

    return {
      node,
      updateProps(patch: Record<string, unknown>): void {
        node.setProps?.({
          ...patch,
          novaRefs: options.scope?.refs ?? {},
        })
      },
      updateListeners(listeners: Record<string, (...args: Array<any>) => void>): void {
        node.setListeners?.(listeners)
      },
      destroy(): void {
        node.remove()
      },
    }
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
