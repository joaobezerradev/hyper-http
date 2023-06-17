import Redis from 'ioredis'

export interface RouteDefinition {
  path: string
  requestMethod: 'get' | 'post' | 'put' | 'patch' | 'delete'
  methodName: string
  params: string[]
}

export function Controller (path?: string): ClassDecorator {
  return (target) => {
    const normalizedPath = path || '' // Adiciona uma barra ("/") como padrão, caso nenhum caminho seja fornecido
    Reflect.defineMetadata('prefix', normalizedPath, target)
    if (!Reflect.hasMetadata('routes', target)) {
      Reflect.defineMetadata('routes', [], target)
    }
  }
}

function createMethodDecorator (method: RouteDefinition['requestMethod']): (path?: string) => MethodDecorator {
  return function (path = '/'): MethodDecorator {
    return (target, propertyKey) => {
      if (!Reflect.hasMetadata('routes', target.constructor)) {
        Reflect.defineMetadata('routes', [], target.constructor)
      }

      const routes = Reflect.getMetadata('routes', target.constructor) as RouteDefinition[]
      const prefix: string = Reflect.getMetadata('prefix', target.constructor) || ''

      const fullPath = `${prefix}/${path}`.replace(/\/\//g, '/')
      routes.push({
        requestMethod: method,
        path: fullPath,
        methodName: propertyKey.toString(),
        params: Reflect.getMetadata('design:paramtypes', target, propertyKey)
      })

      Reflect.defineMetadata('routes', routes, target.constructor)
    }
  }
}

export const Get = createMethodDecorator('get')
export const Post = createMethodDecorator('post')
export const Put = createMethodDecorator('put')
export const Delete = createMethodDecorator('delete')
export const Patch = createMethodDecorator('patch')

export function Body () {
  return function (target: Record<string, any>, propertyKey: string | symbol, parameterIndex: number) {
    const existingParameters: number[] = Reflect.getOwnMetadata('body', target, propertyKey) || []
    existingParameters.push(parameterIndex)
    Reflect.defineMetadata('body', existingParameters, target, propertyKey)
  }
}

export function Param (): any {
  return function (target: Record<string, any>, propertyKey: string | symbol, parameterIndex: number): void {
    const existingParameters: Array<{ index: number, name: string }> =
      Reflect.getOwnMetadata('params', target, propertyKey) || []
    existingParameters.push({ index: parameterIndex, name: '__allParams' })
    Reflect.defineMetadata('params', existingParameters, target, propertyKey)
  }
}

export function Headers (target: Record<string, any>, propertyKey: string | symbol, parameterIndex: number): void {
  const existingParameters: number[] = Reflect.getOwnMetadata('headers', target, propertyKey) || []
  existingParameters.push(parameterIndex)
  Reflect.defineMetadata('headers', existingParameters, target, propertyKey)
}

export function Query () {
  return function (target: Record<string, any>, propertyKey: string | symbol, parameterIndex: number): void {
    const existingParameters: Array<{ index: number, name: string }> =
      Reflect.getOwnMetadata('query', target, propertyKey) || []
    existingParameters.push({ index: parameterIndex, name: '__allQueryParams' })
    Reflect.defineMetadata('query', existingParameters, target, propertyKey)
  }
}

export const redis = new Redis()

export function Cache (TTL: number): any {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor): PropertyDescriptor {
    const originalMethod = descriptor.value

    descriptor.value = async function (...args: any[]) {
      const cacheKey = `${propertyKey}:${JSON.stringify(args)}`

      const cacheValue = await redis.get(cacheKey)
      if (cacheValue) {
        return JSON.parse(cacheValue)
      } else {
        const result = await originalMethod.apply(this, args)
        await redis.set(cacheKey, JSON.stringify(result), 'EX', TTL)
        return result
      }
    }

    Reflect.defineMetadata('cacheTtl', TTL, target, propertyKey)
    const cachedMethods = Reflect.getMetadata('cachedMethods', target.constructor) || []
    cachedMethods.push(propertyKey)
    Reflect.defineMetadata('cachedMethods', cachedMethods, target.constructor)

    return descriptor
  }
}

export function BearerAuth() {
  return function (target: Record<string, any>, propertyKey: string | symbol, parameterIndex: number): void {
    const existingParameters: Array<{ index: number, name: string }> =
      Reflect.getOwnMetadata('auth', target, propertyKey) || []
    existingParameters.push({ index: parameterIndex, name: '__allAuthParams' })
    Reflect.defineMetadata('auth', existingParameters, target, propertyKey)
  }
}