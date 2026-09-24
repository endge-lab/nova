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
import type { NovaNode } from '@/model/runtime/tree/NovaNode'

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

  private readonly _ports = new Map<string, NovaSyncRegisteredPort>()
  private readonly _nodeEndpoints = new WeakMap<NovaNode<any>, Set<string>>()
  private readonly _links = new Map<string, InternalLink>()
  private readonly _microtaskQueue = new Map<string, QueuedWrite>()
  private readonly _frameQueue = new Map<string, QueuedWrite>()
  private _microtaskScheduled = false
  private _frameScheduled = false
  private _applyDepth = 0

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
      const endpoint = this._endpointFor(node, name)
      if (this._ports.has(endpoint)) {
        throw new Error(`[NovaSyncScope] Port "${endpoint}" is already registered`)
      }
      port.id = endpoint
      port.owner = node
      this._ports.set(endpoint, { endpoint, name, node, port })
      endpoints.add(endpoint)
    }

    this._nodeEndpoints.set(node, endpoints)
    return () => this.unregisterNode(node)
  }

  /**
   * Удаляет регистрацию сущности из runtime-слоя NovaSyncScope.
   */
  unregisterNode(node: NovaNode<any>): void {
    const endpoints = this._nodeEndpoints.get(node)
    if (!endpoints) {
      return
    }

    for (const endpoint of endpoints) {
      this._ports.delete(endpoint)
      for (const [linkId, link] of this._links) {
        if (link.from === endpoint || link.to === endpoint) {
          this._links.delete(linkId)
        }
      }
    }
    this._nodeEndpoints.delete(node)
  }

  /**
   * Выполняет действие link в рамках ответственности NovaSyncScope.
   */
  link(config: NovaSyncLinkConfig): NovaSyncLink {
    const from = this._resolveEndpoint(config.from)
    const to = this._resolveEndpoint(config.to)
    this._requirePort(from)
    this._requirePort(to)

    const id = config.id ?? `sync-link-${nextLinkId++}`
    if (this._links.has(id)) {
      throw new Error(`[NovaSyncScope] Link "${id}" is already registered`)
    }

    const schedule = config.schedule ?? this._requirePort(from).port.schedule ?? this.scheduler
    const link: InternalLink = {
      id,
      from,
      to,
      schedule,
      bidirectional: config.bidirectional ?? false,
      config,
      dispose: () => this.unlink(id),
    }
    this._links.set(id, link)
    return link
  }

  /**
   * Выполняет действие unlink в рамках ответственности NovaSyncScope.
   */
  unlink(id: string): void {
    this._links.delete(id)
  }

  /**
   * Нормализует и возвращает итоговое значение NovaSyncScope.
   */
  resolvePort<T = unknown>(endpoint: NovaSyncEndpointInput): NovaSyncPort<T> {
    return this._requirePort(this._resolveEndpoint(endpoint)).port as NovaSyncPort<T>
  }

  /**
   * Выполняет действие notify в рамках ответственности NovaSyncScope.
   */
  notify(endpoint: NovaSyncEndpointInput, value?: unknown, transaction?: NovaSyncTransaction): void {
    if (this._applyDepth > 0) {
      return
    }

    const sourceEndpoint = this._resolveEndpoint(endpoint)
    const source = this._requirePort(sourceEndpoint)
    const nextValue = arguments.length >= 2 ? value : source.port.read()
    const tx = transaction ?? this._createTransaction(sourceEndpoint)
    this._propagate(sourceEndpoint, nextValue, tx)
  }

  /**
   * Выполняет действие notifyPortChanged в рамках ответственности NovaSyncScope.
   */
  notifyPortChanged(node: NovaNode<any>, name: string, value?: unknown): void {
    const endpoint = this._endpointFor(node, name)
    if (!this._ports.has(endpoint)) {
      return
    }
    if (arguments.length >= 3) {
      this.notify(endpoint, value)
    }
    else { this.notify(endpoint) }
  }

  /**
   * Освобождает runtime-ресурсы и подписки NovaSyncScope.
   */
  dispose(): void {
    this._ports.clear()
    this._links.clear()
    this._microtaskQueue.clear()
    this._frameQueue.clear()
    this._microtaskScheduled = false
    this._frameScheduled = false
  }

  /**
   * Выполняет внутренний шаг propagate для NovaSyncScope.
   */
  private _propagate(sourceEndpoint: string, value: unknown, transaction: NovaSyncTransaction): void {
    if (transaction.path.has(sourceEndpoint)) {
      return
    }
    transaction.path.add(sourceEndpoint)

    for (const link of this._links.values()) {
      if (link.from === sourceEndpoint) {
        this._queueLinkedWrite(link, sourceEndpoint, link.to, value, transaction)
      }
      else if (link.bidirectional && link.to === sourceEndpoint) {
        this._queueLinkedWrite(link, sourceEndpoint, link.from, value, transaction)
      }
    }
  }

  /**
   * Добавляет действие в очередь выполнения NovaSyncScope.
   */
  private _queueLinkedWrite(
    link: InternalLink,
    sourceEndpoint: string,
    targetEndpoint: string,
    value: unknown,
    transaction: NovaSyncTransaction,
  ): void {
    if (transaction.path.has(targetEndpoint)) {
      return
    }
    if (link.config.filter && !link.config.filter(value, transaction)) {
      return
    }

    const nextValue = link.config.transform ? link.config.transform(value, transaction) : value
    const schedule = link.config.schedule ?? link.schedule
    const queued: QueuedWrite = { link, sourceEndpoint, targetEndpoint, value: nextValue, transaction }

    if (schedule === 'microtask') {
      this._microtaskQueue.set(`${link.id}:${sourceEndpoint}:${targetEndpoint}`, queued)
      this._scheduleMicrotaskFlush()
      return
    }

    if (schedule === 'frame') {
      this._frameQueue.set(`${link.id}:${sourceEndpoint}:${targetEndpoint}`, queued)
      this._scheduleFrameFlush()
      return
    }

    this._applyQueuedWrite(queued)
  }

  /**
   * Применяет подготовленное состояние NovaSyncScope.
   */
  private _applyQueuedWrite(write: QueuedWrite): void {
    const target = this._ports.get(write.targetEndpoint)
    if (!target) {
      return
    }
    if (target.port.writable === false) {
      throw new Error(`[NovaSyncScope] Port "${write.targetEndpoint}" is readonly`)
    }

    const equals = write.link.config.equals ?? target.port.equals ?? Object.is
    if (equals(target.port.read(), write.value)) {
      return
    }

    this._applyDepth += 1
    try {
      target.port.write(write.value, write.transaction)
    }
    finally {
      this._applyDepth -= 1
    }

    this._propagate(write.targetEndpoint, write.value, write.transaction)
  }

  /**
   * Планирует отложенное выполнение NovaSyncScope.
   */
  private _scheduleMicrotaskFlush(): void {
    if (this._microtaskScheduled) {
      return
    }
    this._microtaskScheduled = true
    queueMicrotask(() => {
      this._microtaskScheduled = false
      this._flushQueue(this._microtaskQueue)
    })
  }

  /**
   * Планирует отложенное выполнение NovaSyncScope.
   */
  private _scheduleFrameFlush(): void {
    if (this._frameScheduled) {
      return
    }
    this._frameScheduled = true
    const requestFrame = globalThis.requestAnimationFrame ?? ((callback: FrameRequestCallback) => {
      return globalThis.setTimeout(() => callback(performance.now()), 16) as unknown as number
    })
    requestFrame(() => {
      this._frameScheduled = false
      this._flushQueue(this._frameQueue)
    })
  }

  /**
   * Принудительно завершает накопленные изменения NovaSyncScope.
   */
  private _flushQueue(queue: Map<string, QueuedWrite>): void {
    const writes = [...queue.values()]
    queue.clear()
    for (const write of writes) {
      this._applyQueuedWrite(write)
    }
  }

  /**
   * Создает runtime-сущность NovaSyncScope.
   */
  private _createTransaction(origin: string): NovaSyncTransaction {
    return {
      id: nextTransactionId++,
      origin,
      path: new Set(),
    }
  }

  /**
   * Выполняет внутренний шаг requirePort для NovaSyncScope.
   */
  private _requirePort(endpoint: string): NovaSyncRegisteredPort {
    const port = this._ports.get(endpoint)
    if (!port) {
      throw new Error(`[NovaSyncScope] Port "${endpoint}" is not registered`)
    }
    return port
  }

  /**
   * Нормализует и возвращает итоговое значение NovaSyncScope.
   */
  private _resolveEndpoint(endpoint: NovaSyncEndpointInput): string {
    if (typeof endpoint !== 'string') {
      if (!endpoint.id) {
        throw new Error('[NovaSyncScope] Anonymous port cannot be used as an endpoint')
      }
      return endpoint.id
    }
    return endpoint.startsWith('#') ? endpoint.slice(1) : endpoint
  }

  /**
   * Выполняет внутренний шаг endpointFor для NovaSyncScope.
   */
  private _endpointFor(node: NovaNode<any>, name: string): string {
    const componentId = (node as unknown as { componentId?: string }).componentId
    if (!componentId) {
      throw new Error('[NovaSyncScope] Only component nodes with componentId can register sync ports')
    }
    return `${componentId}.${name}`
  }
}
