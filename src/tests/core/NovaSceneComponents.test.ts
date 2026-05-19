import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NOVA_SCENE_SCHEMA_TYPE,
  NOVA_SCENES_SCHEMA_TYPE,
  NovaComponentNode,
  type NovaComponentCreateContext,
  type NovaComponentDescriptor,
  type NovaComponentSchema,
} from '@/index'
import { createTestApp, installCanvasMocks } from '@/tests/helpers/novaTestHarness'

interface SceneChildProps {
  label?: string
}

/**
 * Описывает Nova-node SceneChildNode и его runtime-поведение.
 */
class SceneChildNode extends NovaComponentNode<SceneChildProps> {
  /**
   * Выполняет отрисовку SceneChildNode.
   */
  render(): void {}
}

function createSceneChildDescriptor(): NovaComponentDescriptor<SceneChildProps, unknown, Record<string, never>, SceneChildProps> {
  const descriptor: NovaComponentDescriptor<SceneChildProps, unknown, Record<string, never>, SceneChildProps> = {
    type: 'test.scene-child',
    name: 'SceneChild',
    version: '1.0.0',
    kind: 'node-component',
    normalize: schema => ({ label: schema.props?.label }),
    createNode: (
      ctx: NovaComponentCreateContext<Record<string, any>>,
      schema: NovaComponentSchema<SceneChildProps>,
    ) => new SceneChildNode(
      ctx.app,
      ctx.surface,
      descriptor,
      descriptor.normalize!(schema),
      { componentId: schema.id },
    ),
  }
  return descriptor
}

describe('Nova scene DSL components', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    installCanvasMocks()
  })

  it('activates one Scene and keeps inactive cached scenes in memory', () => {
    const app = createTestApp()
    app.schema.register(createSceneChildDescriptor())
    const surface = app.createSurface('scene-dsl')

    const scenes = app.schema.createNode(surface, {
      type: NOVA_SCENES_SCHEMA_TYPE,
      id: 'scene-switcher',
      props: { active: 'red', strategy: 'keep-alive' },
      children: [
        {
          type: NOVA_SCENE_SCHEMA_TYPE,
          id: 'red',
          children: [{ type: 'test.scene-child', id: 'red-child', props: { label: 'Red' } }],
        },
        {
          type: NOVA_SCENE_SCHEMA_TYPE,
          id: 'blue',
          children: [{ type: 'test.scene-child', id: 'blue-child', props: { label: 'Blue' } }],
        },
      ],
    })

    const api = scenes.getApi() as { getCachedSceneIds: () => Array<string> }
    const red = app.components.get<SceneChildNode>('red-child')

    expect(red).toBeTruthy()
    expect(app.components.get('blue-child')).toBeUndefined()
    expect(api.getCachedSceneIds()).toEqual(['red'])

    scenes.setProps?.({ active: 'blue' })

    const blue = app.components.get<SceneChildNode>('blue-child')

    expect(app.components.get('red-child')).toBe(red)
    expect(red?.lifecycleState).toBe('paused')
    expect(blue).toBeTruthy()
    expect(blue?.lifecycleState).toBe('mounted')
    expect(api.getCachedSceneIds().sort()).toEqual(['blue', 'red'])

    scenes.setProps?.({ active: 'red' })

    expect(app.components.get('red-child')).toBe(red)
    expect(red?.lifecycleState).toBe('mounted')
    expect(blue?.lifecycleState).toBe('paused')

    app.destroy()
  })

  it('destroys cached Scene roots when the manager node is removed', () => {
    const app = createTestApp()
    app.schema.register(createSceneChildDescriptor())
    const surface = app.createSurface('scene-dsl-cleanup')

    const scenes = app.schema.createNode(surface, {
      type: NOVA_SCENES_SCHEMA_TYPE,
      id: 'scene-switcher',
      props: { active: 'red' },
      children: [
        {
          type: NOVA_SCENE_SCHEMA_TYPE,
          id: 'red',
          children: [{ type: 'test.scene-child', id: 'red-child' }],
        },
        {
          type: NOVA_SCENE_SCHEMA_TYPE,
          id: 'blue',
          children: [{ type: 'test.scene-child', id: 'blue-child' }],
        },
      ],
    })

    scenes.setProps?.({ active: 'blue' })

    const red = app.components.get<SceneChildNode>('red-child')
    const blue = app.components.get<SceneChildNode>('blue-child')

    scenes.remove()

    expect(red?.lifecycleState).toBe('destroyed')
    expect(blue?.lifecycleState).toBe('destroyed')
    expect(app.components.get('red-child')).toBeUndefined()
    expect(app.components.get('blue-child')).toBeUndefined()

    app.destroy()
  })
})
