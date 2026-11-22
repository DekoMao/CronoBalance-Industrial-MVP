from uuid import uuid4


def payload(*, elements=None, stations=None, precedences=None, demand="0"):
    area = elements[0]["areaId"] if elements else str(uuid4())
    rows = elements or [
        {"id": str(uuid4()), "areaId": area, "name": "Operação A", "sortOrder": 0,
         "current": {"stationIndex": 1, "vaSeconds": "40", "nvaSeconds": "10"},
         "future": {"stationIndex": 1, "vaSeconds": "40", "nvaSeconds": "10"}},
        {"id": str(uuid4()), "areaId": area, "name": "Operação B", "sortOrder": 1,
         "current": {"stationIndex": 2, "vaSeconds": "30", "nvaSeconds": "10"},
         "future": {"stationIndex": 2, "vaSeconds": "30", "nvaSeconds": "10"}},
    ]
    return {"parameters": {"name": "Estudo teste", "productFamily": "Produto", "shiftSeconds": "27000",
            "demandPerShift": demand, "productiveDaysPerMonth": 22, "baselineUnitsPerDay": "100",
            "laborCostPerShiftCurrent": "1000", "laborCostPerShiftFuture": "800"},
            "stations": stations or {"current": 2, "future": 2},
            "areas": [{"id": area, "clientId": area, "name": "Montagem", "sortOrder": 0}],
            "elements": rows, "precedences": precedences or []}


def create(client, headers, **kwargs):
    response = client.post("/api/v1/studies", headers=headers, json=payload(**kwargs))
    assert response.status_code == 201, response.text
    return response


def test_nva_edit_recalculates_station_load_and_bottleneck(client, auth_headers):
    created = create(client, auth_headers)
    study_id = created.json()["id"]
    e1 = created.json()["elements"][0]["id"]
    response = client.patch(f"/api/v1/studies/{study_id}/elements/batch", headers={**auth_headers, "If-Match": created.headers["etag"]},
        json={"clientMutationId": str(uuid4()), "operations": [{"op": "replace", "entity": "workElement", "id": e1, "changes": {"current.nvaSeconds": "80"}}]})
    assert response.status_code == 200, response.text
    assert response.json()["metrics"]["current"]["bottleneckStations"] == [1]
    assert response.json()["metrics"]["current"]["stationLoadsSeconds"][0] == "120.000"


def test_future_cycle_semantic_state_tracks_takt(client, auth_headers):
    one_area = str(uuid4()); element = {"id": str(uuid4()), "areaId": one_area, "name": "A", "sortOrder": 0,
      "current": {"stationIndex": 1, "vaSeconds": "100", "nvaSeconds": "0"},
      "future": {"stationIndex": 1, "vaSeconds": "140", "nvaSeconds": "0"}}
    created = create(client, auth_headers, elements=[element], stations={"current": 1, "future": 1}, demand="180")
    assert created.json()["metrics"]["future"]["meetsTakt"] is True
    eid = created.json()["elements"][0]["id"]
    changed = client.patch(f"/api/v1/studies/{created.json()['id']}/elements/batch", headers={**auth_headers, "If-Match": created.headers["etag"]},
      json={"clientMutationId": str(uuid4()), "operations": [{"op": "replace", "entity": "workElement", "id": eid, "changes": {"future.nvaSeconds": "20"}}]})
    assert changed.status_code == 200, changed.text
    assert changed.json()["metrics"]["future"]["meetsTakt"] is False


def test_station_with_allocated_elements_cannot_be_removed(client, auth_headers):
    created = create(client, auth_headers)
    url = f"/api/v1/studies/{created.json()['id']}/stations/current"
    response = client.patch(url, headers={**auth_headers, "If-Match": created.headers["etag"]}, json={"count": 1})
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "STATION_NOT_EMPTY"


def test_optimizer_returns_precedence_safe_assignment(client, auth_headers):
    raw = payload()
    first, second = raw["elements"]
    raw["precedences"] = [{"predecessorId": first["id"], "successorId": second["id"]}]
    created = client.post("/api/v1/studies", headers=auth_headers, json=raw)
    assert created.status_code == 201, created.text
    study = created.json()
    result = client.post(f"/api/v1/studies/{study['id']}/optimize", headers=auth_headers,
        json={"inputVersion": 1, "targetStationCount": 2, "maxStationCount": 2, "meetTakt": False, "solverTimeLimitSeconds": 3})
    assert result.status_code == 200, result.text
    assert result.json()["checks"]["precedence"] == "pass"
    assignment = {x["elementId"]: x["stationIndex"] for x in result.json()["assignments"]}
    assert assignment[first["id"]] <= assignment[second["id"]]


