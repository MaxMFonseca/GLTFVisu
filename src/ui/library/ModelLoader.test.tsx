import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceProvider } from '../../application/WorkspaceController'
import type { ShaderRepository } from '../../application/ShaderRepository'
import type { ViewerPort } from '../../application/ViewerPort'
import { ModelLoader } from './ModelLoader'

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
    loadModel: vi.fn(async (_files, root) => ({ name: root.name, meshCount: 3, animationClips: [] })),
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

function renderLoader() {
  const modelViewer = createViewer()
  render(
    <WorkspaceProvider repository={repository()} viewer={modelViewer}>
      <ModelLoader />
    </WorkspaceProvider>,
  )
  return modelViewer
}

describe('ModelLoader', () => {
  it('loads a single model root with all selected local dependencies', async () => {
    const user = userEvent.setup()
    const modelViewer = renderLoader()
    const root = new File(['model'], 'scene.glb', { type: 'model/gltf-binary' })
    const texture = new File(['image'], 'albedo.custom')

    await user.upload(screen.getByLabelText('Choose model files'), [texture, root])

    await waitFor(() => expect(modelViewer.loadModel).toHaveBeenCalledWith([texture, root], root))
    expect(screen.getByText('2 files selected')).toBeVisible()
    expect(await screen.findByText('scene.glb · 3 meshes')).toBeVisible()
  })

  it('sorts multiple roots and waits for an explicit accessible selection', async () => {
    const user = userEvent.setup()
    const modelViewer = renderLoader()
    const last = new File(['model'], 'zebra.gltf')
    const first = new File(['model'], 'alpha.glb')
    const dependency = new File(['data'], 'scene.bin')

    await user.upload(screen.getByLabelText('Choose model files'), [last, dependency, first])

    const selector = screen.getByRole('combobox', { name: 'Model root' })
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['alpha.glb', 'zebra.gltf'])
    expect(modelViewer.loadModel).not.toHaveBeenCalled()

    await user.selectOptions(selector, 'zebra.gltf')
    await user.click(screen.getByRole('button', { name: 'Load selected model' }))
    expect(modelViewer.loadModel).toHaveBeenCalledWith([last, dependency, first], last)
  })

  it('accepts dropped files and explains when no model root is present', async () => {
    renderLoader()
    const dependency = new File(['data'], 'mesh.bin')

    fireEvent.drop(screen.getByTestId('model-drop-zone'), {
      dataTransfer: { files: [dependency] },
    })

    expect(await screen.findByRole('alert')).toHaveTextContent(/include a .glb or .gltf root/i)
    expect(screen.getByText('mesh.bin')).toBeVisible()
  })
})
