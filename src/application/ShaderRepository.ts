import type { ShaderDefinition } from '../domain/shader'

export interface ShaderRepository {
  list(): Promise<ShaderDefinition[]>
  get(id: string): Promise<ShaderDefinition | undefined>
  save(shader: ShaderDefinition): Promise<void>
  delete(id: string): Promise<void>
}
