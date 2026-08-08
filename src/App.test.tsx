import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ShaderRepository } from './application/ShaderRepository'
import type { ViewerPort } from './application/ViewerPort'
import App from './App'

afterEach(cleanup)

describe('shader workspace shell', () => {
  it('shows the workspace landmark and empty viewer guidance', () => {
    const repository: ShaderRepository = {
      list: vi.fn(async () => []),
      get: vi.fn(async () => undefined),
      save: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    }
    const engine: ViewerPort = {
      loadModel: vi.fn(async (_files, root) => ({ name: root.name, meshCount: 1, animationClips: [] })),
      fitModel: vi.fn(),
      compileShader: vi.fn(async () => ({ status: 'valid' as const, generation: 1 })),
      updateParameter: vi.fn(),
      capturePortrait: vi.fn(async () => ({
        kind: 'captured' as const, blob: new Blob(), mimeType: 'image/png' as const, width: 1, height: 1,
      })),
      selectAnimation: vi.fn(),
      setAnimationPlaying: vi.fn(),
      dispose: vi.fn(),
    }
    const createViewer = vi.fn(() => engine)

    const result = render(<App repository={repository} createViewer={createViewer} />)

    expect(screen.getByRole('main', { name: /shader workspace/i })).toBeVisible()
    expect(screen.getByText(/drop a glb/i)).toBeVisible()
    expect(createViewer).toHaveBeenCalledOnce()

    result.unmount()
    expect(engine.dispose).toHaveBeenCalledOnce()
  })
})
