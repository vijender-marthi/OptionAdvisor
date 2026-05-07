# AI modernization direction

This document describes how OptionAdvisor could evolve its use of large language models (LLMs) and orchestration: what to optimize for, what to avoid, and how it connects to the product today. It is a **vision and roadmap anchor**, not a guarantee of delivery order or scope.

## Ollama: local inference

**Ollama** runs models on your own hardware (or a machine you control). For OptionAdvisor, that pattern matters for several practical reasons:

- **Privacy:** Prompts can include tickers, position summaries, and watchlist context. Keeping inference local reduces how much of that leaves the boundary you trust.
- **Latency and cost control:** Predictable round-trips for iterative workflows (refine a thesis, re-check constraints) without metering every token against a cloud bill.
- **Offline and dev paths:** Engineers and power users can prototype prompts and small agents without a standing dependency on an external API for every request.

Cloud-hosted models still have a role: stronger models for occasional heavy lifts, burst capacity, or features where latency and data residency trade-offs are acceptable. The split is not “local *or* cloud” but **default posture** (local-first where it helps) plus optional cloud when the product explicitly chooses it.

## LangGraph: orchestration, not one-shot chats

**LangGraph** (and similar graph-based orchestration) fits multi-step flows better than a single completion per user message:

- **Graphs over one-shot completions:** Strategy exploration might branch (narrow by IV regime, then by structure), loop (validate a candidate against checklist rules), or aggregate (combine signal summaries with portfolio overlap). A graph makes those steps explicit and testable.
- **State and checkpoints:** Intermediate results (parsed constraints, retrieved market facts, draft rationale) can be stored and resumed, which supports debugging and safer iteration than hiding everything inside one opaque completion.
- **Human-in-the-loop:** Advisory products benefit from gates where the model proposes and the user confirms—graphs map naturally to “generate → review → revise.”

The goal is not to adopt LangGraph as a slogan; it is to **structure** reasoning so the app can reason in stages, with clear inputs and outputs, instead of treating every question as a single blob of text.

## Product framing

### AI-assisted strategy discovery

The product is not “a chatbot taped onto options screens.” The emphasis is **strategy discovery**: helping users explore what structures and narratives fit their outlook, risk tolerance, and the current tape—grounded in the same analyses the app already surfaces (signals, expiries, checklist verdicts). The LLM assists navigation and explanation in that domain, rather than generic conversation.

### Structured reasoning

Outputs should lean on **explicit shapes**: steps, labeled sections, and where possible **schemas** (e.g. thesis, risks, invalidation, sizing notes) rather than unstructured paragraphs only. When the model cites “facts,” those should tie to **app state or market inputs the system actually has** (cached analysis, checklist outcomes, chain-derived fields)—not invented prices or guarantees. That keeps features reviewable and avoids vague “AI said so” UX.

### Decision support and trade idea generation

The role of the system is **augmented judgment**: clarifying tradeoffs, surfacing angles the user might not have weighted, and generating **ideas** that respect constraints (account sizing, preferred structures, advisory boundaries). It is not **generic automation** of order entry or promises of outcomes. Disclaimers and non-exhaustive language stay aligned with educational and advisory positioning: support decisions, do not replace them.

## Non-goals

- **Auto-execution or “one-click trade” promises** — no implying the app will execute, route, or guarantee fills without explicit, separate product decisions and compliance review.
- **Black-box oracle copy** — no UI that presents model text as infallible truth without traceability to inputs and app-derived data.
- **Undisclosed data offloading** — no sneaking sensitive portfolio or watchlist detail to third parties without clear consent and configuration.

## Relationship to OptionAdvisor today

The codebase already centers **systematic options analysis**: a signal layer drives recommendations and checklist-style verdicts; the UI includes **trade signals** across multiple DTE windows, **watchlist** flows with cached analysis, and routing into deeper **ticker / finder** views; **portfolio** state tracks open and closed positions. A modernization path treats those artifacts as **first-class inputs and anchors** for future LLM-assisted flows—for example, summarizing cross-ticker signal posture, explaining why a structure scored as it did, or proposing alternatives constrained by what the backend already computed—rather than inventing parallel narratives disconnected from the engine.
