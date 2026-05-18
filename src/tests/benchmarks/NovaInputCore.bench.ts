import { bench, describe } from 'vitest'
import {
  NovaTextInputController,
  layoutNovaTextInput,
  novaSelectionRects,
  novaTextIndexAtPoint,
} from '@/index'

describe('Nova input core benchmarks', () => {
  bench('10k random single-line edits', () => {
    const controller = new NovaTextInputController({ value: '' })
    for (let index = 0; index < 10_000; index += 1) {
      controller.insertText(String(index % 10))
      if (index % 7 === 0) controller.deleteBackward()
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
})
