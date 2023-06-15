import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { URL } from 'url'
import { parse as parseQuery } from 'node:querystring'
import 'reflect-metadata'
import cluster from 'node:cluster'
import * as os from 'node:os'
import { redis, type RouteDefinition } from './decorators'

export class HyperRequest {
  private readonly controllers: any[] = []

  listen (port: number, callback?: () => void): void {
    const numCPUs = os.cpus().length

    if (cluster.isPrimary) {
      for (let i = 0; i < numCPUs; i++) {
        cluster.fork()
      }

      cluster.on('exit', () => {
        cluster.fork()
      })

      callback?.()
    } else {
      createServer(async (req, res) => { await this.handleRequest(req, res) }).listen(port)
    }
  }

  public addController (controller: any): void {
    this.controllers.push(controller)
  }

  private async handleRequest (req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url || '', 'http://localhost')
      const path = url.pathname

      for (const Controller of this.controllers) {
        const prefix = Reflect.getMetadata('prefix', Controller) as string
        const routes: RouteDefinition[] = Reflect.getMetadata('routes', Controller)
        const cachedMethods: string[] = Reflect.getMetadata('cachedMethods', Controller) || []

        for (const route of routes) {
          const fullPath = `/${prefix}/${route.path}`.replace(/\/\//g, '/')
          if (req.method?.toLowerCase() === route.requestMethod && path === fullPath) {
            const params = await this.extractParams(req, fullPath)
            if (params?.params) {
              const instance = new Controller()
              const cacheKey = `${fullPath}:${JSON.stringify(params.params)}`
              if (cachedMethods.includes(route.methodName)) {
                const TTL: number = Reflect.getMetadata('cacheTtl', instance, route.methodName)
                const cachedResult = await redis.get(cacheKey)
                if (cachedResult) {
                  res.setHeader('X-Cache', 'HIT')
                  res.setHeader('Cache-Control', `public, max-age=${TTL}`)
                  res.setHeader('Content-Type', 'application/json')
                  res.end(cachedResult)
                  return
                } else {
                  const result = await instance[route.methodName](...Object.values(params))
                  await redis.set(cacheKey, JSON.stringify(result), 'EX', TTL)
                  res.setHeader('Content-Type', 'application/json')
                  res.end(JSON.stringify(result))
                  return
                }
              }

              const result = await instance[route.methodName](...Object.values(params))
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify(result))
              return
            }
          }
        }
      }
      this.notFound(res)
    } catch (error) {
      console.error('Error:', error)
      this.internalServerError(res)
    }
  }

  private async extractParams (req: IncomingMessage, path: string): Promise<Record<string, Record<string, unknown> | null>> {
    const url = new URL(req.url || '', 'http://localhost')
    const queryParams = parseQuery(url.search.substring(1))

    let body: any = {}
    if (req.method !== 'get' && req.headers['content-type'] === 'application/json') {
      body = await this.getJsonBody(req)
    }

    const headers = req.headers
    const routeParams = this.matchRoute(path, url.pathname)

    return {
      body,
      params: routeParams,
      headers,
      query: JSON.parse(JSON.stringify(queryParams)) // Serialize and deserialize to ensure a valid object
    }
  }

  private notFound (res: ServerResponse): void {
    res.statusCode = 404
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Not found' }))
  }

  private internalServerError (res: ServerResponse): void {
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Internal Server Error' }))
  }

  private async getJsonBody (req: IncomingMessage): Promise<object> {
    return await new Promise((resolve, reject) => {
      let body = ''
      req.on('data', (chunk: string) => {
        body += chunk
      })
      req.on('end', () => {
        try {
          resolve(JSON.parse(body))
        } catch (e) {
          reject(e)
        }
      })
      req.on('error', reject)
    })
  }

  private matchRoute (route: string, url: string): Record<string, unknown> | null {
    const routeParts = route.split('/')
    const urlParts = url.split('/')

    if (routeParts.length !== urlParts.length) {
      return null
    }

    const params: Record<string, any> = {}

    for (let i = 0; i < routeParts.length; i++) {
      if (routeParts[i].startsWith(':')) {
        params[routeParts[i].slice(1)] = urlParts[i]
      } else if (routeParts[i] !== urlParts[i]) {
        return null
      }
    }

    return params
  }
}
