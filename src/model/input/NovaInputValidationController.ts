import type {
  NovaInputValidationResult,
  NovaInputValidationState,
} from '@/model/input/nova-input.types'

export type NovaInputValidateFn<TValue = unknown, TContext = unknown> = (
  value: TValue,
  context: TContext,
) => NovaInputValidationResult | Promise<NovaInputValidationResult>

/**
 * Координирует поведение контроллера NovaInputValidationController.
 */
export class NovaInputValidationController<TValue = unknown, TContext = unknown> {
  private _token = 0
  private _state: NovaInputValidationState = {
    result: true,
    pending: false,
    dirty: false,
    touched: false,
    submitted: false,
  }

  /**
   * Создает экземпляр NovaInputValidationController и подготавливает базовое состояние.
   */
  constructor(private readonly _validateFn?: NovaInputValidateFn<TValue, TContext>) {}

  /**
   * Возвращает значение состояния NovaInputValidationController.
   */
  getState(): NovaInputValidationState {
    return { ...this._state }
  }

  /**
   * Выполняет действие markDirty в рамках ответственности NovaInputValidationController.
   */
  markDirty(): void {
    this._state.dirty = true
  }

  /**
   * Выполняет действие markTouched в рамках ответственности NovaInputValidationController.
   */
  markTouched(): void {
    this._state.touched = true
  }

  /**
   * Выполняет действие markSubmitted в рамках ответственности NovaInputValidationController.
   */
  markSubmitted(): void {
    this._state.submitted = true
  }

  /**
   * Проверяет входное значение NovaInputValidationController.
   */
  async validate(value: TValue, context: TContext): Promise<NovaInputValidationState> {
    const runToken = ++this._token
    if (!this._validateFn) {
      this._applyResult(true)
      return this.getState()
    }
    this._state.pending = true
    const result = await this._validateFn(value, context)
    if (runToken !== this._token) {
      return this.getState()
    }
    this._applyResult(result)
    return this.getState()
  }

  /**
   * Обновляет значение состояния NovaInputValidationController.
   */
  setResult(result: NovaInputValidationResult): NovaInputValidationState {
    this._token += 1
    this._applyResult(result)
    return this.getState()
  }

  /**
   * Сбрасывает состояние к базовым значениям NovaInputValidationController.
   */
  reset(): void {
    this._token += 1
    this._state = {
      result: true,
      pending: false,
      dirty: false,
      touched: false,
      submitted: false,
    }
  }

  /**
   * Применяет подготовленное состояние NovaInputValidationController.
   */
  private _applyResult(result: NovaInputValidationResult): void {
    const message = result === true ? undefined : typeof result === 'string' ? result : result.message
    const code = result === true || typeof result === 'string' ? undefined : result.code
    this._state = {
      ...this._state,
      result,
      pending: false,
      message,
      code,
    }
  }
}
