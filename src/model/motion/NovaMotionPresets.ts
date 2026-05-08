import type { NovaMotionEngine } from '@/model/motion/NovaMotionEngine'
import type {
  NovaMotionOptions,
  NovaMotionPatch,
  NovaMotionPlayback,
  NovaMotionTarget,
  NovaMotionTimelineOptions,
  NovaMotionTweenOptions,
  NovaMotionValue,
} from '@/domain/types/motion-types'

export type NovaMotionPresetCategory =
  | 'Fade'
  | 'Slide'
  | 'Scale'
  | 'Rotate'
  | 'Attention'
  | 'Gesture'
  | 'Visual'

export type NovaMotionPatternCategory =
  | 'Stagger'
  | 'Timeline'
  | 'Sequence'
  | 'Repeat'

export interface NovaMotionPresetMeta {
  title: string
  category: NovaMotionPresetCategory
  description: string
  duration: number
}

export interface NovaMotionPatternMeta {
  title: string
  category: NovaMotionPatternCategory
  description: string
  duration: number
}

export interface NovaMotionPresetOptions extends NovaMotionOptions {
  distance?: number
  fill?: string
  stroke?: string
  strokeWidth?: number
}

export interface NovaMotionPatternOptions extends NovaMotionOptions {
  each?: number
  distance?: number
  columns?: number
  fill?: string
}

export const NOVA_MOTION_PRESETS = {
  fadeIn: {
    title: 'Fade In',
    category: 'Fade',
    description: 'Плавно проявляет элемент через opacity.',
    duration: 220,
  },
  fadeOut: {
    title: 'Fade Out',
    category: 'Fade',
    description: 'Плавно скрывает элемент через opacity.',
    duration: 220,
  },
  fadeUp: {
    title: 'Fade Up',
    category: 'Fade',
    description: 'Проявляет элемент со смещением вверх.',
    duration: 280,
  },
  fadeDown: {
    title: 'Fade Down',
    category: 'Fade',
    description: 'Проявляет элемент со смещением вниз.',
    duration: 280,
  },
  fadeLeft: {
    title: 'Fade Left',
    category: 'Fade',
    description: 'Проявляет элемент со смещением влево.',
    duration: 280,
  },
  fadeRight: {
    title: 'Fade Right',
    category: 'Fade',
    description: 'Проявляет элемент со смещением вправо.',
    duration: 280,
  },
  slideInLeft: {
    title: 'Slide In Left',
    category: 'Slide',
    description: 'Вводит элемент слева без изменения layout.',
    duration: 320,
  },
  slideInRight: {
    title: 'Slide In Right',
    category: 'Slide',
    description: 'Вводит элемент справа без изменения layout.',
    duration: 320,
  },
  slideInUp: {
    title: 'Slide In Up',
    category: 'Slide',
    description: 'Вводит элемент снизу вверх.',
    duration: 320,
  },
  slideInDown: {
    title: 'Slide In Down',
    category: 'Slide',
    description: 'Вводит элемент сверху вниз.',
    duration: 320,
  },
  scaleIn: {
    title: 'Scale In',
    category: 'Scale',
    description: 'Увеличивает элемент до базового размера.',
    duration: 260,
  },
  scaleOut: {
    title: 'Scale Out',
    category: 'Scale',
    description: 'Уменьшает элемент и скрывает его.',
    duration: 240,
  },
  zoomIn: {
    title: 'Zoom In',
    category: 'Scale',
    description: 'Быстро приближает элемент с проявлением.',
    duration: 280,
  },
  zoomOut: {
    title: 'Zoom Out',
    category: 'Scale',
    description: 'Отдаляет элемент и скрывает его.',
    duration: 240,
  },
  rotateIn: {
    title: 'Rotate In',
    category: 'Rotate',
    description: 'Проявляет элемент через небольшой поворот.',
    duration: 320,
  },
  spin: {
    title: 'Spin',
    category: 'Rotate',
    description: 'Поворачивает элемент на полный оборот.',
    duration: 640,
  },
  pulse: {
    title: 'Pulse',
    category: 'Attention',
    description: 'Дает мягкий импульс масштаба.',
    duration: 420,
  },
  heartbeat: {
    title: 'Heartbeat',
    category: 'Attention',
    description: 'Дает два коротких импульса масштаба.',
    duration: 560,
  },
  bounce: {
    title: 'Bounce',
    category: 'Attention',
    description: 'Подбрасывает элемент по оси y.',
    duration: 620,
  },
  shakeX: {
    title: 'Shake X',
    category: 'Attention',
    description: 'Качает элемент по горизонтали.',
    duration: 520,
  },
  shakeY: {
    title: 'Shake Y',
    category: 'Attention',
    description: 'Качает элемент по вертикали.',
    duration: 520,
  },
  wobble: {
    title: 'Wobble',
    category: 'Attention',
    description: 'Качает элемент смещением и поворотом.',
    duration: 620,
  },
  swing: {
    title: 'Swing',
    category: 'Attention',
    description: 'Раскачивает элемент вокруг базового угла.',
    duration: 620,
  },
  rubberBand: {
    title: 'Rubber Band',
    category: 'Attention',
    description: 'Сжимает и растягивает элемент по двум осям.',
    duration: 620,
  },
  press: {
    title: 'Press',
    category: 'Gesture',
    description: 'Имитирует короткий отклик на нажатие.',
    duration: 180,
  },
  hoverLift: {
    title: 'Hover Lift',
    category: 'Gesture',
    description: 'Слегка приподнимает элемент вверх.',
    duration: 180,
  },
  highlight: {
    title: 'Highlight',
    category: 'Visual',
    description: 'Подсвечивает заливку и возвращает исходный цвет.',
    duration: 520,
  },
  borderPulse: {
    title: 'Border Pulse',
    category: 'Visual',
    description: 'Усиливает обводку и возвращает исходное состояние.',
    duration: 520,
  },
} as const satisfies Record<string, NovaMotionPresetMeta>

