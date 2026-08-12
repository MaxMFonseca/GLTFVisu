import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceProvider, useWorkspace } from '../../application/WorkspaceController'
import type { ShaderRepository } from '../../application/ShaderRepository'
import type { ViewerPort } from '../../application/ViewerPort'
import { ViewerHost, type ViewerMountFactory } from './ViewerHost'

afterEach(cleanup)

function repository(): ShaderRepository {
  return {
    list: vi.fn(async () => []),
    get: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function createViewer(loadModel: ViewerPort['loadModel'] = vi.fn(async (_files, root) => ({
  name: root.name, meshCount: 1, animationClips: [],
}))): ViewerPort {
  return {
    loadModel,
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
}

function LoadControl() {
  const { commands } = useWorkspace()
  return <button type="button" onClick={() => {
    const root = new File(['model'], 'broken.glb')
    void commands.loadModel([root], root)
  }}>Load fixture</button>
}

describe('ViewerHost', () => {
  it('mounts one engine into a canvas-only host and tears it down once', () => {
    const dispose = vi.fn()
    const mount: ViewerMountFactory = vi.fn((host) => {
      host.append(document.createElement('canvas'))
      return { dispose }
    })
    const result = render(
      <WorkspaceProvider repository={repository()} viewer={createViewer()}>
        <ViewerHost mountViewer={mount} />
      </WorkspaceProvider>,
    )

    const canvasHost = screen.getByTestId('viewer-canvas')
    expect(mount).toHaveBeenCalledOnce()
    expect(canvasHost.children).toHaveLength(1)
    expect(canvasHost.firstElementChild?.tagName).toBe('CANVAS')
    expect(screen.getByText(/load a glb or gltf/i)).not.toBe(canvasHost)

    result.rerender(
      <WorkspaceProvider repository={repository()} viewer={createViewer()}>
        <ViewerHost mountViewer={mount} />
      </WorkspaceProvider>,
    )
    expect(mount).toHaveBeenCalledOnce()
    result.unmount()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('shows loading and recoverable model errors outside the canvas host', async () => {
    const user = userEvent.setup()
    const load = deferred<{ name: string; meshCount: number; animationClips: readonly string[] }>()
    const modelViewer = createViewer(vi.fn(() => load.promise))
    const mount: ViewerMountFactory = () => ({ dispose: vi.fn() })
    render(
      <WorkspaceProvider repository={repository()} viewer={modelViewer}>
        <LoadControl />
        <ViewerHost mountViewer={mount} />
      </WorkspaceProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Load fixture' }))
    expect(screen.getByRole('status')).toHaveTextContent('Loading broken.glb')
    expect(screen.getByTestId('viewer-canvas')).not.toContainElement(screen.getByRole('status'))

    load.reject(new Error('Invalid binary header'))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Invalid binary header'))
    expect(screen.getByTestId('viewer-canvas')).not.toContainElement(screen.getByRole('alert'))
  })
})
