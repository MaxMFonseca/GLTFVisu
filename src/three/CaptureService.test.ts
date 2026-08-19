import { OrthographicCamera, PerspectiveCamera, Scene, type Camera } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { CaptureError, CaptureService, type CaptureRenderer } from './CaptureService'

interface CanvasFixture {
  canvas: HTMLCanvasElement
  drawImage: ReturnType<typeof vi.fn>
  toBlob: ReturnType<typeof vi.fn>
}

function outputCanvas(blobs: Array<Blob | null>): CanvasFixture {
  const canvas = document.createElement('canvas')
  const drawImage = vi.fn()
  const toBlob = vi.fn((callback: BlobCallback) => callback(blobs.shift() ?? null))
  Object.defineProperty(canvas, 'getContext', { value: () => ({ drawImage }) })
  Object.defineProperty(canvas, 'toBlob', { value: toBlob })
  return { canvas, drawImage, toBlob }
}

function rendererCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

describe('CaptureService', () => {
  it('renders once and copies a bounded aspect-preserving WebP thumbnail', async () => {
    const source = rendererCanvas(1600, 900)
    const renderer: CaptureRenderer = { domElement: source, render: vi.fn() }
    const webp = new Blob(['webp'], { type: 'image/webp' })
    const output = outputCanvas([webp])
    const capture = new CaptureService(renderer, new Scene(), new PerspectiveCamera(), {
      createCanvas: () => output.canvas,
      maxDimension: 512,
    })

    const result = await capture.capture()

    expect(result).toEqual({ mimeType: 'image/webp', blob: webp, width: 512, height: 288 })
    expect(renderer.render).toHaveBeenCalledTimes(1)
    expect(output.drawImage).toHaveBeenCalledWith(source, 0, 0, 512, 288)
    expect(output.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.82)
    expect(source.width).toBe(1600)
    expect(source.height).toBe(900)
  })

  it('falls back to PNG when WebP encoding returns no blob', async () => {
    const renderer: CaptureRenderer = { domElement: rendererCanvas(300, 600), render: vi.fn() }
    const png = new Blob(['png'], { type: 'image/png' })
    const output = outputCanvas([null, png])
    const capture = new CaptureService(renderer, new Scene(), new PerspectiveCamera(), {
      createCanvas: () => output.canvas,
      maxDimension: 512,
    })

    await expect(capture.capture()).resolves.toEqual({
      mimeType: 'image/png',
      blob: png,
      width: 256,
      height: 512,
    })
    expect(output.toBlob).toHaveBeenNthCalledWith(2, expect.any(Function), 'image/png')
  })

  it('rejects a null PNG fallback as a recoverable capture error', async () => {
    const renderer: CaptureRenderer = { domElement: rendererCanvas(10, 10), render: vi.fn() }
    const output = outputCanvas([null, null])
    const capture = new CaptureService(renderer, new Scene(), new PerspectiveCamera(), {
      createCanvas: () => output.canvas,
    })

    await expect(capture.capture()).rejects.toBeInstanceOf(CaptureError)
  })

  it('renders with the camera active when capture begins', async () => {
    const renderer: CaptureRenderer = { domElement: rendererCanvas(10, 10), render: vi.fn() }
    const output = outputCanvas([new Blob(['webp'], { type: 'image/webp' })])
    let activeCamera: Camera = new PerspectiveCamera()
    const capture = new CaptureService(renderer, new Scene(), () => activeCamera, {
      createCanvas: () => output.canvas,
    })
    activeCamera = new OrthographicCamera()

    await capture.capture()

    expect(renderer.render).toHaveBeenCalledWith(expect.any(Scene), activeCamera)
  })
})
