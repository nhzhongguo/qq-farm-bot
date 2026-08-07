import { useStorage } from '@vueuse/core'
import api from '@/api'

/**
 * 轻量请求缓存：对可缓存的 GET 提供 in-flight 去重 + TTL 缓存 + 可取消。
 * 只缓存成功响应；缓存命中直接返回副本，避免同屏重复请求与重复渲染。
 */

interface ApiEnvelope<T> {
  ok: boolean
  data?: T
  error?: string
}

interface CacheEntry<T> {
  expiresAt: number
  data: T
}

interface CachedGetOptions {
  /** 缓存有效期（ms）。默认 0 = 只去重不缓存。 */
  ttl?: number
  /** 是否允许路由切换时被取消。默认 true。 */
  cancellable?: boolean
}

const inflight = new Map<string, Promise<unknown>>()
const cache = new Map<string, CacheEntry<unknown>>()
const activeControllers = new Set<AbortController>()

const tokenRef = useStorage('admin_token', '')
const accountIdRef = useStorage('current_account_id', '')

function buildKey(url: string, params?: Record<string, unknown>): string {
  let query = ''
  if (params) {
    const keys = Object.keys(params).filter(k => params[k] !== undefined && params[k] !== '')
    keys.sort()
    query = keys.map(k => `${k}=${encodeURIComponent(String(params[k]))}`).join('&')
  }
  const context = [
    tokenRef.value ? `admin_token=${encodeURIComponent(tokenRef.value)}` : '',
    accountIdRef.value ? `current_account_id=${encodeURIComponent(accountIdRef.value)}` : '',
  ].filter(Boolean).join('&')
  const queryAndContext = [query, context].filter(Boolean).join('&')
  return `${url}${queryAndContext ? `?${queryAndContext}` : ''}`
}

function isFresh<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
  return Boolean(entry && entry.expiresAt > Date.now())
}

export function cachedGet<T = any>(url: string, params?: Record<string, unknown>, options: CachedGetOptions = {}): Promise<T> {
  const ttl = options.ttl || 0
  const key = buildKey(url, params)

  const hit = cache.get(key) as CacheEntry<T> | undefined
  if (ttl > 0 && isFresh(hit)) {
    return Promise.resolve(hit.data)
  }

  const existing = inflight.get(key) as Promise<T> | undefined
  if (existing) {
    return existing
  }

  const controller = new AbortController()
  if (options.cancellable !== false) {
    activeControllers.add(controller)
  }

  const request: Promise<T> = api.get<ApiEnvelope<T>>(url, {
    params,
    signal: controller.signal,
  }).then((res) => {
    const body = res.data
    if (body && body.ok && body.data !== undefined) {
      if (ttl > 0) {
        cache.set(key, { expiresAt: Date.now() + ttl, data: body.data })
      }
      return body.data
    }
    throw new Error(String(body?.error || '请求失败'))
  }).finally(() => {
    inflight.delete(key)
    activeControllers.delete(controller)
  })

  inflight.set(key, request)
  return request
}

export function clearCachedGet(): void {
  cache.clear()
}

/** 路由切换时取消所有可取消请求，避免过期响应写回已卸载页面。 */
export function cancelAllRequests(): void {
  for (const controller of activeControllers)
    controller.abort()
  activeControllers.clear()
}
