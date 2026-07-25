const express = require("express");
const crypto = require("crypto");

const { templatesForIntent, loadTemplates } = require("./lib/templates");
const { unwrapEntities, buildQuery } = require("./lib/builder");
const { decidePermission } = require("./lib/permission");
const { runMock } = require("./lib/mockExecutor");
const { runLive } = require("./lib/liveExecutor");
const { PLANS } = require("./lib/plans");
const { buildAnswer, buildUnsupported } = require("./lib/respond");

// ── The one switch that turns the demo into the real system ──
// false → query the 350-row local seed data (mockExecutor). Safe default;
//         every answer carries a MOCK_EXECUTION warning in the evidence panel.
// true  → run the exact same ZCQL against the real Catalyst OLAP Data Store
//         (liveExecutor). Flip to true ONLY after (1) P1's si_case_fact table
//         is live and populated and (2) the probe kit has confirmed the ZCQL
//         constructs execute. Can also be set via env var without a code edit.
const USE_LIVE_DB = process.env.USE_LIVE_DB === "true" || false;

const app = express();

// NOTE: CORS is handled by Catalyst's platform whitelist (console →
// Whitelisting → scrb-web-dijitaup.onslate.in, CORS enabled), NOT here.
// The Zoho gateway injects Access-Control-Allow-Origin itself. If Express
// also set that header, the browser would see two values and reject the
// response ("contains multiple values"). So this app sets no CORS headers.

app.use(express.json());

// Load + validate the template registry at boot. A bad template fails
// fast, here, not on the first real request.
try {
  const { byId } = loadTemplates();
  console.log(`Loaded ${byId.size} template(s): ${[...byId.keys()].join(", ")}`);
} catch (e) {
  console.error("Template registry failed to load:", e.message);
  process.exit(1);
}

// ---------------------------------------------------------- in-memory --
// One process, one demo. A restart clears this. That's fine for today —
// nothing here claims to be durable storage.
const turns = new Map();

const STAGE_SEQUENCE = [
  "QUEUED",
  "UNDERSTANDING",
  "PERMISSION",
  "TEMPLATE_SELECT",
  "QUERYING",
  "ANALYSING",
  "EXPLAINING",
  "AUDITING",
  "DONE",
];

function newTurnId() {
  return "trn_" + crypto.randomBytes(6).toString("hex");
}

// ------------------------------------------------------------- routes --

app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "scrb-api" });
});

/**
 * Accepts a Contract 2-shaped payload directly in the body — this is the
 * point of contract-first: M6 is fully testable with curl before P4's
 * router exists. Body:
 * {
 *   "question": "chain snatchings in my station this year by day and hour",
 *   "as_unit_id": 4430006,
 *   "contract2": { intent, confidence, is_followup, entities, suggested_intents? }
 * }
 */
app.post("/conversations/:conversationId/turns", (req, res) => {
  const { question, as_unit_id, contract2 } = req.body || {};

  if (!contract2 || !contract2.intent) {
    return res.status(400).json({ error: "E_BAD_REQUEST", message: "contract2 payload with an intent is required" });
  }

  const turnId = newTurnId();
  const startedAt = Date.now();
  turns.set(turnId, {
    stage: "QUEUED",
    stagesCompleted: [],
    startedAt,
    result: null,
  });

  // Simulate the pipeline's real stage timings rather than resolving
  // instantly — this is what makes Contract 4 polling worth building.
  const timeline = [
    { stage: "UNDERSTANDING", ms: 40 },
    { stage: "PERMISSION", ms: 30 },
    { stage: "TEMPLATE_SELECT", ms: 20 },
    { stage: "QUERYING", ms: 220 },
    { stage: "ANALYSING", ms: 90 },
    { stage: "EXPLAINING", ms: 260 },
    { stage: "AUDITING", ms: 30 },
  ];

  let elapsed = 0;
  timeline.forEach(({ stage, ms }, i) => {
    elapsed += ms;
    setTimeout(() => {
      const t = turns.get(turnId);
      if (!t) return;
      t.stagesCompleted.push({ stage, ms });
      t.stage = i === timeline.length - 1 ? "FINALISING" : stage;

      if (stage === "AUDITING") {
        // resolve the turn — may be async when live DB is on
        (async () => {
          try {
            const outcome = await resolveTurn({ question, as_unit_id, contract2, req });
            t.result = outcome;
            t.stage = "DONE";
          } catch (e) {
            t.result = {
              outcome: "ERROR",
              answer: null,
              evidence: null,
              error: { code: e.code || "E_INTERNAL", message: e.message, detail: e.details ? JSON.stringify(e.details) : null },
            };
            t.stage = "FAILED";
          }
        })();
      }
    }, elapsed);
  });

  res.status(202).json({ turn_id: turnId, status_url: `/turns/${turnId}/status` });
});

