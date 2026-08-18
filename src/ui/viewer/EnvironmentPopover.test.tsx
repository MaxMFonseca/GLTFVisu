import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceProvider } from '../../application/WorkspaceController'
import type { ShaderRepository } from '../../application/ShaderRepository'
import type { ViewerPort } from '../../application/ViewerPort'
import type { EnvironmentDefinition } from '../../domain/environment'
import { ViewerToolbar } from './ViewerToolbar'

afterEach(cleanup)

const catalog: readonly EnvironmentDefinition[] = [{
  id: 'goegap',
  name: 'Desert — Goegap',
  hdrUrl: '/environments/goegap.hdr',
  license: 'CC0-1.0',
  sourceUrl: 'https://polyhaven.com/a/goegap',
  author: 'Poly Haven',
}]

function repository(): ShaderRepository {
  return {
    list: vi.fn(async () => []),
    get: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  }
}

function viewer(): ViewerPort {
  return {
    loadModel: vi.fn(async () => ({ name: 'model.glb', meshCount: 1, animationClips: [] })),
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
}

function renderPopover(options: {
  catalog?: readonly EnvironmentDefinition[]
} = {}) {
  const viewerPort = viewer()
  render(
    <WorkspaceProvider repository={repository()} viewer={viewerPort} environmentCatalog={options.catalog ?? catalog}>
      <ViewerToolbar />
    </WorkspaceProvider>,
  )
  return viewerPort
}

describe('EnvironmentPopover', () => {
  it('loads a catalog-backed bundled environment and a direct HDR URL', async () => {
    const user = userEvent.setup()
    const viewerPort = renderPopover()

    await user.click(screen.getByRole('button', { name: 'Environment' }))
    await user.selectOptions(screen.getByLabelText('Bundled environment'), 'goegap')
    await waitFor(() => expect(viewerPort.loadEnvironment).toHaveBeenCalledWith({
      kind: 'bundled', id: 'goegap', url: '/environments/goegap.hdr',
    }))

    await user.type(screen.getByLabelText('HDR URL'), 'https://assets.example/sky.hdr')
    await user.click(screen.getByRole('button', { name: 'Load HDR URL' }))
    await waitFor(() => expect(viewerPort.loadEnvironment).toHaveBeenCalledWith({
      kind: 'remote', url: 'https://assets.example/sky.hdr',
    }))
    expect(screen.getByText('Remote HDR must be a direct HTTPS URL and allow CORS.')).toBeVisible()
  })

  it('loads an HDR file and permits retrying the same file', async () => {
    const user = userEvent.setup()
    const viewerPort = renderPopover()
    const file = new File(['hdr'], 'studio.hdr', { type: 'image/vnd.radiance' })

    await user.click(screen.getByRole('button', { name: 'Environment' }))
    const input = screen.getByLabelText('Local HDR file')
    await user.upload(input, file)
    await user.upload(input, file)

    expect(viewerPort.loadEnvironment).toHaveBeenCalledTimes(2)
    expect(viewerPort.loadEnvironment).toHaveBeenLastCalledWith({ kind: 'local', file })
  })

  it('sends background and synchronized display settings through commands', async () => {
    const user = userEvent.setup()
    const viewerPort = renderPopover()
    await user.click(screen.getByRole('button', { name: 'Environment' }))

    await user.click(screen.getByRole('radio', { name: 'Clear color' }))
    expect(viewerPort.updateEnvironment).toHaveBeenLastCalledWith(expect.objectContaining({ backgroundMode: 'clear-color' }))

    fireEvent.change(screen.getByLabelText('Clear color picker'), { target: { value: '#336699' } })
    expect(viewerPort.updateEnvironment).toHaveBeenLastCalledWith(expect.objectContaining({ clearColor: '#336699' }))

    fireEvent.change(screen.getByRole('slider', { name: 'Environment rotation' }), { target: { value: '90' } })
    expect(viewerPort.updateEnvironment).toHaveBeenLastCalledWith(expect.objectContaining({ rotation: 90 }))
    expect(screen.getByRole('spinbutton', { name: 'Environment rotation value' })).toHaveValue(90)

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Environment rotation value' }), { target: { value: '180' } })
    expect(viewerPort.updateEnvironment).toHaveBeenLastCalledWith(expect.objectContaining({ rotation: 180 }))
    expect(screen.getByRole('slider', { name: 'Environment rotation' })).toHaveValue('180')

    fireEvent.change(screen.getByRole('slider', { name: 'Environment intensity' }), { target: { value: '2.5' } })
    expect(viewerPort.updateEnvironment).toHaveBeenLastCalledWith(expect.objectContaining({ intensity: 2.5 }))
    expect(screen.getByRole('spinbutton', { name: 'Environment intensity value' })).toHaveValue(2.5)

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Environment intensity value' }), { target: { value: '3.2' } })
    expect(viewerPort.updateEnvironment).toHaveBeenLastCalledWith(expect.objectContaining({ intensity: 3.2 }))
    expect(screen.getByRole('slider', { name: 'Environment intensity' })).toHaveValue('3.2')
  })

  it('shows loading and error feedback while keeping display controls usable', async () => {
    const loadingViewer = viewer()
    let completeLoad: (() => void) | undefined
    vi.mocked(loadingViewer.loadEnvironment).mockImplementation(() => new Promise<void>((resolve) => {
      completeLoad = resolve
    }))
    const user = userEvent.setup()
    render(
      <WorkspaceProvider repository={repository()} viewer={loadingViewer} environmentCatalog={catalog}>
        <ViewerToolbar />
      </WorkspaceProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'Environment' }))

    await user.selectOptions(screen.getByLabelText('Bundled environment'), 'goegap')

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Loading Desert — Goegap'))
    expect(screen.getByRole('button', { name: 'Load HDR URL' })).toBeDisabled()
    await user.click(screen.getByRole('radio', { name: 'Clear color' }))
    expect(loadingViewer.updateEnvironment).toHaveBeenLastCalledWith(expect.objectContaining({ backgroundMode: 'clear-color' }))
    completeLoad?.()

    cleanup()
    const failedViewer = viewer()
    vi.mocked(failedViewer.loadEnvironment).mockRejectedValueOnce(new Error('broken HDR'))
    render(
      <WorkspaceProvider repository={repository()} viewer={failedViewer} environmentCatalog={catalog}>
        <ViewerToolbar />
      </WorkspaceProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'Environment' }))
    await user.selectOptions(screen.getByLabelText('Bundled environment'), 'goegap')
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Unable to load environment'))
  })

  it('closes on Escape and outside click, returning keyboard focus to the trigger', async () => {
    const user = userEvent.setup()
    renderPopover()
    const trigger = screen.getByRole('button', { name: 'Environment' })
    await user.click(trigger)
    expect(screen.getByRole('region', { name: 'Environment settings' })).toBeVisible()

    const urlInput = screen.getByLabelText('HDR URL')
    urlInput.focus()
    expect(urlInput).toHaveFocus()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Environment settings' })).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()

    await user.click(trigger)
    const outsideControl = document.createElement('button')
    outsideControl.type = 'button'
    document.body.append(outsideControl)
    outsideControl.focus()
    fireEvent.pointerDown(outsideControl)
    expect(screen.queryByRole('region', { name: 'Environment settings' })).not.toBeInTheDocument()
    await Promise.resolve()
    expect(outsideControl).toHaveFocus()
    outsideControl.remove()
  })
})
