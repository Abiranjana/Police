/**
 * Stands in for P3's Permission Engine (M7). Per the design doc, P3 ships
 * exactly this on Day 1 so P2 and P4 are never blocked: accept a request,
 * return a hardcoded "Permitted" decision object.
 *
 * When the real engine exists, only this file changes. Nothing that calls
 * decidePermission() needs to change, because the shape stays identical.
 */
function decidePermission({ asUnitId }) {
  return {
    role: "SI",
    scope: { column: "unit_id", values: [asUnitId] },
    field_policy: "FULL",
    min_cell_size: 1,
    narrowed: false,
    rule_id: null, // null until the real engine assigns one
  };
}

module.exports = { decidePermission };