async function resolveTurn({ question, as_unit_id, contract2, req }) {
  const candidates = templatesForIntent(contract2.intent);
  if (candidates.length === 0) {
    return buildUnsupported({
      questionRaw: question,
      intent: contract2.intent,
      confidence: contract2.confidence,
      suggestedIntents: contract2.suggested_intents,
    });
  }

  const template = candidates[0]; // only one per intent today; picking logic grows with the library

  // Definition-only templates are registered so the interface is fixed and
  // the catalogue is complete, but their executor dependency (Module C graph,
  // QuickML forecast, financial data) isn't live yet. Return an honest
  // outcome rather than fabricating data.
  if (template.definition_only) {
    return {
      outcome: "UNSUPPORTED",
      answer: null,
      evidence: null,
      error: {
        code: "E_SERVICE_UNAVAILABLE",
        message: `"${template.intent}" is designed and registered, but needs a dependency that isn't live yet.`,
        detail: `Requires: ${template.requires_service}`,
        rule_code: null,
        clarifying_question: null,
        options: null,
        nearest_supported: ["TREND_BY_TIME", "COUNT_BY_AREA", "TOP_CRIME_TYPES"],
      },
    };
  }

  const { values, sources } = unwrapEntities(contract2.entities);

  const permission = decidePermission({ asUnitId: as_unit_id || 4430006 });

  let zcql, boundParams;
  try {
    ({ zcql, boundParams } = buildQuery(template, values, permission.scope));
  } catch (e) {
    if (e.code === "E_CLARIFICATION_NEEDED") {
      const NICE = {
        crime_subhead_id: "which specific offence (e.g. chain snatching)",
        year_num: "which year",
        crime_head_id: "which crime group",
      };
      const asks = e.missing.map((m) => NICE[m] || m).join(" and ");
      return {
        outcome: "CLARIFICATION_NEEDED",
        answer: null,
        evidence: null,
        error: {
          code: "E_CLARIFICATION_NEEDED",
          message: `I can answer that — I just need to know ${asks}.`,
          detail: null,
          rule_code: null,
          clarifying_question: `Please tell me ${asks}.`,
          options: null,
          nearest_supported: null,
          missing_slots: e.missing,
        },
      };
    }
    throw e; // E_ENTITY_INVALID and anything else bubble to the ERROR handler
  }

  // Same ZCQL, two possible executors. The result shape is identical either
  // way, so everything downstream (respond.js, the UI) is unaffected.
  let mockResult;
  if (USE_LIVE_DB) {
    const plan = PLANS[template.id];
    mockResult = await runLive(zcql, req, plan);
  } else {
    mockResult = runMock(template.id, boundParams, permission.scope.values);
  }

  // reattach sources for the evidence panel
  const entitiesWithSource = {};
  for (const [slot, entity] of Object.entries(contract2.entities || {})) {
    entitiesWithSource[slot] = entity;
  }

  return buildAnswer({
    template,
    zcql,
    tablesUsed: template.tables_declared,
    permission,
    entities: entitiesWithSource,
    questionRaw: question,
    intent: contract2.intent,
    confidence: contract2.confidence,
    live: USE_LIVE_DB,
    executionMs: {
      route: 8,
      permission: 30,
      query: 220,
      analytics: 90,
      summarise: 260,
      total: 608,
    },
    mock: mockResult,
  });
}

app.get("/turns/:turnId/status", (req, res) => {
  const t = turns.get(req.params.turnId);
  if (!t) return res.status(404).json({ error: "E_NOT_FOUND" });

  const terminal = t.stage === "DONE" || t.stage === "FAILED";
  res.json({
    turn_id: req.params.turnId,
    stage: t.stage,
    stages_completed: t.stagesCompleted,
    elapsed_ms: Date.now() - t.startedAt,
    poll_after_ms: 400,
    terminal,
  });
});

app.get("/turns/:turnId", (req, res) => {
  const t = turns.get(req.params.turnId);
  if (!t) return res.status(404).json({ error: "E_NOT_FOUND" });
  if (!t.result) {
    return res.status(409).json({ error: "E_NOT_READY", message: "poll /status until terminal:true first" });
  }
  res.json({ turn_id: req.params.turnId, conversation_id: req.params.turnId, audit_id: "aud_" + req.params.turnId.slice(4), ...t.result });
});

const PORT = process.env.X_ZOHO_CATALYST_LISTEN_PORT || process.env.PORT || 9000;
app.listen(PORT, () => {
  console.log(`scrb-api listening on ${PORT}`);
});
