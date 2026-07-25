/**
 * ZCQL has no prepared statements — the API takes one raw query string.
 * So instead of binding, every param is validated against its declared type
 * BEFORE it is allowed anywhere near a query string. A value that fails its
 * type is rejected here and never reaches the builder.
 *
 * There is deliberately no "string" or "raw" type. Free text never
 * reaches a query. Template.schema.json is the source of truth for the
 * type list this file implements.
 */

function isPlainInt(v) {
  return typeof v === "number" && Number.isInteger(v);
}

const VALIDATORS = {
  int(value, spec) {
    if (!isPlainInt(value)) return { ok: false, error: "not an integer" };
    if (spec.min != null && value < spec.min) return { ok: false, error: `below min ${spec.min}` };
    if (spec.max != null && value > spec.max) return { ok: false, error: `above max ${spec.max}` };
    return { ok: true, value };
  },

  bigint(value, spec) {
    if (!isPlainInt(value)) return { ok: false, error: "not an integer" };
    return { ok: true, value };
  },

  year(value, spec) {
    if (!isPlainInt(value)) return { ok: false, error: "not an integer" };
    if (spec.min != null && value < spec.min) return { ok: false, error: `below min ${spec.min}` };
    if (spec.max != null && value > spec.max) return { ok: false, error: `above max ${spec.max}` };
    return { ok: true, value };
  },

  year_month(value) {
    if (!isPlainInt(value) || String(value).length !== 6) {
      return { ok: false, error: "expected YYYYMM integer" };
    }
    return { ok: true, value };
  },

  int_list(value, spec) {
    const list = Array.isArray(value) ? value : [value];
    if (list.length === 0) return { ok: false, error: "empty list" };
    if (spec.max_items && list.length > spec.max_items) {
      return { ok: false, error: `exceeds max_items ${spec.max_items}` };
    }
    if (!list.every(isPlainInt)) return { ok: false, error: "list contains a non-integer" };
    return { ok: true, value: list };
  },

  bigint_list(value, spec) {
    return VALIDATORS.int_list(value, spec);
  },

  iso_date(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return { ok: false, error: "expected YYYY-MM-DD string" };
    }
    return { ok: true, value };
  },

  enum(value, spec) {
    if (!spec.allowed || !spec.allowed.includes(value)) {
      return { ok: false, error: `not in allowed set [${(spec.allowed || []).join(", ")}]` };
    }
    return { ok: true, value };
  },

  bounded_string(value, spec) {
    if (typeof value !== "string") return { ok: false, error: "not a string" };
    if (spec.max_length && value.length > spec.max_length) {
      return { ok: false, error: `exceeds max_length ${spec.max_length}` };
    }
    return { ok: true, value };
  },

  boolean(value) {
    if (typeof value !== "boolean") return { ok: false, error: "not a boolean" };
    return { ok: true, value };
  },
};

/**
 * Validate a single param value against its declared spec.
 * Returns { ok, value, error }.
 */
function validateParam(value, spec) {
  const fn = VALIDATORS[spec.type];
  if (!fn) return { ok: false, error: `unknown declared type "${spec.type}"` };
  if (value === undefined || value === null) {
    if (spec.required) return { ok: false, error: "required but missing" };
    return { ok: true, value: spec.default ?? null };
  }
  return fn(value, spec);
}

module.exports = { validateParam };