export const NOVA_MOTION_PATTERNS = {
  staggerFade: {
    title: 'Stagger Fade',
    category: 'Stagger',
    description: 'Проявляет группу с задержкой по индексу.',
    duration: 520,
  },
  staggerRise: {
    title: 'Stagger Rise',
    category: 'Stagger',
    description: 'Поднимает группу с задержкой по индексу.',
    duration: 560,
  },
  staggerScale: {
    title: 'Stagger Scale',
    category: 'Stagger',
    description: 'Увеличивает группу с задержкой по индексу.',
    duration: 520,
  },
  timelineWave: {
    title: 'Timeline Wave',
    category: 'Timeline',
    description: 'Запускает волну масштаба по группе targets.',
    duration: 720,
  },
  cascade: {
    title: 'Cascade',
    category: 'Timeline',
    description: 'Вводит элементы каскадом слева направо.',
    duration: 640,
  },
  sequenceChain: {
    title: 'Sequence Chain',
    category: 'Sequence',
    description: 'Последовательно проявляет элементы через sequence.',
    duration: 720,
  },
  repeatYoyo: {
    title: 'Repeat Yoyo',
    category: 'Repeat',
    description: 'Повторяет движение вперед и назад.',
    duration: 620,
  },
  gridWave: {
    title: 'Grid Wave',
    category: 'Stagger',
    description: 'Запускает волну по сетке с учетом строки и колонки.',
    duration: 760,
  },
} as const satisfies Record<string, NovaMotionPatternMeta>

export type NovaMotionPresetName = keyof typeof NOVA_MOTION_PRESETS
export type NovaMotionPatternName = keyof typeof NOVA_MOTION_PATTERNS

type PresetRunner = (
  engine: NovaMotionEngine,
  target: NovaMotionTarget,
  options?: NovaMotionPresetOptions,
) => NovaMotionPlayback

type PatternRunner = (
  engine: NovaMotionEngine,
  targets: NovaMotionTarget[],
  options?: NovaMotionPatternOptions,
) => NovaMotionPlayback

export function runNovaMotionPreset(
  engine: NovaMotionEngine,
  target: NovaMotionTarget,
  name: NovaMotionPresetName,
  options: NovaMotionPresetOptions = {},
): NovaMotionPlayback {
  return PRESET_RUNNERS[name](engine, target, options)
}

export function runNovaMotionPattern(
  engine: NovaMotionEngine,
  targets: NovaMotionTarget[],
  name: NovaMotionPatternName,
  options: NovaMotionPatternOptions = {},
): NovaMotionPlayback {
  return PATTERN_RUNNERS[name](engine, targets, options)
}

