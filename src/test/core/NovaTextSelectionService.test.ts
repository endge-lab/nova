import { describe, expect, it } from 'vitest'
import { NovaTextSelectionService } from '@/model/text-selection/NovaTextSelectionService'

describe('NovaTextSelectionService', () => {
  it('selects text inside one target by pointer range', () => {
    const service = new NovaTextSelectionService({
      enabled: true,
      mode: 'all-text',
      copy: true,
      drag: true,
      doubleClick: 'word',
      tripleClick: 'line',
      granularity: 'text',
      clipboard: 'plain',
      selectionColor: 'rgba(37, 99, 235, 0.24)',
    })
    service.beginFrame()
    service.register({
      id: 'cell:name',
      text: 'Flight FV6535/17',
      rect: { x: 0, y: 0, width: 160, height: 24 },
    })

    expect(service.start(0, 12)).toBe(true)
    expect(service.update(64, 12)).toBe(true)
    service.end()

    expect(service.getSelectedText()).toBe('Flight')
  })

  it('builds multi-target copy text through formatter', () => {
    const service = new NovaTextSelectionService<{ rowIndex: number; columnIndex: number }>({
      enabled: true,
      mode: 'all-text',
      copy: true,
      drag: true,
      doubleClick: 'word',
      tripleClick: 'line',
      granularity: 'text',
      clipboard: 'contextual',
      selectionColor: 'rgba(37, 99, 235, 0.24)',
    })
    service.beginFrame()
    service.register({
      id: 'r1:c1',
      text: 'A1',
      rect: { x: 0, y: 0, width: 20, height: 20 },
      context: { rowIndex: 0, columnIndex: 0 },
      order: 0,
    })
    service.register({
      id: 'r1:c2',
      text: 'B1',
      rect: { x: 22, y: 0, width: 20, height: 20 },
      context: { rowIndex: 0, columnIndex: 1 },
      order: 1,
    })

    service.start(0, 10)
    service.update(42, 10)

    expect(service.getSelectedText(ranges => ranges.map(range => range.target.text).join('\t'))).toBe('A1\tB1')
  })
})
