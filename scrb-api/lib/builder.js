const { validateParam } = require("./types");

/**
 * Contract 2 sends each entity as either an object {value, type, is_list,
 * source} or bare null (P4's confirmed shape, 2026-07-24). This unwraps
 * that into a plain {slot: rawValue} map the validators can consume, and
 * separately keeps the "source" for the evidence panel.
 */
function unwrapEntities(entities) {
  const values = {};
  const sources = {};
  for (const [slot, entity] of Object.entries(entities || {})) {
    if (entity === null) continue;
    values[slot] = entity.value;
    sources[slot] = entity.source;
  }
  return { values, sources };
}

/**
 * Builds an executable ZCQL string from a template + validated params +
 * a scope predicate, OR throws a structured error the caller turns into
 * an E_* outcome. Never touches the database itself — see executor.js.
 */
function buildQuery(template, entityValues, scope) {
  const invalid = [];
  const missing = [];
  const boundParams = {};

  for (const [name, spec] of Object.entries(template.params)) {
    const raw = entityValues[name];
    // a required slot that is absent is a CLARIFICATION case, not an error:
    // the question was fine, we just need one more detail from the user.
    if (spec.required && (raw === undefined || raw === null)) {
      missing.push(name);
      continue;
    }
    const result = validateParam(raw, spec);
    if (!result.ok) {
      invalid.push({ slot: name, reason: result.error });
    } else {
      boundParams[name] = result.value;
    }
  }

  if (missing.length > 0) {
    const err = new Error("E_CLARIFICATION_NEEDED");
    err.code = "E_CLARIFICATION_NEEDED";
    err.missing = missing;
    throw err;
  }

  if (invalid.length > 0) {
    const err = new Error("E_ENTITY_INVALID");
    err.code = "E_ENTITY_INVALID";
    err.details = invalid;
    throw err;
  }

  // Scope predicate — validated the same way as any other param, never
  // string-concatenated from raw input.
  const scopeResult = validateParam(scope.values, {
    type: "int_list",
    required: true,
    max_items: 200,
  });
  if (!scopeResult.ok) {
    const err = new Error("E_SCOPE_INVALID");
    err.code = "E_SCOPE_INVALID";
    err.details = scopeResult.error;
    throw err;
  }

  const scopePredicate = `${scope.column} IN (${scopeResult.value.join(",")})`;

  let zcql = template.body;
  for (const [name, value] of Object.entries(boundParams)) {
    const token = `{{${name}}}`;
    zcql = zcql.split(token).join(String(value));
  }
  zcql = zcql.split("{{SCOPE_PREDICATE}}").join(scopePredicate);

  if (zcql.includes("{{")) {
    // A param the template declares was never substituted — a template
    // authoring bug, not a request problem. Fail loudly rather than send
    // a half-built string anywhere.
    const err = new Error("E_TEMPLATE_INCOMPLETE");
    err.code = "E_TEMPLATE_INCOMPLETE";
    err.details = zcql;
    throw err;
  }

  return { zcql, boundParams, scopePredicate };
}

module.exports = { unwrapEntities, buildQuery };
