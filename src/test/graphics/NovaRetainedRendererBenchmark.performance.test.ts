import { describe, expect, it } from 'vitest'

interface BenchmarkTarget {
  minFps?: number
  maxFrameMs?: number
  maxUploadMBPerFrame?: number
  maxNodeRenderCallsPerFrame?: number
  maxFullUploadsPerFrame?: number
  maxDrawCalls?: number
  maxMemoryGrowthMB?: number
  maxTextRasterMs?: number
  maxAtlasMemoryMB?: number
  maxTextAtlasEvictionsPerFrame?: number
  maxGlyphAtlasEvictionsPerFrame?: number
  minGlyphCacheHitRate?: number
  maxDistanceFieldDrawCallDelta?: number
  maxLodDroppedTextRuns?: number
}

interface RetainedBenchmarkCase {
  id: string
  area: 'rect' | 'rounded' | 'text' | 'mixed' | 'timeline' | 'input' | 'resources' | 'motion'
  workload: 'static' | 'pan-only' | 'paint-5%' | 'paint-30%' | 'shader-animation' | 'slaylines' | 'scroll' | 'eviction' | 'zoom-inside-bucket' | 'zoom-bucket-crossing'
  count: number
  profile?: 'quality' | 'performance'
  pixiBaseline: 'required' | 'optional' | 'not-applicable'
  target: BenchmarkTarget
}

