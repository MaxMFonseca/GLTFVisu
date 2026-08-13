import type { Monaco } from '@monaco-editor/react'

const GLSL_KEYWORDS = [
  'attribute', 'break', 'case', 'centroid', 'const', 'continue', 'default', 'discard',
  'do', 'else', 'flat', 'for', 'if', 'in', 'inout', 'invariant', 'layout', 'out',
  'precision', 'return', 'smooth', 'struct', 'switch', 'uniform', 'varying', 'while',
]

const GLSL_TYPES = [
  'bool', 'bvec2', 'bvec3', 'bvec4', 'float', 'int', 'ivec2', 'ivec3', 'ivec4',
  'mat2', 'mat3', 'mat4', 'sampler2D', 'samplerCube', 'uint', 'uvec2', 'uvec3',
  'uvec4', 'vec2', 'vec3', 'vec4', 'void',
]

const GLSL_FUNCTIONS = [
  'abs', 'acos', 'asin', 'atan', 'ceil', 'clamp', 'cos', 'cross', 'distance', 'dot',
  'exp', 'floor', 'fract', 'length', 'log', 'max', 'min', 'mix', 'mod', 'normalize',
  'pow', 'reflect', 'refract', 'sign', 'sin', 'smoothstep', 'sqrt', 'step', 'tan',
  'texture', 'transpose',
]

let registered = false

/** Registers the editor-only GLSL syntax definition once per Monaco runtime. */
export function registerGlslLanguage(monaco: Monaco): void {
  if (registered) return
  registered = true
  monaco.languages.register({ id: 'glsl' })
  monaco.languages.setMonarchTokensProvider('glsl', {
    keywords: GLSL_KEYWORDS,
    typeKeywords: GLSL_TYPES,
    functions: GLSL_FUNCTIONS,
    operators: ['=', '>', '<', '!', '~', '?', ':', '==', '<=', '>=', '!=', '&&', '||', '++', '--', '+', '-', '*', '/', '&', '|', '^', '%'],
    tokenizer: {
      root: [
        [/^\s*#.*$/, 'keyword.directive'],
        [/\/\*/, 'comment', '@comment'],
        [/\/\/.*$/, 'comment'],
        [/[A-Za-z_]\w*/, {
          cases: {
            '@keywords': 'keyword',
            '@typeKeywords': 'type',
            '@functions': 'predefined',
            '@default': 'identifier',
          },
        }],
        [/0[xX][0-9a-fA-F]+[uU]?/, 'number.hex'],
        [/(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?[fFuU]?/, 'number'],
        [/[{}()[\]]/, '@brackets'],
        [/[;,.]/, 'delimiter'],
        [/[=><!~?:&|+\-*/^%]+/, 'operator'],
      ],
      comment: [
        [/[^/*]+/, 'comment'],
        [/\*\//, 'comment', '@pop'],
        [/[/*]/, 'comment'],
      ],
    },
  })
}