const PRESET_RUNNERS: Record<NovaMotionPresetName, PresetRunner> = {
  fadeIn: (engine, target, options) => engine.to(
    target,
    { opacity: 1 },
    tweenOptions('fadeIn', options, { from: { opacity: 0 }, easing: 'outCubic' }),
  ),

  fadeOut: (engine, target, options) => engine.to(
    target,
    { opacity: 0 },
    tweenOptions('fadeOut', options, { from: { opacity: 1 }, easing: 'outCubic' }),
  ),

  fadeUp: (engine, target, options) => fromOffset(engine, target, 'fadeUp', options, { y: distance(options), opacity: 0 }, { y: 0, opacity: 1 }),
  fadeDown: (engine, target, options) => fromOffset(engine, target, 'fadeDown', options, { y: -distance(options), opacity: 0 }, { y: 0, opacity: 1 }),
  fadeLeft: (engine, target, options) => fromOffset(engine, target, 'fadeLeft', options, { x: distance(options), opacity: 0 }, { x: 0, opacity: 1 }),
  fadeRight: (engine, target, options) => fromOffset(engine, target, 'fadeRight', options, { x: -distance(options), opacity: 0 }, { x: 0, opacity: 1 }),

  slideInLeft: (engine, target, options) => fromOffset(engine, target, 'slideInLeft', options, { x: -distance(options) }, { x: 0 }),
  slideInRight: (engine, target, options) => fromOffset(engine, target, 'slideInRight', options, { x: distance(options) }, { x: 0 }),
  slideInUp: (engine, target, options) => fromOffset(engine, target, 'slideInUp', options, { y: distance(options) }, { y: 0 }),
  slideInDown: (engine, target, options) => fromOffset(engine, target, 'slideInDown', options, { y: -distance(options) }, { y: 0 }),

  scaleIn: (engine, target, options) => scaleTween(engine, target, 'scaleIn', options, 0.72, 1, 0, 1),
  scaleOut: (engine, target, options) => scaleTween(engine, target, 'scaleOut', options, 1, 0.72, 1, 0),
  zoomIn: (engine, target, options) => scaleTween(engine, target, 'zoomIn', options, 0.42, 1, 0, 1),
  zoomOut: (engine, target, options) => scaleTween(engine, target, 'zoomOut', options, 1, 0.42, 1, 0),

  rotateIn: (engine, target, options) => {
    const rotation = numberValue(target, 'rotation')
    return engine.to(target, { rotation, opacity: 1 }, tweenOptions('rotateIn', options, {
      from: { rotation: rotation - 0.55, opacity: 0 },
      easing: 'outCubic',
    }))
  },

  spin: (engine, target, options) => {
    const rotation = numberValue(target, 'rotation')
    return engine.to(target, { rotation: rotation + Math.PI * 2 }, tweenOptions('spin', options, {
      from: { rotation },
      easing: 'linear',
    }))
  },

  pulse: (engine, target, options) => scaleKeyframes(engine, target, 'pulse', options, [
    [0, 1, 1],
    [0.5, 1.08, 1.08],
    [1, 1, 1],
  ]),

  heartbeat: (engine, target, options) => scaleKeyframes(engine, target, 'heartbeat', options, [
    [0, 1, 1],
    [0.2, 1.16, 1.16],
    [0.36, 1, 1],
    [0.56, 1.1, 1.1],
    [1, 1, 1],
  ]),

  bounce: (engine, target, options) => {
    const y = numberValue(target, 'y')
    const d = distance(options, 22)
    return timeline(engine, 'bounce', options, [{ target, keyframes: [
      { y },
      { at: at('bounce', options, 0.22), y: y - d },
      { at: at('bounce', options, 0.48), y },
      { at: at('bounce', options, 0.68), y: y - d * 0.55 },
      { at: at('bounce', options, 1), y },
    ] }])
  },

  shakeX: (engine, target, options) => shake(engine, target, 'shakeX', options, 'x'),
  shakeY: (engine, target, options) => shake(engine, target, 'shakeY', options, 'y'),

  wobble: (engine, target, options) => {
    const x = numberValue(target, 'x')
    const rotation = numberValue(target, 'rotation')
    const d = distance(options, 12)
    return timeline(engine, 'wobble', options, [{ target, keyframes: [
      { x, rotation },
      { at: at('wobble', options, 0.18), x: x - d, rotation: rotation - 0.12 },
      { at: at('wobble', options, 0.36), x: x + d * 0.8, rotation: rotation + 0.1 },
      { at: at('wobble', options, 0.58), x: x - d * 0.45, rotation: rotation - 0.07 },
      { at: at('wobble', options, 0.78), x: x + d * 0.25, rotation: rotation + 0.04 },
      { at: at('wobble', options, 1), x, rotation },
    ] }])
  },

  swing: (engine, target, options) => {
    const rotation = numberValue(target, 'rotation')
    return timeline(engine, 'swing', options, [{ target, keyframes: [
      { rotation },
      { at: at('swing', options, 0.2), rotation: rotation + 0.22 },
      { at: at('swing', options, 0.42), rotation: rotation - 0.18 },
      { at: at('swing', options, 0.64), rotation: rotation + 0.1 },
      { at: at('swing', options, 0.82), rotation: rotation - 0.05 },
      { at: at('swing', options, 1), rotation },
    ] }])
  },

  rubberBand: (engine, target, options) => scaleKeyframes(engine, target, 'rubberBand', options, [
    [0, 1, 1],
    [0.25, 1.22, 0.82],
    [0.42, 0.86, 1.14],
    [0.62, 1.08, 0.94],
    [0.82, 0.98, 1.02],
    [1, 1, 1],
  ]),

  press: (engine, target, options) => scaleKeyframes(engine, target, 'press', options, [
    [0, 1, 1],
    [0.45, 0.94, 0.94],
    [1, 1, 1],
  ]),

  hoverLift: (engine, target, options) => {
    const y = numberValue(target, 'y')
    return engine.to(target, { y: y - distance(options, 6) }, tweenOptions('hoverLift', options, {
      from: { y },
      easing: 'outCubic',
    }))
  },

  highlight: (engine, target, options) => {
    const fill = stringValue(target, 'fill', '#ffffff')
    const accent = options?.fill ?? '#fff2a8'
    return timeline(engine, 'highlight', options, [{ target, keyframes: [
      { fill },
      { at: at('highlight', options, 0.45), fill: accent },
      { at: at('highlight', options, 1), fill },
    ] }])
  },

  borderPulse: (engine, target, options) => {
    const stroke = stringValue(target, 'stroke', '#d6d9e2')
    const strokeWidth = numberValue(target, 'strokeWidth', 1)
    return timeline(engine, 'borderPulse', options, [{ target, keyframes: [
      { stroke, strokeWidth },
      { at: at('borderPulse', options, 0.45), stroke: options?.stroke ?? '#4f7cff', strokeWidth: options?.strokeWidth ?? strokeWidth + 2 },
      { at: at('borderPulse', options, 1), stroke, strokeWidth },
    ] }])
  },
}

