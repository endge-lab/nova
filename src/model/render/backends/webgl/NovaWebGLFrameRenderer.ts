import type {
  NovaArc,
  NovaBorder,
  NovaCircle,
  NovaIcon,
  NovaIconBatch,
  NovaLine,
  NovaNineSliceImage,
  NovaParticleBatch,
  NovaPatternRect,
  NovaPolygon,
  NovaRect,
  NovaRectBatch,
  NovaSchemaItem,
  NovaSemanticScopeKind,
  NovaStripeRectBatch,
  NovaText,
  NovaTextBatch,
  NovaTextRenderMode,
  NovaTextRenderRole,
  NovaTimeRangeSegmentBatch,
} from '@/domain/types/renderer.types'
import type {
  NovaRenderClip,
  NovaRendererTextConfig,
  NovaRenderFrame,
  NovaRenderItem,
  NovaRenderMetrics,
  NovaRenderTarget,
} from '@/domain/types/rendering/index'
import type { NovaWebGLDevice } from '@/model/render/backends/webgl/NovaWebGLDevice'
import type { NovaParsedColor } from '@/model/render/schema/nova-color-parser'
import type { NovaCompiledTextStyle } from '@/model/render/schema/nova-style-compiler'
import type { NovaAssetDrawableInput, NovaAssetFillMode, NovaAssetRegistry, NovaNineSliceInsets, NovaStripeAssetDescriptor } from '@/model/runtime/assets/NovaAssetRegistry'
import { mat3 } from 'gl-matrix'
import { NovaGpuBufferArena } from '@/model/render/backends/webgl/NovaGpuBufferArena'
import { NovaWebGLProgram } from '@/model/render/backends/webgl/NovaWebGLProgram'
import {
  DEFAULT_NOVA_RENDERER_CONFIG,
  resolveNovaTextRasterScale,
} from '@/model/render/policy/nova-render-policy'
import { parseNovaColor } from '@/model/render/schema/nova-color-parser'
import {
  compileNovaArcStyle,
  compileNovaBorderStyle,
  compileNovaCircleStyle,
  compileNovaLineStyle,
  compileNovaPolygonStyle,
  compileNovaRectStyle,
  compileNovaTextStyle,

} from '@/model/render/schema/nova-style-compiler'
import { resolveNovaIconRenderOpacity, resolveNovaIconRenderRect } from '@/model/render/utils/nova-icon-rendering'
import { isNovaAssetRef, NovaAssets } from '@/model/runtime/assets/NovaAssetRegistry'

const FLOAT_BYTES = 4
const RECT_STRIDE = 21
const SOLID_STRIDE = 9
const TEXTURE_STRIDE = 8
const DISTANCE_FIELD_STRIDE = 10
const PARTICLE_POSITION_STRIDE = 2
const PARTICLE_CIRCLE_STATIC_STRIDE = 10
const PARTICLE_SPRITE_STATIC_STRIDE = 2
const RECT_BATCH_GEOMETRY_STRIDE = 4
const RECT_BATCH_STATIC_STRIDE = 6
const TIME_RANGE_SEGMENT_GEOMETRY_STRIDE = 4
const TIME_RANGE_SEGMENT_STATIC_STRIDE = 8
const TEXTURE_RECT_BATCH_GEOMETRY_STRIDE = 4
const TEXTURE_RECT_BATCH_STATIC_STRIDE = 5
const DISTANCE_FIELD_GLYPH_STATIC_STRIDE = 11
const STRIPE_BATCH_GEOMETRY_STRIDE = 4
const STRIPE_BATCH_STATIC_STRIDE = 10
const FULL_UPLOAD_DIRTY_RATIO = 0.6
const TEXT_ATLAS_PAGE_SIZE = 2048
const TEXT_RUN_ATLAS_PADDING_PX = 1
const AUTO_GLYPH_LABEL_MAX_CODE_POINTS = 12
const AUTO_TEXT_BATCH_SAMPLE_LIMIT = 128

const EARLY_STRIPE_BATCH_VERTEX_SHADER = `#version 300 es
precision mediump float;
in vec2 a_unit;
in vec4 a_rect;
in vec4 a_bgColor;
in vec4 a_stripeColor;
in float a_stripeWidth;
in float a_angle;
uniform vec2 u_resolution;
uniform mat3 u_transform;
out vec2 v_local;
out vec4 v_bgColor;
out vec4 v_stripeColor;
out float v_stripeWidth;
out float v_angle;
void main() {
  vec2 unitUv = (a_unit + vec2(1.0)) * 0.5;
  vec2 position = a_rect.xy + unitUv * a_rect.zw;
  vec3 world = u_transform * vec3(position, 1.0);
  vec2 zeroToOne = world.xy / u_resolution;
  vec2 clipSpace = zeroToOne * 2.0 - 1.0;
  gl_Position = vec4(clipSpace.x, -clipSpace.y, 0.0, 1.0);
  v_local = unitUv * a_rect.zw;
  v_bgColor = a_bgColor;
  v_stripeColor = a_stripeColor;
  v_stripeWidth = a_stripeWidth;
  v_angle = a_angle;
}
`

const EARLY_STRIPE_BATCH_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec2 v_local;
in vec4 v_bgColor;
in vec4 v_stripeColor;
in float v_stripeWidth;
in float v_angle;
out vec4 outColor;
void main() {
  float c = cos(v_angle);
  float s = sin(v_angle);
  float axis = v_local.x * c + v_local.y * s;
  float period = max(1.0, v_stripeWidth * 2.0);
  float band = step(mod(axis, period), v_stripeWidth);
  outColor = mix(v_bgColor, v_stripeColor, band);
}
`

const PATTERN_RECT_VERTEX_SHADER = `#version 300 es
precision mediump float;
in vec2 a_unit;
uniform vec2 u_resolution;
uniform mat3 u_transform;
uniform vec4 u_rect;
out vec2 v_screen;
void main() {
  vec2 unitUv = (a_unit + vec2(1.0)) * 0.5;
  vec2 position = u_rect.xy + unitUv * u_rect.zw;
  vec3 world = u_transform * vec3(position, 1.0);
  vec2 zeroToOne = world.xy / u_resolution;
  vec2 clipSpace = zeroToOne * 2.0 - 1.0;
  gl_Position = vec4(clipSpace.x, -clipSpace.y, 0.0, 1.0);
  v_screen = world.xy;
}
`

const PATTERN_RECT_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec2 v_screen;
uniform vec2 u_origin;
uniform float u_worldStep;
uniform float u_scale;
uniform float u_minScreenStep;
uniform float u_dotSize;
uniform float u_shape;
uniform vec4 u_color;
out vec4 outColor;
void main() {
  float screenStep = max(0.001, u_worldStep * max(0.001, u_scale));
  float skip = max(1.0, ceil(u_minScreenStep / screenStep));
  float effectiveStep = screenStep * skip;
  vec2 cell = mod(v_screen - u_origin, effectiveStep);
  vec2 dotDistance = min(cell, effectiveStep - cell);
  float halfSize = max(0.25, u_dotSize * 0.5);
  float alpha = (1.0 - step(halfSize, dotDistance.x)) * (1.0 - step(halfSize, dotDistance.y));
  if (u_shape > 0.5) {
    alpha = 1.0 - step(halfSize, length(dotDistance));
  }
  if (alpha <= 0.0) discard;
  outColor = vec4(u_color.rgb, u_color.a * alpha);
}
`

/**
 * Описывает контракт RenderStats.
 */
interface RenderStats {
  drawCalls: number
  batches: number
  instances: number
  uploadBytes: number
  uploadMs: number
  bufferDataCalls: number
  bufferSubDataCalls: number
  schemaResidentBatchHits: number
  schemaResidentBatchMisses: number
  schemaResidentBatchUploads: number
  fullUploads: number
  dirtyRangeCount: number
  updatedHandles: number
  dirtyStreamRanges: number
  gpuBufferCapacityBytes: number
  textRasterMs: number
  textRasterCount: number
  textRasterPixels: number
  textRasterBytes: number
  textRasterBoxPixels: number
  textRasterSavedPixels: number
  textCacheHits: number
  textCacheMisses: number
  textRasterDeferred: number
  textAtlasPages: number
  effectiveTextRasterScale: number
  visibleTextRuns: number
  culledTextRuns: number
  glyphCacheHits: number
  glyphCacheMisses: number
  glyphRasterCount: number
  glyphAtlasPages: number
  glyphQuads: number
  msdfGlyphCount: number
  sdfGlyphCount: number
  distanceFieldGlyphQuads: number
  distanceFieldDrawCalls: number
  runtimeSdfGlyphCount: number
  prebuiltMsdfGlyphCount: number
  textRunCacheHits: number
  textRunCacheMisses: number
  textShapeMs: number
  glyphGeometryUploads: number
  textAtlasEvictions: number
  glyphAtlasEvictions: number
  pinnedAtlasPages: number
  interactionTextMode: 'stable-quality' | 'balanced' | 'performance'
  lodDroppedTextRuns: number
  textModeFallbacks: number
  textureBatchFallbacks: number
  textBucketChanges: number
  textBudgetExhausted: number
  visibleRectItems: number
  culledRectItems: number
  atlasUploads: number
  atlasMemoryMB: number
  renderTargetRepaints: number
  renderTargetDraws: number
  renderTargetAllocations: number
  renderTargetBytes: number
  renderTargetUploadMs: number
}

/**
 * Описывает metadata для shader-driven animation на schema item.
 */
interface NovaShaderAnimationMeta {
  type?: 'pulse-color'
  phase?: number
  speed?: number
  amplitude?: number
}

/**
 * Описывает metadata для shader-driven movement на schema item.
 */
interface NovaShaderMotionMeta {
  type?: 'wrap-x' | 'slayline'
  speed?: number
  wrapWidth?: number
}

/**
 * Описывает metadata, которую renderer читает без расширения публичного NovaSchema.
 */
interface NovaShaderRenderMeta {
  animation?: NovaShaderAnimationMeta
  motion?: NovaShaderMotionMeta
}

/**
 * Описывает нормализованные shader animation attributes.
 */
interface ResolvedShaderAnimation {
  phase: number
  speed: number
  amplitude: number
}

/**
 * Описывает нормализованные shader movement attributes.
 */
interface ResolvedShaderMotion {
  speed: number
  wrapWidth: number
}

const EMPTY_SHADER_ANIMATION: ResolvedShaderAnimation = Object.freeze({
  phase: 0,
  speed: 0,
  amplitude: 0,
})

const EMPTY_SHADER_MOTION: ResolvedShaderMotion = Object.freeze({
  speed: 0,
  wrapWidth: 0,
})

/**
 * Описывает контракт TextureEntry.
 */
interface TextureEntry {
  key: string
  texture: WebGLTexture
  width: number
  height: number
  bytes: number
  lastUsed: number
  generation: number
}

interface RenderTargetTextureEntry {
  targetId: string
  texture: TextureEntry
  framebuffer: WebGLFramebuffer
  width: number
  height: number
  pixelWidth: number
  pixelHeight: number
  dpr: number
}

/**
 * Описывает страницу atlas для rasterized text runs.
 */
interface TextAtlasPage {
  key: string
  texture: TextureEntry
  width: number
  height: number
  cursorX: number
  cursorY: number
  rowHeight: number
  entries: Set<string>
  lastUsed: number
  generation: number
  pinnedFrame: number
}

/**
 * Описывает entry rasterized text run внутри atlas page.
 */
interface TextAtlasEntry {
  key: string
  baseKey: string
  page: TextAtlasPage
  x: number
  y: number
  width: number
  height: number
  offsetX: number
  offsetY: number
  drawWidth: number
  drawHeight: number
  scale: number
  bytes: number
  lastUsed: number
}

/**
 * Описывает entry rasterized glyph внутри atlas page.
 */
interface GlyphAtlasEntry {
  key: string
  page: TextAtlasPage
  x: number
  y: number
  width: number
  height: number
  drawWidth: number
  drawHeight: number
  advance: number
  scale: number
  mode: 'glyph-atlas' | 'msdf'
  fieldSource: 'bitmap' | 'runtime-sdf' | 'prebuilt-msdf'
  pxRange: number
  bytes: number
  lastUsed: number
}

/**
 * Описывает результат rasterize glyph.
 */
interface RasterizedGlyph {
  canvas: HTMLCanvasElement
  width: number
  height: number
  drawWidth: number
  drawHeight: number
  advance: number
  scale: number
  fieldSource: 'bitmap' | 'runtime-sdf' | 'prebuilt-msdf'
  pxRange: number
}

/**
 * Описывает scale bucket state для конкретной роли/слоя текста.
 */
interface TextRasterBucketState {
  scale: number
  lastSwitchAt: number
}

/**
 * Описывает shaped text run для retained glyph pipeline.
 */
interface TextRunShape {
  key: string
  glyphs: Array<string>
  advances: Float32Array
  lineWidth: number
  sourceLineWidth: number
  lastUsed: number
}

/**
 * Описывает один glyph quad внутри retained glyph batch.
 */
interface GlyphTextQuad {
  texture: TextureEntry
  x: number
  y: number
  width: number
  height: number
  u0: number
  v0: number
  u1: number
  v1: number
  opacity: number
  color: NovaParsedColor
  pxRange: number
  fieldMode: number
}

/**
 * Описывает диапазон glyph quads одного source text внутри группы texture.
 */
interface GlyphTextLabelRange {
  start: number
  end: number
}

/**
 * Описывает retained группу glyph quads с одной atlas texture.
 */
interface GlyphTextStreamGroupCache {
  texture: TextureEntry
  textureGeneration: number
  geometryData: Float32Array
  staticData: Float32Array
  count: number
  mode: 'glyph-atlas' | 'msdf'
  labelRanges: Map<number, GlyphTextLabelRange>
  geometryDirtyRanges: Array<FloatDirtyRange> | null
  staticDirtyRanges: Array<FloatDirtyRange> | null
  geometryUpload: WebGLUploadState
  staticUpload: WebGLUploadState
  geometryBuffer: WebGLBuffer
  staticBuffer: WebGLBuffer
  vao: WebGLVertexArrayObject
}

/**
 * Описывает retained cache для glyph text batch.
 */
interface GlyphTextBatchCache {
  count: number
  revision?: number
  staticRevision?: number
  visibilityKey?: string
  mode: 'glyph-atlas' | 'msdf'
  incomplete?: boolean
  groups: Array<GlyphTextStreamGroupCache>
}

/**
 * Описывает контракт RasterizedText.
 */
interface RasterizedText {
  canvas: HTMLCanvasElement
  width: number
  height: number
  scale: number
  offsetX: number
  offsetY: number
  drawWidth: number
  drawHeight: number
  boxPixels: number
}

/**
 * Описывает контракт RectBatchCache.
 */
interface RectBatchCache {
  data: Float32Array
  instances: number
  itemOffsets: Array<number>
  signatures: Array<string>
  upload?: WebGLUploadState
  buffer?: WebGLBuffer
  vao?: WebGLVertexArrayObject
  contentVersion?: number
  visibilityKey?: string
}

/**
 * Описывает контракт TextureBatchCache.
 */
interface TextureBatchCache {
  data: Float32Array
  instances: number
  itemOffsets: Array<number>
  signatures: Array<string>
  texture: TextureEntry | null
  upload: WebGLUploadState
  contentVersion?: number
  rasterScale?: number
  visibilityKey?: string
  buffer?: WebGLBuffer
  vao?: WebGLVertexArrayObject
}

/**
 * Описывает culled texture batch item.
 */
interface CulledTextureBatchItem {
  culled: true
  signature: string
}

/**
 * Описывает контракт NonOverlapLayeredBatchCache.
 */
interface NonOverlapLayeredBatchCache {
  rects: Array<NovaSchemaItem<any>>
  icons: Array<NovaSchemaItem<any>>
  texts: Array<NovaSchemaItem<any>>
  rectIndexBySourceIndex: Array<number | undefined>
  iconIndexBySourceIndex: Array<number | undefined>
  textIndexBySourceIndex: Array<number | undefined>
  sourceKinds: Array<'rect' | 'icon' | 'text'>
}

/**
 * Описывает schema batch array with retained dirty metadata.
 */
interface SchemaBatchItems extends Array<NovaSchemaItem<any>> {
  dirtyIndices?: ReadonlyArray<number>
}

/**
 * Описывает контракт WebGLUploadState.
 */
interface WebGLUploadState {
  capacityBytes: number
  lastData?: Float32Array
  arena: NovaGpuBufferArena
}

/**
 * Описывает cache для instanced circle particle batch.
 */
interface ParticleCircleBatchCache {
  positionData: Float32Array
  staticData: Float32Array
  count: number
  revision?: number
  staticRevision?: number
  positionUpload: WebGLUploadState
  staticUpload: WebGLUploadState
  positionBuffer: WebGLBuffer
  staticBuffer: WebGLBuffer
  vao: WebGLVertexArrayObject
}

/**
 * Описывает cache для instanced sprite particle batch.
 */
interface ParticleSpriteBatchCache {
  positionData: Float32Array
  staticData: Float32Array
  count: number
  revision?: number
  staticRevision?: number
  texture?: TextureEntry
  positionUpload: WebGLUploadState
  staticUpload: WebGLUploadState
  positionBuffer: WebGLBuffer
  staticBuffer: WebGLBuffer
  vao: WebGLVertexArrayObject
}

/**
 * Описывает cache для instanced rect batch.
 */
interface RectStreamBatchCache {
  geometryData: Float32Array
  staticData: Float32Array
  count: number
  revision?: number
  staticRevision?: number
  geometryUpload: WebGLUploadState
  staticUpload: WebGLUploadState
  geometryBuffer: WebGLBuffer
  staticBuffer: WebGLBuffer
  vao: WebGLVertexArrayObject
}

/**
 * Описывает cache для GPU-resident time-range segment batch.
 */
interface TimeRangeSegmentBatchCache {
  geometryData: Float32Array
  staticData: Float32Array
  count: number
  revision?: number
  staticRevision?: number
  geometryUpload: WebGLUploadState
  staticUpload: WebGLUploadState
  geometryBuffer: WebGLBuffer
  staticBuffer: WebGLBuffer
  vao: WebGLVertexArrayObject
}

/**
 * Описывает группу instanced texture rects с одним WebGL texture.
 */
interface TextureRectStreamGroupCache {
  texture: TextureEntry
  indices: Uint32Array
  uvSource: number | Array<[number, number, number, number]>
  rectSource?: Array<NovaRect>
  geometryData: Float32Array
  staticData: Float32Array
  count: number
  revision?: number
  staticRevision?: number
  geometryUpload: WebGLUploadState
  staticUpload: WebGLUploadState
  geometryBuffer: WebGLBuffer
  staticBuffer: WebGLBuffer
  vao: WebGLVertexArrayObject
}

/**
 * Описывает cache retained texture rect batch.
 */
interface TextureRectStreamBatchCache {
  count: number
  revision?: number
  staticRevision?: number
  rasterScale?: number
  visibilityKey?: string
  incomplete?: boolean
  groups: Array<TextureRectStreamGroupCache>
}

/**
 * Описывает cache retained analytic stripe batch.
 */
interface StripeStreamBatchCache {
  geometryData: Float32Array
  staticData: Float32Array
  count: number
  revision?: number
  staticRevision?: number
  geometryUpload: WebGLUploadState
  staticUpload: WebGLUploadState
  geometryBuffer: WebGLBuffer
  staticBuffer: WebGLBuffer
  vao: WebGLVertexArrayObject
}

/**
 * Описывает контракт FloatDirtyRange.
 */
interface FloatDirtyRange {
  start: number
  end: number
}

/**
 * Создает web glupload state.
 */
function createWebGLUploadState(): WebGLUploadState {
  return {
    capacityBytes: 0,
    arena: new NovaGpuBufferArena(FULL_UPLOAD_DIRTY_RATIO),
  }
}

/**
 * Описывает контракт RectBatchUpdate.
 */
interface RectBatchUpdate {
  dirtyRanges: Array<FloatDirtyRange>
  changedItems: number
}

/**
 * Описывает контракт TextureBatchUpdate.
 */
interface TextureBatchUpdate {
  dirtyRanges: Array<FloatDirtyRange>
  changedItems: number
}

/**
 * Описывает контракт TextureBatchItem.
 */
interface TextureBatchItem {
  texture: TextureEntry
  signature: string
  x: number
  y: number
  width: number
  height: number
  opacity: number
  u0: number
  v0: number
  u1: number
  v1: number
}

/**
 * Описывает drawable item для text atlas.
 */
interface TextAtlasDrawableItem {
  key: string
  texture: TextureEntry
  offsetX: number
  offsetY: number
  width: number
  height: number
  u0: number
  v0: number
  u1: number
  v1: number
}

/**
 * Описывает layout результата измерения text run перед rasterize.
 */
interface TextRasterLayout {
  renderedText: string
  x: number
  y: number
  metrics: TextMetrics
  sourceLineWidth: number
  contentWidth: number
  contentHeight: number
}

const ROUNDED_RECT_VERTEX_SHADER = `#version 300 es
precision mediump float;
in vec2 a_position;
in vec2 a_local;
in vec2 a_size;
in float a_radius;
in vec4 a_fill;
in vec4 a_border;
in float a_borderWidth;
in vec3 a_animation;
in vec2 a_motion;
uniform vec2 u_resolution;
uniform mat3 u_transform;
uniform float u_time;
out vec2 v_local;
out vec2 v_size;
out float v_radius;
out vec4 v_fill;
out vec4 v_border;
out float v_borderWidth;
out vec3 v_animation;
void main() {
  vec2 position = a_position;
  if (a_motion.y > 0.0 && a_motion.x != 0.0) {
    float left = a_position.x - a_local.x;
    float movedLeft = mod(left - u_time * a_motion.x + a_motion.y, a_motion.y) - a_size.x;
    position.x = movedLeft + a_local.x;
  }
  vec3 world = u_transform * vec3(position, 1.0);
  vec2 zeroToOne = world.xy / u_resolution;
  vec2 clipSpace = zeroToOne * 2.0 - 1.0;
  gl_Position = vec4(clipSpace.x, -clipSpace.y, 0.0, 1.0);
  v_local = a_local;
  v_size = a_size;
  v_radius = a_radius;
  v_fill = a_fill;
  v_border = a_border;
  v_borderWidth = a_borderWidth;
  v_animation = a_animation;
}
`

const ROUNDED_RECT_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec2 v_local;
in vec2 v_size;
in float v_radius;
in vec4 v_fill;
in vec4 v_border;
in float v_borderWidth;
in vec3 v_animation;
uniform float u_time;
out vec4 outColor;
float sdRoundRect(vec2 p, vec2 halfSize, float radius) {
  vec2 q = abs(p - halfSize) - (halfSize - vec2(radius));
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}
void main() {
  float radius = min(v_radius, min(v_size.x, v_size.y) * 0.5);
  float dist = radius <= 0.0
    ? max(max(-v_local.x, v_local.x - v_size.x), max(-v_local.y, v_local.y - v_size.y))
    : sdRoundRect(v_local, v_size * 0.5, radius);
  float aa = max(fwidth(dist), 0.001);
  float shapeAlpha = 1.0 - smoothstep(-aa, aa, dist);
  float borderMask = 0.0;
  if (v_borderWidth > 0.0 && v_border.a > 0.0) {
    borderMask = smoothstep(-v_borderWidth - aa, -v_borderWidth + aa, dist);
  }
  vec4 color = mix(v_fill, v_border, borderMask);
  if (v_animation.z > 0.0) {
    float pulse = 0.5 + 0.5 * sin(u_time * v_animation.y + v_animation.x);
    color.rgb = mix(color.rgb, min(color.rgb * 1.35 + vec3(0.08), vec3(1.0)), pulse * v_animation.z);
  }
  outColor = vec4(color.rgb, color.a * shapeAlpha);
}
`

const SOLID_VERTEX_SHADER = `#version 300 es
precision mediump float;
in vec2 a_position;
in vec4 a_color;
in vec3 a_animation;
uniform vec2 u_resolution;
uniform mat3 u_transform;
uniform float u_time;
out vec4 v_color;
out vec3 v_animation;
void main() {
  vec3 world = u_transform * vec3(a_position, 1.0);
  vec2 zeroToOne = world.xy / u_resolution;
  vec2 clipSpace = zeroToOne * 2.0 - 1.0;
  gl_Position = vec4(clipSpace.x, -clipSpace.y, 0.0, 1.0);
  v_color = a_color;
  v_animation = a_animation;
}
`

const SOLID_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec4 v_color;
in vec3 v_animation;
uniform float u_time;
out vec4 outColor;
void main() {
  vec4 color = v_color;
  if (v_animation.z > 0.0) {
    float pulse = 0.5 + 0.5 * sin(u_time * v_animation.y + v_animation.x);
    color.rgb = mix(color.rgb, min(color.rgb * 1.35 + vec3(0.08), vec3(1.0)), pulse * v_animation.z);
  }
  outColor = color;
}
`

const TEXTURE_VERTEX_SHADER = `#version 300 es
in vec2 a_position;
in vec2 a_uv;
in vec4 a_color;
uniform vec2 u_resolution;
uniform mat3 u_transform;
out vec2 v_uv;
out vec4 v_color;
void main() {
  vec3 world = u_transform * vec3(a_position, 1.0);
  vec2 zeroToOne = world.xy / u_resolution;
  vec2 clipSpace = zeroToOne * 2.0 - 1.0;
  gl_Position = vec4(clipSpace.x, -clipSpace.y, 0.0, 1.0);
  v_uv = a_uv;
  v_color = a_color;
}
`

const TEXTURE_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
uniform sampler2D u_texture;
in vec2 v_uv;
in vec4 v_color;
out vec4 outColor;
void main() {
  outColor = texture(u_texture, v_uv) * v_color;
}
`

const DISTANCE_FIELD_TEXT_VERTEX_SHADER = `#version 300 es
precision mediump float;
in vec2 a_position;
in vec2 a_uv;
in vec4 a_color;
in vec2 a_sdfParams;
in vec2 a_unit;
in vec4 a_rect;
in vec4 a_uvRect;
in float a_opacity;
in vec4 a_glyphColor;
in vec2 a_sdfInstanceParams;
uniform vec2 u_resolution;
uniform mat3 u_transform;
uniform int u_instanced;
out vec2 v_uv;
out vec4 v_color;
out vec2 v_sdfParams;
void main() {
  vec2 position = a_position;
  vec2 uv = a_uv;
  vec4 color = a_color;
  vec2 sdfParams = a_sdfParams;
  if (u_instanced == 1) {
    vec2 unitUv = (a_unit + vec2(1.0)) * 0.5;
    position = a_rect.xy + unitUv * a_rect.zw;
    uv = mix(a_uvRect.xy, a_uvRect.zw, unitUv);
    color = vec4(a_glyphColor.rgb, a_glyphColor.a * a_opacity);
    sdfParams = a_sdfInstanceParams;
  }
  vec3 world = u_transform * vec3(position, 1.0);
  vec2 zeroToOne = world.xy / u_resolution;
  vec2 clipSpace = zeroToOne * 2.0 - 1.0;
  gl_Position = vec4(clipSpace.x, -clipSpace.y, 0.0, 1.0);
  v_uv = uv;
  v_color = color;
  v_sdfParams = sdfParams;
}
`

const DISTANCE_FIELD_TEXT_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
uniform sampler2D u_texture;
uniform float u_edgeSoftness;
in vec2 v_uv;
in vec4 v_color;
in vec2 v_sdfParams;
out vec4 outColor;

float median3(float r, float g, float b) {
  return max(min(r, g), min(max(r, g), b));
}

float screenPxRange(float pxRange) {
  vec2 textureSizePx = vec2(textureSize(u_texture, 0));
  vec2 unitRange = vec2(pxRange) / max(textureSizePx, vec2(1.0));
  vec2 screenTexSize = vec2(1.0) / max(fwidth(v_uv), vec2(0.000001));
  return max(0.5 * dot(unitRange, screenTexSize), 1.0);
}

void main() {
  vec4 sampleColor = texture(u_texture, v_uv);
  float signedDistance = v_sdfParams.y > 0.5
    ? median3(sampleColor.r, sampleColor.g, sampleColor.b)
    : sampleColor.a;
  float range = screenPxRange(max(v_sdfParams.x, 1.0)) / max(u_edgeSoftness, 0.1);
  float alpha = clamp(range * (signedDistance - 0.5) + 0.5, 0.0, 1.0);
  outColor = vec4(v_color.rgb, v_color.a * alpha);
}
`

const PARTICLE_CIRCLE_VERTEX_SHADER = `#version 300 es
precision mediump float;
in vec2 a_unit;
in vec2 a_center;
in float a_radius;
in vec4 a_fill;
in vec4 a_stroke;
in float a_strokeWidth;
uniform vec2 u_resolution;
uniform mat3 u_transform;
out vec2 v_local;
out float v_radius;
out vec4 v_fill;
out vec4 v_stroke;
out float v_strokeWidth;
void main() {
  vec2 local = a_unit * a_radius;
  vec2 position = a_center + local;
  vec3 world = u_transform * vec3(position, 1.0);
  vec2 zeroToOne = world.xy / u_resolution;
  vec2 clipSpace = zeroToOne * 2.0 - 1.0;
  gl_Position = vec4(clipSpace.x, -clipSpace.y, 0.0, 1.0);
  v_local = local;
  v_radius = a_radius;
  v_fill = a_fill;
  v_stroke = a_stroke;
  v_strokeWidth = a_strokeWidth;
}
`

const PARTICLE_CIRCLE_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec2 v_local;
in float v_radius;
in vec4 v_fill;
in vec4 v_stroke;
in float v_strokeWidth;
out vec4 outColor;
void main() {
  float dist = length(v_local) - v_radius;
  float aa = max(fwidth(dist), 0.001);
  float shapeAlpha = 1.0 - smoothstep(-aa, aa, dist);
  float inner = v_strokeWidth > 0.0
    ? 1.0 - smoothstep(-v_strokeWidth - aa, -v_strokeWidth + aa, dist)
    : 1.0;
  float strokeMask = clamp(1.0 - inner, 0.0, 1.0);
  vec4 color = mix(v_fill, v_stroke, strokeMask);
  outColor = vec4(color.rgb, color.a * shapeAlpha);
}
`

const PARTICLE_SPRITE_VERTEX_SHADER = `#version 300 es
precision mediump float;
in vec2 a_unit;
in vec2 a_position;
in float a_size;
in float a_opacity;
uniform vec2 u_resolution;
uniform mat3 u_transform;
out vec2 v_uv;
out float v_opacity;
void main() {
  vec2 uv = (a_unit + vec2(1.0)) * 0.5;
  vec2 position = a_position + uv * a_size;
  vec3 world = u_transform * vec3(position, 1.0);
  vec2 zeroToOne = world.xy / u_resolution;
  vec2 clipSpace = zeroToOne * 2.0 - 1.0;
  gl_Position = vec4(clipSpace.x, -clipSpace.y, 0.0, 1.0);
  v_uv = uv;
  v_opacity = a_opacity;
}
`

const PARTICLE_SPRITE_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
uniform sampler2D u_texture;
in vec2 v_uv;
in float v_opacity;
out vec4 outColor;
void main() {
  outColor = texture(u_texture, v_uv) * vec4(1.0, 1.0, 1.0, v_opacity);
}
`

const RECT_BATCH_VERTEX_SHADER = `#version 300 es
precision mediump float;
in vec2 a_unit;
in vec4 a_rect;
in vec4 a_color;
in float a_state;
in float a_radius;
uniform vec2 u_resolution;
uniform mat3 u_transform;
out vec4 v_color;
out vec2 v_local;
out vec2 v_size;
flat out float v_radius;
flat out float v_state;
void main() {
  vec2 uv = (a_unit + vec2(1.0)) * 0.5;
  vec2 position = a_rect.xy + uv * a_rect.zw;
  vec3 world = u_transform * vec3(position, 1.0);
  vec2 zeroToOne = world.xy / u_resolution;
  vec2 clipSpace = zeroToOne * 2.0 - 1.0;
  gl_Position = vec4(clipSpace.x, -clipSpace.y, 0.0, 1.0);
  v_color = a_color;
  v_local = uv * a_rect.zw;
  v_size = a_rect.zw;
  v_radius = a_radius;
  v_state = a_state;
}
`

const RECT_BATCH_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec4 v_color;
in vec2 v_local;
in vec2 v_size;
flat in float v_radius;
flat in float v_state;
out vec4 outColor;
float sdRoundRect(vec2 p, vec2 halfSize, float radius) {
  vec2 q = abs(p - halfSize) - (halfSize - vec2(radius));
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}
void main() {
  vec4 color = v_color;
  if (v_state > 0.5) {
    color.rgb = min(color.rgb * 1.08 + vec3(0.03), vec3(1.0));
  }
  float radius = min(v_radius, min(v_size.x, v_size.y) * 0.5);
  if (radius > 0.0) {
    float dist = sdRoundRect(v_local, v_size * 0.5, radius);
    float aa = max(fwidth(dist), 0.001);
    color.a *= 1.0 - smoothstep(-aa, aa, dist);
  }
  outColor = color;
}
`

const TIME_RANGE_SEGMENT_VERTEX_SHADER = `#version 300 es
precision highp float;
in vec2 a_unit;
in vec4 a_timeRect;
in vec4 a_color;
in vec4 a_style;
uniform vec2 u_resolution;
uniform mat3 u_transform;
uniform float u_timeStart;
uniform float u_pxPerMs;
uniform float u_viewportX;
uniform float u_yOffset;
out vec4 v_color;
out vec4 v_style;
out vec2 v_uv;
out vec2 v_size;
void main() {
  vec2 uv = (a_unit + vec2(1.0)) * 0.5;
  float x = u_viewportX + (a_timeRect.x - u_timeStart) * u_pxPerMs;
  float width = max(1.0, (a_timeRect.y - a_timeRect.x) * u_pxPerMs);
  float y = a_timeRect.z + u_yOffset;
  vec2 position = vec2(x, y) + uv * vec2(width, a_timeRect.w);
  vec3 world = u_transform * vec3(position, 1.0);
  vec2 zeroToOne = world.xy / u_resolution;
  vec2 clipSpace = zeroToOne * 2.0 - 1.0;
  gl_Position = vec4(clipSpace.x, -clipSpace.y, 0.0, 1.0);
  v_color = a_color;
  v_style = a_style;
  v_uv = uv;
  v_size = vec2(width, a_timeRect.w);
}
`

const TIME_RANGE_SEGMENT_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec4 v_color;
in vec4 v_style;
in vec2 v_uv;
in vec2 v_size;
out vec4 outColor;

float box(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return 1.0 - smoothstep(0.0, 1.0, length(max(d, 0.0)) + min(max(d.x, d.y), 0.0));
}

vec4 iconColor(float iconType) {
  if (iconType < 1.5) return vec4(0.17, 0.24, 0.39, 0.92);
  if (iconType < 2.5) return vec4(0.15, 0.39, 0.92, 0.92);
  if (iconType < 3.5) return vec4(0.58, 0.20, 0.92, 0.92);
  return vec4(0.02, 0.47, 0.34, 0.92);
}

void main() {
  vec4 color = v_color;
  vec2 local = v_uv * v_size;

  if (v_style.x > 0.5) {
    float stripe = mod(gl_FragCoord.x + gl_FragCoord.y, 8.0);
    float alpha = 1.0 - smoothstep(2.6, 3.4, stripe);
    color = mix(color, vec4(0.56, 0.72, 0.91, color.a), alpha * 0.72);
  }

  if (v_style.y > 0.5 && v_size.x >= 28.0) {
    vec2 center = vec2(v_size.x - 10.0, v_size.y * 0.5);
    vec2 p = local - center;
    vec4 icon = iconColor(v_style.y);
    float mark = 0.0;

    if (v_style.y < 1.5) {
      float tri = max(abs(p.x) * 0.85 + p.y * 0.55, -p.y - 5.2);
      mark = 1.0 - smoothstep(4.6, 5.6, tri);
      mark *= step(-4.5, p.y);
    } else if (v_style.y < 2.5) {
      float ring = 1.0 - smoothstep(4.8, 5.8, abs(length(p) - 5.2));
      float handA = box(p - vec2(0.0, -1.8), vec2(0.8, 3.0));
      float handB = box(p - vec2(2.2, 1.0), vec2(2.6, 0.7));
      mark = max(ring, max(handA, handB));
    } else if (v_style.y < 3.5) {
      mark = max(box(p + vec2(1.8, -1.8), vec2(1.2, 5.2)), box(p - vec2(1.8, 1.8), vec2(5.2, 1.2)));
    } else {
      float nodeA = 1.0 - smoothstep(2.4, 3.2, length(p + vec2(4.0, 2.8)));
      float nodeB = 1.0 - smoothstep(2.4, 3.2, length(p - vec2(4.0, 2.8)));
      float line = box(p, vec2(5.0, 0.8));
      mark = max(line, max(nodeA, nodeB));
    }

    color = mix(color, icon, clamp(mark, 0.0, 1.0));
  }

  if (v_style.z > 0.5 && v_size.x >= 64.0) {
    float left = 8.0;
    float right = v_size.x - (v_style.y > 0.5 ? 24.0 : 8.0);
    float inLabel = step(left, local.x) * step(local.x, right) * step(4.0, local.y) * step(local.y, v_size.y - 4.0);
    float seed = fract(v_style.w * 0.013 + floor((local.x - left) / 4.0) * 0.173);
    float stroke = step(0.62, seed) * step(fract(local.x / 4.0), 0.42) * step(abs(local.y - v_size.y * 0.5), 4.2);
    color = mix(color, vec4(0.07, 0.09, 0.15, color.a), inLabel * stroke * 0.82);
  }

  outColor = color;
}
`

