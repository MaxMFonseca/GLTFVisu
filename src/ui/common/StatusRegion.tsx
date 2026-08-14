import type { WorkspaceNotice } from '../../application/workspaceState'

export interface StatusRegionProps {
  notices: readonly WorkspaceNotice[]
  onDismiss(): void
}

export function StatusRegion({ notices, onDismiss }: StatusRegionProps) {
  if (notices.length === 0) return null
  const outcomes = notices.filter((notice) => notice.kind === 'info')
  const errors = notices.filter((notice) => notice.kind === 'error')

  return (
    <section className="workspace-status-region" aria-label="Workspace notices">
      {outcomes.length > 0 && (
        <div className="workspace-status-outcomes" role="status" aria-live="polite" aria-atomic="true">
          {outcomes.map((notice, index) => (
            <p key={`${notice.scope}-${index}`}><strong>Completed:</strong> {notice.message}</p>
          ))}
        </div>
      )}
      {errors.map((notice, index) => (
        <p className="workspace-status-error" role="alert" key={`${notice.scope}-${index}`}>
          <strong>Error:</strong> {notice.message}
        </p>
      ))}
      <button type="button" aria-label="Dismiss workspace notices" onClick={onDismiss}>Dismiss</button>
    </section>
  )
}