const PATTERN_RUNNERS: Record<NovaMotionPatternName, PatternRunner> = {
  staggerFade: (engine, targets, options) => {
    setTargets(targets, { opacity: 0 })
    return engine.timeline({
      ...timelineOptions('staggerFade', options, { easing: 'outCubic' }),
      stagger: {
        targets,
        each: each(options),
        duration: duration('staggerFade', options),
        patch: { opacity: 1 },
        easing: options?.easing ?? 'outCubic',
      },
    })
  },

  staggerRise: (engine, targets, options) => {
    const d = distance(options, 18)
    setTargets(targets, { opacity: 0 })
    return timeline(engine, 'staggerRise', options, targets.map((target, index) => {
      const y = numberValue(target, 'y')
      return {
        target,
        at: index * each(options),
        keyframes: [{ y: y + d, opacity: 0 }, { at: duration('staggerRise', options), y, opacity: 1 }],
      }
    }))
  },

  staggerScale: (engine, targets, options) => {
    setTargets(targets, { opacity: 0, scaleX: 0.68, scaleY: 0.68 })
    return engine.timeline({
      ...timelineOptions('staggerScale', options, { easing: 'outCubic' }),
      stagger: {
        targets,
        each: each(options),
        duration: duration('staggerScale', options),
        patch: { opacity: 1, scaleX: 1, scaleY: 1 },
        easing: options?.easing ?? 'outCubic',
      },
    })
  },

  timelineWave: (engine, targets, options) => timeline(engine, 'timelineWave', options, targets.map((target, index) => ({
    target,
    at: index * each(options, 35),
    keyframes: [
      { scaleX: 1, scaleY: 1 },
      { at: duration('timelineWave', options) * 0.45, scaleX: 1.18, scaleY: 1.18 },
      { at: duration('timelineWave', options), scaleX: 1, scaleY: 1 },
    ],
  }))),

  cascade: (engine, targets, options) => {
    const d = distance(options, 28)
    setTargets(targets, { opacity: 0 })
    return timeline(engine, 'cascade', options, targets.map((target, index) => {
      const x = numberValue(target, 'x')
      return {
        target,
        at: index * each(options, 42),
        keyframes: [{ x: x - d, opacity: 0 }, { at: duration('cascade', options), x, opacity: 1 }],
      }
    }))
  },

  sequenceChain: (engine, targets, options) => {
    setTargets(targets, { opacity: 0 })
    return engine.timeline({
      ...timelineOptions('sequenceChain', options, { easing: 'outCubic' }),
      sequence: targets.map(target => ({
        target,
        patch: { opacity: 1, scaleX: 1, scaleY: 1 },
        duration: Math.max(80, duration('sequenceChain', options) / Math.max(1, targets.length)),
        delay: each(options, 18),
        easing: options?.easing ?? 'outCubic',
      })),
    })
  },

  repeatYoyo: (engine, targets, options) => {
    const d = distance(options, 18)
    return timeline(engine, 'repeatYoyo', { repeat: 1, yoyo: true, ...options }, targets.map(target => {
      const x = numberValue(target, 'x')
      return {
        target,
        keyframes: [{ x }, { at: duration('repeatYoyo', options), x: x + d }],
      }
    }))
  },

  gridWave: (engine, targets, options) => {
    const columns = options?.columns ?? Math.max(1, Math.ceil(Math.sqrt(targets.length)))
    return timeline(engine, 'gridWave', options, targets.map((target, index) => {
      const col = index % columns
      const row = Math.floor(index / columns)
      return {
        target,
        at: (row + col) * each(options, 22),
        keyframes: [
          { opacity: 0.45, scaleX: 0.78, scaleY: 0.78 },
          { at: duration('gridWave', options) * 0.42, opacity: 1, scaleX: 1.1, scaleY: 1.1 },
          { at: duration('gridWave', options), opacity: 0.82, scaleX: 1, scaleY: 1 },
        ],
      }
    }))
  },
}

