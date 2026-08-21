import { createServer } from 'node:http'
import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, extname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const TEXT_EXTENSIONS = new Set(['.css', '.html', '.js'])
const CLOSURE_EXTENSIONS = new Set(['.css', '.hdr', '.js', '.png', '.svg'])
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

function normalizeRepositoryPath(value) {
  if (!value.startsWith('/') || value === '/') throw new Error('Repository path must be a non-root absolute path')
  return value.endsWith('/') ? value : `${value}/`
}

async function listFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...await listFiles(root, path))
    else if (entry.isFile()) files.push(relative(root, path).split(sep).join('/'))
  }
  return files
}

function addMatches(references, source, expression) {
  for (const match of source.matchAll(expression)) references.add(match[1])
}

function referencedAssets(source, extension) {
  const references = new Set()
  if (extension === '.html') addMatches(references, source, /(?:src|href)=["']([^"'#]+)["']/g)
  if (extension === '.css') addMatches(references, source, /url\(\s*["']?([^"')]+)["']?\s*\)/g)
  if (extension === '.js') {
    addMatches(references, source, /new URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g)
    addMatches(references, source, /import\(\s*["']([^"']+)["']\s*\)/g)
    addMatches(references, source, /["'](\.\.?\/[^"']+\.(?:css|hdr|js|png|svg))["']/g)
  }
  return [...references].filter((reference) => !reference.startsWith('data:'))
}

function contentType(path) {
  switch (extname(path)) {
    case '.css': return 'text/css; charset=utf-8'
    case '.hdr': return 'application/octet-stream'
    case '.html': return 'text/html; charset=utf-8'
    case '.js': return 'text/javascript; charset=utf-8'
    case '.png': return 'image/png'
    case '.svg': return 'image/svg+xml'
    default: return 'application/octet-stream'
  }
}

async function listen(server) {
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Static preview did not expose a TCP port')
  return address.port
}

async function close(server) {
  await new Promise((resolvePromise, reject) => server.close((error) => error === undefined ? resolvePromise() : reject(error)))
}

