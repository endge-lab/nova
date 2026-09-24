/**
 * Координирует поведение контроллера NovaCaretBlinkController.
 */
export class NovaCaretBlinkController {
  private static readonly _instances = new Set<NovaCaretBlinkController>()
  private static _timer: ReturnType<typeof setInterval> | null = null
  private _visible = true
  private _active = false

  /**
   * Создает экземпляр NovaCaretBlinkController и подготавливает базовое состояние.
   */
  constructor(
    private readonly _onTick: (visible: boolean) => void,
    private readonly _interval = 530,
  ) {}

  /**
   * Возвращает значение состояния NovaCaretBlinkController.
   */
  getVisible(): boolean {
    return this._visible
  }

  /**
   * Запускает runtime-процесс NovaCaretBlinkController.
   */
  start(): void {
    if (this._active) {
      return
    }
    this._active = true
    this._visible = true
    NovaCaretBlinkController._instances.add(this)
    NovaCaretBlinkController._ensureTimer(this._interval)
    this._onTick(this._visible)
  }

  /**
   * Останавливает runtime-процесс NovaCaretBlinkController.
   */
  stop(): void {
    if (!this._active) {
      return
    }
    this._active = false
    NovaCaretBlinkController._instances.delete(this)
    this._visible = false
    this._onTick(false)
    if (NovaCaretBlinkController._instances.size === 0 && NovaCaretBlinkController._timer) {
      clearInterval(NovaCaretBlinkController._timer)
      NovaCaretBlinkController._timer = null
    }
  }

  /**
   * Сбрасывает состояние к базовым значениям NovaCaretBlinkController.
   */
  reset(): void {
    if (!this._active) {
      return
    }
    this._visible = true
    this._onTick(true)
  }

  /**
   * Выполняет внутренний шаг ensureTimer для NovaCaretBlinkController.
   */
  private static _ensureTimer(interval: number): void {
    if (NovaCaretBlinkController._timer) {
      return
    }
    NovaCaretBlinkController._timer = setInterval(() => {
      for (const instance of NovaCaretBlinkController._instances) {
        instance._visible = !instance._visible
        instance._onTick(instance._visible)
      }
    }, interval)
  }
}
