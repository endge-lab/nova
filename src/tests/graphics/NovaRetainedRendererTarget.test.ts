import { describe, expect, it } from 'vitest'

type RetainedContractCase = {
  id: string
  priority: 'P0' | 'P1' | 'P2'
  area: 'dirty' | 'compiler' | 'streams' | 'gpu' | 'resources' | 'input'
  assertion: string
}

const RETAINED_CONTRACT_CASES: RetainedContractCase[] = [
  {
    id: 'transform-dirty-skips-node-render',
    priority: 'P0',
    area: 'dirty',
    assertion: 'TransformDirty updates matrix/group uniform without calling node.render().',
  },
  {
    id: 'paint-dirty-updates-handles',
    priority: 'P0',
    area: 'dirty',
    assertion: 'PaintDirty updates only render handles and dirty stream ranges owned by the node.',
  },
  {
    id: 'children-dirty-rebuilds-nearest-group',
    priority: 'P0',
    area: 'dirty',
    assertion: 'ChildrenDirty rebuilds nearest NovaRenderGroup instruction set, not the whole surface.',
  },
  {
    id: 'resource-dirty-updates-atlas-entry',
    priority: 'P0',
    area: 'resources',
    assertion: 'ResourceDirty updates text/texture atlas entries and affected texture quads only.',
  },
  {
    id: 'clean-group-reuses-instruction-set',
    priority: 'P0',
    area: 'compiler',
    assertion: 'Clean NovaRenderGroup reuses NovaInstructionSet and batch plan across frames.',
  },
  {
    id: 'node-id-to-render-handles',
    priority: 'P0',
    area: 'compiler',
    assertion: 'Compiler stores stable nodeId -> NovaRenderHandle[] mapping for direct updates.',
  },
  {
    id: 'plain-rect-fast-stream',
    priority: 'P0',
    area: 'streams',
    assertion: 'Rect without radius/border uses a plain rect stream and does not enter rounded SDF shader.',
  },
  {
    id: 'rounded-rect-instanced-stream',
    priority: 'P0',
    area: 'streams',
    assertion: 'Rounded rect and border use an instanced rounded-rect stream.',
  },
  {
    id: 'gpu-persistent-buffer-capacity',
    priority: 'P0',
    area: 'gpu',
    assertion: 'GPU buffers keep capacity across frames and avoid reallocating for stable counts.',
  },
  {
    id: 'gpu-subdata-dirty-ranges',
    priority: 'P0',
    area: 'gpu',
    assertion: 'Small dirty ranges use bufferSubData instead of full bufferData upload.',
  },
  {
    id: 'gpu-full-upload-threshold',
    priority: 'P1',
    area: 'gpu',
    assertion: 'Full orphan/upload is used only when dirty byte ratio exceeds configured threshold.',
  },
  {
    id: 'painter-order-preserved',
    priority: 'P0',
    area: 'streams',
    assertion: 'Batch planner preserves strict painter order by default.',
  },
  {
    id: 'text-run-atlas-visible-only',
    priority: 'P1',
    area: 'resources',
    assertion: 'TextRunAtlas rasterizes visible dirty text runs only.',
  },
  {
    id: 'texture-atlas-lru',
    priority: 'P1',
    area: 'resources',
    assertion: 'Texture/icon atlas evicts least-recently-used entries under memory pressure.',
  },
  {
    id: 'local-space-hit-index-moving-group',
    priority: 'P1',
    area: 'input',
    assertion: 'Moving group hit-test uses local-space index without rebuilding all item bounds.',
  },
]

function ids(cases: RetainedContractCase[]): string[] {
  return cases.map(testCase => testCase.id)
}

describe('Nova retained WebGL2 renderer target contract matrix', () => {
  it('keeps retained-renderer contract case ids unique', () => {
    expect(new Set(ids(RETAINED_CONTRACT_CASES)).size).toBe(RETAINED_CONTRACT_CASES.length)
  })

  it('covers all P0 target areas required before Pixi parity work', () => {
    const p0Areas = new Set(RETAINED_CONTRACT_CASES.filter(testCase => testCase.priority === 'P0').map(testCase => testCase.area))

    expect(p0Areas).toEqual(new Set(['dirty', 'compiler', 'streams', 'gpu', 'resources']))
  })

  it('keeps every retained contract case measurable', () => {
    for (const testCase of RETAINED_CONTRACT_CASES) {
      expect(testCase.assertion.length).toBeGreaterThan(20)
      expect(testCase.assertion).toMatch(/\.$/)
    }
  })

  for (const testCase of RETAINED_CONTRACT_CASES) {
    it.todo(`${testCase.priority} ${testCase.id}: ${testCase.assertion}`)
  }
})

