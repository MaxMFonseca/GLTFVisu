# GLTF Shader Visualizer

A client-side workspace for loading local GLB or GLTF models and exploring custom GLSL fragment shaders with Three.js.

## Prerequisites

- Node.js 20 or later
- npm 10 or later

## Getting started

```bash
npm install
npm run dev
```

## Commands

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

`npm run build` writes a static, relative-path build to `dist/`, ready for subpath hosting such as GitHub Pages.

## Current status

The initial workspace shell is in place: a dark three-panel layout, the empty GLB/GLTF viewer state, shared UI tokens, test and lint tooling, and bundled built-in shader portrait previews. Model loading, shader editing, persistence, rendering controls, and additional user documentation are still in development.
