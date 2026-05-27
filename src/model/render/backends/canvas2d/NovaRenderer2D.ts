import { randomString } from '@endge/utils'
import type { mat3 } from 'gl-matrix'
import type { NovaCanvas } from '@/model/platform/NovaCanvas'
import type {
  NovaArc,
  NovaBorder,
  NovaCircle,
  NovaIcon,
  NovaIconBatch,
  NovaLine,
  NovaNineSliceImage,
  NovaParticleBatch,
  NovaPolygon,
  NovaRect,
  NovaRectBatch,
  NovaRenderer,
  NovaRendererStateMark,
  NovaSchema,
  NovaStripeRectBatch,
  NovaText,
  NovaTextBatch,
  NovaTextChunk,
  NovaTimeRangeSegmentBatch,
} from '@/domain/types/renderer.types'
import { RendererType } from '@/domain/types/renderer.types'
import { NovaSchemaRegistry } from '@/model/runtime/components/NovaSchemaRegistry'
import type { NovaRenderFrame, NovaRenderMetrics } from '@/domain/types/rendering/index'
import type { NovaRenderBackend } from '@/model/render/backends/nova-render-backend'
import type { NovaAssetRegistry, NovaNineSliceInsets } from '@/model/runtime/assets/NovaAssetRegistry'
import { NovaAssets } from '@/model/runtime/assets/NovaAssetRegistry'
import { resolveNovaIconRenderOpacity, resolveNovaIconRenderRect } from '@/model/render/utils/nova-icon-rendering'

/**
 * Рисует compiled Nova render frame через Canvas2D backend.
 */
export class NovaRenderer2D implements NovaRenderer, NovaRenderBackend {
  readonly id: string = randomString(5)
  readonly type = RendererType.Web2D
  readonly novaCanvas: NovaCanvas
  readonly capabilities = {
    canvas2d: true,
    webgl: false,
    schema: true,
    rect: true,
    border: true,
    line: true,
    circle: true,
    arc: true,
    polygon: true,
    icon: true,
    text: true,
    particles: true,
    rectBatches: true,
    stripeBatches: true,
    iconBatches: true,
    textBatches: true,
    measureText: true,
  }

  private readonly _measureCanvas = document.createElement('canvas')
  private readonly _schemaRegistry: NovaSchemaRegistry
  private readonly _renderTargets = new Map<string, HTMLCanvasElement>()
  private readonly _targetStack: Array<CanvasRenderingContext2D | null> = []
  private readonly _stateMarks: Array<NovaRendererStateMark> = []
  private _activeTargetContext: CanvasRenderingContext2D | null = null
  private _clearTextBackground = false
  private _transformDepth = 0
  private _clipDepth = 0

  /**
   * Создает instance и подготавливает внутреннее состояние.
   */
  constructor(
    canvas: NovaCanvas,
    schemaRegistry = new NovaSchemaRegistry(),
    private readonly _assets: NovaAssetRegistry = NovaAssets.global,
  ) {
    this.novaCanvas = canvas
    this._schemaRegistry = schemaRegistry
  }

  /**
   * Возвращает ctx.
   */
  get ctx(): CanvasRenderingContext2D {
    if (this._activeTargetContext) return this._activeTargetContext
    return this.novaCanvas.getContext2D()
  }

  /**
   * Возвращает активную render-state границу.
   */
  private get activeStateMark(): NovaRendererStateMark | undefined {
    return this._stateMarks[this._stateMarks.length - 1]
  }

  /**
   * Очищает внутреннее состояние.
   */
  clear(): void {
    const ctx = this.ctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    if (this._activeTargetContext) {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
    } else {
      ctx.clearRect(0, 0, this.novaCanvas.pixelWidth, this.novaCanvas.pixelHeight)
      ctx.scale(this.novaCanvas.dpr, this.novaCanvas.dpr)
    }
  }

  /**
   * Очищает root render target один раз перед ordered surface replay.
   */
  clearRoot(): void {
    this.clear()
  }

