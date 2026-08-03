import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('shader workspace shell', () => {
  it('shows the workspace landmark and empty viewer guidance', () => {
    render(<App />)

    expect(screen.getByRole('main', { name: /shader workspace/i })).toBeVisible()
    expect(screen.getByText(/drop a glb/i)).toBeVisible()
  })
})
