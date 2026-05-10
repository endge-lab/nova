import type { NovaApp } from '@/model/runtime/app/NovaApp'
import type {
  NovaSoundCueInput,
  NovaSoundDescriptor,
  NovaSoundHandle,
  NovaSoundHandleState,
  NovaSoundOptions,
  NovaSoundPlayOptions,
  NovaSoundStats,
} from '@/domain/types/sound.types'

const DEFAULT_SOUND_FORMATS = ['ogg', 'mp3', 'wav']
const DEFAULT_SOUND_CATEGORY = 'default'
const NOVA_TONE_PROTOCOL = 'nova-tone://'

/**
 * Описывает загруженный sound asset.
 */
interface NovaSoundAsset {
  descriptor: ResolvedNovaSoundDescriptor
  source: string
  resource: unknown
}

/**
 * Описывает нормализованный descriptor.
 */
interface ResolvedNovaSoundDescriptor extends Required<Omit<NovaSoundDescriptor, 'src'>> {
  src: Array<string>
}

/**
 * Описывает backend-specific playback.
 */
interface NovaSoundBackendPlayback {
  stop(): void
  fadeTo(volume: number, durationMs: number): void
}

/**
 * Описывает backend Sound Engine.
 */
interface NovaSoundBackend {
  readonly kind: string
  readonly decoded: number
  load(source: string): Promise<unknown>
  play(asset: NovaSoundAsset, options: ResolvedNovaSoundPlayOptions, onEnded: () => void): NovaSoundBackendPlayback
  unlock(): Promise<void>
  setMuted(muted: boolean): void
  setVolume(volume: number): void
  setCategoryVolume(category: string, volume: number): void
  destroy(): void
}

type NovaAudioGlobal = typeof globalThis & {
  AudioContext?: typeof AudioContext
  webkitAudioContext?: typeof AudioContext
}

/**
 * Описывает нормализованные play options.
 */
interface ResolvedNovaSoundPlayOptions extends Required<Omit<NovaSoundPlayOptions, 'dedupeKey'>> {
  dedupeKey?: string
}

/**
 * Нормализует число к диапазону 0..1.
 */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/**
 * Нормализует sound descriptor.
 */
function resolveSoundDescriptor(descriptor: NovaSoundDescriptor): ResolvedNovaSoundDescriptor {
  return {
    id: descriptor.id,
    src: Array.isArray(descriptor.src) ? descriptor.src : [descriptor.src],
    category: descriptor.category ?? DEFAULT_SOUND_CATEGORY,
    volume: clamp01(descriptor.volume ?? 1),
    loop: descriptor.loop ?? false,
    preload: descriptor.preload ?? false,
    cooldownMs: Math.max(0, descriptor.cooldownMs ?? 0),
    maxInstances: Math.max(1, Math.floor(descriptor.maxInstances ?? Number.MAX_SAFE_INTEGER)),
    priority: Number.isFinite(descriptor.priority) ? descriptor.priority! : 0,
  }
}

/**
 * Нормализует play options.
 */
function resolvePlayOptions(
  descriptor: ResolvedNovaSoundDescriptor,
  options: NovaSoundPlayOptions = {},
): ResolvedNovaSoundPlayOptions {
  return {
    volume: clamp01(options.volume ?? descriptor.volume),
    rate: Math.max(0.05, options.rate ?? 1),
    pan: Math.max(-1, Math.min(1, options.pan ?? 0)),
    loop: options.loop ?? descriptor.loop,
    cooldownMs: Math.max(0, options.cooldownMs ?? descriptor.cooldownMs),
    category: options.category ?? descriptor.category,
    priority: Number.isFinite(options.priority) ? options.priority! : descriptor.priority,
    dedupeKey: options.dedupeKey,
  }
}

/**
 * Извлекает extension или protocol-based format из source.
 */
function resolveSourceFormat(source: string): string {
  if (source.startsWith(NOVA_TONE_PROTOCOL)) return 'tone'
  const cleanSource = source.split('?')[0]?.split('#')[0] ?? source
  const extension = cleanSource.match(/\.([a-z0-9]+)$/i)?.[1]
  return extension?.toLowerCase() ?? ''
}

/**
 * Проверяет поддержку source по format preference.
 */
function isFormatAllowed(source: string, formats: Array<string>): boolean {
  const format = resolveSourceFormat(source)
  if (format === 'tone' || source.startsWith('data:')) return true
  if (!format) return true
  return formats.includes(format)
}

/**
 * Выбирает лучший source с учетом списка форматов.
 */
