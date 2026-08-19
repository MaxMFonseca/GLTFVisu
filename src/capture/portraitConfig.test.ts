import { describe, expect, it } from 'vitest'
import {
  PORTRAIT_BACKGROUND,
  PORTRAIT_HEIGHT,
  PORTRAIT_WIDTH,
  parsePortraitShaderId,
} from './portraitConfig'

describe('portrait capture configuration', () => {
  it('recognizes a built-in portrait capture request', () => {
    expect(parsePortraitShaderId('?capture=builtin-portrait&shader=builtin-pbr')).toBe('builtin-pbr')
  })

  it('ignores ordinary application URLs', () => {
    expect(parsePortraitShaderId('')).toBeUndefined()
    expect(parsePortraitShaderId('?shader=builtin-pbr')).toBeUndefined()
    expect(parsePortraitShaderId('?capture=other&shader=builtin-pbr')).toBeUndefined()
  })

  it.each(['local-shader', 'builtin-missing', ''])(
    'rejects the non-built-in shader id %j in capture mode',
    (shaderId) => {
      expect(() => parsePortraitShaderId(`?capture=builtin-portrait&shader=${shaderId}`))
        .toThrow('Unknown built-in shader')
    },
  )

  it('uses the approved portrait dimensions and background', () => {
    expect({
      width: PORTRAIT_WIDTH,
      height: PORTRAIT_HEIGHT,
      background: PORTRAIT_BACKGROUND,
    }).toEqual({
      width: 320,
      height: 200,
      background: '#77797d',
    })
  })
})
