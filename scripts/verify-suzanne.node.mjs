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

test('verifySuzanne rejects malformed GLB input', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gltfvisu-suzanne-'))
  const malformedPath = join(directory, 'malformed.glb')
  await writeFile(malformedPath, Buffer.from('not a GLB'))

  await assert.rejects(verifySuzanne(malformedPath), /GLB|magic|header/i)
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