function resolvePreferredSource(sources: Array<string>, formats: Array<string>): string {
  for (const format of formats) {
    const matched = sources.find(source => resolveSourceFormat(source) === format && isFormatAllowed(source, formats))
    if (matched) return matched
  }
  return sources.find(source => isFormatAllowed(source, formats)) ?? sources[0] ?? ''
}

/**
 * Создает silent handle для skipped playback.
 */
function createSilentHandle(id: string): NovaSoundHandle {
  return new NovaSoundPlaybackHandle(id, 0, undefined, () => undefined, 'stopped')
}

/**
 * Управляет загрузкой, кэшированием и воспроизведением звуков Nova runtime.
 */
export class NovaSoundEngine {
  private readonly descriptors = new Map<string, ResolvedNovaSoundDescriptor>()
  private readonly assets = new Map<string, NovaSoundAsset>()
  private readonly activeHandles = new Set<NovaSoundPlaybackHandle>()
  private readonly lastPlayedAt = new Map<string, number>()
  private readonly categoryVolumes = new Map<string, number>()
  private readonly formats: Array<string>
  private readonly backend: NovaSoundBackend
  private readonly maxVoices: number
  private readonly unlockMode: NovaSoundOptions['unlock']
  private enabled: boolean
  private muted: boolean
  private volume: number
  private played = 0
  private skipped = 0
  private unlocked = false

  /**
   * Создает instance и выбирает audio backend.
   */
  constructor(
    _app: NovaApp<any>,
    options: NovaSoundOptions = {},
  ) {
    this.enabled = options.enabled ?? true
    this.muted = options.muted ?? false
    this.volume = clamp01(options.volume ?? 1)
    this.maxVoices = Math.max(1, Math.floor(options.maxVoices ?? 32))
    this.formats = options.formats?.map(format => format.toLowerCase()) ?? DEFAULT_SOUND_FORMATS
    this.unlockMode = options.unlock ?? 'first-input'
    this.backend = this.createBackend()
    this.backend.setMuted(this.muted)
    this.backend.setVolume(this.volume)
    if (this.unlockMode === 'immediate') {
      void this.unlock()
    }
  }

  /**
   * Загружает один или несколько sound descriptors.
   */
  async load(input: NovaSoundDescriptor | Array<NovaSoundDescriptor>): Promise<void> {
    const descriptors = Array.isArray(input) ? input : [input]
    await Promise.all(descriptors.map(descriptor => this.loadOne(descriptor)))
  }

  /**
   * Алиас для фоновой предзагрузки sound descriptors.
   */
  async preload(input: NovaSoundDescriptor | Array<NovaSoundDescriptor>): Promise<void> {
    await this.load(input)
  }

  /**
   * Запускает воспроизведение sound asset.
   */
  play(id: string, options: NovaSoundPlayOptions = {}): NovaSoundHandle {
    if (!this.enabled) return this.skip(id)

    const asset = this.assets.get(id)
    if (!asset) return this.skip(id)

    const playOptions = resolvePlayOptions(asset.descriptor, options)
    const dedupeKey = playOptions.dedupeKey ?? id
    if (!this.canPlay(asset.descriptor, playOptions, dedupeKey)) return this.skip(id)

    this.stopDedupeHandle(dedupeKey)
    this.enforceVoicePool(asset.descriptor.id, playOptions.priority)

    if (this.activeHandles.size >= this.maxVoices) {
      return this.skip(id)
    }

    const handle = new NovaSoundPlaybackHandle(
      id,
      playOptions.priority,
      dedupeKey,
      completed => this.finishHandle(completed),
    )
    this.activeHandles.add(handle)
    this.lastPlayedAt.set(dedupeKey, Date.now())
    this.played += 1

    const backendPlayback = this.backend.play(asset, playOptions, () => handle._end())
    handle._attach(backendPlayback)
    return handle
  }

  /**
   * Останавливает конкретный handle, asset id или все активные звуки.
   */
  stop(target?: NovaSoundHandle | string): void {
    if (!target) {
      for (const handle of [...this.activeHandles]) {
        handle.stop()
      }
      return
    }

    if (typeof target === 'string') {
      for (const handle of [...this.activeHandles]) {
        if (handle.id === target) handle.stop()
      }
      return
    }

    target.stop()
  }

  /**
   * Обновляет master mute.
   */
  setMuted(muted: boolean): void {
    this.muted = muted
    this.backend.setMuted(muted)
  }

  /**
   * Обновляет master volume.
   */
  setVolume(volume: number): void {
    this.volume = clamp01(volume)
    this.backend.setVolume(this.volume)
  }