function fromOffset(
  engine: NovaMotionEngine,
  target: NovaMotionTarget,
  name: NovaMotionPresetName,
  options: NovaMotionPresetOptions | undefined,
  fromOffsetPatch: Record<string, number>,
  toOffsetPatch: Record<string, number>,
): NovaMotionPlayback {
  const from: NovaMotionPatch = {}
  const to: NovaMotionPatch = {}

  for (const [key, offset] of Object.entries(fromOffsetPatch)) {
    from[key] = key === 'opacity' ? offset : numberValue(target, key) + offset
  }

  for (const [key, offset] of Object.entries(toOffsetPatch)) {
    to[key] = key === 'opacity' ? offset : numberValue(target, key) + offset
  }

  return engine.to(target, to, tweenOptions(name, options, { from, easing: 'outCubic' }))
}

function scaleTween(
  engine: NovaMotionEngine,
  target: NovaMotionTarget,
  name: NovaMotionPresetName,
  options: NovaMotionPresetOptions | undefined,
  fromScale: number,
  toScale: number,
  fromOpacity: number,
  toOpacity: number,
): NovaMotionPlayback {
  return engine.to(
    target,
    { scaleX: toScale, scaleY: toScale, opacity: toOpacity },
    tweenOptions(name, options, {
      from: { scaleX: fromScale, scaleY: fromScale, opacity: fromOpacity },
      easing: 'outCubic',
    }),
  )
}

function scaleKeyframes(
  engine: NovaMotionEngine,
  target: NovaMotionTarget,
  name: NovaMotionPresetName,
  options: NovaMotionPresetOptions | undefined,
  keyframes: Array<[number, number, number]>,
): NovaMotionPlayback {
  return timeline(engine, name, options, [{
    target,
    keyframes: keyframes.map(([progress, scaleX, scaleY]) => ({
      at: at(name, options, progress),
      scaleX,
      scaleY,
    })),
  }])
}

