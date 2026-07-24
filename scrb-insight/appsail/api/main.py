import os
import uuid

from flask import Flask, jsonify, request


app = Flask(__name__)


# Temporary local identities.
# These will later come from Catalyst Authentication + si_user_scope.
DEMO_IDENTITIES = {
    "SI": {
        "user_id": "demo-si",
        "role": "SI",
        "unit_ids": [4430006],
        "district_ids": [443],
        "field_policy": "FULL",
        "min_cell_size": 1,
    },
    "SP": {
        "user_id": "demo-sp",
        "role": "SP",
        "unit_ids": [],
        "district_ids": [443],
        "field_policy": "FULL",
        "min_cell_size": 1,
    },
    "ANALYST": {
        "user_id": "demo-analyst",
        "role": "ANALYST",
        "unit_ids": [],
        "district_ids": [],
        "field_policy": "INITIALS",
        "min_cell_size": 5,
    },
    "POLICYMAKER": {
        "user_id": "demo-policymaker",
        "role": "POLICYMAKER",
        "unit_ids": [],
        "district_ids": [],
        "field_policy": "SUPPRESSED",
        "min_cell_size": 10,
    },
    "SYSTEM_ADMIN": {
        "user_id": "demo-admin",
        "role": "SYSTEM_ADMIN",
        "unit_ids": [],
        "district_ids": [],
        "field_policy": "SUPPRESSED",
        "min_cell_size": 10,
    },
}


def get_demo_identity():
    role = os.getenv("SCRB_DEMO_ROLE", "SI").upper()
    return DEMO_IDENTITIES.get(role, DEMO_IDENTITIES["SI"])


def build_scope(identity):
    if identity["role"] == "SI":
        return {
            "scope_rule": "OWN_UNIT",
            "scope_predicate": {
                "field": "unit_id",
                "operator": "IN",
                "values": identity["unit_ids"],
            },
        }

    if identity["role"] == "SP":
        return {
            "scope_rule": "OWN_DISTRICT",
            "scope_predicate": {
                "field": "district_id",
                "operator": "IN",
                "values": identity["district_ids"],
            },
        }

    return {
        "scope_rule": "STATE",
        "scope_predicate": {
            "field": "state_code",
            "operator": "EQUALS",
            "values": ["KA"],
        },
    }


def evaluate_permission(identity, intent):
    if identity["role"] == "SYSTEM_ADMIN":
        return {
            "decision_id": str(uuid.uuid4()),
            "decision_version": "M7-STUB-v1",
            "stub": True,
            "allow": False,
            "role": identity["role"],
            "intent": intent,
            "scope_rule": "NONE",
            "scope_predicate": None,
            "field_policy": "SUPPRESSED",
            "min_cell_size": identity["min_cell_size"],
            "max_rows": 0,
            "reason_code": "ADMIN_HAS_NO_CRIME_DATA_ACCESS",
        }

    if intent != "TREND_BY_TIME":
        return {
            "decision_id": str(uuid.uuid4()),
            "decision_version": "M7-STUB-v1",
            "stub": True,
            "allow": False,
            "role": identity["role"],
            "intent": intent,
            "scope_rule": "NONE",
            "scope_predicate": None,
            "field_policy": identity["field_policy"],
            "min_cell_size": identity["min_cell_size"],
            "max_rows": 0,
            "reason_code": "STUB_INTENT_NOT_SUPPORTED",
        }

    scope = build_scope(identity)

    return {
        "decision_id": str(uuid.uuid4()),
        "decision_version": "M7-STUB-v1",
        "stub": True,
        "allow": True,
        "role": identity["role"],
        "intent": intent,
        "scope_rule": scope["scope_rule"],
        "scope_predicate": scope["scope_predicate"],
        "field_policy": identity["field_policy"],
        "min_cell_size": identity["min_cell_size"],
        "max_rows": 500,
        "reason_code": "STUB_TREND_ALLOWED",
    }


@app.get("/v1/health")
def health():
    return jsonify(
        {
            "status": "ok",
            "service": "scrb-insight-api",
            "project": "Phoebe",
            "version": "0.1.0",
        }
    ), 200


@app.post("/v1/permissions/evaluate")
def permission_evaluate():
    payload = request.get_json(silent=True)

    if not payload or not isinstance(payload.get("intent"), str):
        return jsonify(
            {
                "error": "INVALID_REQUEST",
                "message": "A string intent field is required.",
            }
        ), 400

    identity = get_demo_identity()
    decision = evaluate_permission(identity, payload["intent"])

    return jsonify(
        {
            "identity": identity,
            "decision": decision,
        }
    ), 200 if decision["allow"] else 403


if __name__ == "__main__":
    port = int(os.getenv("X_ZOHO_CATALYST_LISTEN_PORT", "9000"))
    app.run(host="0.0.0.0", port=port, debug=False)
