/**
 * Reference-data label lookups. In production these are columns pre-joined
 * onto si_case_fact (P2_DAY1_FINDINGS §4.2). Static here so the demo shows
 * names instead of codes. Replace with the *_name columns the real query
 * returns once the fact table lands.
 */
const SUBHEAD = { 12: "Chain snatching", 45: "House breaking", 78: "Vehicle theft", 91: "Cheating" };
const UNIT = { 4430006: "Bengaluru North", 4430007: "Bengaluru South", 4430011: "Bengaluru East" };
const DISTRICT = { 29: "Bengaluru Urban", 31: "Bengaluru Rural" };
const GENDER = { 1: "Male", 2: "Female", 3: "Transgender" };
const AGE_BAND = { 0: "Under 18", 1: "18–29", 2: "30–44", 3: "45–59", 4: "60+" };
const DAY = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MON = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

module.exports = {
  subhead: (id) => SUBHEAD[id] || `Sub-head ${id}`,
  unit: (id) => UNIT[id] || `Unit ${id}`,
  district: (id) => DISTRICT[id] || `District ${id}`,
  gender: (id) => GENDER[id] || `Gender ${id}`,
  ageBand: (id) => AGE_BAND[id] || `Band ${id}`,
  day: (i) => DAY[i] || `Day ${i}`,
  week: (w) => `Wk ${w}`,
  yearMonth: (ym) => { const s = String(ym); return `${MON[Number(s.slice(4))]} ${s.slice(0, 4)}`; },
};