function shake(
  engine: NovaMotionEngine,
  target: NovaMotionTarget,
  name: 'shakeX' | 'shakeY',
  options: NovaMotionPresetOptions | undefined,
  axis: 'x' | 'y',
): NovaMotionPlayback {
  const value = numberValue(target, axis)
  const d = distance(options, 10)
  return timeline(engine, name, options, [{ target, keyframes: [
    { [axis]: value },
    { at: at(name, options, 0.16), [axis]: value - d },
    { at: at(name, options, 0.32), [axis]: value + d },
    { at: at(name, options, 0.48), [axis]: value - d * 0.72 },
    { at: at(name, options, 0.64), [axis]: value + d * 0.72 },
    { at: at(name, options, 0.82), [axis]: value - d * 0.36 },
    { at: at(name, options, 1), [axis]: value },
  ] }])
}

function timeline(
  engine: NovaMotionEngine,
  name: NovaMotionPresetName | NovaMotionPatternName,
  options: NovaMotionPresetOptions | NovaMotionPatternOptions | undefined,
  tracks: NonNullable<NovaMotionTimelineOptions['tracks']>,
): NovaMotionPlayback {
  return engine.timeline({
    ...timelineOptions(name, options, { easing: 'inOutCubic' }),
    tracks: tracks.map(track => ({
      ...track,
      at: (track.at ?? 0) + (options?.delay ?? 0),
    })),
  })
}

function tweenOptions(
  name: NovaMotionPresetName,
  options: NovaMotionPresetOptions | undefined,
  defaults: Partial<NovaMotionTweenOptions>,
): NovaMotionTweenOptions {
  return {
    duration: duration(name, options),
    easing: 'outCubic',
    ...defaults,
    ...options,
  }
}

function timelineOptions(
  name: NovaMotionPresetName | NovaMotionPatternName,
  options: NovaMotionPresetOptions | NovaMotionPatternOptions | undefined,
  defaults: Partial<NovaMotionTimelineOptions>,
): NovaMotionTimelineOptions {
  return {
    duration: duration(name, options),
    easing: 'inOutCubic',
    ...defaults,
    ...options,
  }
}

function duration(
  name: NovaMotionPresetName | NovaMotionPatternName,
  options?: NovaMotionPresetOptions | NovaMotionPatternOptions,
): number {
  const meta = name in NOVA_MOTION_PRESETS
    ? NOVA_MOTION_PRESETS[name as NovaMotionPresetName]
    : NOVA_MOTION_PATTERNS[name as NovaMotionPatternName]
  return Math.max(0, options?.duration ?? meta.duration)
}

function at(
  name: NovaMotionPresetName | NovaMotionPatternName,
  options: NovaMotionPresetOptions | NovaMotionPatternOptions | undefined,
  progress: number,
): number {
  return duration(name, options) * progress
}

function distance(options?: NovaMotionPresetOptions | NovaMotionPatternOptions, fallback = 24): number {
  return options?.distance ?? fallback
}

function each(options?: NovaMotionPatternOptions, fallback = 28): number {
  return options?.each ?? fallback
}

function numberValue(target: NovaMotionTarget, key: string, fallback = 0): number {
  const value = readValue(target, key)
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function stringValue(target: NovaMotionTarget, key: string, fallback: string): string {
  const value = readValue(target, key)
  return typeof value === 'string' ? value : fallback
}

function readValue(target: NovaMotionTarget, key: string): NovaMotionValue {
  if (key in target) return (target as any)[key]
  if (typeof (target as any).getProps === 'function') return (target as any).getProps()[key]
  if (typeof (target as any).get === 'function') return (target as any).get(key)
  return undefined
}

function setTargets(targets: NovaMotionTarget[], patch: NovaMotionPatch): void {
  for (const target of targets) {
    for (const [key, value] of Object.entries(patch)) {
      if (key in target) {
        ;(target as any)[key] = value
      } else if (typeof (target as any).setProps === 'function') {
        ;(target as any).setProps({ [key]: value })
      } else if (typeof (target as any).options === 'function') {
        ;(target as any).options({ [key]: value })
      }
    }
    ;(target as any).dirty?.({ matrix: true, render: true })
  }
}
