/**
 * Описывает тип PhaseLog.
 */
interface PhaseLog { type: 'info' | 'warn' | 'error' | 'success', message: string }
/**
 * Описывает тип TimerMap.
 */
type TimerMap = Map<string, number>

/**
 * Собирает debug-информацию по кадрам и фазам runtime.
 */
export class NovaDebug {
  private _enabled = false
  private _lastLogFrameTimes = new Map<string, number>()
  private readonly _logThrottleTime = 1000
  private _shouldLogFrame = false
  private _frameStartTime = 0
  private _phaseStart = 0
  private _phaseName = ''
  private _phaseStack = 0
  private _lastFrameTime = 0
  private _lastFps = 0
  private _displayFps = 0
  private _displayTick = 0
  private _lastRenderedTick = -1
  private _lastRenderedAt = 0
  private _displayFrameTimes: Array<number> = []
  private _displayRafId: number | null = null

  private _framePhases: Array<[string, number]> = []
  private _frameLogs: Array<string> = []
  private _phaseLogs: Record<string, Array<PhaseLog>> = {}
  private _timers: TimerMap = new Map()

  /**
   * Обновляет enabled.
   */
  set enabled(v: boolean) {
    this._enabled = v
  }

  /**
   * Возвращает enabled.
   */
  get enabled(): boolean {
    return this._enabled
  }

  /**
   * Возвращает last frame time.
   */
  get lastFrameTime(): number {
    return this._lastFrameTime
  }

  /**
   * Возвращает last fps.
   */
  get lastFps(): number {
    return this._lastFps
  }

  /**
   * Возвращает display fps.
   */
  get displayFps(): number {
    if (this._lastRenderedAt > 0 && performance.now() - this._lastRenderedAt > 1500) {
      return 0
    }

    return this._displayFps
  }

  /**
   * Запускает связанную runtime-операцию.
   */
  startDisplayMonitor(): void {
    if (this._displayRafId !== null || typeof requestAnimationFrame === 'undefined') {
      return
    }

    const tick = (): void => {
      this._displayTick += 1
      this._displayRafId = requestAnimationFrame(tick)
    }

    this._displayRafId = requestAnimationFrame(tick)
  }

  /**
   * Останавливает связанную runtime-операцию.
   */
  stopDisplayMonitor(): void {
    if (this._displayRafId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this._displayRafId)
    }