const TEXTURE_RECT_BATCH_VERTEX_SHADER = `#version 300 es
precision mediump float;
in vec2 a_unit;
in vec4 a_rect;
in vec4 a_uvRect;
in float a_opacity;
uniform vec2 u_resolution;
uniform mat3 u_transform;
out vec2 v_uv;
out float v_opacity;
void main() {
  vec2 unitUv = (a_unit + vec2(1.0)) * 0.5;
  vec2 position = a_rect.xy + unitUv * a_rect.zw;
  vec3 world = u_transform * vec3(position, 1.0);
  vec2 zeroToOne = world.xy / u_resolution;
  vec2 clipSpace = zeroToOne * 2.0 - 1.0;
  gl_Position = vec4(clipSpace.x, -clipSpace.y, 0.0, 1.0);
  v_uv = mix(a_uvRect.xy, a_uvRect.zw, unitUv);
  v_opacity = a_opacity;
}
`

const TEXTURE_RECT_BATCH_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
uniform sampler2D u_texture;
in vec2 v_uv;
in float v_opacity;
out vec4 outColor;
void main() {
  outColor = texture(u_texture, v_uv) * vec4(1.0, 1.0, 1.0, v_opacity);
}
`

/**
 * Преобразует Nova render frame в WebGL draw calls и GPU uploads.
 */
export class NovaWebGLFrameRenderer {
  private readonly _gl: WebGL2RenderingContext
  private readonly _roundedProgram: NovaWebGLProgram
  private readonly _solidProgram: NovaWebGLProgram
  private readonly _textureProgram: NovaWebGLProgram
  private readonly _distanceFieldTextProgram: NovaWebGLProgram
  private readonly _particleCircleProgram: NovaWebGLProgram
  private readonly _particleSpriteProgram: NovaWebGLProgram
  private readonly _rectBatchProgram: NovaWebGLProgram
  private readonly _timeRangeSegmentProgram: NovaWebGLProgram
  private readonly _textureRectBatchProgram: NovaWebGLProgram
  private readonly _stripeBatchProgram: NovaWebGLProgram
  private readonly _patternRectProgram: NovaWebGLProgram
  private readonly _roundedBuffer: WebGLBuffer
  private readonly _solidBuffer: WebGLBuffer
  private readonly _textureBuffer: WebGLBuffer
  private readonly _distanceFieldBuffer: WebGLBuffer
  private readonly _particleQuadBuffer: WebGLBuffer
  private readonly _roundedVao: WebGLVertexArrayObject
  private readonly _solidVao: WebGLVertexArrayObject
  private readonly _textureVao: WebGLVertexArrayObject
  private readonly _distanceFieldVao: WebGLVertexArrayObject
  private readonly _patternRectVao: WebGLVertexArrayObject
  private readonly _measureCanvas = document.createElement('canvas')
  private readonly _textRasterCanvas = document.createElement('canvas')
  private readonly _textures = new Map<string, TextureEntry>()
  private readonly _renderTargets = new Map<string, RenderTargetTextureEntry>()
  private readonly _textAtlasPages: Array<TextAtlasPage> = []
  private readonly _textAtlasEntries = new Map<string, TextAtlasEntry>()
  private readonly _textFallbackKeys = new Map<string, string>()
  private readonly _glyphAtlasPages: Array<TextAtlasPage> = []
  private readonly _glyphAtlasEntries = new Map<string, GlyphAtlasEntry>()
  private readonly _prebuiltMsdfAtlasPages = new Map<string, TextAtlasPage>()
  private readonly _sourceTextureKeys = new WeakMap<object, string>()
  private readonly _plainRectBatchCache = new WeakMap<Array<NovaSchemaItem<any>>, RectBatchCache>()
  private readonly _rectBatchCache = new WeakMap<Array<NovaSchemaItem<any>>, RectBatchCache>()
  private readonly _textureBatchCache = new WeakMap<Array<NovaSchemaItem<any>>, TextureBatchCache>()
  private readonly _semanticBatchCache = new WeakMap<Array<NovaSchemaItem<any>>, NonOverlapLayeredBatchCache>()
  private readonly _particleCircleBatchCache = new WeakMap<NovaParticleBatch, ParticleCircleBatchCache>()
  private readonly _particleSpriteBatchCache = new WeakMap<NovaParticleBatch, ParticleSpriteBatchCache>()
  private readonly _rectStreamBatchCache = new WeakMap<NovaRectBatch, RectStreamBatchCache>()
  private readonly _timeRangeSegmentBatchCache = new WeakMap<NovaTimeRangeSegmentBatch, TimeRangeSegmentBatchCache>()
  private readonly _iconStreamBatchCache = new WeakMap<NovaIconBatch, TextureRectStreamBatchCache>()
  private readonly _textStreamBatchCache = new WeakMap<NovaTextBatch, TextureRectStreamBatchCache>()
  private readonly _stripeStreamBatchCache = new WeakMap<NovaStripeRectBatch, StripeStreamBatchCache>()
  private readonly _ownedRectSchemaBatchCaches = new Set<RectBatchCache>()
  private readonly _ownedTextureBatchCaches = new Set<TextureBatchCache>()
  private readonly _ownedParticleCircleBatchCaches = new Set<ParticleCircleBatchCache>()
  private readonly _ownedParticleSpriteBatchCaches = new Set<ParticleSpriteBatchCache>()
  private readonly _ownedRectStreamBatchCaches = new Set<RectStreamBatchCache>()
  private readonly _ownedTimeRangeSegmentBatchCaches = new Set<TimeRangeSegmentBatchCache>()
  private readonly _ownedTextureRectStreamGroupCaches = new Set<TextureRectStreamGroupCache>()
  private readonly _ownedGlyphTextStreamGroupCaches = new Set<GlyphTextStreamGroupCache>()
  private readonly _ownedStripeStreamBatchCaches = new Set<StripeStreamBatchCache>()
  private readonly _roundedUpload: WebGLUploadState = createWebGLUploadState()
  private readonly _solidUpload: WebGLUploadState = createWebGLUploadState()
  private readonly _textureUpload: WebGLUploadState = createWebGLUploadState()
  private readonly _distanceFieldUpload: WebGLUploadState = createWebGLUploadState()

  private _rectData: Array<number> = []
  private _rectCachedData: Float32Array | null = null
  private _rectCachedDirtyRanges: Array<FloatDirtyRange> | null = null
  private _solidData: Array<number> = []
  private _solidCachedData: Float32Array | null = null
  private _solidCachedDirtyRanges: Array<FloatDirtyRange> | null = null
  private _textureData: Array<number> = []
  private _textureBatch: TextureEntry | null = null
  private _distanceFieldData: Array<number> = []
  private _distanceFieldBatch: TextureEntry | null = null
  private _textureCachedData: Float32Array | null = null
  private _textureCachedDirtyRanges: Array<FloatDirtyRange> | null = null
  private _textureCachedBatch: TextureBatchCache | null = null
  private _roundedTransform = mat3.create()
  private _solidTransform = mat3.create()
  private _textureTransform = mat3.create()
  private _distanceFieldTransform = mat3.create()
  private _time = 0
  private _viewportWidth = 1
  private _viewportHeight = 1
  private _renderResolutionWidth = 1
  private _renderResolutionHeight = 1
  private _activeRenderTarget: RenderTargetTextureEntry | null = null
  private readonly _renderTargetStack: Array<RenderTargetTextureEntry | null> = []
  private _atlasGeneration = 0
  private _textAtlasEvictionCount = 0
  private _glyphAtlasEvictionCount = 0
  private readonly _textRasterBucketStateByScope = new Map<string, TextRasterBucketState>()
  private readonly _textRunShapeCache = new Map<string, TextRunShape>()
  private readonly _glyphTextBatchCache = new WeakMap<NovaTextBatch, GlyphTextBatchCache>()

  /**
   * Создает instance и подготавливает внутреннее состояние.
   */
  constructor(
    private readonly _device: NovaWebGLDevice,
    private readonly _textConfig: NovaRendererTextConfig = DEFAULT_NOVA_RENDERER_CONFIG.text,
    private readonly _assets: NovaAssetRegistry = NovaAssets.global,
  ) {
    this._gl = _device.gl
    this._roundedProgram = NovaWebGLProgram.create(this._gl, ROUNDED_RECT_VERTEX_SHADER, ROUNDED_RECT_FRAGMENT_SHADER)
    this._solidProgram = NovaWebGLProgram.create(this._gl, SOLID_VERTEX_SHADER, SOLID_FRAGMENT_SHADER)
    this._textureProgram = NovaWebGLProgram.create(this._gl, TEXTURE_VERTEX_SHADER, TEXTURE_FRAGMENT_SHADER)
    this._distanceFieldTextProgram = NovaWebGLProgram.create(this._gl, DISTANCE_FIELD_TEXT_VERTEX_SHADER, DISTANCE_FIELD_TEXT_FRAGMENT_SHADER)
    this._particleCircleProgram = NovaWebGLProgram.create(this._gl, PARTICLE_CIRCLE_VERTEX_SHADER, PARTICLE_CIRCLE_FRAGMENT_SHADER)
    this._particleSpriteProgram = NovaWebGLProgram.create(this._gl, PARTICLE_SPRITE_VERTEX_SHADER, PARTICLE_SPRITE_FRAGMENT_SHADER)
    this._rectBatchProgram = NovaWebGLProgram.create(this._gl, RECT_BATCH_VERTEX_SHADER, RECT_BATCH_FRAGMENT_SHADER)
    this._timeRangeSegmentProgram = NovaWebGLProgram.create(this._gl, TIME_RANGE_SEGMENT_VERTEX_SHADER, TIME_RANGE_SEGMENT_FRAGMENT_SHADER)
    this._textureRectBatchProgram = NovaWebGLProgram.create(this._gl, TEXTURE_RECT_BATCH_VERTEX_SHADER, TEXTURE_RECT_BATCH_FRAGMENT_SHADER)
    this._stripeBatchProgram = NovaWebGLProgram.create(this._gl, EARLY_STRIPE_BATCH_VERTEX_SHADER, EARLY_STRIPE_BATCH_FRAGMENT_SHADER)
    this._patternRectProgram = NovaWebGLProgram.create(this._gl, PATTERN_RECT_VERTEX_SHADER, PATTERN_RECT_FRAGMENT_SHADER)
    this._roundedBuffer = this._createBuffer()
    this._solidBuffer = this._createBuffer()
    this._textureBuffer = this._createBuffer()
    this._distanceFieldBuffer = this._createBuffer()
    this._particleQuadBuffer = this._createBuffer()
    this._initializeParticleQuadBuffer()
    this._roundedVao = this._createRoundedVao()
    this._solidVao = this._createSolidVao()
    this._textureVao = this._createTextureVao()
    this._distanceFieldVao = this._createDistanceFieldVao()
    this._patternRectVao = this._createPatternRectVao()
  }

  /**
   * Выполняет render-операцию .
   */
  render(frame: NovaRenderFrame): NovaRenderMetrics {
    const startedAt = performance.now()
    const textAtlasEvictionsAtStart = this._textAtlasEvictionCount
    const glyphAtlasEvictionsAtStart = this._glyphAtlasEvictionCount
    const stats: RenderStats = {
      drawCalls: 0,
      batches: 0,
      instances: 0,
      uploadBytes: 0,
      uploadMs: 0,
      bufferDataCalls: 0,
      bufferSubDataCalls: 0,
      schemaResidentBatchHits: 0,
      schemaResidentBatchMisses: 0,
      schemaResidentBatchUploads: 0,
      fullUploads: 0,
      dirtyRangeCount: 0,
      updatedHandles: 0,
      dirtyStreamRanges: 0,
      gpuBufferCapacityBytes: 0,
      textRasterMs: 0,
      textRasterCount: 0,
      textRasterPixels: 0,
      textRasterBytes: 0,
      textRasterBoxPixels: 0,
      textRasterSavedPixels: 0,
      textCacheHits: 0,
      textCacheMisses: 0,
      textRasterDeferred: 0,
      textAtlasPages: this._textAtlasPages.length,
      effectiveTextRasterScale: 0,
      visibleTextRuns: 0,
      culledTextRuns: 0,
      glyphCacheHits: 0,
      glyphCacheMisses: 0,
      glyphRasterCount: 0,
      glyphAtlasPages: this._glyphAtlasPages.length,
      glyphQuads: 0,
      msdfGlyphCount: 0,
      sdfGlyphCount: 0,
      distanceFieldGlyphQuads: 0,
      distanceFieldDrawCalls: 0,
      runtimeSdfGlyphCount: 0,
      prebuiltMsdfGlyphCount: 0,
      textRunCacheHits: 0,
      textRunCacheMisses: 0,
      textShapeMs: 0,
      glyphGeometryUploads: 0,
      textAtlasEvictions: 0,
      glyphAtlasEvictions: 0,
      pinnedAtlasPages: 0,
      interactionTextMode: this._textConfig.interaction.mode,
      lodDroppedTextRuns: 0,
      textModeFallbacks: 0,
      textureBatchFallbacks: 0,
      textBucketChanges: 0,
      textBudgetExhausted: 0,
      visibleRectItems: 0,
      culledRectItems: 0,
      atlasUploads: 0,
      atlasMemoryMB: this._textureMemoryMB(),
      renderTargetRepaints: 0,
      renderTargetDraws: 0,
      renderTargetAllocations: 0,
      renderTargetBytes: 0,
      renderTargetUploadMs: 0,
    }
    const itemMap = frame.items.length > 0 ? new Map(frame.items.map(item => [item.id, item])) : null
    const identity = mat3.create()
    let currentTransform = identity
    const transformStack: Array<mat3> = []
    const clipStack: Array<NovaRenderClip> = []

    this._time += 1
    this._viewportWidth = Math.max(1, frame.viewport.width)
    this._viewportHeight = Math.max(1, frame.viewport.height)
    this._device.resize()
    this._renderResolutionWidth = this._device.canvas.width
    this._renderResolutionHeight = this._device.canvas.height
    this._activeRenderTarget = null
    this._renderTargetStack.length = 0
    this._setScissor(null, currentTransform)

    const pushClip = (clip: NovaRenderClip | null | undefined, transform: mat3): void => {
      if (!clip) {
        return
      }
      this._flush(stats)
      clipStack.push(clip)
      this._setScissor(clip, transform)
    }

    const popClip = (transform: mat3): void => {
      if (clipStack.length === 0) {
        return
      }
      this._flush(stats)
      clipStack.pop()
      this._setScissor(clipStack[clipStack.length - 1] ?? null, transform)
    }

    const drawSchemaItem = (item: NovaSchemaItem<any>, transform: mat3): void => {
      if (item.active === false) {
        return
      }
      if (item.clip !== undefined && item.clip !== true) {
        pushClip(item.clip, transform)
      }
      this._drawPrimitive(item, transform, stats)
      if (item.clip !== undefined && item.clip !== true) {
        popClip(transform)
      }
    }

    for (const command of frame.commands) {
      switch (command.type) {
        case 'clear':
          this._flush(stats)
          this._device.clear()
          break
        case 'save':
          transformStack.push(mat3.clone(currentTransform))
          break
        case 'restore':
          currentTransform = transformStack.pop() ?? identity
          break
        case 'setTransform':
          currentTransform = command.transform ? (command.transform as mat3) : identity
          break
        case 'clip':
          pushClip(command.clip, currentTransform)
          break
        case 'clearClip':
          popClip(currentTransform)
          break
        case 'beginRenderTarget':
          if (command.target) {
            this._beginRenderTarget(command.target, stats)
          }
          break
        case 'endRenderTarget':
          this._endRenderTarget(stats)
          this._setScissor(clipStack[clipStack.length - 1] ?? null, currentTransform)
          break
        case 'drawRenderTarget':
          if (command.targetId && command.x !== undefined && command.y !== undefined && command.width !== undefined && command.height !== undefined) {
            this._drawRenderTarget(command.targetId, command.x, command.y, command.width, command.height, currentTransform, stats)
          }
          break
        case 'drawItem': {
          const item = command.itemId ? itemMap?.get(command.itemId) : undefined
          if (item?.schemaItem) {
            this._drawRenderItem(item, stats)
          }
          break
        }
        case 'drawSchemaBatch':
          if (!this._drawSchemaBatch(
            command.schemaItems ?? [],
            currentTransform,
            stats,
            command.schemaSemanticScope,
            this._resolveSchemaContentVersion(command.schemaItems, command.schemaContentVersion),
          )) {
            for (const schemaItem of command.schemaItems ?? []) {
              drawSchemaItem(schemaItem, currentTransform)
            }
          }
          break
        case 'drawParticles':
          if (command.particleBatch) {
            this._drawParticleBatch(command.particleBatch, currentTransform, stats)
          }
          break
        case 'drawRectBatch':
          if (command.rectBatch) {
            this._drawRectBatch(command.rectBatch, currentTransform, stats)
          }
          break
        case 'drawTimeRangeSegmentBatch':
          if (command.timeRangeSegmentBatch) {
            this._drawTimeRangeSegmentBatch(command.timeRangeSegmentBatch, currentTransform, stats)
          }
          break
        case 'drawStripeBatch':
          if (command.stripeBatch) {
            this._drawStripeBatch(command.stripeBatch, currentTransform, stats)
          }
          break
        case 'drawIconBatch':
          if (command.iconBatch) {
            this._drawIconBatch(command.iconBatch, currentTransform, stats)
          }
          break
        case 'drawTextBatch':
          if (command.textBatch) {
            this._drawTextBatch(command.textBatch, currentTransform, stats)
          }
          break
        case 'cursor':
        case 'beginGroup':
        case 'endGroup':
        default:
          break
      }
    }

    this._flush(stats)
    this._setScissor(null, identity)
    stats.textAtlasEvictions = this._textAtlasEvictionCount - textAtlasEvictionsAtStart
    stats.glyphAtlasEvictions = this._glyphAtlasEvictionCount - glyphAtlasEvictionsAtStart
    stats.pinnedAtlasPages = this._countPinnedAtlasPages()
    const backendMs = performance.now() - startedAt

    return {
      ...frame.metrics,
      backendMs,
      drawMs: Math.max(0, backendMs - stats.uploadMs - stats.textRasterMs),
      drawCalls: stats.drawCalls,
      batches: stats.batches,
      instances: stats.instances,
      uploadBytes: stats.uploadBytes,
      bufferDataCalls: stats.bufferDataCalls,
      bufferSubDataCalls: stats.bufferSubDataCalls,
      schemaResidentBatchHits: stats.schemaResidentBatchHits,
      schemaResidentBatchMisses: stats.schemaResidentBatchMisses,
      schemaResidentBatchUploads: stats.schemaResidentBatchUploads,
      fullUploads: stats.fullUploads,
      dirtyRangeCount: stats.dirtyRangeCount,
      gpuBufferCapacityBytes: stats.gpuBufferCapacityBytes,
      updatedHandles: stats.updatedHandles,
      dirtyStreamRanges: stats.dirtyStreamRanges,
      uploadMs: stats.uploadMs,
      textRasterMs: stats.textRasterMs,
      textRasterCount: stats.textRasterCount,
      textRasterPixels: stats.textRasterPixels,
      textRasterBytes: stats.textRasterBytes,
      textRasterBoxPixels: stats.textRasterBoxPixels,
      textRasterSavedPixels: stats.textRasterSavedPixels,
      textCacheHits: stats.textCacheHits,
      textCacheMisses: stats.textCacheMisses,
      textRasterDeferred: stats.textRasterDeferred,
      textAtlasPages: this._textAtlasPages.length,
      effectiveTextRasterScale: stats.effectiveTextRasterScale,
      visibleTextRuns: stats.visibleTextRuns,
      culledTextRuns: stats.culledTextRuns,
      glyphCacheHits: stats.glyphCacheHits,
      glyphCacheMisses: stats.glyphCacheMisses,
      glyphRasterCount: stats.glyphRasterCount,
      glyphAtlasPages: this._glyphAtlasPages.length,
      glyphQuads: stats.glyphQuads,
      msdfGlyphCount: stats.msdfGlyphCount,
      sdfGlyphCount: stats.sdfGlyphCount,
      distanceFieldGlyphQuads: stats.distanceFieldGlyphQuads,
      distanceFieldDrawCalls: stats.distanceFieldDrawCalls,
      runtimeSdfGlyphCount: stats.runtimeSdfGlyphCount,
      prebuiltMsdfGlyphCount: stats.prebuiltMsdfGlyphCount,
      textRunCacheHits: stats.textRunCacheHits,
      textRunCacheMisses: stats.textRunCacheMisses,
      textShapeMs: stats.textShapeMs,
      glyphGeometryUploads: stats.glyphGeometryUploads,
      textAtlasEvictions: stats.textAtlasEvictions,
      glyphAtlasEvictions: stats.glyphAtlasEvictions,
      pinnedAtlasPages: stats.pinnedAtlasPages,
      interactionTextMode: stats.interactionTextMode,
      lodDroppedTextRuns: stats.lodDroppedTextRuns,
      textModeFallbacks: stats.textModeFallbacks,
      textureBatchFallbacks: stats.textureBatchFallbacks,
      textBucketChanges: stats.textBucketChanges,
      textBudgetExhausted: stats.textBudgetExhausted,
      visibleRectItems: stats.visibleRectItems,
      culledRectItems: stats.culledRectItems,
      atlasUploads: stats.atlasUploads,
      renderTargetRepaints: stats.renderTargetRepaints,
      renderTargetDraws: stats.renderTargetDraws,
      renderTargetAllocations: stats.renderTargetAllocations,
      renderTargetBytes: stats.renderTargetBytes,
      renderTargetUploadMs: stats.renderTargetUploadMs,
      renderTargetTextureCount: this._renderTargets.size,
      uniformOnlyFrames: stats.uploadBytes === 0 && stats.textRasterMs === 0 ? 1 : 0,
      atlasMemoryMB: this._textureMemoryMB(),
      cachedTextureMemoryMB: this._textureMemoryMB(),
    }
  }

  /**
   * Выполняет внутреннюю операцию measure text.
   */
  measureText(params: NovaText): { width: number, height: number } {
    const context = this._measureCanvas.getContext('2d')
    const style = compileNovaTextStyle(params)
    if (!context) {
      return {
        width: params.text.length * style.fontSize * 0.6,
        height: style.lineHeight,
      }
    }

    context.font = style.font
    return {
      width: context.measureText(params.text).width,
      height: style.lineHeight,
    }
  }

  /**
   * Освобождает runtime resources и снимает связанные ссылки.
   */
  destroy(): void {
    for (const target of this._renderTargets.values()) {
      this._gl.deleteFramebuffer(target.framebuffer)
    }
    this._renderTargets.clear()
    for (const texture of this._textures.values()) {
      this._gl.deleteTexture(texture.texture)
    }
    this._textures.clear()
    this._destroyTextAtlas()
    this._destroyGlyphAtlas()
    for (const cache of this._ownedRectSchemaBatchCaches) {
      if (cache.buffer) {
        this._gl.deleteBuffer(cache.buffer)
      }
      if (cache.vao) {
        this._gl.deleteVertexArray(cache.vao)
      }
    }
    this._ownedRectSchemaBatchCaches.clear()
    for (const cache of this._ownedTextureBatchCaches) {
      if (cache.buffer) {
        this._gl.deleteBuffer(cache.buffer)
      }
      if (cache.vao) {
        this._gl.deleteVertexArray(cache.vao)
      }
    }
    this._ownedTextureBatchCaches.clear()
    for (const cache of this._ownedParticleCircleBatchCaches) {
      this._gl.deleteBuffer(cache.positionBuffer)
      this._gl.deleteBuffer(cache.staticBuffer)
      this._gl.deleteVertexArray(cache.vao)
    }
    this._ownedParticleCircleBatchCaches.clear()
    for (const cache of this._ownedParticleSpriteBatchCaches) {
      this._gl.deleteBuffer(cache.positionBuffer)
      this._gl.deleteBuffer(cache.staticBuffer)
      this._gl.deleteVertexArray(cache.vao)
    }
    this._ownedParticleSpriteBatchCaches.clear()
    for (const cache of this._ownedRectStreamBatchCaches) {
      this._gl.deleteBuffer(cache.geometryBuffer)
      this._gl.deleteBuffer(cache.staticBuffer)
      this._gl.deleteVertexArray(cache.vao)
    }
    this._ownedRectStreamBatchCaches.clear()
    for (const cache of this._ownedTimeRangeSegmentBatchCaches) {
      this._gl.deleteBuffer(cache.geometryBuffer)
      this._gl.deleteBuffer(cache.staticBuffer)
      this._gl.deleteVertexArray(cache.vao)
    }
    this._ownedTimeRangeSegmentBatchCaches.clear()
    for (const cache of this._ownedTextureRectStreamGroupCaches) {
      this._gl.deleteBuffer(cache.geometryBuffer)
      this._gl.deleteBuffer(cache.staticBuffer)
      this._gl.deleteVertexArray(cache.vao)
    }
    this._ownedTextureRectStreamGroupCaches.clear()
    for (const cache of this._ownedGlyphTextStreamGroupCaches) {
      this._gl.deleteBuffer(cache.geometryBuffer)
      this._gl.deleteBuffer(cache.staticBuffer)
      this._gl.deleteVertexArray(cache.vao)
    }
    this._ownedGlyphTextStreamGroupCaches.clear()
    this._textRunShapeCache.clear()
    this._textRasterBucketStateByScope.clear()
    for (const cache of this._ownedStripeStreamBatchCaches) {
      this._gl.deleteBuffer(cache.geometryBuffer)
      this._gl.deleteBuffer(cache.staticBuffer)
      this._gl.deleteVertexArray(cache.vao)
    }
    this._ownedStripeStreamBatchCaches.clear()
    this._gl.deleteBuffer(this._roundedBuffer)
    this._gl.deleteBuffer(this._solidBuffer)
    this._gl.deleteBuffer(this._textureBuffer)
    this._gl.deleteBuffer(this._particleQuadBuffer)
    this._gl.deleteVertexArray(this._roundedVao)
    this._gl.deleteVertexArray(this._solidVao)
    this._gl.deleteVertexArray(this._textureVao)
    this._gl.deleteVertexArray(this._distanceFieldVao)
    this._gl.deleteVertexArray(this._patternRectVao)
    this._roundedProgram.destroy()
    this._solidProgram.destroy()
    this._textureProgram.destroy()
    this._distanceFieldTextProgram.destroy()
    this._particleCircleProgram.destroy()
    this._particleSpriteProgram.destroy()
    this._rectBatchProgram.destroy()
    this._timeRangeSegmentProgram.destroy()
    this._textureRectBatchProgram.destroy()
    this._stripeBatchProgram.destroy()
    this._patternRectProgram.destroy()
  }

  /**
   * Выполняет внутреннюю операцию draw render item.
   */
  private _drawRenderItem(item: NovaRenderItem, stats: RenderStats): void {
    if (!item.schemaItem) {
      return
    }
    this._drawPrimitive(item.schemaItem, item.transform ?? mat3.create(), stats)
  }

  /**
   * Вычисляет schema content version.
   */
  private _resolveSchemaContentVersion(items: Array<NovaSchemaItem<any>> | undefined, fallback: number | undefined): number | undefined {
    return (items as { contentVersion?: number } | undefined)?.contentVersion ?? fallback
  }

  /**
   * Возвращает retained dirty indices for schema batch.
   */
  private _resolveSchemaDirtyIndices(items: Array<NovaSchemaItem<any>>): ReadonlyArray<number> | undefined {
    const dirtyIndices = (items as SchemaBatchItems).dirtyIndices
    if (!dirtyIndices) {
      return undefined
    }
    if (dirtyIndices.length === 0) {
      return []
    }

    const normalized: Array<number> = []
    const seen = new Set<number>()
    for (const index of dirtyIndices) {
      if (!Number.isInteger(index) || index < 0 || index >= items.length || seen.has(index)) {
        continue
      }
      seen.add(index)
      normalized.push(index)
    }

    return normalized
  }

  /**
   * Переносит dirty indices исходного semantic batch на дочерний layer batch.
   */
  private _applyLayerDirtyIndices(
    sourceItems: Array<NovaSchemaItem<any>>,
    targetItems: Array<NovaSchemaItem<any>>,
    targetIndexBySourceIndex: Array<number | undefined>,
  ): void {
    const sourceDirtyIndices = this._resolveSchemaDirtyIndices(sourceItems)
    const target = targetItems as SchemaBatchItems

    if (!sourceDirtyIndices) {
      target.dirtyIndices = undefined
      return
    }

    const dirtyIndices: Array<number> = []
    const seen = new Set<number>()
    for (const sourceIndex of sourceDirtyIndices) {
      const targetIndex = targetIndexBySourceIndex[sourceIndex]
      if (targetIndex === undefined || seen.has(targetIndex)) {
        continue
      }
      seen.add(targetIndex)
      dirtyIndices.push(targetIndex)
    }

    target.dirtyIndices = dirtyIndices
  }

  /**
   * Выполняет внутреннюю операцию draw schema batch.
   */
  private _drawSchemaBatch(
    items: Array<NovaSchemaItem<any>>,
    transform: mat3,
    stats: RenderStats,
    semanticScope?: NovaSemanticScopeKind,
    contentVersion?: number,
  ): boolean {
    const dirtyIndices = this._resolveSchemaDirtyIndices(items)

    if (semanticScope === 'non-overlap-layered' && this._drawNonOverlapLayeredSchemaBatch(items, transform, stats, contentVersion)) {
      return true
    }

    if (items.length === 0 || !items.every(item => item.type === 'rect' && item.active !== false && (item.clip === undefined || item.clip === true))) {
      return false
    }

    if (items.every(item => this._isPlainRect(item as NovaRect))) {
      return this._drawPlainRectSchemaBatch(items, transform, stats, contentVersion)
    }

    let batch = this._rectBatchCache.get(items)
    let dirtyRanges: Array<FloatDirtyRange> | null = null
    let changedItems = 0
    const visibilityKey = this._resolveBatchVisibilityKey(items, transform)
    if (!batch) {
      const nextBatch = this._buildRectBatch(items, transform, stats)
      if (!nextBatch) {
        return false
      }
      nextBatch.contentVersion = contentVersion
      nextBatch.visibilityKey = visibilityKey
      batch = nextBatch
      this._rectBatchCache.set(items, nextBatch)
    }
    else if (batch.visibilityKey !== visibilityKey) {
      const nextBatch = this._buildRectBatch(items, transform, stats)
      if (!nextBatch) {
        return false
      }
      this._disposeRectSchemaBatchCache(batch)
      nextBatch.contentVersion = contentVersion
      nextBatch.visibilityKey = visibilityKey
      batch = nextBatch
      this._rectBatchCache.set(items, nextBatch)
    }
    else if (contentVersion === undefined || batch.contentVersion !== contentVersion) {
      const update = this._updateRectBatch(items, batch, dirtyIndices)
      if (!update) {
        const nextBatch = this._buildRectBatch(items, transform, stats)
        if (!nextBatch) {
          return false
        }
        this._disposeRectSchemaBatchCache(batch)
        nextBatch.contentVersion = contentVersion
        nextBatch.visibilityKey = visibilityKey
        batch = nextBatch
        this._rectBatchCache.set(items, nextBatch)
      }
      else {
        dirtyRanges = update.dirtyRanges
        changedItems = update.changedItems
        batch.contentVersion = contentVersion
      }
    }

    if (batch.data.length === 0) {
      return true
    }
    this._drawResidentRectSchemaBatch(batch, transform, stats, dirtyRanges, 'rounded')
    if (dirtyRanges?.length) {
      stats.updatedHandles += changedItems
      stats.dirtyStreamRanges += dirtyRanges.length
    }
    return true
  }

  /**
   * Выполняет внутреннюю операцию draw plain rect schema batch.
   */
  private _drawPlainRectSchemaBatch(items: Array<NovaSchemaItem<any>>, transform: mat3, stats: RenderStats, contentVersion?: number): boolean {
    let batch = this._plainRectBatchCache.get(items)
    let dirtyRanges: Array<FloatDirtyRange> | null = null
    let changedItems = 0
    const dirtyIndices = this._resolveSchemaDirtyIndices(items)
    const visibilityKey = this._resolveBatchVisibilityKey(items, transform)

    if (!batch) {
      batch = this._buildPlainRectBatch(items, transform, stats)
      batch.contentVersion = contentVersion
      batch.visibilityKey = visibilityKey
      this._plainRectBatchCache.set(items, batch)
    }
    else if (batch.visibilityKey !== visibilityKey) {
      this._disposeRectSchemaBatchCache(batch)
      batch = this._buildPlainRectBatch(items, transform, stats)
      batch.contentVersion = contentVersion
      batch.visibilityKey = visibilityKey
      this._plainRectBatchCache.set(items, batch)
    }
    else if (contentVersion === undefined || batch.contentVersion !== contentVersion) {
      const update = this._updatePlainRectBatch(items, batch, dirtyIndices)
      if (!update) {
        this._disposeRectSchemaBatchCache(batch)
        batch = this._buildPlainRectBatch(items, transform, stats)
        batch.contentVersion = contentVersion
        batch.visibilityKey = visibilityKey
        this._plainRectBatchCache.set(items, batch)
      }
      else {
        dirtyRanges = update.dirtyRanges
        changedItems = update.changedItems
        batch.contentVersion = contentVersion
      }
    }

    if (batch.data.length === 0) {
      return true
    }

    this._drawResidentRectSchemaBatch(batch, transform, stats, dirtyRanges, 'solid')
    if (dirtyRanges?.length) {
      stats.updatedHandles += changedItems
      stats.dirtyStreamRanges += dirtyRanges.length
    }
    return true
  }

  /**
   * Рисует cacheable schema rect batch из собственного GPU buffer.
   */
  private _drawResidentRectSchemaBatch(
    batch: RectBatchCache,
    transform: mat3,
    stats: RenderStats,
    dirtyRanges: Array<FloatDirtyRange> | null,
    kind: 'solid' | 'rounded',
  ): void {
    this._flush(stats)
    const gl = this._gl
    const created = this._ensureRectSchemaBatchCache(batch, kind)
    if (created) {
      stats.schemaResidentBatchMisses += 1
    }
    else { stats.schemaResidentBatchHits += 1 }

    const uploadCallsBefore = stats.bufferDataCalls + stats.bufferSubDataCalls
    const uploadStartedAt = performance.now()
    gl.bindVertexArray(batch.vao!)
    gl.bindBuffer(gl.ARRAY_BUFFER, batch.buffer!)
    this._uploadArrayBuffer(batch.data, batch.upload!, stats, dirtyRanges)
    stats.uploadMs += performance.now() - uploadStartedAt
    stats.schemaResidentBatchUploads += Math.max(0, stats.bufferDataCalls + stats.bufferSubDataCalls - uploadCallsBefore)

    if (kind === 'solid') {
      this._solidProgram.use()
      gl.uniform2f(this._solidProgram.uniformLocation('u_resolution'), this._renderResolutionWidth, this._renderResolutionHeight)
      gl.uniformMatrix3fv(this._solidProgram.uniformLocation('u_transform'), false, transform)
      gl.uniform1f(this._solidProgram.uniformLocation('u_time'), this._time)
      gl.drawArrays(gl.TRIANGLES, 0, batch.data.length / SOLID_STRIDE)
    }
    else {
      this._roundedProgram.use()
      gl.uniform2f(this._roundedProgram.uniformLocation('u_resolution'), this._renderResolutionWidth, this._renderResolutionHeight)
      gl.uniformMatrix3fv(this._roundedProgram.uniformLocation('u_transform'), false, transform)
      gl.uniform1f(this._roundedProgram.uniformLocation('u_time'), this._time)
      gl.drawArrays(gl.TRIANGLES, 0, batch.data.length / RECT_STRIDE)
    }

    stats.instances += batch.instances
    stats.drawCalls += 1
    stats.batches += 1
  }

  /**
   * Создает resident GPU resources для schema rect batch при первом использовании.
   */
  private _ensureRectSchemaBatchCache(batch: RectBatchCache, kind: 'solid' | 'rounded'): boolean {
    if (batch.buffer && batch.vao && batch.upload) {
      return false
    }

    this._disposeRectSchemaBatchCache(batch)
    batch.buffer = this._createBuffer()
    batch.upload = createWebGLUploadState()
    batch.vao = kind === 'solid'
      ? this._createSolidVao(batch.buffer)
      : this._createRoundedVao(batch.buffer)
    this._ownedRectSchemaBatchCaches.add(batch)
    return true
  }

  /**
   * Освобождает resident resources schema rect batch.
   */
  private _disposeRectSchemaBatchCache(batch: RectBatchCache): void {
    if (batch.buffer) {
      this._gl.deleteBuffer(batch.buffer)
    }
    if (batch.vao) {
      this._gl.deleteVertexArray(batch.vao)
    }
    delete batch.buffer
    delete batch.vao
    delete batch.upload
    this._ownedRectSchemaBatchCaches.delete(batch)
  }

  /**
   * Выполняет внутреннюю операцию draw non overlap layered schema batch.
   */
  private _drawNonOverlapLayeredSchemaBatch(items: Array<NovaSchemaItem<any>>, transform: mat3, stats: RenderStats, contentVersion?: number): boolean {
    if (items.length === 0) {
      return true
    }

    const batch = this._resolveNonOverlapLayeredBatch(items)
    if (!batch) {
      return false
    }

    this._applyLayerDirtyIndices(items, batch.rects, batch.rectIndexBySourceIndex)
    if (batch.rects.length > 0 && !this._drawSchemaBatch(batch.rects, transform, stats, undefined, contentVersion)) {
      return false
    }

    this._applyLayerDirtyIndices(items, batch.icons, batch.iconIndexBySourceIndex)
    if (batch.icons.length > 0 && !this._drawTextureSchemaBatch(batch.icons, transform, stats, contentVersion)) {
      return false
    }

    this._applyLayerDirtyIndices(items, batch.texts, batch.textIndexBySourceIndex)
    if (batch.texts.length > 0 && !this._drawTextureSchemaBatch(batch.texts, transform, stats, contentVersion)) {
      stats.textureBatchFallbacks += 1
      for (const text of batch.texts) {
        this._drawPrimitive(text, transform, stats)
      }
    }

    return true
  }

  /**
   * Вычисляет non overlap layered batch.
   */
  private _resolveNonOverlapLayeredBatch(items: Array<NovaSchemaItem<any>>): NonOverlapLayeredBatchCache | null {
    const cached = this._semanticBatchCache.get(items)
    if (cached && this._refreshNonOverlapLayeredBatch(cached, items)) {
      return cached
    }

    const rects: Array<NovaSchemaItem<any>> = []
    const icons: Array<NovaSchemaItem<any>> = []
    const texts: Array<NovaSchemaItem<any>> = []
    const rectIndexBySourceIndex: Array<number | undefined> = []
    const iconIndexBySourceIndex: Array<number | undefined> = []
    const textIndexBySourceIndex: Array<number | undefined> = []
    const sourceKinds: Array<'rect' | 'icon' | 'text'> = []

    for (let sourceIndex = 0; sourceIndex < items.length; sourceIndex += 1) {
      const item = items[sourceIndex]
      if (item.active === false) {
        continue
      }
      if (item.clip !== undefined && item.clip !== true) {
        return null
      }

      if (item.type === 'rect') {
        rectIndexBySourceIndex[sourceIndex] = rects.length
        sourceKinds[sourceIndex] = 'rect'
        rects.push(item)
        continue
      }

      if (item.type === 'icon') {
        iconIndexBySourceIndex[sourceIndex] = icons.length
        sourceKinds[sourceIndex] = 'icon'
        icons.push(item)
        continue
      }

      if (item.type === 'text') {
        textIndexBySourceIndex[sourceIndex] = texts.length
        sourceKinds[sourceIndex] = 'text'
        texts.push(item)
        continue
      }

      return null
    }

    const batch = {
      rects,
      icons,
      texts,
      rectIndexBySourceIndex,
      iconIndexBySourceIndex,
      textIndexBySourceIndex,
      sourceKinds,
    }
    this._semanticBatchCache.set(items, batch)
    return batch
  }

  /**
   * Обновляет cached semantic child arrays свежими item references из mutable source schema.
   */
  private _refreshNonOverlapLayeredBatch(
    batch: NonOverlapLayeredBatchCache,
    items: Array<NovaSchemaItem<any>>,
  ): boolean {
    if (batch.sourceKinds.length !== items.length) {
      return false
    }

    for (let sourceIndex = 0; sourceIndex < items.length; sourceIndex += 1) {
      const item = items[sourceIndex]
      if (item.active === false || (item.clip !== undefined && item.clip !== true)) {
        return false
      }

      const kind = batch.sourceKinds[sourceIndex]
      if (item.type !== kind) {
        return false
      }

      if (kind === 'rect') {
        const targetIndex = batch.rectIndexBySourceIndex[sourceIndex]
        if (targetIndex === undefined) {
          return false
        }
        batch.rects[targetIndex] = item
        continue
      }

      if (kind === 'icon') {
        const targetIndex = batch.iconIndexBySourceIndex[sourceIndex]
        if (targetIndex === undefined) {
          return false
        }
        batch.icons[targetIndex] = item
        continue
      }

      const targetIndex = batch.textIndexBySourceIndex[sourceIndex]
      if (targetIndex === undefined) {
        return false
      }
      batch.texts[targetIndex] = item
    }

    return true
  }

  /**
   * Выполняет внутреннюю операцию build rect batch.
   */
  private _buildRectBatch(items: Array<NovaSchemaItem<any>>, transform: mat3, stats: RenderStats): RectBatchCache | null {
    const data: Array<number> = []
    const itemOffsets: Array<number> = Array.from({ length: items.length }).fill(-1)
    const signatures: Array<string> = Array.from({ length: items.length }).fill('')
    let instances = 0

    for (let index = 0; index < items.length; index += 1) {
      const rect = items[index] as NovaRect
      signatures[index] = this._createRectSignature(rect)
      if (this._shouldCullGeometryItems() && !this._isRectVisible(transform, rect.x, rect.y, rect.width, rect.height)) {
        stats.culledRectItems += 1
        continue
      }
      stats.visibleRectItems += 1
      const background = rect.styles?.background
      if (background && typeof background !== 'string') {
        return null
      }
      const style = compileNovaRectStyle(rect)
      if (rect.width <= 0 || rect.height <= 0) {
        continue
      }
      if (style.fill.a <= 0 && (style.borderColor.a <= 0 || style.borderWidth <= 0)) {
        continue
      }

      itemOffsets[index] = data.length
      this._pushRoundedRectVertices(
        data,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        style.borderRadius,
        style.fill,
        style.opacity,
        style.borderColor,
        style.borderWidth,
        this._resolveShaderRenderMeta(rect),
      )
      instances += 1
    }

    return {
      data: new Float32Array(data),
      instances,
      itemOffsets,
      signatures,
    }
  }

  /**
   * Выполняет внутреннюю операцию build plain rect batch.
   */
  private _buildPlainRectBatch(items: Array<NovaSchemaItem<any>>, transform: mat3, stats: RenderStats): RectBatchCache {
    const data: Array<number> = []
    const itemOffsets: Array<number> = Array.from({ length: items.length }).fill(-1)
    const signatures: Array<string> = Array.from({ length: items.length }).fill('')
    let instances = 0

    for (let index = 0; index < items.length; index += 1) {
      const rect = items[index] as NovaRect
      signatures[index] = this._createRectSignature(rect)
      if (this._shouldCullGeometryItems() && !this._isRectVisible(transform, rect.x, rect.y, rect.width, rect.height)) {
        stats.culledRectItems += 1
        continue
      }
      stats.visibleRectItems += 1
      const style = compileNovaRectStyle(rect)
      if (rect.width <= 0 || rect.height <= 0 || style.fill.a <= 0) {
        continue
      }

      itemOffsets[index] = data.length
      this._pushSolidRectVertices(data, rect.x, rect.y, rect.width, rect.height, style.fill, style.opacity, this._resolveShaderRenderMeta(rect))
      instances += 1
    }

    return {
      data: new Float32Array(data),
      instances,
      itemOffsets,
      signatures,
    }
  }

  /**
   * Обновляет rect batch.
   */
  private _updateRectBatch(
    items: Array<NovaSchemaItem<any>>,
    batch: RectBatchCache,
    dirtyIndices?: ReadonlyArray<number>,
  ): RectBatchUpdate | null {
    if (items.length !== batch.signatures.length || items.length !== batch.itemOffsets.length) {
      return null
    }

    const dirtyRanges: Array<FloatDirtyRange> = []
    let changedItems = 0

    const indexCount = dirtyIndices?.length ?? items.length
    for (let dirtyIndex = 0; dirtyIndex < indexCount; dirtyIndex += 1) {
      const index = dirtyIndices ? dirtyIndices[dirtyIndex] : dirtyIndex
      const rect = items[index] as NovaRect
      const signature = this._createRectSignature(rect)
      if (signature === batch.signatures[index]) {
        continue
      }

      const offset = batch.itemOffsets[index]
      if (offset < 0) {
        batch.signatures[index] = signature
        continue
      }
      const background = rect.styles?.background
      if (background && typeof background !== 'string') {
        return null
      }
      const style = compileNovaRectStyle(rect)
      if (rect.width <= 0 || rect.height <= 0) {
        return null
      }
      if (style.fill.a <= 0 && (style.borderColor.a <= 0 || style.borderWidth <= 0)) {
        return null
      }

      this._writeRoundedRectVertices(
        batch.data,
        offset,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        style.borderRadius,
        style.fill,
        style.opacity,
        style.borderColor,
        style.borderWidth,
        this._resolveShaderRenderMeta(rect),
      )
      batch.signatures[index] = signature
      changedItems += 1
      dirtyRanges.push({ start: offset, end: offset + RECT_STRIDE * 6 })
    }

    return {
      dirtyRanges: mergeFloatDirtyRanges(dirtyRanges),
      changedItems,
    }
  }

  /**
   * Обновляет plain rect batch.
   */
  private _updatePlainRectBatch(
    items: Array<NovaSchemaItem<any>>,
    batch: RectBatchCache,
    dirtyIndices?: ReadonlyArray<number>,
  ): RectBatchUpdate | null {
    if (items.length !== batch.signatures.length || items.length !== batch.itemOffsets.length) {
      return null
    }

    const dirtyRanges: Array<FloatDirtyRange> = []
    let changedItems = 0

    const indexCount = dirtyIndices?.length ?? items.length
    for (let dirtyIndex = 0; dirtyIndex < indexCount; dirtyIndex += 1) {
      const index = dirtyIndices ? dirtyIndices[dirtyIndex] : dirtyIndex
      const rect = items[index] as NovaRect
      const signature = this._createRectSignature(rect)
      if (signature === batch.signatures[index]) {
        continue
      }

      const offset = batch.itemOffsets[index]
      if (offset < 0) {
        batch.signatures[index] = signature
        continue
      }

      const style = compileNovaRectStyle(rect)
      if (rect.width <= 0 || rect.height <= 0 || style.fill.a <= 0) {
        return null
      }
      this._writeSolidRectVertices(batch.data, offset, rect.x, rect.y, rect.width, rect.height, style.fill, style.opacity, this._resolveShaderRenderMeta(rect))
      batch.signatures[index] = signature
      changedItems += 1
      dirtyRanges.push({ start: offset, end: offset + SOLID_STRIDE * 6 })
    }

    return {
      dirtyRanges: mergeFloatDirtyRanges(dirtyRanges),
      changedItems,
    }
  }

  /**
   * Выполняет внутреннюю операцию draw texture schema batch.
   */
  private _drawTextureSchemaBatch(items: Array<NovaSchemaItem<any>>, transform: mat3, stats: RenderStats, contentVersion?: number): boolean {
    if (items.length === 0) {
      return true
    }

    let batch: TextureBatchCache | null = this._textureBatchCache.get(items) ?? null
    if (batch?.texture && !this._isRetainedTextureAlive(batch.texture)) {
      batch = null
    }
    let dirtyRanges: Array<FloatDirtyRange> | null = null
    let changedItems = 0
    const rasterScale = this._resolveTextureRasterScale(items, transform, stats)
    const dirtyIndices = this._resolveSchemaDirtyIndices(items)
    const visibilityKey = this._resolveBatchVisibilityKey(items, transform)

    if (!batch) {
      batch = this._buildTextureBatch(items, stats, rasterScale, transform)
      if (!batch) {
        return false
      }
      batch.contentVersion = contentVersion
      batch.rasterScale = rasterScale
      batch.visibilityKey = visibilityKey
      this._textureBatchCache.set(items, batch)
      this._ownedTextureBatchCaches.add(batch)
    }
    else if (batch.visibilityKey !== visibilityKey) {
      batch = this._buildTextureBatch(items, stats, rasterScale, transform)
      if (!batch) {
        return false
      }
      batch.contentVersion = contentVersion
      batch.rasterScale = rasterScale
      batch.visibilityKey = visibilityKey
      this._textureBatchCache.set(items, batch)
      this._ownedTextureBatchCaches.add(batch)
    }
    else if (contentVersion === undefined || batch.contentVersion !== contentVersion || batch.rasterScale !== rasterScale) {
      const update = this._updateTextureBatch(items, batch, stats, rasterScale, transform, dirtyIndices)
      if (!update) {
        batch = this._buildTextureBatch(items, stats, rasterScale, transform)
        if (!batch) {
          return false
        }
        batch.contentVersion = contentVersion
        batch.rasterScale = rasterScale
        batch.visibilityKey = visibilityKey
        this._textureBatchCache.set(items, batch)
        this._ownedTextureBatchCaches.add(batch)
      }
      else {
        dirtyRanges = update.dirtyRanges
        changedItems = update.changedItems
        batch.contentVersion = contentVersion
        batch.rasterScale = rasterScale
      }
    }

    if (batch.data.length === 0 || !batch.texture) {
      return true
    }

    this._flushRounded(stats)
    this._flushSolid(stats)
    this._prepareTextureTransform(transform, stats)
    if (this._textureData.length > 0 || this._textureCachedData) {
      this._flushTexture(stats)
    }

    this._textureCachedData = batch.data
    this._textureCachedDirtyRanges = dirtyRanges
    this._textureCachedBatch = batch
    stats.instances += batch.instances
    if (dirtyRanges?.length) {
      stats.updatedHandles += changedItems
      stats.dirtyStreamRanges += dirtyRanges.length
    }

    return true
  }

  /**
   * Выполняет внутреннюю операцию build texture batch.
   */
  private _buildTextureBatch(
    items: Array<NovaSchemaItem<any>>,
    stats: RenderStats,
    rasterScale?: number,
    transform?: mat3,
  ): TextureBatchCache | null {
    const data: Array<number> = []
    const itemOffsets: Array<number> = Array.from({ length: items.length }).fill(-1)
    const signatures: Array<string> = Array.from({ length: items.length }).fill('')
    let texture: TextureEntry | null = null
    let instances = 0

    for (let index = 0; index < items.length; index += 1) {
      const item = this._resolveTextureBatchItem(items[index], stats, rasterScale, transform)
      if (!item) {
        return null
      }
      if (this._isCulledTextureBatchItem(item)) {
        signatures[index] = item.signature
        continue
      }
      if (texture && texture !== item.texture) {
        return null
      }

      texture = item.texture
      signatures[index] = item.signature
      if (item.width <= 0 || item.height <= 0 || item.opacity <= 0) {
        continue
      }

      itemOffsets[index] = data.length
      this._pushTextureQuadVertices(data, item.x, item.y, item.width, item.height, item.opacity, item.u0, item.v0, item.u1, item.v1)
      instances += 1
    }

    return {
      data: new Float32Array(data),
      instances,
      itemOffsets,
      signatures,
      texture,
      upload: createWebGLUploadState(),
      rasterScale,
    }
  }

  /**
   * Обновляет texture batch.
   */
  private _updateTextureBatch(
    items: Array<NovaSchemaItem<any>>,
    batch: TextureBatchCache,
    stats: RenderStats,
    rasterScale?: number,
    transform?: mat3,
    dirtyIndices?: ReadonlyArray<number>,
  ): TextureBatchUpdate | null {
    if (items.length !== batch.signatures.length || items.length !== batch.itemOffsets.length) {
      return null
    }
    if (batch.texture && !this._isRetainedTextureAlive(batch.texture)) {
      return null
    }

    const dirtyRanges: Array<FloatDirtyRange> = []
    let changedItems = 0

    const indexCount = dirtyIndices?.length ?? items.length
    for (let dirtyIndex = 0; dirtyIndex < indexCount; dirtyIndex += 1) {
      const index = dirtyIndices ? dirtyIndices[dirtyIndex] : dirtyIndex
      const item = this._resolveTextureBatchItem(items[index], stats, rasterScale, transform)
      if (!item) {
        return null
      }
      if (this._isCulledTextureBatchItem(item)) {
        if (batch.itemOffsets[index] >= 0) {
          return null
        }
        batch.signatures[index] = item.signature
        continue
      }
      if (!batch.texture || item.texture !== batch.texture) {
        return null
      }
      if (item.signature === batch.signatures[index]) {
        continue
      }

      const offset = batch.itemOffsets[index]
      if (offset < 0) {
        return null
      }
      if (item.width <= 0 || item.height <= 0 || item.opacity <= 0) {
        return null
      }

      this._writeTextureQuadVertices(batch.data, offset, item.x, item.y, item.width, item.height, item.opacity, item.u0, item.v0, item.u1, item.v1)
      batch.signatures[index] = item.signature
      changedItems += 1
      dirtyRanges.push({ start: offset, end: offset + TEXTURE_STRIDE * 6 })
    }

    return {
      dirtyRanges: mergeFloatDirtyRanges(dirtyRanges),
      changedItems,
    }
  }

  /**
   * Вычисляет texture batch item.
   */
  private _resolveTextureBatchItem(
    item: NovaSchemaItem<any>,
    stats: RenderStats,
    rasterScale?: number,
    transform?: mat3,
  ): TextureBatchItem | CulledTextureBatchItem | null {
    if (item.active === false) {
      return null
    }

    if (item.type === 'icon') {
      const rect = resolveNovaIconRenderRect(item, this._device.canvas.dpr)
      const opacity = resolveNovaIconRenderOpacity(item, this._device.canvas.dpr)
      if (
        transform
        && this._shouldCullTextureItems()
        && !this._isRectVisible(transform, rect.x, rect.y, rect.width, rect.height)
      ) {
        return {
          culled: true,
          signature: ['culled-icon', rect.x, rect.y, rect.width, rect.height, opacity].join('|'),
        }
      }

      const source = this._assets.resolveDrawable(item.icon)
      if (!source) {
        return null
      }
      const key = this._assets.resolveDrawableKey('icon', item.icon, source => this._resolveSourceKey(source))
      let texture = this._textures.get(key)
      if (!texture) {
        texture = this._createTextureFromSource(key, source, stats)
      }
      texture.lastUsed = this._time
      return {
        texture,
        signature: [key, rect.x, rect.y, rect.width, rect.height, opacity].join('|'),
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        opacity,
        u0: 0,
        v0: 0,
        u1: 1,
        v1: 1,
      }
    }

    if (item.type === 'text') {
      const mode = this._resolveTextRenderMode(item)
      if (mode !== 'run-atlas') {
        return null
      }

      if (
        transform
        && this._shouldCullTextRuns(mode)
        && !this._isRectVisible(transform, item.x, item.y, item.width, item.height)
      ) {
        stats.culledTextRuns += 1
        return {
          culled: true,
          signature: this._createCulledTextSignature(item, rasterScale),
        }
      }
      stats.visibleTextRuns += 1

      const style = compileNovaTextStyle(item)
      const scale = rasterScale ?? this._device.canvas.dpr
      const atlasItem = this._resolveTextAtlasItem(item, style, scale, stats)
      if (!atlasItem) {
        return {
          culled: true,
          signature: ['deferred-text', this._createCulledTextSignature(item, scale)].join('|'),
        }
      }
      const quad = this._resolveTextAtlasQuad(item, atlasItem)
      if (!quad) {
        return {
          culled: true,
          signature: ['empty-text', this._createCulledTextSignature(item, scale), atlasItem.key].join('|'),
        }
      }

      return {
        texture: atlasItem.texture,
        signature: [atlasItem.key, quad.x, quad.y, quad.width, quad.height, quad.u0, quad.v0, quad.u1, quad.v1, style.opacity].join('|'),
        x: quad.x,
        y: quad.y,
        width: quad.width,
        height: quad.height,
        opacity: style.opacity,
        u0: quad.u0,
        v0: quad.v0,
        u1: quad.u1,
        v1: quad.v1,
      }
    }

    return null
  }

  /**
   * Проверяет culled marker для texture batch.
   */
  private _isCulledTextureBatchItem(item: TextureBatchItem | CulledTextureBatchItem): item is CulledTextureBatchItem {
    return 'culled' in item
  }

  /**
   * Создает signature для culled text без rasterize.
   */
  private _createCulledTextSignature(text: NovaText, rasterScale?: number): string {
    return [
      'culled-text',
      text.text,
      text.x,
      text.y,
      text.width,
      text.height,
      text.styles?.color,
      text.styles?.font?.family,
      text.styles?.font?.size,
      text.styles?.font?.weight,
      text.styles?.opacity,
      rasterScale ?? 0,
    ].join('|')
  }

  /**
   * Создает rect signature.
   */
  private _createRectSignature(rect: NovaRect): string {
    const border = rect.styles?.border
    return [
      rect.active === false ? 0 : 1,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      typeof rect.styles?.background === 'string' ? rect.styles.background : rect.styles?.background ? 'texture' : '',
      rect.styles?.opacity ?? 1,
      border?.color ?? '',
      border?.width ?? 0,
      rect.styles?.radius ?? border?.radius ?? 0,
      border?.dashPattern?.join(',') ?? '',
      this._createShaderMetaSignature(rect),
    ].join('|')
  }

  /**
   * Возвращает shader metadata schema item.
   */
  private _resolveShaderRenderMeta(item?: { meta?: any }): NovaShaderRenderMeta | null {
    const meta = item?.meta as NovaShaderRenderMeta | undefined
    if (!meta || typeof meta !== 'object') {
      return null
    }
    if (!meta.animation && !meta.motion) {
      return null
    }
    return meta
  }

  /**
   * Создает signature для shader metadata, которая меняется только при смене конфигурации.
   */
  private _createShaderMetaSignature(item: { meta?: any }): string {
    const meta = this._resolveShaderRenderMeta(item)
    if (!meta) {
      return ''
    }
    const animation = resolveAnimationVector(meta)
    const motion = resolveMotionVector(meta)
    return [
      animation.phase,
      animation.speed,
      animation.amplitude,
      motion.speed,
      motion.wrapWidth,
    ].join(',')
  }

  /**
   * Проверяет plain rect.
   */
  private _isPlainRect(rect: NovaRect): boolean {
    const background = rect.styles?.background
    const border = rect.styles?.border
    return (!background || typeof background === 'string')
      && (border?.width ?? 0) <= 0
      && (border?.radius ?? 0) <= 0
  }

  /**
   * Выполняет внутреннюю операцию draw primitive.
   */
  private _drawPrimitive(item: NovaSchemaItem<any>, transform: mat3, stats: RenderStats): void {
    if (item.active === false) {
      return
    }

    switch (item.type) {
      case 'rect':
        this._drawRect(item, transform, stats)
        break
      case 'border':
        this._drawBorder(item, transform, stats)
        break
      case 'text':
        this._drawText(item, transform, stats)
        break
      case 'line':
        this._drawLine(item, transform, stats)
        break
      case 'circle':
        this._drawCircle(item, transform, stats)
        break
      case 'arc':
        this._drawArc(item, transform, stats)
        break
      case 'polygon':
        this._drawPolygon(item, transform, stats)
        break
      case 'icon':
        this._drawIcon(item, transform, stats)
        break
      case 'nine-slice-image':
        this._drawNineSliceImage(item, transform, stats)
        break
      case 'pattern-rect':
        this._drawPatternRect(item, transform, stats)
        break
      default:
        break
    }
  }

  /**
   * Выполняет внутреннюю операцию draw rect.
   */
  private _drawRect(rect: NovaRect, transform: mat3, stats: RenderStats): void {
    const style = compileNovaRectStyle(rect)
    const background = rect.styles?.background

    if (background && typeof background !== 'string') {
      const source = this._assets.resolveDrawable(background)
      if (source) {
        const fillMode = this._assets.resolveDrawableFillMode(background)
        this._drawTextureSource(
          this._assets.resolveDrawableKey('rect-bg', background, source => this._resolveSourceKey(source)),
          source,
          rect.x,
          rect.y,
          rect.width,
          rect.height,
          transform,
          rect.styles?.opacity ?? 1,
          stats,
          fillMode,
        )
      }
    }

    if (!background || typeof background === 'string' || style.borderWidth > 0) {
      if (background !== undefined && typeof background === 'string' && style.borderRadius <= 0 && style.borderWidth <= 0) {
        this._queuePlainRect(rect.x, rect.y, rect.width, rect.height, style.fill, style.opacity, transform, stats, rect)
        return
      }
      if (background !== undefined && typeof background === 'string' && style.borderRadius <= 0 && style.borderWidth > 0) {
        this._queuePlainRect(rect.x, rect.y, rect.width, rect.height, style.fill, style.opacity, transform, stats, rect)
        this._queueRectBorderLines(rect.x, rect.y, rect.width, rect.height, style.borderWidth, style.borderColor, style.opacity, transform, stats, style.dashPattern)
        return
      }
      this._queueRoundedRect(rect.x, rect.y, rect.width, rect.height, style.borderRadius, style.fill, style.opacity, style.borderColor, style.borderWidth, transform, stats, rect)
    }
  }

  /**
   * Рисует border прямоугольника без rounded shader, когда radius равен нулю.
   */
  private _queueRectBorderLines(
    x: number,
    y: number,
    width: number,
    height: number,
    borderWidth: number,
    color: NovaParsedColor,
    opacity: number,
    transform: mat3,
    stats: RenderStats,
    dashPattern?: Array<number>,
  ): void {
    if (borderWidth <= 0 || color.a <= 0) {
      return
    }
    this._queueSolidLine(x, y, x + width, y, borderWidth, color, opacity, transform, stats, dashPattern)
    this._queueSolidLine(x, y + height, x + width, y + height, borderWidth, color, opacity, transform, stats, dashPattern)
    this._queueSolidLine(x, y, x, y + height, borderWidth, color, opacity, transform, stats, dashPattern)
    this._queueSolidLine(x + width, y, x + width, y + height, borderWidth, color, opacity, transform, stats, dashPattern)
  }

  /**
   * Выполняет внутреннюю операцию draw border.
   */
  private _drawBorder(border: NovaBorder, transform: mat3, stats: RenderStats): void {
    const style = compileNovaBorderStyle(border)
    const position = border.position ?? 'all'

    if (position === 'all' || style.borderRadius > 0) {
      this._queueRoundedRect(border.x, border.y, border.width, border.height, style.borderRadius, style.fill, 1, style.borderColor, style.borderWidth, transform, stats)
      return
    }

    const sides = this._resolveBorderSides(position)
    for (const side of sides) {
      if (side === 'top') {
        this._queueSolidLine(border.x, border.y, border.x + border.width, border.y, style.borderWidth, style.borderColor, 1, transform, stats, style.dashPattern)
      }
      if (side === 'bottom') {
        this._queueSolidLine(border.x, border.y + border.height, border.x + border.width, border.y + border.height, style.borderWidth, style.borderColor, 1, transform, stats, style.dashPattern)
      }
      if (side === 'left') {
        this._queueSolidLine(border.x, border.y, border.x, border.y + border.height, style.borderWidth, style.borderColor, 1, transform, stats, style.dashPattern)
      }
      if (side === 'right') {
        this._queueSolidLine(border.x + border.width, border.y, border.x + border.width, border.y + border.height, style.borderWidth, style.borderColor, 1, transform, stats, style.dashPattern)
      }
    }
  }

  /**
   * Выполняет внутреннюю операцию draw text.
   */
  private _drawText(text: NovaText, transform: mat3, stats: RenderStats): void {
    const textTransform = createRotatedTextTransform(text, transform)
    const mode = this._resolveTextRenderMode(text)

    if (!this._shouldDrawTextRun(textTransform, text.x, text.y, text.width, text.height, mode, stats, text.meta)) {
      return
    }

    const style = compileNovaTextStyle(text)
    if (mode === 'glyph-atlas' || mode === 'msdf') {
      if (this._drawGlyphText(text, style, mode, textTransform, stats)) {
        return
      }
      stats.textModeFallbacks += 1
    }

    const scale = this._resolveTextRasterScale(textTransform, stats, this._resolveTextRasterScope(text.meta, mode))
    const atlasItem = this._resolveTextAtlasItem(text, style, scale, stats, mode)
    if (!atlasItem) {
      return
    }
    const quad = this._resolveTextAtlasQuad(text, atlasItem)
    if (!quad) {
      return
    }

    this._queueTextureQuad(
      atlasItem.texture,
      quad.x,
      quad.y,
      quad.width,
      quad.height,
      textTransform,
      style.opacity,
      stats,
      quad.u0,
      quad.v0,
      quad.u1,
      quad.v1,
    )
  }

  /**
   * Рисует текст как последовательность glyph quads.
   */
  private _drawGlyphText(
    text: NovaText,
    style: NovaCompiledTextStyle,
    mode: 'glyph-atlas' | 'msdf',
    transform: mat3,
    stats: RenderStats,
  ): boolean {
    if (!this._isGlyphTextSupported(text)) {
      return false
    }

    const scale = mode === 'msdf'
      ? Math.min(this._resolveMaxTextRasterScale(), Math.max(0.1, this._device.canvas.dpr))
      : this._resolveTextRasterScale(transform, stats, this._resolveTextRasterScope(text.meta, mode))
    const contentWidth = Math.max(0, text.width - style.padding.left - style.padding.right)
    const contentHeight = Math.max(0, text.height - style.padding.top - style.padding.bottom)
    const shape = this._resolveTextRunShape(text.text, style, contentWidth, stats)
    if (shape.glyphs.length === 0) {
      return true
    }
    const { glyphs, advances, lineWidth } = shape
    const horizontalAlign = this._resolveTextOverflowHorizontalAlign(style, shape.sourceLineWidth, contentWidth)
    let cursorX = text.x + style.padding.left
    if (horizontalAlign === 'center') {
      cursorX = text.x + style.padding.left + (contentWidth - lineWidth) / 2
    }
    if (horizontalAlign === 'right') {
      cursorX = text.x + text.width - style.padding.right - lineWidth
    }

    let y = text.y + style.padding.top
    if (style.verticalAlign === 'middle') {
      y = text.y + style.padding.top + (contentHeight - style.lineHeight) / 2
    }
    if (style.verticalAlign === 'bottom') {
      y = text.y + text.height - style.padding.bottom - style.lineHeight
    }

    const color = colorToCss(style.color)
    for (let index = 0; index < glyphs.length; index += 1) {
      const glyph = glyphs[index] ?? ''
      const advance = advances[index] ?? 0
      if (glyph.trim().length === 0) {
        cursorX += advance
        continue
      }

      const entry = this._resolveGlyphAtlasEntry(glyph, style, color, scale, mode, stats)
      if (!entry) {
        return false
      }

      const x = this._resolveGlyphQuadX(cursorX, entry)
      const yPosition = this._resolveGlyphQuadY(y, entry, style)
      const u0 = entry.x / entry.page.width
      const v0 = entry.y / entry.page.height
      const u1 = (entry.x + entry.width) / entry.page.width
      const v1 = (entry.y + entry.height) / entry.page.height
      const clip = text.clip === true ? { x: text.x, y: text.y, width: text.width, height: text.height } : text.clip
      if (mode === 'msdf') {
        this._queueClippedDistanceFieldGlyphQuad(
          entry.page.texture,
          x,
          yPosition,
          entry.drawWidth,
          entry.drawHeight,
          transform,
          color,
          style.opacity,
          entry.pxRange,
          entry.fieldSource === 'prebuilt-msdf' ? 'prebuilt-msdf' : 'runtime-sdf',
          stats,
          u0,
          v0,
          u1,
          v1,
          clip,
        )
      }
      else {
        this._queueClippedTextureQuad(
          entry.page.texture,
          x,
          yPosition,
          entry.drawWidth,
          entry.drawHeight,
          transform,
          style.opacity,
          stats,
          u0,
          v0,
          u1,
          v1,
          clip,
        )
      }
      stats.glyphQuads += 1
      cursorX += entry.advance
    }

    return true
  }

  /**
   * Возвращает left glyph quad с учетом transparent padding внутри atlas entry.
   */
  private _resolveGlyphQuadX(cursorX: number, entry: GlyphAtlasEntry): number {
    return cursorX - this._resolveGlyphPaddingX(entry)
  }

  /**
   * Возвращает top glyph quad так, чтобы line box, а не вся padded texture, центрировался в text box.
   */
  private _resolveGlyphQuadY(lineY: number, entry: GlyphAtlasEntry, style: NovaCompiledTextStyle): number {
    return lineY - this._resolveGlyphPaddingY(entry, style)
  }

  /**
   * Возвращает horizontal padding glyph texture в logical px.
   */
  private _resolveGlyphPaddingX(entry: GlyphAtlasEntry): number {
    return Math.max(0, (entry.drawWidth - entry.advance) / 2)
  }

  /**
   * Возвращает vertical padding glyph texture в logical px.
   */
  private _resolveGlyphPaddingY(entry: GlyphAtlasEntry, style: NovaCompiledTextStyle): number {
    return Math.max(0, (entry.drawHeight - style.lineHeight) / 2)
  }

  /**
   * Возвращает glyph entry из atlas или rasterize-ит новый glyph.
   */
  private _resolveGlyphAtlasEntry(
    glyph: string,
    style: NovaCompiledTextStyle,
    color: string,
    scale: number,
    mode: 'glyph-atlas' | 'msdf',
    stats: RenderStats,
  ): GlyphAtlasEntry | null {
    let fieldSource: 'bitmap' | 'runtime-sdf' | 'prebuilt-msdf' = mode === 'msdf' ? this._resolveGlyphDistanceFieldSource() : 'bitmap'
    let pxRange = mode === 'msdf' && fieldSource !== 'bitmap' ? this._resolveSdfPxRange(fieldSource) : 0
    if (mode === 'msdf' && fieldSource === 'prebuilt-msdf') {
      const prebuiltEntry = this._resolvePrebuiltMsdfGlyphAtlasEntry(glyph, style, stats)
      if (prebuiltEntry) {
        return prebuiltEntry
      }
      fieldSource = 'runtime-sdf'
      pxRange = this._resolveSdfPxRange(fieldSource)
    }
    const keyScale = mode === 'msdf' ? Math.max(0.1, this._device.canvas.dpr).toFixed(3) : scale.toFixed(3)
    const key = mode === 'msdf'
      ? ['glyph', mode, fieldSource, keyScale, style.font, style.lineHeight, pxRange.toFixed(2), glyph].join(':')
      : ['glyph', mode, keyScale, style.font, style.lineHeight, color, glyph].join(':')
    const current = this._glyphAtlasEntries.get(key)
    if (current) {
      stats.glyphCacheHits += 1
      current.lastUsed = this._time
      current.page.lastUsed = this._time
      current.page.pinnedFrame = this._time
      if (mode === 'msdf') {
        stats.msdfGlyphCount += 1
        stats.sdfGlyphCount += 1
        if (current.fieldSource === 'prebuilt-msdf') {
          stats.prebuiltMsdfGlyphCount += 1
        }
        else { stats.runtimeSdfGlyphCount += 1 }
      }
      return current
    }

    const rasterBudgetMs = this._resolveTextRasterBudgetMs(mode)
    if (stats.textRasterMs >= rasterBudgetMs) {
      stats.textRasterDeferred += 1
      stats.textBudgetExhausted += 1
      return null
    }

    stats.glyphCacheMisses += 1
    const rasterStartedAt = performance.now()
    const raster = this._rasterizeGlyph(glyph, style, color, scale, mode, fieldSource, pxRange)
    stats.textRasterMs += performance.now() - rasterStartedAt
    stats.glyphRasterCount += 1
    if (mode === 'msdf') {
      stats.msdfGlyphCount += 1
      stats.sdfGlyphCount += 1
      if (raster.fieldSource === 'prebuilt-msdf') {
        stats.prebuiltMsdfGlyphCount += 1
      }
      else { stats.runtimeSdfGlyphCount += 1 }
    }

    const entry = this._uploadGlyphAtlasEntry(key, raster, mode, stats)
    entry.page.pinnedFrame = this._time
    stats.glyphAtlasPages = this._glyphAtlasPages.length
    return entry
  }

  /**
   * Выполняет rasterize одного glyph в alpha texture.
   */
  private _rasterizeGlyph(
    glyph: string,
    style: NovaCompiledTextStyle,
    color: string,
    scale: number,
    mode: 'glyph-atlas' | 'msdf',
    fieldSource: 'bitmap' | 'runtime-sdf' | 'prebuilt-msdf' = 'bitmap',
    pxRange = 0,
  ): RasterizedGlyph {
    const canvas = this._textRasterCanvas
    const measureContext = this._measureContext(style.font)
    const advance = this._measureGlyphAdvance(measureContext, glyph)
    const padding = mode === 'msdf'
      ? Math.max(this._textConfig.sdf.minPaddingPx, Math.ceil(pxRange / Math.max(1, scale)))
      : 2
    const drawWidth = Math.max(1, Math.ceil(advance + padding * 2))
    const drawHeight = Math.max(1, Math.ceil(style.lineHeight + padding * 2))
    const width = Math.max(1, Math.ceil(drawWidth * scale))
    const height = Math.max(1, Math.ceil(drawHeight * scale))
    canvas.width = width
    canvas.height = height

    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return { canvas, width, height, drawWidth, drawHeight, advance, scale, fieldSource, pxRange }
    }

    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    ctx.clearRect(0, 0, drawWidth, drawHeight)
    ctx.font = style.font
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = mode === 'msdf' ? '#ffffff' : color
    ctx.fillText(glyph, padding, padding + style.fontSize, Math.max(1, advance + padding))
    if (mode === 'msdf' && this._textConfig.sdf.enabled) {
      this._encodeRuntimeSdf(canvas, width, height, pxRange)
    }
    return { canvas, width, height, drawWidth, drawHeight, advance, scale, fieldSource, pxRange }
  }

  private _resolveGlyphDistanceFieldSource(): 'runtime-sdf' | 'prebuilt-msdf' {
    if (!this._textConfig.sdf.enabled) {
      return 'runtime-sdf'
    }
    if (this._textConfig.sdf.source === 'prebuilt-msdf' && this._textConfig.sdf.prebuiltAtlas) {
      return 'prebuilt-msdf'
    }
    return 'runtime-sdf'
  }

  private _resolveSdfPxRange(source: 'runtime-sdf' | 'prebuilt-msdf'): number {
    if (source === 'prebuilt-msdf') {
      return Math.max(1, this._textConfig.sdf.prebuiltAtlas?.pxRange ?? this._textConfig.sdf.pxRange)
    }
    return Math.max(1, this._textConfig.sdf.pxRange)
  }

  private _resolvePrebuiltMsdfGlyphAtlasEntry(
    glyph: string,
    style: NovaCompiledTextStyle,
    stats: RenderStats,
  ): GlyphAtlasEntry | null {
    const atlas = this._textConfig.sdf.prebuiltAtlas
    const metrics = atlas?.glyphs[glyph]
    if (!atlas || !metrics || !atlas.texture) {
      return null
    }

    const source = this._resolvePrebuiltMsdfAtlasSource(atlas.texture)
    if (!source) {
      return null
    }

    const sourceKey = this._assets.resolveDrawableKey('msdf-font', atlas.texture as NovaAssetDrawableInput, source => this._resolveSourceKey(source))
    const fontKey = atlas.fontKey ?? style.font
    const scale = Math.max(0.001, atlas.scale ?? 1)
    const pxRange = Math.max(1, atlas.pxRange ?? this._textConfig.sdf.pxRange)
    const key = ['glyph', 'msdf', 'prebuilt-msdf', fontKey, scale.toFixed(3), pxRange.toFixed(2), sourceKey, glyph].join(':')
    const current = this._glyphAtlasEntries.get(key)
    if (current) {
      current.lastUsed = this._time
      current.page.lastUsed = this._time
      current.page.pinnedFrame = this._time
      stats.glyphCacheHits += 1
      stats.msdfGlyphCount += 1
      stats.prebuiltMsdfGlyphCount += 1
      return current
    }

    stats.glyphCacheMisses += 1
    let page = this._prebuiltMsdfAtlasPages.get(sourceKey)
    if (!page) {
      let texture = this._textures.get(sourceKey)
      if (!texture) {
        texture = this._createTextureFromSource(sourceKey, source, stats)
      }
      const width = texture.width
      const height = texture.height
      page = {
        key: texture.key,
        texture,
        width,
        height,
        cursorX: width,
        cursorY: 0,
        rowHeight: height,
        entries: new Set(),
        lastUsed: this._time,
        generation: texture.generation,
        pinnedFrame: this._time,
      }
      this._prebuiltMsdfAtlasPages.set(sourceKey, page)
      this._glyphAtlasPages.push(page)
    }

    page.entries.add(key)
    page.lastUsed = this._time
    page.pinnedFrame = this._time
    const drawWidth = metrics.drawWidth ?? metrics.width / scale
    const drawHeight = metrics.drawHeight ?? metrics.height / scale
    const entry: GlyphAtlasEntry = {
      key,
      page,
      x: metrics.x,
      y: metrics.y,
      width: metrics.width,
      height: metrics.height,
      drawWidth,
      drawHeight,
      advance: metrics.advance / scale,
      scale,
      mode: 'msdf',
      fieldSource: 'prebuilt-msdf',
      pxRange,
      bytes: 0,
      lastUsed: this._time,
    }
    this._glyphAtlasEntries.set(key, entry)
    stats.msdfGlyphCount += 1
    stats.prebuiltMsdfGlyphCount += 1
    stats.glyphAtlasPages = this._glyphAtlasPages.length
    return entry
  }

  private _resolvePrebuiltMsdfAtlasSource(input: unknown): CanvasImageSource | null {
    const source = this._assets.resolveDrawable(input as NovaAssetDrawableInput)
    if (source) {
      return source
    }
    if (this._isCanvasImageSource(input)) {
      return input
    }
    return null
  }

  private _isCanvasImageSource(value: unknown): value is CanvasImageSource {
    return typeof value === 'object'
      && value !== null
      && (
        (typeof HTMLCanvasElement !== 'undefined' && value instanceof HTMLCanvasElement)
        || (typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap)
        || (typeof OffscreenCanvas !== 'undefined' && value instanceof OffscreenCanvas)
        || (typeof HTMLImageElement !== 'undefined' && value instanceof HTMLImageElement)
        || (typeof HTMLVideoElement !== 'undefined' && value instanceof HTMLVideoElement)
      )
  }

  /**
   * Кодирует single-channel runtime SDF в alpha channel glyph canvas.
   */
  private _encodeRuntimeSdf(canvas: HTMLCanvasElement, width: number, height: number, pxRange: number): void {
    const ctx = canvas.getContext('2d')
    if (!ctx || typeof ctx.getImageData !== 'function' || typeof ctx.putImageData !== 'function') {
      return
    }

    const image = ctx.getImageData(0, 0, width, height)
    const source = image.data
    const target = new Uint8ClampedArray(source.length)
    const radius = Math.max(1, Math.min(64, Math.round(pxRange || this._textConfig.sdf.pxRange)))
    const radiusSq = radius * radius

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4
        const inside = source[offset + 3] > 127
        let bestSq = radiusSq

        for (let oy = -radius; oy <= radius; oy += 1) {
          const sy = y + oy
          if (sy < 0 || sy >= height) {
            continue
          }
          for (let ox = -radius; ox <= radius; ox += 1) {
            const sx = x + ox
            if (sx < 0 || sx >= width) {
              continue
            }
            const distSq = ox * ox + oy * oy
            if (distSq >= bestSq) {
              continue
            }
            const sampleOffset = (sy * width + sx) * 4
            if ((source[sampleOffset + 3] > 127) !== inside) {
              bestSq = distSq
            }
          }
        }

        const signed = (inside ? 1 : -1) * Math.sqrt(bestSq)
        const normalized = Math.max(0, Math.min(1, 0.5 + signed / (radius * 2)))
        target[offset] = 255
        target[offset + 1] = 255
        target[offset + 2] = 255
        target[offset + 3] = Math.round(normalized * 255)
      }
    }

    image.data.set(target)
    ctx.putImageData(image, 0, 0)
  }

  /**
   * Загружает rasterized glyph в glyph atlas.
   */
  private _uploadGlyphAtlasEntry(
    key: string,
    raster: RasterizedGlyph,
    mode: 'glyph-atlas' | 'msdf',
    stats: RenderStats,
  ): GlyphAtlasEntry {
    const page = this._resolveGlyphAtlasPage(raster.width, raster.height, stats)
    const x = page.cursorX
    const y = page.cursorY

    page.cursorX += raster.width
    page.rowHeight = Math.max(page.rowHeight, raster.height)
    page.entries.add(key)
    page.lastUsed = this._time

    const uploadStartedAt = performance.now()
    this._gl.bindTexture(this._gl.TEXTURE_2D, page.texture.texture)
    this._gl.pixelStorei(this._gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    if (typeof this._gl.texSubImage2D === 'function') {
      this._gl.texSubImage2D(
        this._gl.TEXTURE_2D,
        0,
        x,
        y,
        this._gl.RGBA,
        this._gl.UNSIGNED_BYTE,
        raster.canvas as TexImageSource,
      )
    }
    stats.uploadMs += performance.now() - uploadStartedAt

    const bytes = Math.max(1, raster.width * raster.height * 4)
    stats.uploadBytes += bytes
    stats.atlasUploads += 1

    const entry: GlyphAtlasEntry = {
      key,
      page,
      x,
      y,
      width: raster.width,
      height: raster.height,
      drawWidth: raster.drawWidth,
      drawHeight: raster.drawHeight,
      advance: raster.advance,
      scale: raster.scale,
      mode,
      fieldSource: raster.fieldSource,
      pxRange: raster.pxRange,
      bytes,
      lastUsed: this._time,
    }
    this._glyphAtlasEntries.set(key, entry)
    return entry
  }

  /**
   * Возвращает страницу glyph atlas с местом под glyph.
   */
  private _resolveGlyphAtlasPage(width: number, height: number, stats: RenderStats): TextAtlasPage {
    const w = Math.max(1, Math.ceil(width))
    const h = Math.max(1, Math.ceil(height))

    for (const page of this._glyphAtlasPages) {
      const region = this._tryFitTextAtlasPage(page, w, h)
      if (region) {
        return region
      }
    }

    const pageWidth = Math.max(TEXT_ATLAS_PAGE_SIZE, w)
    const pageHeight = Math.max(TEXT_ATLAS_PAGE_SIZE, h)
    const pageBytes = pageWidth * pageHeight * 4
    this._evictGlyphAtlasPagesFor(pageBytes)

    const texture = this._createEmptyGlyphAtlasTexture(pageWidth, pageHeight, stats)
    const page: TextAtlasPage = {
      key: texture.key,
      texture,
      width: pageWidth,
      height: pageHeight,
      cursorX: 0,
      cursorY: 0,
      rowHeight: 0,
      entries: new Set(),
      lastUsed: this._time,
      generation: texture.generation,
      pinnedFrame: 0,
    }
    this._glyphAtlasPages.push(page)
    return page
  }

  /**
   * Создает пустую WebGL texture для glyph atlas page.
   */
  private _createEmptyGlyphAtlasTexture(width: number, height: number, stats: RenderStats): TextureEntry {
    const gl = this._gl
    const texture = gl.createTexture()
    if (!texture) {
      throw new Error('Failed to create WebGL2 glyph atlas texture')
    }

    const uploadStartedAt = performance.now()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    stats.uploadMs += performance.now() - uploadStartedAt

    const bytes = Math.max(1, width * height * 4)
    stats.uploadBytes += bytes
    stats.atlasUploads += 1
    return {
      key: `glyph-atlas:${this._glyphAtlasPages.length + 1}:${this._time}`,
      texture,
      width,
      height,
      bytes,
      lastUsed: this._time,
      generation: this._atlasGeneration,
    }
  }

  /**
   * Освобождает старые glyph atlas pages под memory budget.
   */
  private _evictGlyphAtlasPagesFor(nextPageBytes: number): void {
    const budgetBytes = Math.max(1, this._textConfig.maxGlyphAtlasMemoryMB) * 1024 * 1024
    let bytes = this._glyphAtlasMemoryBytes()
    if (bytes + nextPageBytes <= budgetBytes || this._glyphAtlasPages.length === 0) {
      return
    }

    const pages = [...this._glyphAtlasPages].sort((a, b) => a.lastUsed - b.lastUsed)
    for (const page of pages) {
      if (bytes + nextPageBytes <= budgetBytes && this._glyphAtlasPages.length > 0) {
        break
      }
      if (page.pinnedFrame === this._time) {
        continue
      }

      this._gl.deleteTexture(page.texture.texture)
      const index = this._glyphAtlasPages.indexOf(page)
      if (index >= 0) {
        this._glyphAtlasPages.splice(index, 1)
      }
      for (const key of page.entries) {
        this._glyphAtlasEntries.delete(key)
      }
      bytes -= page.texture.bytes
      this._atlasGeneration += 1
      this._glyphAtlasEvictionCount += 1
    }
  }

  /**
   * Проверяет поддержку glyph path для text item.
   */
  private _isGlyphTextSupported(text: NovaText): boolean {
    if (text.parser === 'markdown') {
      return false
    }
    if (text.styles?.font?.style === 'italic') {
      return false
    }

    if (this._hasComplexGlyphText(text.text)) {
      return false
    }

    return true
  }

  /**
   * Проверяет shaping cases, где glyph-atlas без HarfBuzz может разложить строку некорректно.
   */
  private _hasComplexGlyphText(value: string): boolean {
    if (/(?:^|[^A-Z])(?:ffi|ffl|fi|fl)(?:[^A-Z]|$)/i.test(value)) {
      return true
    }

    for (const glyph of Array.from(value)) {
      const code = glyph.codePointAt(0) ?? 0
      if (this._isComplexGlyphTextCodePoint(code)) {
        return true
      }
    }

    return false
  }

  /**
   * Возвращает true для Unicode ranges, требующих shaping, bidi или combining mark handling.
   */
  private _isComplexGlyphTextCodePoint(code: number): boolean {
    if (code > 0xFFFF) {
      return true
    }
    if (code >= 0x0300 && code <= 0x036F) {
      return true
    }
    if (code >= 0x0590 && code <= 0x05FF) {
      return true
    }
    if (code >= 0x0600 && code <= 0x06FF) {
      return true
    }
    if (code >= 0x0750 && code <= 0x077F) {
      return true
    }
    if (code >= 0x08A0 && code <= 0x08FF) {
      return true
    }
    if (code >= 0x0900 && code <= 0x0DFF) {
      return true
    }
    if (code >= 0x1AB0 && code <= 0x1AFF) {
      return true
    }
    if (code >= 0x1DC0 && code <= 0x1DFF) {
      return true
    }
    if (code >= 0x200C && code <= 0x200D) {
      return true
    }
    if (code >= 0x202A && code <= 0x202E) {
      return true
    }
    if (code >= 0x2066 && code <= 0x2069) {
      return true
    }
    if (code >= 0x20D0 && code <= 0x20FF) {
      return true
    }
    if (code >= 0xFB00 && code <= 0xFDFF) {
      return true
    }
    if (code >= 0xFE00 && code <= 0xFE0F) {
      return true
    }
    if (code >= 0xFE20 && code <= 0xFE2F) {
      return true
    }
    if (code >= 0xFE70 && code <= 0xFEFF) {
      return true
    }
    return false
  }

  /**
   * Вычисляет эффективный режим текста с учетом item metadata и зон.
   */
  private _resolveTextRenderMode(text: NovaText): NovaTextRenderMode {
    const meta = text.meta
    const override = this._normalizeTextRenderMode(meta?.textMode)
    if (override && override !== 'auto') {
      return override
    }

    const role = this._normalizeTextRenderRole(meta?.textRole)
    const roleMode = role ? this._resolveTextRoleMode(role) : undefined
    if (roleMode && roleMode !== 'auto') {
      return roleMode
    }

    const globalMode = this._normalizeTextRenderMode(this._textConfig.mode) ?? 'run-atlas'
    if (globalMode !== 'auto') {
      return globalMode
    }

    return this._resolveAutoTextRenderMode(text, role)
  }

  /**
   * Выбирает text path в auto-режиме по форме строки, а не только по роли.
   */
  private _resolveAutoTextRenderMode(text: NovaText, role: NovaTextRenderRole | undefined): NovaTextRenderMode {
    if (role === 'debug') {
      return 'run-atlas'
    }
    if (this._shouldUseRunAtlasForAutoText(text)) {
      return 'run-atlas'
    }
    if (role === 'timescale' || role === 'task-label') {
      return 'run-atlas'
    }
    return 'run-atlas'
  }

  /**
   * Возвращает true для строк, где run-atlas дешевле или корректнее glyph-atlas.
   */
  private _shouldUseRunAtlasForAutoText(text: NovaText): boolean {
    if (text.parser === 'markdown') {
      return true
    }
    if (text.styles?.font?.style === 'italic') {
      return true
    }
    if (text.styles?.ellipsis) {
      return true
    }
    if (text.clip === true || (typeof text.clip === 'object' && text.clip !== null)) {
      return true
    }
    if (this._hasComplexGlyphText(text.text)) {
      return true
    }
    return this._countTextCodePoints(text.text) > AUTO_GLYPH_LABEL_MAX_CODE_POINTS
  }

  /**
   * Считает Unicode code points для coarse auto-routing эвристики.
   */
  private _countTextCodePoints(value: string): number {
    return Array.from(value).length
  }

  /**
   * Возвращает режим текста для продуктовой роли.
   */
  private _resolveTextRoleMode(role: NovaTextRenderRole): NovaTextRenderMode | undefined {
    if (role === 'timescale') {
      return this._textConfig.modes.timeScale
    }
    if (role === 'task-label') {
      return this._textConfig.modes.taskLabels
    }
    if (role === 'ui-label') {
      return this._textConfig.modes.uiLabels
    }
    return undefined
  }

  /**
   * Нормализует режим текста из metadata.
   */
  private _normalizeTextRenderMode(value: unknown): NovaTextRenderMode | undefined {
    return value === 'auto' || value === 'run-atlas' || value === 'glyph-atlas' || value === 'msdf'
      ? value
      : undefined
  }

  /**
   * Нормализует роль текста из metadata.
   */
  private _normalizeTextRenderRole(value: unknown): NovaTextRenderRole | undefined {
    return value === 'timescale' || value === 'task-label' || value === 'ui-label' || value === 'debug'
      ? value
      : undefined
  }

  /**
   * Возвращает scope bucket state для независимых ролей текста.
   */
  private _resolveTextRasterScope(meta: NovaSchemaItem<any>['meta'] | undefined, mode: NovaTextRenderMode): string {
    const role = this._normalizeTextRenderRole(meta?.textRole) ?? 'default'
    return `${role}:${mode}`
  }

  /**
   * Возвращает context для измерения glyph.
   */
  private _measureContext(font: string): CanvasRenderingContext2D {
    const ctx = this._measureCanvas.getContext('2d')
    if (!ctx) {
      throw new Error('Failed to create text measure context')
    }
    ctx.font = font
    return ctx
  }

  /**
   * Измеряет advance glyph.
   */
  private _measureGlyphAdvance(ctx: CanvasRenderingContext2D, glyph: string): number {
    return Math.max(1, ctx.measureText(glyph).width)
  }

  /**
   * Вычисляет texture raster scale.
   */
  private _resolveTextureRasterScale(items: Array<NovaSchemaItem<any>>, transform: mat3, stats: RenderStats): number | undefined {
    return items.some(item => item.type === 'text') ? this._resolveTextRasterScale(transform, stats, 'schema-texture') : undefined
  }

  /**
   * Вычисляет text raster scale.
   */
  private _resolveTextRasterScale(transform: mat3, stats: RenderStats, scope = 'default'): number {
    const scaleX = Math.hypot(transform[0], transform[1])
    const scaleY = Math.hypot(transform[3], transform[4])
    const zoom = Math.max(0.01, scaleX, scaleY)
    const nextScale = resolveNovaTextRasterScale({
      ...this._textConfig,
      maxRasterScale: this._resolveMaxTextRasterScale(),
    }, zoom, this._device.canvas.dpr)
    let state = this._textRasterBucketStateByScope.get(scope)

    if (!state) {
      state = { scale: nextScale, lastSwitchAt: performance.now() }
      this._textRasterBucketStateByScope.set(scope, state)
      stats.textBucketChanges += 1
      stats.effectiveTextRasterScale = nextScale
      return nextScale
    }

    if (nextScale === state.scale) {
      stats.effectiveTextRasterScale = state.scale
      return state.scale
    }

    if (this._shouldFreezeTextBuckets()) {
      stats.effectiveTextRasterScale = state.scale
      return state.scale
    }

    const throttleMs = Math.max(0, this._textConfig.bucketThrottleMs)
    const now = performance.now()
    if (this._textConfig.fallbackPreviousScale && throttleMs > 0 && now - state.lastSwitchAt < throttleMs) {
      stats.effectiveTextRasterScale = state.scale
      return state.scale
    }

    state.scale = nextScale
    state.lastSwitchAt = now
    stats.textBucketChanges += 1
    stats.effectiveTextRasterScale = nextScale
    return nextScale
  }

  /**
   * Возвращает drawable text atlas item или откладывает растеризацию по frame budget.
   */
  private _resolveTextAtlasItem(
    text: NovaText,
    style: NovaCompiledTextStyle,
    scale: number,
    stats: RenderStats,
    mode: NovaTextRenderMode = 'run-atlas',
  ): TextAtlasDrawableItem | null {
    stats.effectiveTextRasterScale = scale
    const key = this._createTextKey(text, style, scale)
    const current = this._textAtlasEntries.get(key)
    if (current) {
      stats.textCacheHits += 1
      current.lastUsed = this._time
      current.page.lastUsed = this._time
      current.page.pinnedFrame = this._time
      this._prewarmAdjacentTextBuckets(text, style, scale, stats, mode)
      return this._createTextAtlasDrawableItem(current)
    }

    const baseKey = this._createTextBaseKey(text, style)
    const fallback = this._resolveTextFallbackEntry(baseKey, key)
    const rasterBudgetMs = this._resolveTextRasterBudgetMs(mode)
    if (stats.textRasterMs >= rasterBudgetMs) {
      stats.textRasterDeferred += 1
      stats.textBudgetExhausted += 1
      if (fallback && this._textConfig.fallbackPreviousScale) {
        fallback.lastUsed = this._time
        fallback.page.lastUsed = this._time
        fallback.page.pinnedFrame = this._time
        return this._createTextAtlasDrawableItem(fallback)
      }
      return null
    }

    stats.textCacheMisses += 1
    const rasterStartedAt = performance.now()
    const raster = this._rasterizeText(text, style, scale)
    stats.textRasterMs += performance.now() - rasterStartedAt
    stats.textRasterCount += 1
    this._recordTextRasterDiagnostics(raster, stats)

    const entry = this._uploadTextAtlasEntry(key, baseKey, raster, stats)
    entry.page.pinnedFrame = this._time
    this._textFallbackKeys.set(baseKey, key)
    stats.textAtlasPages = this._textAtlasPages.length
    this._prewarmAdjacentTextBuckets(text, style, scale, stats, mode)
    return this._createTextAtlasDrawableItem(entry)
  }

  /**
   * Подготавливает соседние text buckets в рамках оставшегося raster budget.
   */
  private _prewarmAdjacentTextBuckets(
    text: NovaText,
    style: NovaCompiledTextStyle,
    scale: number,
    stats: RenderStats,
    mode: NovaTextRenderMode,
  ): void {
    if (!this._shouldPrewarmTextBuckets(mode)) {
      return
    }

    const budgetMs = this._resolveTextRasterBudgetMs(mode)
    if (stats.textRasterMs >= budgetMs) {
      return
    }

    for (const nextScale of this._resolveAdjacentTextRasterScales(scale)) {
      if (stats.textRasterMs >= budgetMs) {
        stats.textBudgetExhausted += 1
        return
      }

      const key = this._createTextKey(text, style, nextScale)
      if (this._textAtlasEntries.has(key)) {
        continue
      }

      const baseKey = this._createTextBaseKey(text, style)
      const rasterStartedAt = performance.now()
      const raster = this._rasterizeText(text, style, nextScale)
      stats.textRasterMs += performance.now() - rasterStartedAt
      stats.textRasterCount += 1
      this._recordTextRasterDiagnostics(raster, stats)
      this._uploadTextAtlasEntry(key, baseKey, raster, stats)
    }
  }

  /**
   * Возвращает соседние raster scales для prewarm.
   */
  private _resolveAdjacentTextRasterScales(scale: number): Array<number> {
    const dpr = Math.max(0.1, this._device.canvas.dpr)
    const scales = this._textConfig.zoomBuckets
      .map(bucket => Math.min(this._resolveMaxTextRasterScale(), dpr * bucket))
      .filter(bucketScale => Number.isFinite(bucketScale) && bucketScale > 0)
      .sort((a, b) => a - b)
    const index = scales.findIndex(bucketScale => bucketScale === scale)
    if (index < 0) {
      return []
    }

    return [scales[index - 1], scales[index + 1]].filter((item): item is number =>
      typeof item === 'number' && item !== scale,
    )
  }

  /**
   * Возвращает fallback entry другого scale для того же text run.
   */
  private _resolveTextFallbackEntry(baseKey: string, currentKey: string): TextAtlasEntry | null {
    const fallbackKey = this._textFallbackKeys.get(baseKey)
    if (!fallbackKey || fallbackKey === currentKey) {
      return null
    }
    return this._textAtlasEntries.get(fallbackKey) ?? null
  }

  /**
   * Создает drawable item из text atlas entry.
   */
  private _createTextAtlasDrawableItem(entry: TextAtlasEntry): TextAtlasDrawableItem {
    const page = entry.page
    return {
      key: entry.key,
      texture: page.texture,
      offsetX: entry.offsetX,
      offsetY: entry.offsetY,
      width: entry.drawWidth,
      height: entry.drawHeight,
      u0: entry.x / page.width,
      v0: entry.y / page.height,
      u1: (entry.x + entry.width) / page.width,
      v1: (entry.y + entry.height) / page.height,
    }
  }

  /**
   * Возвращает world-space quad для atlas entry с сохранением implicit box clip.
   */
  private _resolveTextAtlasQuad(
    text: NovaText,
    item: TextAtlasDrawableItem,
  ): (NovaRect & { u0: number, v0: number, u1: number, v1: number }) | null {
    return this._clipTextureRect(
      text.x + item.offsetX,
      text.y + item.offsetY,
      item.width,
      item.height,
      item.u0,
      item.v0,
      item.u1,
      item.v1,
      { x: text.x, y: text.y, width: text.width, height: text.height },
    )
  }

  /**
   * Записывает diagnostics по размеру rasterized run-atlas entry.
   */
  private _recordTextRasterDiagnostics(raster: RasterizedText, stats: RenderStats): void {
    const pixels = Math.max(1, raster.width * raster.height)
    stats.textRasterPixels += pixels
    stats.textRasterBytes += pixels * 4
    stats.textRasterBoxPixels += raster.boxPixels
    stats.textRasterSavedPixels += Math.max(0, raster.boxPixels - pixels)
  }

  /**
   * Загружает rasterized text run в atlas page через texSubImage2D.
   */
  private _uploadTextAtlasEntry(key: string, baseKey: string, raster: RasterizedText, stats: RenderStats): TextAtlasEntry {
    const page = this._resolveTextAtlasPage(raster.width, raster.height, stats)
    const x = page.cursorX
    const y = page.cursorY

    page.cursorX += raster.width
    page.rowHeight = Math.max(page.rowHeight, raster.height)
    page.entries.add(key)
    page.lastUsed = this._time

    const uploadStartedAt = performance.now()
    this._gl.bindTexture(this._gl.TEXTURE_2D, page.texture.texture)
    this._gl.pixelStorei(this._gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    if (typeof this._gl.texSubImage2D === 'function') {
      this._gl.texSubImage2D(
        this._gl.TEXTURE_2D,
        0,
        x,
        y,
        this._gl.RGBA,
        this._gl.UNSIGNED_BYTE,
        raster.canvas as TexImageSource,
      )
    }
    stats.uploadMs += performance.now() - uploadStartedAt

    const bytes = Math.max(1, raster.width * raster.height * 4)
    stats.uploadBytes += bytes
    stats.atlasUploads += 1

    const entry: TextAtlasEntry = {
      key,
      baseKey,
      page,
      x,
      y,
      width: raster.width,
      height: raster.height,
      offsetX: raster.offsetX,
      offsetY: raster.offsetY,
      drawWidth: raster.drawWidth,
      drawHeight: raster.drawHeight,
      scale: raster.scale,
      bytes,
      lastUsed: this._time,
    }
    this._textAtlasEntries.set(key, entry)
    return entry
  }

  /**
   * Возвращает atlas page с местом под rasterized text.
   */
  private _resolveTextAtlasPage(width: number, height: number, stats: RenderStats): TextAtlasPage {
    const w = Math.max(1, Math.ceil(width))
    const h = Math.max(1, Math.ceil(height))

    for (const page of this._textAtlasPages) {
      const region = this._tryFitTextAtlasPage(page, w, h)
      if (region) {
        return region
      }
    }

    const pageWidth = Math.max(TEXT_ATLAS_PAGE_SIZE, w)
    const pageHeight = Math.max(TEXT_ATLAS_PAGE_SIZE, h)
    const pageBytes = pageWidth * pageHeight * 4
    this._evictTextAtlasPagesFor(pageBytes)

    const texture = this._createEmptyTextAtlasTexture(pageWidth, pageHeight, stats)
    const page: TextAtlasPage = {
      key: texture.key,
      texture,
      width: pageWidth,
      height: pageHeight,
      cursorX: 0,
      cursorY: 0,
      rowHeight: 0,
      entries: new Set(),
      lastUsed: this._time,
      generation: texture.generation,
      pinnedFrame: 0,
    }
    this._textAtlasPages.push(page)
    return page
  }

  /**
   * Проверяет, поместится ли entry на существующую atlas page.
   */
  private _tryFitTextAtlasPage(page: TextAtlasPage, width: number, height: number): TextAtlasPage | null {
    if (width > page.width || height > page.height) {
      return null
    }

    if (page.cursorX + width > page.width) {
      page.cursorX = 0
      page.cursorY += page.rowHeight
      page.rowHeight = 0
    }

    if (page.cursorY + height > page.height) {
      return null
    }
    return page
  }

  /**
   * Создает пустую WebGL texture для text atlas page.
   */
  private _createEmptyTextAtlasTexture(width: number, height: number, stats: RenderStats): TextureEntry {
    const gl = this._gl
    const texture = gl.createTexture()
    if (!texture) {
      throw new Error('Failed to create WebGL2 text atlas texture')
    }

    const uploadStartedAt = performance.now()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    stats.uploadMs += performance.now() - uploadStartedAt

    const bytes = Math.max(1, width * height * 4)
    stats.uploadBytes += bytes
    stats.atlasUploads += 1
    return {
      key: `text-atlas:${this._textAtlasPages.length + 1}:${this._time}`,
      texture,
      width,
      height,
      bytes,
      lastUsed: this._time,
      generation: this._atlasGeneration,
    }
  }

  /**
   * Освобождает старые text atlas pages под memory budget.
   */
  private _evictTextAtlasPagesFor(nextPageBytes: number): void {
    const budgetBytes = Math.max(1, this._textConfig.maxAtlasMemoryMB) * 1024 * 1024
    let bytes = this._textAtlasMemoryBytes()
    if (bytes + nextPageBytes <= budgetBytes || this._textAtlasPages.length === 0) {
      return
    }

    const pages = [...this._textAtlasPages].sort((a, b) => a.lastUsed - b.lastUsed)
    for (const page of pages) {
      if (bytes + nextPageBytes <= budgetBytes && this._textAtlasPages.length > 0) {
        break
      }
      if (page.pinnedFrame === this._time) {
        continue
      }

      this._gl.deleteTexture(page.texture.texture)
      const index = this._textAtlasPages.indexOf(page)
      if (index >= 0) {
        this._textAtlasPages.splice(index, 1)
      }
      for (const key of page.entries) {
        this._textAtlasEntries.delete(key)
      }
      bytes -= page.texture.bytes
      this._atlasGeneration += 1
      this._textAtlasEvictionCount += 1
    }
  }

  /**
   * Проверяет screen-space видимость rect.
   */
  private _isRectVisible(transform: mat3, x: number, y: number, width: number, height: number): boolean {
    if (width <= 0 || height <= 0) {
      return false
    }

    const bounds = transformRectBounds(transform, x, y, width, height)
    return bounds.x + bounds.width >= 0
      && bounds.y + bounds.height >= 0
      && bounds.x <= this._viewportWidth
      && bounds.y <= this._viewportHeight
  }

  /**
   * Проверяет screen-space LOD для text run и обновляет diagnostics.
   */
  private _shouldDrawTextRun(
    transform: mat3,
    x: number,
    y: number,
    width: number,
    height: number,
    mode: NovaTextRenderMode,
    stats: RenderStats,
    meta?: NovaSchemaItem<any>['meta'],
  ): boolean {
    if (this._shouldCullTextRuns(mode) && !this._isRectVisible(transform, x, y, width, height)) {
      stats.culledTextRuns += 1
      return false
    }

    if (this._shouldDropTextRunByLod(transform, x, y, width, height, meta)) {
      stats.lodDroppedTextRuns += 1
      return false
    }

    if (this._textConfig.lod.enabled && this._textConfig.lod.maxVisibleRuns > 0 && stats.visibleTextRuns >= this._textConfig.lod.maxVisibleRuns) {
      stats.lodDroppedTextRuns += 1
      return false
    }

    stats.visibleTextRuns += 1
    return true
  }

  /**
   * Проверяет, нужно ли скрыть text run по LOD.
   */
  private _shouldDropTextRunByLod(
    transform: mat3,
    x: number,
    y: number,
    width: number,
    height: number,
    meta?: NovaSchemaItem<any>['meta'],
  ): boolean {
    if (!this._textConfig.lod.enabled) {
      return false
    }
    if (meta?.textLod === 'always') {
      return false
    }
    if (meta?.textLod === 'hide-while-moving' && this._textConfig.interaction.mode !== 'stable-quality') {
      return true
    }

    const bounds = transformRectBounds(transform, x, y, width, height)
    const minWidth = Math.max(0, this._textConfig.lod.minScreenWidthPx)
    const minHeight = Math.max(0, this._textConfig.lod.minScreenHeightPx)
    return bounds.width < minWidth || bounds.height < minHeight
  }

  /**
   * Проверяет, включена ли policy-driven culling для text runs.
   */
  private _shouldCullTextRuns(mode: NovaTextRenderMode = 'run-atlas'): boolean {
    return mode !== 'auto' && this._textConfig.visibleOnlyRaster
  }

  /**
   * Проверяет, включен ли culling для texture stream.
   */
  private _shouldCullTextureItems(): boolean {
    return this._textConfig.visibleOnlyRaster
  }

  /**
   * Проверяет, включен ли viewport culling для geometry streams.
   */
  private _shouldCullGeometryItems(): boolean {
    return false
  }

  /**
   * Создает ключ viewport visibility для batches, зависящих от transform.
   */
  private _resolveBatchVisibilityKey(items: Array<NovaSchemaItem<any>>, transform: mat3): string | undefined {
    const hasText = items.some(item => item.type === 'text' || item.type === 'icon')
    if (!hasText || !this._shouldCullTextureItems()) {
      return undefined
    }

    return [
      this._viewportWidth,
      this._viewportHeight,
      transform[0].toFixed(4),
      transform[1].toFixed(4),
      transform[3].toFixed(4),
      transform[4].toFixed(4),
      transform[6].toFixed(2),
      transform[7].toFixed(2),
    ].join('|')
  }

  /**
   * Возвращает frame budget для rasterization с учетом resolved mode и interaction policy.
   */
  private _resolveTextRasterBudgetMs(mode: NovaTextRenderMode): number {
    if (mode === 'auto') {
      return Number.POSITIVE_INFINITY
    }
    if (this._textConfig.interaction.mode !== 'stable-quality') {
      return Math.max(0, Math.min(this._textConfig.rasterBudgetMs, this._textConfig.interaction.rasterBudgetMs))
    }
    return Math.max(0, this._textConfig.rasterBudgetMs)
  }

  /**
   * Проверяет, разрешен ли prewarm соседних buckets.
   */
  private _shouldPrewarmTextBuckets(mode: NovaTextRenderMode): boolean {
    if (mode !== 'run-atlas') {
      return false
    }
    if (!this._textConfig.prewarmAdjacentBuckets) {
      return false
    }
    if (this._textConfig.interaction.mode !== 'stable-quality') {
      return this._textConfig.interaction.prewarm
    }
    return true
  }

  /**
   * Возвращает max raster scale с учетом interaction policy.
   */
  private _resolveMaxTextRasterScale(): number {
    const base = Math.max(0.1, this._textConfig.maxRasterScale)
    if (this._textConfig.interaction.mode === 'stable-quality') {
      return base
    }
    return Math.min(base, Math.max(0.1, this._textConfig.interaction.maxRasterScale))
  }

  /**
   * Проверяет, нужно ли заморозить bucket во время interaction profile.
   */
  private _shouldFreezeTextBuckets(): boolean {
    return this._textConfig.interaction.mode !== 'stable-quality' && this._textConfig.interaction.freezeBuckets
  }

  /**
   * Выполняет внутреннюю операцию draw line.
   */
  private _drawLine(line: NovaLine, transform: mat3, stats: RenderStats): void {
    const style = compileNovaLineStyle(line)
    this._queueSolidLine(line.x1, line.y1, line.x2, line.y2, style.width, style.color, style.opacity, transform, stats, style.dashPattern)
  }

  /**
   * Выполняет внутреннюю операцию draw circle.
   */
  private _drawCircle(circle: NovaCircle, transform: mat3, stats: RenderStats): void {
    const style = compileNovaCircleStyle(circle)
    const diameter = circle.radius * 2
    this._queueRoundedRect(circle.x - circle.radius, circle.y - circle.radius, diameter, diameter, circle.radius, style.fill, style.opacity, style.borderColor, style.borderWidth, transform, stats)
  }

  /**
   * Выполняет внутреннюю операцию draw arc.
   */
  private _drawArc(arc: NovaArc, transform: mat3, stats: RenderStats): void {
    if (arc.radius <= 0) {
      return
    }

    const style = compileNovaArcStyle(arc)
    if (style.width <= 0 || style.color.a <= 0) {
      return
    }

    const fullCircle = Math.PI * 2
    const direction = arc.counterClockwise ? -1 : 1
    let delta = arc.endAngle - arc.startAngle
    if (arc.counterClockwise && delta > 0) {
      delta -= fullCircle
    }
    if (!arc.counterClockwise && delta < 0) {
      delta += fullCircle
    }
    if (Math.abs(delta) <= 0.0001) {
      return
    }

    const length = Math.abs(delta) * arc.radius
    const segments = Math.max(4, Math.min(96, Math.ceil(length / 4)))
    const step = Math.abs(delta) / segments * direction

    let previousAngle = arc.startAngle
    let previousX = arc.x + Math.cos(previousAngle) * arc.radius
    let previousY = arc.y + Math.sin(previousAngle) * arc.radius

    for (let index = 1; index <= segments; index += 1) {
      const angle = index === segments ? arc.startAngle + delta : previousAngle + step
      const x = arc.x + Math.cos(angle) * arc.radius
      const y = arc.y + Math.sin(angle) * arc.radius
      this._queueSolidLine(previousX, previousY, x, y, style.width, style.color, style.opacity, transform, stats)
      previousAngle = angle
      previousX = x
      previousY = y
    }
  }

  /**
   * Выполняет внутреннюю операцию draw polygon.
   */
  private _drawPolygon(polygon: NovaPolygon, transform: mat3, stats: RenderStats): void {
    if (polygon.points.length < 3) {
      return
    }

    const style = compileNovaPolygonStyle(polygon)
    if (style.fill.a > 0) {
      const first = polygon.points[0]
      for (let i = 1; i < polygon.points.length - 1; i += 1) {
        this._queueSolidTriangle(first.x, first.y, polygon.points[i].x, polygon.points[i].y, polygon.points[i + 1].x, polygon.points[i + 1].y, style.fill, style.opacity, transform, stats)
      }
    }

    if (style.stroke.a > 0 && style.lineWidth > 0) {
      for (let i = 0; i < polygon.points.length; i += 1) {
        const a = polygon.points[i]
        const b = polygon.points[(i + 1) % polygon.points.length]
        this._queueSolidLine(a.x, a.y, b.x, b.y, style.lineWidth, style.stroke, style.opacity, transform, stats)
      }
    }
  }

  /**
   * Выполняет внутреннюю операцию draw icon.
   */
  private _drawIcon(icon: NovaIcon, transform: mat3, stats: RenderStats): void {
    const source = this._assets.resolveDrawable(icon.icon)
    if (!source) {
      return
    }
    const key = this._assets.resolveDrawableKey('icon', icon.icon, source => this._resolveSourceKey(source))
    const rect = resolveNovaIconRenderRect(icon, this._device.canvas.dpr)
    const opacity = resolveNovaIconRenderOpacity(icon, this._device.canvas.dpr)
    this._drawTextureSource(key, source, rect.x, rect.y, rect.width, rect.height, transform, opacity, stats)
  }

  /**
   * Выполняет внутреннюю операцию draw nine-slice image.
   */
  private _drawNineSliceImage(image: NovaNineSliceImage, transform: mat3, stats: RenderStats): void {
    const source = this._assets.resolveDrawable(image.image)
    if (!source) {
      return
    }

    const descriptor = this._assets.resolveNineSlice(image.image)
    const sourceWidth = resolveWebGLSourceWidth(source, descriptor?.width)
    const sourceHeight = resolveWebGLSourceHeight(source, descriptor?.height)
    if (sourceWidth <= 0 || sourceHeight <= 0 || image.width <= 0 || image.height <= 0) {
      return
    }

    const texture = this._resolveTextureEntry('nine-slice-image', image.image, stats)
    if (!texture) {
      return
    }

    const slice = normalizeWebGLNineSliceInput(image.slice ?? descriptor?.slice ?? 0)
    const segments = resolveWebGLNineSliceSegments(sourceWidth, sourceHeight, image.x, image.y, image.width, image.height, slice)
    const opacity = image.styles?.opacity ?? 1

    for (const segment of segments) {
      if (segment.dw <= 0 || segment.dh <= 0 || segment.sw <= 0 || segment.sh <= 0) {
        continue
      }
      this._queueTextureQuad(
        texture,
        segment.dx,
        segment.dy,
        segment.dw,
        segment.dh,
        transform,
        opacity,
        stats,
        segment.sx / sourceWidth,
        segment.sy / sourceHeight,
        (segment.sx + segment.sw) / sourceWidth,
        (segment.sy + segment.sh) / sourceHeight,
      )
    }
  }

  /**
   * Рисует процедурный pattern rect одним fullscreen-quad shader проходом.
   */
  private _drawPatternRect(rect: NovaPatternRect, transform: mat3, stats: RenderStats): void {
    if (rect.width <= 0 || rect.height <= 0 || rect.pattern.type !== 'dot-grid') {
      return
    }

    const pattern = rect.pattern
    const color = parseNovaColor(pattern.color)
    const opacity = (rect.styles?.opacity ?? 1) * (pattern.opacity ?? 1)
    if (color.a <= 0 || opacity <= 0) {
      return
    }

    this._flush(stats)

    const gl = this._gl
    const scale = Math.max(0.001, pattern.scale)
    const dotSize = Math.max(0.5, pattern.size ?? Math.min(2.5, Math.max(1, 2.4 * scale)))
    this._patternRectProgram.use()
    gl.bindVertexArray(this._patternRectVao)
    gl.uniform2f(this._patternRectProgram.uniformLocation('u_resolution'), this._renderResolutionWidth, this._renderResolutionHeight)
    gl.uniformMatrix3fv(this._patternRectProgram.uniformLocation('u_transform'), false, transform)
    gl.uniform4f(this._patternRectProgram.uniformLocation('u_rect'), rect.x, rect.y, rect.width, rect.height)
    gl.uniform2f(this._patternRectProgram.uniformLocation('u_origin'), pattern.originX, pattern.originY)
    gl.uniform1f(this._patternRectProgram.uniformLocation('u_worldStep'), Math.max(0.001, pattern.worldStep))
    gl.uniform1f(this._patternRectProgram.uniformLocation('u_scale'), scale)
    gl.uniform1f(this._patternRectProgram.uniformLocation('u_minScreenStep'), Math.max(1, pattern.minScreenStep ?? 8))
    gl.uniform1f(this._patternRectProgram.uniformLocation('u_dotSize'), dotSize)
    gl.uniform1f(this._patternRectProgram.uniformLocation('u_shape'), pattern.shape === 'circle' ? 1 : 0)
    gl.uniform4f(this._patternRectProgram.uniformLocation('u_color'), color.r, color.g, color.b, color.a * opacity)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
    gl.bindVertexArray(null)

    stats.drawCalls += 1
    stats.batches += 1
    stats.instances += 1
  }

  /**
   * Рисует retained rect batch через specialized instanced stream.
   */
  private _drawRectBatch(batch: NovaRectBatch, transform: mat3, stats: RenderStats): void {
    if (batch.active === false || batch.count <= 0) {
      return
    }

    let cache = this._rectStreamBatchCache.get(batch)
    const revision = batch.revision ?? 0
    const staticRevision = batch.staticRevision ?? 0
    let geometryDirty: Array<FloatDirtyRange> | null = null
    let staticDirty: Array<FloatDirtyRange> | null = null

    if (!cache || cache.count !== batch.count) {
      cache = this._createRectStreamBatchCache(batch)
      this._rectStreamBatchCache.set(batch, cache)
      this._ownedRectStreamBatchCaches.add(cache)
    }

    if (cache.revision !== revision) {
      this._writeRectBatchGeometry(batch, cache.geometryData)
      cache.revision = revision
      geometryDirty = [{ start: 0, end: batch.count * RECT_BATCH_GEOMETRY_STRIDE }]
    }

    if (cache.staticRevision !== staticRevision) {
      this._writeRectBatchStaticData(batch, cache.staticData)
      cache.staticRevision = staticRevision
      staticDirty = [{ start: 0, end: batch.count * RECT_BATCH_STATIC_STRIDE }]
    }

    this._flush(stats)
    const uploadStartedAt = performance.now()
    const gl = this._gl
    gl.bindVertexArray(cache.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, cache.geometryBuffer)
    this._uploadArrayBuffer(cache.geometryData, cache.geometryUpload, stats, geometryDirty)
    gl.bindBuffer(gl.ARRAY_BUFFER, cache.staticBuffer)
    this._uploadArrayBuffer(cache.staticData, cache.staticUpload, stats, staticDirty)
    stats.uploadMs += performance.now() - uploadStartedAt

    this._rectBatchProgram.use()
    gl.uniform2f(this._rectBatchProgram.uniformLocation('u_resolution'), this._renderResolutionWidth, this._renderResolutionHeight)
    gl.uniformMatrix3fv(this._rectBatchProgram.uniformLocation('u_transform'), false, transform)
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, batch.count)

    stats.instances += batch.count
    stats.drawCalls += 1
    stats.batches += 1
    if (geometryDirty || staticDirty) {
      stats.updatedHandles += batch.count
      stats.dirtyStreamRanges += Number(Boolean(geometryDirty)) + Number(Boolean(staticDirty))
    }
  }

  /**
   * Рисует retained time-range segment batch, вычисляя x/width в shader uniforms.
   */
  private _drawTimeRangeSegmentBatch(batch: NovaTimeRangeSegmentBatch, transform: mat3, stats: RenderStats): void {
    if (batch.active === false || batch.count <= 0) {
      return
    }

    let cache = this._timeRangeSegmentBatchCache.get(batch)
    const revision = batch.revision ?? 0
    const staticRevision = batch.staticRevision ?? 0
    let geometryDirty: Array<FloatDirtyRange> | null = null
    let staticDirty: Array<FloatDirtyRange> | null = null

    if (!cache || cache.count !== batch.count) {
      cache = this._createTimeRangeSegmentBatchCache(batch)
      this._timeRangeSegmentBatchCache.set(batch, cache)
      this._ownedTimeRangeSegmentBatchCaches.add(cache)
    }

    if (cache.revision !== revision) {
      this._writeTimeRangeSegmentGeometry(batch, cache.geometryData)
      cache.revision = revision
      geometryDirty = [{ start: 0, end: batch.count * TIME_RANGE_SEGMENT_GEOMETRY_STRIDE }]
    }

    if (cache.staticRevision !== staticRevision) {
      this._writeTimeRangeSegmentStaticData(batch, cache.staticData)
      cache.staticRevision = staticRevision
      staticDirty = [{ start: 0, end: batch.count * TIME_RANGE_SEGMENT_STATIC_STRIDE }]
    }

    this._flush(stats)
    const uploadStartedAt = performance.now()
    const gl = this._gl
    gl.bindVertexArray(cache.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, cache.geometryBuffer)
    this._uploadArrayBuffer(cache.geometryData, cache.geometryUpload, stats, geometryDirty)
    gl.bindBuffer(gl.ARRAY_BUFFER, cache.staticBuffer)
    this._uploadArrayBuffer(cache.staticData, cache.staticUpload, stats, staticDirty)
    stats.uploadMs += performance.now() - uploadStartedAt

    this._timeRangeSegmentProgram.use()
    gl.uniform2f(this._timeRangeSegmentProgram.uniformLocation('u_resolution'), this._device.canvas.width, this._device.canvas.height)
    gl.uniformMatrix3fv(this._timeRangeSegmentProgram.uniformLocation('u_transform'), false, transform)
    gl.uniform1f(this._timeRangeSegmentProgram.uniformLocation('u_timeStart'), batch.timeStart)
    gl.uniform1f(this._timeRangeSegmentProgram.uniformLocation('u_pxPerMs'), batch.pxPerMs)
    gl.uniform1f(this._timeRangeSegmentProgram.uniformLocation('u_viewportX'), batch.viewportX)
    gl.uniform1f(this._timeRangeSegmentProgram.uniformLocation('u_yOffset'), batch.yOffset)
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, batch.count)

    stats.instances += batch.count
    stats.drawCalls += 1
    stats.batches += 1
    if (geometryDirty || staticDirty) {
      stats.updatedHandles += batch.count
      stats.dirtyStreamRanges += Number(Boolean(geometryDirty)) + Number(Boolean(staticDirty))
    }
  }

  /**
   * Рисует retained stripe batch через texture repeat stream.
   */
  private _drawStripeBatch(batch: NovaStripeRectBatch, transform: mat3, stats: RenderStats): void {
    if (batch.active === false || batch.count <= 0) {
      return
    }

    const cache = this._resolveStripeStreamBatchCache(batch)
    if (cache) {
      this._drawStripeStreamBatchCache(cache, transform, stats)
      return
    }

    this._drawStripeTextureFallbackBatch(batch, transform, stats)
  }

  /**
   * Рисует retained icon batch через texture stream.
   */
  private _drawIconBatch(batch: NovaIconBatch, transform: mat3, stats: RenderStats): void {
    if (batch.active === false || batch.count <= 0) {
      return
    }

    const cache = this._resolveIconStreamBatchCache(batch, stats)
    if (!cache) {
      return
    }

    this._drawTextureRectStreamBatchCache(cache, transform, stats)
  }

  /**
   * Рисует retained text batch через retained text atlas.
   */
  private _drawTextBatch(batch: NovaTextBatch, transform: mat3, stats: RenderStats): void {
    if (batch.active === false || batch.count <= 0) {
      return
    }

    const mode = this._resolveTextBatchRenderMode(batch)
    if (mode === 'glyph-atlas' || mode === 'msdf') {
      this._drawGlyphTextBatch(batch, mode, transform, stats)
      return
    }

    const cache = this._resolveTextStreamBatchCache(batch, transform, stats)
    if (!cache) {
      return
    }

    this._drawTextureRectStreamBatchCache(cache, transform, stats)
  }

  /**
   * Выбирает text path для retained batch без полного прохода по всем строкам.
   */
  private _resolveTextBatchRenderMode(batch: NovaTextBatch): NovaTextRenderMode {
    const meta = batch.meta
    const override = this._normalizeTextRenderMode(meta?.textMode)
    if (override && override !== 'auto') {
      return override
    }

    const role = this._normalizeTextRenderRole(meta?.textRole)
    const roleMode = role ? this._resolveTextRoleMode(role) : undefined
    if (roleMode && roleMode !== 'auto') {
      return roleMode
    }

    const globalMode = this._normalizeTextRenderMode(this._textConfig.mode) ?? 'run-atlas'
    if (globalMode !== 'auto') {
      return globalMode
    }

    return this._resolveAutoTextBatchRenderMode(batch, role)
  }

  /**
   * Выбирает auto text path для retained batch.
   */
  private _resolveAutoTextBatchRenderMode(batch: NovaTextBatch, role: NovaTextRenderRole | undefined): NovaTextRenderMode {
    if (role === 'debug') {
      return 'run-atlas'
    }
    if (this._shouldUseRunAtlasForAutoTextBatch(batch)) {
      return 'run-atlas'
    }
    if (role === 'timescale' || role === 'task-label') {
      return 'run-atlas'
    }
    return 'run-atlas'
  }

  /**
   * Проверяет bounded sample batch-а для auto-routing.
   */
  private _shouldUseRunAtlasForAutoTextBatch(batch: NovaTextBatch): boolean {
    if (batch.ellipsis) {
      return true
    }
    if (batch.clipX || batch.clipY || batch.clipWidth || batch.clipHeight) {
      return true
    }

    const sampleCount = Math.min(batch.count, AUTO_TEXT_BATCH_SAMPLE_LIMIT)
    const step = Math.max(1, Math.floor(batch.count / Math.max(1, sampleCount)))
    for (let sample = 0, index = 0; sample < sampleCount && index < batch.count; sample += 1, index += step) {
      const value = batch.text[index] ?? ''
      if (this._hasComplexGlyphText(value)) {
        return true
      }
      if (this._countTextCodePoints(value) > AUTO_GLYPH_LABEL_MAX_CODE_POINTS) {
        return true
      }
    }

    return false
  }

  /**
   * Рисует retained text batch через glyph/MSDF atlas.
   */
  private _drawGlyphTextBatch(
    batch: NovaTextBatch,
    mode: 'glyph-atlas' | 'msdf',
    transform: mat3,
    stats: RenderStats,
  ): void {
    if (this._textConfig.glyphs.retainedBatches) {
      const cache = this._resolveGlyphTextBatchCache(batch, mode, transform, stats)
      if (cache) {
        this._drawGlyphTextBatchCache(cache, transform, stats)
        return
      }
    }

    const styleBase = this._createTextBatchStyleBase(batch)

    for (let index = 0; index < batch.count; index += 1) {
      const color = Array.isArray(batch.color) ? batch.color[index] : batch.color
      const text: NovaText = {
        text: batch.text[index] ?? '',
        x: batch.x[index] ?? 0,
        y: batch.y[index] ?? 0,
        width: batch.width[index] ?? 0,
        height: batch.height[index] ?? 0,
        clip: this._resolveTextBatchClip(batch, index) ?? undefined,
        styles: {
          ...styleBase,
          color: color ?? styleBase.color,
        },
        meta: batch.meta,
      }

      if (!this._shouldDrawTextRun(transform, text.x, text.y, text.width, text.height, mode, stats, text.meta)) {
        continue
      }

      const style = compileNovaTextStyle(text)
      if (this._drawGlyphText(text, style, mode, transform, stats)) {
        continue
      }

      stats.textModeFallbacks += 1
      const scale = this._resolveTextRasterScale(transform, stats, this._resolveTextRasterScope(text.meta, 'run-atlas'))
      const atlasItem = this._resolveTextAtlasItem(text, style, scale, stats, 'run-atlas')
      if (!atlasItem) {
        continue
      }
      const quad = this._resolveTextAtlasQuad(text, atlasItem)
      if (!quad) {
        continue
      }

      this._queueClippedTextureQuad(
        atlasItem.texture,
        quad.x,
        quad.y,
        quad.width,
        quad.height,
        transform,
        style.opacity,
        stats,
        quad.u0,
        quad.v0,
        quad.u1,
        quad.v1,
        text.clip === true ? { x: text.x, y: text.y, width: text.width, height: text.height } : text.clip,
      )
    }
  }

  /**
   * Возвращает retained glyph text cache.
   */
  private _resolveGlyphTextBatchCache(
    batch: NovaTextBatch,
    mode: 'glyph-atlas' | 'msdf',
    transform: mat3,
    stats: RenderStats,
  ): GlyphTextBatchCache | null {
    const revision = batch.revision ?? 0
    const staticRevision = batch.staticRevision ?? 0
    const visibilityKey = this._resolveTextBatchVisibilityKey(transform, mode)
    let cache = this._glyphTextBatchCache.get(batch) ?? null

    if (
      !cache
      || cache.count !== batch.count
      || cache.mode !== mode
      || cache.staticRevision !== staticRevision
      || cache.visibilityKey !== visibilityKey
      || cache.incomplete
      || this._isGlyphTextBatchCacheStale(cache)
    ) {
      cache = this._createGlyphTextBatchCache(batch, mode, transform, stats, visibilityKey)
      if (!cache) {
        return null
      }
      this._glyphTextBatchCache.set(batch, cache)
      return cache
    }

    if (cache.revision !== revision) {
      if (!this._updateGlyphTextBatchCache(cache, batch, mode, transform, stats)) {
        cache = this._createGlyphTextBatchCache(batch, mode, transform, stats, visibilityKey)
        if (!cache) {
          return null
        }
        this._glyphTextBatchCache.set(batch, cache)
        return cache
      }
      cache.revision = revision
    }

    return cache
  }

  /**
   * Создает retained glyph text cache.
   */
  private _createGlyphTextBatchCache(
    batch: NovaTextBatch,
    mode: 'glyph-atlas' | 'msdf',
    transform: mat3,
    stats: RenderStats,
    visibilityKey: string | undefined,
  ): GlyphTextBatchCache | null {
    const builders = new Map<string, {
      texture: TextureEntry
      quads: Array<GlyphTextQuad>
      labelRanges: Map<number, GlyphTextLabelRange>
    }>()
    const styleBase = this._createTextBatchStyleBase(batch)
    let incomplete = false

    for (let index = 0; index < batch.count; index += 1) {
      if (!this._isGlyphTextSupported(this._createTextFromBatch(batch, index, styleBase))) {
        return null
      }
    }

    for (let index = 0; index < batch.count; index += 1) {
      const text = this._createTextFromBatch(batch, index, styleBase)
      if (!this._shouldDrawTextRun(transform, text.x, text.y, text.width, text.height, mode, stats, text.meta)) {
        continue
      }

      const style = compileNovaTextStyle(text)
      const quads = this._createGlyphTextQuads(text, style, mode, transform, stats)
      if (!quads) {
        incomplete = true
        continue
      }

      for (const quad of quads) {
        let builder = builders.get(quad.texture.key)
        if (!builder) {
          builder = { texture: quad.texture, quads: [], labelRanges: new Map() }
          builders.set(quad.texture.key, builder)
        }
        const start = builder.quads.length
        builder.quads.push(quad)
        const current = builder.labelRanges.get(index)
        if (current) {
          current.end = builder.quads.length
        }
        else {
          builder.labelRanges.set(index, { start, end: builder.quads.length })
        }
      }
    }

    return {
      count: batch.count,
      revision: batch.revision ?? 0,
      staticRevision: batch.staticRevision ?? 0,
      visibilityKey,
      mode,
      incomplete,
      groups: [...builders.values()].map(builder => this._createGlyphTextStreamGroupCache(builder.texture, builder.quads, builder.labelRanges)),
    }
  }

  /**
   * Обновляет dirty ranges retained glyph cache, если topology glyph groups не изменилась.
   */
  private _updateGlyphTextBatchCache(
    cache: GlyphTextBatchCache,
    batch: NovaTextBatch,
    mode: 'glyph-atlas' | 'msdf',
    transform: mat3,
    stats: RenderStats,
  ): boolean {
    const dirtyIndices = batch.dirtyIndices
    if (!dirtyIndices || dirtyIndices.length === 0) {
      return false
    }

    const groupsByTexture = new Map(cache.groups.map(group => [group.texture.key, group]))
    const styleBase = this._createTextBatchStyleBase(batch)

    for (const index of dirtyIndices) {
      if (index < 0 || index >= batch.count) {
        continue
      }
      const text = this._createTextFromBatch(batch, index, styleBase)
      if (!this._isGlyphTextSupported(text)) {
        return false
      }
      if (!this._shouldDrawTextRun(transform, text.x, text.y, text.width, text.height, mode, stats, text.meta)) {
        continue
      }

      const style = compileNovaTextStyle(text)
      const quads = this._createGlyphTextQuads(text, style, mode, transform, stats)
      if (!quads) {
        return false
      }

      const nextByGroup = new Map<string, Array<GlyphTextQuad>>()
      for (const quad of quads) {
        const list = nextByGroup.get(quad.texture.key) ?? []
        list.push(quad)
        nextByGroup.set(quad.texture.key, list)
      }

      for (const [textureKey, group] of groupsByTexture) {
        const range = group.labelRanges.get(index)
        const nextQuads = nextByGroup.get(textureKey) ?? []
        const currentCount = range ? range.end - range.start : 0
        if (currentCount !== nextQuads.length) {
          return false
        }
        if (!range) {
          continue
        }

        for (let itemIndex = 0; itemIndex < nextQuads.length; itemIndex += 1) {
          const quad = nextQuads[itemIndex]
          if (!quad) {
            continue
          }
          this._writeGlyphTextQuad(group, range.start + itemIndex, quad)
        }
        group.geometryDirtyRanges = mergeFloatDirtyRanges([
          ...(group.geometryDirtyRanges ?? []),
          { start: range.start * TEXTURE_RECT_BATCH_GEOMETRY_STRIDE, end: range.end * TEXTURE_RECT_BATCH_GEOMETRY_STRIDE },
        ])
        group.staticDirtyRanges = mergeFloatDirtyRanges([
          ...(group.staticDirtyRanges ?? []),
          { start: range.start * this._resolveGlyphTextStaticStride(group.mode), end: range.end * this._resolveGlyphTextStaticStride(group.mode) },
        ])
        stats.glyphGeometryUploads += 1
      }
    }

    return true
  }

  /**
   * Создает retained glyph stream group.
   */
  private _createGlyphTextStreamGroupCache(
    texture: TextureEntry,
    quads: Array<GlyphTextQuad>,
    labelRanges: Map<number, GlyphTextLabelRange>,
  ): GlyphTextStreamGroupCache {
    const geometryBuffer = this._createBuffer()
    const staticBuffer = this._createBuffer()
    const mode = quads.some(quad => quad.fieldMode > 0 || quad.pxRange > 0) ? 'msdf' : 'glyph-atlas'
    const staticStride = this._resolveGlyphTextStaticStride(mode)
    const group: GlyphTextStreamGroupCache = {
      texture,
      textureGeneration: texture.generation,
      geometryData: new Float32Array(quads.length * TEXTURE_RECT_BATCH_GEOMETRY_STRIDE),
      staticData: new Float32Array(quads.length * staticStride),
      count: quads.length,
      mode,
      labelRanges,
      geometryDirtyRanges: null,
      staticDirtyRanges: null,
      geometryUpload: createWebGLUploadState(),
      staticUpload: createWebGLUploadState(),
      geometryBuffer,
      staticBuffer,
      vao: mode === 'msdf'
        ? this._createDistanceFieldGlyphBatchVao(geometryBuffer, staticBuffer)
        : this._createTextureRectBatchVao(geometryBuffer, staticBuffer),
    }

    for (let index = 0; index < quads.length; index += 1) {
      const quad = quads[index]
      if (quad) {
        this._writeGlyphTextQuad(group, index, quad)
      }
    }
    this._ownedGlyphTextStreamGroupCaches.add(group)
    return group
  }

  /**
   * Записывает один glyph quad в retained buffers.
   */
  private _writeGlyphTextQuad(group: GlyphTextStreamGroupCache, index: number, quad: GlyphTextQuad): void {
    const geometryOffset = index * TEXTURE_RECT_BATCH_GEOMETRY_STRIDE
    group.geometryData[geometryOffset] = quad.x
    group.geometryData[geometryOffset + 1] = quad.y
    group.geometryData[geometryOffset + 2] = quad.width
    group.geometryData[geometryOffset + 3] = quad.height

    const staticOffset = index * this._resolveGlyphTextStaticStride(group.mode)
    group.staticData[staticOffset] = quad.u0
    group.staticData[staticOffset + 1] = quad.v0
    group.staticData[staticOffset + 2] = quad.u1
    group.staticData[staticOffset + 3] = quad.v1
    group.staticData[staticOffset + 4] = quad.opacity
    if (group.mode === 'msdf') {
      group.staticData[staticOffset + 5] = quad.color.r
      group.staticData[staticOffset + 6] = quad.color.g
      group.staticData[staticOffset + 7] = quad.color.b
      group.staticData[staticOffset + 8] = quad.color.a
      group.staticData[staticOffset + 9] = quad.pxRange
      group.staticData[staticOffset + 10] = quad.fieldMode
    }
  }

  private _resolveGlyphTextStaticStride(mode: 'glyph-atlas' | 'msdf'): number {
    return mode === 'msdf' ? DISTANCE_FIELD_GLYPH_STATIC_STRIDE : TEXTURE_RECT_BATCH_STATIC_STRIDE
  }

  /**
   * Рисует retained glyph text cache.
   */
  private _drawGlyphTextBatchCache(cache: GlyphTextBatchCache, transform: mat3, stats: RenderStats): void {
    for (const group of cache.groups) {
      if (group.count <= 0 || !this._isTextureAlive(group.texture, cache.mode)) {
        continue
      }

      this._flush(stats)
      const uploadStartedAt = performance.now()
      const gl = this._gl
      gl.bindVertexArray(group.vao)
      gl.bindBuffer(gl.ARRAY_BUFFER, group.geometryBuffer)
      this._uploadArrayBuffer(group.geometryData, group.geometryUpload, stats, group.geometryDirtyRanges)
      gl.bindBuffer(gl.ARRAY_BUFFER, group.staticBuffer)
      this._uploadArrayBuffer(group.staticData, group.staticUpload, stats, group.staticDirtyRanges)
      stats.uploadMs += performance.now() - uploadStartedAt
      group.geometryDirtyRanges = null
      group.staticDirtyRanges = null

      const program = group.mode === 'msdf' ? this._distanceFieldTextProgram : this._textureRectBatchProgram
      program.use()
      gl.uniform2f(program.uniformLocation('u_resolution'), this._renderResolutionWidth, this._renderResolutionHeight)
      gl.uniformMatrix3fv(program.uniformLocation('u_transform'), false, transform)
      if (group.mode === 'msdf') {
        gl.uniform1f(program.uniformLocation('u_edgeSoftness'), Math.max(0.1, this._textConfig.sdf.edgeSoftness))
        gl.uniform1i(program.uniformLocation('u_instanced'), 1)
      }
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, group.texture.texture)
      gl.uniform1i(program.uniformLocation('u_texture'), 0)
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, group.count)

      stats.instances += group.count
      stats.glyphQuads += group.count
      if (group.mode === 'msdf') {
        stats.distanceFieldGlyphQuads += group.count
        stats.distanceFieldDrawCalls += 1
      }
      stats.drawCalls += 1
      stats.batches += 1
    }
  }

  /**
   * Проверяет, что retained glyph cache не ссылается на evicted atlas pages.
   */
  private _isGlyphTextBatchCacheStale(cache: GlyphTextBatchCache): boolean {
    return cache.groups.some(group =>
      group.textureGeneration !== group.texture.generation || !this._isTextureAlive(group.texture, cache.mode),
    )
  }

  /**
   * Проверяет, что retained run-atlas cache не ссылается на evicted atlas pages.
   */
  private _isTextStreamBatchCacheStale(cache: TextureRectStreamBatchCache): boolean {
    return cache.groups.some(group => !this._isTextureAlive(group.texture, 'run-atlas'))
  }

  /**
   * Проверяет, что retained source texture cache не ссылается на evicted textures.
   */
  private _isSourceTextureStreamBatchCacheStale(cache: TextureRectStreamBatchCache): boolean {
    return cache.groups.some(group => !this._isSourceTextureAlive(group.texture))
  }

  /**
   * Создает glyph quads для одного text run.
   */
  private _createGlyphTextQuads(
    text: NovaText,
    style: NovaCompiledTextStyle,
    mode: 'glyph-atlas' | 'msdf',
    transform: mat3,
    stats: RenderStats,
  ): Array<GlyphTextQuad> | null {
    const scale = mode === 'msdf'
      ? Math.min(this._resolveMaxTextRasterScale(), Math.max(0.1, this._device.canvas.dpr))
      : this._resolveTextRasterScale(transform, stats, this._resolveTextRasterScope(text.meta, mode))
    const contentWidth = Math.max(0, text.width - style.padding.left - style.padding.right)
    const contentHeight = Math.max(0, text.height - style.padding.top - style.padding.bottom)
    const shape = this._resolveTextRunShape(text.text, style, contentWidth, stats)
    if (shape.glyphs.length === 0) {
      return []
    }

    const horizontalAlign = this._resolveTextOverflowHorizontalAlign(style, shape.sourceLineWidth, contentWidth)
    let cursorX = text.x + style.padding.left
    if (horizontalAlign === 'center') {
      cursorX = text.x + style.padding.left + (contentWidth - shape.lineWidth) / 2
    }
    if (horizontalAlign === 'right') {
      cursorX = text.x + text.width - style.padding.right - shape.lineWidth
    }

    let y = text.y + style.padding.top
    if (style.verticalAlign === 'middle') {
      y = text.y + style.padding.top + (contentHeight - style.lineHeight) / 2
    }
    if (style.verticalAlign === 'bottom') {
      y = text.y + text.height - style.padding.bottom - style.lineHeight
    }

    const color = colorToCss(style.color)
    const quads: Array<GlyphTextQuad> = []
    for (let index = 0; index < shape.glyphs.length; index += 1) {
      const glyph = shape.glyphs[index] ?? ''
      const advance = shape.advances[index] ?? 0
      if (glyph.trim().length === 0) {
        cursorX += advance
        continue
      }

      const entry = this._resolveGlyphAtlasEntry(glyph, style, color, scale, mode, stats)
      if (!entry) {
        return null
      }
      entry.page.pinnedFrame = this._time
      stats.pinnedAtlasPages += 1
      const u0 = entry.x / entry.page.width
      const v0 = entry.y / entry.page.height
      const u1 = (entry.x + entry.width) / entry.page.width
      const v1 = (entry.y + entry.height) / entry.page.height
      const clip = text.clip === true ? { x: text.x, y: text.y, width: text.width, height: text.height } : text.clip
      const clipped = this._clipTextureRect(
        this._resolveGlyphQuadX(cursorX, entry),
        this._resolveGlyphQuadY(y, entry, style),
        entry.drawWidth,
        entry.drawHeight,
        u0,
        v0,
        u1,
        v1,
        clip,
      )
      if (clipped) {
        quads.push({
          texture: entry.page.texture,
          x: clipped.x,
          y: clipped.y,
          width: clipped.width,
          height: clipped.height,
          u0: clipped.u0,
          v0: clipped.v0,
          u1: clipped.u1,
          v1: clipped.v1,
          opacity: style.opacity,
          color: parseNovaColor(color),
          pxRange: mode === 'msdf' ? entry.pxRange : 0,
          fieldMode: entry.fieldSource === 'prebuilt-msdf' ? 1 : 0,
        })
      }
      cursorX += entry.advance
    }

    return quads
  }

  /**
   * Возвращает shaped run из LRU cache.
   */
  private _resolveTextRunShape(text: string, style: NovaCompiledTextStyle, contentWidth: number, stats: RenderStats): TextRunShape {
    const key = [
      style.font,
      style.lineHeight,
      style.ellipsis ? Math.round(contentWidth * 100) / 100 : 'plain',
      text,
    ].join(':')
    const current = this._textRunShapeCache.get(key)
    if (current) {
      current.lastUsed = this._time
      stats.textRunCacheHits += 1
      return current
    }

    stats.textRunCacheMisses += 1
    const startedAt = performance.now()
    const measureContext = this._measureContext(style.font)
    const sourceLineWidth = measureContext.measureText(text).width
    const renderedText = style.ellipsis ? ellipsizeText(measureContext, text, contentWidth) : text
    const glyphs = Array.from(renderedText)
    const advances = new Float32Array(glyphs.length)
    let lineWidth = 0
    for (let index = 0; index < glyphs.length; index += 1) {
      const advance = this._measureGlyphAdvance(measureContext, glyphs[index] ?? '')
      advances[index] = advance
      lineWidth += advance
    }
    stats.textShapeMs += performance.now() - startedAt

    const shape: TextRunShape = {
      key,
      glyphs,
      advances,
      lineWidth,
      sourceLineWidth,
      lastUsed: this._time,
    }
    this._textRunShapeCache.set(key, shape)
    this._evictTextRunShapeCache()
    return shape
  }

  /**
   * Повторяет старое поведение Canvas renderer: если строка не помещается в
   * content-box, center/right превращаются в left, чтобы clip показывал начало.
   */
  private _resolveTextOverflowHorizontalAlign(
    style: NovaCompiledTextStyle,
    lineWidth: number,
    contentWidth: number,
  ): NovaCompiledTextStyle['horizontalAlign'] {
    if (style.overflowAlign === 'start' && lineWidth > contentWidth) {
      return 'left'
    }

    return style.horizontalAlign
  }

  /**
   * Ограничивает размер shaped run cache.
   */
  private _evictTextRunShapeCache(): void {
    const limit = Math.max(0, Math.floor(this._textConfig.glyphs.shapeCacheEntries))
    if (limit <= 0) {
      this._textRunShapeCache.clear()
      return
    }
    if (this._textRunShapeCache.size <= limit) {
      return
    }

    const overflow = this._textRunShapeCache.size - limit
    const entries = [...this._textRunShapeCache.values()].sort((a, b) => a.lastUsed - b.lastUsed)
    for (let index = 0; index < overflow; index += 1) {
      const entry = entries[index]
      if (entry) {
        this._textRunShapeCache.delete(entry.key)
      }
    }
  }

  /**
   * Возвращает NovaText для item retained text batch.
   */
  private _createTextFromBatch(batch: NovaTextBatch, index: number, styleBase: NonNullable<NovaText['styles']>): NovaText {
    const color = Array.isArray(batch.color) ? batch.color[index] : batch.color
    return {
      text: batch.text[index] ?? '',
      x: batch.x[index] ?? 0,
      y: batch.y[index] ?? 0,
      width: batch.width[index] ?? 0,
      height: batch.height[index] ?? 0,
      clip: this._resolveTextBatchClip(batch, index) ?? undefined,
      styles: {
        ...styleBase,
        color: color ?? styleBase.color,
        font: resolveTextBatchItemValue(batch.font, index) ?? styleBase.font,
        align: resolveTextBatchItemValue(batch.align, index) ?? styleBase.align,
      },
      meta: batch.meta,
    }
  }

  /**
   * Создает coarse visibility key для retained text batches.
   */
  private _resolveTextBatchVisibilityKey(transform: mat3, mode: NovaTextRenderMode): string | undefined {
    if (!this._textConfig.visibleOnlyRaster && !this._textConfig.lod.enabled) {
      return undefined
    }
    const scaleX = Math.hypot(transform[0], transform[1])
    const scaleY = Math.hypot(transform[3], transform[4])
    const scaleBucket = Math.round(Math.max(scaleX, scaleY) * 4) / 4
    const tile = 128
    return [
      mode,
      this._viewportWidth,
      this._viewportHeight,
      scaleBucket.toFixed(2),
      Math.floor(transform[6] / tile),
      Math.floor(transform[7] / tile),
    ].join('|')
  }

  /**
   * Проверяет, что texture все еще принадлежит соответствующему atlas pool.
   */
  private _isTextureAlive(texture: TextureEntry, mode: 'glyph-atlas' | 'msdf' | 'run-atlas'): boolean {
    const pages = mode === 'run-atlas' ? this._textAtlasPages : this._glyphAtlasPages
    return pages.some(page => page.texture === texture)
  }

  /**
   * Проверяет, что retained texture batch ссылается на живую source или atlas texture.
   */
  private _isRetainedTextureAlive(texture: TextureEntry): boolean {
    if (this._textures.get(texture.key) === texture) {
      return this._isTextureBindable(texture)
    }
    return (
      this._textAtlasPages.some(page => page.texture === texture)
      || this._glyphAtlasPages.some(page => page.texture === texture)
    ) && this._isTextureBindable(texture)
  }

  /**
   * Проверяет, что source texture все еще принадлежит renderer texture cache.
   */
  private _isSourceTextureAlive(texture: TextureEntry): boolean {
    return this._textures.get(texture.key) === texture && this._isTextureBindable(texture)
  }

  /**
   * Проверяет, что texture не была удалена в WebGL context.
   */
  private _isTextureBindable(texture: TextureEntry): boolean {
    return !!texture.texture
  }

  /**
   * Закрепляет atlas page на текущий кадр, если retained cache рисует ее без нового resolve.
   */
  private _pinAtlasPageForTexture(texture: TextureEntry): void {
    const page = this._textAtlasPages.find(candidate => candidate.texture === texture)
      ?? this._glyphAtlasPages.find(candidate => candidate.texture === texture)
    if (!page) {
      return
    }

    page.lastUsed = this._time
    page.pinnedFrame = this._time
    texture.lastUsed = this._time
  }

  /**
   * Возвращает retained icon stream cache.
   */
  private _resolveIconStreamBatchCache(batch: NovaIconBatch, stats: RenderStats): TextureRectStreamBatchCache | null {
    const cache: TextureRectStreamBatchCache | null = this._iconStreamBatchCache.get(batch) ?? null
    const revision = batch.revision ?? 0
    const staticRevision = batch.staticRevision ?? 0
    const sourceStale = cache ? this._isSourceTextureStreamBatchCacheStale(cache) : false

    if (!cache || cache.count !== batch.count || cache.staticRevision !== staticRevision || cache.incomplete || sourceStale) {
      const nextCache = this._createIconStreamBatchCache(batch, stats)
      if (!nextCache || nextCache.groups.length === 0) {
        if (cache && !sourceStale && cache.count === batch.count) {
          this._updateTextureRectStreamBatchCacheGeometry(cache, batch)
          cache.revision = revision
          return cache
        }
        return null
      }
      this._iconStreamBatchCache.set(batch, nextCache)
      return nextCache
    }

    if (cache.revision !== revision) {
      for (const group of cache.groups) {
        this._writeTextureRectGeometry(batch, group.indices, group.geometryData, group.rectSource)
        group.geometryUpload.lastData = undefined
      }
      cache.revision = revision
    }

    return cache
  }

  /**
   * Создает retained icon stream cache.
   */
  private _createIconStreamBatchCache(batch: NovaIconBatch, stats: RenderStats): TextureRectStreamBatchCache | null {
    const groups = new Map<string, { texture: TextureEntry, indices: Array<number> }>()
    let incomplete = false

    for (let index = 0; index < batch.count; index += 1) {
      const texture = this._resolveTextureEntry('icon', batch.icons[index], stats)
      if (!texture) {
        incomplete = true
        continue
      }

      let group = groups.get(texture.key)
      if (!group) {
        group = { texture, indices: [] }
        groups.set(texture.key, group)
      }
      group.indices.push(index)
    }

    const revision = batch.revision ?? 0
    const staticRevision = batch.staticRevision ?? 0
    return {
      count: batch.count,
      revision,
      staticRevision,
      incomplete,
      groups: [...groups.values()].map(group => this._createTextureRectStreamGroupCache(batch, group.texture, group.indices, 0, 0, 1, 1)),
    }
  }

  /**
   * Обновляет geometry старого retained texture batch cache без пересоздания static texture groups.
   */
  private _updateTextureRectStreamBatchCacheGeometry(
    cache: TextureRectStreamBatchCache,
    batch: NovaIconBatch | NovaTextBatch,
  ): void {
    for (const group of cache.groups) {
      this._writeTextureRectGeometry(batch, group.indices, group.geometryData, group.rectSource)
      group.geometryUpload.lastData = undefined
    }
  }

  /**
   * Возвращает retained text stream cache.
   */
  private _resolveTextStreamBatchCache(batch: NovaTextBatch, transform: mat3, stats: RenderStats): TextureRectStreamBatchCache | null {
    let cache: TextureRectStreamBatchCache | null = this._textStreamBatchCache.get(batch) ?? null
    const revision = batch.revision ?? 0
    const staticRevision = batch.staticRevision ?? 0
    const rasterScale = this._resolveTextRasterScale(transform, stats, this._resolveTextRasterScope(batch.meta, 'run-atlas'))
    const visibilityKey = this._resolveTextBatchVisibilityKey(transform, 'run-atlas')

    if (
      !cache
      || cache.count !== batch.count
      || cache.staticRevision !== staticRevision
      || cache.rasterScale !== rasterScale
      || cache.visibilityKey !== visibilityKey
      || cache.incomplete
      || this._isTextStreamBatchCacheStale(cache)
    ) {
      cache = this._createTextStreamBatchCache(batch, transform, stats, rasterScale, visibilityKey)
      if (!cache) {
        return null
      }
      this._textStreamBatchCache.set(batch, cache)
      return cache
    }

    if (cache.revision !== revision) {
      for (const group of cache.groups) {
        this._writeTextureRectGeometry(batch, group.indices, group.geometryData, group.rectSource)
        this._writeTextureRectStaticData(batch, group.indices, group.staticData, group.uvSource, 0, 1, 1, group.rectSource)
        group.geometryUpload.lastData = undefined
        group.staticUpload.lastData = undefined
      }
      cache.revision = revision
    }

    return cache
  }

  /**
   * Создает retained text stream cache.
   */
  private _createTextStreamBatchCache(
    batch: NovaTextBatch,
    transform: mat3,
    stats: RenderStats,
    rasterScale: number,
    visibilityKey: string | undefined,
  ): TextureRectStreamBatchCache | null {
    const groups = new Map<string, {
      texture: TextureEntry
      indices: Array<number>
      uv: Array<[number, number, number, number]>
      rects: Array<NovaRect>
    }>()
    const styleBase = this._createTextBatchStyleBase(batch)
    let incomplete = false

    for (let index = 0; index < batch.count; index += 1) {
      const text = this._createTextFromBatch(batch, index, styleBase)
      if (!this._shouldDrawTextRun(transform, text.x, text.y, text.width, text.height, 'run-atlas', stats, text.meta)) {
        continue
      }
      const style = compileNovaTextStyle(text)
      const atlasItem = this._resolveTextAtlasItem(text, style, rasterScale, stats, 'run-atlas')
      if (!atlasItem) {
        incomplete = true
        continue
      }
      const quad = this._resolveTextAtlasQuad(text, atlasItem)
      if (!quad) {
        continue
      }

      let group = groups.get(atlasItem.texture.key)
      if (!group) {
        group = { texture: atlasItem.texture, indices: [], uv: [], rects: [] }
        groups.set(atlasItem.texture.key, group)
      }
      group.indices.push(index)
      group.uv.push([quad.u0, quad.v0, quad.u1, quad.v1])
      group.rects.push({
        x: quad.x,
        y: quad.y,
        width: quad.width,
        height: quad.height,
      })
    }

    const revision = batch.revision ?? 0
    const staticRevision = batch.staticRevision ?? 0
    return {
      count: batch.count,
      revision,
      staticRevision,
      rasterScale,
      visibilityKey,
      incomplete,
      groups: [...groups.values()].map(group => this._createTextureRectStreamGroupCache(batch, group.texture, group.indices, group.uv, 0, 1, 1, group.rects)),
    }
  }

  /**
   * Возвращает style object для text batch.
   */
  private _createTextBatchStyleBase(batch: NovaTextBatch): NonNullable<NovaText['styles']> {
    return {
      color: typeof batch.color === 'string' ? batch.color : '#000',
      font: resolveTextBatchSharedValue(batch.font),
      align: resolveTextBatchSharedValue(batch.align),
      lineHeight: batch.lineHeight,
      padding: batch.padding,
      ellipsis: batch.ellipsis,
      opacity: batch.opacity,
    }
  }

  /**
   * Создает retained texture rect group cache.
   */
  private _createTextureRectStreamGroupCache(
    batch: NovaIconBatch | NovaTextBatch,
    texture: TextureEntry,
    sourceIndices: Array<number>,
    u0OrUv: number | Array<[number, number, number, number]>,
    v0 = 0,
    u1 = 1,
    v1 = 1,
    rectSource?: Array<NovaRect>,
  ): TextureRectStreamGroupCache {
    const indices = new Uint32Array(sourceIndices)
    const geometryBuffer = this._createBuffer()
    const staticBuffer = this._createBuffer()
    const cache: TextureRectStreamGroupCache = {
      texture,
      indices,
      geometryData: new Float32Array(indices.length * TEXTURE_RECT_BATCH_GEOMETRY_STRIDE),
      staticData: new Float32Array(indices.length * TEXTURE_RECT_BATCH_STATIC_STRIDE),
      count: indices.length,
      revision: batch.revision ?? 0,
      staticRevision: batch.staticRevision ?? 0,
      uvSource: u0OrUv,
      rectSource,
      geometryUpload: createWebGLUploadState(),
      staticUpload: createWebGLUploadState(),
      geometryBuffer,
      staticBuffer,
      vao: this._createTextureRectBatchVao(geometryBuffer, staticBuffer),
    }

    this._writeTextureRectGeometry(batch, indices, cache.geometryData, rectSource)
    this._writeTextureRectStaticData(batch, indices, cache.staticData, u0OrUv, v0, u1, v1, rectSource)
    this._ownedTextureRectStreamGroupCaches.add(cache)
    return cache
  }

  /**
   * Записывает dynamic geometry для retained texture rect group.
   */
  private _writeTextureRectGeometry(
    batch: NovaIconBatch | NovaTextBatch,
    indices: Uint32Array,
    target: Float32Array,
    rectSource?: Array<NovaRect>,
  ): void {
    for (let itemIndex = 0; itemIndex < indices.length; itemIndex += 1) {
      const sourceIndex = indices[itemIndex] ?? 0
      const offset = itemIndex * TEXTURE_RECT_BATCH_GEOMETRY_STRIDE
      const rect = this._resolveClippedTextureRect(batch, sourceIndex, undefined, rectSource?.[itemIndex])
      target[offset] = rect?.x ?? 0
      target[offset + 1] = rect?.y ?? 0
      target[offset + 2] = rect?.width ?? 0
      target[offset + 3] = rect?.height ?? 0
    }
  }

  /**
   * Возвращает clipped rect для retained texture stream item.
   */
  private _resolveClippedTextureRect(
    batch: NovaIconBatch | NovaTextBatch,
    sourceIndex: number,
    uv: [number, number, number, number] = [0, 0, 1, 1],
    sourceRect?: NovaRect,
  ): (NovaRect & { u0: number, v0: number, u1: number, v1: number }) | null {
    const x = sourceRect?.x ?? batch.x[sourceIndex] ?? 0
    const y = sourceRect?.y ?? batch.y[sourceIndex] ?? 0
    const width = sourceRect?.width ?? batch.width[sourceIndex] ?? 0
    const height = sourceRect?.height ?? batch.height[sourceIndex] ?? 0
    const clip = this._resolveTextBatchClip(batch, sourceIndex)

    return this._clipTextureRect(x, y, width, height, uv[0], uv[1], uv[2], uv[3], clip)
  }

  /**
   * Возвращает per-item clip для text batch, если batch его содержит.
   */
  private _resolveTextBatchClip(batch: NovaIconBatch | NovaTextBatch, index: number): NovaRect | null {
    if (!('text' in batch)) {
      return null
    }
    const clipX = batch.clipX?.[index]
    const clipY = batch.clipY?.[index]
    const clipWidth = batch.clipWidth?.[index]
    const clipHeight = batch.clipHeight?.[index]
    if (
      clipX === undefined
      || clipY === undefined
      || clipWidth === undefined
      || clipHeight === undefined
    ) {
      return null
    }
    if (clipWidth < 0 || clipHeight < 0) {
      return null
    }

    return {
      x: clipX,
      y: clipY,
      width: clipWidth,
      height: clipHeight,
    }
  }

  /**
   * Записывает static uv/opacity для retained texture rect group.
   */
  private _writeTextureRectStaticData(
    batch: NovaIconBatch | NovaTextBatch,
    indices: Uint32Array,
    target: Float32Array,
    u0OrUv: number | Array<[number, number, number, number]>,
    v0: number,
    u1: number,
    v1: number,
    rectSource?: Array<NovaRect>,
  ): void {
    const opacity = batch.opacity ?? 1

    for (let itemIndex = 0; itemIndex < indices.length; itemIndex += 1) {
      const offset = itemIndex * TEXTURE_RECT_BATCH_STATIC_STRIDE
      const uv = Array.isArray(u0OrUv) ? u0OrUv[itemIndex] : undefined
      const baseUv: [number, number, number, number] = [
        uv?.[0] ?? Number(u0OrUv),
        uv?.[1] ?? v0,
        uv?.[2] ?? u1,
        uv?.[3] ?? v1,
      ]
      const sourceIndex = indices[itemIndex] ?? 0
      const rect = this._resolveClippedTextureRect(batch, sourceIndex, baseUv, rectSource?.[itemIndex])
      target[offset] = rect?.u0 ?? baseUv[0]
      target[offset + 1] = rect?.v0 ?? baseUv[1]
      target[offset + 2] = rect?.u1 ?? baseUv[2]
      target[offset + 3] = rect?.v1 ?? baseUv[3]
      target[offset + 4] = rect ? opacity : 0
    }
  }

  /**
   * Рисует retained texture rect cache через instanced stream.
   */
  private _drawTextureRectStreamBatchCache(cache: TextureRectStreamBatchCache, transform: mat3, stats: RenderStats): void {
    for (const group of cache.groups) {
      if (group.count <= 0) {
        continue
      }
      this._pinAtlasPageForTexture(group.texture)

      this._flush(stats)
      const uploadStartedAt = performance.now()
      const gl = this._gl
      gl.bindVertexArray(group.vao)
      gl.bindBuffer(gl.ARRAY_BUFFER, group.geometryBuffer)
      this._uploadArrayBuffer(group.geometryData, group.geometryUpload, stats, null)
      gl.bindBuffer(gl.ARRAY_BUFFER, group.staticBuffer)
      this._uploadArrayBuffer(group.staticData, group.staticUpload, stats, null)
      stats.uploadMs += performance.now() - uploadStartedAt

      this._textureRectBatchProgram.use()
      gl.uniform2f(this._textureRectBatchProgram.uniformLocation('u_resolution'), this._renderResolutionWidth, this._renderResolutionHeight)
      gl.uniformMatrix3fv(this._textureRectBatchProgram.uniformLocation('u_transform'), false, transform)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, group.texture.texture)
      gl.uniform1i(this._textureRectBatchProgram.uniformLocation('u_texture'), 0)
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, group.count)

      stats.instances += group.count
      stats.drawCalls += 1
      stats.batches += 1
    }
  }

  /**
   * Возвращает retained analytic stripe stream cache.
   */
  private _resolveStripeStreamBatchCache(batch: NovaStripeRectBatch): StripeStreamBatchCache | null {
    let cache: StripeStreamBatchCache | null = this._stripeStreamBatchCache.get(batch) ?? null
    const revision = batch.revision ?? 0
    const staticRevision = batch.staticRevision ?? 0

    if (!cache || cache.count !== batch.count || cache.staticRevision !== staticRevision) {
      cache = this._createStripeStreamBatchCache(batch)
      if (!cache) {
        return null
      }
      this._stripeStreamBatchCache.set(batch, cache)
      return cache
    }

    if (cache.revision !== revision) {
      this._writeStripeBatchGeometry(batch, cache.geometryData)
      cache.geometryUpload.lastData = undefined
      cache.revision = revision
    }

    return cache
  }

  /**
   * Создает retained analytic stripe stream cache.
   */
  private _createStripeStreamBatchCache(batch: NovaStripeRectBatch): StripeStreamBatchCache | null {
    for (let index = 0; index < batch.count; index += 1) {
      if (!this._resolveStripeDescriptor(batch.fills[index])) {
        return null
      }
    }

    const geometryBuffer = this._createBuffer()
    const staticBuffer = this._createBuffer()
    const cache: StripeStreamBatchCache = {
      geometryData: new Float32Array(batch.count * STRIPE_BATCH_GEOMETRY_STRIDE),
      staticData: new Float32Array(batch.count * STRIPE_BATCH_STATIC_STRIDE),
      count: batch.count,
      revision: batch.revision ?? 0,
      staticRevision: batch.staticRevision ?? 0,
      geometryUpload: createWebGLUploadState(),
      staticUpload: createWebGLUploadState(),
      geometryBuffer,
      staticBuffer,
      vao: this._createStripeBatchVao(geometryBuffer, staticBuffer),
    }

    this._writeStripeBatchGeometry(batch, cache.geometryData)
    this._writeStripeBatchStaticData(batch, cache.staticData)
    this._ownedStripeStreamBatchCaches.add(cache)
    return cache
  }

  /**
   * Записывает dynamic stripe geometry.
   */
  private _writeStripeBatchGeometry(batch: NovaStripeRectBatch, target: Float32Array): void {
    for (let index = 0; index < batch.count; index += 1) {
      const offset = index * STRIPE_BATCH_GEOMETRY_STRIDE
      target[offset] = batch.x[index] ?? 0
      target[offset + 1] = batch.y[index] ?? 0
      target[offset + 2] = batch.width[index] ?? 0
      target[offset + 3] = batch.height[index] ?? 0
    }
  }

  /**
   * Записывает static stripe material.
   */
  private _writeStripeBatchStaticData(batch: NovaStripeRectBatch, target: Float32Array): void {
    const opacity = batch.opacity ?? 1

    for (let index = 0; index < batch.count; index += 1) {
      const descriptor = this._resolveStripeDescriptor(batch.fills[index])
      const bg = parseNovaColor(descriptor?.bgColor, 0xFDF1CDFF)
      const stripe = parseNovaColor(descriptor?.stripeColor, 0x8FB7E7FF)
      const offset = index * STRIPE_BATCH_STATIC_STRIDE
      target[offset] = bg.r
      target[offset + 1] = bg.g
      target[offset + 2] = bg.b
      target[offset + 3] = bg.a * opacity
      target[offset + 4] = stripe.r
      target[offset + 5] = stripe.g
      target[offset + 6] = stripe.b
      target[offset + 7] = stripe.a * opacity
      target[offset + 8] = Math.max(1, descriptor?.stripeWidth ?? 3)
      target[offset + 9] = ((descriptor?.angle ?? 45) * Math.PI) / 180
    }
  }

  /**
   * Рисует retained analytic stripe cache.
   */
  private _drawStripeStreamBatchCache(cache: StripeStreamBatchCache, transform: mat3, stats: RenderStats): void {
    if (cache.count <= 0) {
      return
    }

    this._flush(stats)
    const uploadStartedAt = performance.now()
    const gl = this._gl
    gl.bindVertexArray(cache.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, cache.geometryBuffer)
    this._uploadArrayBuffer(cache.geometryData, cache.geometryUpload, stats, null)
    gl.bindBuffer(gl.ARRAY_BUFFER, cache.staticBuffer)
    this._uploadArrayBuffer(cache.staticData, cache.staticUpload, stats, null)
    stats.uploadMs += performance.now() - uploadStartedAt

    this._stripeBatchProgram.use()
    gl.uniform2f(this._stripeBatchProgram.uniformLocation('u_resolution'), this._renderResolutionWidth, this._renderResolutionHeight)
    gl.uniformMatrix3fv(this._stripeBatchProgram.uniformLocation('u_transform'), false, transform)
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, cache.count)

    stats.instances += cache.count
    stats.drawCalls += 1
    stats.batches += 1
  }

  /**
   * Возвращает stripe descriptor для asset ref.
   */
  private _resolveStripeDescriptor(input: NovaAssetDrawableInput): NovaStripeAssetDescriptor | null {
    if (!(typeof input === 'string' || isNovaAssetRef(input))) {
      return null
    }
    const descriptor = this._assets.resolveRecord(input)?.descriptor
    return descriptor?.type === 'stripe' ? descriptor : null
  }

  /**
   * Рисует stripe batch старым texture path, если fill не является stripe descriptor.
   */
  private _drawStripeTextureFallbackBatch(batch: NovaStripeRectBatch, transform: mat3, stats: RenderStats): void {
    const opacity = batch.opacity ?? 1
    for (let index = 0; index < batch.count; index += 1) {
      const x = batch.x[index] ?? 0
      const y = batch.y[index] ?? 0
      const width = batch.width[index] ?? 0
      const height = batch.height[index] ?? 0
      if (width <= 0 || height <= 0 || opacity <= 0) {
        continue
      }
      if (this._shouldCullTextureItems() && !this._isRectVisible(transform, x, y, width, height)) {
        continue
      }

      const texture = this._resolveTextureEntry('stripe', batch.fills[index], stats, true)
      if (!texture) {
        continue
      }
      this._queueTextureQuad(texture, x, y, width, height, transform, opacity, stats, 0, 0, width / Math.max(1, texture.width), height / Math.max(1, texture.height))
    }
  }

  /**
   * Рисует retained particle batch через specialized instanced stream.
   */
  private _drawParticleBatch(batch: NovaParticleBatch, transform: mat3, stats: RenderStats): void {
    if (batch.active === false || batch.count <= 0) {
      return
    }

    if (batch.kind === 'sprite') {
      this._drawSpriteParticleBatch(batch, transform, stats)
      return
    }

    this._drawCircleParticleBatch(batch, transform, stats)
  }

  /**
   * Рисует circle particles через analytic shader.
   */
  private _drawCircleParticleBatch(batch: NovaParticleBatch, transform: mat3, stats: RenderStats): void {
    let cache = this._particleCircleBatchCache.get(batch)
    const revision = batch.revision ?? 0
    const staticRevision = batch.staticRevision ?? 0
    let positionDirty: Array<FloatDirtyRange> | null = null
    let staticDirty: Array<FloatDirtyRange> | null = null

    if (!cache || cache.count !== batch.count) {
      cache = this._createCircleParticleCache(batch)
      this._particleCircleBatchCache.set(batch, cache)
      this._ownedParticleCircleBatchCaches.add(cache)
    }

    if (cache.revision !== revision) {
      this._writeParticlePositions(batch, cache.positionData)
      cache.revision = revision
      positionDirty = [{ start: 0, end: batch.count * PARTICLE_POSITION_STRIDE }]
    }

    if (cache.staticRevision !== staticRevision) {
      this._writeCircleParticleStaticData(batch, cache.staticData)
      cache.staticRevision = staticRevision
      staticDirty = [{ start: 0, end: batch.count * PARTICLE_CIRCLE_STATIC_STRIDE }]
    }

    this._flush(stats)
    const uploadStartedAt = performance.now()
    const gl = this._gl
    gl.bindVertexArray(cache.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, cache.positionBuffer)
    this._uploadArrayBuffer(cache.positionData, cache.positionUpload, stats, positionDirty)
    gl.bindBuffer(gl.ARRAY_BUFFER, cache.staticBuffer)
    this._uploadArrayBuffer(cache.staticData, cache.staticUpload, stats, staticDirty)
    stats.uploadMs += performance.now() - uploadStartedAt

    this._particleCircleProgram.use()
    gl.uniform2f(this._particleCircleProgram.uniformLocation('u_resolution'), this._renderResolutionWidth, this._renderResolutionHeight)
    gl.uniformMatrix3fv(this._particleCircleProgram.uniformLocation('u_transform'), false, transform)
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, batch.count)

    stats.instances += batch.count
    stats.drawCalls += 1
    stats.batches += 1
    if (positionDirty) {
      stats.updatedHandles += batch.count
      stats.dirtyStreamRanges += 1
    }
  }

  /**
   * Рисует sprite particles через texture instancing.
   */
  private _drawSpriteParticleBatch(batch: NovaParticleBatch, transform: mat3, stats: RenderStats): void {
    const source = this._assets.resolveDrawable(batch.texture)
    if (!source) {
      return
    }

    const textureKey = this._assets.resolveDrawableKey('particle', batch.texture, source => this._resolveSourceKey(source))
    let texture = this._textures.get(textureKey)
    if (!texture) {
      texture = this._createTextureFromSource(textureKey, source, stats)
    }
    texture.lastUsed = this._time

    let cache = this._particleSpriteBatchCache.get(batch)
    const revision = batch.revision ?? 0
    const staticRevision = batch.staticRevision ?? 0
    let positionDirty: Array<FloatDirtyRange> | null = null
    let staticDirty: Array<FloatDirtyRange> | null = null

    if (!cache || cache.count !== batch.count || cache.texture !== texture) {
      cache = this._createSpriteParticleCache(batch, texture)
      this._particleSpriteBatchCache.set(batch, cache)
      this._ownedParticleSpriteBatchCaches.add(cache)
    }

    if (cache.revision !== revision) {
      this._writeParticlePositions(batch, cache.positionData)
      cache.revision = revision
      positionDirty = [{ start: 0, end: batch.count * PARTICLE_POSITION_STRIDE }]
    }

    if (cache.staticRevision !== staticRevision) {
      this._writeSpriteParticleStaticData(batch, cache.staticData)
      cache.staticRevision = staticRevision
      staticDirty = [{ start: 0, end: batch.count * PARTICLE_SPRITE_STATIC_STRIDE }]
    }

    this._flush(stats)
    const uploadStartedAt = performance.now()
    const gl = this._gl
    gl.bindVertexArray(cache.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, cache.positionBuffer)
    this._uploadArrayBuffer(cache.positionData, cache.positionUpload, stats, positionDirty)
    gl.bindBuffer(gl.ARRAY_BUFFER, cache.staticBuffer)
    this._uploadArrayBuffer(cache.staticData, cache.staticUpload, stats, staticDirty)
    stats.uploadMs += performance.now() - uploadStartedAt

    this._particleSpriteProgram.use()
    gl.uniform2f(this._particleSpriteProgram.uniformLocation('u_resolution'), this._renderResolutionWidth, this._renderResolutionHeight)
    gl.uniformMatrix3fv(this._particleSpriteProgram.uniformLocation('u_transform'), false, transform)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texture.texture)
    gl.uniform1i(this._particleSpriteProgram.uniformLocation('u_texture'), 0)
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, batch.count)

    stats.instances += batch.count
    stats.drawCalls += 1
    stats.batches += 1
    if (positionDirty) {
      stats.updatedHandles += batch.count
      stats.dirtyStreamRanges += 1
    }
  }

  /**
   * Выполняет внутреннюю операцию draw texture source.
   */
  private _drawTextureSource(
    key: string,
    source: CanvasImageSource,
    x: number,
    y: number,
    width: number,
    height: number,
    transform: mat3,
    opacity: number,
    stats: RenderStats,
    fillMode: NovaAssetFillMode = 'stretch',
  ): void {
    let texture = this._textures.get(key)
    const repeated = fillMode === 'repeat' || fillMode === 'repeat-x' || fillMode === 'repeat-y'
    if (!texture) {
      texture = this._createTextureFromSource(key, source, stats, { repeat: repeated })
    }
    texture.lastUsed = this._time
    const u1 = fillMode === 'repeat' || fillMode === 'repeat-x' ? width / Math.max(1, texture.width) : 1
    const v1 = fillMode === 'repeat' || fillMode === 'repeat-y' ? height / Math.max(1, texture.height) : 1
    this._queueTextureQuad(texture, x, y, width, height, transform, opacity, stats, 0, 0, u1, v1)
  }

  /**
   * Возвращает texture entry для drawable asset/source.
   */
  private _resolveTextureEntry(
    prefix: string,
    input: NovaAssetDrawableInput,
    stats: RenderStats,
    repeat = false,
  ): TextureEntry | null {
    const source = this._assets.resolveDrawable(input)
    if (!source) {
      return null
    }
    const key = this._assets.resolveDrawableKey(prefix, input, source => this._resolveSourceKey(source))
    let texture = this._textures.get(key)
    if (!texture) {
      texture = this._createTextureFromSource(key, source, stats, { repeat })
    }
    texture.lastUsed = this._time
    return texture
  }

  /**
   * Создает cache для circle particle batch.
   */
  private _createCircleParticleCache(batch: NovaParticleBatch): ParticleCircleBatchCache {
    const positionBuffer = this._createBuffer()
    const staticBuffer = this._createBuffer()
    const cache: ParticleCircleBatchCache = {
      positionData: new Float32Array(batch.count * PARTICLE_POSITION_STRIDE),
      staticData: new Float32Array(batch.count * PARTICLE_CIRCLE_STATIC_STRIDE),
      count: batch.count,
      positionUpload: createWebGLUploadState(),
      staticUpload: createWebGLUploadState(),
      positionBuffer,
      staticBuffer,
      vao: this._createParticleCircleVao(positionBuffer, staticBuffer),
    }

    this._writeParticlePositions(batch, cache.positionData)
    this._writeCircleParticleStaticData(batch, cache.staticData)
    return cache
  }

  /**
   * Создает cache для sprite particle batch.
   */
  private _createSpriteParticleCache(batch: NovaParticleBatch, texture: TextureEntry): ParticleSpriteBatchCache {
    const positionBuffer = this._createBuffer()
    const staticBuffer = this._createBuffer()
    const cache: ParticleSpriteBatchCache = {
      positionData: new Float32Array(batch.count * PARTICLE_POSITION_STRIDE),
      staticData: new Float32Array(batch.count * PARTICLE_SPRITE_STATIC_STRIDE),
      count: batch.count,
      texture,
      positionUpload: createWebGLUploadState(),
      staticUpload: createWebGLUploadState(),
      positionBuffer,
      staticBuffer,
      vao: this._createParticleSpriteVao(positionBuffer, staticBuffer),
    }

    this._writeParticlePositions(batch, cache.positionData)
    this._writeSpriteParticleStaticData(batch, cache.staticData)
    return cache
  }

  /**
   * Создает cache для instanced rect batch.
   */
  private _createRectStreamBatchCache(batch: NovaRectBatch): RectStreamBatchCache {
    const geometryBuffer = this._createBuffer()
    const staticBuffer = this._createBuffer()
    const cache: RectStreamBatchCache = {
      geometryData: new Float32Array(batch.count * RECT_BATCH_GEOMETRY_STRIDE),
      staticData: new Float32Array(batch.count * RECT_BATCH_STATIC_STRIDE),
      count: batch.count,
      geometryUpload: createWebGLUploadState(),
      staticUpload: createWebGLUploadState(),
      geometryBuffer,
      staticBuffer,
      vao: this._createRectBatchVao(geometryBuffer, staticBuffer),
    }

    this._writeRectBatchGeometry(batch, cache.geometryData)
    this._writeRectBatchStaticData(batch, cache.staticData)
    return cache
  }

  /**
   * Записывает dynamic rect geometry.
   */
  private _writeRectBatchGeometry(batch: NovaRectBatch, target: Float32Array): void {
    for (let index = 0; index < batch.count; index += 1) {
      const offset = index * RECT_BATCH_GEOMETRY_STRIDE
      target[offset] = batch.x[index] ?? 0
      target[offset + 1] = batch.y[index] ?? 0
      target[offset + 2] = batch.width[index] ?? 0
      target[offset + 3] = batch.height[index] ?? 0
    }
  }

  /**
   * Записывает static rect paint/state attributes.
   */
  private _writeRectBatchStaticData(batch: NovaRectBatch, target: Float32Array): void {
    const opacity = batch.opacity ?? 1

    for (let index = 0; index < batch.count; index += 1) {
      const colorOffset = index * 4
      const targetOffset = index * RECT_BATCH_STATIC_STRIDE
      target[targetOffset] = batch.colors[colorOffset] ?? 0
      target[targetOffset + 1] = batch.colors[colorOffset + 1] ?? 0
      target[targetOffset + 2] = batch.colors[colorOffset + 2] ?? 0
      target[targetOffset + 3] = (batch.colors[colorOffset + 3] ?? 1) * opacity
      target[targetOffset + 4] = batch.states?.[index] ?? 0
      target[targetOffset + 5] = batch.radii?.[index] ?? 0
    }
  }

  /**
   * Создает cache для GPU-resident time-range segment batch.
   */
  private _createTimeRangeSegmentBatchCache(batch: NovaTimeRangeSegmentBatch): TimeRangeSegmentBatchCache {
    const geometryBuffer = this._createBuffer()
    const staticBuffer = this._createBuffer()
    const cache: TimeRangeSegmentBatchCache = {
      geometryData: new Float32Array(batch.count * TIME_RANGE_SEGMENT_GEOMETRY_STRIDE),
      staticData: new Float32Array(batch.count * TIME_RANGE_SEGMENT_STATIC_STRIDE),
      count: batch.count,
      geometryUpload: createWebGLUploadState(),
      staticUpload: createWebGLUploadState(),
      geometryBuffer,
      staticBuffer,
      vao: this._createTimeRangeSegmentBatchVao(geometryBuffer, staticBuffer),
    }

    this._writeTimeRangeSegmentGeometry(batch, cache.geometryData)
    this._writeTimeRangeSegmentStaticData(batch, cache.staticData)
    return cache
  }

  /**
   * Записывает dynamic time-range segment geometry.
   */
  private _writeTimeRangeSegmentGeometry(batch: NovaTimeRangeSegmentBatch, target: Float32Array): void {
    for (let index = 0; index < batch.count; index += 1) {
      const offset = index * TIME_RANGE_SEGMENT_GEOMETRY_STRIDE
      target[offset] = batch.startTime[index] ?? 0
      target[offset + 1] = batch.endTime[index] ?? 0
      target[offset + 2] = batch.y[index] ?? 0
      target[offset + 3] = batch.height[index] ?? 0
    }
  }

  /**
   * Записывает static time-range segment colors.
   */
  private _writeTimeRangeSegmentStaticData(batch: NovaTimeRangeSegmentBatch, target: Float32Array): void {
    for (let index = 0; index < batch.count; index += 1) {
      const sourceOffset = index * 4
      const targetOffset = index * TIME_RANGE_SEGMENT_STATIC_STRIDE
      target[targetOffset] = batch.colors[sourceOffset] ?? 0
      target[targetOffset + 1] = batch.colors[sourceOffset + 1] ?? 0
      target[targetOffset + 2] = batch.colors[sourceOffset + 2] ?? 0
      target[targetOffset + 3] = batch.colors[sourceOffset + 3] ?? 1
      target[targetOffset + 4] = batch.styles?.[sourceOffset] ?? 0
      target[targetOffset + 5] = batch.styles?.[sourceOffset + 1] ?? 0
      target[targetOffset + 6] = batch.styles?.[sourceOffset + 2] ?? 0
      target[targetOffset + 7] = batch.styles?.[sourceOffset + 3] ?? 0
    }
  }

  /**
   * Записывает dynamic particle positions.
   */
  private _writeParticlePositions(batch: NovaParticleBatch, target: Float32Array): void {
    for (let index = 0; index < batch.count; index += 1) {
      target[index * 2] = batch.positions[index * 2] ?? 0
      target[index * 2 + 1] = batch.positions[index * 2 + 1] ?? 0
    }
  }

  /**
   * Записывает static circle particle attributes.
   */
  private _writeCircleParticleStaticData(batch: NovaParticleBatch, target: Float32Array): void {
    const opacity = batch.opacity ?? 1

    for (let index = 0; index < batch.count; index += 1) {
      const fillOffset = index * 4
      const strokeOffset = index * 4
      const targetOffset = index * PARTICLE_CIRCLE_STATIC_STRIDE

      target[targetOffset] = batch.sizes[index] ?? 1
      target[targetOffset + 1] = batch.colors[fillOffset] ?? 1
      target[targetOffset + 2] = batch.colors[fillOffset + 1] ?? 1
      target[targetOffset + 3] = batch.colors[fillOffset + 2] ?? 1
      target[targetOffset + 4] = (batch.colors[fillOffset + 3] ?? 1) * opacity
      target[targetOffset + 5] = batch.strokeColors?.[strokeOffset] ?? 1
      target[targetOffset + 6] = batch.strokeColors?.[strokeOffset + 1] ?? 1
      target[targetOffset + 7] = batch.strokeColors?.[strokeOffset + 2] ?? 1
      target[targetOffset + 8] = (batch.strokeColors?.[strokeOffset + 3] ?? 0) * opacity
      target[targetOffset + 9] = batch.strokeWidths?.[index] ?? 0
    }
  }

  /**
   * Записывает static sprite particle attributes.
   */
  private _writeSpriteParticleStaticData(batch: NovaParticleBatch, target: Float32Array): void {
    const opacity = batch.opacity ?? 1

    for (let index = 0; index < batch.count; index += 1) {
      const targetOffset = index * PARTICLE_SPRITE_STATIC_STRIDE
      const colorOffset = index * 4
      target[targetOffset] = batch.sizes[index] ?? 1
      target[targetOffset + 1] = (batch.colors[colorOffset + 3] ?? 1) * opacity
    }
  }

  /**
   * Выполняет внутреннюю операцию queue rounded rect.
   */
  private _queueRoundedRect(
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    fill: NovaParsedColor,
    opacity: number,
    border: NovaParsedColor,
    borderWidth: number,
    transform: mat3,
    stats: RenderStats,
    source?: NovaSchemaItem<any>,
  ): void {
    if (width <= 0 || height <= 0) {
      return
    }
    if (fill.a <= 0 && (border.a <= 0 || borderWidth <= 0)) {
      return
    }
    this._flushTexture(stats)
    this._flushSolid(stats)
    this._prepareRoundedTransform(transform, stats)

    this._pushRoundedRectVertices(this._rectData, x, y, width, height, radius, fill, opacity, border, borderWidth, this._resolveShaderRenderMeta(source))
    stats.instances += 1
  }

  /**
   * Выполняет внутреннюю операцию queue plain rect.
   */
  private _queuePlainRect(
    x: number,
    y: number,
    width: number,
    height: number,
    fill: NovaParsedColor,
    opacity: number,
    transform: mat3,
    stats: RenderStats,
    source?: NovaSchemaItem<any>,
  ): void {
    if (width <= 0 || height <= 0 || fill.a <= 0) {
      return
    }
    this._flushTexture(stats)
    this._flushRounded(stats)
    this._prepareSolidTransform(transform, stats)

    this._pushSolidRectVertices(this._solidData, x, y, width, height, fill, opacity, this._resolveShaderRenderMeta(source))
    stats.instances += 1
  }

  /**
   * Выполняет внутреннюю операцию push rounded rect vertices.
   */
  private _pushRoundedRectVertices(
    target: Array<number>,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    fill: NovaParsedColor,
    opacity: number,
    border: NovaParsedColor,
    borderWidth: number,
    meta?: NovaShaderRenderMeta | null,
  ): void {
    const clampedRadius = Math.max(0, Math.min(radius, width / 2, height / 2))
    const animation = resolveAnimationVector(meta)
    const motion = resolveMotionVector(meta)
    const vertices = [
      [x, y, 0, 0],
      [x + width, y, width, 0],
      [x, y + height, 0, height],
      [x, y + height, 0, height],
      [x + width, y, width, 0],
      [x + width, y + height, width, height],
    ]

    for (const [px, py, localX, localY] of vertices) {
      target.push(
        px,
        py,
        localX,
        localY,
        width,
        height,
        clampedRadius,
        fill.r,
        fill.g,
        fill.b,
        fill.a * opacity,
        border.r,
        border.g,
        border.b,
        border.a * opacity,
        borderWidth,
        animation.phase,
        animation.speed,
        animation.amplitude,
        motion.speed,
        motion.wrapWidth,
      )
    }
  }

  /**
   * Записывает rounded rect vertices.
   */
  private _writeRoundedRectVertices(
    target: Float32Array,
    offset: number,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    fill: NovaParsedColor,
    opacity: number,
    border: NovaParsedColor,
    borderWidth: number,
    meta?: NovaShaderRenderMeta | null,
  ): void {
    const clampedRadius = Math.max(0, Math.min(radius, width / 2, height / 2))
    const animation = resolveAnimationVector(meta)
    const motion = resolveMotionVector(meta)
    const vertices = [
      [x, y, 0, 0],
      [x + width, y, width, 0],
      [x, y + height, 0, height],
      [x, y + height, 0, height],
      [x + width, y, width, 0],
      [x + width, y + height, width, height],
    ]

    let cursor = offset
    for (const [px, py, localX, localY] of vertices) {
      target[cursor++] = px
      target[cursor++] = py
      target[cursor++] = localX
      target[cursor++] = localY
      target[cursor++] = width
      target[cursor++] = height
      target[cursor++] = clampedRadius
      target[cursor++] = fill.r
      target[cursor++] = fill.g
      target[cursor++] = fill.b
      target[cursor++] = fill.a * opacity
      target[cursor++] = border.r
      target[cursor++] = border.g
      target[cursor++] = border.b
      target[cursor++] = border.a * opacity
      target[cursor++] = borderWidth
      target[cursor++] = animation.phase
      target[cursor++] = animation.speed
      target[cursor++] = animation.amplitude
      target[cursor++] = motion.speed
      target[cursor++] = motion.wrapWidth
    }
  }

  /**
   * Выполняет внутреннюю операцию push solid rect vertices.
   */
  private _pushSolidRectVertices(target: Array<number>, x: number, y: number, width: number, height: number, fill: NovaParsedColor, opacity: number, meta?: NovaShaderRenderMeta | null): void {
    const animation = resolveAnimationVector(meta)
    this._pushSolidVertexTo(target, x, y, fill, opacity, animation)
    this._pushSolidVertexTo(target, x + width, y, fill, opacity, animation)
    this._pushSolidVertexTo(target, x, y + height, fill, opacity, animation)
    this._pushSolidVertexTo(target, x, y + height, fill, opacity, animation)
    this._pushSolidVertexTo(target, x + width, y, fill, opacity, animation)
    this._pushSolidVertexTo(target, x + width, y + height, fill, opacity, animation)
  }

  /**
   * Записывает solid rect vertices.
   */
  private _writeSolidRectVertices(target: Float32Array, offset: number, x: number, y: number, width: number, height: number, fill: NovaParsedColor, opacity: number, meta?: NovaShaderRenderMeta | null): void {
    const animation = resolveAnimationVector(meta)
    const vertices = [
      [x, y],
      [x + width, y],
      [x, y + height],
      [x, y + height],
      [x + width, y],
      [x + width, y + height],
    ]

    let cursor = offset
    for (const [px, py] of vertices) {
      target[cursor++] = px
      target[cursor++] = py
      target[cursor++] = fill.r
      target[cursor++] = fill.g
      target[cursor++] = fill.b
      target[cursor++] = fill.a * opacity
      target[cursor++] = animation.phase
      target[cursor++] = animation.speed
      target[cursor++] = animation.amplitude
    }
  }

  /**
   * Выполняет внутреннюю операцию queue solid triangle.
   */
  private _queueSolidTriangle(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
    color: NovaParsedColor,
    opacity: number,
    transform: mat3,
    stats: RenderStats,
  ): void {
    this._flushTexture(stats)
    this._flushRounded(stats)
    this._prepareSolidTransform(transform, stats)
    this._pushSolidVertex(x1, y1, color, opacity)
    this._pushSolidVertex(x2, y2, color, opacity)
    this._pushSolidVertex(x3, y3, color, opacity)
    stats.instances += 1
  }

  /**
   * Выполняет внутреннюю операцию queue solid line.
   */
  private _queueSolidLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    width: number,
    color: NovaParsedColor,
    opacity: number,
    transform: mat3,
    stats: RenderStats,
    dashPattern?: Array<number>,
  ): void {
    if (width <= 0 || color.a <= 0) {
      return
    }
    if (dashPattern?.length && dashPattern[0] > 0 && dashPattern[1] > 0) {
      this._queueDashedLine(x1, y1, x2, y2, width, color, opacity, transform, stats, dashPattern)
      return
    }

    const dx = x2 - x1
    const dy = y2 - y1
    const length = Math.hypot(dx, dy)
    if (length <= 0) {
      return
    }

    this._flushTexture(stats)
    this._flushRounded(stats)
    this._prepareSolidTransform(transform, stats)

    const nx = (-dy / length) * (width / 2)
    const ny = (dx / length) * (width / 2)
    this._pushSolidVertex(x1 - nx, y1 - ny, color, opacity)
    this._pushSolidVertex(x2 - nx, y2 - ny, color, opacity)
    this._pushSolidVertex(x1 + nx, y1 + ny, color, opacity)
    this._pushSolidVertex(x1 + nx, y1 + ny, color, opacity)
    this._pushSolidVertex(x2 - nx, y2 - ny, color, opacity)
    this._pushSolidVertex(x2 + nx, y2 + ny, color, opacity)
    stats.instances += 1
  }

  /**
   * Выполняет внутреннюю операцию queue dashed line.
   */
  private _queueDashedLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    width: number,
    color: NovaParsedColor,
    opacity: number,
    transform: mat3,
    stats: RenderStats,
    dashPattern: Array<number>,
  ): void {
    const dash = dashPattern[0] ?? 0
    const gap = dashPattern[1] ?? 0
    const dx = x2 - x1
    const dy = y2 - y1
    const length = Math.hypot(dx, dy)
    if (length <= 0) {
      return
    }

    const ux = dx / length
    const uy = dy / length
    let offset = 0
    while (offset < length) {
      const end = Math.min(offset + dash, length)
      this._queueSolidLine(
        x1 + ux * offset,
        y1 + uy * offset,
        x1 + ux * end,
        y1 + uy * end,
        width,
        color,
        opacity,
        transform,
        stats,
      )
      offset += dash + gap
    }
  }

  /**
   * Выполняет внутреннюю операцию queue texture quad.
   */
  private _queueTextureQuad(
    texture: TextureEntry,
    x: number,
    y: number,
    width: number,
    height: number,
    transform: mat3,
    opacity: number,
    stats: RenderStats,
    u0 = 0,
    v0 = 0,
    u1 = 1,
    v1 = 1,
  ): void {
    if (width <= 0 || height <= 0 || opacity <= 0) {
      return
    }
    if (!this._isTextureBindable(texture)) {
      return
    }
    this._flushDistanceField(stats)
    this._flushRounded(stats)
    this._flushSolid(stats)
    this._prepareTextureTransform(transform, stats)

    if (this._textureCachedData) {
      this._flushTexture(stats)
    }
    if (this._textureBatch && this._textureBatch !== texture) {
      this._flushTexture(stats)
    }
    this._textureBatch = texture

    this._pushTextureQuadVertices(this._textureData, x, y, width, height, opacity, u0, v0, u1, v1)
    stats.instances += 1
  }

  /**
   * Добавляет texture quad с CPU clipping и пересчетом UV без смены scissor.
   */
  private _queueClippedTextureQuad(
    texture: TextureEntry,
    x: number,
    y: number,
    width: number,
    height: number,
    transform: mat3,
    opacity: number,
    stats: RenderStats,
    u0 = 0,
    v0 = 0,
    u1 = 1,
    v1 = 1,
    clip?: NovaRect | true,
  ): void {
    const rect = clip === true
      ? this._clipTextureRect(x, y, width, height, u0, v0, u1, v1, { x, y, width, height })
      : this._clipTextureRect(x, y, width, height, u0, v0, u1, v1, clip)
    if (!rect) {
      return
    }

    this._queueTextureQuad(texture, rect.x, rect.y, rect.width, rect.height, transform, opacity, stats, rect.u0, rect.v0, rect.u1, rect.v1)
  }

  /**
   * Выполняет внутреннюю операцию queue distance-field glyph quad.
   */
  private _queueDistanceFieldGlyphQuad(
    texture: TextureEntry,
    x: number,
    y: number,
    width: number,
    height: number,
    transform: mat3,
    color: string,
    opacity: number,
    pxRange: number,
    fieldSource: 'runtime-sdf' | 'prebuilt-msdf',
    stats: RenderStats,
    u0 = 0,
    v0 = 0,
    u1 = 1,
    v1 = 1,
  ): void {
    if (width <= 0 || height <= 0 || opacity <= 0) {
      return
    }
    if (!this._isTextureBindable(texture)) {
      return
    }
    this._flushRounded(stats)
    this._flushSolid(stats)
    this._flushTexture(stats)
    this._prepareDistanceFieldTransform(transform, stats)

    if (this._distanceFieldBatch && this._distanceFieldBatch !== texture) {
      this._flushDistanceField(stats)
    }
    this._distanceFieldBatch = texture
    this._pushDistanceFieldQuadVertices(
      this._distanceFieldData,
      x,
      y,
      width,
      height,
      parseNovaColor(color),
      opacity,
      pxRange,
      fieldSource === 'prebuilt-msdf' ? 1 : 0,
      u0,
      v0,
      u1,
      v1,
    )
    stats.instances += 1
    stats.distanceFieldGlyphQuads += 1
  }

  /**
   * Добавляет distance-field glyph quad с CPU clipping и пересчетом UV.
   */
  private _queueClippedDistanceFieldGlyphQuad(
    texture: TextureEntry,
    x: number,
    y: number,
    width: number,
    height: number,
    transform: mat3,
    color: string,
    opacity: number,
    pxRange: number,
    fieldSource: 'runtime-sdf' | 'prebuilt-msdf',
    stats: RenderStats,
    u0 = 0,
    v0 = 0,
    u1 = 1,
    v1 = 1,
    clip?: NovaRect | true,
  ): void {
    const rect = clip === true
      ? this._clipTextureRect(x, y, width, height, u0, v0, u1, v1, { x, y, width, height })
      : this._clipTextureRect(x, y, width, height, u0, v0, u1, v1, clip)
    if (!rect) {
      return
    }

    this._queueDistanceFieldGlyphQuad(
      texture,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      transform,
      color,
      opacity,
      pxRange,
      fieldSource,
      stats,
      rect.u0,
      rect.v0,
      rect.u1,
      rect.v1,
    )
  }

  /**
   * Переключает WebGL output в offscreen framebuffer.
   */
  private _beginRenderTarget(target: NovaRenderTarget, stats: RenderStats): void {
    const entry = this._ensureRenderTargetTexture(target, stats)
    stats.renderTargetRepaints += 1
    this._flush(stats)
    this._renderTargetStack.push(this._activeRenderTarget)
    this._activeRenderTarget = entry
    const gl = this._gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, entry.framebuffer)
    gl.viewport(0, 0, entry.pixelWidth, entry.pixelHeight)
    this._renderResolutionWidth = entry.width
    this._renderResolutionHeight = entry.height
    this._setScissor(null, mat3.create())
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }

  /**
   * Возвращает WebGL output в предыдущий framebuffer.
   */
  private _endRenderTarget(stats: RenderStats): void {
    this._flush(stats)
    this._activeRenderTarget = this._renderTargetStack.pop() ?? null
    const gl = this._gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._activeRenderTarget?.framebuffer ?? null)
    if (this._activeRenderTarget) {
      gl.viewport(0, 0, this._activeRenderTarget.pixelWidth, this._activeRenderTarget.pixelHeight)
      this._renderResolutionWidth = this._activeRenderTarget.width
      this._renderResolutionHeight = this._activeRenderTarget.height
    }
    else {
      this._device.resize()
      this._renderResolutionWidth = this._device.canvas.width
      this._renderResolutionHeight = this._device.canvas.height
    }
  }

  /**
   * Рисует offscreen framebuffer texture как обычный texture quad.
   */
  private _drawRenderTarget(
    targetId: string,
    x: number,
    y: number,
    width: number,
    height: number,
    transform: mat3,
    stats: RenderStats,
  ): void {
    const entry = this._renderTargets.get(targetId)
    if (!entry) {
      return
    }
    stats.renderTargetDraws += 1
    entry.texture.lastUsed = this._time
    this._queueTextureQuad(entry.texture, x, y, width, height, transform, 1, stats, 0, 1, 1, 0)
  }

  /**
   * Создает или обновляет WebGL texture/framebuffer для render target.
   */
  private _ensureRenderTargetTexture(target: NovaRenderTarget, stats: RenderStats): RenderTargetTextureEntry {
    const dpr = target.dpr || 1
    const width = Math.max(1, target.width)
    const height = Math.max(1, target.height)
    const pixelWidth = Math.max(1, Math.ceil(width * dpr))
    const pixelHeight = Math.max(1, Math.ceil(height * dpr))
    const current = this._renderTargets.get(target.id)
    if (
      current
      && current.width === width
      && current.height === height
      && current.pixelWidth === pixelWidth
      && current.pixelHeight === pixelHeight
      && current.dpr === dpr
    ) {
      return current
    }

    if (current) {
      this._gl.deleteFramebuffer(current.framebuffer)
      this._gl.deleteTexture(current.texture.texture)
      this._textures.delete(current.texture.key)
    }

    const gl = this._gl
    const texture = gl.createTexture()
    const framebuffer = gl.createFramebuffer()
    if (!texture || !framebuffer) {
      throw new Error('Failed to create Nova render target resources')
    }

    const uploadStartedAt = performance.now()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, pixelWidth, pixelHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._activeRenderTarget?.framebuffer ?? null)
    const uploadElapsed = performance.now() - uploadStartedAt
    stats.uploadMs += uploadElapsed
    stats.renderTargetUploadMs += uploadElapsed
    stats.renderTargetAllocations += 1
    stats.renderTargetBytes += pixelWidth * pixelHeight * 4

    const textureEntry: TextureEntry = {
      key: `render-target:${target.id}`,
      texture,
      width: pixelWidth,
      height: pixelHeight,
      bytes: pixelWidth * pixelHeight * 4,
      lastUsed: this._time,
      generation: this._atlasGeneration,
    }
    this._textures.set(textureEntry.key, textureEntry)
    stats.uploadBytes += textureEntry.bytes
    stats.atlasUploads += 1

    const entry: RenderTargetTextureEntry = {
      targetId: target.id,
      texture: textureEntry,
      framebuffer,
      width,
      height,
      pixelWidth,
      pixelHeight,
      dpr,
    }
    this._renderTargets.set(target.id, entry)
    return entry
  }

  /**
   * Обрезает destination rect и UV относительно clip rect.
   */
  private _clipTextureRect(
    x: number,
    y: number,
    width: number,
    height: number,
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    clip?: NovaRect | null,
  ): (NovaRect & { u0: number, v0: number, u1: number, v1: number }) | null {
    if (width <= 0 || height <= 0) {
      return null
    }
    if (!clip) {
      return { x, y, width, height, u0, v0, u1, v1 }
    }

    const visibleX = Math.max(x, clip.x)
    const visibleY = Math.max(y, clip.y)
    const visibleRight = Math.min(x + width, clip.x + clip.width)
    const visibleBottom = Math.min(y + height, clip.y + clip.height)
    const visibleWidth = visibleRight - visibleX
    const visibleHeight = visibleBottom - visibleY
    if (visibleWidth <= 0 || visibleHeight <= 0) {
      return null
    }

    const leftRatio = (visibleX - x) / width
    const topRatio = (visibleY - y) / height
    const rightRatio = (visibleRight - x) / width
    const bottomRatio = (visibleBottom - y) / height

    return {
      x: visibleX,
      y: visibleY,
      width: visibleWidth,
      height: visibleHeight,
      u0: u0 + (u1 - u0) * leftRatio,
      v0: v0 + (v1 - v0) * topRatio,
      u1: u0 + (u1 - u0) * rightRatio,
      v1: v0 + (v1 - v0) * bottomRatio,
    }
  }

  /**
   * Выполняет внутреннюю операцию push texture quad vertices.
   */
  private _pushTextureQuadVertices(
    target: Array<number>,
    x: number,
    y: number,
    width: number,
    height: number,
    opacity: number,
    u0 = 0,
    v0 = 0,
    u1 = 1,
    v1 = 1,
  ): void {
    const vertices = [
      [x, y, u0, v0],
      [x + width, y, u1, v0],
      [x, y + height, u0, v1],
      [x, y + height, u0, v1],
      [x + width, y, u1, v0],
      [x + width, y + height, u1, v1],
    ]

    for (const [px, py, u, v] of vertices) {
      target.push(px, py, u, v, 1, 1, 1, opacity)
    }
  }

  /**
   * Выполняет внутреннюю операцию push distance-field glyph quad vertices.
   */
  private _pushDistanceFieldQuadVertices(
    target: Array<number>,
    x: number,
    y: number,
    width: number,
    height: number,
    color: NovaParsedColor,
    opacity: number,
    pxRange: number,
    fieldMode: number,
    u0 = 0,
    v0 = 0,
    u1 = 1,
    v1 = 1,
  ): void {
    const vertices = [
      [x, y, u0, v0],
      [x + width, y, u1, v0],
      [x, y + height, u0, v1],
      [x, y + height, u0, v1],
      [x + width, y, u1, v0],
      [x + width, y + height, u1, v1],
    ]

    for (const [px, py, u, v] of vertices) {
      target.push(px, py, u, v, color.r, color.g, color.b, color.a * opacity, pxRange, fieldMode)
    }
  }

  /**
   * Записывает texture quad vertices.
   */
  private _writeTextureQuadVertices(
    target: Float32Array,
    offset: number,
    x: number,
    y: number,
    width: number,
    height: number,
    opacity: number,
    u0 = 0,
    v0 = 0,
    u1 = 1,
    v1 = 1,
  ): void {
    const vertices = [
      [x, y, u0, v0],
      [x + width, y, u1, v0],
      [x, y + height, u0, v1],
      [x, y + height, u0, v1],
      [x + width, y, u1, v0],
      [x + width, y + height, u1, v1],
    ]

    let cursor = offset
    for (const [px, py, u, v] of vertices) {
      target[cursor++] = px
      target[cursor++] = py
      target[cursor++] = u
      target[cursor++] = v
      target[cursor++] = 1
      target[cursor++] = 1
      target[cursor++] = 1
      target[cursor++] = opacity
    }
  }

  /**
   * Выполняет внутреннюю операцию push solid vertex.
   */
  private _pushSolidVertex(x: number, y: number, color: NovaParsedColor, opacity: number): void {
    this._solidData.push(x, y, color.r, color.g, color.b, color.a * opacity, 0, 0, 0)
  }

  /**
   * Выполняет внутреннюю операцию push solid vertex to.
   */
  private _pushSolidVertexTo(target: Array<number>, x: number, y: number, color: NovaParsedColor, opacity: number, animation = EMPTY_SHADER_ANIMATION): void {
    target.push(x, y, color.r, color.g, color.b, color.a * opacity, animation.phase, animation.speed, animation.amplitude)
  }

  /**
   * Сбрасывает накопленные операции в следующий слой runtime.
   */
  private _flush(stats: RenderStats): void {
    this._flushRounded(stats)
    this._flushSolid(stats)
    this._flushTexture(stats)
    this._flushDistanceField(stats)
  }

  /**
   * Выполняет внутреннюю операцию prepare rounded transform.
   */
  private _prepareRoundedTransform(transform: mat3, stats: RenderStats): void {
    if (mat3Equals(this._roundedTransform, transform)) {
      return
    }
    this._flushRounded(stats)
    mat3.copy(this._roundedTransform, transform)
  }

  /**
   * Выполняет внутреннюю операцию prepare solid transform.
   */
  private _prepareSolidTransform(transform: mat3, stats: RenderStats): void {
    if (mat3Equals(this._solidTransform, transform)) {
      return
    }
    this._flushSolid(stats)
    mat3.copy(this._solidTransform, transform)
  }

  /**
   * Выполняет внутреннюю операцию prepare texture transform.
   */
  private _prepareTextureTransform(transform: mat3, stats: RenderStats): void {
    if (mat3Equals(this._textureTransform, transform)) {
      return
    }
    this._flushTexture(stats)
    mat3.copy(this._textureTransform, transform)
  }

  /**
   * Выполняет внутреннюю операцию prepare distance-field transform.
   */
  private _prepareDistanceFieldTransform(transform: mat3, stats: RenderStats): void {
    if (mat3Equals(this._distanceFieldTransform, transform)) {
      return
    }
    this._flushDistanceField(stats)
    mat3.copy(this._distanceFieldTransform, transform)
  }

  /**
   * Сбрасывает накопленные операции в следующий слой runtime.
   */
  private _flushRounded(stats: RenderStats): void {
    if (this._distanceFieldData.length > 0) {
      this._flushDistanceField(stats)
    }
    if (this._rectData.length === 0 && !this._rectCachedData) {
      return
    }
    const gl = this._gl
    const data = this._rectCachedData ?? new Float32Array(this._rectData)
    const dirtyRanges = this._rectCachedData ? this._rectCachedDirtyRanges : null
    const uploadStartedAt = performance.now()
    gl.bindVertexArray(this._roundedVao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this._roundedBuffer)
    this._uploadArrayBuffer(data, this._roundedUpload, stats, dirtyRanges)
    stats.uploadMs += performance.now() - uploadStartedAt

    this._roundedProgram.use()
    gl.uniform2f(this._roundedProgram.uniformLocation('u_resolution'), this._renderResolutionWidth, this._renderResolutionHeight)
    gl.uniformMatrix3fv(this._roundedProgram.uniformLocation('u_transform'), false, this._roundedTransform)
    gl.uniform1f(this._roundedProgram.uniformLocation('u_time'), this._time)
    gl.drawArrays(gl.TRIANGLES, 0, data.length / RECT_STRIDE)

    stats.drawCalls += 1
    stats.batches += 1
    this._rectData = []
    this._rectCachedData = null
    this._rectCachedDirtyRanges = null
  }

  /**
   * Сбрасывает накопленные операции в следующий слой runtime.
   */
  private _flushSolid(stats: RenderStats): void {
    if (this._distanceFieldData.length > 0) {
      this._flushDistanceField(stats)
    }
    if (this._solidData.length === 0 && !this._solidCachedData) {
      return
    }
    const gl = this._gl
    const data = this._solidCachedData ?? new Float32Array(this._solidData)
    const dirtyRanges = this._solidCachedData ? this._solidCachedDirtyRanges : null
    const uploadStartedAt = performance.now()
    gl.bindVertexArray(this._solidVao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this._solidBuffer)
    this._uploadArrayBuffer(data, this._solidUpload, stats, dirtyRanges)
    stats.uploadMs += performance.now() - uploadStartedAt

    this._solidProgram.use()
    gl.uniform2f(this._solidProgram.uniformLocation('u_resolution'), this._renderResolutionWidth, this._renderResolutionHeight)
    gl.uniformMatrix3fv(this._solidProgram.uniformLocation('u_transform'), false, this._solidTransform)
    gl.uniform1f(this._solidProgram.uniformLocation('u_time'), this._time)
    gl.drawArrays(gl.TRIANGLES, 0, data.length / SOLID_STRIDE)

    stats.drawCalls += 1
    stats.batches += 1
    this._solidData = []
    this._solidCachedData = null
    this._solidCachedDirtyRanges = null
  }

  /**
   * Сбрасывает накопленные операции в следующий слой runtime.
   */
  private _flushTexture(stats: RenderStats): void {
    if (this._textureData.length === 0 && !this._textureCachedData) {
      return
    }
    const texture = this._textureCachedBatch?.texture ?? this._textureBatch
    if (!texture || !this._isTextureBindable(texture)) {
      this._textureData = []
      this._textureBatch = null
      this._textureCachedData = null
      this._textureCachedDirtyRanges = null
      this._textureCachedBatch = null
      return
    }

    const gl = this._gl
    const data = this._textureCachedData ?? new Float32Array(this._textureData)
    const dirtyRanges = this._textureCachedData ? this._textureCachedDirtyRanges : null
    const upload = this._textureCachedBatch?.upload ?? this._textureUpload
    const uploadStartedAt = performance.now()
    gl.bindVertexArray(this._resolveTextureVao(this._textureCachedBatch))
    gl.bindBuffer(gl.ARRAY_BUFFER, this._resolveTextureBuffer(this._textureCachedBatch))
    this._uploadArrayBuffer(data, upload, stats, dirtyRanges)
    stats.uploadMs += performance.now() - uploadStartedAt

    this._textureProgram.use()
    gl.uniform2f(this._textureProgram.uniformLocation('u_resolution'), this._renderResolutionWidth, this._renderResolutionHeight)
    gl.uniformMatrix3fv(this._textureProgram.uniformLocation('u_transform'), false, this._textureTransform)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texture.texture)
    gl.uniform1i(this._textureProgram.uniformLocation('u_texture'), 0)
    gl.drawArrays(gl.TRIANGLES, 0, data.length / TEXTURE_STRIDE)

    stats.drawCalls += 1
    stats.batches += 1
    this._textureData = []
    this._textureBatch = null
    this._textureCachedData = null
    this._textureCachedDirtyRanges = null
    this._textureCachedBatch = null
  }

  /**
   * Сбрасывает накопленные distance-field glyph операции в следующий слой runtime.
   */
  private _flushDistanceField(stats: RenderStats): void {
    if (this._distanceFieldData.length === 0) {
      return
    }
    const texture = this._distanceFieldBatch
    if (!texture || !this._isTextureBindable(texture)) {
      this._distanceFieldData = []
      this._distanceFieldBatch = null
      return
    }

    const gl = this._gl
    const data = new Float32Array(this._distanceFieldData)
    const uploadStartedAt = performance.now()
    gl.bindVertexArray(this._distanceFieldVao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this._distanceFieldBuffer)
    this._uploadArrayBuffer(data, this._distanceFieldUpload, stats)
    stats.uploadMs += performance.now() - uploadStartedAt

    this._distanceFieldTextProgram.use()
    gl.uniform2f(this._distanceFieldTextProgram.uniformLocation('u_resolution'), this._renderResolutionWidth, this._renderResolutionHeight)
    gl.uniformMatrix3fv(this._distanceFieldTextProgram.uniformLocation('u_transform'), false, this._distanceFieldTransform)
    gl.uniform1f(this._distanceFieldTextProgram.uniformLocation('u_edgeSoftness'), Math.max(0.1, this._textConfig.sdf.edgeSoftness))
    gl.uniform1i(this._distanceFieldTextProgram.uniformLocation('u_instanced'), 0)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texture.texture)
    gl.uniform1i(this._distanceFieldTextProgram.uniformLocation('u_texture'), 0)
    gl.drawArrays(gl.TRIANGLES, 0, data.length / DISTANCE_FIELD_STRIDE)

    stats.drawCalls += 1
    stats.distanceFieldDrawCalls += 1
    stats.batches += 1
    this._distanceFieldData = []
    this._distanceFieldBatch = null
  }

  /**
   * Выполняет внутреннюю операцию upload array buffer.
   */
  private _uploadArrayBuffer(data: Float32Array, state: WebGLUploadState, stats: RenderStats, dirtyRanges: Array<FloatDirtyRange> | null = null): void {
    const gl = this._gl
    stats.gpuBufferCapacityBytes += Math.max(state.capacityBytes, data.byteLength)

    if (state.lastData === data && state.capacityBytes >= data.byteLength) {
      if (dirtyRanges?.length) {
        const byteRanges = state.arena.mergeDirtyRanges(dirtyRanges.map(range => ({
          start: Math.max(0, range.start) * FLOAT_BYTES,
          end: Math.min(data.length, range.end) * FLOAT_BYTES,
        })))

        if (state.arena.shouldUploadFull(data.byteLength, byteRanges)) {
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, data)
          stats.bufferSubDataCalls += 1
          stats.fullUploads += 1
          stats.dirtyRangeCount += 1
          stats.uploadBytes += data.byteLength
          return
        }

        for (const range of byteRanges) {
          const start = Math.floor(range.start / FLOAT_BYTES)
          const end = Math.ceil(range.end / FLOAT_BYTES)
          if (end <= start) {
            continue
          }
          gl.bufferSubData(gl.ARRAY_BUFFER, start * FLOAT_BYTES, data.subarray(start, end))
          stats.bufferSubDataCalls += 1
          stats.dirtyRangeCount += 1
          stats.uploadBytes += (end - start) * FLOAT_BYTES
        }
      }
      return
    }

    if (state.capacityBytes >= data.byteLength) {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data)
      state.lastData = data
      stats.bufferSubDataCalls += 1
      stats.dirtyRangeCount += 1
      stats.uploadBytes += data.byteLength
      return
    }

    state.arena.ensureCapacity(data.byteLength)
    gl.bufferData(gl.ARRAY_BUFFER, state.arena.capacityBytes, gl.DYNAMIC_DRAW)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data)
    state.capacityBytes = state.arena.capacityBytes
    state.lastData = data
    stats.bufferDataCalls += 1
    stats.bufferSubDataCalls += 1
    stats.fullUploads += 1
    stats.dirtyRangeCount += 1
    stats.uploadBytes += data.byteLength
  }

  /**
   * Создает buffer.
   */
  private _createBuffer(): WebGLBuffer {
    const buffer = this._gl.createBuffer()
    if (!buffer) {
      throw new Error('Failed to create WebGL2 buffer')
    }
    return buffer
  }

  /**
   * Создает rounded vao.
   */
  private _createRoundedVao(buffer: WebGLBuffer = this._roundedBuffer): WebGLVertexArrayObject {
    const gl = this._gl
    const vao = this._createVao()
    const stride = RECT_STRIDE * FLOAT_BYTES
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    this._bindAttrib(this._roundedProgram, 'a_position', 2, stride, 0)
    this._bindAttrib(this._roundedProgram, 'a_local', 2, stride, 2)
    this._bindAttrib(this._roundedProgram, 'a_size', 2, stride, 4)
    this._bindAttrib(this._roundedProgram, 'a_radius', 1, stride, 6)
    this._bindAttrib(this._roundedProgram, 'a_fill', 4, stride, 7)
    this._bindAttrib(this._roundedProgram, 'a_border', 4, stride, 11)
    this._bindAttrib(this._roundedProgram, 'a_borderWidth', 1, stride, 15)
    this._bindAttrib(this._roundedProgram, 'a_animation', 3, stride, 16)
    this._bindAttrib(this._roundedProgram, 'a_motion', 2, stride, 19)
    gl.bindVertexArray(null)
    return vao
  }

  /**
   * Создает solid vao.
   */
  private _createSolidVao(buffer: WebGLBuffer = this._solidBuffer): WebGLVertexArrayObject {
    const gl = this._gl
    const vao = this._createVao()
    const stride = SOLID_STRIDE * FLOAT_BYTES
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    this._bindAttrib(this._solidProgram, 'a_position', 2, stride, 0)
    this._bindAttrib(this._solidProgram, 'a_color', 4, stride, 2)
    this._bindAttrib(this._solidProgram, 'a_animation', 3, stride, 6)
    gl.bindVertexArray(null)
    return vao
  }

  /**
   * Создает texture vao.
   */
  private _createTextureVao(buffer: WebGLBuffer = this._textureBuffer): WebGLVertexArrayObject {
    const gl = this._gl
    const vao = this._createVao()
    const stride = TEXTURE_STRIDE * FLOAT_BYTES
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    this._bindAttrib(this._textureProgram, 'a_position', 2, stride, 0)
    this._bindAttrib(this._textureProgram, 'a_uv', 2, stride, 2)
    this._bindAttrib(this._textureProgram, 'a_color', 4, stride, 4)
    gl.bindVertexArray(null)
    return vao
  }

  /**
   * Создает distance-field glyph vao.
   */
  private _createDistanceFieldVao(buffer: WebGLBuffer = this._distanceFieldBuffer): WebGLVertexArrayObject {
    const gl = this._gl
    const vao = this._createVao()
    const stride = DISTANCE_FIELD_STRIDE * FLOAT_BYTES
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    this._bindAttrib(this._distanceFieldTextProgram, 'a_position', 2, stride, 0)
    this._bindAttrib(this._distanceFieldTextProgram, 'a_uv', 2, stride, 2)
    this._bindAttrib(this._distanceFieldTextProgram, 'a_color', 4, stride, 4)
    this._bindAttrib(this._distanceFieldTextProgram, 'a_sdfParams', 2, stride, 8)
    gl.bindVertexArray(null)
    return vao
  }

  /**
   * Создает VAO для процедурного pattern rect.
   */
  private _createPatternRectVao(): WebGLVertexArrayObject {
    const gl = this._gl
    const vao = this._createVao()
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this._particleQuadBuffer)
    this._bindAttrib(this._patternRectProgram, 'a_unit', 2, 2 * FLOAT_BYTES, 0)
    gl.bindVertexArray(null)
    return vao
  }

  /**
   * Создает VAO для circle particle stream.
   */
  private _createParticleCircleVao(positionBuffer: WebGLBuffer, staticBuffer: WebGLBuffer): WebGLVertexArrayObject {
    const gl = this._gl
    const vao = this._createVao()
    gl.bindVertexArray(vao)

    gl.bindBuffer(gl.ARRAY_BUFFER, this._particleQuadBuffer)
    this._bindAttribDivisor(this._particleCircleProgram, 'a_unit', 2, 2 * FLOAT_BYTES, 0, 0)

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
    this._bindAttribDivisor(this._particleCircleProgram, 'a_center', 2, PARTICLE_POSITION_STRIDE * FLOAT_BYTES, 0, 1)

    gl.bindBuffer(gl.ARRAY_BUFFER, staticBuffer)
    const stride = PARTICLE_CIRCLE_STATIC_STRIDE * FLOAT_BYTES
    this._bindAttribDivisor(this._particleCircleProgram, 'a_radius', 1, stride, 0, 1)
    this._bindAttribDivisor(this._particleCircleProgram, 'a_fill', 4, stride, 1, 1)
    this._bindAttribDivisor(this._particleCircleProgram, 'a_stroke', 4, stride, 5, 1)
    this._bindAttribDivisor(this._particleCircleProgram, 'a_strokeWidth', 1, stride, 9, 1)

    gl.bindVertexArray(null)
    return vao
  }

  /**
   * Создает VAO для sprite particle stream.
   */
  private _createParticleSpriteVao(positionBuffer: WebGLBuffer, staticBuffer: WebGLBuffer): WebGLVertexArrayObject {
    const gl = this._gl
    const vao = this._createVao()
    gl.bindVertexArray(vao)

    gl.bindBuffer(gl.ARRAY_BUFFER, this._particleQuadBuffer)
    this._bindAttribDivisor(this._particleSpriteProgram, 'a_unit', 2, 2 * FLOAT_BYTES, 0, 0)

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
    this._bindAttribDivisor(this._particleSpriteProgram, 'a_position', 2, PARTICLE_POSITION_STRIDE * FLOAT_BYTES, 0, 1)

    gl.bindBuffer(gl.ARRAY_BUFFER, staticBuffer)
    const stride = PARTICLE_SPRITE_STATIC_STRIDE * FLOAT_BYTES
    this._bindAttribDivisor(this._particleSpriteProgram, 'a_size', 1, stride, 0, 1)
    this._bindAttribDivisor(this._particleSpriteProgram, 'a_opacity', 1, stride, 1, 1)

    gl.bindVertexArray(null)
    return vao
  }

  /**
   * Создает VAO для rect batch stream.
   */
  private _createRectBatchVao(geometryBuffer: WebGLBuffer, staticBuffer: WebGLBuffer): WebGLVertexArrayObject {
    const gl = this._gl
    const vao = this._createVao()
    gl.bindVertexArray(vao)

    gl.bindBuffer(gl.ARRAY_BUFFER, this._particleQuadBuffer)
    this._bindAttribDivisor(this._rectBatchProgram, 'a_unit', 2, 2 * FLOAT_BYTES, 0, 0)

    gl.bindBuffer(gl.ARRAY_BUFFER, geometryBuffer)
    this._bindAttribDivisor(this._rectBatchProgram, 'a_rect', 4, RECT_BATCH_GEOMETRY_STRIDE * FLOAT_BYTES, 0, 1)

    gl.bindBuffer(gl.ARRAY_BUFFER, staticBuffer)
    const stride = RECT_BATCH_STATIC_STRIDE * FLOAT_BYTES
    this._bindAttribDivisor(this._rectBatchProgram, 'a_color', 4, stride, 0, 1)
    this._bindAttribDivisor(this._rectBatchProgram, 'a_state', 1, stride, 4, 1)
    this._bindAttribDivisor(this._rectBatchProgram, 'a_radius', 1, stride, 5, 1)

    gl.bindVertexArray(null)
    return vao
  }

  /**
   * Создает VAO для GPU-resident time-range segment stream.
   */
  private _createTimeRangeSegmentBatchVao(geometryBuffer: WebGLBuffer, staticBuffer: WebGLBuffer): WebGLVertexArrayObject {
    const gl = this._gl
    const vao = this._createVao()
    gl.bindVertexArray(vao)

    gl.bindBuffer(gl.ARRAY_BUFFER, this._particleQuadBuffer)
    this._bindAttribDivisor(this._timeRangeSegmentProgram, 'a_unit', 2, 2 * FLOAT_BYTES, 0, 0)

    gl.bindBuffer(gl.ARRAY_BUFFER, geometryBuffer)
    this._bindAttribDivisor(this._timeRangeSegmentProgram, 'a_timeRect', 4, TIME_RANGE_SEGMENT_GEOMETRY_STRIDE * FLOAT_BYTES, 0, 1)

    gl.bindBuffer(gl.ARRAY_BUFFER, staticBuffer)
    this._bindAttribDivisor(this._timeRangeSegmentProgram, 'a_color', 4, TIME_RANGE_SEGMENT_STATIC_STRIDE * FLOAT_BYTES, 0, 1)
    this._bindAttribDivisor(this._timeRangeSegmentProgram, 'a_style', 4, TIME_RANGE_SEGMENT_STATIC_STRIDE * FLOAT_BYTES, 4, 1)

    gl.bindVertexArray(null)
    return vao
  }

  /**
   * Создает VAO для retained texture rect stream.
   */
  private _createTextureRectBatchVao(geometryBuffer: WebGLBuffer, staticBuffer: WebGLBuffer): WebGLVertexArrayObject {
    const gl = this._gl
    const vao = this._createVao()
    gl.bindVertexArray(vao)

    gl.bindBuffer(gl.ARRAY_BUFFER, this._particleQuadBuffer)
    this._bindAttribDivisor(this._textureRectBatchProgram, 'a_unit', 2, 2 * FLOAT_BYTES, 0, 0)

    gl.bindBuffer(gl.ARRAY_BUFFER, geometryBuffer)
    this._bindAttribDivisor(this._textureRectBatchProgram, 'a_rect', 4, TEXTURE_RECT_BATCH_GEOMETRY_STRIDE * FLOAT_BYTES, 0, 1)

    gl.bindBuffer(gl.ARRAY_BUFFER, staticBuffer)
    const stride = TEXTURE_RECT_BATCH_STATIC_STRIDE * FLOAT_BYTES
    this._bindAttribDivisor(this._textureRectBatchProgram, 'a_uvRect', 4, stride, 0, 1)
    this._bindAttribDivisor(this._textureRectBatchProgram, 'a_opacity', 1, stride, 4, 1)

    gl.bindVertexArray(null)
    return vao
  }

  /**
   * Создает VAO для retained distance-field glyph stream.
   */
  private _createDistanceFieldGlyphBatchVao(geometryBuffer: WebGLBuffer, staticBuffer: WebGLBuffer): WebGLVertexArrayObject {
    const gl = this._gl
    const vao = this._createVao()
    gl.bindVertexArray(vao)

    gl.bindBuffer(gl.ARRAY_BUFFER, this._particleQuadBuffer)
    this._bindAttribDivisor(this._distanceFieldTextProgram, 'a_unit', 2, 2 * FLOAT_BYTES, 0, 0)

    gl.bindBuffer(gl.ARRAY_BUFFER, geometryBuffer)
    this._bindAttribDivisor(this._distanceFieldTextProgram, 'a_rect', 4, TEXTURE_RECT_BATCH_GEOMETRY_STRIDE * FLOAT_BYTES, 0, 1)

    gl.bindBuffer(gl.ARRAY_BUFFER, staticBuffer)
    const stride = DISTANCE_FIELD_GLYPH_STATIC_STRIDE * FLOAT_BYTES
    this._bindAttribDivisor(this._distanceFieldTextProgram, 'a_uvRect', 4, stride, 0, 1)
    this._bindAttribDivisor(this._distanceFieldTextProgram, 'a_opacity', 1, stride, 4, 1)
    this._bindAttribDivisor(this._distanceFieldTextProgram, 'a_glyphColor', 4, stride, 5, 1)
    this._bindAttribDivisor(this._distanceFieldTextProgram, 'a_sdfInstanceParams', 2, stride, 9, 1)

    gl.bindVertexArray(null)
    return vao
  }

  /**
   * Создает VAO для retained analytic stripe stream.
   */
  private _createStripeBatchVao(geometryBuffer: WebGLBuffer, staticBuffer: WebGLBuffer): WebGLVertexArrayObject {
    const gl = this._gl
    const vao = this._createVao()
    gl.bindVertexArray(vao)

    gl.bindBuffer(gl.ARRAY_BUFFER, this._particleQuadBuffer)
    this._bindAttribDivisor(this._stripeBatchProgram, 'a_unit', 2, 2 * FLOAT_BYTES, 0, 0)

    gl.bindBuffer(gl.ARRAY_BUFFER, geometryBuffer)
    this._bindAttribDivisor(this._stripeBatchProgram, 'a_rect', 4, STRIPE_BATCH_GEOMETRY_STRIDE * FLOAT_BYTES, 0, 1)

    gl.bindBuffer(gl.ARRAY_BUFFER, staticBuffer)
    const stride = STRIPE_BATCH_STATIC_STRIDE * FLOAT_BYTES
    this._bindAttribDivisor(this._stripeBatchProgram, 'a_bgColor', 4, stride, 0, 1)
    this._bindAttribDivisor(this._stripeBatchProgram, 'a_stripeColor', 4, stride, 4, 1)
    this._bindAttribDivisor(this._stripeBatchProgram, 'a_stripeWidth', 1, stride, 8, 1)
    this._bindAttribDivisor(this._stripeBatchProgram, 'a_angle', 1, stride, 9, 1)

    gl.bindVertexArray(null)
    return vao
  }

  /**
   * Создает vao.
   */
  private _createVao(): WebGLVertexArrayObject {
    const vao = this._gl.createVertexArray()
    if (!vao) {
      throw new Error('Failed to create WebGL2 vertex array')
    }
    return vao
  }

  /**
   * Выполняет внутреннюю операцию bind attrib.
   */
  private _bindAttrib(program: NovaWebGLProgram, name: string, size: number, stride: number, offsetFloats: number): void {
    const location = program.attribLocation(name)
    this._gl.enableVertexAttribArray(location)
    this._gl.vertexAttribPointer(location, size, this._gl.FLOAT, false, stride, offsetFloats * FLOAT_BYTES)
  }

  /**
   * Привязывает instanced attribute.
   */
  private _bindAttribDivisor(program: NovaWebGLProgram, name: string, size: number, stride: number, offsetFloats: number, divisor: number): void {
    const location = program.attribLocation(name)
    this._gl.enableVertexAttribArray(location)
    this._gl.vertexAttribPointer(location, size, this._gl.FLOAT, false, stride, offsetFloats * FLOAT_BYTES)
    this._gl.vertexAttribDivisor(location, divisor)
  }

  /**
   * Загружает shared unit quad для instanced particle streams.
   */
  private _initializeParticleQuadBuffer(): void {
    const quad = new Float32Array([
      -1,
      -1,
      1,
      -1,
      -1,
      1,
      -1,
      1,
      1,
      -1,
      1,
      1,
    ])
    this._gl.bindBuffer(this._gl.ARRAY_BUFFER, this._particleQuadBuffer)
    this._gl.bufferData(this._gl.ARRAY_BUFFER, quad, this._gl.STATIC_DRAW)
  }

  /**
   * Вычисляет texture buffer.
   */
  private _resolveTextureBuffer(batch: TextureBatchCache | null): WebGLBuffer {
    if (!batch) {
      return this._textureBuffer
    }
    if (!batch.buffer) {
      batch.buffer = this._createBuffer()
    }
    return batch.buffer
  }

  /**
   * Вычисляет texture vao.
   */
  private _resolveTextureVao(batch: TextureBatchCache | null): WebGLVertexArrayObject {
    if (!batch) {
      return this._textureVao
    }
    if (!batch.vao) {
      batch.vao = this._createTextureVao(this._resolveTextureBuffer(batch))
    }
    return batch.vao
  }

  /**
   * Создает texture from source.
   */
  private _createTextureFromSource(
    key: string,
    source: CanvasImageSource,
    stats: RenderStats,
    options: { repeat?: boolean } = {},
  ): TextureEntry {
    const gl = this._gl
    const texture = gl.createTexture()
    if (!texture) {
      throw new Error('Failed to create WebGL2 texture')
    }

    const width = resolveSourceWidth(source)
    const height = resolveSourceHeight(source)
    const uploadStartedAt = performance.now()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, options.repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, options.repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource)
    stats.uploadMs += performance.now() - uploadStartedAt

    const bytes = Math.max(1, width * height * 4)
    stats.uploadBytes += bytes
    stats.atlasUploads += 1
    const entry: TextureEntry = { key, texture, width, height, bytes, lastUsed: this._time, generation: this._atlasGeneration }
    this._textures.set(key, entry)
    this._evictTexturesIfNeeded(entry)
    return entry
  }

  /**
   * Выполняет внутреннюю операцию rasterize text.
   */
  private _rasterizeText(text: NovaText, style: NovaCompiledTextStyle, scale: number): RasterizedText {
    const canvas = this._textRasterCanvas
    const boxWidth = Math.max(1, Math.ceil(text.width * scale))
    const boxHeight = Math.max(1, Math.ceil(text.height * scale))
    const measureContext = this._measureContext(style.font)
    const layout = this._resolveTextRasterLayout(text, style, measureContext)
    const bounds = this._resolveTextRasterBounds(text, style, layout, scale, boxWidth, boxHeight)
    canvas.width = bounds.width
    canvas.height = bounds.height

    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return { canvas, scale, ...bounds }
    }

    ctx.setTransform(scale, 0, 0, scale, 0, 0)
    ctx.clearRect(0, 0, bounds.drawWidth, bounds.drawHeight)
    ctx.font = style.font
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = colorToCss(style.color)
    ctx.fillText(layout.renderedText, layout.x - bounds.offsetX, layout.y - bounds.offsetY)
    return { canvas, scale, ...bounds }
  }

  /**
   * Вычисляет layout текста до выбора raster rectangle.
   */
  private _resolveTextRasterLayout(
    text: NovaText,
    style: NovaCompiledTextStyle,
    ctx: CanvasRenderingContext2D,
  ): TextRasterLayout {
    ctx.font = style.font
    const contentWidth = Math.max(0, text.width - style.padding.left - style.padding.right)
    const contentHeight = Math.max(0, text.height - style.padding.top - style.padding.bottom)
    const renderedText = style.ellipsis ? ellipsizeText(ctx, text.text, contentWidth) : text.text
    const metrics = ctx.measureText(renderedText)
    const sourceLineWidth = style.ellipsis ? ctx.measureText(text.text).width : metrics.width
    const horizontalAlign = this._resolveTextOverflowHorizontalAlign(style, sourceLineWidth, contentWidth)
    let x = text.x * 0
    if (horizontalAlign === 'left') {
      x = style.padding.left
    }
    if (horizontalAlign === 'center') {
      x = style.padding.left + (contentWidth - metrics.width) / 2
    }
    if (horizontalAlign === 'right') {
      x = text.width - style.padding.right - metrics.width
    }

    const textHeight = style.lineHeight
    let y = style.padding.top + style.fontSize
    if (style.verticalAlign === 'middle') {
      y = style.padding.top + (contentHeight - textHeight) / 2 + style.fontSize
    }
    if (style.verticalAlign === 'bottom') {
      y = text.height - style.padding.bottom - textHeight + style.fontSize
    }

    return {
      renderedText,
      x,
      y,
      metrics,
      sourceLineWidth,
      contentWidth,
      contentHeight,
    }
  }

  /**
   * Выбирает full-box или tight raster rectangle для run-atlas entry.
   */
  private _resolveTextRasterBounds(
    text: NovaText,
    style: NovaCompiledTextStyle,
    layout: TextRasterLayout,
    scale: number,
    boxWidth: number,
    boxHeight: number,
  ): Omit<RasterizedText, 'canvas' | 'scale'> {
    const boxPixels = Math.max(1, boxWidth * boxHeight)
    if (!this._textConfig.tightRunAtlas) {
      return {
        width: boxWidth,
        height: boxHeight,
        offsetX: 0,
        offsetY: 0,
        drawWidth: text.width,
        drawHeight: text.height,
        boxPixels,
      }
    }

    const inkLeft = Number.isFinite(layout.metrics.actualBoundingBoxLeft)
      ? layout.x - Math.max(0, layout.metrics.actualBoundingBoxLeft)
      : layout.x
    const inkRight = Number.isFinite(layout.metrics.actualBoundingBoxRight)
      ? layout.x + Math.max(layout.metrics.width, layout.metrics.actualBoundingBoxRight)
      : layout.x + layout.metrics.width
    const fallbackDescent = Math.max(0, style.lineHeight - style.fontSize)
    const inkTop = Number.isFinite(layout.metrics.actualBoundingBoxAscent)
      ? layout.y - Math.max(0, layout.metrics.actualBoundingBoxAscent)
      : layout.y - style.fontSize
    const inkBottom = Number.isFinite(layout.metrics.actualBoundingBoxDescent)
      ? layout.y + Math.max(0, layout.metrics.actualBoundingBoxDescent)
      : layout.y + fallbackDescent

    const leftPx = Math.max(0, Math.floor(inkLeft * scale - TEXT_RUN_ATLAS_PADDING_PX))
    const topPx = Math.max(0, Math.floor(inkTop * scale - TEXT_RUN_ATLAS_PADDING_PX))
    const rightPx = Math.min(boxWidth, Math.ceil(inkRight * scale + TEXT_RUN_ATLAS_PADDING_PX))
    const bottomPx = Math.min(boxHeight, Math.ceil(inkBottom * scale + TEXT_RUN_ATLAS_PADDING_PX))

    if (rightPx <= leftPx || bottomPx <= topPx) {
      return {
        width: 1,
        height: 1,
        offsetX: 0,
        offsetY: 0,
        drawWidth: 0,
        drawHeight: 0,
        boxPixels,
      }
    }

    return {
      width: rightPx - leftPx,
      height: bottomPx - topPx,
      offsetX: leftPx / scale,
      offsetY: topPx / scale,
      drawWidth: (rightPx - leftPx) / scale,
      drawHeight: (bottomPx - topPx) / scale,
      boxPixels,
    }
  }

  /**
   * Создает text key.
   */
  private _createTextKey(text: NovaText, style: NovaCompiledTextStyle, scale: number): string {
    return [
      'text',
      scale,
      this._createTextBaseKey(text, style),
    ].join(':')
  }

  /**
   * Создает text key без raster scale для fallback между buckets.
   */
  private _createTextBaseKey(text: NovaText, style: NovaCompiledTextStyle): string {
    return [
      text.text,
      text.width,
      text.height,
      style.font,
      style.lineHeight,
      colorToCss(style.color),
      style.padding.left,
      style.padding.right,
      style.padding.top,
      style.padding.bottom,
      style.horizontalAlign,
      style.overflowAlign,
      style.verticalAlign,
      style.ellipsis,
      this._textConfig.tightRunAtlas ? 'tight' : 'box',
    ].join(':')
  }

  /**
   * Вычисляет source key.
   */
  private _resolveSourceKey(source: CanvasImageSource): string {
    if (typeof source !== 'object' || source === null) {
      return 'source'
    }
    const existing = this._sourceTextureKeys.get(source)
    if (existing) {
      return existing
    }
    const next = `source:${this._sourceTextureKeysSize()}`
    this._sourceTextureKeys.set(source, next)
    return next
  }

  /**
   * Выполняет внутреннюю операцию source texture keys size.
   */
  private _sourceTextureKeysSize(): number {
    return this._textures.size + 1
  }

  /**
   * Вычисляет border sides.
   */
  private _resolveBorderSides(position: NovaBorder['position']): Array<'left' | 'right' | 'top' | 'bottom'> {
    if (position === 'vertical') {
      return ['left', 'right']
    }
    if (position === 'horizontal') {
      return ['top', 'bottom']
    }
    if (Array.isArray(position)) {
      return position
    }
    return ['left', 'right', 'top', 'bottom']
  }

  /**
   * Обновляет scissor.
   */
  private _setScissor(clip: NovaRenderClip | null, transform: mat3): void {
    const gl = this._gl
    if (!clip) {
      gl.disable(gl.SCISSOR_TEST)
      return
    }

    const bounds = transformRectBounds(transform, clip.x, clip.y, clip.width, clip.height)
    const dpr = this._activeRenderTarget?.dpr ?? this._device.canvas.dpr
    const pixelHeight = this._activeRenderTarget?.pixelHeight ?? this._device.canvas.pixelHeight
    const x = Math.max(0, Math.floor(bounds.x * dpr))
    const y = Math.max(0, Math.floor(pixelHeight - (bounds.y + bounds.height) * dpr))
    const width = Math.max(0, Math.ceil(bounds.width * dpr))
    const height = Math.max(0, Math.ceil(bounds.height * dpr))
    gl.enable(gl.SCISSOR_TEST)
    gl.scissor(x, y, width, height)
  }

  /**
   * Выполняет внутреннюю операцию texture memory mb.
   */
  private _textureMemoryMB(): number {
    let bytes = 0
    for (const texture of this._textures.values()) {
      bytes += texture.bytes
    }
    bytes += this._textAtlasMemoryBytes()
    bytes += this._glyphAtlasMemoryBytes()
    return bytes / 1024 / 1024
  }

  /**
   * Возвращает memory bytes text atlas pages.
   */
  private _textAtlasMemoryBytes(): number {
    let bytes = 0
    for (const page of this._textAtlasPages) {
      bytes += page.texture.bytes
    }
    return bytes
  }

  /**
   * Возвращает memory bytes glyph atlas pages.
   */
  private _glyphAtlasMemoryBytes(): number {
    let bytes = 0
    for (const page of this._glyphAtlasPages) {
      bytes += page.texture.bytes
    }
    return bytes
  }

  /**
   * Возвращает число atlas pages, которые использовались в текущем кадре.
   */
  private _countPinnedAtlasPages(): number {
    let count = 0
    for (const page of this._textAtlasPages) {
      if (page.pinnedFrame === this._time) {
        count += 1
      }
    }
    for (const page of this._glyphAtlasPages) {
      if (page.pinnedFrame === this._time) {
        count += 1
      }
    }
    return count
  }

  /**
   * Освобождает все text atlas pages.
   */
  private _destroyTextAtlas(): void {
    for (const page of this._textAtlasPages) {
      this._gl.deleteTexture(page.texture.texture)
    }
    this._textAtlasPages.length = 0
    this._textAtlasEntries.clear()
    this._textFallbackKeys.clear()
  }

  /**
   * Освобождает все glyph atlas pages.
   */
  private _destroyGlyphAtlas(): void {
    for (const page of this._glyphAtlasPages) {
      this._gl.deleteTexture(page.texture.texture)
    }
    this._glyphAtlasPages.length = 0
    this._glyphAtlasEntries.clear()
  }

  /**
   * Выполняет внутреннюю операцию evict textures if needed.
   */
  private _evictTexturesIfNeeded(protectedTexture?: TextureEntry): void {
    const maxBytes = 128 * 1024 * 1024
    let bytes = 0
    for (const texture of this._textures.values()) {
      bytes += texture.bytes
    }
    if (bytes <= maxBytes) {
      return
    }

    const entries = [...this._textures.values()].sort((a, b) => a.lastUsed - b.lastUsed)
    for (const entry of entries) {
      if (bytes <= maxBytes * FULL_UPLOAD_DIRTY_RATIO) {
        break
      }
      if (this._isTextureProtectedFromEviction(entry, protectedTexture)) {
        continue
      }
      this._gl.deleteTexture(entry.texture)
      this._textures.delete(entry.key)
      bytes -= entry.bytes
    }
  }

  /**
   * Проверяет, что texture сейчас используется активной draw batch и не может быть evicted.
   */
  private _isTextureProtectedFromEviction(entry: TextureEntry, protectedTexture?: TextureEntry): boolean {
    return entry === protectedTexture
      || entry === this._textureBatch
      || entry === this._textureCachedBatch?.texture
  }
}

function resolveTextBatchItemValue<T>(value: T | ReadonlyArray<T | undefined> | undefined, index: number): T | undefined {
  return Array.isArray(value) ? value[index] : value as T | undefined
}

function resolveTextBatchSharedValue<T>(value: T | ReadonlyArray<T | undefined> | undefined): T | undefined {
  return Array.isArray(value) ? undefined : value as T | undefined
}

function createRotatedTextTransform(text: NovaText, transform: mat3): mat3 {
  const rotation = normalizeTextRotation(text.rotation)
  if (rotation === 0) {
    return transform
  }
  const next = mat3.clone(transform)
  const cx = text.x + text.width / 2
  const cy = text.y + text.height / 2
  mat3.translate(next, next, [cx, cy])
  mat3.rotate(next, next, rotation)
  mat3.translate(next, next, [-cx, -cy])
  return next
}

function normalizeTextRotation(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * Выполняет внутреннюю операцию transform point.
 */
function transformPoint(matrix: mat3, x: number, y: number): { x: number, y: number } {
  return {
    x: matrix[0] * x + matrix[3] * y + matrix[6],
    y: matrix[1] * x + matrix[4] * y + matrix[7],
  }
}

/**
 * Выполняет внутреннюю операцию mat3 equals.
 */
function mat3Equals(a: mat3, b: mat3): boolean {
  for (let i = 0; i < 9; i += 1) {
    if (Math.abs(a[i] - b[i]) > 0.0001) {
      return false
    }
  }
  return true
}

/**
 * Объединяет float dirty ranges.
 */
function mergeFloatDirtyRanges(ranges: Array<FloatDirtyRange>): Array<FloatDirtyRange> {
  if (ranges.length <= 1) {
    return ranges
  }

  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const merged: Array<FloatDirtyRange> = []
  let current = { ...sorted[0] }

  for (let index = 1; index < sorted.length; index += 1) {
    const next = sorted[index]
    if (next.start <= current.end) {
      current.end = Math.max(current.end, next.end)
      continue
    }

    merged.push(current)
    current = { ...next }
  }

  merged.push(current)
  return merged
}

interface WebGLNineSliceSegment {
  sx: number
  sy: number
  sw: number
  sh: number
  dx: number
  dy: number
  dw: number
  dh: number
}

/**
 * Нормализует nine-slice insets для WebGL renderer.
 */
function normalizeWebGLNineSliceInput(slice: number | Partial<NovaNineSliceInsets>): NovaNineSliceInsets {
  if (typeof slice === 'number') {
    const value = Math.max(0, slice)
    return { top: value, right: value, bottom: value, left: value }
  }
  return {
    top: Math.max(0, slice.top ?? 0),
    right: Math.max(0, slice.right ?? 0),
    bottom: Math.max(0, slice.bottom ?? 0),
    left: Math.max(0, slice.left ?? 0),
  }
}

/**
 * Вычисляет девять source/destination сегментов для WebGL nine-slice.
 */
function resolveWebGLNineSliceSegments(
  sourceWidth: number,
  sourceHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
  slice: NovaNineSliceInsets,
): Array<WebGLNineSliceSegment> {
  const left = Math.min(slice.left, sourceWidth / 2, width / 2)
  const right = Math.min(slice.right, sourceWidth - left, width - left)
  const top = Math.min(slice.top, sourceHeight / 2, height / 2)
  const bottom = Math.min(slice.bottom, sourceHeight - top, height - top)
  const srcX = [0, left, sourceWidth - right]
  const srcY = [0, top, sourceHeight - bottom]
  const srcW = [left, Math.max(0, sourceWidth - left - right), right]
  const srcH = [top, Math.max(0, sourceHeight - top - bottom), bottom]
  const dstX = [x, x + left, x + width - right]
  const dstY = [y, y + top, y + height - bottom]
  const dstW = [left, Math.max(0, width - left - right), right]
  const dstH = [top, Math.max(0, height - top - bottom), bottom]
  const segments: Array<WebGLNineSliceSegment> = []

  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      segments.push({
        sx: srcX[column],
        sy: srcY[row],
        sw: srcW[column],
        sh: srcH[row],
        dx: dstX[column],
        dy: dstY[row],
        dw: dstW[column],
        dh: dstH[row],
      })
    }
  }

  return segments
}

/**
 * Вычисляет source width с учетом descriptor fallback.
 */
function resolveWebGLSourceWidth(source: CanvasImageSource, fallback?: number): number {
  return fallback ?? resolveSourceWidth(source)
}

/**
 * Вычисляет source height с учетом descriptor fallback.
 */
function resolveWebGLSourceHeight(source: CanvasImageSource, fallback?: number): number {
  return fallback ?? resolveSourceHeight(source)
}

/**
 * Выполняет внутреннюю операцию transform rect bounds.
 */
function transformRectBounds(matrix: mat3, x: number, y: number, width: number, height: number): NovaRenderClip {
  const p1 = transformPoint(matrix, x, y)
  const p2 = transformPoint(matrix, x + width, y)
  const p3 = transformPoint(matrix, x, y + height)
  const p4 = transformPoint(matrix, x + width, y + height)
  const minX = Math.min(p1.x, p2.x, p3.x, p4.x)
  const minY = Math.min(p1.y, p2.y, p3.y, p4.y)
  const maxX = Math.max(p1.x, p2.x, p3.x, p4.x)
  const maxY = Math.max(p1.y, p2.y, p3.y, p4.y)
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * Выполняет внутреннюю операцию color to css.
 */
function resolveAnimationVector(meta?: NovaShaderRenderMeta | null): ResolvedShaderAnimation {
  const animation = meta?.animation
  if (!animation) {
    return EMPTY_SHADER_ANIMATION
  }

  return {
    phase: Number.isFinite(animation.phase) ? animation.phase! : 0,
    speed: Number.isFinite(animation.speed) ? animation.speed! : 0.08,
    amplitude: Math.max(0, Math.min(1, Number.isFinite(animation.amplitude) ? animation.amplitude! : 0.18)),
  }
}

/**
 * Нормализует metadata shader movement.
 */
function resolveMotionVector(meta?: NovaShaderRenderMeta | null): ResolvedShaderMotion {
  const motion = meta?.motion
  if (!motion) {
    return EMPTY_SHADER_MOTION
  }
  const speed = Number.isFinite(motion.speed) ? motion.speed! : 0
  const wrapWidth = Number.isFinite(motion.wrapWidth) ? motion.wrapWidth! : 0

  return {
    speed,
    wrapWidth: Math.max(0, wrapWidth),
  }
}

/**
 * Выполняет внутреннюю операцию color to css.
 */
function colorToCss(color: NovaParsedColor): string {
  return `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, ${color.a})`
}

/**
 * Выполняет внутреннюю операцию ellipsize text.
 */
function ellipsizeText(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) {
    return text
  }
  const suffix = '...'
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (ctx.measureText(`${text.slice(0, mid)}${suffix}`).width <= width) {
      lo = mid
    }
    else { hi = mid - 1 }
  }
  return `${text.slice(0, lo)}${suffix}`
}

/**
 * Вычисляет source width.
 */
function resolveSourceWidth(source: CanvasImageSource): number {
  if ('naturalWidth' in source && typeof source.naturalWidth === 'number') {
    return source.naturalWidth
  }
  if ('videoWidth' in source && typeof source.videoWidth === 'number') {
    return source.videoWidth
  }
  return 'width' in source && typeof source.width === 'number' ? source.width : 1
}

/**
 * Вычисляет source height.
 */
function resolveSourceHeight(source: CanvasImageSource): number {
  if ('naturalHeight' in source && typeof source.naturalHeight === 'number') {
    return source.naturalHeight
  }
  if ('videoHeight' in source && typeof source.videoHeight === 'number') {
    return source.videoHeight
  }
  return 'height' in source && typeof source.height === 'number' ? source.height : 1
}
