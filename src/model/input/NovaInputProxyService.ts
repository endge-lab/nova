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

export class NovaInputProxyService {
  private textarea: HTMLTextAreaElement | null = null
  private attached = false

  constructor(private readonly options: NovaInputProxyOptions = {}) {}

  get element(): HTMLTextAreaElement | null {
    return this.textarea
  }

  attach(): HTMLTextAreaElement | null {
    if (this.options.engine === 'canvas') return null
    if (typeof document === 'undefined' && !this.options.ownerDocument) return null
    const ownerDocument = this.options.ownerDocument ?? document
    if (!this.textarea) {
      const textarea = ownerDocument.createElement('textarea')
      textarea.className = this.options.className ?? 'nova-input-proxy'
      textarea.setAttribute('aria-hidden', 'true')
      textarea.style.position = 'fixed'
      textarea.style.left = '-10000px'
      textarea.style.top = '0'
      textarea.style.width = '1px'
      textarea.style.height = '1px'
      textarea.style.opacity = '0'
      textarea.style.pointerEvents = 'none'
      textarea.addEventListener('input', event => this.options.onInput?.(textarea.value, event))
      textarea.addEventListener('compositionstart', event => this.options.onCompositionStart?.(event))
      textarea.addEventListener('compositionupdate', event => this.options.onCompositionUpdate?.(event))
      textarea.addEventListener('compositionend', event => this.options.onCompositionEnd?.(event))
      this.textarea = textarea
    }
    if (!this.attached) {
      ownerDocument.body.appendChild(this.textarea)
      this.attached = true
    }
    return this.textarea
  }

  detach(): void {
    if (this.attached && this.textarea?.parentNode) {
      this.textarea.parentNode.removeChild(this.textarea)
    }
    this.attached = false
  }

  focus(value: string, start: number, end = start): void {
    const element = this.attach()
    if (!element) return
    this.sync(value, start, end)
    element.focus()
  }

  blur(): void {
    this.textarea?.blur()
  }

  sync(value: string, start: number, end = start): void {
    if (!this.textarea) return
    this.textarea.value = value
    this.textarea.setSelectionRange(start, end)
  }

  dispose(): void {
    this.detach()
    this.textarea = null
  }
}
