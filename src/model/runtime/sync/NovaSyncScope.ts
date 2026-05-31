import type { NovaNode } from '@/model/runtime/tree/NovaNode'
import type {
  NovaSyncEndpointInput,
  NovaSyncLink,
  NovaSyncLinkConfig,
  NovaSyncPort,
  NovaSyncPortMap,
  NovaSyncRegisteredPort,
  NovaSyncSchedule,
  NovaSyncScopeOptions,
  NovaSyncTransaction,
} from '@/model/runtime/sync/nova-sync.types'

interface InternalLink extends NovaSyncLink {
  config: NovaSyncLinkConfig<any, any>
}

interface QueuedWrite {
  link: InternalLink
  sourceEndpoint: string
  targetEndpoint: string
  value: unknown
  transaction: NovaSyncTransaction
}

let nextScopeId = 1
let nextLinkId = 1
let nextTransactionId = 1

/**
 * Описывает ответственность NovaSyncScope в архитектуре проекта.
 */
export class NovaSyncScope {
  readonly id: string
  readonly scheduler: NovaSyncSchedule

  private readonly ports = new Map<string, NovaSyncRegisteredPort>()
  private readonly nodeEndpoints = new WeakMap<NovaNode<any>, Set<string>>()
  private readonly links = new Map<string, InternalLink>()
  private readonly microtaskQueue = new Map<string, QueuedWrite>()
  private readonly frameQueue = new Map<string, QueuedWrite>()
  private microtaskScheduled = false
  private frameScheduled = false
  private applyDepth = 0

  /**
   * Создает экземпляр NovaSyncScope и подготавливает базовое состояние.
   */
  constructor(options: NovaSyncScopeOptions = {}) {
    this.id = options.id ?? `nova-sync-${nextScopeId++}`
    this.scheduler = options.scheduler ?? 'immediate'
  }

  /**
   * Регистрирует сущность в runtime-слое NovaSyncScope.
   */
  registerNode(node: NovaNode<any>, ports: NovaSyncPortMap): () => void {
    const endpoints = new Set<string>()
    for (const [name, port] of Object.entries(ports)) {
      const endpoint = this.endpointFor(node, name)
      if (this.ports.has(endpoint)) {
        throw new Error(`[NovaSyncScope] Port "${endpoint}" is already registered`)
      }
      port.id = endpoint
      port.owner = node
      this.ports.set(endpoint, { endpoint, name, node, port })
      endpoints.add(endpoint)
    }

    this.nodeEndpoints.set(node, endpoints)
    return () => this.unregisterNode(node)
  }

  /**
   * Удаляет регистрацию сущности из runtime-слоя NovaSyncScope.
   */
  unregisterNode(node: NovaNode<any>): void {
    const endpoints = this.nodeEndpoints.get(node)
    if (!endpoints) return

    for (const endpoint of endpoints) {
      this.ports.delete(endpoint)
      for (const [linkId, link] of this.links) {
        if (link.from === endpoint || link.to === endpoint) {
          this.links.delete(linkId)
        }
      }
    }
    this.nodeEndpoints.delete(node)
  }

  /**
   * Выполняет действие link в рамках ответственности NovaSyncScope.
   */
  link(config: NovaSyncLinkConfig): NovaSyncLink {
    const from = this.resolveEndpoint(config.from)
    const to = this.resolveEndpoint(config.to)
    this.requirePort(from)
    this.requirePort(to)

    const id = config.id ?? `sync-link-${nextLinkId++}`
    if (this.links.has(id)) {
      throw new Error(`[NovaSyncScope] Link "${id}" is already registered`)
    }

    const schedule = config.schedule ?? this.requirePort(from).port.schedule ?? this.scheduler
    const link: InternalLink = {
      id,
      from,
      to,
      schedule,
      bidirectional: config.bidirectional ?? false,
      config,
      dispose: () => this.unlink(id),
    }
    this.links.set(id, link)
    return link
  }

  /**
   * Выполняет действие unlink в рамках ответственности NovaSyncScope.
   */
  unlink(id: string): void {
    this.links.delete(id)
  }

  /**
   * Нормализует и возвращает итоговое значение NovaSyncScope.
   */
  resolvePort<T = unknown>(endpoint: NovaSyncEndpointInput): NovaSyncPort<T> {
    return this.requirePort(this.resolveEndpoint(endpoint)).port as NovaSyncPort<T>
  }

  /**
   * Выполняет действие notify в рамках ответственности NovaSyncScope.
   */
  notify(endpoint: NovaSyncEndpointInput, value?: unknown, transaction?: NovaSyncTransaction): void {
    if (this.applyDepth > 0) return

    const sourceEndpoint = this.resolveEndpoint(endpoint)
    const source = this.requirePort(sourceEndpoint)
    const nextValue = arguments.length >= 2 ? value : source.port.read()
    const tx = transaction ?? this.createTransaction(sourceEndpoint)
    this.propagate(sourceEndpoint, nextValue, tx)
  }

  /**
   * Выполняет действие notifyPortChanged в рамках ответственности NovaSyncScope.
   */
  notifyPortChanged(node: NovaNode<any>, name: string, value?: unknown): void {
    const endpoint = this.endpointFor(node, name)
    if (!this.ports.has(endpoint)) return
    if (arguments.length >= 3) this.notify(endpoint, value)
    else this.notify(endpoint)
  }

