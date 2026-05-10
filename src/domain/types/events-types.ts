export const NodeEventNames = {
  click: 'click',
  dblclick: 'dblclick',
  contextmenu: 'contextmenu',
  mousemove: 'mousemove',
  mousedown: 'mousedown',
  mouseup: 'mouseup',
  canvasenter: 'canvasenter',
  canvasleave: 'canvasleave',
  wheel: 'wheel',
  keydown: 'keydown',
  keyup: 'keyup',
  focus: 'focus',
  blur: 'blur',
  select: 'select',
  deselect: 'deselect',
  gotpointercapture: 'gotpointercapture',
  lostpointercapture: 'lostpointercapture',

  mouseenter: 'mouseenter',
  mouseleave: 'mouseleave',
  doubleClick: 'dblclick',
  zoom: 'zoom',
  dragStart: 'mousedown',
  dragEnd: 'mouseup',
  dragMove: 'mousemove',
} as const

/**
 * Описывает тип NodeEventName.
 */
export type NodeEventName = keyof typeof NodeEventNames
/**
 * Описывает тип DomEventName.
 */
export type DomEventName =
  | 'click'
  | 'dblclick'
  | 'contextmenu'
  | 'mousemove'
  | 'mousedown'
  | 'mouseup'
  | 'wheel'
  | 'zoom'
  | 'keydown'
  | 'keyup'
  | 'mouseenter'
  | 'mouseleave'

export const CanvasDomEvents: DomEventName[] = [
  'click',
  'contextmenu',
  'mousemove',
  'mousedown',
  'mouseenter',
  'mouseleave',
  'mouseup',
  'wheel',
  'zoom',
  'keydown',
  'keyup',
]

// Базовые DOM-обработчики
/**
 * Описывает контракт CanvasEventHandlers.
 */
export interface CanvasEventHandlers {
  click?: (e: MouseEvent) => void
  dblclick?: (e: MouseEvent) => void
  contextmenu?: (e: MouseEvent) => void
  mousemove?: (e: MouseEvent) => void
  mousedown?: (e: MouseEvent) => void
  mouseup?: (e: MouseEvent) => void
  wheel?: (e: WheelEvent) => void
  keydown?: (e: KeyboardEvent) => void
  keyup?: (e: KeyboardEvent) => void
}

// Расширенные события для NovaNode
/**
 * Описывает контракт NovaNodeEventHandlers.
 */
export interface NovaNodeEventHandlers extends CanvasEventHandlers {
  mouseenter?: (e: MouseEvent) => void
  mouseleave?: (e: MouseEvent) => void
  canvasenter?: (e: MouseEvent) => void
  canvasleave?: (e: MouseEvent) => void
  focus?: (e: Event) => void
  blur?: (e: Event) => void
  select?: (e: Event) => void
  deselect?: (e: Event) => void
  gotpointercapture?: (e: MouseEvent) => void
  lostpointercapture?: (e: MouseEvent) => void

  zoom?: (e: WheelEvent) => void
  hover?: (e: MouseEvent, isHover: boolean) => void
  dragstart?: (e: MouseEvent, meta: NovaDragEventMeta) => void
  dragend?: (e: MouseEvent, meta: NovaDragEventMeta) => void
  dragcancel?: (e: MouseEvent, meta: NovaDragEventMeta) => void
  dragmove?: (e: MouseEvent, dx: number, dy: number, meta: NovaDragEventMeta) => void
}

/**
 * Описывает контракт NovaDragEventMeta.
 */
export interface NovaDragEventMeta {
  pointerId: number
  startX: number
  startY: number
  x: number
  y: number
  dx: number
  dy: number
  totalDx: number
  totalDy: number
}
