import { describe, expect, it } from 'vitest'
import { interpolateNovaMotionValue } from '@/model/motion/NovaMotionInterpolation'

describe('NovaMotionInterpolation', () => {
  it('interpolates numbers', () => {
    expect(interpolateNovaMotionValue(10, 30, 0.5)).toBe(20)
  })

  it('interpolates hex and rgb colors', () => {
    expect(interpolateNovaMotionValue('#000000', '#ffffff', 0.5)).toBe('rgb(128, 128, 128)')
    expect(interpolateNovaMotionValue('rgba(0, 0, 0, 0.5)', 'rgba(100, 50, 0, 1)', 0.5)).toBe('rgba(50, 25, 0, 0.75)')
  })

  it('switches discrete values at the end of a segment', () => {
    expect(interpolateNovaMotionValue(false, true, 0.99)).toBe(false)
    expect(interpolateNovaMotionValue(false, true, 1)).toBe(true)
  })
})
