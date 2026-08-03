import { useStorage, type RemovableRef } from '@vueuse/core'

/**
 * useStorage 的默认序列化器按默认值类型推断：
 * 默认值为 null 时会退化为 'any'（raw 字符串，不做 JSON.parse），
 * 导致对象型 storage（如 user_info）读到的是字符串而非对象。
 * 这里显式指定 JSON 序列化器，读取时容错（兼容历史脏数据）。
 */
export function useJsonStorage<T>(key: string, defaultValue: T | null = null): RemovableRef<T | null> {
  return useStorage<T | null>(key, defaultValue, undefined, {
    serializer: {
      read: (v: string) => {
        try {
          return JSON.parse(v) as T
        }
        catch {
          return defaultValue
        }
      },
      write: (v: T | null) => JSON.stringify(v),
    },
  })
}
