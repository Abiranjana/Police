# SCRB Insight — Query & Answer Engine (P2 / P5)

Natural-language question answering over Karnataka SCRB crime records, with a full
evidence trail behind every answer. This repository is the **query engine (`scrb-api`)**
and the **frontend (`scrb-web`)** — the P2 and P5 lanes of the system.

> An officer types *"chain snatchings in my station this year by day and hour"* and gets
> back an answer, a chart, and a panel showing exactly how the answer was produced: the
> intent detected, the permission applied, the precise query that ran, the tables read,
> rows returned, and timing. Nothing is a black box.

---

## The one idea that matters

**The language model never writes a query and never reads a row of police data.**

It only reads the question and produces structured intent and entities. A human-written,
pre-reviewed **query template** is then selected from a fixed library, its parameters are
type-validated, a jurisdiction predicate is appended, and the resulting query runs against
a **read-only** analytical copy of the database.

```
question ─▶ [P4: intent router] ─▶ [P2: this engine] ─▶ [P1: database] ─▶ answer + evidence
             LLM: intent+entities     templates, validation,   read-only OLAP
                                      permission, execution
```

The layer boundary is the whole security argument: **everything above the query builder is
probabilistic; everything below it is deterministic.** A wrong intent produces a
wrong-but-safe answer or an honest refusal — never an unauthorised read. The trade-off is
stated plainly: we answer only question types we have prepared. When a question falls
outside the catalogue, the system says so and suggests the nearest supported question
rather than guessing.

---

## What's in this repo

```
scrb-api/                 the query engine (Node.js on Catalyst AppSail)
  index.js                HTTP routes, staged pipeline, mock/live switch
  lib/
    types.js              typed validators — the honest replacement for bind params
    templates.js          loads + validates the template registry at boot
    builder.js            validates entities, substitutes params, appends scope predicate
    permission.js         P3 permission-engine stub (always "permitted" for now)
    plans.js              per-template group/aggregate spec, shared by both executors
    mockExecutor.js       runs template logic against local seed data (default)
    liveExecutor.js       runs the same ZCQL against real Catalyst OLAP (flip a switch)
    respond.js            assembles the Contract 3 answer + evidence + visual
    labels.js             code→name lookups (12 → "Chain snatching")
  templates/              31 query templates (17 executable, 14 definition-only)
  data/                   350-row synthetic fact table with an embedded pattern

scrb-web/                 the frontend (React + Vite on Catalyst Slate)
  src/App.jsx             ask → poll progress → render answer + 14-field evidence panel
```

---

## The contracts

Three lanes meet at three frozen JSON contracts. Each was agreed before code was written,
which is why the lanes can be built and swapped independently.

| Contract | From → To | Shape |
|---|---|---|
| **Contract 2 — Understanding** | P4 router → P2 engine | `{ intent, confidence, entities: { slot: {value,type,source} \| null } }` |
| **Contract 3 — Answer** | P2 engine → P5 frontend | `{ outcome, answer{summary,visual,table}, evidence{14 fields}, error }` |
| **Contract 4 — Progress** | P2 engine → P5 frontend | `{ stage, stages_completed[], elapsed_ms, terminal }` |

The frontend was built entirely against a Contract 3 *fixture* before the backend existed.
When the real engine came online, one import changed. That is contract-first working as
intended.

---

## The evidence panel — the actual product

Every answer carries **fourteen** evidence fields, numbered `01/14`…`14/14`. The set is
fixed; a missing field is a defect you can count, and the UI turns the counter amber if any
are absent. The fields: question, intent, entities, permission, template, **the exact ZCQL
executed**, tables read, source, rows returned, rows suppressed, timing, confidence, data
freshness, and warnings.

This is what makes the system usable as evidence rather than as a toy: a reviewer can read
the precise query that produced a number and reproduce it.

---

## ZCQL: the constraint that shaped everything

Catalyst's query language (ZCQL) is not MySQL. Reading the current documentation end to end
surfaced hard limits that invalidated the original demo query and drove the whole data design:

- **Five functions only**: `MIN MAX COUNT SUM AVG`. No `DAYOFWEEK`, `HOUR`, `MONTH`, no date
  arithmetic, no `CASE WHEN`.
- **Max 5 WHERE conditions**, **max 4 joins**, **300 rows / 20 columns** per query.
- **No prepared statements** — the API takes one raw string.

Consequences, all handled in this codebase:

1. **Derived dimensions are precomputed as columns** (`day_of_week`, `hour_of_day`,
   `year_num`, `year_month`, …). ZCQL can't derive a weekday from a date, so the weekday is
   a column. This is why the flagship heatmap is executable at all.
2. **One flat fact table** (`si_case_fact`) instead of joining ~20 normalised tables against
   a 4-join ceiling. Labels are pre-joined; the join budget stays free for genuinely
   relational questions.
