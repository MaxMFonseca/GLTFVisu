# GLTF Shader Visualizer

GLTF Shader Visualizer is a browser-based workspace for loading local GLB or GLTF models, applying custom GLSL fragment shaders with Three.js, and saving reusable shader presets. The desktop layout keeps the viewer dominant between resizable, collapsible library and editor panels; narrow displays use Library, Viewer, and Editor tabs.

All model files, shader drafts, parameter values, and captured portraits stay in the browser. The app does not upload them to a server.

## Requirements

- Node.js 20 or later
- npm 10 or later
- A current browser with WebGL2 and IndexedDB enabled

WebGL1 is not supported. If WebGL2 initialization fails, the viewer reports the failure while the rest of the workspace remains available.

## Install and run

```bash
npm install
npm run dev
```

Vite prints the local development URL. The available project commands are:

```bash
npm test          # run the Vitest suite once
npm run typecheck # run strict TypeScript checks
npm run lint      # run ESLint
npm run build     # typecheck and create the production build in dist/
npm run preview   # serve the production build locally
```

## Load a model

Use **Choose files** or drop files into the Model area.

- For a GLB, select the `.glb` file. Its resources are normally embedded, so one file is enough.
- For a multi-file GLTF, select the `.gltf` root together with every referenced `.bin`, image, and other local dependency. File names and relative paths must match the URIs in the GLTF.
- If the selection contains more than one `.glb` or `.gltf` root, choose the intended root from **Model root**, then select **Load selected model**.

The selected files are resolved through temporary browser object URLs and released after loading. Missing, malformed, and unsupported resources produce a visible error without replacing the previously loaded model.

After a model loads, use **Reset view** to fit it in the camera. When animation clips are present, choose a clip with **Animation clip** and use **Play** or **Pause**. Loading a different model replaces the current clip list.

## Create and edit shaders

Built-in shaders are read-only. Select one and choose **Duplicate shader** to create an editable local copy, or choose **Create shader** for a blank local shader.

Source and parameter-schema edits compile after a 400 ms debounce. A failed compile leaves the last valid runtime material active and reports diagnostics in the editor. Runtime parameter value changes update uniforms immediately and do not recompile the shader.

Changes remain a draft until **Save** is selected. Save stores the shader source, parameter definitions, current values, and portrait in IndexedDB. Reloading the page restores saved local shaders; unsaved changes are intentionally discarded.

### GLSL ES 3.00 contract

The editor accepts a GLSL ES 3.00 fragment-program body. Write a `void main()` function and assign its final color to `outColor`. Do not add a `#version` directive or redeclare the fixed interface. The app owns the vertex stage and injects these declarations; generated parameter uniforms are inserted after `uCameraPosition` and before `outColor`:

```glsl
precision highp float;
precision highp int;

in vec2 vUv;
in vec3 vWorldPosition;
in vec3 vWorldNormal;

uniform float uTime;
uniform vec2 uResolution;
uniform vec3 uCameraPosition;
out vec4 outColor;
```

For example:

```glsl
void main() {
  vec3 normalColor = normalize(vWorldNormal) * 0.5 + 0.5;
  outColor = vec4(normalColor, 1.0);
}
```

`uTime` is elapsed viewer time, `uResolution` is the drawing-buffer size, and `uCameraPosition` and `vWorldPosition` are in world space.

### Generated parameters

Each parameter definition requires a unique valid GLSL uniform name. The editor generates one uniform declaration per definition:

| Parameter type | GLSL uniform type | Runtime value |
| --- | --- | --- |
| Float | `float` | Number constrained to the configured minimum and maximum |
| Integer | `int` | Rounded number constrained to the configured minimum and maximum |
| Color | `vec3` | Six-digit hexadecimal color converted to RGB |
| Boolean | `bool` | `true` or `false` |

Float and integer definitions also include minimum, maximum, step, and default values. Reordering parameters changes their editor order, not their uniform names. Invalid or duplicate uniform definitions block compilation and saving until corrected.

## Save portraits

With a model loaded and a valid local shader selected, choose **Capture portrait**. Capture reads only the WebGL canvas—not the surrounding interface—and creates a bounded WebP or PNG preview. The shader card updates immediately and the draft becomes unsaved. Choose **Save** to persist the portrait; leaving or reloading before saving discards it.

## Import and export

**Export shader** downloads a sanitized `*.shader.json` file through a temporary Blob URL. The current package envelope is version 1:

```json
{
  "format": "gltf-shader-visualizer",
  "version": 1,
  "shader": {
    "name": "Example",
    "fragmentSource": "void main() { outColor = vec4(1.0); }",
    "parameters": [],
    "parameterValues": {},
    "portrait": {
      "mimeType": "image/png",
      "dataUrl": "data:image/png;base64,...",
      "width": 320,
      "height": 200
    }
  }
}
```

The `portrait` field is omitted when no captured portrait exists. **Import shader** accepts supported, valid packages, assigns a fresh local ID, stores the imported shader, and selects it. Malformed files, unsupported formats or versions, invalid parameter schemas, values, and portraits are rejected without changing the library. The file input resets after every attempt, so the same corrected file can be selected again.

## Local data and safety

Saved shaders live in the browser's `gltf-shader-visualizer` IndexedDB database. Model selections are held only for the active session. Clearing site data or using a different browser profile removes access to saved shaders, so export important work as JSON backups.

Imported shaders execute locally on the GPU through WebGL2. Review shader source from untrusted packages before using it: it cannot gain server access through this app, but expensive shader code can still slow or reset the local graphics context. Model dependencies are resolved from the files selected in the browser rather than fetched from remote URLs.

## Static hosting

`npm run build` writes a static site to `dist/`. Vite is configured with the relative base `./`, so generated HTML, JavaScript, CSS, bundled portraits, and Monaco worker assets resolve beneath the directory where the site is hosted instead of from the domain root.

For GitHub Pages, publish the contents of `dist/` under the repository subpath, such as `/GLTFvisu/`. The same build can be hosted under another subpath without changing source code. Use `npm run preview` to inspect the production build locally before publishing.
