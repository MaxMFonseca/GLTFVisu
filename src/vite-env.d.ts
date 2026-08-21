/// <reference types="vite/client" />

interface Window {
  __GLTFVISU_PORTRAIT__?:
    | { status: 'loading'; shaderId: string }
    | { status: 'ready'; shaderId: string }
    | { status: 'error'; shaderId: string; message: string }
}
