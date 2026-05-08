import { afterEach, describe, expect, it, vi } from 'vitest'
import { RendererType } from '@/domain/types/renderer-types'
import { NovaCanvas } from '@/model/renderers/shared/NovaCanvas'

describe('NovaCanvas', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('keeps experimental-webgl as an internal fallback string, not a public RendererType', () => {
    const gl = {
      getExtension: vi.fn(() => null),
    } as unknown as WebGLRenderingContext
    const requestedContextTypes: string[] = []

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((type: string) => {
      requestedContextTypes.push(type)
      if (type === 'experimental-webgl') {
        return gl
      }
      return null
    })

    const canvas = NovaCanvas.create(100, 50, RendererType.WebGLOld)

    expect(requestedContextTypes).toEqual(['webgl', 'experimental-webgl'])
    expect(Object.values(RendererType)).not.toContain('experimental-webgl')

    canvas.destroy()
  })
})
