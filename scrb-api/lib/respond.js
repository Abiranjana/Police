const L = require("./labels");

/**
 * Turns a bound query + mock result into the exact Contract 3 shape P5's
 * UI renders. Every key here must match contract-3-answer.schema.json.
 * Handles each visual_type: HEATMAP_DAY_HOUR, BAR_CATEGORY, LINE_TIME.
 */

function labelFor(groupKey, value) {
  if (groupKey === "crime_subhead_id") return L.subhead(value);
  if (groupKey === "unit_id") return L.unit(value);
  if (groupKey === "district_id") return L.district(value);
  if (groupKey === "victim_gender") return L.gender(value);
  if (groupKey === "accused_age_band") return L.ageBand(value);
  if (groupKey === "day_of_week") return L.day(value);
  if (groupKey === "week_of_year") return L.week(value);
  if (groupKey === "year_month") return L.yearMonth(value);
  if (groupKey === "year_num") return String(value);
  if (groupKey === "season") return ["Jan–Mar", "Apr–Jun", "Jul–Sep", "Oct–Dec"][value] || `Q${value}`;
  if (groupKey === "accused_person_id") return String(value);
  return String(value);
}

function buildVisualAndTable(template, mock) {
  const vtype = template.result.visual_type;
  const { rows, groupKeys, agg } = mock;
  const isRate = agg === "rate_chargesheeted" || agg === "rate_convicted";
  const isDays = agg === "avg_days";

  if (vtype === "HEATMAP_DAY_HOUR") {
    const cells = rows.map((r) => ({
      day_of_week: r.day_of_week,
      hour_of_day: r.hour_of_day,
      count: r.value,
    }));
    const top = [...rows].sort((a, b) => b.value - a.value).slice(0, 5);
    return {
      visual: {
        type: vtype,
        spec: {
          x: { field: "hour_of_day", label: "Hour", domain: [0, 23] },
          y: { field: "day_of_week", label: "Day", domain: [1, 7], tick_labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] },
          value: { field: "count", label: "Cases" },
          cells,
        },
      },
      table: {
        columns: ["day", "hour", "count"],
        rows: top.map((r) => [L.day(r.day_of_week), r.hour_of_day, r.value]),
        truncated: false,
        total_rows: rows.length,
      },
    };
  }

  // BAR_CATEGORY, LINE_TIME, and MAP_* all share a category/value spec.
  // MAP_CHOROPLETH / MAP_POINTS render as a ranked geographic bar until
  // GeoJSON boundaries are wired in — the data is real, the map polygons
  // aren't, and the visual is labelled honestly rather than faked.
  const key = groupKeys[0];
  const points = rows.map((r) => ({
    category: labelFor(key, r[key]),
    raw: r[key],
    value: isRate ? Math.round(r.value * 1000) / 10 : isDays ? Math.round(r.value) : r.value,
  }));

  return {
    visual: {
      type: vtype === "MAP_CHOROPLETH" || vtype === "MAP_POINTS" ? "BAR_CATEGORY" : vtype,
      spec: {
        x: { field: "category", label: key === "year_month" ? "Month" : key === "district_id" ? "District" : key === "unit_id" ? "Unit" : "Category" },
        value: { field: "value", label: isRate ? (agg === "rate_convicted" ? "Conviction rate (%)" : "Chargesheet rate (%)") : isDays ? "Avg days" : "Cases" },
        points,
        is_rate: isRate,
        geographic: vtype === "MAP_CHOROPLETH" || vtype === "MAP_POINTS",
      },
    },
    table: {
      columns: [key === "year_month" ? "month" : key === "unit_id" ? "unit" : key === "crime_subhead_id" ? "offence" : "category", isRate ? "rate_%" : "count"],
      rows: points.map((p) => [p.category, p.value]),
      truncated: false,
      total_rows: rows.length,
    },
  };
}

