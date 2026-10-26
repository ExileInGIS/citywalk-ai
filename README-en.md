# CityWalk AI · Personalized City-Walk Route Planner

> An upgraded, runnable MVP built on top of a high-fidelity prototype: deterministic constraint-aware planning, natural-language refinement, a real HTTP agent gateway, and reproducible tests.

**One sentence**: describe when, with whom, how long, how much, and what you like — get a walkable route that satisfies hard constraints, explains itself, and can be refined in natural language.

**Status**: locally runnable MVP. **Not deployed publicly. No real LLM or map key is configured.** Those paths ship as adapters + setup instructions and are explicitly marked unverified. See `docs/DEPLOYMENT.md` and `docs/EVALUATION-REPORT.md`.

---

## Quick start

Requires Node.js ≥ 20 (verified on v24.21.0). No database. No API key needed for the default mode.

```bash
pnpm install
pnpm start          # node server/index.js
# open http://localhost:3000
```

Health check:

```bash
curl -s http://localhost:3000/api/health
```

---

## What works

- Natural-language + structured input (city, duration, time window, budget, party, walking tolerance, interests, food, accessibility, weather, avoid, must-visit)
- Missing-info clarification (city and duration are required)
- Deterministic constraint checks: time, budget, must-visit, avoid, walking limit, unknown accessibility
- Conflicts with executable options; no silent relaxation
- Map + timeline + summary, synchronized selection
- Natural-language refinement: walk less, swap category, add theme, budget, end time, keep ends, rain/indoor, de-duplicate, remove category
- Before/after diff, constraint checklist, sources and uncertainty notes
- Save / export Markdown and JSON (localStorage)
- `POST /api/agent/run` with Mock/Remote modes, request IDs, schema validation, timeout and fallback
- Map provider registry: SVG mock (offline) and Leaflet adapter (real OSM coordinates, needs network)
- Tests and offline evaluation: `pnpm test`, `pnpm eval`, `pnpm check`

---

## Real AI service

Copy `.env.example` to `.env` and set:

```bash
AGENT_MODE=remote
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=your-server-side-key
LLM_MODEL=deepseek-chat
AGENT_FALLBACK=mock
```

Keys live server-side only. The model proposes places and explanations; **all times, budgets and distances are recomputed and schema-validated by the server**. On failure the app falls back to the deterministic planner and labels the result as degraded.

Coze support exists as a minimal adapter but **has not been tested**.

---

## Real map

Default is the offline SVG mock. To use Leaflet + OSM, enable the CDN and adapter in `index.html`, set `MAP.provider = 'leaflet'`, and allow the CDN/tile domains in the server CSP. 8 of 12 places have verified OpenStreetMap coordinates; 4 generic places are skipped on real maps. Route lines are straight-line illustrations, **not navigation**.

---

## Data honesty

- Place names are real Nanjing landmarks; durations, costs, walking times and distances are **estimates/example data**.
- Opening hours are always `null` → the UI shows “info to be confirmed”. No real-time status is invented.
- Coordinates come from OpenStreetMap (ODbL 1.0); some are area centres, not entrances.
- Photos are inherited from the upstream repository; **their licence is unverified**.
- No user research, no production metrics, no public deployment is claimed.

---

## Documentation

Chinese docs live in `docs/`: audit, competitive analysis, PRD, user flows, metrics, architecture, agent workflow, RAG decision, API integration, test plan, evaluation report, deployment, retrospective. The main README is in Chinese (`README.md`).

---

## Upstream & licence

- Upstream prototype: https://github.com/ExileInGIS/citywalk-ai
- Map data: © OpenStreetMap contributors, ODbL 1.0
- This repository declares no open-source licence (the upstream provided none), so all rights are reserved by default. Image assets are not covered.
