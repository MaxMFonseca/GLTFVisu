import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import test from 'node:test'

import { verifyDefaultModel } from './verify-default-model.mjs'

const modelPath = resolve('src/assets/models/fox.glb')

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

test('verifyDefaultModel rejects malformed GLB input', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gltfvisu-model-'))
  const malformedPath = join(directory, 'malformed.glb')
  await writeFile(malformedPath, Buffer.from('not a GLB'))

  await assert.rejects(verifyDefaultModel(malformedPath), /GLB|magic|header/i)
})

test('verifyDefaultModel rejects dangling accessor, image view, and material links', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gltfvisu-model-links-'))
  const fixtures = [
    ['dangling-accessor', (json) => { json.meshes[0].primitives[0].attributes.POSITION = json.accessors.length }],
    ['dangling-image-view', (json) => { json.images[0].bufferView = json.bufferViews.length }],
    ['dangling-material', (json) => { json.meshes[0].primitives[0].material = json.materials.length }],
  ]

  for (const [name, mutate] of fixtures) {
    await assert.rejects(verifyDefaultModel(await writeMalformedFixture(directory, name, mutate)), /index|buffer view|material/i)
  }
})

test('verifyDefaultModel rejects invalid buffer-view domains and declared buffer lengths', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gltfvisu-model-buffers-'))
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
    await assert.rejects(verifyDefaultModel(await writeMalformedFixture(directory, name, mutate)), /buffer|offset|length|BIN|padding/i)
  }
})

test('verifyDefaultModel accepts up to three bytes of BIN alignment padding', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gltfvisu-model-padding-'))

  for (const padding of [0, 1, 2, 3]) {
    const fixturePath = await writeMalformedFixture(directory, `padding-${padding}`, (json, bin) => {
      if (padding === 0) return bin
      json.buffers[0].byteLength = bin.length + 4 - padding
      return Buffer.concat([bin, Buffer.alloc(4)])
    })
    await assert.doesNotReject(verifyDefaultModel(fixturePath))
  }
})

test('verifyDefaultModel rejects excessive BIN padding and views that only fit in padding', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gltfvisu-model-padding-invalid-'))
  const fixtures = [
    ['four-padding-bytes', (json, bin) => Buffer.concat([bin, Buffer.alloc(4)])],
    ['view-in-padding', (json, bin) => {
      json.buffers[0].byteLength = bin.length - 3
      json.bufferViews[0].byteOffset = bin.length - 2
      json.bufferViews[0].byteLength = 1
    }],
  ]

  for (const [name, mutate] of fixtures) {
    await assert.rejects(verifyDefaultModel(await writeMalformedFixture(directory, name, mutate)), /buffer|length|view|BIN|padding/i)
  }
})

test('verifyDefaultModel accepts the bundled textured, skinned, animated Fox model', async () => {
  const result = await verifyDefaultModel(modelPath)
  assert.ok(result.meshCount >= 1)
  assert.ok(result.imageCount >= 1)
  assert.ok(result.baseColorTextureCount >= 1)
  assert.ok(result.skinCount >= 1)
  for (const clip of ['Survey', 'Walk', 'Run']) {
    assert.ok(result.animationNames.includes(clip), `Expected ${clip} animation`)
  }
})

test('bundled Fox GLB has loader-safe embedded images and no external URIs', async () => {
  const { json, bin } = readGlbJsonAndBin(await readFile(modelPath))
  for (const view of json.bufferViews) {
    assert.ok(view.byteOffset + view.byteLength <= bin.length)
  }
  assert.ok(json.images.every((image) => image.uri === undefined && Number.isInteger(image.bufferView)))
  assert.ok(json.buffers.every((buffer) => buffer.uri === undefined), `Expected self-contained ${basename(modelPath)}`)
})
