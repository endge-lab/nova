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
} from '@/model/runtime/components/nova-defined-component'
import {
  createNovaRef,
  createNovaRefMap,
  createNovaScope,
  type NovaRef,
  type NovaRefMap,
  type NovaScope,
} from '@/model/runtime/refs/nova-ref'
import {
  createNovaComputed,
  createNovaSignal,
  trackNovaNode,
  type NovaComputed,
  type NovaSignal,
  type NovaTrackNodeOptions,
} from '@/model/runtime/reactivity/nova-reactivity'
import type { NovaNode } from '@/model/runtime/tree/NovaNode'
import type { NovaCompiledNodeConstructor } from '@/model/runtime/template/NovaTemplateRuntime'
import { NovaAssets } from '@/model/runtime/assets/NovaAssetRegistry'
import {
  NovaGlobalThemes,
  type NovaGlobalThemeAsset,
  type NovaThemeSelectorTarget,
} from '@/model/theme/NovaGlobalThemeRegistry'
import type { NovaThemeId, NovaThemeTokens } from '@/domain/types/theme.types'
import { Prop } from '@/model/runtime/components/nova-component.decorator'
import type { NovaContextToken } from '@/domain/types/context.types'
import { createNovaContextToken } from '@/model/runtime/context/nova-context'
import {
  batchNovaStore,
  createNovaStore,
  type NovaCreateStoreOptions,
} from '@/model/runtime/state/nova-store-runtime'

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
  /**
   * Глобальный facade для typed assets.
   */
  static readonly assets = NovaAssets

  /**
   * Глобальный facade для prop descriptors в Nova DSL.
   */
  static readonly Prop = Prop

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
    app.setGlobalThemeDispose(NovaGlobalThemes.attach(app, {
      inheritActive: options.globalTheme?.inherit ?? !options.theme,
    }))
    return app
  }

  /**
   * Регистрирует NovaCSS asset глобально для новых и уже созданных NovaApp.
   */
  static import(asset: NovaGlobalThemeAsset): void {
    NovaGlobalThemes.import(asset)
  }

  /**
   * Возвращает или меняет активную глобальную тему Nova.
   */
  static theme(): NovaThemeId | null
  static theme(id: NovaThemeId): NovaThemeId
  static theme(id?: NovaThemeId): NovaThemeId | null {
    return id === undefined ? NovaGlobalThemes.theme() : NovaGlobalThemes.theme(id)
  }

  /**
   * Подписывается на глобальные изменения импортированных themes.
   */
  static onThemeChange(listener: () => void): () => void {
    return NovaGlobalThemes.subscribe(listener)
  }

  /**
   * Резолвит глобальные theme tokens для selector target.
   */
  static resolveThemeTokens(target: NovaThemeSelectorTarget): NovaThemeTokens {
    return NovaGlobalThemes.resolveTokens(target)
  }

  /**
   * Сбрасывает global theme registry в unit-тестах.
   */
  static __resetGlobalThemesForTests(): void {
    NovaGlobalThemes.resetForTests()
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
   * Создает типизированный token для scoped dependency в Nova tree.
   */
  static createContextToken<T>(name: string): NovaContextToken<T> {
    return createNovaContextToken<T>(name)
  }

  /**
   * DSL intrinsic для inject. В class-компонентах используйте this.inject(token).
   */
  static inject<T>(_token: NovaContextToken<T>): T {
    throw new Error('[Nova.inject] is a Nova DSL intrinsic. Use this.inject(token) inside class components.')
  }

  /**
   * DSL intrinsic для optional inject. В class-компонентах используйте this.injectOptional(token).
   */
  static injectOptional<T>(_token: NovaContextToken<T>, _fallback?: T): T | undefined {
    throw new Error('[Nova.injectOptional] is a Nova DSL intrinsic. Use this.injectOptional(token) inside class components.')
  }

  /**
   * Создает reactive business store поверх Raph data graph.
   */
  static createStore<T extends object>(instance: T, options: NovaCreateStoreOptions = {}): T {
    return createNovaStore(instance, options)
  }

  /**
   * Выполняет несколько store mutations в одной Raph transaction.
   */
  static batchStore<T>(store: object, callback: () => T): T {
    return batchNovaStore(store, callback)
  }

  /**
   * Создает mutable reactive value для Nova DSL.
   */
  static signal<T>(initialValue: T): NovaSignal<T> {
    return createNovaSignal(initialValue)
  }

  /**
   * Создает lazy computed reactive value для Nova DSL.
   */
  static computed<T>(compute: () => T): NovaComputed<T> {
    return createNovaComputed(compute)
  }

  /**
   * Выполняет callback с привязкой signal reads к NovaNode.
   */
  static trackNode<T>(node: NovaNode<any>, callback: () => T, options?: NovaTrackNodeOptions): T {
    return trackNovaNode(node, callback, options)
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
      /**
       * Обновляет runtime-состояние Nova.
       */
      updateProps(patch: Record<string, unknown>): void {
        node.setProps?.({
          ...patch,
          novaRefs: options.scope?.refs ?? {},
        })
      },
      /**
       * Обновляет runtime-состояние Nova.
       */
      updateListeners(listeners: Record<string, (...args: Array<any>) => void>): void {
        node.setListeners?.(listeners)
      },
      /**
       * Освобождает runtime-ресурсы и подписки Nova.
       */
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
