import type { EventList } from '@endge/utils'
import type { NovaElementConstructor } from '@/domain/types/component.types'
import {
  defineNovaComponent,
  type NovaDefinedComponentOptions,
} from '@/model/runtime/components/nova-defined-component'
import {
  addNovaApiMetadata,
  addNovaCommandMetadata,
  addNovaPropMetadata,
  addNovaWatchMetadata,
  installNovaPropAccessors,
  updateNovaDecoratedComponent,
  type NovaDecoratedComponentOptions,
  type NovaPropDecoratorOptions,
  type NovaWatchDecoratorOptions,
} from '@/model/runtime/components/nova-component-metadata'

/**
 * Помечает class-компонент metadata для DSL и явной registry-регистрации.
 */
export function NovaComponent<E extends EventList = Record<string, any>>(
  options: (NovaDefinedComponentOptions<E> & NovaDecoratedComponentOptions) = {},
) {
  return <T extends new (...args: Array<any>) => any>(target: T): T => {
    updateNovaDecoratedComponent(target, {
      type: options.type,
      tag: options.tag,
      name: options.name,
      version: options.version,
      dirtyPolicy: options.dirtyPolicy,
      bounds: options.bounds,
    })
    installNovaPropAccessors(target)
    return defineNovaComponent(target as unknown as NovaElementConstructor<E>, options) as unknown as T
  }
}

/**
 * Описывает набор prop-декораторов Nova.
 */
export const Prop = {
  model: createPropDecorator('model'),
  object: createPropDecorator('object'),
  options: createPropDecorator('options'),
  array: createPropDecorator('array'),
  string: createPropDecorator('string'),
  number: createPropDecorator('number'),
  boolean: createPropDecorator('boolean'),
  function: createPropDecorator('function'),
}

/**
 * Помечает callback prop как event.
 */
export function Event(options: NovaPropDecoratorOptions = {}) {
  return (target: object, propertyKey: string | symbol, _descriptor?: PropertyDescriptor): void => {
    addNovaPropMetadata(target, propertyKey, 'function', options, true)
  }
}

/**
 * Регистрирует watcher prop/path.
 */
export function Watch(path: string, options: NovaWatchDecoratorOptions = {}) {
  return (target: object, propertyKey: string | symbol, _descriptor?: PropertyDescriptor): void => {
    addNovaWatchMetadata(target, propertyKey, path, options)
  }
}

/**
 * Регистрирует command handler.
 */
export function Command(id: string, options: { scope?: string } = {}) {
  return (target: object, propertyKey: string | symbol, _descriptor?: PropertyDescriptor): void => {
    addNovaCommandMetadata(target, propertyKey, id, options)
  }
}

/**
 * Помечает метод как часть public API.
 */
export function Api() {
  return (target: object, propertyKey: string | symbol, _descriptor?: PropertyDescriptor): void => {
    addNovaApiMetadata(target, propertyKey)
  }
}

/**
 * Создает prop-декоратор указанного типа.
 */
function createPropDecorator(kind: Parameters<typeof addNovaPropMetadata>[2]) {
  return <T = unknown>(options: NovaPropDecoratorOptions<T> = {}) => {
    return (target: object, propertyKey: string | symbol, _descriptor?: PropertyDescriptor): void => {
      addNovaPropMetadata(target, propertyKey, kind, options)
    }
  }
}