  /**
   * Обновляет громкость категории.
   */
  setCategoryVolume(category: string, volume: number): void {
    const resolved = clamp01(volume)
    this.categoryVolumes.set(category, resolved)
    this.backend.setCategoryVolume(category, resolved)
  }

  /**
   * Разблокирует browser audio context после пользовательского жеста.
   */
  async unlock(): Promise<void> {
    if (this.unlocked) return
    await this.backend.unlock()
    this.unlocked = true
  }

  /**
   * Разблокирует audio context только для режима first-input.
   */
  unlockFromInput(): void {
    if (this.unlockMode !== 'first-input') return
    void this.unlock()
  }

  /**
   * Создает scene/component scope для привязанных playback.
   */
  scope(name: string): NovaSoundScope {
    return new NovaSoundScope(this, name)
  }

  /**
   * Возвращает runtime stats.
   */
  stats(): NovaSoundStats {
    return {
      loaded: this.assets.size,
      active: this.activeHandles.size,
      played: this.played,
      skipped: this.skipped,
      decoded: this.backend.decoded,
      unlocked: this.unlocked,
      muted: this.muted,
      volume: this.volume,
    }
  }

  /**
   * Освобождает active handles, cache и backend resources.
   */
  destroy(): void {
    this.stop()
    this.descriptors.clear()
    this.assets.clear()
    this.lastPlayedAt.clear()
    this.categoryVolumes.clear()
    this.backend.destroy()
  }

  /**
   * Проигрывает sound cue input.
   */
  playCue(input: NovaSoundCueInput | undefined): NovaSoundHandle | null {
    if (!input) return null
    if (typeof input === 'string') return this.play(input)
    const { id, ...options } = input
    return this.play(id, options)
  }

  /**
   * Загружает один descriptor.
   */
  private async loadOne(descriptor: NovaSoundDescriptor): Promise<void> {
    const resolved = resolveSoundDescriptor(descriptor)
    if (!resolved.id) {
      throw new Error('NovaSoundDescriptor.id is required')
    }
    if (resolved.src.length === 0) {
      throw new Error(`NovaSoundDescriptor.src is required for "${resolved.id}"`)
    }

    this.descriptors.set(resolved.id, resolved)
    if (this.assets.has(resolved.id)) return

    const source = resolvePreferredSource(resolved.src, this.formats)
    const resource = await this.backend.load(source)
    this.assets.set(resolved.id, {
      descriptor: resolved,
      source,
      resource,
    })
  }

  /**
   * Проверяет cooldown и instance limits.
   */
  private canPlay(
    descriptor: ResolvedNovaSoundDescriptor,
    options: ResolvedNovaSoundPlayOptions,
    dedupeKey: string,
  ): boolean {
    const cooldown = options.cooldownMs
    const lastPlayedAt = this.lastPlayedAt.get(dedupeKey)
    if (cooldown > 0 && lastPlayedAt !== undefined && Date.now() - lastPlayedAt < cooldown) {
      return false
    }

    const instances = [...this.activeHandles].filter(handle => handle.id === descriptor.id)
    return instances.length < descriptor.maxInstances
  }

  /**
   * Останавливает предыдущее воспроизведение с тем же dedupe key.
   */
  private stopDedupeHandle(dedupeKey: string): void {
    for (const handle of [...this.activeHandles]) {
      if (handle.dedupeKey === dedupeKey) handle.stop()
    }
  }

  /**
   * Освобождает место в voice pool при необходимости.
   */
  private enforceVoicePool(id: string, priority: number): void {
    const sameId = [...this.activeHandles].filter(handle => handle.id === id)
    for (const handle of sameId) {
      if (this.activeHandles.size < this.maxVoices) break
      if (handle.priority <= priority) handle.stop()
    }

    if (this.activeHandles.size < this.maxVoices) return

    const candidate = [...this.activeHandles]
      .filter(handle => handle.priority <= priority)
      .sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt)[0]
    candidate?.stop()
  }

  /**
   * Удаляет завершенный handle из active pool.
   */
  private finishHandle(handle: NovaSoundPlaybackHandle): void {
    this.activeHandles.delete(handle)
  }

  /**
   * Фиксирует skipped playback.
   */
  private skip(id: string): NovaSoundHandle {
    this.skipped += 1
    return createSilentHandle(id)
  }

  /**
   * Создает лучший доступный backend.
   */
  private createBackend(): NovaSoundBackend {
    if (!this.enabled) return new NovaNoopSoundBackend()
    const audioGlobal = globalThis as NovaAudioGlobal
    const AudioContextClass = audioGlobal.AudioContext ?? audioGlobal.webkitAudioContext
    if (!AudioContextClass) return new NovaNoopSoundBackend()
    return new NovaWebAudioBackend(new AudioContextClass())
  }
}

