import type { Camera, Object3D } from 'three'

export interface CapturedImage {
  mimeType: 'image/webp' | 'image/png'
  blob: Blob
  width: number
  height: number
}

export interface CaptureRenderer {
  domElement: HTMLCanvasElement
  render(scene: Object3D, camera: Camera): void
}

export interface CaptureOptions {
  maxDimension?: number
  createCanvas?: () => HTMLCanvasElement
}

export class CaptureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CaptureError'
  }
}

/** Captures only the current renderer canvas into a bounded temporary canvas. */
export class CaptureService {
  private readonly maxDimension: number
  private readonly createCanvas: () => HTMLCanvasElement

  constructor(
    private readonly renderer: CaptureRenderer,
    private readonly scene: Object3D,
    private readonly camera: Camera | (() => Camera),
    options: CaptureOptions = {},
  ) {
    this.maxDimension = Math.max(1, Math.floor(options.maxDimension ?? 512))
    this.createCanvas = options.createCanvas ?? (() => document.createElement('canvas'))
  }

  async capture(): Promise<CapturedImage> {
    const source = this.renderer.domElement
    if (source.width < 1 || source.height < 1) throw new CaptureError('Viewer canvas is empty')

    this.renderer.render(this.scene, typeof this.camera === 'function' ? this.camera() : this.camera)
    const scale = Math.min(1, this.maxDimension / source.width, this.maxDimension / source.height)
    const width = Math.max(1, Math.round(source.width * scale))
    const height = Math.max(1, Math.round(source.height * scale))
    const canvas = this.createCanvas()
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (context === null) throw new CaptureError('Canvas capture is unavailable')
    context.drawImage(source, 0, 0, width, height)

    const webp = await encode(canvas, 'image/webp', 0.82)
    if (webp !== null) {
      const mimeType = webp.type === 'image/png' ? 'image/png' : 'image/webp'
      return { mimeType, blob: webp, width, height }
    }

    const png = await encode(canvas, 'image/png')
    if (png === null) throw new CaptureError('Unable to encode viewer capture')
    return { mimeType: 'image/png', blob: png, width, height }
  }
}

function encode(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (quality === undefined) canvas.toBlob(resolve, type)
    else canvas.toBlob(resolve, type, quality)
  })
}
