import type { NovaPhaseName } from '@/domain/constants/NovaPhase'

/**
 * Описывает идентификатор темы Nova.
 */
export type NovaThemeId = string

/**
 * Описывает имя theme token в формате CSS custom property.
 */
export type NovaThemeTokenName = `--${string}`

/**
 * Описывает значение theme token.
 */
export type NovaThemeTokenValue = string | number

/**
 * Описывает набор theme tokens.
 */
export type NovaThemeTokens = Record<NovaThemeTokenName, NovaThemeTokenValue>

/**
 * Описывает тему Nova runtime.
 */
export interface NovaThemeDefinition {
    id: NovaThemeId
    title?: string
    tokens: NovaThemeTokens
}

/**
 * Описывает snapshot активной темы.
 */
export interface NovaThemeSnapshot {
    active: NovaThemeId | null
    version: number
    tokens: NovaThemeTokens
}

/**
 * Описывает runtime resolver theme tokens.
 */
export interface NovaThemeTokenResolver {
    resolve: (name: string, fallback?: string) => string | undefined
    version?: number
}

/**
 * Описывает настройки подписки Nova node на смену темы.
 */
export interface NovaThemeObserveOptions {
    phase?: NovaPhaseName | string
}

/**
 * Описывает настройки создания theme service.
 */
export interface NovaThemeCreateOptions {
    themes?: Array<NovaThemeDefinition>
    active?: NovaThemeId
}
