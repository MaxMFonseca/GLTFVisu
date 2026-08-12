import type { ShaderRepository } from '../application/ShaderRepository'
import { migrateStoredShader } from '../domain/migrations'
import type { ShaderDefinition } from '../domain/shader'
import {
  DEFAULT_DATABASE_NAME,
  openShaderDatabase,
  requestResult,
  SHADER_STORE_NAME,
  StorageError,
  transactionComplete,
} from './database'

function cloneShader(shader: ShaderDefinition): ShaderDefinition {
  return {
    ...shader,
    ...(shader.portrait === undefined ? {} : {
      portrait: shader.portrait.kind === 'bundled'
        ? { ...shader.portrait }
        : { ...shader.portrait, blob: shader.portrait.blob },
    }),
    parameters: shader.parameters.map((parameter) => ({ ...parameter })),
    parameterValues: { ...shader.parameterValues },
  }
}

function compareShaders(left: ShaderDefinition, right: ShaderDefinition): number {
  const timeDifference = (right.updatedAt ?? 0) - (left.updatedAt ?? 0)
  return timeDifference !== 0 ? timeDifference : left.name.localeCompare(right.name)
}

export class IndexedDbShaderRepository implements ShaderRepository {
  private database?: IDBDatabase
  private opening?: Promise<IDBDatabase>
  private openGeneration = 0

  constructor(private readonly databaseName = DEFAULT_DATABASE_NAME) {}

  async list(): Promise<ShaderDefinition[]> {
    const records = await this.runRequest('list shaders', 'readonly', (store) => store.getAll())
    return records.map(migrateStoredShader).sort(compareShaders)
  }

  async get(id: string): Promise<ShaderDefinition | undefined> {
    const record = await this.runRequest('get shader', 'readonly', (store) => store.get(id))
    return record === undefined ? undefined : migrateStoredShader(record)
  }

  async save(shader: ShaderDefinition): Promise<void> {
    const snapshot = cloneShader(shader)
    await this.runRequest('save shader', 'readwrite', (store) => store.put(snapshot))
  }

  async delete(id: string): Promise<void> {
    await this.runRequest('delete shader', 'readwrite', (store) => store.delete(id))
  }

  close(): void {
    this.openGeneration += 1
    this.database?.close()
    this.database = undefined
    this.opening = undefined
  }

  private async getDatabase(): Promise<IDBDatabase> {
    if (this.database !== undefined) return this.database
    if (this.opening === undefined) {
      const generation = this.openGeneration
      this.opening = openShaderDatabase(this.databaseName)
        .then((database) => {
          if (generation !== this.openGeneration) {
            database.close()
            return database
          }
          this.database = database
          return database
        })
        .catch((error: unknown) => {
          if (generation === this.openGeneration) this.opening = undefined
          throw error
        })
    }
    return this.opening
  }

  private async runRequest<T>(
    operation: string,
    mode: IDBTransactionMode,
    createRequest: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const database = await this.getDatabase()
    let transaction: IDBTransaction
    let request: IDBRequest<T>
    try {
      transaction = database.transaction(SHADER_STORE_NAME, mode)
      request = createRequest(transaction.objectStore(SHADER_STORE_NAME))
    } catch (error) {
      throw new StorageError(`${operation}: IndexedDB transaction setup failed`, error)
    }
    const [result] = await Promise.all([
      requestResult(request, operation),
      transactionComplete(transaction, operation),
    ])
    return result
  }
}