const RETAINED_BENCHMARKS: Array<RetainedBenchmarkCase> = [
  {
    id: 'rect-static-10k',
    area: 'rect',
    workload: 'static',
    count: 10_000,
    pixiBaseline: 'required',
    target: {
      minFps: 60,
      maxFrameMs: 16.67,
      maxUploadMBPerFrame: 0.05,
      maxNodeRenderCallsPerFrame: 0,
      maxFullUploadsPerFrame: 0,
      maxDrawCalls: 2,
    },
  },
  {
    id: 'rect-pan-10k',
    area: 'rect',
    workload: 'pan-only',
    count: 10_000,
    pixiBaseline: 'required',
    target: {
      minFps: 60,
      maxFrameMs: 16.67,
      maxUploadMBPerFrame: 0.05,
      maxNodeRenderCallsPerFrame: 0,
      maxFullUploadsPerFrame: 0,
      maxDrawCalls: 2,
    },
  },
  {
    id: 'rect-paint-5p-10k',
    area: 'rect',
    workload: 'paint-5%',
    count: 10_000,
    pixiBaseline: 'required',
    target: {
      minFps: 60,
      maxFrameMs: 16.67,
      maxUploadMBPerFrame: 0.25,
      maxNodeRenderCallsPerFrame: 500,
      maxFullUploadsPerFrame: 0,
      maxDrawCalls: 2,
    },
  },
  {
    id: 'rect-shader-animation-10k',
    area: 'rect',
    workload: 'shader-animation',
    count: 10_000,
    pixiBaseline: 'optional',
    target: {
      minFps: 60,
      maxFrameMs: 16.67,
      maxUploadMBPerFrame: 0.05,
      maxNodeRenderCallsPerFrame: 0,
      maxFullUploadsPerFrame: 0,
      maxDrawCalls: 2,
    },
  },
  {
    id: 'rounded-static-10k',
    area: 'rounded',
    workload: 'static',
    count: 10_000,
    pixiBaseline: 'required',
    target: {
      minFps: 60,
      maxFrameMs: 16.67,
      maxUploadMBPerFrame: 0.1,
      maxNodeRenderCallsPerFrame: 0,
      maxFullUploadsPerFrame: 0,
      maxDrawCalls: 2,
    },
  },
  {
    id: 'rounded-pan-10k',
    area: 'rounded',
    workload: 'pan-only',
    count: 10_000,
    pixiBaseline: 'required',
    target: {
      minFps: 60,
      maxFrameMs: 16.67,
      maxUploadMBPerFrame: 0.1,
      maxNodeRenderCallsPerFrame: 0,
      maxFullUploadsPerFrame: 0,
      maxDrawCalls: 2,
    },
  },
  {
    id: 'rect-static-50k',
    area: 'rect',
    workload: 'static',
    count: 50_000,
    pixiBaseline: 'required',
    target: {
      minFps: 45,
      maxFrameMs: 22.25,
      maxUploadMBPerFrame: 0.1,
      maxNodeRenderCallsPerFrame: 0,
      maxFullUploadsPerFrame: 0,
      maxDrawCalls: 4,
      maxMemoryGrowthMB: 16,
    },
  },
  {
    id: 'text-static-1k',
    area: 'text',
    workload: 'static',
    count: 1_000,
    pixiBaseline: 'required',
    target: {
      minFps: 60,
      maxFrameMs: 16.67,
      maxUploadMBPerFrame: 0.1,
      maxNodeRenderCallsPerFrame: 0,
      maxFullUploadsPerFrame: 0,
      maxDrawCalls: 8,
      maxMemoryGrowthMB: 8,
    },
  },
  {
    id: 'text-change-5p-1k',
    area: 'text',
    workload: 'paint-5%',
    count: 1_000,
    pixiBaseline: 'required',
    target: {
      minFps: 50,
      maxFrameMs: 20,
      maxUploadMBPerFrame: 0.5,
      maxNodeRenderCallsPerFrame: 50,
      maxFullUploadsPerFrame: 0,
      maxDrawCalls: 8,
      maxMemoryGrowthMB: 8,
    },
  },
  {
    id: 'mixed-order-10k',
    area: 'mixed',
    workload: 'static',
    count: 10_000,
    pixiBaseline: 'required',
    target: {
      minFps: 50,
      maxFrameMs: 20,
      maxUploadMBPerFrame: 0.25,
      maxNodeRenderCallsPerFrame: 0,
      maxFullUploadsPerFrame: 0,
      maxDrawCalls: 16,
    },
  },
  {
    id: 'mixed-all-toggles-static-50k',
    area: 'mixed',
    workload: 'static',
    count: 50_000,
    pixiBaseline: 'required',
    target: {
      minFps: 60,
      maxFrameMs: 16.67,
      maxUploadMBPerFrame: 0.1,
      maxNodeRenderCallsPerFrame: 0,
      maxFullUploadsPerFrame: 0,
      maxDrawCalls: 20,
      maxTextRasterMs: 0,
      maxAtlasMemoryMB: 64,
    },
  },
  {
    id: 'mixed-all-toggles-pan-50k',
    area: 'mixed',
    workload: 'pan-only',
    count: 50_000,
    pixiBaseline: 'required',
    target: {
      minFps: 60,
      maxFrameMs: 16.67,
      maxUploadMBPerFrame: 0.05,
      maxNodeRenderCallsPerFrame: 0,
      maxFullUploadsPerFrame: 0,
      maxDrawCalls: 20,
      maxTextRasterMs: 0,
      maxAtlasMemoryMB: 64,
    },
  },
  {
    id: 'mixed-all-toggles-paint-5p-50k',
    area: 'mixed',
    workload: 'paint-5%',
    count: 50_000,
    pixiBaseline: 'required',
    target: {
      minFps: 45,
      maxFrameMs: 22.25,
      maxUploadMBPerFrame: 3,
      maxNodeRenderCallsPerFrame: 0,
      maxFullUploadsPerFrame: 0,
      maxDrawCalls: 20,
      maxTextRasterMs: 0,
      maxAtlasMemoryMB: 64,
    },
  },
  {
    id: 'mixed-all-toggles-paint-30p-50k',
    area: 'mixed',
    workload: 'paint-30%',
    count: 50_000,
    profile: 'quality',
    pixiBaseline: 'required',
    target: {
      minFps: 45,
      maxFrameMs: 22.25,
      maxUploadMBPerFrame: 10,
      maxNodeRenderCallsPerFrame: 0,
      maxFullUploadsPerFrame: 0,
      maxDrawCalls: 20,
      maxTextRasterMs: 0,
      maxAtlasMemoryMB: 64,
    },
  },
  {
    id: 'mixed-all-toggles-zoom-inside-bucket-50k',
    area: 'mixed',
    workload: 'zoom-inside-bucket',
    count: 50_000,
    pixiBaseline: 'required',
    target: {
      minFps: 60,
      maxFrameMs: 16.67,
      maxUploadMBPerFrame: 0.05,
      maxNodeRenderCallsPerFrame: 0,
      maxFullUploadsPerFrame: 0,
      maxDrawCalls: 20,
      maxTextRasterMs: 0,
      maxAtlasMemoryMB: 64,
    },
  },
  {
    id: 'mixed-all-toggles-zoom-bucket-crossing-50k',
    area: 'mixed',
    workload: 'zoom-bucket-crossing',
    count: 50_000,
    pixiBaseline: 'required',
    target: {
      minFps: 45,
      maxFrameMs: 22.25,
      maxUploadMBPerFrame: 4,
      maxNodeRenderCallsPerFrame: 0,
      maxFullUploadsPerFrame: 0,
      maxDrawCalls: 20,
      maxTextRasterMs: 4,
      maxAtlasMemoryMB: 64,
    },
  },
  {
    id: 'text-static-50k',
    area: 'text',
    workload: 'static',
    count: 50_000,
    pixiBaseline: 'required',
    target: {
      minFps: 60,
      maxFrameMs: 16.67,
      maxUploadMBPerFrame: 0.05,
      maxNodeRenderCallsPerFrame: 0,
      maxFullUploadsPerFrame: 0,
      maxDrawCalls: 8,
      maxTextRasterMs: 0,
      maxAtlasMemoryMB: 64,
    },
  },
  {
    id: 'text-pan-50k',
    area: 'text',
    workload: 'pan-only',
    count: 50_000,
    pixiBaseline: 'required',
    target: {
      minFps: 60,
      maxFrameMs: 16.67,
      maxUploadMBPerFrame: 0.05,
      maxNodeRenderCallsPerFrame: 0,
      maxFullUploadsPerFrame: 0,
      maxDrawCalls: 8,
      maxTextRasterMs: 0,
      maxAtlasMemoryMB: 64,
    },
  },
  {
    id: 'text-change-5p-50k',
    area: 'text',
    workload: 'paint-5%',
    count: 50_000,
    pixiBaseline: 'required',
    target: {
      minFps: 45,
      maxFrameMs: 22.25,
      maxUploadMBPerFrame: 3,
      maxNodeRenderCallsPerFrame: 0,
      maxFullUploadsPerFrame: 0,
      maxDrawCalls: 8,
      maxTextRasterMs: 4,
      maxAtlasMemoryMB: 64,
    },
  },
  {
    id: 'text-zoom-inside-bucket-50k',
    area: 'text',
    workload: 'zoom-inside-bucket',
    count: 50_000,
    pixiBaseline: 'required',
    target: {
      minFps: 60,
      maxFrameMs: 16.67,
      maxUploadMBPerFrame: 0.05,
      maxNodeRenderCallsPerFrame: 0,
      maxFullUploadsPerFrame: 0,
      maxDrawCalls: 8,
      maxTextRasterMs: 0,
      maxAtlasMemoryMB: 64,
    },
  },
  {
    id: 'text-zoom-bucket-crossing-50k',
    area: 'text',
    workload: 'zoom-bucket-crossing',
    count: 50_000,
    pixiBaseline: 'required',
    target: {
      minFps: 45,
      maxFrameMs: 22.25,
      maxUploadMBPerFrame: 4,
      maxNodeRenderCallsPerFrame: 0,
      maxFullUploadsPerFrame: 0,
      maxDrawCalls: 8,
      maxTextRasterMs: 4,
      maxAtlasMemoryMB: 64,
    },
  },
  {
    id: 'text-run-atlas-25k',
    area: 'text',
    workload: 'static',
    count: 25_000,
    profile: 'quality',
    pixiBaseline: 'required',
    target: {
      minFps: 45,
      maxFrameMs: 22.25,
      maxUploadMBPerFrame: 0.1,
      maxFullUploadsPerFrame: 0,
      maxDrawCalls: 8,
      maxTextRasterMs: 0,
      maxAtlasMemoryMB: 128,
      maxTextAtlasEvictionsPerFrame: 0,
    },
  },
  {
    id: 'text-glyph-atlas-50k',
    area: 'text',
    workload: 'static',
    count: 50_000,
    profile: 'performance',
    pixiBaseline: 'required',
    target: {
      minFps: 60,
      maxFrameMs: 16.67,
      maxUploadMBPerFrame: 0.05,
      maxFullUploadsPerFrame: 0,
      maxDrawCalls: 8,
      maxTextRasterMs: 0,
      maxAtlasMemoryMB: 64,
      maxGlyphAtlasEvictionsPerFrame: 0,
      minGlyphCacheHitRate: 0.95,
    },
  },
  {
    id: 'text-sdf-timescale-50k',
    area: 'text',
    workload: 'zoom-bucket-crossing',
    count: 50_000,
    profile: 'quality',
    pixiBaseline: 'required',
    target: {
      minFps: 45,
      maxFrameMs: 22.25,
      maxUploadMBPerFrame: 0.05,
      maxFullUploadsPerFrame: 0,
      maxDrawCalls: 8,
      maxTextRasterMs: 0,
      maxAtlasMemoryMB: 64,
      maxGlyphAtlasEvictionsPerFrame: 0,
      minGlyphCacheHitRate: 0.95,
    },
  },
  {
    id: 'runtime-sdf-timescale-50k',
    area: 'text',
    workload: 'zoom-bucket-crossing',
    count: 50_000,
    profile: 'quality',
    pixiBaseline: 'required',
    target: {
      minFps: 45,
      maxFrameMs: 22.25,
      maxUploadMBPerFrame: 0.05,
      maxFullUploadsPerFrame: 0,
      maxDrawCalls: 9,
      maxDistanceFieldDrawCallDelta: 1,
      maxTextRasterMs: 0,
      maxAtlasMemoryMB: 64,
      maxGlyphAtlasEvictionsPerFrame: 0,
      minGlyphCacheHitRate: 0.95,
    },
  },
  {
    id: 'prebuilt-msdf-timescale-50k',
    area: 'text',
    workload: 'zoom-bucket-crossing',
    count: 50_000,
    profile: 'quality',
    pixiBaseline: 'required',
    target: {
      minFps: 45,
      maxFrameMs: 22.25,
      maxUploadMBPerFrame: 0.05,
      maxFullUploadsPerFrame: 0,
      maxDrawCalls: 9,
      maxDistanceFieldDrawCallDelta: 1,
      maxTextRasterMs: 0,
      maxAtlasMemoryMB: 64,
      maxGlyphAtlasEvictionsPerFrame: 0,
      minGlyphCacheHitRate: 0.95,
    },
  },
  {
    id: 'text-interaction-balanced-50k',
    area: 'text',
    workload: 'zoom-bucket-crossing',
    count: 50_000,
    profile: 'performance',
    pixiBaseline: 'required',
    target: {
      minFps: 60,
      maxFrameMs: 16.67,
      maxUploadMBPerFrame: 0.25,
      maxFullUploadsPerFrame: 0,
      maxDrawCalls: 8,
      maxTextRasterMs: 2,
      maxAtlasMemoryMB: 64,
      maxGlyphAtlasEvictionsPerFrame: 0,
    },
  },
  {
    id: 'text-interaction-performance-50k',
    area: 'text',
    workload: 'zoom-bucket-crossing',
    count: 50_000,
    profile: 'performance',
    pixiBaseline: 'required',
    target: {
      minFps: 60,
      maxFrameMs: 16.67,
      maxUploadMBPerFrame: 0.1,
      maxFullUploadsPerFrame: 0,
      maxDrawCalls: 8,
      maxTextRasterMs: 1,
      maxAtlasMemoryMB: 64,
      maxGlyphAtlasEvictionsPerFrame: 0,
      maxLodDroppedTextRuns: 50_000,
    },
  },
  {
    id: 'sdf-timescale-high-zoom',
    area: 'text',
    workload: 'zoom-bucket-crossing',
    count: 50_000,
    profile: 'quality',
    pixiBaseline: 'required',
    target: {
      minFps: 45,
      maxFrameMs: 22.25,
      maxUploadMBPerFrame: 2,
      maxNodeRenderCallsPerFrame: 0,
      maxFullUploadsPerFrame: 0,
      maxDrawCalls: 8,
      maxTextRasterMs: 4,
      maxAtlasMemoryMB: 64,
    },
  },
  {
    id: 'icon-static-50k',
    area: 'resources',
    workload: 'static',
    count: 50_000,
    pixiBaseline: 'required',
    target: {
      minFps: 60,
      maxFrameMs: 16.67,
      maxUploadMBPerFrame: 0.05,
      maxNodeRenderCallsPerFrame: 0,
      maxFullUploadsPerFrame: 0,
      maxDrawCalls: 8,
      maxAtlasMemoryMB: 16,
    },
  },
  {
    id: 'shader-animation-uniform-50k',
    area: 'motion',
    workload: 'shader-animation',
    count: 50_000,
    profile: 'quality',
    pixiBaseline: 'required',
    target: {
      minFps: 60,
      maxFrameMs: 16.67,
      maxUploadMBPerFrame: 0.05,
      maxNodeRenderCallsPerFrame: 0,
      maxFullUploadsPerFrame: 0,
      maxDrawCalls: 20,
    },
  },
  {
    id: 'slaylines-shader-motion-256k',
    area: 'motion',
    workload: 'slaylines',
    count: 256_000,
    profile: 'performance',
    pixiBaseline: 'required',
    target: {
      minFps: 60,
      maxFrameMs: 16.67,
      maxUploadMBPerFrame: 0.05,
      maxNodeRenderCallsPerFrame: 0,
      maxFullUploadsPerFrame: 0,
      maxDrawCalls: 4,
    },
  },
  {
    id: 'timeline-visible-scroll',
    area: 'timeline',
    workload: 'scroll',
    count: 50_000,
    pixiBaseline: 'required',
    target: {
      minFps: 60,
      maxFrameMs: 16.67,
      maxUploadMBPerFrame: 0.5,
      maxFullUploadsPerFrame: 0,
      maxDrawCalls: 16,
    },
  },
  {
    id: 'hit-test-10k',
    area: 'input',
    workload: 'pan-only',
    count: 10_000,
    pixiBaseline: 'optional',
    target: {
      maxFrameMs: 1,
      maxMemoryGrowthMB: 2,
    },
  },
  {
    id: 'atlas-eviction',
    area: 'resources',
    workload: 'eviction',
    count: 10_000,
    pixiBaseline: 'optional',
    target: {
      maxFrameMs: 16.67,
      maxMemoryGrowthMB: 4,
    },
  },
]

