import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BufferAttribute, BufferGeometry, Group, Mesh, MeshBasicMaterial } from 'three'
import { GltfAssetLoader } from './GltfAssetLoader'

const parse = vi.hoisted(() => vi.fn())

vi.mock('three/addons/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    constructor(private readonly manager: { resolveURL(url: string): string }) {}

    parse(
      data: string | ArrayBuffer,
      basePath: string,
      onLoad: (value: unknown) => void,
      onError: (error: unknown) => void,
    ): void {
      parse(this.manager, data, basePath, onLoad, onError)
    }
  },
}))

function localFile(name: string, relativePath: string): File {
  const file = new File(['{}'], name, { type: 'model/gltf+json' })
  Object.defineProperty(file, 'webkitRelativePath', { value: relativePath })
  Object.defineProperty(file, 'text', { value: async () => '{}' })
  return file
}

describe('GltfAssetLoader', () => {
  const createObjectURL = vi.fn(() => 'blob:albedo')
  const revokeObjectURL = vi.fn()

  beforeEach(() => {
    parse.mockReset()
    createObjectURL.mockClear()
    revokeObjectURL.mockClear()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects an in-flight parse immediately on abort, revokes URLs, and ignores a late success callback', async () => {
    let complete: ((value: unknown) => void) | undefined
    parse.mockImplementation((manager: { resolveURL(url: string): string }, _data: unknown, _basePath: string, onLoad: (value: unknown) => void) => {
      manager.resolveURL('textures/albedo.png')
      complete = onLoad
    })
    const root = localFile('scene.gltf', 'models/scene.gltf')
    const controller = new AbortController()
    const loading = new GltfAssetLoader().load([root, localFile('albedo.png', 'models/textures/albedo.png')], root, controller.signal)
    const settled = loading.then(
      () => new Error('load unexpectedly resolved'),
      (error: unknown) => error,
    )

    await vi.waitFor(() => expect(parse).toHaveBeenCalledTimes(1))
    controller.abort()

    const result = await Promise.race([
      settled,
      new Promise((resolve) => setTimeout(() => resolve('still pending'), 0)),
    ])

    expect(result).toMatchObject({ code: 'aborted' })
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:albedo')

    complete?.({ scene: {} })
    await Promise.resolve()
    await expect(settled).resolves.toMatchObject({ code: 'aborted' })
  })

  it('reports generic unsupported extension errors as unsupported resources', async () => {
    parse.mockImplementation((_manager: unknown, _data: unknown, _basePath: string, _onLoad: unknown, onError: (error: unknown) => void) => {
      onError(new Error('Unsupported extension: VENDOR_foo'))
    })
    const root = localFile('scene.gltf', 'scene.gltf')

    await expect(new GltfAssetLoader().load([root], root)).rejects.toMatchObject({
      code: 'unsupported-resource',
    })
  })

  it('passes GLTFLoader-generated blob URLs through without treating them as local files', async () => {
    parse.mockImplementation((manager: { resolveURL(url: string): string }, _data: unknown, _basePath: string, onLoad: (value: unknown) => void) => {
      expect(manager.resolveURL('blob:embedded-base-color')).toBe('blob:embedded-base-color')
      onLoad({ scene: new Group() })
    })
    const root = localFile('embedded.glb', 'embedded.glb')
    Object.defineProperty(root, 'arrayBuffer', { value: async () => new ArrayBuffer(0) })

    await expect(new GltfAssetLoader().load([root], root)).resolves.toEqual({ scene: expect.any(Group) })
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('generates normals for loaded mesh geometry only when the asset omits them', async () => {
    const missingNormals = new BufferGeometry()
    missingNormals.setAttribute('position', new BufferAttribute(new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0,
    ]), 3))
    const existingNormals = missingNormals.clone()
    const originalNormal = new BufferAttribute(new Float32Array([
      0, 0, 1, 0, 0, 1, 0, 0, 1,
    ]), 3)
    existingNormals.setAttribute('normal', originalNormal)
    const scene = new Group().add(
      new Mesh(missingNormals, new MeshBasicMaterial()),
      new Mesh(existingNormals, new MeshBasicMaterial()),
    )
    parse.mockImplementation((_manager: unknown, _data: unknown, _basePath: string, onLoad: (value: unknown) => void) => {
      onLoad({ scene, animations: [] })
    })
    const root = localFile('embedded.glb', 'embedded.glb')
    Object.defineProperty(root, 'arrayBuffer', { value: async () => new ArrayBuffer(0) })

    await new GltfAssetLoader().load([root], root)

    expect(missingNormals.getAttribute('normal')).toBeDefined()
    expect(existingNormals.getAttribute('normal')).toBe(originalNormal)
  })
})
