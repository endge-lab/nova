import type { EventList } from '@endge/utils'
import type {
  NovaComponentCreateContext,
  NovaComponentDescriptor,
  NovaComponentSchema,
} from '@/domain/types/component.types'
import type { NovaApp } from '@/model/runtime/app/NovaApp'
import type { NovaSchemaRegistry } from '@/model/runtime/components/NovaSchemaRegistry'
import type { NovaTemplateChildSchema } from '@/model/runtime/template/NovaTemplateRuntime'
import type { NovaNode } from '@/model/runtime/tree/NovaNode'
import type { NovaSurface } from '@/model/runtime/tree/NovaSurface'
import { NovaComponentNode } from '@/model/runtime/components/NovaComponentNode'
import { NovaScene } from '@/model/runtime/scene/NovaScene'
import {

  reconcileNovaTemplateChildren,
} from '@/model/runtime/template/NovaTemplateRuntime'

export const NOVA_SCENES_SCHEMA_TYPE = 'nova.scenes'
export const NOVA_SCENE_SCHEMA_TYPE = 'nova.scene'

export type NovaScenesStrategy = 'keep-alive'

export interface NovaScenesProps {
  active?: string | number | null
  strategy?: NovaScenesStrategy
}

export interface NovaScenesResolvedProps {
  active: string | number | null
  strategy: NovaScenesStrategy
}

export interface NovaSceneDefinitionProps {
  id?: string | number
}

export interface NovaScenesApi {
  setChildren: (children: Array<NovaTemplateChildSchema>) => void
  getActiveSceneId: () => string | null
  getCachedSceneIds: () => Array<string>
}

type NovaScenesDescriptor = NovaComponentDescriptor<
  NovaScenesResolvedProps,
  NovaScenesApi,
  Record<string, never>,
  NovaScenesProps
>

type NovaSceneDefinitionDescriptor = NovaComponentDescriptor<
  NovaSceneDefinitionProps,
  unknown,
  Record<string, never>,
  NovaSceneDefinitionProps
>

interface NovaTemplateSceneDefinition {
  id: string
  children: Array<NovaTemplateChildSchema>
}

