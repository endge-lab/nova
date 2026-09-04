// @vitest-environment jsdom

import type { NovaInputValidationResult } from '@/index'
import { describe, expect, it, vi } from 'vitest'
import {
  layoutNovaTextInput,
  NovaCaretBlinkController,
  novaCaretRectAtIndex,
  NovaClipboardService,
  NovaInputProxy_Adapter,
  NovaInputValidationController,

  novaSelectionRects,
  novaTextIndexAtPoint,
  NovaTextInputController,
  splitGraphemes,
} from '@/index'

describe('ядро input Nova', () => {
  it('редактирует текст, перемещает каретку по графемам и фиксирует значения', () => {
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

  it('поддерживает диапазонное выделение, выбор всего и отмену', () => {
    const controller = new NovaTextInputController({ value: 'abcdef' })
    controller.select(1, 4)
    controller.insertText('X')
    expect(controller.getState().draft).toBe('aXef')

    controller.selectAll()
    expect(controller.getSelectedText()).toBe('aXef')

    controller.cancel()
    expect(controller.getState().draft).toBe('abcdef')
  })

  it('удаляет ровно выбранный последний символ или предыдущую последнюю графему', () => {
    const selectedTail = new NovaTextInputController({ value: 'abcd' })
    selectedTail.select(3, 4)
    selectedTail.deleteBackward()
    expect(selectedTail.getState().draft).toBe('abc')

    const caretAtEnd = new NovaTextInputController({ value: 'abcd' })
    caretAtEnd.select(4, 4)
    caretAtEnd.deleteBackward()
    expect(caretAtEnd.getState().draft).toBe('abc')
  })

  it('вычисляет геометрию каретки и выделения для одной и нескольких строк', () => {
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

  it('выравнивает геометрию каретки и hit-test по измеренным пропорциональным glyphs', () => {
    const measureText = createMeasuredText({ 'W': 12, 'i': 3, '.': 4 })
    const layout = layoutNovaTextInput({
      text: 'Wi.',
      width: 120,
      height: 34,
      fontSize: 12,
      lineHeight: 18,
      padding: { left: 10, right: 10, top: 8, bottom: 8 },
      align: 'center',
      measureText,
    })

    expect(layout.lines[0]?.width).toBe(19)
    expect(layout.lines[0]?.x).toBe(50.5)
    expect(layout.glyphs.map(glyph => glyph.width)).toEqual([12, 3, 4])
    expect(novaCaretRectAtIndex(layout, 0).x).toBeCloseTo(50.5)
    expect(novaCaretRectAtIndex(layout, 1).x).toBeCloseTo(62.5)
    expect(novaCaretRectAtIndex(layout, 2).x).toBeCloseTo(65.5)
    expect(novaTextIndexAtPoint(layout, 65.6, 17)).toBe(2)
    expect(novaTextIndexAtPoint(layout, 69.5, 17)).toBe(3)
  })

  it('удерживает позиции каретки для выравнивания вправо и пустой строки внутри визуальной строки текста', () => {
    const measureText = createMeasuredText({ a: 5, b: 5 })
    const rightAligned = layoutNovaTextInput({
      text: 'ab',
      width: 80,
      height: 24,
      fontSize: 12,
      lineHeight: 16,
      padding: { left: 4, right: 6, top: 4, bottom: 4 },
      align: 'right',
      measureText,
    })

    expect(rightAligned.lines[0]?.x).toBe(64)
    expect(novaCaretRectAtIndex(rightAligned, 0).x).toBe(64)
    expect(novaCaretRectAtIndex(rightAligned, 2).x).toBe(74)

    const trailingEmptyLine = layoutNovaTextInput({
      text: 'ab\n',
      width: 80,
      height: 60,
      multiline: true,
      wrap: true,
      fontSize: 12,
      lineHeight: 16,
      padding: 4,
      align: 'center',
      measureText,
    })

    expect(trailingEmptyLine.lines).toHaveLength(2)
    expect(trailingEmptyLine.lines[0]).toMatchObject({ start: 0, end: 2, text: 'ab' })
    expect(trailingEmptyLine.lines[1]).toMatchObject({ start: 3, end: 3, text: '' })
    expect(novaCaretRectAtIndex(trailingEmptyLine, 3)).toMatchObject({
      x: 40,
      y: 22,
    })
  })

  it('обеспечивает round-trip индексов каретки через перенесённые строки и ширины графем', () => {
    const measureText = createMeasuredText({ 'A': 8, '🙂': 14, 'B': 8, 'C': 8 })
    const layout = layoutNovaTextInput({
      text: 'A🙂BC',
      width: 34,
      height: 80,
      multiline: true,
      wrap: true,
      fontSize: 12,
      lineHeight: 16,
      padding: 4,
      measureText,
    })

    expect(layout.lines.map(line => ({ start: line.start, end: line.end, text: line.text }))).toEqual([
      { start: 0, end: 3, text: 'A🙂' },
      { start: 3, end: 5, text: 'BC' },
    ])
    expect(novaCaretRectAtIndex(layout, 3)).toMatchObject({ x: 4, y: 22 })

    for (const index of [0, 1, 3, 4, 5]) {
      const caret = novaCaretRectAtIndex(layout, index)
      expect(novaTextIndexAtPoint(layout, caret.x, caret.y + 2)).toBe(index)
    }
  })

  it('переносит текст textarea по доступной ширине содержимого', () => {
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

  it('отменяет устаревшие результаты асинхронной проверки', async () => {
    let resolveFirst: (value: NovaInputValidationResult) => void = () => {}
    const validator = new NovaInputValidationController<string, string>((value) => {
      if (value === 'first') {
        return new Promise<NovaInputValidationResult>((resolve) => {
          resolveFirst = resolve
        })
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

  it('подключает буфер обмена через Clipboard API и proxy fallback', async () => {
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

  it('подключает скрытый proxy только для движков proxy и auto', () => {
    const canvasProxy = new NovaInputProxy_Adapter({ engine: 'canvas' })
    expect(canvasProxy.attach()).toBeNull()

    const autoProxy = new NovaInputProxy_Adapter({ engine: 'auto' })
    const element = autoProxy.attach()
    expect(element?.tagName).toBe('TEXTAREA')
    autoProxy.sync('abc', 1, 2)
    expect(element?.selectionStart).toBe(1)
    autoProxy.dispose()
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('использует единый планировщик мигания каретки для активных inputs', () => {
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

function createMeasuredText(widths: Record<string, number>) {
  return (text: string): number => splitGraphemes(text)
    .reduce((sum, segment) => sum + (widths[segment.value] ?? segment.value.length * 6), 0)
}
