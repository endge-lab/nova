export type EventKind =
  | 'ctx:create'
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

export type Evt = { t: number; k: EventKind; s?: string; g?: string; d: any }

export type FrameStat = {
  t: number
  s?: string // surface
  g?: string // glId
  bytes: number
  draws: number
  rects?: number
  batches?: number
  backbufferBytes?: number
}

type Snapshot = {
  label: string
  at: number
  stats: FrameStat[]
  events: Evt[]
}

type SnapshotHandler = (snap: Snapshot) => void

export class GfxTelemetry {
  private readonly eventsLimit: number
  private readonly statsLimit: number
  private _enabled = false

  private _events: Evt[] = []
  private _stats: FrameStat[] = []

  private _snapListeners = new Set<SnapshotHandler>()

  lastSnap?: Snapshot

  private _accBytes = 0

  get enabled(): boolean {
    return this._enabled
  }

  set enabled(value: boolean) {
    this._enabled = value
  }

  onSnapshot(cb: SnapshotHandler): () => void {
    this._snapListeners.add(cb)
    return () => this._snapListeners.delete(cb)
  }

  private _emitSnapshot(snap: Snapshot) {
    for (const cb of this._snapListeners) {
      try {
        cb(snap)
      } catch {
        /* игнорим ошибки слушателей */
      }
    }
  }

  addUploadBytes(n: number) {
    if (!this._enabled) return
    this._accBytes += n
  }

  consumeAccBytes(): number {
    if (!this._enabled) return 0
    const v = this._accBytes
    this._accBytes = 0
    return v
  }

  constructor(opts?: { eventsLimit?: number; statsLimit?: number }) {
    this.eventsLimit = opts?.eventsLimit ?? 1000
    this.statsLimit = opts?.statsLimit ?? 300
  }

  event(k: EventKind, d: any = {}, s?: string, g?: string) {
    if (!this._enabled) return
    const e: Evt = { t: performance.now(), k, s, g, d }
    this._events.push(e)
    if (this._events.length > this.eventsLimit) this._events.shift()
  }

  stat(partial: Omit<FrameStat, 't'>) {
    if (!this._enabled) return
    const rec: FrameStat = { t: performance.now(), ...partial }
    this._stats.push(rec)
    if (this._stats.length > this.statsLimit) this._stats.shift()
  }

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

export function analyzeSnapshot(snap: { stats: FrameStat[]; events: Evt[] }) {
  const ev = snap.events
  const st = snap.stats
  const last = st[st.length - 1]
  const flags: string[] = []
  const notes: any = {}

  // lost/restored
  const losts = ev.filter((e) => e.k === 'ctx:lost').length
  const restored = ev.filter((e) => e.k === 'ctx:restored').length
  if (losts > 1 || (losts >= 1 && restored === 0)) flags.push('lost_loop')

  // resize bursts
  const now = performance.now()
  const recentResize = ev.filter((e) => e.k === 'canvas:resize' && now - e.t < 1000).length
  if (recentResize >= 3) flags.push('resize_loop')

  // gl errors
  const gle = ev.filter((e) => e.k === 'gl:error')
  if (gle.length) {
    flags.push('gl_error_guard')
    notes.glErrors = gle.map((e) => e.d)
  }

  if (last && last.backbufferBytes) {
    const ratios = st
      .filter((x) => x.backbufferBytes)
      .slice(-10)
      .map((x) => x.bytes / (x.backbufferBytes || 1))
    const maxR = Math.max(...ratios, 0)
    const avgR = ratios.reduce((a, b) => a + b, 0) / (ratios.length || 1)
    notes.uploadRatio = { max: +maxR.toFixed(1), avg: +avgR.toFixed(1) }
    if (maxR > 30 || avgR > 10) flags.push('upload_spike')
  }

  if (last && last.rects && last.draws) {
    const ratio = last.draws / Math.max(1, last.rects)
    notes.drawsPerRect = +ratio.toFixed(3)
    if (last.rects > 500 && ratio > 0.2) flags.push('bad_batching')
  }

  return { flags, notes }
}
