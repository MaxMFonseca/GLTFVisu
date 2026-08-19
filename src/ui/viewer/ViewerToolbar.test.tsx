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
      name: root.name,
      meshCount: 2,
      animationClips: [{ id: 'clip-0', label: 'Idle' }, { id: 'clip-1', label: 'Run' }],
      textureSlots: [],
    })),
    replaceModelTexture: vi.fn(async () => []),
    restoreModelTexture: vi.fn(async () => []),
    fitModel: vi.fn(),
    resize: vi.fn(),
    compileShader: vi.fn(async () => ({ status: 'valid' as const, generation: 1 })),
    updateParameter: vi.fn(),
    loadEnvironment: vi.fn(async () => undefined),
    updateEnvironment: vi.fn(),
    updateCamera: vi.fn(),
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

    await user.selectOptions(screen.getByRole('combobox', { name: 'Animation clip' }), 'clip-1')
    expect(modelViewer.selectAnimation).toHaveBeenCalledWith('clip-1')

    await user.click(screen.getByRole('button', { name: 'Play animation' }))
    expect(modelViewer.setAnimationPlaying).toHaveBeenCalledWith(true)
    expect(screen.getByRole('button', { name: 'Pause animation' })).toBeEnabled()
  })

  it('renders duplicate animation names as separate selectable options', async () => {
    const modelViewer = createViewer()
    vi.mocked(modelViewer.loadModel).mockResolvedValueOnce({
      name: 'robot.glb',
      meshCount: 2,
      animationClips: [
        { id: 'clip-0', label: 'Idle (1)' },
        { id: 'clip-1', label: 'Idle (2)' },
      ],
      textureSlots: [],
    })
    const user = userEvent.setup()
    render(
      <WorkspaceProvider repository={repository()} viewer={modelViewer}>
        <ModelControl />
        <ViewerToolbar />
      </WorkspaceProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'Load fixture' }))

    expect(screen.getAllByRole('option').map((option) => [option.getAttribute('value'), option.textContent])).toEqual([
      ['clip-0', 'Idle (1)'],
      ['clip-1', 'Idle (2)'],
    ])
    await user.selectOptions(screen.getByRole('combobox', { name: 'Animation clip' }), 'clip-1')
    expect(modelViewer.selectAnimation).toHaveBeenCalledWith('clip-1')
  })

  it('opens accessible environment settings from the toolbar', async () => {
    const user = userEvent.setup()
    render(
      <WorkspaceProvider repository={repository()} viewer={createViewer()}>
        <ViewerToolbar />
      </WorkspaceProvider>,
    )

    const trigger = screen.getByRole('button', { name: 'Environment' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).not.toHaveAttribute('aria-controls')

    await user.click(trigger)

    const region = screen.getByRole('region', { name: 'Environment settings' })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(trigger).toHaveAttribute('aria-controls', region.id)
    expect(region).toBeVisible()
    expect(screen.getByLabelText('Bundled environment')).toBeDisabled()
  })

  it('opens camera settings and exposes controls for the active projection', async () => {
    const user = userEvent.setup()
    const viewer = createViewer()
    render(
      <WorkspaceProvider repository={repository()} viewer={viewer}>
        <ViewerToolbar />
      </WorkspaceProvider>,
    )

    const trigger = screen.getByRole('button', { name: 'Camera' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    await user.click(trigger)

    const region = screen.getByRole('region', { name: 'Camera settings' })
    expect(trigger).toHaveAttribute('aria-controls', region.id)
    expect(screen.getByRole('radio', { name: 'Perspective' })).toBeChecked()
    expect(screen.getByLabelText('Field of view value')).toHaveValue(45)
    expect(screen.queryByLabelText('Orthographic zoom value')).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: 'Orthographic' }))

    expect(screen.getByRole('radio', { name: 'Orthographic' })).toBeChecked()
    expect(screen.queryByLabelText('Field of view value')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Orthographic zoom value')).toHaveValue(1)
    expect(viewer.updateCamera).toHaveBeenCalledWith({
      projection: 'orthographic',
      near: 0.01,
      far: 1000,
      fov: 45,
      zoom: 1,
    })
  })
})
