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

function requireIndex(index, items, description) {
  assert.ok(Number.isInteger(index) && index >= 0 && index < items.length, `Invalid ${description} index`)
  return items[index]
}

function verifyBufferViews(json, bin) {
  const buffer = requireSingle(json.buffers, 'buffer')
  assert.equal(buffer.uri, undefined, 'Buffers must be embedded')
  assert.ok(Number.isInteger(buffer.byteLength) && buffer.byteLength >= 0, 'Buffer length must be a non-negative integer')
  assert.ok(
    bin.length >= buffer.byteLength && bin.length <= buffer.byteLength + 3,
    'BIN chunk may contain only up to three alignment-padding bytes',
  )

  for (const view of json.bufferViews ?? []) {
    assert.equal(view.buffer, 0, 'Buffer view must target embedded buffer 0')
    const start = view.byteOffset ?? 0
    assert.ok(Number.isInteger(start) && start >= 0, 'Buffer view offset must be a non-negative integer')
    assert.ok(Number.isInteger(view.byteLength) && view.byteLength >= 0, 'Buffer view length must be a non-negative integer')
    assert.ok(start + view.byteLength <= buffer.byteLength, 'Buffer view extends beyond the declared buffer length')
  }
}

export async function verifyDefaultModel(path) {
  const { json, bin } = parseGlb(await readFile(path))
  verifyBufferViews(json, bin)
  assert.ok((json.meshes?.length ?? 0) > 0, 'Expected at least one mesh')
  assert.ok((json.images?.length ?? 0) > 0, 'Expected at least one embedded image')
  assert.ok((json.skins?.length ?? 0) > 0, 'Expected at least one skin')
  assert.ok((json.animations?.length ?? 0) > 0, 'Expected named animations')

  let morphTargetCount = 0
  for (const mesh of json.meshes) {
    assert.ok((mesh.primitives?.length ?? 0) > 0, 'Mesh must contain a primitive')
    for (const primitive of mesh.primitives) {
      requireIndex(primitive.attributes?.POSITION, json.accessors ?? [], 'POSITION')
      if (primitive.attributes?.NORMAL !== undefined) requireIndex(primitive.attributes.NORMAL, json.accessors ?? [], 'NORMAL')
      if (primitive.attributes?.TEXCOORD_0 !== undefined) requireIndex(primitive.attributes.TEXCOORD_0, json.accessors ?? [], 'TEXCOORD_0')
      if (primitive.material !== undefined) requireIndex(primitive.material, json.materials ?? [], 'material')
      for (const target of primitive.targets ?? []) {
        morphTargetCount += 1
        for (const [attribute, accessor] of Object.entries(target)) {
          requireIndex(accessor, json.accessors ?? [], `morph target ${attribute}`)
        }
      }
    }
  }

  for (const image of json.images) {
    assert.equal(image.uri, undefined, 'Images must be embedded')
    requireIndex(image.bufferView, json.bufferViews ?? [], 'image buffer view')
    assert.match(image.mimeType ?? '', /^image\/(png|jpeg|webp)$/, 'Embedded image must declare a supported MIME type')
  }
  for (const texture of json.textures ?? []) {
    requireIndex(texture.source, json.images, 'texture image')
    if (texture.sampler !== undefined) requireIndex(texture.sampler, json.samplers ?? [], 'texture sampler')
  }
  for (const skin of json.skins) {
    assert.ok((skin.joints?.length ?? 0) > 0, 'Skin must contain joints')
    for (const joint of skin.joints) requireIndex(joint, json.nodes ?? [], 'skin joint')
    if (skin.inverseBindMatrices !== undefined) requireIndex(skin.inverseBindMatrices, json.accessors ?? [], 'inverse bind matrices')
  }

  const animationNames = json.animations.map((animation) => animation.name).filter(Boolean)
  assert.equal(animationNames.length, json.animations.length, 'Every animation must be named')
  const baseColorTextureCount = (json.materials ?? []).filter((material) => {
    const index = material.pbrMetallicRoughness?.baseColorTexture?.index
    if (index === undefined) return false
    requireIndex(index, json.textures ?? [], 'base color texture')
    return true
  }).length
  assert.ok(baseColorTextureCount > 0, 'Expected at least one base-color texture')
  return {
    meshCount: json.meshes.length,
    imageCount: json.images.length,
    baseColorTextureCount,
    skinCount: json.skins.length,
    morphTargetCount,
    animationNames,
  }
}
