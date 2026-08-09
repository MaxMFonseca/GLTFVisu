import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceNotice } from '../../application/workspaceState'
import { StatusRegion } from './StatusRegion'

afterEach(cleanup)

describe('StatusRegion', () => {
  it('announces outcomes politely, exposes errors as alerts, and dismisses all notices', async () => {
    const notices: WorkspaceNotice[] = [
      { kind: 'info', scope: 'save', message: 'Saved Local shader' },
      { kind: 'error', scope: 'import', message: 'Malformed shader JSON' },
    ]
    const onDismiss = vi.fn()
    const user = userEvent.setup()

    render(<StatusRegion notices={notices} onDismiss={onDismiss} />)

    expect(screen.getByRole('status')).toHaveTextContent('Saved Local shader')
    expect(screen.getByRole('alert')).toHaveTextContent('Malformed shader JSON')
    await user.click(screen.getByRole('button', { name: 'Dismiss workspace notices' }))
    expect(onDismiss).toHaveBeenCalledOnce()
  })
})
