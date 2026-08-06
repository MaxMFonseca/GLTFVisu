import { LoadingManager } from 'three'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { LocalAssetMap, classifyModelFiles } from './resources/LocalAssetMap'
import { directoryOf, relativePathForFile } from './resources/path'

export type ModelLoadErrorCode = 'missing-resource' | 'malformed' | 'unsupported-resource' | 'aborted'

export class ModelLoadError extends Error {
  constructor(
    readonly code: ModelLoadErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'ModelLoadError'
  }
}

export class GltfAssetLoader {
  async load(files: readonly File[], rootFile: File, signal?: AbortSignal): Promise<GLTF> {
    if (signal?.aborted) throw new ModelLoadError('aborted', 'Model loading was aborted')

    const rootPath = relativePathForFile(rootFile)
    if (!/\.gl(?:b|tf)$/i.test(rootPath)) {
      throw new ModelLoadError('unsupported-resource', `Unsupported model resource: ${rootPath}`)
    }

    const assets = new LocalAssetMap(classifyModelFiles(files))
    const manager = new LoadingManager()
    const requestedByObjectUrl = new Map<string, string>()
    let failedRequest: string | undefined
    manager.setURLModifier((url) => {
      if (url.startsWith('data:')) return url
      const objectUrl = assets.resolve(url)
      requestedByObjectUrl.set(objectUrl, url)
      return objectUrl
    })
    manager.onError = (url) => {
      failedRequest = requestedByObjectUrl.get(url) ?? url
    }
    const loader = new GLTFLoader(manager)
    const basePath = directoryOf(rootPath)

    try {
      const data = rootPath.toLowerCase().endsWith('.glb') ? await rootFile.arrayBuffer() : await rootFile.text()
      if (signal?.aborted) throw new ModelLoadError('aborted', 'Model loading was aborted')

      const gltf = await parseGltf(loader, data, basePath, signal)
      if (signal?.aborted) throw new ModelLoadError('aborted', 'Model loading was aborted')
      return gltf
    } catch (error) {
      if (error instanceof ModelLoadError) throw error
      throw translateLoadError(error, signal, failedRequest)
    } finally {
      // GLTFLoader calls its parse callbacks only after its dependent resources settle.
      assets.revoke()
    }
  }
}

function parseGltf(loader: GLTFLoader, data: string | ArrayBuffer, basePath: string, signal?: AbortSignal): Promise<GLTF> {
  return new Promise((resolve, reject) => {
    let settled = false
    const removeAbortListener = () => signal?.removeEventListener('abort', abort)
    const resolveOnce = (gltf: GLTF) => {
      if (settled) return
      settled = true
      removeAbortListener()
      resolve(gltf)
    }
    const rejectOnce = (error: unknown) => {
      if (settled) return
      settled = true
      removeAbortListener()
      reject(error)
    }
    const abort = () => rejectOnce(new ModelLoadError('aborted', 'Model loading was aborted'))

    if (signal?.aborted) {
      abort()
      return
    }
    signal?.addEventListener('abort', abort, { once: true })
    try {
      loader.parse(data, basePath, resolveOnce, rejectOnce)
    } catch (error) {
      rejectOnce(error)
    }
  })
}

function translateLoadError(error: unknown, signal?: AbortSignal, failedRequest?: string): ModelLoadError {
  if (signal?.aborted || error instanceof DOMException && error.name === 'AbortError') {
    return new ModelLoadError('aborted', 'Model loading was aborted', error)
  }

  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('Missing local resource:')) {
    return new ModelLoadError('missing-resource', message, error)
  }
  if (failedRequest || /Failed to fetch|NetworkError|404|not found|Unable to load/i.test(message)) {
    return new ModelLoadError('missing-resource', `Missing local resource: ${failedRequest ?? message}`, error)
  }
  if (/DRACOLoader|KTX2Loader|MeshoptDecoder|KHR_draco_mesh_compression|KHR_texture_basisu|EXT_meshopt_compression|Unsupported (?:glTF )?(?:extension|asset|resource)/i.test(message)) {
    return new ModelLoadError('unsupported-resource', `Unsupported local model resource: ${message}`, error)
  }
  return new ModelLoadError('malformed', `Unable to parse local model: ${message}`, error)
}
