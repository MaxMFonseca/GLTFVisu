import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { verifyStaticSubpath } from './verify-static-subpath.mjs'

const PORTRAIT_SLUGS = [
  'fresnel',
  'normal',
  'pbr',
  'procedural-matcap',
  'rim-light',
  'toon',
  'unlit-color',
  'uv-grid',
]
const DEFAULT_PORTRAITS = PORTRAIT_SLUGS.map((slug) => `${slug}-a.png`)

async function createFixture({
  indexSource = '<script type="module" src="./assets/app-a.js"></script><link rel="stylesheet" href="./assets/app-a.css">',
  portraitFiles = DEFAULT_PORTRAITS,
  portraitReferences = portraitFiles,
  inlinePortraits = [],
  auxiliaryInlineSvgCount = 0,
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'gltfvisu-static-'))
  const assets = join(root, 'assets')
  await mkdir(assets)
  await writeFile(join(root, 'index.html'), indexSource)
  await writeFile(join(assets, 'app-a.css'), 'body { color: white; }')
  await writeFile(join(assets, 'editor-a.css'), '.editor { display: block; }')
  await writeFile(join(assets, 'lazy-a.js'), 'export default true')
  await writeFile(join(assets, 'editor.worker-a.js'), 'self.onmessage = () => {}')
  if (auxiliaryInlineSvgCount > 0) {
    await writeFile(join(assets, 'editor.api-a.js'), Array.from(
      { length: auxiliaryInlineSvgCount },
      (_, index) => `const decoration${index} = "data:image/svg+xml,%3csvg/%3e";`,
    ).join('\n'))
  }
  for (const name of portraitFiles) await writeFile(join(assets, name), 'portrait')
  for (const name of ['starfield-a.hdr', 'city-a.hdr', 'desert-a.hdr', 'studio-a.hdr']) {
    await writeFile(join(assets, name), '#?RADIANCE\n')
  }
  await writeFile(join(assets, 'app-a.js'), [
    'const chunks = ["./editor-a.css"];',
    'import("./lazy-a.js");',
    ...(auxiliaryInlineSvgCount > 0 ? ['import("./editor.api-a.js");'] : []),
    'new Worker(new URL("editor.worker-a.js", import.meta.url));',
    ...['starfield-a.hdr', 'city-a.hdr', 'desert-a.hdr', 'studio-a.hdr', ...portraitReferences]
      .map((name) => `new URL("${name}", import.meta.url);`),
    `const inlinePortraits = ${JSON.stringify(inlinePortraits)};`,
  ].join('\n'))
  return root
}

test('crawls the exact eight emitted PNG portraits beneath the simulated repository subpath', async () => {
  const root = await createFixture()
  try {
    const result = await verifyStaticSubpath({ distDir: root, repositoryPath: '/GLTFVisu/' })
    assert.equal(result.hdrCount, 4)
    assert.equal(result.portraitCount, 8)
    assert.deepEqual(result.portraitSlugs, PORTRAIT_SLUGS)
    assert.equal(result.workerCount, 1)
    assert.equal(result.unresolved.length, 0)
    assert.ok(result.requests.every((request) => request.startsWith('/GLTFVisu/')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects a production page that escapes to the domain-root assets directory', async () => {
  const root = await createFixture({ indexSource: '<script type="module" src="/assets/app-a.js"></script>' })
  try {
    await assert.rejects(
      verifyStaticSubpath({ distDir: root, repositoryPath: '/GLTFVisu/' }),
      /root-absolute \/assets request/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects a missing emitted portrait slug', async () => {
  const portraitFiles = DEFAULT_PORTRAITS.filter((name) => name !== 'uv-grid-a.png')
  const root = await createFixture({ portraitFiles })
  try {
    await assert.rejects(
      verifyStaticSubpath({ distDir: root, repositoryPath: '/GLTFVisu/' }),
      /Missing emitted portrait: uv-grid/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects duplicate emitted files for a portrait slug', async () => {
  const portraitFiles = [...DEFAULT_PORTRAITS, 'pbr-b.png']
  const root = await createFixture({ portraitFiles })
  try {
    await assert.rejects(
      verifyStaticSubpath({ distDir: root, repositoryPath: '/GLTFVisu/' }),
      /Duplicate emitted portrait: pbr/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects a portrait emitted in a non-PNG format', async () => {
  const portraitFiles = DEFAULT_PORTRAITS.map((name) => name === 'uv-grid-a.png' ? 'uv-grid-a.svg' : name)
  const root = await createFixture({ portraitFiles })
  try {
    await assert.rejects(
      verifyStaticSubpath({ distDir: root, repositoryPath: '/GLTFVisu/' }),
      /Non-PNG portrait asset: assets\/uv-grid-a\.svg/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects an unexpectedly inlined portrait', async () => {
  const root = await createFixture({ inlinePortraits: ['data:image/png;base64,iVBORw0KGgo='] })
  try {
    await assert.rejects(
      verifyStaticSubpath({ distDir: root, repositoryPath: '/GLTFVisu/' }),
      /Unexpected inline portrait/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('ignores unrelated inline SVG data in a dependency chunk', async () => {
  const root = await createFixture({ auxiliaryInlineSvgCount: 8 })
  try {
    const result = await verifyStaticSubpath({ distDir: root, repositoryPath: '/GLTFVisu/' })
    assert.equal(result.portraitCount, 8)
    assert.equal(result.unresolved.length, 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
