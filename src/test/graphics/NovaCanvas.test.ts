import { afterEach, describe, expect, it, vi } from 'vitest'
import { RendererType } from '@/domain/types/renderer.types'
import { NovaCanvas } from '@/model/platform/NovaCanvas'

describe('холст Nova', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('не подключает WebGL1 или experimental-webgl для целевого renderer WebGL', () => {
    const requestedContextTypes: Array<string> = []

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
