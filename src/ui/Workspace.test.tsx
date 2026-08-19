import { cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceProvider } from '../application/WorkspaceController'
import type { ShaderRepository } from '../application/ShaderRepository'
import type { ViewerPort } from '../application/ViewerPort'
import { ErrorBoundary } from './common/ErrorBoundary'
import { Workspace } from './Workspace'
import '../styles/global.css'
import '../styles/workspace.css'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function useViewportWidth(width: number): void {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: width <= Number(query.match(/max-width:\s*([\d.]+)rem/)?.[1]) * 16,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })))
}

function useNarrowViewport(): void {
  useViewportWidth(800)
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
      kind: 'captured' as const, blob: new Blob(), mimeType: 'image/png' as const, width: 1, height: 1,
    })),
    selectAnimation: vi.fn(),
    setAnimationPlaying: vi.fn(),
    dispose: vi.fn(),
  }
}

describe('Workspace', () => {
  it('keeps the document shell from exceeding a short viewport', () => {
    useViewportWidth(1025)
    const { container } = render(
      <WorkspaceProvider repository={repository()} viewer={viewer()}>
        <Workspace mountViewer={() => ({ dispose: vi.fn() })} />
      </WorkspaceProvider>,
    )

    const workspace = container.querySelector('.workspace-root')
    expect(getComputedStyle(document.body).overflow).toBe('hidden')
    expect(workspace).not.toBeNull()
    expect(getComputedStyle(workspace as Element).minHeight).toBe('0')
  })

  it.each([
    [1000, 'narrow', true],
    [1025, 'desktop', false],
  ] as const)('uses the %s px viewport without overflowing desktop tracks', (width, layout, hasTabs) => {
    useViewportWidth(width)
    const { container } = render(
      <WorkspaceProvider repository={repository()} viewer={viewer()}>
        <Workspace mountViewer={() => ({ dispose: vi.fn() })} />
      </WorkspaceProvider>,
    )

    expect(container.querySelector('.workspace-root')).toHaveAttribute('data-layout', layout)
    expect(screen.queryByRole('tablist', { name: 'Workspace panels' }) !== null).toBe(hasTabs)
  })

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

  it('keeps every desktop grid item in its track when either outer panel is collapsed', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <WorkspaceProvider repository={repository()} viewer={viewer()}>
        <Workspace mountViewer={() => ({ dispose: vi.fn() })} />
      </WorkspaceProvider>,
    )
    const items = [
      container.querySelector('.workspace-library'),
      container.querySelector('.panel-divider-left'),
      container.querySelector('.workspace-viewer'),
      container.querySelector('.panel-divider-right'),
      container.querySelector('.workspace-editor'),
    ] as Element[]
    const gridColumns = () => items.map((item) => getComputedStyle(item).gridColumn)

    expect(gridColumns()).toEqual(['1', '2', '3', '4', '5'])
    await user.click(screen.getByRole('button', { name: 'Collapse shader library' }))
    expect(gridColumns()).toEqual(['1', '2', '3', '4', '5'])

    await user.click(screen.getByRole('button', { name: 'Expand shader library' }))
    await user.click(screen.getByRole('button', { name: 'Collapse shader editor' }))
    expect(gridColumns()).toEqual(['1', '2', '3', '4', '5'])
  })

  it('offers keyboard tabs on narrow displays and resizes the viewer when activated', async () => {
    useNarrowViewport()
    const user = userEvent.setup()
    const workspaceViewer = viewer()
    render(
      <WorkspaceProvider repository={repository()} viewer={workspaceViewer}>
        <Workspace mountViewer={() => ({ dispose: vi.fn() })} />
      </WorkspaceProvider>,
    )

    const tablist = screen.getByRole('tablist', { name: 'Workspace panels' })
    const libraryTab = screen.getByRole('tab', { name: 'Library' })
    const viewerTab = screen.getByRole('tab', { name: 'Viewer' })
    const editorTab = screen.getByRole('tab', { name: 'Editor' })
    expect(tablist).toContainElement(viewerTab)
    expect(viewerTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: 'Viewer' })).toBeVisible()

    await user.click(libraryTab)
    expect(libraryTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: 'Library' })).toBeVisible()
    expect(document.getElementById('shader-viewer-panel')).toHaveAttribute('hidden')

    vi.mocked(workspaceViewer.resize).mockClear()
    await user.keyboard('{ArrowRight}')
    expect(viewerTab).toHaveFocus()
    expect(viewerTab).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(workspaceViewer.resize).toHaveBeenCalledOnce())

    await user.keyboard('{End}')
    expect(editorTab).toHaveFocus()
    expect(editorTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: 'Editor' })).toBeVisible()
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
