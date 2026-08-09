import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceProvider, useWorkspace } from '../../application/WorkspaceController'
import type { ShaderRepository } from '../../application/ShaderRepository'
import type { ViewerPort } from '../../application/ViewerPort'
import { ViewerToolbar } from './ViewerToolbar'

afterEach(cleanup)

function repository(): ShaderRepository {
  return {
    list: vi.fn(async () => []),
    get: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  }
}

function createViewer(): ViewerPort {
  return {
    loadModel: vi.fn(async (_files, root) => ({
      name: root.name, meshCount: 2, animationClips: ['Idle', 'Run'],
    })),
    fitModel: vi.fn(),
    resize: vi.fn(),
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

function ModelControl() {
  const { commands } = useWorkspace()
  return <button type="button" onClick={() => {
    const root = new File(['model'], 'robot.glb')
    void commands.loadModel([root], root)
  }}>Load fixture</button>
}

describe('ViewerToolbar', () => {
  it('disables viewer actions until a model is available', () => {
    render(
      <WorkspaceProvider repository={repository()} viewer={createViewer()}>
        <ViewerToolbar />
      </WorkspaceProvider>,
    )

    expect(screen.getByRole('button', { name: 'Reset view' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Animation clip' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Play animation' })).toBeDisabled()
  })

  it('resets the view and controls the selected animation through workspace commands', async () => {
    const user = userEvent.setup()
    const modelViewer = createViewer()
    render(
      <WorkspaceProvider repository={repository()} viewer={modelViewer}>
        <ModelControl />
        <ViewerToolbar />
      </WorkspaceProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Load fixture' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reset view' })).toBeEnabled())

    await user.click(screen.getByRole('button', { name: 'Reset view' }))
    expect(modelViewer.fitModel).toHaveBeenCalledOnce()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Animation clip' }), 'Run')
    expect(modelViewer.selectAnimation).toHaveBeenCalledWith('Run')

    await user.click(screen.getByRole('button', { name: 'Pause animation' }))
    expect(modelViewer.setAnimationPlaying).toHaveBeenCalledWith(false)
    expect(screen.getByRole('button', { name: 'Play animation' })).toBeEnabled()
  })
})
