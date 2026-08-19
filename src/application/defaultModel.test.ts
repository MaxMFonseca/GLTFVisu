import { describe, expect, it, vi } from 'vitest'
import { fetchDefaultModel, fetchDefaultModelBlob } from './defaultModel'

describe('default model adapter', () => {
  it('fetches the configured URL and constructs a binary glTF file', async () => {
    const fetcher = vi.fn(async () => new Blob(['glb'], { type: 'model/gltf-binary' }))

    await expect(fetchDefaultModel(
      { url: '/assets/fox.glb', fileName: 'Fox.glb' },
      fetcher,
    )).resolves.toMatchObject({ name: 'Fox.glb', type: 'model/gltf-binary' })
    expect(fetcher).toHaveBeenCalledWith('/assets/fox.glb')
  })

  it('propagates a rejected fetch', async () => {
    const failure = new Error('network unavailable')

    await expect(fetchDefaultModel(
      { url: '/assets/fox.glb', fileName: 'Fox.glb' },
      vi.fn(async () => { throw failure }),
    )).rejects.toBe(failure)
  })

  it('rejects an empty default model filename without fetching', async () => {
    const fetcher = vi.fn(async () => new Blob(['glb']))

    await expect(fetchDefaultModel(
      { url: '/assets/fox.glb', fileName: '  ' },
      fetcher,
    )).rejects.toThrow('Invalid default model filename')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('downloads the default model through the browser fetch API', async () => {
    const fetcher = vi.fn(async () => new Response('glb', {
      status: 200,
      headers: { 'content-type': 'model/gltf-binary' },
    }))

    const blob = await fetchDefaultModelBlob('/assets/fox.glb', fetcher)

    expect(await blob.text()).toBe('glb')
    expect(blob.type).toBe('model/gltf-binary')
    expect(fetcher).toHaveBeenCalledWith('/assets/fox.glb')
  })

  it('reports a stable error when the bundled asset response is not OK', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 404 }))

    await expect(fetchDefaultModelBlob('/assets/missing.glb', fetcher))
      .rejects.toThrow('Unable to load the default model')
  })
})
