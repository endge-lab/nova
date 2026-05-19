import type { EventList } from '@endge/utils'
import { NovaPhase } from '@/domain/constants/nova-phase'
import type {
    NovaThemeCreateOptions,
    NovaThemeDefinition,
    NovaThemeId,
    NovaThemeObserveOptions,
    NovaThemeSnapshot,
    NovaThemeTokenName,
    NovaThemeTokenResolver,
    NovaThemeTokenValue,
} from '@/domain/types/theme.types'
import type { NovaApp } from '@/model/runtime/app/NovaApp'
import type { NovaNode } from '@/model/runtime/tree/NovaNode'

/**
 * Путь активной темы в shared RaphKernel data-store.
 */
export const NOVA_THEME_ACTIVE_PATH = 'nova.theme.active'

/**
 * Путь версии темы в shared RaphKernel data-store.
 */
export const NOVA_THEME_VERSION_PATH = 'nova.theme.version'

/**
 * Управляет Nova theme definitions, а активную тему хранит в shared RaphKernel.
 */
export class NovaThemeService<E extends EventList = Record<string, any>> {
    //
    // Registry темы остается доменной частью Nova, а active/version живут в Raph data.
    private readonly themes = new Map<NovaThemeId, NovaThemeDefinition>()

    /**
     * Создает service и регистрирует начальные темы.
     */
    constructor(private readonly app: NovaApp<E>, options: NovaThemeCreateOptions = {}) {
        if (options.themes) {
            this.registerMany(options.themes, { active: options.active })
        } else if (options.active) {
            this.use(options.active)
        }
    }

    /**
     * Регистрирует тему в локальном Nova registry.
     */
    register(theme: NovaThemeDefinition, options: { activate?: boolean } = {}): void {
        this.themes.set(theme.id, {
            ...theme,
            tokens: { ...theme.tokens },
        })

        if (options.activate || !this.active()) {
            this.use(theme.id)
            return
        }

        if (this.active() === theme.id) {
            this.bumpVersion()
        }
    }

    /**
     * Регистрирует несколько тем.
     */
    registerMany(themes: Array<NovaThemeDefinition>, options: { active?: NovaThemeId } = {}): void {
        for (const theme of themes) {
            this.themes.set(theme.id, {
                ...theme,
                tokens: { ...theme.tokens },
            })
        }

        const active = options.active ?? this.active() ?? themes[0]?.id
        if (active) this.use(active)
    }

    /**
     * Делает тему активной и пишет состояние в RaphKernel.
     */
    use(id: NovaThemeId): void {
        if (!this.themes.has(id)) {
            throw new Error(`[NovaTheme] Theme "${id}" is not registered.`)
        }

        if (this.active() === id) return

        this.app.raph.kernel.transaction(() => {
            this.app.raph.kernel.set(NOVA_THEME_ACTIVE_PATH, id)
            this.app.raph.kernel.set(NOVA_THEME_VERSION_PATH, this.version() + 1)
        })
    }

    /**
     * Возвращает активный theme id из RaphKernel.
     */
    active(): NovaThemeId | null {
        const value = this.app.raph.kernel.get(NOVA_THEME_ACTIVE_PATH)
        return typeof value === 'string' ? value : null
    }

    /**
     * Возвращает текущую версию темы из RaphKernel.
     */
    version(): number {
        const value = this.app.raph.kernel.get(NOVA_THEME_VERSION_PATH)
        return typeof value === 'number' && Number.isFinite(value) ? value : 0
    }

    /**
     * Возвращает активную theme definition.
     */
    activeDefinition(): NovaThemeDefinition | null {
        const active = this.active()
        return active ? this.themes.get(active) ?? null : null
    }

    /**
     * Возвращает raw token активной темы.
     */
    token(name: NovaThemeTokenName): NovaThemeTokenValue | undefined {
        return this.activeDefinition()?.tokens[name]
    }

    /**
     * Резолвит token в строку для renderer и NovaCSS.
     */
    resolve(name: string, fallback?: string): string | undefined {
        if (!isNovaThemeTokenName(name)) return fallback

        const value = this.token(name)
        if (value === undefined) return fallback
        return String(value)
    }

    /**
     * Возвращает snapshot активной темы.
     */
    snapshot(): NovaThemeSnapshot {
        const definition = this.activeDefinition()
        return {
            active: definition?.id ?? this.active(),
            version: this.version(),
            tokens: definition ? { ...definition.tokens } : {},
        }
    }

    /**
     * Создает resolver, совместимый с Nova UI Kit style engine.
     */
    createTokenResolver(): NovaThemeTokenResolver {
        const resolveToken = this.resolve.bind(this)
        const resolveVersion = this.version.bind(this)

        return {
            /**
             * Возвращает version для NovaThemeService.
             */
            get version() {
                return resolveVersion()
            },
            resolve: resolveToken,
        }
    }

    /**
     * Подписывает Nova node на смену темы через Raph data observer.
     */
    observe(node: NovaNode<E>, options: NovaThemeObserveOptions = {}): () => void {
        return node.observeData(NOVA_THEME_VERSION_PATH, {
            phase: options.phase ?? NovaPhase.Render,
        })
    }

    /**
     * Возвращает путь версии темы для прямых подписок.
     */
    get versionPath(): string {
        return NOVA_THEME_VERSION_PATH
    }

    /**
     * Возвращает путь активной темы для диагностики и интеграций.
     */
    get activePath(): string {
        return NOVA_THEME_ACTIVE_PATH
    }

    /**
     * Поднимает версию темы без смены active id.
     */
    private bumpVersion(): void {
        this.app.raph.kernel.set(NOVA_THEME_VERSION_PATH, this.version() + 1)
    }
}

/**
 * Проверяет, что строка является Nova theme token.
 */
function isNovaThemeTokenName(value: string): value is NovaThemeTokenName {
    return value.startsWith('--')
}
