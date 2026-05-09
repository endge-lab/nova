import type {
  NovaInstructionBuffer,
  NovaRenderGroup,
  NovaRenderGroupId,
  NovaRenderLayerId,
} from '@/domain/types/rendering/index'
import {
  createCleanRenderDirtyFlags,
  createRenderVersions,
} from '@/model/rendering/policy/NovaRenderPolicy'

export interface CreateNovaRenderGroupOptions {
  id: NovaRenderGroupId
  layerId: NovaRenderLayerId
  ownerNodeId?: string
  parentGroupId?: NovaRenderGroupId
}

export function createNovaInstructionBuffer(id: string, version = 0): NovaInstructionBuffer {
  return {
    id,
    version,
    commands: [],
    items: [],
    reused: false,
  }
}

export function createNovaRenderGroup(options: CreateNovaRenderGroupOptions): NovaRenderGroup {
  return {
    id: options.id,
    ownerNodeId: options.ownerNodeId,
    parentGroupId: options.parentGroupId,
    layerId: options.layerId,
    opacity: 1,
    dirtyFlags: createCleanRenderDirtyFlags(),
    versions: createRenderVersions(),
    instructionBuffer: createNovaInstructionBuffer(`${options.id}:instructions`),
    renderHandlesByNodeId: new Map(),
    streams: new Map(),
    childGroupIds: [],
    visible: true,
    lastCompiledVersion: 0,
    lastRenderedVersion: 0,
  }
}
