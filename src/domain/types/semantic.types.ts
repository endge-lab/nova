import type { DataRect } from '@endge/utils'

export type NovaSemanticRole
  = | 'application'
    | 'region'
    | 'group'
    | 'button'
    | 'chart'
    | 'axis'
    | 'grid'
    | 'series'
    | 'mark'
    | 'legend'
    | 'tooltip'
    | 'viewport'
    | 'custom'

export interface NovaSemanticState {
  hovered?: boolean
  selected?: boolean
  focused?: boolean
  disabled?: boolean
  hidden?: boolean
  expanded?: boolean
  checked?: boolean
  muted?: boolean
  current?: boolean
  valueText?: string
}

export interface NovaSemanticSource {
  type?: 'node' | 'schema' | 'synthetic' | 'plugin' | 'custom'
  nodeId?: string
  componentId?: string
  part?: string
}

export interface NovaSemanticRegion {
  id: string
  role: NovaSemanticRole
  label?: string
  description?: string
  scope?: string
  bounds?: DataRect
  focusable?: boolean
  order: number
  state?: NovaSemanticState
  source?: NovaSemanticSource
  data?: Record<string, unknown>
}

export interface NovaSemanticRegisterOptions {
  id?: string
  role: NovaSemanticRole
  label?: string
  description?: string
  scope?: string
  bounds?: DataRect
  focusable?: boolean
  order?: number
  state?: NovaSemanticState
  source?: NovaSemanticSource
  data?: Record<string, unknown>
}

export interface NovaSemanticQueryOptions {
  id?: string
  scope?: string
  role?: NovaSemanticRole
  roles?: Array<NovaSemanticRole>
  focusable?: boolean
  includeHidden?: boolean
  includeDisabled?: boolean
  maxRegions?: number
}

export interface NovaSemanticSnapshotOptions extends NovaSemanticQueryOptions {
  includeData?: boolean
}

export interface NovaSemanticSnapshot {
  generatedAt: number
  regionCount: number
  focusedId?: string
  scope?: string
  regions: Array<NovaSemanticRegion>
}

export interface NovaSemanticSchemaItem extends Omit<NovaSemanticRegisterOptions, 'bounds'> {
  bounds?: DataRect
}
