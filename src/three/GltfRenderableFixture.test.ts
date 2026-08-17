import { LineSegments, Points } from 'three'
import { describe, expect, it } from 'vitest'
import { GltfAssetLoader } from './GltfAssetLoader'

function renderableGltf(): File {
  const source = JSON.stringify({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0, 1] }],
    nodes: [{ mesh: 0 }, { mesh: 1 }],
    meshes: [
      { primitives: [{ attributes: { POSITION: 0 }, mode: 1 }] },
      { primitives: [{ attributes: { POSITION: 0 }, mode: 0 }] },
    ],
    accessors: [{ bufferView: 0, componentType: 5126, count: 2, type: 'VEC3', min: [0, 0, 0], max: [1, 0, 0] }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 24 }],
    buffers: [{ byteLength: 24 }],
  })
  const encoded = new TextEncoder().encode(source)
  const jsonLength = Math.ceil(encoded.length / 4) * 4
  const bytes = new Uint8Array(12 + 8 + jsonLength + 8 + 24)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x46546c67, true)
  view.setUint32(4, 2, true)
  view.setUint32(8, bytes.length, true)
  view.setUint32(12, jsonLength, true)
  view.setUint32(16, 0x4e4f534a, true)
  bytes.fill(0x20, 20, 20 + jsonLength)
  bytes.set(encoded, 20)
  const binaryOffset = 20 + jsonLength
  view.setUint32(binaryOffset, 24, true)
  view.setUint32(binaryOffset + 4, 0x004e4942, true)
  new Float32Array(bytes.buffer, binaryOffset + 8, 6).set([0, 0, 0, 1, 0, 0])
  const file = new File([bytes], 'renderables.glb', { type: 'model/gltf-binary' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer })
  return file
}

describe('GLTF renderable fixture', () => {
  it('loads line and point primitives from a valid local GLTF', async () => {
    const root = renderableGltf()
    const loaded = await new GltfAssetLoader().load([root], root)
    const renderables: object[] = []
    loaded.scene.traverse((object) => {
      if (object instanceof LineSegments || object instanceof Points) renderables.push(object)
    })

    expect(renderables).toEqual([expect.any(LineSegments), expect.any(Points)])
  })
})
