/**
 * Per-template execution plan: how to filter (mock only) and how to group +
 * aggregate. Shared by mockExecutor (uses filter) and liveExecutor (uses
 * groupKeys + agg to normalise real ZCQL rows). One source of truth so the
 * two executors can never drift apart.
 */
const PLANS = {
  TPL_TREND_TIME_DAYHOUR: { filter: (p) => (r) => r.crime_subhead_id === p.crime_subhead_id && r.year_num === p.year_num, groupKeys: ["day_of_week", "hour_of_day"], agg: "count" },
  TPL_COUNT_BY_AREA: { filter: (p) => (r) => r.crime_subhead_id === p.crime_subhead_id && r.year_num === p.year_num, groupKeys: ["unit_id"], agg: "count", sortDesc: true },
  TPL_TREND_BY_MONTH: { filter: (p) => (r) => r.crime_subhead_id === p.crime_subhead_id && r.year_num === p.year_num, groupKeys: ["year_month"], agg: "count" },
  TPL_TOP_CRIME_TYPES: { filter: (p) => (r) => r.year_num === p.year_num, groupKeys: ["crime_subhead_id"], agg: "count", sortDesc: true },
  TPL_CHARGESHEET_RATE: { filter: (p) => (r) => r.crime_subhead_id === p.crime_subhead_id && r.year_num === p.year_num, groupKeys: ["unit_id"], agg: "rate_chargesheeted", sortDesc: true },
  TPL_TREND_BY_WEEK: { filter: (p) => (r) => r.crime_subhead_id === p.crime_subhead_id && r.year_num === p.year_num, groupKeys: ["week_of_year"], agg: "count" },
  TPL_COUNT_BY_DISTRICT: { filter: (p) => (r) => r.crime_subhead_id === p.crime_subhead_id && r.year_num === p.year_num, groupKeys: ["district_id"], agg: "count", sortDesc: true },
  TPL_VICTIM_BREAKDOWN: { filter: (p) => (r) => r.crime_subhead_id === p.crime_subhead_id && r.year_num === p.year_num, groupKeys: ["victim_gender"], agg: "count", sortDesc: true },
  TPL_ACCUSED_BREAKDOWN: { filter: (p) => (r) => r.crime_subhead_id === p.crime_subhead_id && r.year_num === p.year_num, groupKeys: ["accused_age_band"], agg: "count" },
  TPL_HOTSPOT_CURRENT: { filter: (p) => (r) => r.crime_subhead_id === p.crime_subhead_id && r.year_num === p.year_num, groupKeys: ["unit_id"], agg: "count", sortDesc: true },
  TPL_COUNT_BY_CRIME_TYPE: { filter: (p) => (r) => r.year_num === p.year_num, groupKeys: ["crime_subhead_id"], agg: "count", sortDesc: true },
  TPL_TREND_COMPARE_PERIOD: { filter: (p) => (r) => r.crime_subhead_id === p.crime_subhead_id, groupKeys: ["year_num"], agg: "count" },
  TPL_SEASONAL_PATTERN: { filter: (p) => (r) => r.crime_subhead_id === p.crime_subhead_id && r.year_num === p.year_num, groupKeys: ["season"], agg: "count" },
  TPL_CONVICTION_ANALYSIS: { filter: (p) => (r) => r.crime_subhead_id === p.crime_subhead_id && r.year_num === p.year_num, groupKeys: ["unit_id"], agg: "rate_convicted", sortDesc: true },
  TPL_INVESTIGATION_DELAY: { filter: (p) => (r) => r.crime_subhead_id === p.crime_subhead_id && r.year_num === p.year_num, groupKeys: ["unit_id"], agg: "avg_days", sortDesc: true },
  TPL_PERSON_CASE_HISTORY: { filter: (p) => (r) => r.crime_subhead_id === p.crime_subhead_id && r.year_num === p.year_num, groupKeys: ["accused_person_id"], agg: "count", sortDesc: true },
  TPL_HABITUAL_OFFENDERS: { filter: (p) => (r) => r.crime_subhead_id === p.crime_subhead_id && r.year_num === p.year_num, groupKeys: ["accused_person_id"], agg: "count", sortDesc: true, having: (v) => v >= 2 },
};

module.exports = { PLANS };