/**
 * Управляет playback handles в рамках scene/component scope.
 */
export class NovaSoundScope {
  private readonly handles = new Set<NovaSoundHandle>()

  /**
   * Создает scope.
   */
  constructor(
    private readonly engine: NovaSoundEngine,
    readonly name: string,
  ) {}

  /**
   * Запускает scoped sound.
   */
  play(id: string, options: NovaSoundPlayOptions = {}): NovaSoundHandle {
    const handle = this.engine.play(id, options)
    this.track(handle)
    return handle
  }

  /**
   * Запускает scoped sound cue.
   */
  playCue(input: NovaSoundCueInput | undefined): NovaSoundHandle | null {
    const handle = this.engine.playCue(input)
    if (handle) this.track(handle)
    return handle
  }

  /**
   * Останавливает и освобождает scope.
   */
  destroy(): void {
    for (const handle of [...this.handles]) {
      handle.stop()
    }
    this.handles.clear()
  }

  /**
   * Отслеживает handle до завершения.
   */
  private track(handle: NovaSoundHandle): void {
    this.handles.add(handle)
    void handle.ended.finally(() => this.handles.delete(handle))
  }
}

/**
 * Реализует public playback handle.
 */
class NovaSoundPlaybackHandle implements NovaSoundHandle {
  readonly createdAt = Date.now()
  private backendPlayback?: NovaSoundBackendPlayback
  private resolveEnded!: () => void
  private _state: NovaSoundHandleState
  readonly ended: Promise<void>

  /**
   * Создает handle.
   */
  constructor(
    readonly id: string,
    readonly priority: number,
    readonly dedupeKey: string | undefined,
    private readonly onFinish: (handle: NovaSoundPlaybackHandle) => void,
    state: NovaSoundHandleState = 'playing',
  ) {
    this._state = state
    this.ended = new Promise(resolve => {
      this.resolveEnded = resolve
    })
    if (state === 'stopped' || state === 'ended') {
      queueMicrotask(() => this.resolveEnded())
    }
  }

  /**
   * Возвращает state.
   */
  get state(): NovaSoundHandleState {
    return this._state
  }

  /**
   * Останавливает playback.
   */
  stop(): void {
    if (this._state === 'stopped' || this._state === 'ended') return
    this._state = 'stopped'
    this.backendPlayback?.stop()
    this.resolveEnded()
    this.onFinish(this)
  }

  /**
   * Плавно меняет громкость playback.
   */
  fadeTo(volume: number, durationMs = 120): void {
    if (this._state !== 'playing') return
    this.backendPlayback?.fadeTo(clamp01(volume), Math.max(0, durationMs))
  }

  /**
   * Подключает backend playback.
   */
  _attach(backendPlayback: NovaSoundBackendPlayback): void {
    this.backendPlayback = backendPlayback
  }

  /**
   * Завершает playback по сигналу backend.
   */
  _end(): void {
    if (this._state === 'stopped' || this._state === 'ended') return
    this._state = 'ended'
    this.resolveEnded()
    this.onFinish(this)
  }
}

/**
 * Реализует Web Audio backend.
 */
class NovaWebAudioBackend implements NovaSoundBackend {
  readonly kind = 'web-audio'
  private readonly masterGain: GainNode
  private readonly categoryGains = new Map<string, GainNode>()
  private _decoded = 0
  private masterVolume = 1
  private muted = false

  /**
   * Создает backend.
   */
  constructor(private readonly context: AudioContext) {
    this.masterGain = context.createGain()
    this.masterGain.gain.value = 1
    this.masterGain.connect(context.destination)
  }

  /**
   * Возвращает decode count.
   */
  get decoded(): number {
    return this._decoded
  }

  /**
   * Загружает и декодирует audio resource.
   */
  async load(source: string): Promise<AudioBuffer> {
    if (source.startsWith(NOVA_TONE_PROTOCOL)) {
      this._decoded += 1
      return this.createToneBuffer(source)
    }

    const response = await fetch(source)
    const data = await response.arrayBuffer()
    const buffer = await this.context.decodeAudioData(data.slice(0))
    this._decoded += 1
    return buffer
  }

