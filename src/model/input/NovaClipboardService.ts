export interface NovaClipboardResult {
  ok: boolean
  text?: string
  error?: unknown
}

export class NovaClipboardService {
  async readText(proxy?: HTMLTextAreaElement | null): Promise<NovaClipboardResult> {
    try {
      const clipboard = globalThis.navigator?.clipboard
      if (clipboard?.readText) return { ok: true, text: await clipboard.readText() }
      if (proxy) return { ok: true, text: proxy.value }
      return { ok: false, error: new Error('Clipboard API is not available') }
    } catch (error) {
      return { ok: false, error }
    }
  }

  async writeText(text: string, proxy?: HTMLTextAreaElement | null): Promise<NovaClipboardResult> {
    try {
      const clipboard = globalThis.navigator?.clipboard
      if (clipboard?.writeText) {
        await clipboard.writeText(text)
        return { ok: true, text }
      }
      if (proxy) {
        proxy.value = text
        proxy.select()
        return { ok: true, text }
      }
      return { ok: false, error: new Error('Clipboard API is not available') }
    } catch (error) {
      return { ok: false, error }
    }
  }
}
