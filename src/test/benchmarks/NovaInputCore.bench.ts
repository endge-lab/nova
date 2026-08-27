import { bench, describe } from 'vitest'
import {
  layoutNovaTextInput,
  novaCaretRectAtIndex,
  novaSelectionRects,
  novaTextIndexAtPoint,
  NovaTextInputController,
  splitGraphemes,
} from '@/index'

describe('nova input core benchmarks', () => {
  bench('10k random single-line edits', () => {
    const controller = new NovaTextInputController({ value: '' })
    for (let index = 0; index < 10_000; index += 1) {
      controller.insertText(String(index % 10))
      if (index % 7 === 0) {
        controller.deleteBackward()
      }
    }
  })

  bench('10k grapheme caret moves', () => {
    const controller = new NovaTextInputController({ value: 'A🙂B🚀C'.repeat(500) })
    for (let index = 0; index < 10_000; index += 1) {
      controller.moveCaret(index % 2 ? 'left' : 'right')
    }
  })

  bench('layout 1k short inputs', () => {
    for (let index = 0; index < 1_000; index += 1) {
      layoutNovaTextInput({
        text: `Input ${index}`,
        width: 220,
        height: 36,
        fontSize: 13,
        lineHeight: 18,
        padding: 10,
      })
    }
  })

  bench('layout 1k measured proportional centered inputs', () => {
    const measureText = createMeasuredText({ 'W': 12, 'i': 3, '.': 4, 'm': 11, ' ': 4 })
    for (let index = 0; index < 1_000; index += 1) {
      layoutNovaTextInput({
        text: `Wi. mixed ${index}`,
        width: 260,
        height: 36,
        align: 'center',
        fontSize: 13,
        lineHeight: 18,
        padding: 10,
        measureText,
      })
    }
  })

  bench('textarea layout and selection rects', () => {
    const text = Array.from({ length: 1_000 }, (_item, index) => `Line ${index} with value ${index}`).join('\n')
    const layout = layoutNovaTextInput({
      text,
      width: 420,
      height: 160,
      multiline: true,
      wrap: true,
      fontSize: 13,
      lineHeight: 18,
      padding: 10,
    })
    novaSelectionRects(layout, 50, text.length - 50)
  })

  bench('100k coordinate hit-tests', () => {
    const layout = layoutNovaTextInput({
      text: 'Hit testing input text'.repeat(20),
      width: 420,
      height: 80,
      multiline: true,
      wrap: true,
      fontSize: 13,
      lineHeight: 18,
      padding: 10,
    })
    for (let index = 0; index < 100_000; index += 1) {
      novaTextIndexAtPoint(layout, index % 420, index % 80)
    }
  })

  bench('100k measured caret/index roundtrips', () => {
    const layout = layoutNovaTextInput({
      text: 'Wide iii narrow ... emoji 🙂 text '.repeat(20),
      width: 420,
      height: 160,
      multiline: true,
      wrap: true,
      align: 'center',
      fontSize: 13,
      lineHeight: 18,
      padding: 10,
      measureText: createMeasuredText({ 'W': 12, 'i': 3, '.': 4, ' ': 4, '🙂': 14 }),
    })
    for (let index = 0; index < 100_000; index += 1) {
      const caret = novaCaretRectAtIndex(layout, index % layout.text.length)
      novaTextIndexAtPoint(layout, caret.x, caret.y + 2)
    }
  })
})

function createMeasuredText(widths: Record<string, number>) {
  return (text: string): number => splitGraphemes(text)
    .reduce((sum, segment) => sum + (widths[segment.value] ?? segment.value.length * 7), 0)
}
