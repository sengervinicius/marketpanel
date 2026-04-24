# server/llm — Multi-LLM adapter layer (R0.2)

## Purpose

Give Particle a uniform, provider-agnostic interface for LLM calls so
that:

- persona agents (R0.3) can be steered between Anthropic, Ollama (local)
  and — in later stages — Groq / DeepSeek / Gemini;
- compliance-sensitive users can route inference to a locally-hosted
  Ollama model without touching application code;
- cost-sensitive workloads (draft summaries, cheap synthesis) can move
  to a smaller / faster backend without the caller knowing;
- integration tests don't need to hit a real network.

## Non-goals (for R0.2)

- **Not** replacing `server/services/modelRouter.js`. Router stays
  in charge of intent-classification + provider selection for the main
  `/api/search/chat` streaming path. The adapter is a parallel, adapter-
  shaped gateway that persona agents and non-streaming callers can use.
- **Not** modifying any existing Anthropic streaming code path. R0.2-a
  (this commit) ships the adapter scaffold + tests. R0.2-b wires
  `aiToolbox.runToolLoopStream` to optionally use the adapter under
  `LLM_ABSTRACTION_V1` + a per-user `llm_provider_override`.

## Adapter contract

```js
// All adapters expose a single chatJson() method for the non-streaming
// path. Streaming variant arrives in R0.2-b.
interface Adapter {
  name: string,              // "anthropic" | "ollama" | …
  chatJson({
    model,                    // provider-specific model id
    messages,                 // [{ role: 'user'|'assistant'|'system', content }]
    system,                   // optional system prompt (Anthropic style)
    tools,                    // optional tool schema array (Anthropic shape)
    max_tokens,               // hard cap
  }): Promise<{
    content: [{ type: 'text', text }],   // normalised to Anthropic blocks
    usage:   { input_tokens, output_tokens },
    stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'error',
    provider: string,                    // echoes `name` for auditing
    model: string,                       // echoes the model id
  }>
}
```

Every adapter normalises its upstream response into the Anthropic-style
content-block shape. This matches what `aiToolbox.runToolLoopStream`
already reads, so the adapter is a drop-in.

## Selection

`getAdapter(name)` returns a singleton instance by name. Unknown names
throw — adapters must be explicitly registered in `adapter.js`.

## Fail-open

If an adapter's upstream is unreachable, `chatJson` resolves with
`{ stop_reason: 'error', content: [{type:'text', text:''}], ... }`
and the caller can fall back to the legacy Anthropic path. This
matches the "additive, reversible, feature-flagged" rule — a new
adapter misbehaving never breaks the chat.

## Feature flag

`LLM_ABSTRACTION_V1` — OFF by default. Reserved for R0.2-b when the
adapter starts being consulted by `aiToolbox.runToolLoopStream`. In
R0.2-a the adapter is purely test-callable.

## Files

- `adapter.js`               — `getAdapter` + `register` + types.
- `providers/anthropic.js`   — wraps `/v1/messages`. Thin HTTP client.
- `providers/ollama.js`      — `http://localhost:11434/api/chat` by
                                default; `OLLAMA_URL` env overrides.
- `__tests__/adapter.test.js` — mock-HTTP smoke tests.

## What R0.2 does NOT modify

- `server/services/modelRouter.js` — frozen.
- `server/services/aiToolbox.js` streaming path — frozen (until R0.2-b).
- `server/routes/search.js` — frozen.
- `client/**` — unchanged.
- Any auth / billing / LGPD / onboarding file.