function summarise(template, mock) {
  const { rows, agg, total_cases } = mock;
  if (rows.length === 0) {
    return {
      summary: "No matching cases were found for that question.",
      reasoning: "This reflects zero registered cases meeting the filters, not a query failure.",
    };
  }
  const key = mock.groupKeys[0];

  if (template.result.visual_type === "HEATMAP_DAY_HOUR") {
    const peak = rows.reduce((a, b) => (b.value > a.value ? b : a), rows[0]);
    const evening = rows.filter((r) => [5, 6].includes(r.day_of_week) && r.hour_of_day >= 18).reduce((s, r) => s + r.value, 0);
    const share = total_cases ? Math.round((evening / total_cases) * 100) : 0;
    return {
      summary: `Based on ${total_cases} registered case${total_cases === 1 ? "" : "s"}, activity peaks on ${L.day(peak.day_of_week)} at ${String(peak.hour_of_day).padStart(2, "0")}:00 with ${peak.value}.`,
      reasoning: `Friday/Saturday evenings account for ${share}% of matched cases. Describes registered cases; does not by itself separate offending from reporting.`,
    };
  }

  if (agg === "rate_convicted") {
    const top = rows[0];
    return {
      summary: `${L.unit(top.unit_id)} has the highest conviction rate at ${Math.round(top.value * 100)}%, across ${total_cases} case${total_cases === 1 ? "" : "s"}.`,
      reasoning: `Conviction rate is a court outcome and lags registration by months to years, so recent-year figures are structurally low. Read alongside case age.`,
    };
  }

  if (agg === "avg_days") {
    const top = rows[0];
    return {
      summary: `${L.unit(top.unit_id)} has the longest average investigation time at ${Math.round(top.value)} days, across ${total_cases} case${total_cases === 1 ? "" : "s"}.`,
      reasoning: `Average days from registration to chargesheet. Open (unchargesheeted) cases are excluded, so a unit with many open cases can appear artificially fast.`,
    };
  }

  if (agg === "rate_chargesheeted") {
    const top = rows[0];
    return {
      summary: `${L.unit(top.unit_id)} has the highest chargesheet rate at ${Math.round(top.value * 100)}%, across ${total_cases} case${total_cases === 1 ? "" : "s"}.`,
      reasoning: `Rate is share of cases chargesheeted, computed with AVG on a boolean flag. A lower rate can indicate active or recent investigations rather than failure. Chargesheet source pending P1 confirmation.`,
    };
  }

  const top = rows[0];
  const topLabel = labelFor(key, top[key]);
  return {
    summary: `Across ${total_cases} registered case${total_cases === 1 ? "" : "s"}, ${topLabel} leads with ${top.value}.`,
    reasoning: `Ranked by registered case count. This is a volume view — a high count can reflect a busier area or better reporting, not only more crime.`,
  };
}

function buildAnswer(ctx) {
  const { template, zcql, tablesUsed, permission, entities, questionRaw, intent, confidence, executionMs, mock } = ctx;
  const { summary, reasoning } = summarise(template, mock);
  const vt = buildVisualAndTable(template, mock);

  return {
    outcome: "ANSWERED",
    answer: { summary, reasoning, visual: vt.visual, table: vt.table },
    evidence: {
      question: { raw: questionRaw, language: "en", via: "TEXT" },
      intent: { value: intent, confidence },
      entities: Object.entries(entities || {})
        .filter(([, e]) => e !== null)
        .map(([slot, e]) => ({ slot, value: e.value, label: labelForSlot(slot, e.value), source: e.source })),
      permission: {
        role: permission.role, scope_rule: "OWN_UNIT", field_policy: permission.field_policy,
        min_cell_size: permission.min_cell_size, narrowed: permission.narrowed, rule_id: permission.rule_id,
      },
      template: { id: template.id, version: template.version, author: template.author, reviewer: template.reviewer, reviewed: template.reviewed },
      zcql, tables_used: tablesUsed, source: ctx.live ? "OLAP" : "PRECOMPUTED",
      rows_returned: mock.rows_returned, rows_suppressed: 0, pages_fetched: 1,
      execution_ms: executionMs,
      confidence: { intent: confidence, analytical: mock.total_cases >= 20 ? "HIGH" : "MEDIUM" },
      data_as_of: new Date().toISOString(),
      warnings: ctx.live ? [] : [{
        code: "MOCK_EXECUTION",
        message: "Computed by M6's real builder against local seed data, not live Catalyst OLAP. ZCQL not yet confirmed live — see ZCQL_CAPABILITY_REPORT.md.",
      }],
    },
    error: null,
  };
}

function labelForSlot(slot, value) {
  if (slot === "crime_subhead_id") return L.subhead(value);
  if (slot === "unit_id") return L.unit(value);
  return null;
}

function buildUnsupported({ questionRaw, intent, confidence, suggestedIntents }) {
  return {
    outcome: "UNSUPPORTED",
    answer: null, evidence: null,
    error: {
      code: "E_INTENT_UNSUPPORTED",
      message: "This question doesn't match a template that's been built yet.",
      detail: `router intent "${intent}" at confidence ${confidence}`,
      rule_code: null, clarifying_question: null, options: null,
      nearest_supported: suggestedIntents || [],
    },
  };
}

module.exports = { buildAnswer, buildUnsupported };
