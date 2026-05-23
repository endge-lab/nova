import type { EventList } from '@endge/utils'
import type {
    NovaThemeDefinition,
    NovaThemeId,
    NovaThemeTokens,
} from '@/domain/types/theme.types'
import type { NovaApp } from '@/model/runtime/app/NovaApp'

export interface NovaGlobalThemeRule {
    selector?: {
        parts?: Array<{
            type?: string
            id?: string
            classes?: Array<string>
        }>
        specificity?: number
    }
    declarations?: {
        customProperties?: Record<string, unknown>
    }
    order?: number
}

export interface NovaGlobalThemeStyleSheet {
    rules?: Array<NovaGlobalThemeRule>
}

export interface NovaGlobalThemeAsset {
    themes?: Array<{
        id: NovaThemeId
        title?: string
        tokens?: NovaThemeTokens
        styleSheet?: NovaGlobalThemeStyleSheet | null
    }>
}

export interface NovaThemeSelectorTarget {
    type: string
    id?: string | null
    className?: unknown
    theme?: NovaThemeId | null
}

interface AttachedApp {
    app: NovaApp<EventList>
    inheritActive: boolean
}

/**
 * Global registry for imported NovaCSS assets and app-wide theme switching.
 */
export class NovaGlobalThemeRegistry {
    private readonly assets: Array<NovaGlobalThemeAsset> = []
    private readonly listeners = new Set<() => void>()
    private readonly apps = new Set<AttachedApp>()
    private activeTheme: NovaThemeId | null = null

    import(asset: NovaGlobalThemeAsset): void {
        if (!asset || !Array.isArray(asset.themes) || asset.themes.length === 0) return

        this.assets.push(asset)
        for (const entry of this.apps) {
            if (entry.inheritActive && this.activeTheme) {
                this.registerThemes(entry.app)
                this.tryUseTheme(entry.app, this.activeTheme)
            }
        }
        this.notify()
    }

    theme(): NovaThemeId | null
    theme(id: NovaThemeId): NovaThemeId
    theme(id?: NovaThemeId): NovaThemeId | null {
        if (id === undefined) return this.activeTheme

        this.activeTheme = id
        for (const entry of this.apps) {
            if (entry.inheritActive) {
                this.registerThemes(entry.app)
                this.tryUseTheme(entry.app, id)
            }
        }
        this.notify()
        return id
    }

    attach<E extends EventList>(app: NovaApp<E>, options: { inheritActive?: boolean } = {}): () => void {
        const entry: AttachedApp = {
            app: app as unknown as NovaApp<EventList>,
            inheritActive: options.inheritActive ?? true,
        }
        this.apps.add(entry)
        if (entry.inheritActive && this.activeTheme) {
            this.registerThemes(entry.app)
            this.tryUseTheme(entry.app, this.activeTheme)
        }

        return () => {
            this.apps.delete(entry)
        }
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener)
        return () => {
            this.listeners.delete(listener)
        }
    }

    resolveTokens(target: NovaThemeSelectorTarget): NovaThemeTokens {
        const themeId = target.theme ?? this.activeTheme
        if (!themeId) return {}

        const tokens: NovaThemeTokens = {}
        const classes = normalizeClassNames(target.className)
        const matchedRules: Array<{
            specificity: number
            order: number
            tokens: NovaThemeTokens
        }> = []
        let assetOrder = 0

        for (const asset of this.assets) {
            for (const theme of asset.themes ?? []) {
                if (theme.id !== themeId) continue

                Object.assign(tokens, theme.tokens ?? {})
                for (const rule of theme.styleSheet?.rules ?? []) {
                    if (!themeRuleMatchesTarget(rule, target, classes)) continue
                    matchedRules.push({
                        specificity: rule.selector?.specificity ?? 0,
                        order: assetOrder + (rule.order ?? 0),
                        tokens: normalizeThemeTokens(rule.declarations?.customProperties),
                    })
                }
            }
            assetOrder += 10_000
        }

        matchedRules
            .sort((left, right) => left.specificity - right.specificity || left.order - right.order)
            .forEach(rule => Object.assign(tokens, rule.tokens))

        return tokens
    }

    resetForTests(): void {
        this.assets.length = 0
        this.activeTheme = null
        this.listeners.clear()
        this.apps.clear()
    }

    private registerThemes(app: NovaApp<EventList>): void {
        const themes = this.collectThemeDefinitions()
        if (themes.length === 0) return

        try {
            for (const theme of themes) {
                app.theme.register(theme)
            }
        } catch {
            // Local apps may have their own strict theme state. Selector-level consumers can still resolve globally.
        }
    }

    private collectThemeDefinitions(): Array<NovaThemeDefinition> {
        const themes = new Map<NovaThemeId, NovaThemeDefinition>()

        for (const asset of this.assets) {
            for (const theme of asset.themes ?? []) {
                const previous = themes.get(theme.id)
                themes.set(theme.id, {
                    id: theme.id,
                    title: theme.title ?? previous?.title,
                    tokens: {
                        ...(previous?.tokens ?? {}),
                        ...(theme.tokens ?? {}),
                    },
                })
            }
        }

        return [...themes.values()]
    }

    private tryUseTheme(app: NovaApp<EventList>, id: NovaThemeId): void {
        try {
            app.theme.use(id)
        } catch {
            // Theme may be selector-only with no plain token definition for this app.
        }
    }

    private notify(): void {
        for (const listener of this.listeners) {
            listener()
        }
    }
}

export const NovaGlobalThemes = new NovaGlobalThemeRegistry()

function themeRuleMatchesTarget(
    rule: NovaGlobalThemeRule,
    target: NovaThemeSelectorTarget,
    classes: Set<string>,
): boolean {
    const parts = rule.selector?.parts ?? []
    const rightMost = parts[parts.length - 1]
    if (!rightMost) return false
    if (rightMost.type && rightMost.type !== target.type) return false
    if (rightMost.id && rightMost.id !== target.id) return false
    return (rightMost.classes ?? []).every(className => classes.has(className))
}

function normalizeThemeTokens(input: Record<string, unknown> | undefined): NovaThemeTokens {
    const tokens: NovaThemeTokens = {}
    for (const [name, value] of Object.entries(input ?? {})) {
        if (!name.startsWith('--')) continue
        tokens[name as `--${string}`] = String(value)
    }
    return tokens
}

function normalizeClassNames(input: unknown): Set<string> {
    if (typeof input === 'string') return new Set(input.split(/\s+/).filter(Boolean))
    if (Array.isArray(input)) return new Set(input.flatMap(item => [...normalizeClassNames(item)]))
    if (input && typeof input === 'object') {
        return new Set(Object.entries(input)
            .filter(([, enabled]) => Boolean(enabled))
            .map(([name]) => name))
    }
    return new Set()
}
