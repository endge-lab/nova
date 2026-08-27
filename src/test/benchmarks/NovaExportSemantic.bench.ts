import { bench, describe, vi } from 'vitest'
import { NovaSemanticService } from '@/model/semantic/NovaSemanticService'
import { createTestApp, installCanvasMocks } from '@/test/helpers/novaTestHarness'

const benchOptions = {
  iterations: 3,
  warmupIterations: 1,
  time: 10,
  warmupTime: 5,
}

installCanvasMocks()
vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation((mime?: string) => {
  return `data:${mime ?? 'image/png'};base64,ZmFrZQ==`
})

describe('nova export and semantic benchmarks', () => {
  bench('exportImage png current frame', async () => {
    const app = createTestApp({ width: 640, height: 360 })
    await app.exportImage({ format: 'png', pixelRatio: 1 })
    app.destroy()
  }, benchOptions)

  bench('semantic snapshot 100k synthetic regions bounded query', () => {
    const service = createSemanticFixture(100_000)
    const snapshot = service.snapshot({ scope: 'bench', maxRegions: 256, includeData: false })
    if (snapshot.regions.length > 256) {
      throw new Error('semantic snapshot exceeded maxRegions')
    }
  }, benchOptions)

  bench('semantic focus navigation 10k focusable regions', () => {
    const service = createSemanticFixture(10_000)
    for (let index = 0; index < 1_000; index += 1) {
      service.focusNext({ scope: 'bench' })
    }
  }, benchOptions)
})

function createSemanticFixture(count: number): NovaSemanticService {
  const service = new NovaSemanticService()
  service.register({ id: 'chart', role: 'chart', scope: 'bench', label: 'Chart', focusable: true, order: 0 })
  for (let index = 0; index < count; index += 1) {
    service.register({
      id: `mark-${index}`,
      role: 'mark',
      scope: 'bench',
      label: `Mark ${index}`,
      focusable: true,
      order: index + 1,
      data: { value: index % 997 },
    })
  }
  return service
}
