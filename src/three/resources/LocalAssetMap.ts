import { basename, normalizeResourcePath, relativePathForFile } from './path'

export interface ClassifiedModelFiles {
  roots: File[]
  resources: Map<string, File>
  collisions: string[]
}

export interface ObjectUrlApi {
  createObjectURL(file: File): string
  revokeObjectURL(url: string): void
}

function comparePaths(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: 'variant' })
}

function isRootModel(path: string): boolean {
  return /\.gl(?:b|tf)$/i.test(path)
}

export function classifyModelFiles(files: readonly File[]): ClassifiedModelFiles {
  const ordered = [...files]
    .map((file) => ({ file, path: relativePathForFile(file) }))
    .sort((left, right) => comparePaths(left.path, right.path) || comparePaths(left.file.name, right.file.name))
  const resources = new Map<string, File>()
  const names = new Map<string, string[]>()

  for (const { file, path } of ordered) {
    if (resources.has(path)) continue
    resources.set(path, file)
    const paths = names.get(basename(path)) ?? []
    paths.push(path)
    names.set(basename(path), paths)
  }

  const collisions = [...names]
    .filter(([, paths]) => new Set(paths).size > 1)
    .map(([name]) => name)
    .sort(comparePaths)

  return {
    roots: [...resources]
      .filter(([path]) => isRootModel(path))
      .map(([, file]) => file),
    resources,
    collisions,
  }
}

export class LocalAssetMap {
  private readonly filesByBasename = new Map<string, File[]>()
  private readonly pathsByBasename = new Map<string, string[]>()
  private readonly urls = new Map<File, string>()
  private revoked = false

  constructor(
    private readonly classified: ClassifiedModelFiles,
    private readonly objectUrls: ObjectUrlApi = URL,
  ) {
    for (const [path, file] of classified.resources) {
      const name = basename(path)
      const files = this.filesByBasename.get(name) ?? []
      const paths = this.pathsByBasename.get(name) ?? []
      files.push(file)
      paths.push(path)
      this.filesByBasename.set(name, files)
      this.pathsByBasename.set(name, paths)
    }
  }

  resolve(requestedUrl: string): string {
    if (this.revoked) throw new Error('Local asset map has been revoked')

    const requestedPath = relativePathForRequest(requestedUrl)
    const exact = this.classified.resources.get(requestedPath)
    if (exact) return this.urlFor(exact)

    const name = basename(requestedPath)
    const candidates = this.filesByBasename.get(name) ?? []
    if (candidates.length === 1) return this.urlFor(candidates[0])
    if (candidates.length > 1) {
      const paths = this.pathsByBasename.get(name) ?? []
      throw new Error(`Ambiguous local resource: ${name} (${paths.join(', ')})`)
    }

    throw new Error(`Missing local resource: ${requestedPath}`)
  }

  revoke(): void {
    if (this.revoked) return
    this.revoked = true
    for (const url of this.urls.values()) this.objectUrls.revokeObjectURL(url)
    this.urls.clear()
  }

  private urlFor(file: File): string {
    const existing = this.urls.get(file)
    if (existing) return existing
    const url = this.objectUrls.createObjectURL(file)
    this.urls.set(file, url)
    return url
  }
}

function relativePathForRequest(url: string): string {
  // Requests are paths emitted by GLTFLoader, unlike local File objects.
  // URL parsing would incorrectly treat a local relative path as an HTTP URL.
  return normalizeResourcePath(url)
}