def test_optimization_proposal_reassigns_before_removing_surplus_station(client, auth_headers):
    created = create(client, auth_headers)
    study = created.json()
    proposal = client.post(f"/api/v1/studies/{study['id']}/optimize", headers=auth_headers,
        json={"inputVersion": 1, "targetStationCount": 1, "maxStationCount": 1, "meetTakt": False, "solverTimeLimitSeconds": 3})
    assert proposal.status_code == 200, proposal.text
    assert proposal.json()["canApply"] is True
    applied = client.post(f"/api/v1/studies/{study['id']}/optimization-proposals/apply",
        headers={**auth_headers, "If-Match": created.headers["etag"]}, json=proposal.json())
    assert applied.status_code == 200, applied.text
    assert len(applied.json()["stations"]["future"]) == 1


def test_optimizer_keeps_equipment_fixed_to_its_physical_station(client, auth_headers):
    raw = payload(); resource_id = str(uuid4()); first_id = raw["elements"][0]["id"]
    raw["equipment"] = [{"id": resource_id, "clientId": resource_id, "name": "Prensa fixa", "futureStationIndex": 2}]
    raw["elements"][0]["fixedEquipmentId"] = resource_id
    created = client.post("/api/v1/studies", headers=auth_headers, json=raw)
    assert created.status_code == 201, created.text
    result = client.post(f"/api/v1/studies/{created.json()['id']}/optimize", headers=auth_headers,
        json={"inputVersion": 1, "targetStationCount": 2, "maxStationCount": 2, "meetTakt": False, "solverTimeLimitSeconds": 3})
    assert result.status_code == 200, result.text
    assignment = {x["elementId"]: x["stationIndex"] for x in result.json()["assignments"]}
    assert assignment[first_id] == 2


def test_legacy_v1_import_creates_v2_study(client, auth_headers):
    result = client.post("/api/v1/studies/import-legacy", headers=auth_headers, json={"version": 1,
      "project": {"name": "Legado", "shiftSeconds": 27000, "demand": 100},
      "operations": [{"name": "Recebimento", "vaCurrent": 20, "nvaCurrent": 5, "vaFuture": 20, "nvaFuture": 2}],
      "current": [1], "future": [1]})
    assert result.status_code == 201, result.text
    assert result.json()["study"]["name"] == "Legado"
    assert result.json()["migration"]["sourceVersion"] == 1
    assert len(result.json()["study"]["elements"]) == 1


def test_application_v2_export_round_trips_through_server_import(client, auth_headers):
    data = payload()
    data["version"] = 2
    data["project"] = {"name": "Exportado", "product": "Produto A", "shiftSeconds": 27000,
        "demandPerShift": 180, "productiveDaysPerMonth": 22, "baselineUnitsPerDay": 35,
        "laborCostPerShiftCurrent": 1000, "laborCostPerShiftFuture": 800, "stations": data["stations"]}
    result = client.post("/api/v1/studies/import-legacy", headers=auth_headers, json=data)
    assert result.status_code == 201, result.text
    assert result.json()["study"]["name"] == "Exportado"
    assert len(result.json()["study"]["elements"]) == 2


def test_stale_etag_returns_conflict_without_overwriting_newer_revision(client, auth_headers):
    created = create(client, auth_headers)
    study_id = created.json()["id"]; eid = created.json()["elements"][0]["id"]
    body = {"clientMutationId": str(uuid4()), "operations": [{"op": "replace", "entity": "workElement", "id": eid, "changes": {"current.nvaSeconds": "11"}}]}
    first = client.patch(f"/api/v1/studies/{study_id}/elements/batch", headers={**auth_headers, "If-Match": created.headers["etag"]}, json=body)
    assert first.status_code == 200
    stale = client.patch(f"/api/v1/studies/{study_id}/elements/batch", headers={**auth_headers, "If-Match": created.headers["etag"]},
      json={**body, "clientMutationId": str(uuid4())})
    assert stale.status_code == 412
    assert stale.json()["detail"]["code"] == "VERSION_CONFLICT"


def test_replayed_offline_mutation_is_deduplicated(client, auth_headers):
    created = create(client, auth_headers)
    study_id = created.json()["id"]; eid = created.json()["elements"][0]["id"]; mutation_id = str(uuid4())
    headers = {**auth_headers, "If-Match": created.headers["etag"]}
    body = {"clientMutationId": mutation_id, "operations": [{"op": "replace", "entity": "workElement", "id": eid, "changes": {"current.nvaSeconds": "11"}}]}
    first = client.patch(f"/api/v1/studies/{study_id}/elements/batch", headers=headers, json=body)
    replay = client.patch(f"/api/v1/studies/{study_id}/elements/batch", headers=headers, json=body)
    assert first.status_code == replay.status_code == 200
    assert replay.json()["version"] == first.json()["version"]
    history = client.get(f"/api/v1/studies/{study_id}/revisions", headers=auth_headers)
    assert len(history.json()) == 2


def test_create_retries_with_same_client_study_id_are_idempotent(client, auth_headers):
    raw = payload(); raw["studyId"] = str(uuid4())
    first = client.post("/api/v1/studies", headers=auth_headers, json=raw)
    replay = client.post("/api/v1/studies", headers=auth_headers, json=raw)
    assert first.status_code == 201
    assert replay.status_code == 200
    assert replay.json()["id"] == first.json()["id"]
