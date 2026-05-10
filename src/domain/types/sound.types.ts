import type { NovaNodeEventHandlers } from '@/domain/types/events.types'

/**
 * Описывает режим unlock для браузерного audio context.
 */
export type NovaSoundUnlockMode = 'first-input' | 'manual' | 'immediate'

/**
 * Описывает состояние одного sound handle.
 */
export type NovaSoundHandleState = 'idle' | 'playing' | 'stopped' | 'ended'

/**
 * Описывает настройки Nova Sound Engine.
 */
export interface NovaSoundOptions {
  enabled?: boolean
  muted?: boolean
  volume?: number
  maxVoices?: number
  unlock?: NovaSoundUnlockMode
  formats?: Array<string>
}

/**
 * Описывает загружаемый sound asset.
 */
export interface NovaSoundDescriptor {
  id: string
  src: string | Array<string>
  category?: string
  volume?: number
  loop?: boolean
  preload?: boolean
  cooldownMs?: number
  maxInstances?: number
  priority?: number
}

/**
 * Описывает runtime-настройки одного playback.
 */
export interface NovaSoundPlayOptions {
  volume?: number
  rate?: number
  pan?: number
  loop?: boolean
  dedupeKey?: string
  cooldownMs?: number
  category?: string
  priority?: number
}

/**
 * Описывает play/stop handle конкретного воспроизведения.
 */
export interface NovaSoundHandle {
  readonly id: string
  readonly state: NovaSoundHandleState
  readonly ended: Promise<void>
  stop(): void
  fadeTo(volume: number, durationMs?: number): void
}

/**
 * Описывает sound cue для привязки к событиям node или UI Kit.
 */
export interface NovaSoundCueOptions extends NovaSoundPlayOptions {
  id: string
}

/**
 * Описывает входной формат sound cue.
 */
export type NovaSoundCueInput = string | NovaSoundCueOptions

/**
 * Описывает карту событий node к sound cue.
 */
export type NovaNodeSoundMap = Partial<Record<keyof NovaNodeEventHandlers, NovaSoundCueInput>>

/**
 * Описывает статистику Sound Engine.
 */
export interface NovaSoundStats {
  loaded: number
  active: number
  played: number
  skipped: number
  decoded: number
  unlocked: boolean
  muted: boolean
  volume: number
}
