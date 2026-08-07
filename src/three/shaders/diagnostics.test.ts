import { describe, expect, it } from 'vitest'
import { parseShaderDiagnostics } from './diagnostics'

describe('parseShaderDiagnostics', () => {
  it('maps ANGLE error and warning logs back to one-based editor lines', () => {
    const log = [
      "ERROR: 0:14: 'tone' : undeclared identifier",
      'WARNING: 0:19: extension is not supported',
    ].join('\n')

    expect(parseShaderDiagnostics(log, 10)).toEqual([
      {
        severity: 'error',
        message: "'tone' : undeclared identifier",
        editorLine: 4,
        rawLine: "ERROR: 0:14: 'tone' : undeclared identifier",
      },
      {
        severity: 'warning',
        message: 'extension is not supported',
        editorLine: 9,
        rawLine: 'WARNING: 0:19: extension is not supported',
      },
    ])
  })

  it('parses Firefox-style locations with a column', () => {
    const rawLine = "0:22(7): error: syntax error, unexpected IDENTIFIER"

    expect(parseShaderDiagnostics(rawLine, 7)).toEqual([
      {
        severity: 'error',
        message: 'syntax error, unexpected IDENTIFIER',
        editorLine: 15,
        rawLine,
      },
    ])
  })

  it('parses driver-style parenthesized line locations and clamps injected errors to line one', () => {
    const rawLine = "0(8) : warning C7011: implicit cast from 'int' to 'float'"

    expect(parseShaderDiagnostics(rawLine, 12)).toEqual([
      {
        severity: 'warning',
        message: "C7011: implicit cast from 'int' to 'float'",
        editorLine: 1,
        rawLine,
      },
    ])
  })

  it('ignores blank and unrelated compiler output', () => {
    expect(parseShaderDiagnostics('WebGL program link failed\n\nNo errors.', 5)).toEqual([])
  })
})