const REQUIRED_WORKLOADS = new Set<RetainedBenchmarkCase['workload']>([
  'static',
  'pan-only',
  'paint-5%',
  'paint-30%',
  'shader-animation',
  'slaylines',
  'scroll',
  'eviction',
  'zoom-inside-bucket',
  'zoom-bucket-crossing',
])

const REQUIRED_AREAS = new Set<RetainedBenchmarkCase['area']>([
  'rect',
  'rounded',
  'text',
  'mixed',
  'timeline',
  'input',
  'resources',
  'motion',
])

function byId(testCase: RetainedBenchmarkCase): string {
  return testCase.id
}

describe('матрица приёмки retained-бенчмарка WebGL2 Nova', () => {
  it('сохраняет ID сценариев бенчмарка уникальными', () => {
    expect(new Set(RETAINED_BENCHMARKS.map(byId)).size).toBe(RETAINED_BENCHMARKS.length)
  })

  it('покрывает каждый обязательный тип нагрузки', () => {
    const workloads = new Set(RETAINED_BENCHMARKS.map(testCase => testCase.workload))

    expect(workloads).toEqual(REQUIRED_WORKLOADS)
  })

  it('покрывает каждую обязательную подсистему renderer', () => {
    const areas = new Set(RETAINED_BENCHMARKS.map(testCase => testCase.area))

    expect(areas).toEqual(REQUIRED_AREAS)
  })

  it('требует baseline Pixi для сценариев видимого render', () => {
    const renderingCases = RETAINED_BENCHMARKS.filter(testCase => testCase.area !== 'input' && testCase.id !== 'atlas-eviction')

    expect(renderingCases.every(testCase => testCase.pixiBaseline === 'required' || testCase.id === 'rect-shader-animation-10k')).toBe(true)
  })

  it('задаёт измеримые цели для каждого сценария бенчмарка', () => {
    for (const testCase of RETAINED_BENCHMARKS) {
      expect(Object.keys(testCase.target).length).toBeGreaterThan(0)
      expect(testCase.count).toBeGreaterThan(0)
    }
  })

  for (const testCase of RETAINED_BENCHMARKS) {
    it.todo(`${testCase.id}: ${testCase.area} ${testCase.workload} ${testCase.count.toLocaleString('en-US')} items meets retained renderer target`)
  }
})
