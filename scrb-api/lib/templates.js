const fs = require("fs");
const path = require("path");

const TEMPLATE_DIR = path.join(__dirname, "..", "templates");

let cache = null;

/**
 * Loads every *.json in templates/ once, indexes by id, and by intent.
 * §8 rule 2 lives here at runtime too: a template missing fixtures or a
 * where_budget is refused registration rather than silently accepted.
 */
function loadTemplates() {
  if (cache) return cache;

  const byId = new Map();
  const byIntent = new Map();

  for (const file of fs.readdirSync(TEMPLATE_DIR)) {
    if (!file.endsWith(".json") || file === "template.schema.json") continue;
    const tpl = JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, file), "utf8"));

    if (!tpl.fixtures || tpl.fixtures.length < 3) {
      throw new Error(`${file}: fewer than 3 fixtures, refusing to register (§8 rule 2)`);
    }
    if (!tpl.where_budget) {
      throw new Error(`${file}: no where_budget declared, refusing to register`);
    }
    const spent = tpl.where_budget.template_conditions + tpl.scope.conditions_consumed;
    if (spent > tpl.where_budget.ceiling) {
      throw new Error(
        `${file}: where_budget exceeded (${spent} > ${tpl.where_budget.ceiling}) — this is exactly the failure mode described in P2_DAY1_FINDINGS.md §3.2`
      );
    }

    byId.set(tpl.id, tpl);
    if (!byIntent.has(tpl.intent)) byIntent.set(tpl.intent, []);
    byIntent.get(tpl.intent).push(tpl);
  }

  cache = { byId, byIntent };
  return cache;
}

function templatesForIntent(intent) {
  return loadTemplates().byIntent.get(intent) || [];
}

function templateById(id) {
  return loadTemplates().byId.get(id) || null;
}

module.exports = { loadTemplates, templatesForIntent, templateById };
