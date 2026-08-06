import { describe, expect, it, vi } from 'vitest'
import { LocalAssetMap, classifyModelFiles } from './LocalAssetMap'

function localFile(name: string, relativePath: string): File {
  const file = new File(['asset'], name, { type: 'application/octet-stream' })
  Object.defineProperty(file, 'webkitRelativePath', { value: relativePath })
  return file
}

describe('classifyModelFiles', () => {
  it('normalizes paths and sorts multiple model roots deterministically', () => {
    const files = [
      localFile('scene.glTF', 'models\\zeta\\scene.glTF'),
      localFile('robot.GLB', 'models/alpha/robot.GLB'),
      localFile('albedo.png', 'models/zeta/textures/albedo.png'),
    ]

    const classified = classifyModelFiles(files)

    expect(classified.roots.map((file) => file.webkitRelativePath)).toEqual([
      'models/alpha/robot.GLB',
      'models\\zeta\\scene.glTF',
    ])
    expect([...classified.resources.keys()]).toEqual([
      'models/alpha/robot.GLB',
      'models/zeta/scene.glTF',
      'models/zeta/textures/albedo.png',
    ])
  })
})

describe('LocalAssetMap', () => {
  it('resolves an exact normalized path before considering basename collisions', () => {
    const exact = localFile('normal.png', 'models/robot/textures/normal.png')
    const duplicate = localFile('normal.png', 'models/shared/normal.png')
    const classified = classifyModelFiles([exact, duplicate])
    const createObjectURL = vi.fn((file: File) => `blob:${file.webkitRelativePath}`)
    const assets = new LocalAssetMap(classified, { createObjectURL, revokeObjectURL: vi.fn() })

    expect(assets.resolve('models/robot/textures/normal.png?version=1#preview')).toBe('blob:models/robot/textures/normal.png')
    expect(() => assets.resolve('normal.png')).toThrow('Ambiguous local resource: normal.png')
  })

  it('falls back to an unambiguous decoded basename', () => {
    const texture = localFile('albedo map.png', 'models/textures/albedo map.png')
    const assets = new LocalAssetMap(classifyModelFiles([texture]), {
      createObjectURL: (file) => `blob:${file.name}`,
      revokeObjectURL: vi.fn(),
    })

    expect(assets.resolve('nested/path/albedo%20map.png?cache=123#fragment')).toBe('blob:albedo map.png')
  })

  it('reports the requested path when no local dependency exists', () => {
    const assets = new LocalAssetMap(classifyModelFiles([localFile('scene.gltf', 'scene.gltf')]), {
      createObjectURL: vi.fn(),
      revokeObjectURL: vi.fn(),
    })

    expect(() => assets.resolve('textures/missing.png?version=1')).toThrow('Missing local resource: textures/missing.png')
  })

  it('creates each object URL once and revokes owned URLs idempotently', () => {
    const createObjectURL = vi.fn(() => 'blob:albedo')
    const revokeObjectURL = vi.fn()
    const assets = new LocalAssetMap(classifyModelFiles([localFile('albedo.png', 'textures/albedo.png')]), {
      createObjectURL,
      revokeObjectURL,
    })

    expect(assets.resolve('textures/albedo.png')).toBe('blob:albedo')
    expect(assets.resolve('albedo.png')).toBe('blob:albedo')
    expect(createObjectURL).toHaveBeenCalledTimes(1)

    assets.revoke()
    assets.revoke()

    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:albedo')
  })
})
