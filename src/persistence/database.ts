export const DEFAULT_DATABASE_NAME = 'gltf-shader-visualizer'
export const DATABASE_VERSION = 1
export const SHADER_STORE_NAME = 'shaders'
const UPDATED_AT_INDEX_NAME = 'updatedAt'

export class StorageError extends Error {
  readonly cause: unknown

  constructor(message: string, cause: unknown) {
    super(message)
    this.name = 'StorageError'
    this.cause = cause
  }
}

export function requestResult<T>(request: IDBRequest<T>, context: string): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new StorageError(`${context}: IndexedDB request failed`, request.error))
  })
}

export function transactionComplete(transaction: IDBTransaction, context: string): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(new StorageError(`${context}: IndexedDB transaction failed`, transaction.error))
    transaction.onabort = () => reject(new StorageError(`${context}: IndexedDB transaction aborted`, transaction.error))
  })
}

export function openShaderDatabase(name = DEFAULT_DATABASE_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, DATABASE_VERSION)
    let settled = false
    const fail = (message: string, cause: unknown) => {
      if (settled) return
      settled = true
      reject(new StorageError(message, cause))
    }

    request.onupgradeneeded = () => {
      try {
        const database = request.result
        const store = database.objectStoreNames.contains(SHADER_STORE_NAME)
          ? request.transaction?.objectStore(SHADER_STORE_NAME)
          : database.createObjectStore(SHADER_STORE_NAME, { keyPath: 'id' })
        if (store !== undefined && !store.indexNames.contains(UPDATED_AT_INDEX_NAME)) {
          store.createIndex(UPDATED_AT_INDEX_NAME, UPDATED_AT_INDEX_NAME)
        }
      } catch (error) {
        request.transaction?.abort()
        fail('Unable to open shader storage: database upgrade failed', error)
      }
    }
    request.onerror = () => fail('Unable to open shader storage: IndexedDB open failed', request.error)
    request.onblocked = () => fail('Unable to open shader storage: IndexedDB open blocked', request.error)
    request.onsuccess = () => {
      if (settled) {
        request.result.close()
        return
      }
      settled = true
      resolve(request.result)
    }
  })
}
