const fs = require("fs");
const path = require("path");

const DATA = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "si_case_fact.mock.json"), "utf8")
);

/**
 * NOT a ZCQL client. Runs the same filter/group logic each template's
 * ZCQL describes, against the 350-row local seed dataset. Proves the
 * builder's substitution + validation are correct; does NOT prove live
 * ZCQL accepts the string (that's probe/probes.sql). Swap for a real
 * client once the probe kit confirms the constructs.
 */

const { PLANS } = require("./plans");

function runMock(templateId, boundParams, scopeValues) {
  const plan = PLANS[templateId];
  if (!plan) {
    const err = new Error("E_SERVICE_UNAVAILABLE");
    err.code = "E_SERVICE_UNAVAILABLE";
    err.details = `${templateId} is registered as a definition only; its executor dependency is not yet available.`;
    throw err;
  }

  const scopeSet = new Set(scopeValues);
  const rowFilter = plan.filter(boundParams);
  const matched = DATA.filter((r) => scopeSet.has(r.unit_id) && rowFilter(r));

  const groups = new Map();
  for (const row of matched) {
    const key = plan.groupKeys.map((k) => row[k]).join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  let rows = [...groups.entries()].map(([key, members]) => {
    const dims = {};
    plan.groupKeys.forEach((k, i) => {
      const raw = key.split("|")[i];
      const num = Number(raw);
      dims[k] = Number.isNaN(num) || raw === "" ? raw : num; // keep string ids (accused_person_id) as strings
    });
    let value;
    if (plan.agg === "count") value = members.length;
    else if (plan.agg === "rate_chargesheeted")
      value = members.filter((m) => m.is_chargesheeted).length / members.length;
    else if (plan.agg === "rate_convicted")
      value = members.filter((m) => m.is_convicted).length / members.length;
    else if (plan.agg === "avg_days")
      value = members.reduce((s, m) => s + (m.investigation_days || 0), 0) / members.length;
    return { ...dims, value };
  });

  if (plan.having) rows = rows.filter((r) => plan.having(r.value));

  if (plan.sortDesc) rows.sort((a, b) => b.value - a.value);
  else rows.sort((a, b) => plan.groupKeys.reduce((acc, k) => acc || (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0), 0));

  return {
    rows,
    groupKeys: plan.groupKeys,
    agg: plan.agg,
    rows_returned: rows.length,
    total_cases: matched.length,
  };
}

module.exports = { runMock };
