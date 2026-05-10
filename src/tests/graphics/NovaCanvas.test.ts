import { afterEach, describe, expect, it, vi } from 'vitest'
import { RendererType } from '@/domain/types/renderer.types'
import { NovaCanvas } from '@/model/infrastructure/canvas/NovaCanvas'

describe('NovaCanvas', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('does not bind WebGL1 or experimental-webgl for the target WebGL renderer', () => {
    const requestedContextTypes: string[] = []

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((type: string) => {
      requestedContextTypes.push(type)
      return null
    })

    const canvas = NovaCanvas.create(100, 50, RendererType.WebGL)

    expect(requestedContextTypes).toEqual([])
    expect(Object.values(RendererType)).not.toContain('experimental-webgl')

    canvas.destroy()
  })
})
