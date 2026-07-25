/**
 * LIVE ZCQL executor — the real thing, drop-in replacement for mockExecutor.
 *
 * Runs the exact ZCQL string builder.js produced against the real Catalyst
 * Data Store (OLAP), via the zcatalyst-sdk-nodejs package. Returns the SAME
 * shape mockExecutor returns, so nothing downstream changes.
 *
 * NOT wired on by default. index.js chooses mock vs live via USE_LIVE_DB.
 * Turn it on only AFTER:
 *   1. P1's si_case_fact table exists in the Data Store with the columns
 *      listed in P2_DAY1_FINDINGS §4, populated.
 *   2. The probe kit (probe/probes.sql) has confirmed the ZCQL constructs
 *      each template uses actually execute live (GROUP BY 2 cols, AVG on
 *      boolean, HAVING, the 5-condition budget). Until then the templates
 *      are built on documented behaviour, not confirmed behaviour.
 *
 * This file is deliberately untested from the dev sandbox because the
 * sandbox can't reach Catalyst. Its first real run must be on AppSail.
 */

// zcatalyst-sdk-nodejs is provided by the AppSail runtime. Requiring it
// here would crash the mock-mode server locally, so it's required lazily
// inside execute(), only when live mode is actually used.
let catalyst = null;

/**
 * @param {string} zcql      the exact statement builder.js produced
 * @param {object} req       the AppSail request (needed by catalyst.initialize)
 * @param {object} plan      { groupKeys, agg } so we can normalise the rows
 *                           into the same shape the mock returns
 */
async function runLive(zcql, req, plan) {
  if (!catalyst) catalyst = require("zcatalyst-sdk-nodejs");
  const app = catalyst.initialize(req);

  const raw = await app.zcql().executeZCQLQuery(zcql);
  // raw is [ { si_case_fact: { day_of_week: 5, "COUNT(case_id)": 12, ... } }, ... ]
  const table = "si_case_fact";
  const rows = raw.map((entry) => {
    const cols = entry[table] || Object.values(entry)[0] || {};
    const dims = {};
    for (const k of plan.groupKeys) dims[k] = maybeNum(cols[k]);
    // aggregate column comes back keyed by its ZCQL expression
    let value;
    if (plan.agg === "count") value = maybeNum(cols["COUNT(case_id)"]);
    else if (plan.agg === "rate_chargesheeted") value = maybeNum(cols["AVG(is_chargesheeted)"]);
    else if (plan.agg === "rate_convicted") value = maybeNum(cols["AVG(is_convicted)"]);
    else if (plan.agg === "avg_days") value = maybeNum(cols["AVG(investigation_days)"]);
    return { ...dims, value };
  });

  const total = rows.reduce((s, r) => s + (plan.agg === "count" ? r.value : 1), 0);
  return {
    rows,
    groupKeys: plan.groupKeys,
    agg: plan.agg,
    rows_returned: rows.length,
    total_cases: total,
  };
}

function maybeNum(v) {
  if (v === null || v === undefined) return v;
  const n = Number(v);
  return Number.isNaN(n) ? v : n;
}

module.exports = { runLive };
