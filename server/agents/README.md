# server/agents — Investor-persona agents (R0.3)

## Purpose

Give Particle's AI chat a "persona mode" where the user can ask the same
question six different ways: "what would Buffett say?", "what would
Graham say?", "Lynch?", "Munger?", "Klarman?", "Marks?".

Each persona is an agent instance with:

- a **system prompt** built from **public, citable primary sources** only
  (Berkshire letters, *Security Analysis*, *The Intelligent Investor*,
  *One Up on Wall Street*, Poor Charlie's Almanack, *Margin of Safety*,
  Oaktree memos);
- a **scoring rubric** with named dimensions and weights so the output
  is interpretable, not a vibes check;
- a **method_doc_url** to a public reference so users can verify the
  methodology themselves;
- a declared **required_tools** list from the MCP registry — personas
  cannot hallucinate data they have no tool for.

## Non-goals (for R0.3)

- **Not** importing any Fincept persona prompt text. Those are AGPL-3.0.
  Every persona in this directory is written from scratch against the
  public primary sources linked in `method_doc_url`.
- **Not** giving advice. Persona output is prefixed and footered with
  the Particle disclaimer. No broker integration — personas cannot
  place orders (R1.3 paper-trading is the furthest that goes, and its
  schema has a broker-lock invariant).
- **Not** modifying any UI this commit. The persona picker chip in the
  chat header lands in R0.3-b after the server runtime is proven.

## Persona file shape

Each `personas/<id>.js` exports a plain object:

```js
module.exports = {
  id: 'buffett',
  name: 'Warren Buffett',
  era: '1930–',
  method_doc_url: 'https://www.berkshirehathaway.com/letters/letters.html',
  one_liner: '…',
  system_prompt: `…`,
  rubric: {
    scale: '0-10',
    dimensions: [{ name, weight, ask }, …],
    composite: 'weighted_mean',
  },
  required_tools: [ /* MCP tool names */ ],
  // Optional — narrative lens for the response.
  lens: 'owner_earnings + moat + management + margin_of_safety',
};
```

## Runtime

`runtime.run({ personaId, question, ctx, llm, registry })`:

1. Load the persona module.
2. Compose the system prompt with the MCP-registry tool metadata for
   the persona's `required_tools`.
3. Build the user turn (the question + any instrument context).
4. Invoke `llm.chatJson(...)` — in production this is the multi-LLM
   adapter from server/llm; in tests it's a stub.
5. Parse the model output into
   `{ summary, rubric_score, dimension_scores, citations, raw }`.
6. Return the structured response. The caller (a new
   /api/personas/:id route in R0.3-b) serialises this into the chat
   stream; the existing chat UI renders it the same way it renders any
   AI turn.

## What R0.3 does NOT modify

- `client/**` — zero client changes (R0.3-b adds the picker chip).
- `server/routes/search.js` — frozen. New route lives at
  `server/routes/personas.js`.
- `server/services/modelRouter.js`, `server/services/aiToolbox.js` —
  frozen.
- Auth / billing / LGPD / onboarding.

## Files

- `README.md`                — this file.
- `personas/buffett.js`      — Warren Buffett.
- `personas/graham.js`       — Benjamin Graham.
- `personas/lynch.js`        — Peter Lynch.
- `personas/munger.js`       — Charlie Munger.
- `personas/klarman.js`      — Seth Klarman.
- `personas/marks.js`        — Howard Marks.
- `personas/index.js`        — exports the persona registry.
- `runtime.js`               — the `run()` function.
- `__tests__/runtime.test.js` — offline smoke tests (stub LLM).