    this._displayRafId = null
    this._displayTick = 0
    this._lastRenderedTick = -1
    this._lastRenderedAt = 0
    this._displayFrameTimes.length = 0
    this._displayFps = 0
  }

  /**
   * Помечает rendered frame.
   */
  markRenderedFrame(): void {
    const now = performance.now()

    if (this._displayTick === this._lastRenderedTick) {
      return
    }

    this._lastRenderedTick = this._displayTick
    this._lastRenderedAt = now
    this._displayFrameTimes.push(now)

    const minTime = now - 1000
    while (this._displayFrameTimes.length > 0 && this._displayFrameTimes[0] < minTime) {
      this._displayFrameTimes.shift()
    }

    if (this._displayFrameTimes.length >= 2) {
      const first = this._displayFrameTimes[0]
      const last = this._displayFrameTimes[this._displayFrameTimes.length - 1]
      const elapsed = last - first
      this._displayFps = elapsed > 0 ? ((this._displayFrameTimes.length - 1) * 1000) / elapsed : 0
    }
  }

  //
  // FRAME
  //

  /**
   * Выполняет внутреннюю операцию frame start.
   */
  frameStart(group: string | null = 'default'): void {
    if (this._phaseStack === 0) {
      const now = performance.now()
      this._frameStartTime = now
      this._framePhases = []
      this._frameLogs = []
      this._phaseLogs = {}
      this._timers.clear()

      if (group === null) {
        this._shouldLogFrame = true
      }
      else {
        const groupKey = group || 'default'
        const lastTime = this._lastLogFrameTimes.get(groupKey) ?? 0
        this._shouldLogFrame
          = now - lastTime >= this._logThrottleTime || lastTime === 0

        if (this._shouldLogFrame) {
          this._lastLogFrameTimes.set(groupKey, now)
        }
      }
    }

    this._phaseStack++
  }

  /**
   * Выполняет внутреннюю операцию frame end.
   */
  frameEnd(title = '🔹FRAME'): void {
    this._phaseStack--

    if (this._phaseStack === 0) {
      this._lastFrameTime = performance.now() - this._frameStartTime
      this._lastFps = this._lastFrameTime > 0 ? 1000 / this._lastFrameTime : 0
    }

    if (!this._enabled || !this._shouldLogFrame || this._phaseStack !== 0) {
      return
    }

    let style = ''
    if (this._lastFps < 30) {
      style = 'color:#f00;font-weight:bold;'
    } // красный
    else if (this._lastFps < 60) {
      style = 'color:#f90;font-weight:bold;'
    } // оранжевый
    else {
      style = 'color:#0c0;font-weight:bold;'
    } // зелёный

    const empty = this._framePhases.length === 0 && this._frameLogs.length === 0
    const label = empty
      ? `${title} [${this._lastFrameTime.toFixed(2)}ms / ${this._lastFps.toFixed(0)}ups] (empty)`
      : `${title} [${this._lastFrameTime.toFixed(2)}ms / ${this._lastFps.toFixed(0)}ups]`

    console.groupCollapsed(`%c${label}`, style)

    for (const [name, ms] of this._framePhases) {
      console.groupCollapsed(`%c[${name}] ${ms.toFixed(2)}ms`, 'color:#0ff;')
      const logs = this._phaseLogs[name] || []
      for (const log of logs) {
        this._printColored(log.type, log.message)
      }
      console.groupEnd()
    }

    for (const log of this._frameLogs) {
      this._printColored('info', log)
    }

    console.groupEnd()
  }

  //
  // PHASE
  //

  /**
   * Выполняет внутреннюю операцию phase start.
   */
  phaseStart(name: string): void {
    if (!this._shouldLogFrame || !this._enabled) {
      return
    }
    this._phaseName = name
    this._phaseStart = performance.now()
  }

  /**
   * Выполняет внутреннюю операцию phase end.
   */
  phaseEnd(): void {
    if (!this._shouldLogFrame || !this._enabled) {
      return
    }
    const duration = performance.now() - this._phaseStart
    this._framePhases.push([this._phaseName, duration])
  }

  //
  // ЛОГИКА ГРАНИ
  //

  /**
   * Выполняет внутреннюю операцию face log.
   */
  faceLog(message: string): void {
    if (!this._enabled || !this._shouldLogFrame) {
      return
    }
    this._frameLogs.push(message)
  }

  //
  // TIMERS
  //

  /**
   * Запускает связанную runtime-операцию.
   */
  startTimer(label: string): void {
    if (!this._enabled || !this._shouldLogFrame) {
      return
    }
    this._timers.set(label, performance.now())
  }

  //
  // LOGS
  //

  /**
   * Выполняет внутреннюю операцию info.
   */
  info(message: string, timerLabel?: string): void {
    this._logToPhase('info', message, timerLabel)
  }

  /**
   * Выполняет внутреннюю операцию warn.
   */
  warn(message: string, timerLabel?: string): void {
    this._logToPhase('warn', message, timerLabel)
  }

  /**
   * Выполняет внутреннюю операцию error.
   */
  error(message: string, timerLabel?: string): void {
    this._logToPhase('error', message, timerLabel)
  }

  /**
   * Выполняет внутреннюю операцию success.
   */
  success(message: string, timerLabel?: string): void {
    this._logToPhase('success', message, timerLabel)
  }

  /**
   * Выполняет внутреннюю операцию log to phase.
   */
  private _logToPhase(
    type: PhaseLog['type'],
    message: string,
    timerLabel?: string,
  ): void {
    if (!this._enabled || !this._shouldLogFrame) {
      return
    }

    if (timerLabel && this._timers.has(timerLabel)) {
      const started = this._timers.get(timerLabel)!
      const elapsed = performance.now() - started
      message += ` (${elapsed.toFixed(2)}ms)`
      this._timers.delete(timerLabel)
    }

    if (!this._phaseLogs[this._phaseName]) {
      this._phaseLogs[this._phaseName] = []
    }
    this._phaseLogs[this._phaseName].push({ type, message })
  }

  /**
   * Выполняет внутреннюю операцию print colored.
   */
  private _printColored(type: PhaseLog['type'], message: string): void {
    const colors = {
      info: 'color:#888',
      warn: 'color:#f90;font-weight:bold;',
      error: 'color:#f00;font-weight:bold;',
      success: 'color:#0c0;font-weight:bold;',
    } as const

    console.log(`%c${message}`, colors[type])
  }
}
