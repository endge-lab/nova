/**
 * Описывает тип EventKind.
 */
export type EventKind
  = | 'ctx:create'
    | 'ctx:destroy'
    | 'ctx:lost'
    | 'ctx:restored'
    | 'gl:error'
    | 'canvas:resize'
    | 'res:create'
    | 'res:delete'
    | 'raf:drop'
    | 'page'
    | 'visibility'

/**
 * Описывает тип Evt.
 */
export interface Evt { t: number, k: EventKind, s?: string, g?: string, d: any }

/**
 * Описывает тип FrameStat.
 */
export interface FrameStat {
  t: number
  s?: string // surface
  g?: string // glId
  bytes: number
  draws: number
  rects?: number
  batches?: number
  backbufferBytes?: number
}

/**
 * Описывает тип Snapshot.
 */
interface Snapshot {
  label: string
  at: number
  stats: Array<FrameStat>
  events: Array<Evt>
}

/**
 * Описывает тип SnapshotHandler.
 */
type SnapshotHandler = (snap: Snapshot) => void

/**
 * Собирает graphics telemetry events и статистику кадров.
 */
export class GfxTelemetry {
  private readonly eventsLimit: number
  private readonly statsLimit: number
  private _enabled = false

  private _events: Array<Evt> = []
  private _stats: Array<FrameStat> = []

  private _snapListeners = new Set<SnapshotHandler>()

  lastSnap?: Snapshot

  private _accBytes = 0

  /**
   * Возвращает enabled.
   */
  get enabled(): boolean {
    return this._enabled
  }

  /**
   * Обновляет enabled.
   */
  set enabled(value: boolean) {
    this._enabled = value
  }

  /**
   * Обрабатывает событие snapshot.
   */
  onSnapshot(cb: SnapshotHandler): () => void {
    this._snapListeners.add(cb)
    return () => this._snapListeners.delete(cb)
  }

  /**
   * Выполняет внутреннюю операцию emit snapshot.
   */
  private _emitSnapshot(snap: Snapshot) {
    for (const cb of this._snapListeners) {
      try {
        cb(snap)
      }
      catch {
        /* игнорим ошибки слушателей */
      }
    }
  }

  /**
   * Добавляет upload bytes.
   */
  addUploadBytes(n: number) {
    if (!this._enabled) {
      return
    }
    this._accBytes += n
  }

  /**
   * Выполняет внутреннюю операцию consume acc bytes.
   */
  consumeAccBytes(): number {
    if (!this._enabled) {
      return 0
    }
    const v = this._accBytes
    this._accBytes = 0
    return v
  }

  /**
   * Создает instance и подготавливает внутреннее состояние.
   */
  constructor(opts?: { eventsLimit?: number, statsLimit?: number }) {
    this.eventsLimit = opts?.eventsLimit ?? 1000
    this.statsLimit = opts?.statsLimit ?? 300
  }

  /**
   * Выполняет внутреннюю операцию event.
   */
  event(k: EventKind, d: any = {}, s?: string, g?: string) {
    if (!this._enabled) {
      return
    }
    const e: Evt = { t: performance.now(), k, s, g, d }
    this._events.push(e)
    if (this._events.length > this.eventsLimit) {
      this._events.shift()
    }
  }

  /**
   * Выполняет внутреннюю операцию stat.
   */
  stat(partial: Omit<FrameStat, 't'>) {
    if (!this._enabled) {
      return
    }
    const rec: FrameStat = { t: performance.now(), ...partial }
    this._stats.push(rec)
    if (this._stats.length > this.statsLimit) {
      this._stats.shift()
    }
  }

  /**
   * Выполняет внутреннюю операцию snapshot.
   */
  snapshot(label: string) {
    const now = performance.now()

    this.lastSnap = {
      label,
      at: now,
      stats: this._stats,
      events: this._events,
    }

    this._emitSnapshot(this.lastSnap)

    return this.lastSnap
  }
}

export const Telemetry = new GfxTelemetry({ statsLimit: 300, eventsLimit: 1000 })

/**
 * Выполняет публичную операцию analyze snapshot.
 */
export function analyzeSnapshot(snap: { stats: Array<FrameStat>, events: Array<Evt> }) {
  const ev = snap.events
  const st = snap.stats
  const last = st[st.length - 1]
  const flags: Array<string> = []
  const notes: any = {}

  // lost/restored
  const losts = ev.filter(e => e.k === 'ctx:lost').length
  const restored = ev.filter(e => e.k === 'ctx:restored').length
  if (losts > 1 || (losts >= 1 && restored === 0)) {
    flags.push('lost_loop')
  }

  // resize bursts
  const now = performance.now()
  const recentResize = ev.filter(e => e.k === 'canvas:resize' && now - e.t < 1000).length
  if (recentResize >= 3) {
    flags.push('resize_loop')
  }

  // gl errors
  const gle = ev.filter(e => e.k === 'gl:error')
  if (gle.length) {
    flags.push('gl_error_guard')
    notes.glErrors = gle.map(e => e.d)
  }

  if (last && last.backbufferBytes) {
    const ratios = st
      .filter(x => x.backbufferBytes)
      .slice(-10)
      .map(x => x.bytes / (x.backbufferBytes || 1))
    const maxR = Math.max(...ratios, 0)
    const avgR = ratios.reduce((a, b) => a + b, 0) / (ratios.length || 1)
    notes.uploadRatio = { max: +maxR.toFixed(1), avg: +avgR.toFixed(1) }
    if (maxR > 30 || avgR > 10) {
      flags.push('upload_spike')
    }
  }

  if (last && last.rects && last.draws) {
    const ratio = last.draws / Math.max(1, last.rects)
    notes.drawsPerRect = +ratio.toFixed(3)
    if (last.rects > 500 && ratio > 0.2) {
      flags.push('bad_batching')
    }
  }

  return { flags, notes }
}
