import type {
  NovaInputValidationResult,
  NovaInputValidationState,
} from '@/model/input/nova-input.types'

export type NovaInputValidateFn<TValue = unknown, TContext = unknown> = (
  value: TValue,
  context: TContext,
) => NovaInputValidationResult | Promise<NovaInputValidationResult>

export class NovaInputValidationController<TValue = unknown, TContext = unknown> {
  private token = 0
  private state: NovaInputValidationState = {
    result: true,
    pending: false,
    dirty: false,
    touched: false,
    submitted: false,
  }

  constructor(private readonly validateFn?: NovaInputValidateFn<TValue, TContext>) {}

  getState(): NovaInputValidationState {
    return { ...this.state }
  }

  markDirty(): void {
    this.state.dirty = true
  }

  markTouched(): void {
    this.state.touched = true
  }

  markSubmitted(): void {
    this.state.submitted = true
  }

  async validate(value: TValue, context: TContext): Promise<NovaInputValidationState> {
    const runToken = ++this.token
    if (!this.validateFn) {
      this.applyResult(true)
      return this.getState()
    }
    this.state.pending = true
    const result = await this.validateFn(value, context)
    if (runToken !== this.token) return this.getState()
    this.applyResult(result)
    return this.getState()
  }

  setResult(result: NovaInputValidationResult): NovaInputValidationState {
    this.token += 1
    this.applyResult(result)
    return this.getState()
  }

  reset(): void {
    this.token += 1
    this.state = {
      result: true,
      pending: false,
      dirty: false,
      touched: false,
      submitted: false,
    }
  }

  private applyResult(result: NovaInputValidationResult): void {
    const message = result === true ? undefined : typeof result === 'string' ? result : result.message
    const code = result === true || typeof result === 'string' ? undefined : result.code
    this.state = {
      ...this.state,
      result,
      pending: false,
      message,
      code,
    }
  }
}