/** Runtime-компонент, который управляет cached NovaScene из DSL-разметки. */
export class NovaScenesNode<E extends EventList = Record<string, any>>
  extends NovaComponentNode<NovaScenesResolvedProps, NovaScenesApi, Record<string, never>, NovaScenesProps, E> {
  private readonly api: NovaScenesApi
  private readonly definitions = new Map<string, NovaTemplateSceneDefinition>()
  private readonly scenes = new Map<string, NovaTemplateScene<E>>()
  private activeSceneId: string | null = null
  private ready = false

  /**
   * Создает manager независимых NovaScene внутри текущего template subtree.
   */
  constructor(
    app: NovaApp<E>,
    surface: NovaSurface<E>,
    props: NovaScenesProps = {},
    options: { componentId?: string, children?: Array<NovaTemplateChildSchema> } = {},
    descriptor: NovaScenesDescriptor = NOVA_SCENES_DESCRIPTOR,
  ) {
    super(app, surface, descriptor, normalizeNovaScenesProps(props), options)
    this.__type = 'Scenes'
    this.api = {
      setChildren: children => this.setChildren(children),
      getActiveSceneId: () => this.activeSceneId,
      getCachedSceneIds: () => [...this.scenes.keys()],
    }
    this.setChildren(options.children ?? [])
    this.ready = true
  }

  /** Возвращает public API компонента. */
  override getApi(): NovaScenesApi {
    return this.api
  }

  /** Обновляет props и синхронизирует активную сцену. */
  override setProps(patch: NovaScenesProps): this {
    super.setProps(patch as Partial<NovaScenesResolvedProps>)
    this.syncActiveSceneIfReady()
    return this
  }

  /** Принимает декларации Scene и обновляет cached runtime-сцены. */
  setChildren(children: Array<NovaTemplateChildSchema>): void {
    this.definitions.clear()

    for (const child of children) {
      if (child.type !== NOVA_SCENE_SCHEMA_TYPE) {
        continue
      }

      const id = resolveSceneDefinitionId(child)
      if (!id) {
        continue
      }

      this.definitions.set(id, {
        id,
        children: child.children ?? [],
      })
    }

    for (const [id, scene] of [...this.scenes.entries()]) {
      const definition = this.definitions.get(id)
      if (!definition) {
        scene.destroy()
        this.scenes.delete(id)
        continue
      }

      scene.setChildren(definition.children)
    }

    this.syncActiveSceneIfReady()
  }

  /** Синхронизирует active Scene после mount самой manager-ноды. */
  protected override onMount(): void {
    super.onMount()
    this.syncActiveSceneIfReady()
  }

  /** Освобождает cached scenes вместе с manager node. */
  override dispose(): void {
    for (const scene of this.scenes.values()) {
      scene.destroy()
    }
    this.scenes.clear()
    this.definitions.clear()
    this.activeSceneId = null
    super.dispose()
  }

  /**
   * Синхронизирует состояние между слоями NovaScenesNode.
   */
  private syncActiveSceneIfReady(): void {
    if (!this.ready || this.lifecycleState === 'created' || this.lifecycleState === 'destroyed') {
      return
    }

    this.syncActiveScene()
  }

  /**
   * Синхронизирует состояние между слоями NovaScenesNode.
   */
  private syncActiveScene(): void {
    const nextActiveId = this.props.active === null || this.props.active === undefined
      ? null
      : String(this.props.active)

    if (this.activeSceneId === nextActiveId) {
      this.ensureActiveSceneMounted(nextActiveId)
      return
    }

    const previous = this.activeSceneId ? this.scenes.get(this.activeSceneId) : undefined
    previous?.pause()

    this.activeSceneId = nextActiveId
    this.ensureActiveSceneMounted(nextActiveId)
    this.dirty({ update: true, render: true })
  }

  /**
   * Выполняет внутренний шаг ensureActiveSceneMounted для NovaScenesNode.
   */
  private ensureActiveSceneMounted(id: string | null): void {
    if (!id) {
      return
    }

    const definition = this.definitions.get(id)
    if (!definition) {
      return
    }

    const scene = this.resolveScene(definition)
    if (scene.state === 'created') {
      scene.mount()
      return
    }
    if (scene.state === 'paused') {
      scene.resume()
    }
  }

  /**
   * Нормализует и возвращает итоговое значение NovaScenesNode.
   */
  private resolveScene(definition: NovaTemplateSceneDefinition): NovaTemplateScene<E> {
    const existing = this.scenes.get(definition.id)
    if (existing) {
      return existing
    }

    const scene = new NovaTemplateScene(this.nova, this, definition.id, definition.children)
    this.scenes.set(definition.id, scene)
    return scene
  }
}

/** No-op declaration node for invalid direct <Scene> usage outside <Scenes>. */
export class NovaSceneDefinitionNode<E extends EventList = Record<string, any>>
  extends NovaComponentNode<NovaSceneDefinitionProps, unknown, Record<string, never>, NovaSceneDefinitionProps, E> {
  /**
   * Создает declaration node без render-поведения.
   */
  constructor(
    app: NovaApp<E>,
    surface: NovaSurface<E>,
    props: NovaSceneDefinitionProps = {},
    options: { componentId?: string } = {},
    descriptor: NovaSceneDefinitionDescriptor = NOVA_SCENE_DESCRIPTOR,
  ) {
    super(app, surface, descriptor, props, options)
    this.__type = 'Scene'
  }
}

/**
 * Описывает сцену NovaTemplateScene и ее runtime lifecycle.
 */
class NovaTemplateScene<E extends EventList> extends NovaScene<E> {
  private managedRoots: Array<NovaNode<E>> = []

