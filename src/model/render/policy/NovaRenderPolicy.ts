import type {
  NovaRenderPolicy,
  NovaRenderPolicyInput,
  NovaRendererConfig,
  NovaRendererConfigInput,
  NovaRendererTextConfig,
  NovaRenderDirtyFlags,
  NovaRenderVersions,
} from '@/domain/types/rendering/index'

/**
 * Хранит значение DEFAULT_NOVA_RENDER_POLICY, используемое runtime-кодом пакета.
 */
export const DEFAULT_NOVA_RENDER_POLICY: NovaRenderPolicy = Object.freeze({
  group: 'auto',
  cache: 'auto',
  textQuality: 'auto',
  updateMode: 'dynamic',
  layer: 'auto',
})

/**
 * Хранит значение DEFAULT_NOVA_RENDERER_CONFIG, используемое runtime-кодом пакета.
 */
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
    zoomBuckets: Object.freeze([0.5, 0.75, 1, 1.5, 2, 3, 4]) as unknown as Array<number>,
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

/**
 * Вычисляет nova render policy.
 */
export function resolveNovaRenderPolicy(input: NovaRenderPolicyInput = {}): NovaRenderPolicy {
  return {
    ...DEFAULT_NOVA_RENDER_POLICY,
    ...input,
  }
}

/**
 * Вычисляет nova renderer config.
 */
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

/**
 * Вычисляет bucket растеризации текста для заданного zoom.
 */
export function resolveNovaTextRasterBucket(config: NovaRendererTextConfig, zoom: number): number {
  const buckets = normalizeTextZoomBuckets(config.zoomBuckets)

  if (config.quality === 'performance' || !config.dynamicBuckets) {
    return buckets.includes(1) ? 1 : buckets[0]
  }

  const normalizedZoom = Math.max(0.01, Number.isFinite(zoom) ? zoom : 1)
  let best = buckets[0]
  let bestDistance = Math.abs(normalizedZoom - best)

  for (const bucket of buckets) {
    const distance = Math.abs(normalizedZoom - bucket)
    if (distance < bestDistance) {
      best = bucket
      bestDistance = distance
    }
  }

  return best
}

/**
 * Вычисляет итоговый scale растеризации текста с учетом DPR canvas.
 */
export function resolveNovaTextRasterScale(config: NovaRendererTextConfig, zoom: number, dpr: number): number {
  const safeDpr = Math.max(0.1, Number.isFinite(dpr) ? dpr : 1)
  return safeDpr * resolveNovaTextRasterBucket(config, zoom)
}

/**
 * Возвращает отсортированный непустой список zoom buckets.
 */
function normalizeTextZoomBuckets(buckets: ReadonlyArray<number>): Array<number> {
  const normalized = buckets
    .filter(bucket => Number.isFinite(bucket) && bucket > 0)
    .sort((a, b) => a - b)

  return normalized.length > 0 ? normalized : [1]
}

/**
 * Создает clean render dirty flags.
 */
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

/**
 * Создает full render dirty flags.
 */
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

/**
 * Создает render versions.
 */
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

/**
 * Объединяет render dirty flags.
 */
export function mergeRenderDirtyFlags(
  target: NovaRenderDirtyFlags,
  patch: Partial<NovaRenderDirtyFlags>,
): NovaRenderDirtyFlags {
  for (const key of Object.keys(patch) as Array<keyof NovaRenderDirtyFlags>) {
    target[key] = target[key] || patch[key] === true
  }

  return target
}

/**
 * Выполняет публичную операцию bump render versions.
 */
export function bumpRenderVersions(
  versions: NovaRenderVersions,
  flags: Partial<NovaRenderDirtyFlags>,
): NovaRenderVersions {
  for (const key of Object.keys(flags) as Array<keyof NovaRenderDirtyFlags>) {
    if (flags[key]) versions[key] += 1
  }

  return versions
}
