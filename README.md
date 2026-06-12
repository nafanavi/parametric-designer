# Cabinet Studio (scratch)

Low-code platform for parametric 3D configurators. This scratch focuses on the
cabinet/furniture domain end-to-end so the architecture can be evaluated
before wiring in a real BREP kernel.

## Architecture

```
src/
├── core/                  # CoreAPI — BREP abstraction
│   ├── api.ts             # interface: box, translate, union, subtract, snapshot
│   └── stub.ts            # in-memory stand-in; swap for ClassCAD later
├── domain/cabinet/        # DomainAPI for cabinets
│   └── api.ts             # cabinet, panel, shelf, door, drawer
├── model/                 # ParametricModel as source code
│   ├── ast/               # acorn-based AST rewrites (property writes, child insert, delete)
│   ├── runtime.ts         # evaluates source string → scene tree + params
│   └── example.ts         # initial source loaded into the editor
├── viewer/                # Three.js scene (R3F)
│   ├── Scene.tsx
│   └── SolidMesh.tsx
├── editor/                # Visual editor shell
│   ├── EditorLayout.tsx
│   ├── ActionToolbar.tsx  # top toolbar (Prompt toggle)
│   ├── CatalogPanel.tsx   # drag-source for new parts
│   ├── SourcePanel.tsx
│   └── PropertyPanel.tsx
└── store/
    └── modelStore.ts      # Zustand: source, overrides, selection, run result
```

## How a change flows through the system

1. User edits the source text (or drags a part from the catalog / viewport, which rewrites the source via AST helpers).
2. `runModel()` evaluates the source with `api` (DomainAPI) and `param()` in scope.
3. Each DomainAPI call drops a `SceneNode` into the tree and creates `SolidId`s
   in the CoreAPI.
4. The viewer reads leaves, fetches snapshots from `core.snapshot(id)`, renders.
5. Clicking a mesh sets `selection` → PropertyPanel shows the originating call's
   params; the auto-generated `param()` inputs let the user retune live.

## Replacing the stub kernel

`createStubCore()` in `src/core/stub.ts` returns the `CoreAPI` interface. A
ClassCAD-backed implementation needs to fulfil the same contract — start a
CCAPI WebSocket session, translate `box`/`translate`/boolean calls into kernel
ops, and produce `SolidSnapshot { mesh, aabb, transform }` from the kernel's
triangulation.

## Run

```bash
npm install
cp .env.local.example .env.local   # optional — fill in a Groq key to enable the prompt panel
npm run dev
```

Open http://localhost:3000.

## LLM prompt panel

The bottom **Prompt** panel sends `{prompt, currentSource}` to `/api/generate`
(see `src/app/api/generate/route.ts`). The route reads server-side env vars and
calls the configured provider through a thin adapter
(`src/model/llm/providers/openai-compatible.ts`).

API keys never leave the server. Swapping providers is config, not code — the
adapter speaks OpenAI's `/chat/completions` shape, which every provider in the
table below accepts.

| Provider | `LLM_BASE_URL` | `LLM_MODEL` (example) | Notes |
| --- | --- | --- | --- |
| Groq (default) | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` | Generous free tier, fast |
| Together.ai | `https://api.together.xyz/v1` | `meta-llama/Llama-3.3-70B-Instruct-Turbo` | Free trial credits |
| OpenRouter | `https://openrouter.ai/api/v1` | provider-prefixed slug | Gateway; some free models |
| Ollama (local) | `http://localhost:11434/v1` | `llama3.1` | No key, runs locally |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` | Paid |

`.env.local`:

```bash
LLM_PROVIDER=openai-compat
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_API_KEY=gsk_...
LLM_MODEL=llama-3.3-70b-versatile
```

If the env vars are absent, the panel still opens but Apply reports
`unavailable` with the missing-var name — no crash.