  /**
   * Начинает рисовать в offscreen canvas target.
   */
  beginRenderTarget(id: string, width: number, height: number, options: { dpr?: number } = {}): void {
    const dpr = options.dpr ?? this.novaCanvas.dpr ?? 1
    const pixelWidth = Math.max(1, Math.ceil(width * dpr))
    const pixelHeight = Math.max(1, Math.ceil(height * dpr))
    let canvas = this._renderTargets.get(id)
    if (!canvas) {
      canvas = document.createElement('canvas')
      this._renderTargets.set(id, canvas)
    }
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth
      canvas.height = pixelHeight
    }
    const context = canvas.getContext('2d')
    if (!context) return
    this._targetStack.push(this._activeTargetContext)
    this._activeTargetContext = context
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.clearRect(0, 0, pixelWidth, pixelHeight)
    context.scale(dpr, dpr)
  }

  /**
   * Завершает offscreen target.
   */
  endRenderTarget(): void {
    this._activeTargetContext = this._targetStack.pop() ?? null
  }

  /**
   * Рисует offscreen target обратно в активный canvas.
   */
  drawRenderTarget(id: string, x: number, y: number, width: number, height: number): void {
    const canvas = this._renderTargets.get(id)
    if (!canvas || width <= 0 || height <= 0) return
    this.ctx.drawImage(canvas, x, y, width, height)
  }

  /**
   * Временно включает очистку text bounds перед draw.
   */
  withTextBackgroundClearing<T>(enabled: boolean, run: () => T): T {
    const previous = this._clearTextBackground
    this._clearTextBackground = enabled
    try {
      return run()
    } finally {
      this._clearTextBackground = previous
    }
  }

  /**
   * Выполняет render-операцию frame.
   */
  renderFrame(frame: NovaRenderFrame): NovaRenderMetrics {
    const startedAt = performance.now()
    const itemsById = new Map(frame.items.map(item => [item.id, item]))
    let drawCalls = 0

    for (const command of frame.commands) {
      switch (command.type) {
        case 'clear':
          this.clear()
          break
        case 'save':
          this.save()
          break
        case 'restore':
          this.restore()
          break
        case 'setTransform':
          if (command.transform) this.setTransform(command.transform)
          break
        case 'clip':
          if (command.clip) this.clip(command.clip.x, command.clip.y, command.clip.width, command.clip.height)
          break
        case 'clearClip':
          this.clearClip()
          break
        case 'beginRenderTarget':
        case 'endRenderTarget':
        case 'drawRenderTarget':
          // Canvas2D backend intentionally replays commands between target markers
          // directly to root canvas. Offscreen target acceleration is WebGL-only.
          break
        case 'drawItem': {
          const item = command.itemId ? itemsById.get(command.itemId) : undefined
          if (item?.schemaItem) {
            this.schema([item.schemaItem])
            drawCalls += 1
          }
          break
        }
        case 'drawSchemaBatch':
          if (command.schemaItems?.length) {
            this.schema(command.schemaItems)
            drawCalls += 1
          }
          break
        case 'drawParticles':
          if (command.particleBatch) {
            this.particles(command.particleBatch)
            drawCalls += 1
          }
          break
        case 'drawRectBatch':
          if (command.rectBatch) {
            this.rects(command.rectBatch)
            drawCalls += 1
          }
          break
        case 'drawTimeRangeSegmentBatch':
          if (command.timeRangeSegmentBatch) {
            this.timeRangeSegments(command.timeRangeSegmentBatch)
            drawCalls += 1
          }
          break
        case 'drawStripeBatch':
          if (command.stripeBatch) {
            this.stripes(command.stripeBatch)
            drawCalls += 1
          }
          break
        case 'drawIconBatch':
          if (command.iconBatch) {
            this.icons(command.iconBatch)
            drawCalls += 1
          }
          break
        case 'drawTextBatch':
          if (command.textBatch) {
            this.texts(command.textBatch)
            drawCalls += 1
          }
          break
        case 'cursor':
          if (command.cursor) this.cursor(command.cursor)
          break
        default:
          break
      }
    }

    const backendMs = performance.now() - startedAt

    return {
      ...frame.metrics,
      backendMs,
      drawMs: backendMs,
      drawCalls,
      batches: drawCalls,
      uploadMs: 0,
      uploadBytes: 0,
      bufferDataCalls: 0,
      bufferSubDataCalls: 0,
      fullUploads: 0,
      dirtyRangeCount: 0,
      gpuBufferCapacityBytes: 0,
      textRasterMs: 0,
      textRasterCount: 0,
      atlasUploads: 0,
      uniformOnlyFrames: 0,
      atlasMemoryMB: 0,
      cachedTextureMemoryMB: 0,
    }
  }

  /**
   * Выполняет внутреннюю операцию schema.
   */
  schema(schema: NovaSchema<any>): void {
    const items = Array.isArray(schema) ? schema : [schema]
    for (const item of items) {
      if (item.active === false) {
        continue
      }

      if (item.clip !== undefined && item.clip !== true) {
        this.clip(item.clip.x, item.clip.y, item.clip.width, item.clip.height)
      }

      switch (item.type) {
        case 'text':
          this.text(item as NovaText)
          break
        case 'rect':
          this.rect(item as NovaRect)
          break
        case 'border':
          this.border(item as NovaBorder)
          break
        case 'line':
          this.line(item as NovaLine)
          break
        case 'circle':
          this.circle(item as NovaCircle)
          break
        case 'arc':
          this.arc(item as NovaArc)
          break
        case 'polygon':
          this.polygon(item as NovaPolygon)
          break
        case 'icon':
          this.icon(item as NovaIcon)
          break
        case 'nine-slice-image':
          this.nineSliceImage(item as NovaNineSliceImage)
          break
        default:
          this._schemaRegistry.renderSchemaComponent(this, item, 'schema')
          break
      }

      if (item.clip !== undefined && item.clip !== true) {
        this.clearClip()
      }
    }
  }

  /**
   * Выполняет внутреннюю операцию red box.
   */
  redBox(): void {
    this.schema([
      {
        type: 'rect',
        x: 0,
        y: 0,
        width: 50,
        height: 50,
        styles: {
          background: 'red',
        },
      },
    ])
  }

  /**
   * Выполняет внутреннюю операцию save.
   */
  save(): void {
    this.ctx.save()
    this._transformDepth += 1
  }

  /**
   * Выполняет внутреннюю операцию restore.
   */
  restore(): void {
    const minDepth = this.activeStateMark?.transformDepth ?? 0
    if (this._transformDepth <= minDepth) return
    this.restoreUnsafe()
  }

  /**
   * Выполняет внутреннюю операцию clip.
   */
  clip(x: number, y: number, width: number, height: number): void {
    const ctx = this.ctx
    ctx.save()
    this._clipDepth += 1
    ctx.beginPath()
    ctx.rect(x, y, width, height)
    ctx.clip()
  }

  /**
   * Очищает clip.
   */
  clearClip(): void {
    const minDepth = this.activeStateMark?.clipDepth ?? 0
    if (this._clipDepth <= minDepth) return
    this.clearClipUnsafe()
  }

  /**
   * Сохраняет границу mutable render-state.
   */
  markState(): NovaRendererStateMark {
    const mark = {
      transformDepth: this._transformDepth,
      clipDepth: this._clipDepth,
    }
    this._stateMarks.push(mark)
    return mark
  }

  /**
   * Восстанавливает mutable render-state до сохраненной границы.
   */
  restoreState(mark: NovaRendererStateMark): void {
    while (this._clipDepth > mark.clipDepth) {
      this.clearClipUnsafe()
    }
    while (this._transformDepth > mark.transformDepth) {
      this.restoreUnsafe()
    }

    const markIndex = this._stateMarks.lastIndexOf(mark)
    if (markIndex >= 0) {
      this._stateMarks.splice(markIndex)
    }
  }

  /**
   * Обновляет transform.
   */
  setTransform(matrix: mat3): void {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.ctx.scale(this.novaCanvas.dpr, this.novaCanvas.dpr)
    this.ctx.transform(matrix[0], matrix[1], matrix[3], matrix[4], matrix[6], matrix[7])
  }

  /**
   * Выполняет внутреннюю операцию rect.
   */
  rect(p: NovaRect): void {
    const ctx = this.ctx
    ctx.save()

    if (p.styles?.opacity !== undefined) ctx.globalAlpha = p.styles.opacity

    // Фон
    if (p.styles?.background) {
      const background = p.styles.background
      const source = this._assets.resolveDrawable(background)
      this._drawRoundedRect(p.x, p.y, p.width, p.height, p.styles.radius ?? p.styles.border?.radius ?? 0)
      if (typeof background === 'string') {
        ctx.fillStyle = background
        ctx.fill()
      } else if (source) {
        const fillMode = this._assets.resolveDrawableFillMode(background)
        if (fillMode === 'stretch') {
          ctx.clip()
          ctx.drawImage(source, p.x, p.y, p.width, p.height)
        } else {
          ctx.fillStyle = ctx.createPattern(source, fillMode)!
          ctx.fill()
        }
      }
    }

    // Рамка
    if (p.styles?.border?.width) {
      ctx.strokeStyle = p.styles.border.color || '#000'
      ctx.lineWidth = p.styles.border.width

      if (p.styles.border.dashPattern) {
        ctx.setLineDash(p.styles.border.dashPattern)
      }

      this._drawRoundedRect(p.x, p.y, p.width, p.height, p.styles.radius ?? p.styles.border.radius ?? 0)
      ctx.stroke()
      ctx.setLineDash([])
    }

    ctx.globalAlpha = 1

    ctx.restore()
  }

  /**
   * Выполняет внутреннюю операцию text.
   */
  text(p: NovaText): void {
    //
    //
    const padding = this._resolvePadding(p.styles?.padding)
    const hasPadding: boolean = padding.left !== 0 || padding.right !== 0 || padding.top !== 0 || padding.bottom !== 0

    const shouldClipToInner: boolean = p.clip === true || p.clip !== undefined || hasPadding

    if (shouldClipToInner) {
      const explicitClip = p.clip !== true && p.clip !== undefined ? p.clip : null
      const x: number = explicitClip?.x ?? p.x + padding.left
      const y: number = explicitClip?.y ?? p.y + padding.top
      const width: number = explicitClip?.width ?? p.width - (padding.left + padding.right)
      const height: number = explicitClip?.height ?? p.height - (padding.top + padding.bottom)

      if (width > 0 && height > 0) {
        this.clip(x, y, width, height)
      } else {
        this.clip(p.x, p.y, p.width, p.height)
      }
    }

    if (p.parser === 'markdown') {
      this.textMarkdown(p)
    } else {
      this.textString(p)
    }

    if (shouldClipToInner) {
      this.clearClip()
    }
  }

  /**
   * Возвращает per-item clip для retained text batch.
   */
  private resolveTextBatchClip(batch: NovaTextBatch, index: number): NovaText['clip'] | null | undefined {
    const clipX = batch.clipX?.[index]
    const clipY = batch.clipY?.[index]
    const clipWidth = batch.clipWidth?.[index]
    const clipHeight = batch.clipHeight?.[index]
    if (
      clipX === undefined ||
      clipY === undefined ||
      clipWidth === undefined ||
      clipHeight === undefined
    ) return undefined
    if (clipWidth < 0 || clipHeight < 0) return null

    return {
      x: clipX,
      y: clipY,
      width: clipWidth,
      height: clipHeight,
    }
  }

  /**
   * Выполняет внутреннюю операцию resolve padding.
   */
  private _resolvePadding(padding: any): {
    left: number
    right: number
    top: number
    bottom: number
  } {
    if (!padding) return { left: 0, right: 0, top: 0, bottom: 0 }
    if ('all' in padding)
      {return {
        left: padding.all,
        right: padding.all,
        top: padding.all,
        bottom: padding.all,
      }}
    if ('horizontal' in padding || 'vertical' in padding) {
      return {
        left: padding.horizontal || 0,
        right: padding.horizontal || 0,
        top: padding.vertical || 0,
        bottom: padding.vertical || 0,
      }
    }
    return {
      left: padding.left || 0,
      right: padding.right || 0,
      top: padding.top || 0,
      bottom: padding.bottom || 0,
    }
  }

  /**
   * Выполняет внутреннюю операцию line.
   */
  line(p: NovaLine): void {
    const ctx = this.ctx
    ctx.save()
    ctx.strokeStyle = p.styles?.color || '#000'
    ctx.lineWidth = p.styles?.width || 1
    ctx.setLineDash(p.styles?.dashPattern || [])
    ctx.globalAlpha = p.styles?.opacity ?? 1
    ctx.beginPath()
    ctx.moveTo(p.x1, p.y1)
    ctx.lineTo(p.x2, p.y2)
    ctx.stroke()
    ctx.restore()
  }

  /**
   * Выполняет внутреннюю операцию circle.
   */
  circle(p: NovaCircle): void {
    const ctx = this.ctx
    ctx.save()
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2)
    if (p.styles?.background) {
      ctx.fillStyle = p.styles.background as string
      ctx.fill()
    }
    if (p.styles?.border?.width) {
      ctx.strokeStyle = p.styles.border.color || '#000'
      ctx.lineWidth = p.styles.border.width
      ctx.stroke()
    }
    ctx.restore()
  }

  /**
   * Выполняет внутреннюю операцию arc.
   */
  arc(p: NovaArc): void {
    const width = p.styles?.width ?? 1
    const opacity = p.styles?.opacity ?? 1
    if (p.radius <= 0 || width <= 0 || opacity <= 0) return

    const ctx = this.ctx
    ctx.save()
    ctx.strokeStyle = p.styles?.color ?? '#000'
    ctx.lineWidth = width
    ctx.lineCap = p.styles?.lineCap ?? 'butt'
    ctx.globalAlpha = opacity
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.radius, p.startAngle, p.endAngle, p.counterClockwise)
    ctx.stroke()
    ctx.restore()
  }

  /**
   * Выполняет внутреннюю операцию polygon.
   */
  polygon(p: NovaPolygon): void {
    const ctx = this.ctx
    ctx.save()

    if (p.styles?.opacity !== undefined) ctx.globalAlpha = p.styles.opacity

    ctx.beginPath()
    if (p.points.length > 0) {
      ctx.moveTo(p.points[0].x, p.points[0].y)
      for (let i = 1; i < p.points.length; i++) {
        ctx.lineTo(p.points[i].x, p.points[i].y)
      }
      ctx.closePath()
    }

    if (p.styles?.background) {
      ctx.fillStyle = p.styles.background
      ctx.fill()
    }
    if (p.styles?.stroke) {
      ctx.strokeStyle = p.styles.stroke
      ctx.lineWidth = p.styles.lineWidth ?? 1
      ctx.stroke()
    }

    ctx.globalAlpha = 1
    ctx.restore()
  }

  /**
   * Выполняет внутреннюю операцию icon.
   */
  icon(p: NovaIcon): void {
    const ctx = this.ctx
    ctx.save()

    ctx.globalAlpha = resolveNovaIconRenderOpacity(p, this.novaCanvas.dpr)

    const iconObject = this._assets.resolveDrawable(p.icon)
    if (!iconObject) {
      console.warn(`Icon not found: ${p.icon}`)
      ctx.restore()
      return
    }

    const rect = resolveNovaIconRenderRect(p, this.novaCanvas.dpr)
    ctx.drawImage(iconObject, rect.x, rect.y, rect.width, rect.height)
    ctx.restore()
  }

  /**
   * Выполняет внутреннюю операцию nine-slice-image.
   */
  nineSliceImage(p: NovaNineSliceImage): void {
    const ctx = this.ctx
    const source = this._assets.resolveDrawable(p.image)
    if (!source) return

    const descriptor = this._assets.resolveNineSlice(p.image)
    const slice = normalizeNineSliceInput(p.slice ?? descriptor?.slice ?? 0)
    const centerMode = p.centerMode ?? descriptor?.centerMode ?? 'stretch'
    const sourceWidth = resolveCanvasSourceWidth(source)
    const sourceHeight = resolveCanvasSourceHeight(source)
    const columns = resolveNineSliceSegments(sourceWidth, p.width, slice.left, slice.right)
    const rows = resolveNineSliceSegments(sourceHeight, p.height, slice.top, slice.bottom)

    ctx.save()
    ctx.globalAlpha = p.styles?.opacity ?? 1

    for (let row = 0; row < rows.length; row += 1) {
      for (let column = 0; column < columns.length; column += 1) {
        const sourceRect = {
          x: columns[column].sourceStart,
          y: rows[row].sourceStart,
          width: columns[column].sourceSize,
          height: rows[row].sourceSize,
        }
        const targetRect = {
          x: p.x + columns[column].targetStart,
          y: p.y + rows[row].targetStart,
          width: columns[column].targetSize,
          height: rows[row].targetSize,
        }
        if (sourceRect.width <= 0 || sourceRect.height <= 0 || targetRect.width <= 0 || targetRect.height <= 0) continue
        if (centerMode === 'repeat' && row === 1 && column === 1) {
          this.drawRepeatedNineSliceCenter(source, sourceRect, targetRect)
          continue
        }
        ctx.drawImage(source, sourceRect.x, sourceRect.y, sourceRect.width, sourceRect.height, targetRect.x, targetRect.y, targetRect.width, targetRect.height)
      }
    }

    ctx.restore()
  }

  /**
   * Рисует repeated center для nine-slice-image.
   */
  private drawRepeatedNineSliceCenter(
    source: CanvasImageSource,
    sourceRect: { x: number; y: number; width: number; height: number },
    targetRect: { x: number; y: number; width: number; height: number },
  ): void {
    const ctx = this.ctx
    const tile = document.createElement('canvas')
    const tileCtx = tile.getContext('2d')
    tile.width = Math.max(1, sourceRect.width)
    tile.height = Math.max(1, sourceRect.height)
    if (!tileCtx) return

    tileCtx.drawImage(source, sourceRect.x, sourceRect.y, sourceRect.width, sourceRect.height, 0, 0, tile.width, tile.height)
    const pattern = ctx.createPattern(tile, 'repeat')
    if (!pattern) return

    ctx.save()
    ctx.beginPath()
    ctx.rect(targetRect.x, targetRect.y, targetRect.width, targetRect.height)
    ctx.clip()
    ctx.fillStyle = pattern
    ctx.fillRect(targetRect.x, targetRect.y, targetRect.width, targetRect.height)
    ctx.restore()
  }

  /**
   * Рисует retained particle batch через Canvas2D fallback.
   */
  particles(batch: NovaParticleBatch): void {
    const ctx = this.ctx
    const opacity = batch.opacity ?? 1
    const positions = batch.positions
    const sizes = batch.sizes
    const colors = batch.colors
    const strokeColors = batch.strokeColors
    const strokeWidths = batch.strokeWidths

    ctx.save()
    ctx.globalAlpha = opacity

    for (let index = 0; index < batch.count; index += 1) {
      const x = positions[index * 2] ?? 0
      const y = positions[index * 2 + 1] ?? 0
      const size = sizes[index] ?? 1

      if (batch.kind === 'sprite') {
        const source = this._assets.resolveDrawable(batch.texture)
        if (source) ctx.drawImage(source, x, y, size, size)
        continue
      }

      const fillOffset = index * 4
      const strokeOffset = index * 4
      const fillAlpha = (colors[fillOffset + 3] ?? 1) * opacity
      const strokeAlpha = ((strokeColors?.[strokeOffset + 3] ?? 0) as number) * opacity
      const strokeWidth = strokeWidths?.[index] ?? 0

      ctx.beginPath()
      ctx.arc(x, y, size, 0, Math.PI * 2)
      if (fillAlpha > 0) {
        ctx.fillStyle = `rgba(${Math.round((colors[fillOffset] ?? 1) * 255)}, ${Math.round((colors[fillOffset + 1] ?? 1) * 255)}, ${Math.round((colors[fillOffset + 2] ?? 1) * 255)}, ${fillAlpha})`
        ctx.fill()
      }
      if (strokeAlpha > 0 && strokeWidth > 0 && strokeColors) {
        ctx.lineWidth = strokeWidth
        ctx.strokeStyle = `rgba(${Math.round((strokeColors[strokeOffset] ?? 1) * 255)}, ${Math.round((strokeColors[strokeOffset + 1] ?? 1) * 255)}, ${Math.round((strokeColors[strokeOffset + 2] ?? 1) * 255)}, ${strokeAlpha})`
        ctx.stroke()
      }
    }

    ctx.restore()
  }

  /**
   * Рисует retained rect batch через Canvas2D fallback.
   */
  rects(batch: NovaRectBatch): void {
    const ctx = this.ctx
    const opacity = batch.opacity ?? 1

    ctx.save()

    for (let index = 0; index < batch.count; index += 1) {
      const colorOffset = index * 4
      const alpha = (batch.colors[colorOffset + 3] ?? 1) * opacity
      if (alpha <= 0) continue

      ctx.fillStyle = `rgba(${Math.round((batch.colors[colorOffset] ?? 0) * 255)}, ${Math.round((batch.colors[colorOffset + 1] ?? 0) * 255)}, ${Math.round((batch.colors[colorOffset + 2] ?? 0) * 255)}, ${alpha})`
      ctx.fillRect(
        batch.x[index] ?? 0,
        batch.y[index] ?? 0,
        batch.width[index] ?? 0,
        batch.height[index] ?? 0,
      )
    }

    ctx.restore()
  }

  /**
   * Рисует retained time-range segment batch через Canvas2D fallback.
   */
  timeRangeSegments(batch: NovaTimeRangeSegmentBatch): void {
    const ctx = this.ctx
    ctx.save()

    for (let index = 0; index < batch.count; index += 1) {
      const colorOffset = index * 4
      const alpha = batch.colors[colorOffset + 3] ?? 1
      if (alpha <= 0) continue
      const x = batch.viewportX + ((batch.startTime[index] ?? 0) - batch.timeStart) * batch.pxPerMs
      const width = Math.max(1, ((batch.endTime[index] ?? 0) - (batch.startTime[index] ?? 0)) * batch.pxPerMs)
      const y = (batch.y[index] ?? 0) + batch.yOffset
      ctx.fillStyle = `rgba(${Math.round((batch.colors[colorOffset] ?? 0) * 255)}, ${Math.round((batch.colors[colorOffset + 1] ?? 0) * 255)}, ${Math.round((batch.colors[colorOffset + 2] ?? 0) * 255)}, ${alpha})`
      ctx.fillRect(x, y, width, batch.height[index] ?? 0)
    }

    ctx.restore()
  }

  /**
   * Рисует retained stripe batch через Canvas2D fallback.
   */
  stripes(batch: NovaStripeRectBatch): void {
    const ctx = this.ctx
    const opacity = batch.opacity ?? 1

    ctx.save()
    ctx.globalAlpha = opacity

    for (let index = 0; index < batch.count; index += 1) {
      const source = this._assets.resolveDrawable(batch.fills[index])
      const x = batch.x[index] ?? 0
      const y = batch.y[index] ?? 0
      const width = batch.width[index] ?? 0
      const height = batch.height[index] ?? 0
      if (!source || width <= 0 || height <= 0) continue

      ctx.fillStyle = ctx.createPattern(source, 'repeat')!
      ctx.fillRect(x, y, width, height)
    }

    ctx.restore()
  }

  /**
   * Рисует retained icon batch через Canvas2D fallback.
   */
  icons(batch: NovaIconBatch): void {
    const ctx = this.ctx
    const opacity = batch.opacity ?? 1

    ctx.save()
    ctx.globalAlpha = opacity

    for (let index = 0; index < batch.count; index += 1) {
      const source = this._assets.resolveDrawable(batch.icons[index])
      if (!source) continue
      ctx.drawImage(
        source,
        batch.x[index] ?? 0,
        batch.y[index] ?? 0,
        batch.width[index] ?? 0,
        batch.height[index] ?? 0,
      )
    }

    ctx.restore()
  }

  /**
   * Рисует retained text batch через Canvas2D fallback.
   */
  texts(batch: NovaTextBatch): void {
    for (let index = 0; index < batch.count; index += 1) {
      const color = Array.isArray(batch.color) ? batch.color[index] : batch.color
      const clip = this.resolveTextBatchClip(batch, index)
      this.text({
        text: batch.text[index] ?? '',
        x: batch.x[index] ?? 0,
        y: batch.y[index] ?? 0,
        width: batch.width[index] ?? 0,
        height: batch.height[index] ?? 0,
        clip: clip === null ? undefined : clip ?? true,
        styles: {
          color: color ?? '#000',
          font: resolveTextBatchItemValue(batch.font, index),
          align: resolveTextBatchItemValue(batch.align, index),
          lineHeight: batch.lineHeight,
          padding: batch.padding,
          ellipsis: batch.ellipsis,
          opacity: batch.opacity,
        },
      })
    }
  }

  /**
   * Выполняет внутреннюю операцию cursor.
   */
  cursor(value: string): void {
    this.novaCanvas.element.style.cursor = value
  }

  /**
   * Выполняет внутреннюю операцию border.
   */
  border(p: NovaBorder): void {
    const ctx = this.ctx
    ctx.save()

    const color = p.styles?.color || '#000'
    const w = p.styles?.width ?? 1
    if (w <= 0) {
      ctx.restore()
      return
    }
    const radius = p.styles?.radius || 0

    // Определим какие стороны рисовать
    const sides = new Set<string>()

    if (!p.position || p.position === 'all') {
      sides.add('top')
      sides.add('right')
      sides.add('bottom')
      sides.add('left')
    } else if (p.position === 'vertical') {
      sides.add('left')
      sides.add('right')
    } else if (p.position === 'horizontal') {
      sides.add('top')
      sides.add('bottom')
    } else if (Array.isArray(p.position)) {
      for (const s of p.position) {
        sides.add(s)
      }
    }

    if ((!p.position || p.position === 'all') && radius > 0) {
      ctx.strokeStyle = color
      ctx.lineWidth = w
      if (p.styles?.dashPattern) ctx.setLineDash(p.styles.dashPattern)
      this._drawRoundedRect(p.x, p.y, p.width, p.height, radius)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.restore()
      return
    }

    if (p.styles?.dashPattern) {
      ctx.strokeStyle = color
      ctx.lineWidth = w
      ctx.setLineDash(p.styles.dashPattern)

      if (sides.has('top')) {
        ctx.beginPath()
        ctx.moveTo(p.x, p.y + w / 2)
        ctx.lineTo(p.x + p.width, p.y + w / 2)
        ctx.stroke()
      }
      if (sides.has('right')) {
        ctx.beginPath()
        ctx.moveTo(p.x + p.width - w / 2, p.y)
        ctx.lineTo(p.x + p.width - w / 2, p.y + p.height)
        ctx.stroke()
      }
      if (sides.has('bottom')) {
        ctx.beginPath()
        ctx.moveTo(p.x, p.y + p.height - w / 2)
        ctx.lineTo(p.x + p.width, p.y + p.height - w / 2)
        ctx.stroke()
      }
      if (sides.has('left')) {
        ctx.beginPath()
        ctx.moveTo(p.x + w / 2, p.y)
        ctx.lineTo(p.x + w / 2, p.y + p.height)
        ctx.stroke()
      }

      ctx.setLineDash([])
    } else {
      ctx.fillStyle = color

      if (sides.has('top')) {
        ctx.fillRect(p.x, p.y, p.width, w)
      }
      if (sides.has('right')) {
        ctx.fillRect(p.x + p.width - w, p.y, w, p.height)
      }
      if (sides.has('bottom')) {
        ctx.fillRect(p.x, p.y + p.height - w, p.width, w)
      }
      if (sides.has('left')) {
        ctx.fillRect(p.x, p.y, w, p.height)
      }
    }

    ctx.restore()
  }

  /**
   * Выполняет внутреннюю операцию draw rounded rect.
   */
  private _drawRoundedRect(x: number, y: number, width: number, height: number, radius: number): void {
    const ctx = this.ctx
    const r = Math.min(radius, width / 2, height / 2)
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + width - r, y)
    ctx.quadraticCurveTo(x + width, y, x + width, y + r)
    ctx.lineTo(x + width, y + height - r)
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
    ctx.lineTo(x + r, y + height)
    ctx.quadraticCurveTo(x, y + height, x, y + height - r)
    ctx.lineTo(x, y + r)
    ctx.quadraticCurveTo(x, y, x + r, y)
    ctx.closePath()
  }

  /**
   * Выполняет внутреннюю операцию text string.
   */
  private textString(p: NovaText): void {
    if (!p.text?.length) {
      return
    }

    const ctx = this.ctx
    ctx.save()

    if (this._clearTextBackground && p.meta?.textBg !== true) {
      ctx.clearRect(p.x, p.y, p.width, p.height)
    }

    // Настройка шрифта
    const fontSize = p.styles?.font?.size || 12
    const fontFamily = p.styles?.font?.family || 'Verdana'
    const fontWeight = p.styles?.font?.weight || 'normal'
    const fontStyle = p.styles?.font?.style || 'normal'
    ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`
    ctx.fillStyle = p.styles?.color || '#000'
    ctx.globalAlpha = p.styles?.opacity ?? 1

    // Паддинги
    const padding = this._resolvePadding(p.styles?.padding)

    //
    // Если текст не помещается
    const availableWidth: number = Math.max(0, p.width - (padding.left + padding.right))
    const rawTextWidth: number = ctx.measureText(p.text).width
    const isOverflow: boolean = rawTextWidth > availableWidth
    const overflowAlign = p.styles?.align?.overflow ?? 'start'
    let horizontal = p.styles?.align?.horizontal || 'left'

    if (isOverflow && overflowAlign === 'start') {
      horizontal = 'left'
    }

    // Вычисляем базовые координаты
    let textX = p.x
    let textY = p.y

    // Горизонтальное выравнивание
    switch (horizontal) {
      case 'left':
        textX += padding.left
        ctx.textAlign = 'left'
        break
      case 'right':
        textX += p.width - padding.right
        ctx.textAlign = 'right'
        break
      default: // center
        textX += padding.left + availableWidth / 2
        ctx.textAlign = 'center'
        break
    }

    // Вертикальное выравнивание
    switch (p.styles?.align?.vertical) {
      case 'top':
        textY += padding.top
        ctx.textBaseline = 'top'
        break
      case 'bottom':
        textY += p.height - padding.bottom
        ctx.textBaseline = 'bottom'
        break
      default: // center
        textY += p.height / 2
        ctx.textBaseline = 'middle'
        break
    }

    const maxWidth: number = availableWidth

    let finalText = p.text
    if (p.styles?.ellipsis) {
      while (finalText.length > 0 && ctx.measureText(finalText + '...').width > maxWidth) {
        finalText = finalText.slice(0, -1)
      }
      if (finalText.length > 0 && finalText !== p.text) {
        finalText += '...'
      }
    }

    ctx.fillText(finalText, textX, textY)

    ctx.restore()
  }

  /**
   * Выполняет внутреннюю операцию measure text.
   */
  measureText(p: NovaText): { width: number; height: number } {
    const fontSize = p.styles?.font?.size || 12
    const fontFamily = p.styles?.font?.family || 'Verdana'
    const fontWeight = p.styles?.font?.weight || 'normal'
    const fontStyle = p.styles?.font?.style || 'normal'
    const lineHeight = p.styles?.lineHeight || fontSize * 1.2

    const padding = this._resolvePadding(p.styles?.padding)

    const ctx = this._measureCanvas.getContext('2d')!

    const chunks = this._parseMarkdownToChunks(p.text)
    let cursorX = 0
    let maxWidth = 0
    let totalLines = 1

    for (const chunk of chunks) {
      if (chunk.newline) {
        maxWidth = Math.max(maxWidth, cursorX)
        cursorX = 0
        totalLines += 1
        continue
      }

      const style = chunk.italic ? 'italic' : fontStyle
      const weight = chunk.bold ? 'bold' : fontWeight
      ctx.font = `${style} ${weight} ${fontSize}px ${fontFamily}`
      const width = ctx.measureText(chunk.text).width
      cursorX += width
    }

    maxWidth = Math.max(maxWidth, cursorX)

    return {
      width: Math.ceil(maxWidth + padding.left + padding.right),
      height: Math.ceil(totalLines * lineHeight),
    }
  }

  /**
   * Освобождает runtime resources и снимает связанные ссылки.
   */
  destroy(): void {}

  /**
   * Выполняет restore без проверки active state mark.
   */
  private restoreUnsafe(): void {
    this.ctx.restore()
    this._transformDepth = Math.max(0, this._transformDepth - 1)
  }

  /**
   * Выполняет clearClip без проверки active state mark.
   */
  private clearClipUnsafe(): void {
    this.ctx.restore()
    this._clipDepth = Math.max(0, this._clipDepth - 1)
  }

  /**
   * Выполняет внутреннюю операцию text markdown.
   */
  private textMarkdown(p: NovaText): void {
    const ctx = this.ctx
    ctx.save()

    const fontSize = p.styles?.font?.size || 12
    const fontFamily = p.styles?.font?.family || 'Verdana'
    const fontWeight = p.styles?.font?.weight || 'normal'
    const fontStyle = p.styles?.font?.style || 'normal'
    const lineHeight = p.styles?.lineHeight || fontSize * 1.2

    const padding = this._resolvePadding(p.styles?.padding)
    let cursorX = p.x + padding.left
    let cursorY = p.y + padding.top

    const chunks = this._parseMarkdownToChunks(p.text)

    for (const chunk of chunks) {
      if (chunk.newline) {
        cursorX = p.x + padding.left
        cursorY += lineHeight
        continue
      }

      ctx.font = `${chunk.italic ? 'italic' : fontStyle} ${chunk.bold ? 'bold' : fontWeight} ${fontSize}px ${fontFamily}`
      ctx.fillStyle = p.styles?.color || '#000'
      ctx.textBaseline = 'top'

      ctx.fillText(chunk.text, cursorX, cursorY)
      cursorX += ctx.measureText(chunk.text).width
    }

    ctx.restore()
    return
  }

  /**
   * Выполняет внутреннюю операцию parse markdown to chunks.
   */
  private _parseMarkdownToChunks(input: string): Array<NovaTextChunk> {
    if (!input?.length) {
      return [{ text: '' }]
    }
    const lines = input.split('\n')
    const chunks: Array<NovaTextChunk> = []

    for (const line of lines) {
      const parts = line.split(/(\*\*[^*]+\*\*|_[^_]+_)/g)
      for (const part of parts) {
        if (!part) continue

        if (/^\*\*(.+)\*\*$/.test(part)) {
          chunks.push({ text: part.slice(2, -2), bold: true })
        } else if (/^_(.+)_$/.test(part)) {
          chunks.push({ text: part.slice(1, -1), italic: true })
        } else {
          chunks.push({ text: part })
        }
      }
      chunks.push({ newline: true, text: '' })
    }

    return chunks
  }
}

function resolveTextBatchItemValue<T>(value: T | ReadonlyArray<T | undefined> | undefined, index: number): T | undefined {
  return Array.isArray(value) ? value[index] : value as T | undefined
}

interface NineSliceSegment {
  sourceStart: number
  sourceSize: number
  targetStart: number
  targetSize: number
}

/**
 * Нормализует input nine-slice.
 */
function normalizeNineSliceInput(input: number | Partial<NovaNineSliceInsets>): NovaNineSliceInsets {
  if (typeof input === 'number') {
    return { top: input, right: input, bottom: input, left: input }
  }

  return {
    top: input.top ?? 0,
    right: input.right ?? input.left ?? 0,
    bottom: input.bottom ?? input.top ?? 0,
    left: input.left ?? input.right ?? 0,
  }
}

/**
 * Строит 3 сегмента nine-slice по одной оси.
 */
function resolveNineSliceSegments(sourceSize: number, targetSize: number, startSlice: number, endSlice: number): Array<NineSliceSegment> {
  const safeSource = Math.max(1, sourceSize)
  const safeTarget = Math.max(0, targetSize)
  const start = Math.max(0, Math.min(startSlice, safeSource))
  const end = Math.max(0, Math.min(endSlice, safeSource - start))
  const middleSource = Math.max(0, safeSource - start - end)
  const edgeScale = safeTarget < start + end && start + end > 0 ? safeTarget / (start + end) : 1
  const targetStart = start * edgeScale
  const targetEnd = end * edgeScale
  const targetMiddle = Math.max(0, safeTarget - targetStart - targetEnd)

  return [
    { sourceStart: 0, sourceSize: start, targetStart: 0, targetSize: targetStart },
    { sourceStart: start, sourceSize: middleSource, targetStart, targetSize: targetMiddle },
    { sourceStart: safeSource - end, sourceSize: end, targetStart: targetStart + targetMiddle, targetSize: targetEnd },
  ]
}

/**
 * Возвращает width canvas source.
 */
function resolveCanvasSourceWidth(source: CanvasImageSource): number {
  if ('naturalWidth' in source) return Math.max(1, Number(source.naturalWidth) || 1)
  if ('width' in source) return Math.max(1, Number(source.width) || 1)
  return Math.max(1, Number(source.displayWidth) || 1)
}

/**
 * Возвращает height canvas source.
 */
function resolveCanvasSourceHeight(source: CanvasImageSource): number {
  if ('naturalHeight' in source) return Math.max(1, Number(source.naturalHeight) || 1)
  if ('height' in source) return Math.max(1, Number(source.height) || 1)
  return Math.max(1, Number(source.displayHeight) || 1)
}
