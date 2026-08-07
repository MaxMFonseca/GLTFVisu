import { describe, expect, it } from 'vitest'
import { parseShaderDiagnostics } from './diagnostics'

const lineMapping = { sourceId: 1, lineOffset: 0 } as const

describe('parseShaderDiagnostics', () => {
  it('maps ANGLE error and warning logs back to one-based editor lines', () => {
    const log = [
      "ERROR: 1:4: 'tone' : undeclared identifier",
      'WARNING: 1:9: extension is not supported',
    ].join('\n')

    expect(parseShaderDiagnostics(log, lineMapping)).toEqual([
      {
        severity: 'error',
        message: "'tone' : undeclared identifier",
        editorLine: 4,
        rawLine: "ERROR: 1:4: 'tone' : undeclared identifier",
      },
      {
        severity: 'warning',
        message: 'extension is not supported',
        editorLine: 9,
        rawLine: 'WARNING: 1:9: extension is not supported',
      },
    ])
  })

  it('parses Firefox-style locations with a column', () => {
    const rawLine = "1:15(7): error: syntax error, unexpected IDENTIFIER"

    expect(parseShaderDiagnostics(rawLine, lineMapping)).toEqual([
      {
        severity: 'error',
        message: 'syntax error, unexpected IDENTIFIER',
        editorLine: 15,
        rawLine,
      },
    ])
  })

  it('parses driver-style locations and clamps non-user-source errors to line one', () => {
    const rawLine = "0(8) : warning C7011: implicit cast from 'int' to 'float'"

    expect(parseShaderDiagnostics(rawLine, lineMapping)).toEqual([
      {
        severity: 'warning',
        message: "C7011: implicit cast from 'int' to 'float'",
        editorLine: 1,
        rawLine,
      },
    ])
  })

  it('applies an explicit editor line offset', () => {
    const rawLine = 'ERROR: 4:8: syntax error'

    expect(parseShaderDiagnostics(rawLine, { sourceId: 4, lineOffset: 3 })).toEqual([
      {
        severity: 'error',
        message: 'syntax error',
        editorLine: 5,
        rawLine,
      },
    ])
  })

  it('ignores blank and unrelated compiler output', () => {
    expect(parseShaderDiagnostics('WebGL program link failed\n\nNo errors.', lineMapping)).toEqual([])
  })
})
