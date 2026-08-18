import { describe, expect, it } from 'vitest'
import { migrateStoredShader } from './migrations'

describe('migrateStoredShader', () => {
  it('reads a v1 stored local shader and canonicalizes its color values', () => {
    const migrated = migrateStoredShader({
      id: 'stored-id',
      name: 'Stored',
      fragmentSource: 'void main() { outColor = vec4(1.0); }',
      origin: 'local',
      parameters: [{ id: 'tint', type: 'color', uniformName: 'uTint', label: 'Tint', defaultValue: '#AABBCC' }],
      parameterValues: { tint: '#DDEEFF' },
      createdAt: 1,
      updatedAt: 2,
      schemaVersion: 1,
    })

    expect(migrated).toMatchObject({
      id: 'stored-id',
      origin: 'local',
      schemaVersion: 2,
      materialInputProfile: 'none',
      parameterValues: { tint: '#ddeeff' },
    })
    expect(migrated.parameters[0]).toMatchObject({ defaultValue: '#aabbcc' })
  })

  it('normalizes an explicit v2 GLTF PBR profile', () => {
    expect(migrateStoredShader({
      id: 'stored-v2',
      name: 'Stored PBR',
      fragmentSource: 'void main() { outColor = vec4(1.0); }',
      origin: 'local',
      materialInputProfile: 'gltf-pbr',
      parameters: [],
      parameterValues: {},
      schemaVersion: 2,
    })).toMatchObject({ schemaVersion: 2, materialInputProfile: 'gltf-pbr' })
  })

  it('rejects malformed, unsupported, and incomplete stored records', () => {
    expect(() => migrateStoredShader(null)).toThrow('Invalid stored shader')
    expect(() => migrateStoredShader({ schemaVersion: 3 })).toThrow('Unsupported stored shader version')
    expect(() => migrateStoredShader({
      id: 'stored-v2', name: 'Stored', fragmentSource: '', origin: 'local', parameters: [], parameterValues: {}, schemaVersion: 2,
    })).toThrow('Invalid material input profile')
    expect(() => migrateStoredShader({
      id: 'stored-v2', name: 'Stored', fragmentSource: '', origin: 'local', materialInputProfile: 'gltf-physical', parameters: [], parameterValues: {}, schemaVersion: 2,
    })).toThrow('Invalid material input profile')
  })
})
