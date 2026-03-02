# designtoucher

Node-based visual processing app using WebGL. React + TypeScript + Vite.

## Adding a new op (node)

Ops live in `src/ops/<NN-GroupName>/<NNN-op-id>.tsx`. They are auto-discovered via `import.meta.glob` in `src/ops/all-the-ops.ts` — no manual registration needed.

**File naming convention:** `<NNN>-<op-id>.tsx` where the op's `id` field must match `<op-id>` exactly.

**Op groups:** 10-Sources, 20-Generators, 30-Color, 40-Space, 50-Combinations, 60-Time, 80-Power, 90-Debug

**For simple fragment shader ops**, use `defineFragOp` from `src/ops-frag.ts`:
- Provides `texture2D(inputKey, uv)` for each input, `has_<inputKey>` int, all params as float uniforms, plus `time` and `resolution`
- Output is always `{ out: Tex }` — write to `gl_FragColor`
- `initParams` is optional — omit it if the op has no params
- See `src/ops/30-Color/010-brightness-contrast.tsx` for an example with params, `src/ops/30-Color/015-invert.tsx` for a minimal no-params example

**For complex ops** needing custom runtime/WebGL, use `defineOp` from `src/ops-core.tsx` and manage your own `initRuntime`, `run`, and `destroy`.

## Key architecture

- `Op` type defines an op's behavior (inputs, params, runtime, shader, UI)
- `OpInstance` manages a live instance's runtime state and reactivity
- UI uses "sentence" style: `<Sentence>`, `<InputHandle>`, `<OutputHandle>`, `<SentenceParamNumber>`, `<SentenceParamSelect>`. The sentence should read as natural language, e.g. "Flip [input]", "[input] Brightness 0, Contrast 0" — the verb/label and input handle are ordered so the node reads like a phrase.
- Canvas/node graph powered by `@xyflow/react`
- WebGL textures via `Tex` / `Fbo` from `src/mygl.ts`
