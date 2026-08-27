import type {
  NovaSoundCueInput,
  NovaSoundDescriptor,
  NovaSoundHandle,
  NovaSoundHandleState,
  NovaSoundOptions,
  NovaSoundPlayOptions,
  NovaSoundStats,
} from '@/domain/types/sound.types'
import type { NovaApp } from '@/model/runtime/app/NovaApp'

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
  stop: () => void
  fadeTo: (volume: number, durationMs: number) => void
}

/**
 * Описывает backend Sound Engine.
 */
interface NovaSoundBackend {
  readonly kind: string
  readonly decoded: number
  load: (source: string) => Promise<unknown>
  play: (asset: NovaSoundAsset, options: ResolvedNovaSoundPlayOptions, onEnded: () => void) => NovaSoundBackendPlayback
  unlock: () => Promise<void>
  setMuted: (muted: boolean) => void
  setVolume: (volume: number) => void
  setCategoryVolume: (category: string, volume: number) => void
  destroy: () => void
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
  if (!Number.isFinite(value)) {
    return 0
  }
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
  if (source.startsWith(NOVA_TONE_PROTOCOL)) {
    return 'tone'
  }
  const cleanSource = source.split('?')[0]?.split('#')[0] ?? source
  const extension = cleanSource.match(/\.([a-z0-9]+)$/i)?.[1]
  return extension?.toLowerCase() ?? ''
}

/**
 * Проверяет поддержку source по format preference.
 */
function isFormatAllowed(source: string, formats: Array<string>): boolean {
  const format = resolveSourceFormat(source)
  if (format === 'tone' || source.startsWith('data:')) {
    return true
  }
  if (!format) {
    return true
  }
  return formats.includes(format)
}

/**
 * Выбирает лучший source с учетом списка форматов.
 */
function resolvePreferredSource(sources: Array<string>, formats: Array<string>): string {
  for (const format of formats) {
    const matched = sources.find(source => resolveSourceFormat(source) === format && isFormatAllowed(source, formats))
    if (matched) {
      return matched
    }
  }
  return sources.find(source => isFormatAllowed(source, formats)) ?? sources[0] ?? ''
}

/**
 * Реализует public playback handle.
 */
class NovaSoundPlaybackHandle implements NovaSoundHandle {
  readonly createdAt = Date.now()
  private _backendPlayback?: NovaSoundBackendPlayback
  private _resolveEnded!: () => void
  private _state: NovaSoundHandleState
  readonly ended: Promise<void>

  /**
   * Создает handle.
   */
  constructor(
    readonly id: string,
    readonly priority: number,
    readonly dedupeKey: string | undefined,
    private readonly _onFinish: (handle: NovaSoundPlaybackHandle) => void,
    state: NovaSoundHandleState = 'playing',
  ) {
    this._state = state
    this.ended = new Promise((resolve) => {
      this._resolveEnded = resolve
    })
    if (state === 'stopped' || state === 'ended') {
      queueMicrotask(() => this._resolveEnded())
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
    if (this._state === 'stopped' || this._state === 'ended') {
      return
    }
    this._state = 'stopped'
    this._backendPlayback?.stop()
    this._resolveEnded()
    this._onFinish(this)
  }

  /**
   * Плавно меняет громкость playback.
   */
  fadeTo(volume: number, durationMs = 120): void {
    if (this._state !== 'playing') {
      return
    }
    this._backendPlayback?.fadeTo(clamp01(volume), Math.max(0, durationMs))
  }

  /**
   * Подключает backend playback.
   */
  _attach(backendPlayback: NovaSoundBackendPlayback): void {
    this._backendPlayback = backendPlayback
  }

  /**
   * Завершает playback по сигналу backend.
   */
  _end(): void {
    if (this._state === 'stopped' || this._state === 'ended') {
      return
    }
    this._state = 'ended'
    this._resolveEnded()
    this._onFinish(this)
  }
}

/**
 * Создает silent handle для skipped playback.
 */
function createSilentHandle(id: string): NovaSoundHandle {
  return new NovaSoundPlaybackHandle(id, 0, undefined, () => undefined, 'stopped')
}

/**
 * Управляет playback handles в рамках scene/component scope.
 */
export class NovaSoundScope {
  private readonly _handles = new Set<NovaSoundHandle>()

