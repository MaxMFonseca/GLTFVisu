export type ShaderDiagnosticSeverity = 'error' | 'warning'

export interface ShaderDiagnostic {
  severity: ShaderDiagnosticSeverity
  message: string
  editorLine: number
  rawLine: string
}

interface ParsedLogLine {
  severity: ShaderDiagnosticSeverity
  shaderLine: number
  message: string
}

function severity(value: string): ShaderDiagnosticSeverity {
  return value.toLowerCase() === 'warning' ? 'warning' : 'error'
}

function parseLogLine(rawLine: string): ParsedLogLine | undefined {
  const angle = /^(ERROR|WARNING):\s*\d+:(\d+)(?:\(\d+\))?:\s*(.+)$/i.exec(rawLine)
  if (angle !== null) {
    return { severity: severity(angle[1]), shaderLine: Number(angle[2]), message: angle[3].trim() }
  }

  const firefox = /^\d+:(\d+)(?:\(\d+\))?:\s*(error|warning):\s*(.+)$/i.exec(rawLine)
  if (firefox !== null) {
    return { severity: severity(firefox[2]), shaderLine: Number(firefox[1]), message: firefox[3].trim() }
  }

  const driver = /^\d+\((\d+)\)\s*:\s*(error|warning)\s+(.+)$/i.exec(rawLine)
  if (driver !== null) {
    return {
      severity: severity(driver[2]),
      shaderLine: Number(driver[1]),
      message: driver[3].replace(/^:\s*/, '').trim(),
    }
  }

  return undefined
}

/** Parses common WebGL compiler formats and maps generated lines to the editor body. */
export function parseShaderDiagnostics(log: string, injectedLineCount: number): ShaderDiagnostic[] {
  const lineOffset = Number.isFinite(injectedLineCount) ? Math.max(0, Math.floor(injectedLineCount)) : 0
  const diagnostics: ShaderDiagnostic[] = []

  for (const rawLine of log.split(/\r?\n/)) {
    const parsed = parseLogLine(rawLine)
    if (parsed === undefined) continue
    diagnostics.push({
      severity: parsed.severity,
      message: parsed.message,
      editorLine: Math.max(1, parsed.shaderLine - lineOffset),
      rawLine,
    })
  }

  return diagnostics
}