3. **Rates use `AVG()` on a boolean**, avoiding the missing `CASE WHEN`.
4. **No bind parameters → typed whitelist substitution.** Every entity is validated against a
   declared type before any string is assembled; there is deliberately no `string`/`raw`
   param type, so free text never reaches a query. That is the injection defence, and the
   executed string is printed in the evidence panel for inspection.
5. **The 5-condition budget is checked at build time.** The permission engine's scope
   predicate is appended *after* a template is authored, so a template can pass its own tests
   and still fail for a real user. Every template declares its WHERE budget and the registry
   loader refuses to register one that would overflow once the scope predicate is added.

Full findings: `docs/ZCQL_CAPABILITY_REPORT.md` and `docs/P2_DAY1_FINDINGS.md`.

---

## Template catalogue — 31 registered

**17 executable** (return real answers): TREND_BY_TIME, TREND_BY_MONTH, TREND_BY_WEEK,
TREND_COMPARE_PERIOD, COUNT_BY_AREA, COUNT_BY_DISTRICT, COUNT_BY_CRIME_TYPE, TOP_CRIME_TYPES,
VICTIM_BREAKDOWN, ACCUSED_BREAKDOWN, CHARGESHEET_RATE, CONVICTION_ANALYSIS,
INVESTIGATION_DELAY, SEASONAL_PATTERN, HOTSPOT_CURRENT, PERSON_CASE_HISTORY,
HABITUAL_OFFENDERS.

**14 definition-only** (registered, documented, interface fixed — return an honest
`E_SERVICE_UNAVAILABLE` naming their missing dependency): the network-graph family
(NETWORK_AROUND_PERSON, COMMUNITY_DETAIL, BRIDGE_PERSONS, NETWORK_EVOLUTION), forecasting
(FORECAST_TREND, FORECAST_HOTSPOT), spatial/temporal (HOTSPOT_EMERGING, EVENT_IMPACT),
behaviour/support (BEHAVIOUR_PROFILE, SIMILAR_CASES, LEAD_SUGGESTION), socio-economic
(SOCIO_CORRELATION, RISK_FACTORS), and financial (MONEY_TRAIL). These depend on Module C's
identity graph, QuickML models, or datasets not present in the FIR schema; they are
registered so the intent catalogue is complete and the hand-off interface is locked.

---

## What is real, and what is pending

Stated plainly, because honesty about scope is the point of the evidence panel.

**Real and working:**
- The full pipeline: question → Contract 2 → validation → template → ZCQL → answer → 14-field evidence.
- 17 executable templates, three chart types (heatmap, bar, line), label resolution.
- Type-validated substitution; build-time WHERE-budget enforcement; honest refusals.
- Deployed live on Catalyst (AppSail backend + Slate frontend).

**Mocked, with a built-in swap:**
- Execution runs against a 350-row local seed table, **not** live Catalyst data. Every
  answer says so in evidence field 14. A drop-in `liveExecutor.js` runs the identical ZCQL
  against the real Data Store; flip `USE_LIVE_DB` once (1) P1's `si_case_fact` is populated
  and (2) the probe kit has confirmed the ZCQL constructs execute live.
- The intent router is stubbed by a hand-written Contract 2 in the frontend; swap for P4's
  endpoint when live. The permission engine is P3's day-one "always permitted" stub.

**Not yet built:** the 14 definition-only intents' executors; voice and Kannada input; real
authentication.

---

## Running locally

```bash
# backend
cd scrb-api && npm install && node index.js      # → http://localhost:9000

# frontend (separate terminal)
cd scrb-web && npm install && npm run dev         # → http://localhost:5173
```

Test the engine directly, no frontend or LLM required — this is the point of contract-first:

```bash
curl -X POST localhost:9000/conversations/c1/turns \
  -H "Content-Type: application/json" \
  -d '{"question":"chain snatchings by day and hour","as_unit_id":4430006,
       "contract2":{"intent":"TREND_BY_TIME","confidence":0.94,
       "entities":{"crime_subhead_id":{"value":12,"source":"STATED"},
                   "year_num":{"value":2025,"source":"DERIVED"}}}}'
# → { turn_id }  then poll GET /turns/{turn_id}/status until terminal, then GET /turns/{turn_id}
```

## Deploying (Catalyst)

```bash
catalyst deploy --only appsail    # backend
catalyst deploy --only slate      # frontend
```

CORS is handled by the Catalyst console whitelist (Whitelisting → add the Slate domain,
enable CORS), not in application code.

---

## Switching to live data

1. P1 publishes `si_case_fact` with the columns in `docs/P2_DAY1_FINDINGS.md` §4.
2. Run `probe/probes.sql` in the Catalyst ZCQL console; confirm the constructs each template
   uses (two-column GROUP BY, AVG-on-boolean, HAVING, the 5-condition budget) actually execute.
3. Set `USE_LIVE_DB=true` (env var or the constant in `index.js`) and redeploy.

Nothing else changes — same builder, same templates, same validation, same frontend. Only
the execution step swaps, because the mock and live executors return the same shape by design.