  /**
   * Создает scope.
   */
  constructor(
    private readonly _engine: NovaSoundEngine,
    readonly name: string,
  ) {}

  /**
   * Запускает scoped sound.
   */
  play(id: string, options: NovaSoundPlayOptions = {}): NovaSoundHandle {
    const handle = this._engine.play(id, options)
    this._track(handle)
    return handle
  }

  /**
   * Запускает scoped sound cue.
   */
  playCue(input: NovaSoundCueInput | undefined): NovaSoundHandle | null {
    const handle = this._engine.playCue(input)
    if (handle) {
      this._track(handle)
    }
    return handle
  }

  /**
   * Останавливает и освобождает scope.
   */
  destroy(): void {
    for (const handle of [...this._handles]) {
      handle.stop()
    }
    this._handles.clear()
  }

  /**
   * Отслеживает handle до завершения.
   */
  private _track(handle: NovaSoundHandle): void {
    this._handles.add(handle)
    void handle.ended.finally(() => this._handles.delete(handle))
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

/**
 * Реализует Web Audio backend.
 */
class NovaWebAudioBackend implements NovaSoundBackend {
  readonly kind = 'web-audio'
  private readonly _masterGain: GainNode
  private readonly _categoryGains = new Map<string, GainNode>()
  private _decoded = 0
  private _masterVolume = 1
  private _muted = false

  /**
   * Создает backend.
   */
  constructor(private readonly _context: AudioContext) {
    this._masterGain = _context.createGain()
    this._masterGain.gain.value = 1
    this._masterGain.connect(_context.destination)
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
      return this._createToneBuffer(source)
    }

    const response = await fetch(source)
    const data = await response.arrayBuffer()
    const buffer = await this._context.decodeAudioData(data.slice(0))
    this._decoded += 1
    return buffer
  }

  /**
   * Запускает playback.
   */
  play(asset: NovaSoundAsset, options: ResolvedNovaSoundPlayOptions, onEnded: () => void): NovaSoundBackendPlayback {
    const source = this._context.createBufferSource()
    const gain = this._context.createGain()
    const panner = typeof this._context.createStereoPanner === 'function'
      ? this._context.createStereoPanner()
      : null
    const destination = this._resolveCategoryGain(options.category)

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
    }
    else {
      gain.connect(destination)
    }

    source.start()

    return {
      stop: () => {
        source.onended = null
        try {
          source.stop()
        }
        catch {
          // Source может быть уже остановлен браузером.
        }
      },
      fadeTo: (volume, durationMs) => {
        const now = this._context.currentTime
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
    if (this._context.state !== 'running') {
      await this._context.resume()
    }
  }

  /**
   * Обновляет mute.
   */
  setMuted(muted: boolean): void {
    this._muted = muted
    this._masterGain.gain.value = muted ? 0 : this._masterVolume
  }

  /**
   * Обновляет master volume.
   */
  setVolume(volume: number): void {
    this._masterVolume = volume
    this._masterGain.gain.value = this._muted ? 0 : volume
  }

  /**
   * Обновляет category volume.
   */
  setCategoryVolume(category: string, volume: number): void {
    this._resolveCategoryGain(category).gain.value = volume
  }

  /**
   * Освобождает backend resources.
   */
  destroy(): void {
    this._categoryGains.clear()
    this._masterGain.disconnect()
    void this._context.close().catch(() => undefined)
  }

  /**
   * Возвращает gain node категории.
   */
  private _resolveCategoryGain(category: string): GainNode {
    let gain = this._categoryGains.get(category)
    if (!gain) {
      gain = this._context.createGain()
      gain.gain.value = 1
      gain.connect(this._masterGain)
      this._categoryGains.set(category, gain)
    }
    return gain
  }

  /**
   * Создает короткий tone buffer без внешних файлов.
   */
  private _createToneBuffer(source: string): AudioBuffer {
    const url = new URL(source)
    const frequency = Number.parseFloat(url.searchParams.get('frequency') ?? '660')
    const duration = Number.parseFloat(url.searchParams.get('duration') ?? '0.1')
    const type = url.searchParams.get('type') ?? 'sine'
    const sampleRate = this._context.sampleRate
    const length = Math.max(1, Math.floor(sampleRate * Math.max(0.02, duration)))
    const buffer = this._context.createBuffer(1, length, sampleRate)
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
 * Управляет загрузкой, кэшированием и воспроизведением звуков Nova runtime.
 */
export class NovaSoundEngine {
  private readonly _descriptors = new Map<string, ResolvedNovaSoundDescriptor>()
  private readonly _assets = new Map<string, NovaSoundAsset>()
  private readonly _activeHandles = new Set<NovaSoundPlaybackHandle>()
  private readonly _lastPlayedAt = new Map<string, number>()
  private readonly _categoryVolumes = new Map<string, number>()
  private readonly _formats: Array<string>
  private readonly _backend: NovaSoundBackend
  private readonly _maxVoices: number
  private readonly _unlockMode: NovaSoundOptions['unlock']
  private _enabled: boolean
  private _muted: boolean
  private _volume: number
  private _played = 0
  private _skipped = 0
  private _unlocked = false

  /**
   * Создает instance и выбирает audio backend.
   */
  constructor(
    _app: NovaApp<any>,
    options: NovaSoundOptions = {},
  ) {
    this._enabled = options.enabled ?? true
    this._muted = options.muted ?? false
    this._volume = clamp01(options.volume ?? 1)
    this._maxVoices = Math.max(1, Math.floor(options.maxVoices ?? 32))
    this._formats = options.formats?.map(format => format.toLowerCase()) ?? DEFAULT_SOUND_FORMATS
    this._unlockMode = options.unlock ?? 'first-input'
    this._backend = this._createBackend()
    this._backend.setMuted(this._muted)
    this._backend.setVolume(this._volume)
    if (this._unlockMode === 'immediate') {
      void this.unlock()
    }
  }

  /**
   * Загружает один или несколько sound descriptors.
   */
  async load(input: NovaSoundDescriptor | Array<NovaSoundDescriptor>): Promise<void> {
    const descriptors = Array.isArray(input) ? input : [input]
    await Promise.all(descriptors.map(descriptor => this._loadOne(descriptor)))
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
    if (!this._enabled) {
      return this._skip(id)
    }

    const asset = this._assets.get(id)
    if (!asset) {
      return this._skip(id)
    }

    const playOptions = resolvePlayOptions(asset.descriptor, options)
    const dedupeKey = playOptions.dedupeKey ?? id
    if (!this._canPlay(asset.descriptor, playOptions, dedupeKey)) {
      return this._skip(id)
    }

    this._stopDedupeHandle(dedupeKey)
    this._enforceVoicePool(asset.descriptor.id, playOptions.priority)

    if (this._activeHandles.size >= this._maxVoices) {
      return this._skip(id)
    }

    const handle = new NovaSoundPlaybackHandle(
      id,
      playOptions.priority,
      dedupeKey,
      completed => this._finishHandle(completed),
    )
    this._activeHandles.add(handle)
    this._lastPlayedAt.set(dedupeKey, Date.now())
    this._played += 1

    const backendPlayback = this._backend.play(asset, playOptions, () => handle._end())
    handle._attach(backendPlayback)
    return handle
  }

  /**
   * Останавливает конкретный handle, asset id или все активные звуки.
   */
  stop(target?: NovaSoundHandle | string): void {
    if (!target) {
      for (const handle of [...this._activeHandles]) {
        handle.stop()
      }
      return
    }

    if (typeof target === 'string') {
      for (const handle of [...this._activeHandles]) {
        if (handle.id === target) {
          handle.stop()
        }
      }
      return
    }

    target.stop()
  }

  /**
   * Обновляет master mute.
   */
  setMuted(muted: boolean): void {
    this._muted = muted
    this._backend.setMuted(muted)
  }

  /**
   * Обновляет master volume.
   */
  setVolume(volume: number): void {
    this._volume = clamp01(volume)
    this._backend.setVolume(this._volume)
  }

  /**
   * Обновляет громкость категории.
   */
  setCategoryVolume(category: string, volume: number): void {
    const resolved = clamp01(volume)
    this._categoryVolumes.set(category, resolved)
    this._backend.setCategoryVolume(category, resolved)
  }

  /**
   * Разблокирует browser audio context после пользовательского жеста.
   */
  async unlock(): Promise<void> {
    if (this._unlocked) {
      return
    }
    await this._backend.unlock()
    this._unlocked = true
  }

  /**
   * Разблокирует audio context только для режима first-input.
   */
  unlockFromInput(): void {
    if (this._unlockMode !== 'first-input') {
      return
    }
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
      loaded: this._assets.size,
      active: this._activeHandles.size,
      played: this._played,
      skipped: this._skipped,
      decoded: this._backend.decoded,
      unlocked: this._unlocked,
      muted: this._muted,
      volume: this._volume,
    }
  }

  /**
   * Освобождает active handles, cache и backend resources.
   */
  destroy(): void {
    this.stop()
    this._descriptors.clear()
    this._assets.clear()
    this._lastPlayedAt.clear()
    this._categoryVolumes.clear()
    this._backend.destroy()
  }

  /**
   * Проигрывает sound cue input.
   */
  playCue(input: NovaSoundCueInput | undefined): NovaSoundHandle | null {
    if (!input) {
      return null
    }
    if (typeof input === 'string') {
      return this.play(input)
    }
    const { id, ...options } = input
    return this.play(id, options)
  }

  /**
   * Загружает один descriptor.
   */
  private async _loadOne(descriptor: NovaSoundDescriptor): Promise<void> {
    const resolved = resolveSoundDescriptor(descriptor)
    if (!resolved.id) {
      throw new Error('NovaSoundDescriptor.id is required')
    }
    if (resolved.src.length === 0) {
      throw new Error(`NovaSoundDescriptor.src is required for "${resolved.id}"`)
    }

    this._descriptors.set(resolved.id, resolved)
    if (this._assets.has(resolved.id)) {
      return
    }

    const source = resolvePreferredSource(resolved.src, this._formats)
    const resource = await this._backend.load(source)
    this._assets.set(resolved.id, {
      descriptor: resolved,
      source,
      resource,
    })
  }

  /**
   * Проверяет cooldown и instance limits.
   */
  private _canPlay(
    descriptor: ResolvedNovaSoundDescriptor,
    options: ResolvedNovaSoundPlayOptions,
    dedupeKey: string,
  ): boolean {
    const cooldown = options.cooldownMs
    const lastPlayedAt = this._lastPlayedAt.get(dedupeKey)
    if (cooldown > 0 && lastPlayedAt !== undefined && Date.now() - lastPlayedAt < cooldown) {
      return false
    }

    const instances = [...this._activeHandles].filter(handle => handle.id === descriptor.id)
    return instances.length < descriptor.maxInstances
  }

  /**
   * Останавливает предыдущее воспроизведение с тем же dedupe key.
   */
  private _stopDedupeHandle(dedupeKey: string): void {
    for (const handle of [...this._activeHandles]) {
      if (handle.dedupeKey === dedupeKey) {
        handle.stop()
      }
    }
  }

  /**
   * Освобождает место в voice pool при необходимости.
   */
  private _enforceVoicePool(id: string, priority: number): void {
    const sameId = [...this._activeHandles].filter(handle => handle.id === id)
    for (const handle of sameId) {
      if (this._activeHandles.size < this._maxVoices) {
        break
      }
      if (handle.priority <= priority) {
        handle.stop()
      }
    }

    if (this._activeHandles.size < this._maxVoices) {
      return
    }

    const candidate = [...this._activeHandles]
      .filter(handle => handle.priority <= priority)
      .sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt)[0]
    candidate?.stop()
  }

  /**
   * Удаляет завершенный handle из active pool.
   */
  private _finishHandle(handle: NovaSoundPlaybackHandle): void {
    this._activeHandles.delete(handle)
  }

  /**
   * Фиксирует skipped playback.
   */
  private _skip(id: string): NovaSoundHandle {
    this._skipped += 1
    return createSilentHandle(id)
  }

  /**
   * Создает лучший доступный backend.
   */
  private _createBackend(): NovaSoundBackend {
    if (!this._enabled) {
      return new NovaNoopSoundBackend()
    }
    const audioGlobal = globalThis as NovaAudioGlobal
    const AudioContextClass = audioGlobal.AudioContext ?? audioGlobal.webkitAudioContext
    if (!AudioContextClass) {
      return new NovaNoopSoundBackend()
    }
    return new NovaWebAudioBackend(new AudioContextClass())
  }
}
