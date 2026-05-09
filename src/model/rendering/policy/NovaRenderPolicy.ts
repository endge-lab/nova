import type {
  NovaRenderPolicy,
  NovaRenderPolicyInput,
  NovaRendererConfig,
  NovaRendererConfigInput,
  NovaRenderDirtyFlags,
  NovaRenderVersions,
} from '@/domain/types/rendering/index'

export const DEFAULT_NOVA_RENDER_POLICY: NovaRenderPolicy = Object.freeze({
  group: 'auto',
  cache: 'auto',
  textQuality: 'auto',
  updateMode: 'dynamic',
  layer: 'auto',
})

export const DEFAULT_NOVA_RENDERER_CONFIG: NovaRendererConfig = Object.freeze({
  batching: Object.freeze({
    maxBatchSize: 8192,
    semanticScopes: 'safe',
    maxDrawCallsWarning: 1000,
    plainRectStream: true,
    roundedRectStream: true,
    fullUploadDirtyRatio: 0.6,
  }),
  text: Object.freeze({
    quality: 'balanced',
    mode: 'auto',
    maxAtlasMemoryMB: 128,
    zoomBuckets: Object.freeze([0.5, 0.75, 1, 1.5, 2, 3, 4]) as unknown as number[],
    dynamicBuckets: true,
    prewarmAdjacentBuckets: true,
    rasterBudgetMs: 4,
  }),
  cache: Object.freeze({
    maxTextureMemoryMB: 256,
    maxTextAtlasMemoryMB: 128,
    maxGlyphAtlasMemoryMB: 64,
    groupCache: 'auto',
  }),
  diagnostics: Object.freeze({
    showBatches: false,
    showDirtyRegions: false,
    showAtlas: false,
  }),
})

export function resolveNovaRenderPolicy(input: NovaRenderPolicyInput = {}): NovaRenderPolicy {
  return {
    ...DEFAULT_NOVA_RENDER_POLICY,
    ...input,
  }
}

export function resolveNovaRendererConfig(
  input: NovaRendererConfigInput = {},
  base: NovaRendererConfig = DEFAULT_NOVA_RENDERER_CONFIG,
): NovaRendererConfig {
  return {
    batching: {
      ...base.batching,
      ...input.batching,
    },
    text: {
      ...base.text,
      ...input.text,
      zoomBuckets: [...(input.text?.zoomBuckets ?? base.text.zoomBuckets)],
    },
    cache: {
      ...base.cache,
      ...input.cache,
    },
    diagnostics: {
      ...base.diagnostics,
      ...input.diagnostics,
    },
  }
}

export function createCleanRenderDirtyFlags(): NovaRenderDirtyFlags {
  return {
    transform: false,
    layout: false,
    paint: false,
    children: false,
    resource: false,
    cache: false,
    visibility: false,
  }
}

export function createFullRenderDirtyFlags(): NovaRenderDirtyFlags {
  return {
    transform: true,
    layout: true,
    paint: true,
    children: true,
    resource: true,
    cache: true,
    visibility: true,
  }
}

export function createRenderVersions(value = 0): NovaRenderVersions {
  return {
    transform: value,
    layout: value,
    paint: value,
    children: value,
    resource: value,
    cache: value,
    visibility: value,
  }
}

export function mergeRenderDirtyFlags(
  target: NovaRenderDirtyFlags,
  patch: Partial<NovaRenderDirtyFlags>,
): NovaRenderDirtyFlags {
  for (const key of Object.keys(patch) as Array<keyof NovaRenderDirtyFlags>) {
    target[key] = target[key] || patch[key] === true
  }

  return target
}

export function bumpRenderVersions(
  versions: NovaRenderVersions,
  flags: Partial<NovaRenderDirtyFlags>,
): NovaRenderVersions {
  for (const key of Object.keys(flags) as Array<keyof NovaRenderDirtyFlags>) {
    if (flags[key]) versions[key] += 1
  }

  return versions
}
