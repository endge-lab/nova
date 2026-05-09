import { describe, expect, it } from 'vitest'

type BenchmarkTarget = {
  minFps?: number
  maxFrameMs?: number
  maxUploadMBPerFrame?: number
  maxNodeRenderCallsPerFrame?: number
  maxFullUploadsPerFrame?: number
  maxDrawCalls?: number
  maxMemoryGrowthMB?: number
}

type RetainedBenchmarkCase = {
  id: string
  area: 'rect' | 'rounded' | 'text' | 'mixed' | 'timeline' | 'input' | 'resources'
  workload: 'static' | 'pan-only' | 'paint-5%' | 'shader-animation' | 'scroll' | 'eviction'
  count: number
  pixiBaseline: 'required' | 'optional' | 'not-applicable'
  target: BenchmarkTarget
}

const RETAINED_BENCHMARKS: RetainedBenchmarkCase[] = [
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
  'shader-animation',
  'scroll',
  'eviction',
])

const REQUIRED_AREAS = new Set<RetainedBenchmarkCase['area']>([
  'rect',
  'rounded',
  'text',
  'mixed',
  'timeline',
  'input',
  'resources',
])

function byId(testCase: RetainedBenchmarkCase): string {
  return testCase.id
}

describe('Nova retained WebGL2 benchmark acceptance matrix', () => {
  it('keeps benchmark scenario ids unique', () => {
    expect(new Set(RETAINED_BENCHMARKS.map(byId)).size).toBe(RETAINED_BENCHMARKS.length)
  })

  it('covers every required workload type', () => {
    const workloads = new Set(RETAINED_BENCHMARKS.map(testCase => testCase.workload))

    expect(workloads).toEqual(REQUIRED_WORKLOADS)
  })

  it('covers every required renderer subsystem', () => {
    const areas = new Set(RETAINED_BENCHMARKS.map(testCase => testCase.area))

    expect(areas).toEqual(REQUIRED_AREAS)
  })

  it('requires Pixi baselines for visible rendering scenarios', () => {
    const renderingCases = RETAINED_BENCHMARKS.filter(testCase => testCase.area !== 'input' && testCase.area !== 'resources')

    expect(renderingCases.every(testCase => testCase.pixiBaseline === 'required' || testCase.id === 'rect-shader-animation-10k')).toBe(true)
  })

  it('defines measurable targets for every benchmark scenario', () => {
    for (const testCase of RETAINED_BENCHMARKS) {
      expect(Object.keys(testCase.target).length).toBeGreaterThan(0)
      expect(testCase.count).toBeGreaterThan(0)
    }
  })

  for (const testCase of RETAINED_BENCHMARKS) {
    it.todo(`${testCase.id}: ${testCase.area} ${testCase.workload} ${testCase.count.toLocaleString('en-US')} items meets retained renderer target`)
  }
})

