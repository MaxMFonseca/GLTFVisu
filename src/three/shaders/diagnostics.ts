import type { ShaderLineMapping } from './contract'

export type ShaderDiagnosticSeverity = 'error' | 'warning'

export interface ShaderDiagnostic {
  severity: ShaderDiagnosticSeverity
  message: string
  editorLine: number
  rawLine: string
}

interface ParsedLogLine {
  severity: ShaderDiagnosticSeverity
  sourceId: number
  shaderLine: number
  message: string
}

function severity(value: string): ShaderDiagnosticSeverity {
  return value.toLowerCase() === 'warning' ? 'warning' : 'error'
}

function parseLogLine(rawLine: string): ParsedLogLine | undefined {
  const angle = /^(ERROR|WARNING):\s*(\d+):(\d+)(?:\(\d+\))?:\s*(.+)$/i.exec(rawLine)
  if (angle !== null) {
    return {
      severity: severity(angle[1]),
      sourceId: Number(angle[2]),
      shaderLine: Number(angle[3]),
      message: angle[4].trim(),
    }
  }

  const firefox = /^(\d+):(\d+)(?:\(\d+\))?:\s*(error|warning):\s*(.+)$/i.exec(rawLine)
  if (firefox !== null) {
    return {
      severity: severity(firefox[3]),
      sourceId: Number(firefox[1]),
      shaderLine: Number(firefox[2]),
      message: firefox[4].trim(),
    }
  }

  const driver = /^(\d+)\((\d+)\)\s*:\s*(error|warning)\s+(.+)$/i.exec(rawLine)
  if (driver !== null) {
    return {
      severity: severity(driver[3]),
      sourceId: Number(driver[1]),
      shaderLine: Number(driver[2]),
      message: driver[4].replace(/^:\s*/, '').trim(),
    }
  }

  return undefined
}

/** Parses common WebGL compiler formats and maps generated lines to the editor body. */
export function parseShaderDiagnostics(log: string, lineMapping: ShaderLineMapping): ShaderDiagnostic[] {
  const lineOffset = Number.isFinite(lineMapping.lineOffset) ? Math.floor(lineMapping.lineOffset) : 0
  const diagnostics: ShaderDiagnostic[] = []

  for (const rawLine of log.split(/\r?\n/)) {
    const parsed = parseLogLine(rawLine)
    if (parsed === undefined) continue
    diagnostics.push({
      severity: parsed.severity,
      message: parsed.message,
      editorLine: parsed.sourceId === lineMapping.sourceId
        ? Math.max(1, parsed.shaderLine - lineOffset)
        : 1,
      rawLine,
    })
  }

  return diagnostics
}
