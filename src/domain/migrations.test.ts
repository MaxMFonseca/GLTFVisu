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
      schemaVersion: 1,
      parameterValues: { tint: '#ddeeff' },
    })
    expect(migrated.parameters[0]).toMatchObject({ defaultValue: '#aabbcc' })
  })

  it('rejects malformed and unsupported stored records', () => {
    expect(() => migrateStoredShader(null)).toThrow('Invalid stored shader')
    expect(() => migrateStoredShader({ schemaVersion: 2 })).toThrow('Unsupported stored shader version')
  })
})
