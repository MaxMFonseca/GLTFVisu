import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const GLB_MAGIC = 0x46546c67
const GLB_VERSION = 2
const JSON_CHUNK = 0x4e4f534a
const BIN_CHUNK = 0x004e4942

function parseGlb(buffer) {
  assert.ok(buffer.length >= 20, 'GLB header is incomplete')
  assert.equal(buffer.readUInt32LE(0), GLB_MAGIC, 'GLB magic must be glTF')
  assert.equal(buffer.readUInt32LE(4), GLB_VERSION, 'GLB version must be 2')
  assert.equal(buffer.readUInt32LE(8), buffer.length, 'GLB header length must match file length')

  let offset = 12
  let json
  let bin
  while (offset < buffer.length) {
    assert.ok(offset + 8 <= buffer.length, 'GLB chunk header is incomplete')
    const chunkLength = buffer.readUInt32LE(offset)
    const chunkType = buffer.readUInt32LE(offset + 4)
    const chunkStart = offset + 8
    const chunkEnd = chunkStart + chunkLength
    assert.ok(chunkEnd <= buffer.length, 'GLB chunk extends beyond file length')
    if (chunkType === JSON_CHUNK) {
      assert.equal(json, undefined, 'GLB contains more than one JSON chunk')
      json = JSON.parse(buffer.subarray(chunkStart, chunkEnd).toString('utf8').trim())
    } else if (chunkType === BIN_CHUNK) {
      assert.equal(bin, undefined, 'GLB contains more than one BIN chunk')
      bin = buffer.subarray(chunkStart, chunkEnd)
    }
    offset = chunkEnd
  }
  assert.ok(json, 'GLB must contain a JSON chunk')
  assert.ok(bin, 'GLB must contain a BIN chunk')
  return { json, bin }
}

function requireSingle(items, description) {
  assert.equal(items?.length, 1, `Expected one ${description}`)
  return items[0]
}

export async function verifySuzanne(path) {
  const { json, bin } = parseGlb(await readFile(path))
  const mesh = requireSingle(json.meshes, 'mesh')
  const primitive = requireSingle(mesh.primitives, 'mesh primitive')
  for (const attribute of ['POSITION', 'NORMAL', 'TEXCOORD_0']) {
    assert.ok(Number.isInteger(primitive.attributes?.[attribute]), `Mesh primitive must include ${attribute}`)
  }

  const image = requireSingle(json.images, 'embedded image')
  assert.ok(Number.isInteger(image.bufferView), 'Image must be backed by a buffer view')
  assert.equal(image.mimeType, 'image/png', 'Embedded image must be PNG')
  const sampler = requireSingle(json.samplers, 'sampler')
  const texture = requireSingle(json.textures, 'texture')
  assert.equal(texture.source, 0, 'Texture must reference the embedded image')
  assert.equal(texture.sampler, 0, 'Texture must reference the sampler')
  assert.ok(sampler, 'Texture requires a sampler')

  const material = requireSingle(json.materials, 'material')
  const pbr = material.pbrMetallicRoughness
  assert.ok(Number.isInteger(pbr?.baseColorTexture?.index), 'Material must have a baseColorTexture index')
  assert.equal(pbr.baseColorTexture.index, 0, 'Material must use the embedded texture')
  assert.equal(pbr.metallicFactor, 0, 'Material must be non-metallic')
  assert.ok(Math.abs(pbr.roughnessFactor - 0.8) <= 1e-6, 'Material must have roughness 0.8')

  for (const buffer of json.buffers ?? []) assert.equal(buffer.uri, undefined, 'Buffers must be embedded')
  for (const embeddedImage of json.images ?? []) assert.equal(embeddedImage.uri, undefined, 'Images must be embedded')
  for (const view of json.bufferViews ?? []) {
    const start = view.byteOffset ?? 0
    assert.ok(start + view.byteLength <= bin.length, 'Buffer view extends beyond the BIN chunk')
  }
  return {
    meshCount: json.meshes.length,
    imageCount: json.images.length,
    baseColorTextureCount: json.materials.filter((item) => item.pbrMetallicRoughness?.baseColorTexture).length,
  }
}
