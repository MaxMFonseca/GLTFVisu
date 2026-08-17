import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { verifyStaticSubpath } from './verify-static-subpath.mjs'

async function createFixture(indexSource = '<script type="module" src="./assets/app-a.js"></script><link rel="stylesheet" href="./assets/app-a.css">') {
  const root = await mkdtemp(join(tmpdir(), 'gltfvisu-static-'))
  const assets = join(root, 'assets')
  await mkdir(assets)
  await writeFile(join(root, 'index.html'), indexSource)
  await writeFile(join(assets, 'app-a.css'), 'body { color: white; }')
  await writeFile(join(assets, 'editor-a.css'), '.editor { display: block; }')
  await writeFile(join(assets, 'lazy-a.js'), 'export default true')
  await writeFile(join(assets, 'editor.worker-a.js'), 'self.onmessage = () => {}')
  await writeFile(join(assets, 'pbr-a.svg'), '<svg/>')
  await writeFile(join(assets, 'unlit-color-a.svg'), '<svg/>')
  for (const name of ['starfield-a.hdr', 'city-a.hdr', 'desert-a.hdr', 'studio-a.hdr']) {
    await writeFile(join(assets, name), '#?RADIANCE\n')
  }
  await writeFile(join(assets, 'app-a.js'), [
    'const chunks = ["./editor-a.css"];',
    'import("./lazy-a.js");',
    'new Worker(new URL("editor.worker-a.js", import.meta.url));',
    ...['starfield-a.hdr', 'city-a.hdr', 'desert-a.hdr', 'studio-a.hdr', 'pbr-a.svg', 'unlit-color-a.svg']
      .map((name) => `new URL("${name}", import.meta.url);`),
    `const inlinePortraits = [${Array.from({ length: 6 }, () => '"data:image/svg+xml,%3csvg/%3e"').join(',')}];`,
  ].join('\n'))
  return root
}

test('crawls every emitted production asset beneath the simulated repository subpath', async () => {
  const root = await createFixture()
  try {
    const result = await verifyStaticSubpath({ distDir: root, repositoryPath: '/GLTFVisu/' })
    assert.equal(result.hdrCount, 4)
    assert.equal(result.portraitCount, 8)
    assert.equal(result.workerCount, 1)
    assert.equal(result.unresolved.length, 0)
    assert.ok(result.requests.every((request) => request.startsWith('/GLTFVisu/')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects a production page that escapes to the domain-root assets directory', async () => {
  const root = await createFixture('<script type="module" src="/assets/app-a.js"></script>')
  try {
    await assert.rejects(
      verifyStaticSubpath({ distDir: root, repositoryPath: '/GLTFVisu/' }),
      /root-absolute \/assets request/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
