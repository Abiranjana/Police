from appsail.api.main import app


def send_permission_request(intent, extra_fields=None):
    payload = {
        "intent": intent,
        "entities": {
            "crime_head": 12,
            "unit_id": 4430006,
            "group_by": "DAY_AND_HOUR",
        },
    }

    if extra_fields:
        payload.update(extra_fields)

    with app.test_client() as client:
        return client.post(
            "/v1/permissions/evaluate",
            json=payload,
        )


def test_si_receives_own_unit_scope(monkeypatch):
    monkeypatch.setenv("SCRB_DEMO_ROLE", "SI")

    response = send_permission_request("TREND_BY_TIME")
    body = response.get_json()

    assert response.status_code == 200
    assert body["decision"]["allow"] is True
    assert body["decision"]["role"] == "SI"
    assert body["decision"]["scope_rule"] == "OWN_UNIT"
    assert body["decision"]["scope_predicate"]["field"] == "unit_id"
    assert body["decision"]["scope_predicate"]["values"] == [4430006]
    assert body["decision"]["field_policy"] == "FULL"


def test_sp_receives_district_scope(monkeypatch):
    monkeypatch.setenv("SCRB_DEMO_ROLE", "SP")

    response = send_permission_request("TREND_BY_TIME")
    body = response.get_json()

    assert response.status_code == 200
    assert body["decision"]["allow"] is True
    assert body["decision"]["scope_rule"] == "OWN_DISTRICT"
    assert body["decision"]["scope_predicate"]["field"] == "district_id"
    assert body["decision"]["scope_predicate"]["values"] == [443]


def test_policymaker_identity_is_suppressed(monkeypatch):
    monkeypatch.setenv("SCRB_DEMO_ROLE", "POLICYMAKER")

    response = send_permission_request("TREND_BY_TIME")
    body = response.get_json()

    assert response.status_code == 200
    assert body["decision"]["field_policy"] == "SUPPRESSED"
    assert body["decision"]["min_cell_size"] == 10


def test_system_admin_is_denied(monkeypatch):
    monkeypatch.setenv("SCRB_DEMO_ROLE", "SYSTEM_ADMIN")

    response = send_permission_request("TREND_BY_TIME")
    body = response.get_json()

    assert response.status_code == 403
    assert body["decision"]["allow"] is False
    assert body["decision"]["scope_rule"] == "NONE"
    assert (
        body["decision"]["reason_code"]
        == "ADMIN_HAS_NO_CRIME_DATA_ACCESS"
    )


def test_unsupported_intent_is_denied(monkeypatch):
    monkeypatch.setenv("SCRB_DEMO_ROLE", "SI")

    response = send_permission_request("LIST_ALL_PEOPLE")
    body = response.get_json()

    assert response.status_code == 403
    assert body["decision"]["allow"] is False
    assert body["decision"]["reason_code"] == "STUB_INTENT_NOT_SUPPORTED"


def test_client_supplied_role_and_scope_are_ignored(monkeypatch):
    monkeypatch.setenv("SCRB_DEMO_ROLE", "SI")

    response = send_permission_request(
        "TREND_BY_TIME",
        {
            "role": "SYSTEM_ADMIN",
            "unit_ids": ["ALL"],
            "district_ids": ["ALL"],
        },
    )
    body = response.get_json()

    assert response.status_code == 200
    assert body["identity"]["role"] == "SI"
    assert body["identity"]["unit_ids"] == [4430006]
    assert body["decision"]["scope_rule"] == "OWN_UNIT"
