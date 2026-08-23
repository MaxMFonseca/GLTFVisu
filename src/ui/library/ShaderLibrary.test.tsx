import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceProvider, useWorkspace } from '../../application/WorkspaceController'
import type { ShaderRepository } from '../../application/ShaderRepository'
import type { ViewerPort } from '../../application/ViewerPort'
import type { ShaderDefinition } from '../../domain/shader'
import { ShaderCard } from './ShaderCard'
import { ShaderLibrary } from './ShaderLibrary'
import { StatusRegion } from '../common/StatusRegion'

afterEach(cleanup)

function localShader(overrides: Partial<ShaderDefinition> = {}): ShaderDefinition {
  return {
    id: 'local-one',
    name: 'Local one',
    fragmentSource: 'void main() { outColor = vec4(1.0); }',
    origin: 'local',
    parameters: [],
    parameterValues: {},
    createdAt: 1,
    updatedAt: 1,
    schemaVersion: 2,
    materialInputProfile: 'none',
    ...overrides,
  }
}

function repository(locals: ShaderDefinition[] = []): ShaderRepository {
  return {
    list: vi.fn(async () => locals),
    get: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  }
}

function viewer(): ViewerPort {
  return {
    loadModel: vi.fn(async (_files, root) => ({ name: root.name, meshCount: 1, animationClips: [], textureSlots: [] })),
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
      kind: 'captured' as const, blob: new Blob(['portrait']), mimeType: 'image/png' as const, width: 2, height: 2,
    })),
    selectAnimation: vi.fn(),
    setAnimationPlaying: vi.fn(),
    dispose: vi.fn(),
  }
}

function renderLibrary(locals: ShaderDefinition[] = []) {
  let nextId = 0
  const shaderRepository = repository(locals)
  const result = render(
    <WorkspaceProvider
      repository={shaderRepository}
      viewer={viewer()}
      idFactory={() => `created-${++nextId}`}
      now={() => 10}
    >
      <LibraryNotices />
      <ShaderLibrary />
    </WorkspaceProvider>,
  )
  return { ...result, shaderRepository }
}

function LibraryNotices() {
  const { state, commands } = useWorkspace()
  return <StatusRegion notices={state.notices} onDismiss={commands.clearNotices} />
}

