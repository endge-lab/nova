// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import {
  NovaCaretBlinkController,
  NovaClipboardService,
  NovaInputProxyService,
  NovaInputValidationController,
  NovaTextInputController,
  layoutNovaTextInput,
  novaCaretRectAtIndex,
  novaSelectionRects,
  novaTextIndexAtPoint,
  type NovaInputValidationResult,
} from '@/index'

describe('Nova input core', () => {
  it('edits text, moves caret by grapheme and commits values', () => {
    const commits: Array<string> = []
    const controller = new NovaTextInputController({
      value: 'A🙂B',
      onCommit: value => commits.push(value),
    })

    controller.select(1, 1)
    controller.moveCaret('right')
    expect(controller.getSelection()).toEqual({ start: 3, end: 3, direction: 'none' })

    controller.insertText('!')
    expect(controller.getState().draft).toBe('A🙂!B')

    controller.deleteBackward()
    expect(controller.getState().draft).toBe('A🙂B')

    controller.commit()
    expect(commits).toEqual(['A🙂B'])
  })

  it('supports ranged selection, select all and cancel', () => {
    const controller = new NovaTextInputController({ value: 'abcdef' })
    controller.select(1, 4)
    controller.insertText('X')
    expect(controller.getState().draft).toBe('aXef')

    controller.selectAll()
    expect(controller.getSelectedText()).toBe('aXef')

    controller.cancel()
    expect(controller.getState().draft).toBe('abcdef')
  })

  it('deletes exactly the selected tail character or previous tail grapheme', () => {
    const selectedTail = new NovaTextInputController({ value: 'abcd' })
    selectedTail.select(3, 4)
    selectedTail.deleteBackward()
    expect(selectedTail.getState().draft).toBe('abc')

    const caretAtEnd = new NovaTextInputController({ value: 'abcd' })
    caretAtEnd.select(4, 4)
    caretAtEnd.deleteBackward()
    expect(caretAtEnd.getState().draft).toBe('abc')
  })

  it('computes single-line and multiline caret/selection geometry', () => {
    const layout = layoutNovaTextInput({
      text: 'one two\nthree',
      width: 120,
      height: 80,
      multiline: true,
      wrap: true,
      fontSize: 10,
      lineHeight: 14,
      charWidth: 6,
      padding: 4,
    })

    expect(layout.lines).toHaveLength(2)
    expect(novaTextIndexAtPoint(layout, 5, 5)).toBe(0)
    expect(novaCaretRectAtIndex(layout, 4).height).toBeGreaterThan(0)
    expect(novaSelectionRects(layout, 0, layout.text.length).length).toBeGreaterThan(1)
  })

  it('wraps textarea text to the available content width', () => {
    const layout = layoutNovaTextInput({
      text: 'abcdefghijklmnop',
      width: 46,
      height: 120,
      multiline: true,
      wrap: true,
      fontSize: 10,
      lineHeight: 14,
      charWidth: 6,
      padding: { left: 4, right: 4, top: 4, bottom: 4 },
    })

    expect(layout.lines.length).toBeGreaterThan(1)
    expect(layout.lines.every(line => line.width <= layout.contentWidth)).toBe(true)
  })

  it('cancels stale async validation results', async () => {
    let resolveFirst: (value: NovaInputValidationResult) => void = () => {}
    const validator = new NovaInputValidationController<string, string>(value => {
      if (value === 'first') {
        return new Promise<NovaInputValidationResult>(resolve => { resolveFirst = resolve })
      }
      return true
    })

    const first = validator.validate('first', 'test')
    const second = await validator.validate('second', 'test')
    resolveFirst('stale error')
    await first

    expect(second.result).toBe(true)
    expect(validator.getState().result).toBe(true)
  })

  it('bridges clipboard through Clipboard API and proxy fallback', async () => {
    const service = new NovaClipboardService()
    const writeText = vi.fn()
    const readText = vi.fn(async () => 'copied')
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText, readText },
    })

    expect((await service.writeText('copied')).ok).toBe(true)
    expect((await service.readText()).text).toBe('copied')

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    })
    const textarea = document.createElement('textarea')
    expect((await service.writeText('fallback', textarea)).ok).toBe(true)
    expect(textarea.value).toBe('fallback')
  })

  it('attaches hidden proxy only for proxy and auto engines', () => {
    const canvasProxy = new NovaInputProxyService({ engine: 'canvas' })
    expect(canvasProxy.attach()).toBeNull()

    const autoProxy = new NovaInputProxyService({ engine: 'auto' })
    const element = autoProxy.attach()
    expect(element?.tagName).toBe('TEXTAREA')
    autoProxy.sync('abc', 1, 2)
    expect(element?.selectionStart).toBe(1)
    autoProxy.dispose()
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('uses one shared caret blink scheduler for active inputs', () => {
    vi.useFakeTimers()
    const ticks: Array<boolean> = []
    const first = new NovaCaretBlinkController(value => ticks.push(value), 10)
    const second = new NovaCaretBlinkController(value => ticks.push(value), 10)

    first.start()
    second.start()
    vi.advanceTimersByTime(12)
    first.stop()
    second.stop()

    expect(ticks.length).toBeGreaterThanOrEqual(4)
    vi.useRealTimers()
  })
})
