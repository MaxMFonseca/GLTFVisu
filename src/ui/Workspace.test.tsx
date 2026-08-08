import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceProvider } from '../application/WorkspaceController'
import type { ShaderRepository } from '../application/ShaderRepository'
import type { ViewerPort } from '../application/ViewerPort'
import { ErrorBoundary } from './common/ErrorBoundary'
import { Workspace } from './Workspace'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

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
}

describe('Workspace', () => {
  it('collapses both panels and resizes them with semantic keyboard separators', async () => {
    const user = userEvent.setup()
    render(
      <WorkspaceProvider repository={repository()} viewer={viewer()}>
        <Workspace mountViewer={() => ({ dispose: vi.fn() })} />
      </WorkspaceProvider>,
    )

    const leftResizer = screen.getByRole('separator', { name: 'Resize shader library' })
    expect(leftResizer).toHaveAttribute('aria-valuenow', '260')
    await user.type(leftResizer, '{ArrowRight}')
    expect(leftResizer).toHaveAttribute('aria-valuenow', '276')

    const pointerDown = createEvent.pointerDown(leftResizer)
    const pointerMove = createEvent.pointerMove(leftResizer)
    const pointerUp = createEvent.pointerUp(leftResizer)
    Object.defineProperties(pointerDown, { clientX: { value: 100 }, pointerId: { value: 1 } })
    Object.defineProperties(pointerMove, { clientX: { value: 132 }, pointerId: { value: 1 } })
    Object.defineProperties(pointerUp, { clientX: { value: 132 }, pointerId: { value: 1 } })
    fireEvent(leftResizer, pointerDown)
    fireEvent(leftResizer, pointerMove)
    fireEvent(leftResizer, pointerUp)
    expect(leftResizer).toHaveAttribute('aria-valuenow', '308')

    await user.click(screen.getByRole('button', { name: 'Collapse shader library' }))
    expect(screen.getByRole('button', { name: 'Expand shader library' })).toBeVisible()
    expect(leftResizer).toHaveAttribute('aria-disabled', 'true')

    await user.click(screen.getByRole('button', { name: 'Collapse shader editor' }))
    expect(screen.getByRole('button', { name: 'Expand shader editor' })).toBeVisible()
  })

  it('isolates an unexpected panel render failure', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    function BrokenPanel(): never {
      throw new Error('render exploded')
    }

    render(<ErrorBoundary panelName="Library"><BrokenPanel /></ErrorBoundary>)

    expect(screen.getByRole('alert')).toHaveTextContent('Library failed unexpectedly')
    expect(screen.getByText('render exploded')).toBeVisible()
  })
})
