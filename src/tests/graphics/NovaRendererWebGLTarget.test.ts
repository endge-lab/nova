import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  NovaRenderCommandWriter,
  NovaRenderContext,
  NovaRenderFrameBuilder,
  NovaSchemaRegistry,
  compileNovaRectStyle,
  compileNovaTextStyle,
  parseNovaColor,
} from '@/index'

function createFrameBuilder(): NovaRenderFrameBuilder {
  return new NovaRenderFrameBuilder('target-webgl', {
    x: 0,
    y: 0,
    width: 320,
    height: 180,
    dpr: 1,
  })
}

describe('Nova target WebGL2 renderer contracts', () => {
  it('keeps target render context schema-first without ordered/batched public methods', () => {
    expect('schema' in NovaRenderContext.prototype).toBe(true)
    expect('schemaOrdered' in NovaRenderContext.prototype).toBe(false)
    expect('schemaBatched' in NovaRenderContext.prototype).toBe(false)
  })

  it('emits primitive helpers through the same schema item path', () => {
    const frameBuilder = createFrameBuilder()
    const writer = new NovaRenderCommandWriter(frameBuilder)
    const context = new NovaRenderContext(writer, new NovaSchemaRegistry())

    context.rect({ x: 0, y: 0, width: 20, height: 10, styles: { background: '#fff' } })
    context.schema({ type: 'text', text: 'Nova', x: 0, y: 16, width: 80, height: 20 })
    context.pushClip({ x: 0, y: 0, width: 100, height: 40 })
    context.line({ x1: 0, y1: 0, x2: 50, y2: 20, styles: { color: '#111' } })
    context.popClip()

    const frame = frameBuilder.build()

    expect(frame.items.map(item => item.kind)).toEqual(['rect', 'text', 'line'])
    expect(frame.commands.filter(command => command.type === 'drawItem')).toHaveLength(3)
    expect(frame.commands.some(command => command.type === 'clip')).toBe(true)
    expect(frame.commands.some(command => command.type === 'clearClip')).toBe(true)
  })

  it('compiles hot-path styles into numeric colors and resolved defaults', () => {
    const color = parseNovaColor('rgba(255, 0, 128, 0.5)')
    const rect = compileNovaRectStyle({
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      styles: { background: '#ff0000', border: { color: '#000', width: 2, radius: 4 }, opacity: 0.75 },
    })
    const text = compileNovaTextStyle({
      text: 'Label',
      x: 0,
      y: 0,
      width: 100,
      height: 20,
      styles: {
        font: { family: 'monospace', size: 13, weight: '700' },
        padding: { horizontal: 4, vertical: 2 },
        align: { horizontal: 'center', vertical: 'middle' },
        ellipsis: true,
      },
    })

    expect(color.r).toBe(1)
    expect(color.b).toBeCloseTo(128 / 255)
    expect(color.a).toBeCloseTo(0.5, 2)
    expect(rect.fill.r).toBe(1)
    expect(rect.borderWidth).toBe(2)
    expect(rect.borderRadius).toBe(4)
    expect(rect.opacity).toBe(0.75)
    expect(text.font).toContain('700 13px monospace')
    expect(text.padding.left).toBe(4)
    expect(text.verticalAlign).toBe('middle')
    expect(text.ellipsis).toBe(true)
  })

  it('does not depend on webgl-old or drawImage replay in the target backend', () => {
    const rendererSource = readFileSync(resolve(process.cwd(), 'src/model/render/backends/webgl/NovaRendererWebGL.ts'), 'utf8')
    const frameRendererSource = readFileSync(resolve(process.cwd(), 'src/model/render/backends/webgl/NovaWebGLFrameRenderer.ts'), 'utf8')
    const combined = `${rendererSource}\n${frameRendererSource}`

    expect(combined).not.toContain('webgl_old')
    expect(combined).not.toContain('NovaRendererWebGLOld')
    expect(combined).not.toContain('drawImage')
    expect(combined).not.toContain('_compatRenderer')
  })
})