  /**
   * Освобождает runtime-ресурсы и подписки NovaSyncScope.
   */
  dispose(): void {
    this.ports.clear()
    this.links.clear()
    this.microtaskQueue.clear()
    this.frameQueue.clear()
    this.microtaskScheduled = false
    this.frameScheduled = false
  }

  /**
   * Выполняет внутренний шаг propagate для NovaSyncScope.
   */
  private propagate(sourceEndpoint: string, value: unknown, transaction: NovaSyncTransaction): void {
    if (transaction.path.has(sourceEndpoint)) return
    transaction.path.add(sourceEndpoint)

    for (const link of this.links.values()) {
      if (link.from === sourceEndpoint) {
        this.queueLinkedWrite(link, sourceEndpoint, link.to, value, transaction)
      } else if (link.bidirectional && link.to === sourceEndpoint) {
        this.queueLinkedWrite(link, sourceEndpoint, link.from, value, transaction)
      }
    }
  }

  /**
   * Добавляет действие в очередь выполнения NovaSyncScope.
   */
  private queueLinkedWrite(
    link: InternalLink,
    sourceEndpoint: string,
    targetEndpoint: string,
    value: unknown,
    transaction: NovaSyncTransaction,
  ): void {
    if (transaction.path.has(targetEndpoint)) return
    if (link.config.filter && !link.config.filter(value, transaction)) return

    const nextValue = link.config.transform ? link.config.transform(value, transaction) : value
    const schedule = link.config.schedule ?? link.schedule
    const queued: QueuedWrite = { link, sourceEndpoint, targetEndpoint, value: nextValue, transaction }

    if (schedule === 'microtask') {
      this.microtaskQueue.set(`${link.id}:${sourceEndpoint}:${targetEndpoint}`, queued)
      this.scheduleMicrotaskFlush()
      return
    }

    if (schedule === 'frame') {
      this.frameQueue.set(`${link.id}:${sourceEndpoint}:${targetEndpoint}`, queued)
      this.scheduleFrameFlush()
      return
    }

    this.applyQueuedWrite(queued)
  }

  /**
   * Применяет подготовленное состояние NovaSyncScope.
   */
  private applyQueuedWrite(write: QueuedWrite): void {
    const target = this.ports.get(write.targetEndpoint)
    if (!target) return
    if (target.port.writable === false) {
      throw new Error(`[NovaSyncScope] Port "${write.targetEndpoint}" is readonly`)
    }

    const equals = write.link.config.equals ?? target.port.equals ?? Object.is
    if (equals(target.port.read(), write.value)) return

    this.applyDepth += 1
    try {
      target.port.write(write.value, write.transaction)
    } finally {
      this.applyDepth -= 1
    }

    this.propagate(write.targetEndpoint, write.value, write.transaction)
  }

  /**
   * Планирует отложенное выполнение NovaSyncScope.
   */
  private scheduleMicrotaskFlush(): void {
    if (this.microtaskScheduled) return
    this.microtaskScheduled = true
    queueMicrotask(() => {
      this.microtaskScheduled = false
      this.flushQueue(this.microtaskQueue)
    })
  }

  /**
   * Планирует отложенное выполнение NovaSyncScope.
   */
  private scheduleFrameFlush(): void {
    if (this.frameScheduled) return
    this.frameScheduled = true
    const requestFrame = globalThis.requestAnimationFrame ?? ((callback: FrameRequestCallback) => {
      return globalThis.setTimeout(() => callback(performance.now()), 16) as unknown as number
    })
    requestFrame(() => {
      this.frameScheduled = false
      this.flushQueue(this.frameQueue)
    })
  }

  /**
   * Принудительно завершает накопленные изменения NovaSyncScope.
   */
  private flushQueue(queue: Map<string, QueuedWrite>): void {
    const writes = [...queue.values()]
    queue.clear()
    for (const write of writes) {
      this.applyQueuedWrite(write)
    }
  }

  /**
   * Создает runtime-сущность NovaSyncScope.
   */
  private createTransaction(origin: string): NovaSyncTransaction {
    return {
      id: nextTransactionId++,
      origin,
      path: new Set(),
    }
  }

  /**
   * Выполняет внутренний шаг requirePort для NovaSyncScope.
   */
  private requirePort(endpoint: string): NovaSyncRegisteredPort {
    const port = this.ports.get(endpoint)
    if (!port) {
      throw new Error(`[NovaSyncScope] Port "${endpoint}" is not registered`)
    }
    return port
  }

  /**
   * Нормализует и возвращает итоговое значение NovaSyncScope.
   */
  private resolveEndpoint(endpoint: NovaSyncEndpointInput): string {
    if (typeof endpoint !== 'string') {
      if (!endpoint.id) throw new Error('[NovaSyncScope] Anonymous port cannot be used as an endpoint')
      return endpoint.id
    }
    return endpoint.startsWith('#') ? endpoint.slice(1) : endpoint
  }

  /**
   * Выполняет внутренний шаг endpointFor для NovaSyncScope.
   */
  private endpointFor(node: NovaNode<any>, name: string): string {
    const componentId = (node as unknown as { componentId?: string }).componentId
    if (!componentId) {
      throw new Error('[NovaSyncScope] Only component nodes with componentId can register sync ports')
    }
    return `${componentId}.${name}`
  }
}
