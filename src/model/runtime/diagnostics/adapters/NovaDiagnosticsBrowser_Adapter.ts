/** Описывает browser memory API Chromium. */
export interface BrowserPerformanceMemory {
  usedJSHeapSize: number
  totalJSHeapSize?: number
  jsHeapSizeLimit?: number
}

/** Описывает расширенный Performance API для browser diagnostics. */
export interface DiagnosticsPerformance extends Performance {
  memory?: BrowserPerformanceMemory
  measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>
}

/** Изолирует browser observability APIs Nova diagnostics. */
export class NovaDiagnosticsBrowser_Adapter {
  /** Возвращает monotonic browser timestamp с безопасным fallback. */
  public now(): number {
    return typeof performance === 'undefined' ? Date.now() : performance.now()
  }

  /** Возвращает доступный Performance API. */
  public performance(): DiagnosticsPerformance | undefined {
    return typeof performance === 'undefined' ? undefined : performance as DiagnosticsPerformance
  }

  /** Снимает DOM snapshot без передачи Document в модуль. */
  public sampleDom(): { domNodes: number, documents: number, frames: number } | null {
    if (typeof document === 'undefined') {
      return null
    }
    return {
      domNodes: document.getElementsByTagName('*').length,
      documents: 1,
      frames: typeof window === 'undefined' ? 0 : window.frames.length,
    }
  }

  /** Подключает long-task observer, если platform API доступен. */
  public observeLongTasks(onEntry: (duration: number) => void): PerformanceObserver | null {
    if (typeof PerformanceObserver === 'undefined') {
      return null
    }
    try {
      const observer = new PerformanceObserver((entries) => {
        for (const entry of entries.getEntries()) {
          onEntry(entry.duration)
        }
      })
      observer.observe({ entryTypes: ['longtask'] })
      return observer
    }
    catch {
      return null
    }
  }

  /** Показывает доступность DOM observability. */
  public hasDom(): boolean {
    return typeof document !== 'undefined'
  }

  /** Показывает доступность long-task observability. */
  public hasLongTaskObserver(): boolean {
    return typeof PerformanceObserver !== 'undefined'
  }
}