export async function verifyStaticSubpath({ distDir, repositoryPath = '/GLTFVisu/' }) {
  const distRoot = resolve(distDir)
  const subpath = normalizeRepositoryPath(repositoryPath)
  const files = await listFiles(distRoot)
  if (!files.includes('index.html')) throw new Error(`Static build is missing ${resolve(distRoot, 'index.html')}`)

  const textFiles = new Map()
  for (const file of files.filter((candidate) => TEXT_EXTENSIONS.has(extname(candidate)))) {
    const source = await readFile(resolve(distRoot, file), 'utf8')
    if (/["'(=]\s*\/assets\//.test(source)) {
      throw new Error(`${file} contains a root-absolute /assets request`)
    }
    textFiles.set(file, source)
  }

  const requests = []
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
      requests.push(requestUrl.pathname)
      if (requestUrl.pathname !== subpath && !requestUrl.pathname.startsWith(subpath)) {
        response.writeHead(404).end('Outside repository subpath')
        return
      }
      const encodedRelative = requestUrl.pathname === subpath ? 'index.html' : requestUrl.pathname.slice(subpath.length)
      const relativePath = decodeURIComponent(encodedRelative)
      const filePath = resolve(distRoot, relativePath)
      if (filePath !== distRoot && !filePath.startsWith(`${distRoot}${sep}`)) {
        response.writeHead(404).end('Invalid path')
        return
      }
      if (!(await stat(filePath)).isFile()) {
        response.writeHead(404).end('Not found')
        return
      }
      response.writeHead(200, { 'content-type': contentType(filePath) })
      response.end(await readFile(filePath))
    } catch {
      response.writeHead(404).end('Not found')
    }
  })

  const port = await listen(server)
  const origin = `http://127.0.0.1:${port}`
  const queue = [new URL(subpath, origin)]
  const visited = new Set()
  const unresolved = []

  try {
    while (queue.length > 0) {
      const url = queue.shift()
      if (visited.has(url.href)) continue
      visited.add(url.href)
      const response = await fetch(url)
      if (!response.ok) {
        unresolved.push(`${url.pathname} (${response.status})`)
        continue
      }
      const extension = url.pathname.endsWith('/') ? '.html' : extname(url.pathname)
      if (!TEXT_EXTENSIONS.has(extension)) continue
      const source = await response.text()
      for (const reference of referencedAssets(source, extension)) {
        const resolved = new URL(reference, url)
        if (resolved.origin === origin && !visited.has(resolved.href)) queue.push(resolved)
      }
    }
  } finally {
    await close(server)
  }

  const crawledFiles = new Set([...visited]
    .map((href) => new URL(href).pathname)
    .filter((pathname) => pathname.startsWith(subpath) && pathname !== subpath)
    .map((pathname) => decodeURIComponent(pathname.slice(subpath.length))))
  const requiredFiles = files.filter((file) => CLOSURE_EXTENSIONS.has(extname(file)))
  for (const file of requiredFiles) {
    if (!crawledFiles.has(file)) unresolved.push(`${subpath}${file} (not referenced)`)
  }

  const hdrCount = files.filter((file) => extname(file) === '.hdr').length
  const emittedPortraits = files
    .filter((file) => extname(file) === '.png')
    .map((file) => ({ file, slug: portraitSlug(file, '.png') }))
    .filter(({ slug }) => slug !== undefined)
  const portraitSlugs = [...new Set(emittedPortraits.map(({ slug }) => slug))].sort()
  const portraitCount = emittedPortraits.length
  const nonPngPortraits = files.filter((file) => extname(file) !== '.png' && portraitSlug(file) !== undefined)
  const ownersByPortraitFile = assetOwners(textFiles, emittedPortraits.map(({ file }) => file))
  const portraitOwners = Object.fromEntries(PORTRAIT_SLUGS.map((slug) => [
    slug,
    [...new Set(emittedPortraits
      .filter((portrait) => portrait.slug === slug)
      .flatMap(({ file }) => ownersByPortraitFile.get(file) ?? []))].sort(),
  ]))
  const workerCount = files.filter((file) => /^editor\.worker-[\w-]+\.js$/.test(basename(file))).length

  if (hdrCount !== 4) unresolved.push(`Expected 4 emitted HDRs, found ${hdrCount}`)
  for (const slug of PORTRAIT_SLUGS) {
    const count = emittedPortraits.filter((portrait) => portrait.slug === slug).length
    if (count === 0) unresolved.push(`Missing emitted portrait: ${slug}`)
    if (count > 1) unresolved.push(`Duplicate emitted portrait: ${slug}`)
  }
  for (const { file, slug } of emittedPortraits) {
    const owners = ownersByPortraitFile.get(file) ?? []
    if (owners.length !== 1) {
      unresolved.push(`Portrait ${slug} must have exactly one owning reference, found ${owners.length}`)
    }
  }
  for (const file of nonPngPortraits) unresolved.push(`Non-PNG portrait asset: ${file}`)
  if (portraitCount !== 8) unresolved.push(`Expected 8 bundled portraits, found ${portraitCount}`)
  if (workerCount !== 1) unresolved.push(`Expected 1 Monaco editor worker, found ${workerCount}`)
  if (requests.some((request) => request.startsWith('/assets/'))) unresolved.push('Observed a request beginning at /assets')
  if (requests.some((request) => !request.startsWith(subpath))) unresolved.push('Observed a request outside the repository subpath')
  if (unresolved.length > 0) throw new Error(`Static subpath closure failed:\n- ${unresolved.join('\n- ')}`)

  return {
    hdrCount,
    portraitCount,
    portraitSlugs,
    portraitOwners,
    workerCount,
    requests,
    unresolved,
    jsCssCount: files.filter((file) => extname(file) === '.js' || extname(file) === '.css').length,
  }
}

function assetOwners(textFiles, targetFiles) {
  const targets = new Set(targetFiles)
  const owners = new Map(targetFiles.map((file) => [file, new Set()]))
  for (const [ownerFile, source] of textFiles) {
    for (const reference of referencedAssets(source, extname(ownerFile))) {
      const referencedFile = resolveReferencedFile(ownerFile, reference)
      if (referencedFile !== undefined && targets.has(referencedFile)) {
        owners.get(referencedFile).add(ownerFile)
      }
    }
  }
  return new Map([...owners].map(([file, fileOwners]) => [file, [...fileOwners].sort()]))
}

function resolveReferencedFile(ownerFile, reference) {
  const origin = 'https://static.invalid/'
  const resolved = new URL(reference, new URL(ownerFile, origin))
  if (resolved.origin !== origin.slice(0, -1)) return undefined
  return decodeURIComponent(resolved.pathname.slice(1))
}

function portraitSlug(file, requiredExtension) {
  const extension = extname(file)
  if (requiredExtension !== undefined && extension !== requiredExtension) return undefined
  const filename = basename(file, extension)
  return PORTRAIT_SLUGS.find((slug) => new RegExp(`^${slug}-[\\w-]+$`).test(filename))
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const distDir = process.argv[2] ?? 'dist'
  const repositoryPath = process.argv[3] ?? '/GLTFVisu/'
  const result = await verifyStaticSubpath({ distDir, repositoryPath })
  console.log(`Static subpath closure passed: ${result.requests.length} requests, ${result.hdrCount} HDRs, ${result.portraitCount} portraits, ${result.workerCount} Monaco worker, ${result.jsCssCount} JS/CSS chunks.`)
}
