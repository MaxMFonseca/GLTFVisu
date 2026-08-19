import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelTextureSlotInfo } from '../../three/modelTextures/ModelTextureRegistry'
import { ModelTextureEditor } from './ModelTextureEditor'

afterEach(cleanup)

function slot(overrides: Partial<ModelTextureSlotInfo> = {}): ModelTextureSlotInfo {
  return {
    id: 'material-0:base-color',
    materialLabel: 'Armor',
    channel: 'base-color',
    label: 'Base color',
    previewUrl: 'blob:armor-base-color',
    replaced: false,
    ...overrides,
  }
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('ModelTextureEditor', () => {
  it('renders ordered populated slots in accessible material groups', () => {
    render(
      <ModelTextureEditor
        slots={[
          slot(),
          slot({
            id: 'material-0:normal', channel: 'normal', label: 'Normal', previewUrl: 'blob:armor-normal',
          }),
          slot({
            id: 'material-1:emissive', materialLabel: 'Visor', channel: 'emissive', label: 'Emissive',
            previewUrl: 'blob:visor-emissive', replaced: true,
          }),
        ]}
        onReplace={vi.fn(async () => undefined)}
        onRestore={vi.fn(async () => undefined)}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Model textures' })).toBeVisible()
    const groups = screen.getAllByRole('group')
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual(['Armor', 'Visor'])
    expect(within(groups[0]).getAllByRole('img').map((image) => image.getAttribute('alt'))).toEqual([
      'Armor Base color texture preview',
      'Armor Normal texture preview',
    ])
    expect(within(groups[1]).getByRole('img', { name: 'Visor Emissive texture preview' }))
      .toHaveAttribute('src', 'blob:visor-emissive')
    expect(screen.getAllByText(/^(Base color|Normal|Emissive)$/).map((label) => label.textContent))
      .toEqual(['Base color', 'Normal', 'Emissive'])

    const replaceInputs = screen.getAllByLabelText(/^Replace /)
    for (const input of replaceInputs) {
      expect(input).toHaveAttribute('accept', 'image/png,image/jpeg,image/webp')
    }
    expect(screen.getByRole('button', { name: 'Restore Armor base color' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Restore Visor emissive' })).toBeEnabled()
    expect(within(groups[0]).getAllByText('Original')).toHaveLength(2)
    expect(within(groups[1]).getByText('Replacement')).toBeVisible()
  })

  it('renders nothing when the loaded model has no populated texture slots', () => {
    const { container } = render(
      <ModelTextureEditor
        slots={[]}
        onReplace={vi.fn(async () => undefined)}
        onRestore={vi.fn(async () => undefined)}
      />,
    )

    expect(screen.queryByRole('heading', { name: 'Model textures' })).not.toBeInTheDocument()
    expect(container).toBeEmptyDOMElement()
  })

  it('forwards edits exactly, disables only the pending row, and resets the input after success or failure', async () => {
    const user = userEvent.setup()
    const firstReplace = deferred()
    const secondReplace = deferred()
    const restore = deferred()
    const onReplace = vi.fn()
      .mockReturnValueOnce(firstReplace.promise)
      .mockReturnValueOnce(secondReplace.promise)
    const onRestore = vi.fn(() => restore.promise)
    render(
      <ModelTextureEditor
        slots={[
          slot({ replaced: true }),
          slot({
            id: 'material-1:emissive', materialLabel: 'Visor', channel: 'emissive', label: 'Emissive',
            previewUrl: 'blob:visor-emissive', replaced: true,
          }),
        ]}
        onReplace={onReplace}
        onRestore={onRestore}
      />,
    )

    const input = screen.getByLabelText('Replace Armor base color') as HTMLInputElement
    const armorRestore = screen.getByRole('button', { name: 'Restore Armor base color' })
    const visorRestore = screen.getByRole('button', { name: 'Restore Visor emissive' })
    const replacement = new File(['replacement'], 'armor.png', { type: 'image/png' })

    await user.upload(input, replacement)
    expect(onReplace).toHaveBeenCalledWith('material-0:base-color', replacement)
    expect(input).toBeDisabled()
    expect(armorRestore).toBeDisabled()
    expect(visorRestore).toBeEnabled()

    firstReplace.resolve()
    await waitFor(() => expect(input).toBeEnabled())
    expect(input).toHaveValue('')

    await user.upload(input, replacement)
    expect(onReplace).toHaveBeenCalledTimes(2)
    secondReplace.reject(new Error('Texture decode failed'))
    await waitFor(() => expect(input).toBeEnabled())
    expect(input).toHaveValue('')

    await user.click(armorRestore)
    expect(onRestore).toHaveBeenCalledWith('material-0:base-color')
    expect(input).toBeDisabled()
    expect(armorRestore).toBeDisabled()
    expect(visorRestore).toBeEnabled()
    restore.resolve()
    await waitFor(() => expect(input).toBeEnabled())
  })
})