  /**
   * Создает cached scene из compiled DSL children.
   */
  constructor(
    app: NovaApp<E>,
    private readonly host: NovaScenesNode<E>,
    readonly id: string,
    private children: Array<NovaTemplateChildSchema>,
  ) {
    super(app)
  }

  /**
   * Обновляет schema snapshot без пересоздания scene instance.
   */
  setChildren(children: Array<NovaTemplateChildSchema>): void {
    this.children = children
    if (this.state === 'created' || this.state === 'destroyed') {
      return
    }

    this.reconcile()
    this.applyActiveState(this.state === 'mounted')
  }

  /** Создает roots при первом mount. */
  protected override onMount(): void {
    this.reconcile()
    this.applyActiveState(true)
  }

  /** Отключает inactive scene от update/render и input. */
  protected override onPause(): void {
    this.applyActiveState(false)
  }

  /** Возвращает cached scene в active tree. */
  protected override onResume(): void {
    this.applyActiveState(true)
  }

  /** Сбрасывает локальный список после удаления roots базовым lifecycle. */
  protected override onUnmount(): void {
    this.managedRoots = []
  }

  /**
   * Согласует runtime-состояние NovaTemplateScene.
   */
  private reconcile(): void {
    const result = reconcileNovaTemplateChildren(this.host, this.managedRoots, this.children)
    this.managedRoots = result.nodes
    this.setRoots(this.managedRoots)
  }

  /**
   * Применяет подготовленное состояние NovaTemplateScene.
   */
  private applyActiveState(active: boolean): void {
    for (const root of this.roots) {
      root.active = active
      root.visible = active
    }
  }
}

export const NOVA_SCENES_DESCRIPTOR: NovaScenesDescriptor = {
  type: NOVA_SCENES_SCHEMA_TYPE,
  name: 'Scenes',
  version: '1.0.0',
  kind: 'node-component',
  dirtyPolicy: {
    update: ['active', 'strategy'],
    render: ['active', 'strategy'],
  },
  normalize: schema => normalizeNovaScenesProps(schema.props),
  createNode: <E extends EventList>(
    ctx: NovaComponentCreateContext<E>,
    schema: NovaComponentSchema<NovaScenesProps>,
  ) => new NovaScenesNode(
    ctx.app,
    ctx.surface,
    schema.props ?? {},
    {
      componentId: schema.id,
      children: schema.children ?? [],
    },
    NOVA_SCENES_DESCRIPTOR,
  ),
}

export const NOVA_SCENE_DESCRIPTOR: NovaSceneDefinitionDescriptor = {
  type: NOVA_SCENE_SCHEMA_TYPE,
  name: 'Scene',
  version: '1.0.0',
  kind: 'node-component',
  normalize: schema => schema.props ?? {},
  createNode: <E extends EventList>(
    ctx: NovaComponentCreateContext<E>,
    schema: NovaComponentSchema<NovaSceneDefinitionProps>,
  ) => new NovaSceneDefinitionNode(
    ctx.app,
    ctx.surface,
    schema.props ?? {},
    { componentId: schema.id },
    NOVA_SCENE_DESCRIPTOR,
  ),
}

/** Группировка core DSL schema types для compiler output и публичных интеграций. */
export const NovaCoreDSL = {
  Scenes: NOVA_SCENES_SCHEMA_TYPE,
  Scene: NOVA_SCENE_SCHEMA_TYPE,
} as const

/** Регистрирует core DSL-компоненты сцен. */
export function registerNovaSceneComponents(registry: NovaSchemaRegistry): void {
  registry.register(NOVA_SCENES_DESCRIPTOR, { override: true })
  registry.register(NOVA_SCENE_DESCRIPTOR, { override: true })
}

function normalizeNovaScenesProps(props: NovaScenesProps = {}): NovaScenesResolvedProps {
  return {
    active: props.active ?? null,
    strategy: props.strategy ?? 'keep-alive',
  }
}

function resolveSceneDefinitionId(schema: NovaTemplateChildSchema): string | null {
  const id = schema.id ?? schema.props?.id
  return id === null || id === undefined ? null : String(id)
}
