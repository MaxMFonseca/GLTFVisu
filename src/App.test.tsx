import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ShaderRepository } from './application/ShaderRepository'
import type { ViewerPort } from './application/ViewerPort'
import App from './App'
import { BUILTIN_ENVIRONMENTS } from './domain/environments'

afterEach(cleanup)

describe('shader workspace shell', () => {
  it('shows the workspace landmark and empty viewer guidance', async () => {
    const repository: ShaderRepository = {
      list: vi.fn(async () => []),
      get: vi.fn(async () => undefined),
      save: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    }
    const engine: ViewerPort = {
      loadModel: vi.fn(async (_files, root) => ({ name: root.name, meshCount: 1, animationClips: [], textureSlots: [] })),
      replaceModelTexture: vi.fn(async () => []),
      restoreModelTexture: vi.fn(async () => []),
      fitModel: vi.fn(),
      resize: vi.fn(),
      compileShader: vi.fn(async () => ({ status: 'valid' as const, generation: 1 })),
      updateParameter: vi.fn(),
      loadEnvironment: vi.fn(async () => undefined),
      updateEnvironment: vi.fn(),
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
    await waitFor(() => expect(engine.loadEnvironment).toHaveBeenCalledWith({
      kind: 'bundled',
      id: BUILTIN_ENVIRONMENTS[0].id,
      url: BUILTIN_ENVIRONMENTS[0].hdrUrl,
    }))
    expect(engine.loadEnvironment).toHaveBeenCalledTimes(1)

    result.unmount()
    await waitFor(() => expect(engine.dispose).toHaveBeenCalledOnce())
  })

  it('hydrates and runs commands with one viewer through a Strict Mode probe', async () => {
    const user = userEvent.setup()
    const engine: ViewerPort = {
      loadModel: vi.fn(async (_files, root) => ({ name: root.name, meshCount: 1, animationClips: [], textureSlots: [] })),
      replaceModelTexture: vi.fn(async () => []),
      restoreModelTexture: vi.fn(async () => []),
      fitModel: vi.fn(),
      resize: vi.fn(),
      compileShader: vi.fn(async () => ({ status: 'valid' as const, generation: 1 })),
      updateParameter: vi.fn(),
      loadEnvironment: vi.fn(async () => undefined),
      updateEnvironment: vi.fn(),
      capturePortrait: vi.fn(async () => ({
        kind: 'captured' as const, blob: new Blob(), mimeType: 'image/png' as const, width: 1, height: 1,
      })),
      selectAnimation: vi.fn(),
      setAnimationPlaying: vi.fn(),
      dispose: vi.fn(),
    }
    const createViewer = vi.fn(() => engine)

    const result = render(
      <StrictMode><App createViewer={createViewer} /></StrictMode>,
    )
    await screen.findByText(/create a shader or duplicate a built-in/i)
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0))
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
    expect(screen.queryByText(/indexeddb transaction setup failed/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Create shader' }))

    expect(await screen.findByRole('button', { name: 'Untitled shader' })).toHaveAttribute('aria-current', 'true')
    expect(createViewer).toHaveBeenCalledOnce()
    expect(engine.dispose).not.toHaveBeenCalled()
    expect(engine.loadEnvironment).toHaveBeenCalledTimes(1)
    expect(engine.loadEnvironment).toHaveBeenCalledWith({
      kind: 'bundled',
      id: BUILTIN_ENVIRONMENTS[0].id,
      url: BUILTIN_ENVIRONMENTS[0].hdrUrl,
    })

    result.unmount()
    await vi.waitFor(() => expect(engine.dispose).toHaveBeenCalledOnce())
  })

  it('loads the default environment once for each true provider lifetime', async () => {
    const repository: ShaderRepository = {
      list: vi.fn(async () => []),
      get: vi.fn(async () => undefined),
      save: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    }
    const engines = [0, 1].map((): ViewerPort => ({
      loadModel: vi.fn(async (_files, root) => ({ name: root.name, meshCount: 1, animationClips: [], textureSlots: [] })),
      replaceModelTexture: vi.fn(async () => []),
      restoreModelTexture: vi.fn(async () => []),
      fitModel: vi.fn(),
      resize: vi.fn(),
      compileShader: vi.fn(async () => ({ status: 'valid' as const, generation: 1 })),
      updateParameter: vi.fn(),
      loadEnvironment: vi.fn(async () => undefined),
      updateEnvironment: vi.fn(),
      capturePortrait: vi.fn(async () => ({
        kind: 'captured' as const, blob: new Blob(), mimeType: 'image/png' as const, width: 1, height: 1,
      })),
      selectAnimation: vi.fn(),
      setAnimationPlaying: vi.fn(),
      dispose: vi.fn(),
    }))
    const createViewer = vi.fn()
      .mockReturnValueOnce(engines[0])
      .mockReturnValueOnce(engines[1])

    const first = render(<App repository={repository} createViewer={createViewer} />)
    await waitFor(() => expect(engines[0].loadEnvironment).toHaveBeenCalledOnce())
    first.unmount()
    await waitFor(() => expect(engines[0].dispose).toHaveBeenCalledOnce())

    const second = render(<App repository={repository} createViewer={createViewer} />)
    await waitFor(() => expect(engines[1].loadEnvironment).toHaveBeenCalledOnce())
    expect(createViewer).toHaveBeenCalledTimes(2)
    for (const engine of engines) {
      expect(engine.loadEnvironment).toHaveBeenCalledWith({
        kind: 'bundled',
        id: BUILTIN_ENVIRONMENTS[0].id,
        url: BUILTIN_ENVIRONMENTS[0].hdrUrl,
      })
    }

    second.unmount()
    await waitFor(() => expect(engines[1].dispose).toHaveBeenCalledOnce())
  })
})
