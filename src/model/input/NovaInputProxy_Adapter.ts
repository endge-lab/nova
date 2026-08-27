import type { NovaInputEngine } from '@/model/input/nova-input.types'

export interface NovaInputProxyOptions {
  engine?: NovaInputEngine
  ownerDocument?: Document
  className?: string
  onInput?: (value: string, event: Event) => void
  onCompositionStart?: (event: CompositionEvent) => void
  onCompositionUpdate?: (event: CompositionEvent) => void
  onCompositionEnd?: (event: CompositionEvent) => void
}

/**
 * Инкапсулирует сервисную логику NovaInputProxy_Adapter.
 */
export class NovaInputProxy_Adapter {
  /** Browser input element, attachment state и injected options. */
  private _textarea: HTMLTextAreaElement | null = null
  private _attached = false
  private readonly _options: NovaInputProxyOptions

  /**
   * ----------------------------------------
   * PUBLIC
   * ----------------------------------------
   */

  /**
   * Создает экземпляр NovaInputProxy_Adapter и подготавливает базовое состояние.
   */
  public constructor(options: NovaInputProxyOptions = {}) {
    this._options = options
  }

  /**
   * Подключает внешнюю runtime-сущность NovaInputProxy_Adapter.
   */
  public attach(): HTMLTextAreaElement | null {
    if (this._options.engine === 'canvas') {
      return null
    }
    if (typeof document === 'undefined' && !this._options.ownerDocument) {
      return null
    }
    const ownerDocument = this._options.ownerDocument ?? document
    if (!this._textarea) {
      const textarea = ownerDocument.createElement('textarea')
      textarea.className = this._options.className ?? 'nova-input-proxy'
      textarea.setAttribute('aria-hidden', 'true')
      textarea.style.position = 'fixed'
      textarea.style.left = '-10000px'
      textarea.style.top = '0'
      textarea.style.width = '1px'
      textarea.style.height = '1px'
      textarea.style.opacity = '0'
      textarea.style.pointerEvents = 'none'
      textarea.addEventListener('input', event => this._options.onInput?.(textarea.value, event))
      textarea.addEventListener('compositionstart', event => this._options.onCompositionStart?.(event))
      textarea.addEventListener('compositionupdate', event => this._options.onCompositionUpdate?.(event))
      textarea.addEventListener('compositionend', event => this._options.onCompositionEnd?.(event))
      this._textarea = textarea
    }
    if (!this._attached) {
      ownerDocument.body.appendChild(this._textarea)
      this._attached = true
    }
    return this._textarea
  }

  /**
   * Отключает внешнюю runtime-сущность NovaInputProxy_Adapter.
   */
  public detach(): void {
    if (this._attached && this._textarea?.parentNode) {
      this._textarea.parentNode.removeChild(this._textarea)
    }
    this._attached = false
  }

  /**
   * Переводит focus в целевое состояние NovaInputProxy_Adapter.
   */
  public focus(value: string, start: number, end = start): void {
    const element = this.attach()
    if (!element) {
      return
    }
    this.sync(value, start, end)
    element.focus()
  }

  /**
   * Снимает focus с целевого состояния NovaInputProxy_Adapter.
   */
  public blur(): void {
    this._textarea?.blur()
  }

  /**
   * Синхронизирует состояние между слоями NovaInputProxy_Adapter.
   */
  public sync(value: string, start: number, end = start): void {
    if (!this._textarea) {
      return
    }
    this._textarea.value = value
    this._textarea.setSelectionRange(start, end)
  }

  /**
   * Освобождает runtime-ресурсы и подписки NovaInputProxy_Adapter.
   */
  public dispose(): void {
    this.detach()
    this._textarea = null
  }

  /**
   * ----------------------------------------
   * ACCESS
   * ----------------------------------------
   */

  /** Возвращает hidden textarea для browser input integration. */
  public get element(): HTMLTextAreaElement | null {
    return this._textarea
  }
}

/** @deprecated Используйте NovaInputProxy_Adapter. */
export { NovaInputProxy_Adapter as NovaInputProxyService }