  /**
   * Запускает playback.
   */
  play(asset: NovaSoundAsset, options: ResolvedNovaSoundPlayOptions, onEnded: () => void): NovaSoundBackendPlayback {
    const source = this.context.createBufferSource()
    const gain = this.context.createGain()
    const panner = typeof this.context.createStereoPanner === 'function'
      ? this.context.createStereoPanner()
      : null
    const destination = this.resolveCategoryGain(options.category)

    source.buffer = asset.resource as AudioBuffer
    source.loop = options.loop
    source.playbackRate.value = options.rate
    gain.gain.value = options.volume
    source.onended = onEnded

    source.connect(gain)
    if (panner) {
      panner.pan.value = options.pan
      gain.connect(panner)
      panner.connect(destination)
    } else {
      gain.connect(destination)
    }

    source.start()

    return {
      stop: () => {
        source.onended = null
        try {
          source.stop()
        } catch {
          // Source может быть уже остановлен браузером.
        }
      },
      fadeTo: (volume, durationMs) => {
        const now = this.context.currentTime
        gain.gain.cancelScheduledValues(now)
        gain.gain.setValueAtTime(gain.gain.value, now)
        gain.gain.linearRampToValueAtTime(volume, now + durationMs / 1000)
      },
    }
  }

  /**
   * Разблокирует audio context.
   */
  async unlock(): Promise<void> {
    if (this.context.state !== 'running') {
      await this.context.resume()
    }
  }

  /**
   * Обновляет mute.
   */
  setMuted(muted: boolean): void {
    this.muted = muted
    this.masterGain.gain.value = muted ? 0 : this.masterVolume
  }

  /**
   * Обновляет master volume.
   */
  setVolume(volume: number): void {
    this.masterVolume = volume
    this.masterGain.gain.value = this.muted ? 0 : volume
  }

  /**
   * Обновляет category volume.
   */
  setCategoryVolume(category: string, volume: number): void {
    this.resolveCategoryGain(category).gain.value = volume
  }

  /**
   * Освобождает backend resources.
   */
  destroy(): void {
    this.categoryGains.clear()
    this.masterGain.disconnect()
    void this.context.close().catch(() => undefined)
  }

  /**
   * Возвращает gain node категории.
   */
  private resolveCategoryGain(category: string): GainNode {
    let gain = this.categoryGains.get(category)
    if (!gain) {
      gain = this.context.createGain()
      gain.gain.value = 1
      gain.connect(this.masterGain)
      this.categoryGains.set(category, gain)
    }
    return gain
  }

  /**
   * Создает короткий tone buffer без внешних файлов.
   */
  private createToneBuffer(source: string): AudioBuffer {
    const url = new URL(source)
    const frequency = Number.parseFloat(url.searchParams.get('frequency') ?? '660')
    const duration = Number.parseFloat(url.searchParams.get('duration') ?? '0.1')
    const type = url.searchParams.get('type') ?? 'sine'
    const sampleRate = this.context.sampleRate
    const length = Math.max(1, Math.floor(sampleRate * Math.max(0.02, duration)))
    const buffer = this.context.createBuffer(1, length, sampleRate)
    const channel = buffer.getChannelData(0)

    for (let i = 0; i < length; i++) {
      const t = i / sampleRate
      const envelope = Math.min(1, i / (sampleRate * 0.01)) * Math.min(1, (length - i) / (sampleRate * 0.02))
      const wave = type === 'square'
        ? Math.sign(Math.sin(2 * Math.PI * frequency * t))
        : Math.sin(2 * Math.PI * frequency * t)
      channel[i] = wave * envelope * 0.35
    }

    return buffer
  }
}

/**
 * Реализует silent backend для tests и unsupported окружений.
 */
class NovaNoopSoundBackend implements NovaSoundBackend {
  readonly kind = 'noop'
  private _decoded = 0

  /**
   * Возвращает decode count.
   */
  get decoded(): number {
    return this._decoded
  }

  /**
   * Загружает silent resource.
   */
  async load(source: string): Promise<{ source: string }> {
    this._decoded += 1
    return { source }
  }

  /**
   * Создает silent playback.
   */
  play(_asset: NovaSoundAsset, _options: ResolvedNovaSoundPlayOptions, onEnded: () => void): NovaSoundBackendPlayback {
    const timer = globalThis.setTimeout(onEnded, 0)
    return {
      stop: () => globalThis.clearTimeout(timer),
      fadeTo: () => undefined,
    }
  }

  /**
   * Разблокирует silent backend.
   */
  async unlock(): Promise<void> {}

  /**
   * Обновляет mute.
   */
  setMuted(_muted: boolean): void {}

  /**
   * Обновляет volume.
   */
  setVolume(_volume: number): void {}

  /**
   * Обновляет category volume.
   */
  setCategoryVolume(_category: string, _volume: number): void {}

  /**
   * Освобождает backend resources.
   */
  destroy(): void {}
}