describe('ShaderLibrary', () => {
  it('places all six text commands together in the shader action grid', () => {
    renderLibrary()
    const actions = screen.getByLabelText('Shader actions')

    expect(within(actions).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Create shader',
      'Duplicate shader',
      'Import shader',
      'Export shader',
      'Capture portrait',
      'Delete shader',
    ])
    expect(screen.getAllByRole('button', { name: 'Create shader' })).toHaveLength(1)
  })

  it('shows built-in and empty local sections with the selected card', async () => {
    renderLibrary()

    expect(screen.getByRole('heading', { name: 'Built-in' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'PBR' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('img', { name: 'Normal preview' })).toBeVisible()
    expect(await screen.findByText(/create a shader or duplicate a built-in/i)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Delete shader' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Capture portrait' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Duplicate shader' })).toBeEnabled()
  })

  it('creates, duplicates, selects, and confirms deletion of local shaders', async () => {
    const user = userEvent.setup()
    const { shaderRepository } = renderLibrary()
    await screen.findByText(/create a shader or duplicate a built-in/i)

    await user.click(screen.getByRole('button', { name: 'Create shader' }))
    expect(await screen.findByRole('button', { name: 'Untitled shader' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: 'Delete shader' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Duplicate shader' }))
    expect(await screen.findByRole('button', { name: 'Untitled shader copy' })).toHaveAttribute('aria-current', 'true')

    await user.click(screen.getByRole('button', { name: 'Delete shader' }))
    expect(screen.getByRole('alertdialog', { name: 'Delete Untitled shader copy?' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

    await waitFor(() => expect(shaderRepository.delete).toHaveBeenCalledWith('created-2'))
    expect(screen.queryByRole('button', { name: 'Untitled shader copy' })).not.toBeInTheDocument()
  })

  it('confirms the captured shader identity even if selection changes underneath it', async () => {
    const user = userEvent.setup()
    const first = localShader()
    const second = localShader({ id: 'local-two', name: 'Local two' })
    const { shaderRepository } = renderLibrary([first, second])
    const firstCard = await screen.findByRole('button', { name: 'Local one' })
    const secondCard = screen.getByRole('button', { name: 'Local two' })
    await user.click(firstCard)
    await user.click(screen.getByRole('button', { name: 'Delete shader' }))

    fireEvent.click(secondCard)
    expect(screen.getByRole('alertdialog', { name: 'Delete Local one?' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))

    await waitFor(() => expect(shaderRepository.delete).toHaveBeenCalledWith('local-one'))
    expect(shaderRepository.delete).not.toHaveBeenCalledWith('local-two')
  })

  it('gates the background, traps focus, closes on Escape, and restores focus', async () => {
    const user = userEvent.setup()
    renderLibrary([localShader()])
    await user.click(await screen.findByRole('button', { name: 'Local one' }))
    const background = screen.getByLabelText('Shader library')
    const deleteButton = screen.getByRole('button', { name: 'Delete shader' })

    await user.click(deleteButton)

    const dialog = screen.getByRole('alertdialog', { name: 'Delete Local one?' })
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    const confirm = screen.getByRole('button', { name: 'Confirm delete' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(background).toHaveAttribute('aria-hidden', 'true')
    expect(background).toHaveProperty('inert', true)
    expect(cancel).toHaveFocus()

    await user.tab()
    expect(confirm).toHaveFocus()
    await user.tab()
    expect(cancel).toHaveFocus()
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(background).not.toHaveAttribute('aria-hidden')
    expect(background).toHaveProperty('inert', false)
    expect(deleteButton).toHaveFocus()
  })

  it('renders command failures and dismisses them through workspace state', async () => {
    const user = userEvent.setup()
    const { shaderRepository } = renderLibrary()
    vi.mocked(shaderRepository.save).mockRejectedValueOnce(new Error('Storage quota exceeded'))

    await user.click(screen.getByRole('button', { name: 'Create shader' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Storage quota exceeded')
    await user.click(screen.getByRole('button', { name: 'Dismiss workspace notices' }))
    expect(screen.queryByText('Storage quota exceeded')).not.toBeInTheDocument()
  })

  it('marks a selected local card and gives missing portraits a dedicated placeholder', async () => {
    const user = userEvent.setup()
    renderLibrary([localShader()])

    const card = await screen.findByRole('button', { name: 'Local one' })
    await user.click(card)

    expect(card).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('img', { name: 'No preview for Local one' })).toBeVisible()
  })

  it('imports a selected shader package through the file entry point', async () => {
    const user = userEvent.setup()
    const { shaderRepository } = renderLibrary()
    const packageFile = new File([JSON.stringify({
      format: 'gltf-shader-visualizer',
      version: 1,
      shader: {
        name: 'Imported shader',
        fragmentSource: 'void main() { outColor = vec4(1.0); }',
        parameters: [],
        parameterValues: {},
      },
    })], 'import.shader.json', { type: 'application/json' })

    await user.upload(screen.getByLabelText('Import shader file'), packageFile)

    await waitFor(() => expect(shaderRepository.save).toHaveBeenCalledWith(expect.objectContaining({
      id: 'created-1', name: 'Imported shader', origin: 'local',
    })))
    expect(screen.getByRole('button', { name: 'Imported shader' })).toHaveAttribute('aria-current', 'true')
  })

  it('owns captured portrait object URLs across replacement and unmount', () => {
    const first = localShader({
      portrait: { kind: 'captured', blob: new Blob(['first']), mimeType: 'image/png', width: 2, height: 2 },
    })
    const second = localShader({
      portrait: { kind: 'captured', blob: new Blob(['second']), mimeType: 'image/png', width: 2, height: 2 },
    })
    const urls = {
      createObjectURL: vi.fn()
        .mockReturnValueOnce('blob:first')
        .mockReturnValueOnce('blob:second'),
      revokeObjectURL: vi.fn(),
    }
    const onSelect = vi.fn()
    const { rerender, unmount } = render(
      <ShaderCard shader={first} selected={false} onSelect={onSelect} urls={urls} />,
    )

    expect(screen.getByRole('img', { name: 'Local one preview' })).toHaveAttribute('src', 'blob:first')
    rerender(<ShaderCard shader={second} selected={false} onSelect={onSelect} urls={urls} />)
    expect(urls.revokeObjectURL).toHaveBeenCalledWith('blob:first')
    expect(screen.getByRole('img', { name: 'Local one preview' })).toHaveAttribute('src', 'blob:second')

    unmount()
    expect(urls.revokeObjectURL).toHaveBeenCalledWith('blob:second')
  })
})
