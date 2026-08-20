import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import test from 'node:test'

import { verifySuzanne } from './verify-suzanne.mjs'

const modelPath = resolve('src/assets/models/suzanne.glb')

function readGlbJsonAndBin(glb) {
  assert.equal(glb.toString('ascii', 0, 4), 'glTF')
  assert.equal(glb.readUInt32LE(4), 2)

  let offset = 12
  let json
  let bin
  while (offset < glb.length) {
    const length = glb.readUInt32LE(offset)
    const type = glb.readUInt32LE(offset + 4)
    const chunk = glb.subarray(offset + 8, offset + 8 + length)
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8').trim())
    if (type === 0x004e4942) bin = chunk
    offset += 8 + length
  }
  return { json, bin }
}

function paddedChunk(content, padding) {
  const paddingLength = (4 - (content.length % 4)) % 4
  return Buffer.concat([content, Buffer.alloc(paddingLength, padding)])
}

function createGlb(json, bin) {
  const jsonChunk = paddedChunk(Buffer.from(JSON.stringify(json)), 0x20)
  const binChunk = paddedChunk(bin, 0)
  const totalLength = 12 + 8 + jsonChunk.length + 8 + binChunk.length
  const header = Buffer.alloc(12)
  header.writeUInt32LE(0x46546c67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(totalLength, 8)
  const jsonHeader = Buffer.alloc(8)
  jsonHeader.writeUInt32LE(jsonChunk.length, 0)
  jsonHeader.writeUInt32LE(0x4e4f534a, 4)
  const binHeader = Buffer.alloc(8)
  binHeader.writeUInt32LE(binChunk.length, 0)
  binHeader.writeUInt32LE(0x004e4942, 4)
  return Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk])
}

async function writeMalformedFixture(directory, name, mutate) {
  const { json, bin } = readGlbJsonAndBin(await readFile(modelPath))
  const mutatedBin = mutate(json, bin) ?? bin
  const fixturePath = join(directory, `${name}.glb`)
  await writeFile(fixturePath, createGlb(json, mutatedBin))
  return fixturePath
}

test('verifySuzanne rejects malformed GLB input', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gltfvisu-suzanne-'))
  const malformedPath = join(directory, 'malformed.glb')
  await writeFile(malformedPath, Buffer.from('not a GLB'))

  await assert.rejects(verifySuzanne(malformedPath), /GLB|magic|header/i)
})

test('verifySuzanne rejects dangling accessor, image view, and material links', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gltfvisu-suzanne-links-'))
  const fixtures = [
    ['dangling-accessor', (json) => { json.meshes[0].primitives[0].attributes.POSITION = json.accessors.length }],
    ['dangling-image-view', (json) => { json.images[0].bufferView = json.bufferViews.length }],
    ['dangling-material', (json) => { json.meshes[0].primitives[0].material = json.materials.length }],
  ]

  for (const [name, mutate] of fixtures) {
    await assert.rejects(verifySuzanne(await writeMalformedFixture(directory, name, mutate)), /index|buffer view|material/i)
  }
})

test('verifySuzanne rejects invalid buffer-view domains and declared buffer lengths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gltfvisu-suzanne-buffers-'))
  const fixtures = [
    ['wrong-buffer', (json) => { json.bufferViews[json.images[0].bufferView].buffer = 1 }],
    ['negative-offset', (json) => { json.bufferViews[0].byteOffset = -1 }],
    ['fractional-offset', (json) => { json.bufferViews[0].byteOffset = 0.5 }],
    ['negative-length', (json) => { json.bufferViews[0].byteLength = -1 }],
    ['fractional-length', (json) => { json.bufferViews[0].byteLength = 0.5 }],
    ['out-of-bounds-view', (json, bin) => { json.bufferViews[0].byteOffset = bin.length; json.bufferViews[0].byteLength = 1 }],
    ['declared-length-larger-than-bin', (json, bin) => { json.buffers[0].byteLength = bin.length + 1 }],
  ]

  for (const [name, mutate] of fixtures) {
    await assert.rejects(verifySuzanne(await writeMalformedFixture(directory, name, mutate)), /buffer|offset|length|BIN|padding/i)
  }
})

test('verifySuzanne accepts up to three bytes of BIN alignment padding', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gltfvisu-suzanne-padding-'))

  for (const padding of [0, 1, 2, 3]) {
    const fixturePath = await writeMalformedFixture(directory, `padding-${padding}`, (json, bin) => {
      json.buffers[0].byteLength = bin.length - padding
    })
    await assert.doesNotReject(verifySuzanne(fixturePath))
  }
})

test('verifySuzanne rejects excessive BIN padding and views that only fit in padding', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gltfvisu-suzanne-padding-invalid-'))
  const fixtures = [
    ['four-padding-bytes', (json, bin) => Buffer.concat([bin, Buffer.alloc(4)])],
    ['view-in-padding', (json, bin) => {
      json.buffers[0].byteLength = bin.length - 3
      json.bufferViews[0].byteOffset = bin.length - 2
      json.bufferViews[0].byteLength = 1
    }],
  ]

  for (const [name, mutate] of fixtures) {
    await assert.rejects(verifySuzanne(await writeMalformedFixture(directory, name, mutate)), /buffer|length|view|BIN|padding/i)
  }
})

test('verifySuzanne accepts the bundled textured Suzanne model', async () => {
  assert.deepEqual(await verifySuzanne(modelPath), {
    meshCount: 1,
    imageCount: 1,
    baseColorTextureCount: 1,
  })
})

test('bundled Suzanne GLB has loader-safe buffer views and matching UV data', async () => {
  const { json, bin } = readGlbJsonAndBin(await readFile(modelPath))
  const primitive = json.meshes[0].primitives[0]
  const position = json.accessors[primitive.attributes.POSITION]
  const texcoord = json.accessors[primitive.attributes.TEXCOORD_0]

  assert.equal(texcoord.count, position.count)
  for (const view of json.bufferViews) {
    assert.ok(view.byteOffset + view.byteLength <= bin.length)
  }

  const image = json.images[0]
  const imageView = json.bufferViews[image.bufferView]
  assert.deepEqual(
    bin.subarray(imageView.byteOffset, imageView.byteOffset + 8),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    `Expected PNG image in ${basename(modelPath)}`,
  )
})
