import { BUILTIN_SHADERS } from '../domain/builtins'

export const PORTRAIT_WIDTH = 320
export const PORTRAIT_HEIGHT = 200
export const PORTRAIT_BACKGROUND = '#77797d'

export function parsePortraitShaderId(search: string): string | undefined {
  const query = new URLSearchParams(search)
  if (query.get('capture') !== 'builtin-portrait') return undefined

  const shaderId = query.get('shader') ?? ''
  if (!BUILTIN_SHADERS.some(({ id }) => id === shaderId)) {
    throw new Error(`Unknown built-in shader: ${shaderId}`)
  }
  return shaderId
}
