import { Component, type ReactNode } from 'react'

export interface ErrorBoundaryProps {
  panelName: string
  children: ReactNode
}

interface ErrorBoundaryState {
  error?: Error
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {}

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  render() {
    const error = this.state.error
    if (error === undefined) return this.props.children
    return (
      <div className="panel-crash" role="alert">
        <strong>{this.props.panelName} failed unexpectedly.</strong>
        <span>{error.message}</span>
      </div>
    )
  }
}
