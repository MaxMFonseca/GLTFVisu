# GLTF Shader Visualizer

GLTF Shader Visualizer is a browser-based workspace for loading local GLB or GLTF models, applying custom GLSL fragment shaders with Three.js, and saving reusable shader presets. The desktop layout keeps the viewer dominant between resizable, collapsible library and editor panels; narrow displays use Library, Viewer, and Editor tabs.

All model files, shader drafts, parameter values, and captured portraits stay in the browser. The app does not upload them to a server.

## Requirements

- Node.js 20.19+ or 22.12+
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
npm run verify:model # validate the bundled Suzanne GLB structure and texture
npm run capture:builtins # regenerate all built-in shader portraits
npm run verify:static # check the production build's static asset closure
npm run preview   # serve the production build locally
```

## Load a model

The viewer starts with the bundled textured Suzanne model already loaded. Use **Choose files** or drop files into the Model area to replace Suzanne with your own model.

- For a GLB, select the `.glb` file. Its resources are normally embedded, so one file is enough.
- For a multi-file GLTF, select the `.gltf` root together with every referenced `.bin`, image, and other local dependency. File names and relative paths must match the URIs in the GLTF.
- If the selection contains more than one `.glb` or `.gltf` root, choose the intended root from **Model root**, then select **Load selected model**.

The selected files are resolved through temporary browser object URLs and released after loading. Missing, malformed, and unsupported resources produce a visible error without replacing the previously loaded model.

After a model loads, use **Reset view** to fit it in the camera. When animation clips are present, choose a clip with **Animation clip** and use **Play** or **Pause**. Loading a different model replaces the current clip list.

When a loaded material exposes editable texture channels, use **Model textures** to replace a channel or restore its original texture. These replacements are session-only: reloading the page restores a fresh bundled Suzanne and its original checker texture, and loading a different model discards the previous model's replacements.

## Bundled Suzanne and built-in portraits

The default model is a self-contained GLB derived from [Khronos glTF Sample Assets — Suzanne](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/Suzanne). Its attribution is **© 2017, UX3D** and **Norbert Nopper for Everything**; it is licensed under [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/). Project modifications, including UV preparation, a rough non-metal material, and repackaging, are recorded in [SUZANNE-LICENSE.md](src/assets/models/SUZANNE-LICENSE.md). The embedded neutral checker texture is original project artwork.

The eight built-in shader cards use committed 320 x 200 PNG captures of this model, produced by the application’s real shader runtime. To regenerate them, run:

```bash
npm run capture:builtins
```

The capture command discovers installed Google Chrome or Microsoft Edge at their standard Windows locations. If neither is available there, point `CHROME_PATH` at a Chromium executable before running it (for PowerShell, `$env:CHROME_PATH = 'C:\\path\\to\\chrome.exe'`). It always replaces all eight portraits together at 320 x 200; do not regenerate or commit only one portrait, because the set must share the same camera, model, and rendering configuration. Chromium is a maintainer-only capture dependency: the generated PNGs remain committed, so normal builds do not need it.

Validate the default model after changing it with:

```bash
npm run verify:model
```

## Create and edit shaders

Built-in shaders are read-only. Select one and choose **Duplicate shader** to create an editable local copy, or choose **Create shader** for a blank local shader.

Source and parameter-schema edits compile after a 400 ms debounce. A failed compile leaves the last valid runtime material active and reports diagnostics in the editor. Runtime parameter value changes update uniforms immediately and do not recompile the shader.

Built-in control values last for the current browser session. Switching shaders preserves each built-in's current values, but reloading resets them to their defaults. Duplicate a built-in to keep its current values and material-input behavior in an editable local shader that can be saved, exported, and imported.

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

## Environment lighting

Open **Environment** in the viewer toolbar to choose one of four bundled 1K CC0 HDR environments: Starfield (Rogland Clear Night), City (Urban Street 01), Desert (Goegap), or Studio (Poly Haven Studio). The HDR files are hosted with the static application, so selecting them does not fetch from Poly Haven or another third party at runtime. They remain available without a network connection when the site is served locally or the relevant assets are already cached. Authors, source pages, licenses, and vendored checksums are recorded in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

You can also choose a local `.hdr` file; it stays in browser memory and is not uploaded or saved. A remote environment must be a direct `https://` HDR URL whose server permits cross-origin requests (CORS). An `http://` URL is rejected, and an HTTPS page cannot load insecure HTTP content. Failed replacements leave the previous environment active.

**Skybox** displays the HDR behind the model. **Clear color** displays the selected solid color while keeping the active HDR for PBR reflections. Rotation and intensity update the active environment at runtime without recompiling the shader.

## Texture-aware built-ins

**PBR** starts from each GLTF material's base-color factor and texture, metallic/roughness factors and packed map, and normal map. Its tint, map toggles, metallic and roughness multipliers, normal strength, and environment contribution are runtime controls; changing them does not compile GLSL again.

**Toon** keeps each material's original base-color factor, opacity, texture, UV channel, and texture transform, then applies the selected shadow/light tints and banding. Missing maps use neutral fallbacks.

## Save portraits

With a model loaded and a valid local shader selected, choose **Capture portrait**. Capture reads only the WebGL canvas—not the surrounding interface—and creates a bounded WebP or PNG preview. The shader card updates immediately and the draft becomes unsaved. Choose **Save** to persist the portrait; leaving or reloading before saving discards it.

## Import and export

**Export shader** downloads a sanitized `*.shader.json` file through a temporary Blob URL. The current package envelope is version 2:

```json
{
  "format": "gltf-shader-visualizer",
  "version": 2,
  "shader": {
    "name": "Example",
    "fragmentSource": "void main() { outColor = vec4(1.0); }",
    "materialInputProfile": "none",
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

`npm run build` writes a static site to `dist/`. Vite is configured with the relative base `./`, so generated HTML, JavaScript, CSS, the bundled Suzanne GLB, four bundled HDRs, eight PNG portraits, and Monaco worker assets resolve beneath the directory where the site is hosted instead of from the domain root.

For GitHub Pages, publish the contents of `dist/` under the repository subpath, such as `/GLTFVisu/`. The same build can be hosted under another subpath without changing source code. Use `npm run preview` to inspect the production build locally before publishing.

After building, `npm run verify:static` serves and crawls the output under a simulated `/GLTFVisu/` repository path. It rejects root-relative `/assets` requests and checks exactly one bundled GLB, the four HDRs, all eight PNG portraits, the Monaco worker, and JavaScript/CSS chunks.
