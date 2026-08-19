import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceProvider, type TimerPort } from '../../application/WorkspaceController'
import type { ShaderRepository } from '../../application/ShaderRepository'
import type { ViewerPort } from '../../application/ViewerPort'
import type { ShaderDefinition } from '../../domain/shader'
import { ParameterBuilder } from './ParameterBuilder'
import { ParameterControls } from './ParameterControls'

function shader(): ShaderDefinition {
  return {
    id: 'local-parameters',
    name: 'Parameters',
    fragmentSource: 'void main() { outColor = vec4(1.0); }',
    origin: 'local',
    parameters: [
      { id: 'gain', type: 'float', uniformName: 'uGain', label: 'Gain', min: 0, max: 2, step: 0.1, defaultValue: 0.5 },
      { id: 'bands', type: 'integer', uniformName: 'uBands', label: 'Bands', min: 1, max: 8, step: 1, defaultValue: 4 },
      { id: 'tint', type: 'color', uniformName: 'uTint', label: 'Tint', defaultValue: '#112233' },
      { id: 'enabled', type: 'boolean', uniformName: 'uEnabled', label: 'Enabled', defaultValue: true },
    ],
    parameterValues: { gain: 0.7, bands: 2, tint: '#AABBCC', enabled: true },
    createdAt: 1,
    updatedAt: 1,
    schemaVersion: 2,
    materialInputProfile: 'none',
  }
}

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
    loadModel: vi.fn(async () => ({ name: 'model.glb', meshCount: 1, animationClips: [], textureSlots: [] })),
    replaceModelTexture: vi.fn(async () => []),
    restoreModelTexture: vi.fn(async () => []),
    fitModel: vi.fn(),
    resize: vi.fn(),
    compileShader: vi.fn(async () => ({ status: 'valid' as const, generation: 1 })),
    updateParameter: vi.fn(),
    loadEnvironment: vi.fn(async () => undefined),
    updateEnvironment: vi.fn(),
    capturePortrait: vi.fn(async () => ({
      kind: 'captured' as const,
      blob: new Blob(),
      mimeType: 'image/png' as const,
      width: 1,
      height: 1,
    })),
    selectAnimation: vi.fn(),
    setAnimationPlaying: vi.fn(),
    dispose: vi.fn(),
  }
}

const timer: TimerPort = {
  set: vi.fn(() => 1),
  clear: vi.fn(),
}

function renderInWorkspace(children: React.ReactNode, selectedShader = shader()) {
  const repo = repository()
  const viewerPort = viewer()
  render(
    <WorkspaceProvider repository={repo} viewer={viewerPort} builtins={[selectedShader]} timer={timer}>
      {children}
    </WorkspaceProvider>,
  )
  return { repo, viewer: viewerPort }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ParameterBuilder', () => {
  it('adds, removes, and keyboard-accessibly reorders stable parameter rows', async () => {
    const user = userEvent.setup()
    renderInWorkspace(<ParameterBuilder idFactory={() => 'fresh-id'} />)
    await screen.findByRole('heading', { name: 'Parameter definitions' })

    await user.click(screen.getByRole('button', { name: 'Add parameter' }))
    const added = screen.getByRole('group', { name: 'Parameter 5' })
    expect(added).toHaveAttribute('data-parameter-id', 'fresh-id')
    expect(within(added).getByRole('textbox', { name: 'Parameter 5 uniform' })).toHaveValue('uParameter5')

    await user.click(within(added).getByRole('button', { name: 'Move parameter 5 up' }))
    expect(screen.getAllByRole('group', { name: /Parameter \d/ })[3]).toHaveAttribute('data-parameter-id', 'fresh-id')

    await user.click(within(screen.getByRole('group', { name: 'Parameter 4' })).getByRole('button', { name: 'Remove parameter 4' }))
    expect(screen.queryByTestId('parameter-fresh-id')).not.toBeInTheDocument()
  })

  it('names inline schema errors and converts types to valid defaults while preserving compatible values', async () => {
    const user = userEvent.setup()
    renderInWorkspace(<><ParameterBuilder idFactory={() => 'unused'} /><ParameterControls /></>)
    const first = screen.getByRole('group', { name: 'Parameter 1' })

    const uniform = within(first).getByRole('textbox', { name: 'Parameter 1 uniform' })
    await user.clear(uniform)
    await user.type(uniform, 'uBands')
    expect(await within(first).findByText('Uniform: Uniform names must be unique')).toBeVisible()
    expect(uniform).toHaveAttribute('aria-invalid', 'true')
    expect(timer.clear).toHaveBeenCalled()

    await user.clear(uniform)
    await user.type(uniform, 'uExposure')
    await waitFor(() => expect(within(first).queryByText(/Uniform:/)).not.toBeInTheDocument())
    expect(screen.getByRole('spinbutton', { name: 'Gain (uExposure) value' })).toHaveValue(0.7)

    await user.selectOptions(within(first).getByRole('combobox', { name: 'Parameter 1 type' }), 'integer')
    expect(within(first).getByRole('spinbutton', { name: 'Parameter 1 minimum' })).toHaveValue(0)
    expect(within(first).getByRole('spinbutton', { name: 'Parameter 1 maximum' })).toHaveValue(2)
    expect(within(first).getByRole('spinbutton', { name: 'Parameter 1 step' })).toHaveValue(1)
    expect(within(first).getByRole('spinbutton', { name: 'Parameter 1 default' })).toHaveValue(1)
    expect(screen.getByRole('spinbutton', { name: 'Gain (uExposure) value' })).toHaveValue(1)
  })

  it('exposes the correct default fields for color and boolean definitions', () => {
    renderInWorkspace(<ParameterBuilder />)

    expect(within(screen.getByRole('group', { name: 'Parameter 3' })).getByLabelText('Parameter 3 default color')).toHaveValue('#112233')
    expect(within(screen.getByRole('group', { name: 'Parameter 4' })).getByRole('checkbox', { name: 'Parameter 4 default' })).toBeChecked()
  })
})

