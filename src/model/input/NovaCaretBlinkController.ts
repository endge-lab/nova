export class NovaCaretBlinkController {
  private static readonly instances = new Set<NovaCaretBlinkController>()
  private static timer: ReturnType<typeof setInterval> | null = null
  private visible = true
  private active = false

  constructor(
    private readonly onTick: (visible: boolean) => void,
    private readonly interval = 530,
  ) {}

  getVisible(): boolean {
    return this.visible
  }

  start(): void {
    if (this.active) return
    this.active = true
    this.visible = true
    NovaCaretBlinkController.instances.add(this)
    NovaCaretBlinkController.ensureTimer(this.interval)
    this.onTick(this.visible)
  }

  stop(): void {
    if (!this.active) return
    this.active = false
    NovaCaretBlinkController.instances.delete(this)
    this.visible = false
    this.onTick(false)
    if (NovaCaretBlinkController.instances.size === 0 && NovaCaretBlinkController.timer) {
      clearInterval(NovaCaretBlinkController.timer)
      NovaCaretBlinkController.timer = null
    }
  }

  reset(): void {
    if (!this.active) return
    this.visible = true
    this.onTick(true)
  }

  private static ensureTimer(interval: number): void {
    if (NovaCaretBlinkController.timer) return
    NovaCaretBlinkController.timer = setInterval(() => {
      for (const instance of NovaCaretBlinkController.instances) {
        instance.visible = !instance.visible
        instance.onTick(instance.visible)
      }
    }, interval)
  }
}