describe('ParameterControls', () => {
  it('keeps built-in runtime controls interactive through the value update command', async () => {
    const builtin = { ...shader(), id: 'builtin-parameters', origin: 'builtin' as const }
    const runtime = renderInWorkspace(<ParameterControls />, builtin)
    await waitFor(() => expect(runtime.viewer.compileShader).toHaveBeenCalledTimes(1))
    vi.mocked(runtime.viewer.compileShader).mockClear()

    const power = screen.getByRole('slider', { name: 'Gain (uGain) slider' })
    const tint = screen.getByLabelText('Tint (uTint) color picker')
    expect(power).toBeEnabled()
    expect(tint).toBeEnabled()

    fireEvent.change(power, { target: { value: '1.5' } })

    expect(runtime.viewer.updateParameter).toHaveBeenCalledWith(expect.objectContaining({ id: 'gain' }), 1.5)
    expect(runtime.viewer.compileShader).not.toHaveBeenCalled()
    expect(runtime.repo.save).not.toHaveBeenCalled()
  })

  it('disambiguates accessible names when display labels are duplicated', () => {
    const duplicateLabels = shader()
    duplicateLabels.parameters = duplicateLabels.parameters.map((parameter) => ({ ...parameter, label: 'Value' }))
    render(
      <WorkspaceProvider repository={repository()} viewer={viewer()} builtins={[duplicateLabels]} timer={timer}>
        <ParameterControls />
      </WorkspaceProvider>,
    )

    expect(screen.getByRole('slider', { name: 'Value (uGain) slider' })).toBeVisible()
    expect(screen.getByRole('slider', { name: 'Value (uBands) slider' })).toBeVisible()
    expect(screen.getByRole('checkbox', { name: 'Value (uEnabled)' })).toBeVisible()
  })

  it('synchronizes every runtime control through value updates without schema edits or compilation', async () => {
    const user = userEvent.setup()
    const runtime = renderInWorkspace(<ParameterControls />)
    await waitFor(() => expect(runtime.viewer.compileShader).toHaveBeenCalledTimes(1))
    vi.mocked(runtime.viewer.compileShader).mockClear()
    vi.mocked(timer.set).mockClear()

    fireEvent.change(screen.getByRole('slider', { name: 'Gain (uGain) slider' }), { target: { value: '1.5' } })
    expect(screen.getByRole('spinbutton', { name: 'Gain (uGain) value' })).toHaveValue(1.5)

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Bands (uBands) value' }), { target: { value: '3.7' } })
    expect(screen.getByRole('slider', { name: 'Bands (uBands) slider' })).toHaveValue('4')
    expect(screen.getByRole('spinbutton', { name: 'Bands (uBands) value' })).toHaveValue(4)

    await user.clear(screen.getByRole('textbox', { name: 'Tint (uTint) hex value' }))
    await user.type(screen.getByRole('textbox', { name: 'Tint (uTint) hex value' }), '#AbC123')
    expect(screen.getByRole('textbox', { name: 'Tint (uTint) hex value' })).toHaveValue('#abc123')
    expect(screen.getByLabelText('Tint (uTint) color picker')).toHaveValue('#abc123')

    await user.click(screen.getByRole('checkbox', { name: 'Enabled (uEnabled)' }))
    expect(screen.getByRole('checkbox', { name: 'Enabled (uEnabled)' })).not.toBeChecked()

    expect(runtime.viewer.updateParameter).toHaveBeenCalledWith(expect.objectContaining({ id: 'gain' }), 1.5)
    expect(runtime.viewer.updateParameter).toHaveBeenCalledWith(expect.objectContaining({ id: 'bands' }), 4)
    expect(runtime.viewer.updateParameter).toHaveBeenCalledWith(expect.objectContaining({ id: 'tint' }), '#abc123')
    expect(runtime.viewer.updateParameter).toHaveBeenCalledWith(expect.objectContaining({ id: 'enabled' }), false)
    expect(timer.set).not.toHaveBeenCalled()
    expect(runtime.viewer.compileShader).not.toHaveBeenCalled()
    expect(runtime.repo.save).not.toHaveBeenCalled()
  })
})
