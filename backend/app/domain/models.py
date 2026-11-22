from __future__ import annotations

from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


Dec = Decimal


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


def non_negative(value: Decimal) -> Decimal:
    if not value.is_finite() or value < 0 or value.as_tuple().exponent < -3:
        raise ValueError("Use um número finito, não negativo e com até 3 casas decimais")
    return value


class Parameters(StrictModel):
    name: str = Field(min_length=1, max_length=160)
    productFamily: str = Field(default="", max_length=120)
    shiftSeconds: Dec = Field(gt=0, max_digits=12, decimal_places=3)
    demandPerShift: Dec = Field(ge=0, max_digits=12, decimal_places=3)
    productiveDaysPerMonth: int = Field(ge=0, le=31, default=22)
    baselineUnitsPerDay: Dec = Field(ge=0, max_digits=12, decimal_places=3, default=Decimal(0))
    laborCostPerShiftCurrent: Dec = Field(ge=0, max_digits=14, decimal_places=2, default=Decimal(0))
    laborCostPerShiftFuture: Dec = Field(ge=0, max_digits=14, decimal_places=2, default=Decimal(0))


class StationCounts(StrictModel):
    current: int = Field(ge=1, le=100)
    future: int = Field(ge=1, le=100)


class AreaInput(StrictModel):
    id: UUID | None = None
    clientId: str | None = None
    name: str = Field(min_length=1, max_length=120)
    sortOrder: int = Field(ge=0, default=0)
    operationalCostPerPieceCurrent: Dec = Field(ge=0, max_digits=14, decimal_places=2, default=Decimal(0))
    operationalCostPerPieceFuture: Dec = Field(ge=0, max_digits=14, decimal_places=2, default=Decimal(0))


class ScenarioInput(StrictModel):
    stationIndex: int = Field(ge=1, le=100)
    vaSeconds: Dec = Field(ge=0, max_digits=12, decimal_places=3)
    nvaSeconds: Dec = Field(ge=0, max_digits=12, decimal_places=3)


class WorkElementInput(StrictModel):
    id: UUID | None = None
    clientId: str | None = None
    areaId: UUID | None = None
    areaClientId: str | None = None
    name: str = Field(min_length=1, max_length=200)
    sortOrder: int = Field(ge=0, default=0)
    current: ScenarioInput
    future: ScenarioInput
    ergonomicZone: Literal["green", "yellow", "red"] | None = None
    fixedEquipmentId: UUID | None = None
    validationStatus: Literal["hypothesis", "validated"] = "hypothesis"
    evidenceRef: str | None = Field(default=None, max_length=500)


class PrecedenceInput(StrictModel):
    predecessorId: UUID
    successorId: UUID


class EquipmentInput(StrictModel):
    id: UUID | None = None
    clientId: str | None = None
    name: str = Field(min_length=1, max_length=160)
    currentStationIndex: int | None = Field(default=None, ge=1, le=100)
    futureStationIndex: int | None = Field(default=None, ge=1, le=100)


class CreateStudy(StrictModel):
    studyId: UUID | None = None
    parameters: Parameters
    stations: StationCounts
    areas: list[AreaInput] = Field(default_factory=list, max_length=100)
    elements: list[WorkElementInput] = Field(default_factory=list, max_length=500)
    equipment: list[EquipmentInput] = Field(default_factory=list, max_length=100)
    precedences: list[PrecedenceInput] = Field(default_factory=list, max_length=5000)

    @model_validator(mode="after")
    def assignments_exist(self):
        equipment_ids = {item.id for item in self.equipment if item.id is not None}
        for element in self.elements:
            if element.current.stationIndex > self.stations.current:
                raise ValueError(f"Posto atual inválido para {element.name}")
            if element.future.stationIndex > self.stations.future:
                raise ValueError(f"Posto futuro inválido para {element.name}")
            if element.fixedEquipmentId and element.fixedEquipmentId not in equipment_ids:
                raise ValueError(f"Equipamento fixo ausente para {element.name}")
        for resource in self.equipment:
            if resource.currentStationIndex and resource.currentStationIndex > self.stations.current:
                raise ValueError(f"Posto atual inválido para equipamento {resource.name}")
            if resource.futureStationIndex and resource.futureStationIndex > self.stations.future:
                raise ValueError(f"Posto futuro inválido para equipamento {resource.name}")
        return self


class StudyPatch(StrictModel):
    clientMutationId: UUID
    operations: list[dict] = Field(min_length=1, max_length=100)


class OptimizeRequest(StrictModel):
    inputVersion: int = Field(ge=1)
    targetStationCount: int = Field(ge=1, le=100)
    maxStationCount: int = Field(ge=1, le=100)
    meetTakt: bool = True
    cycleTargetSeconds: Dec | None = Field(default=None, gt=0, max_digits=12, decimal_places=3)
    yellowErgonomicZone: int = Field(default=100, ge=0, le=100000)
    moveFromBaseline: int = Field(default=1, ge=0, le=100000)
    solverTimeLimitSeconds: int = Field(default=5, ge=1, le=15)


def validate_dag(elements: set[UUID], edges: list[tuple[UUID, UUID]]) -> list[UUID]:
    from collections import defaultdict, deque

    outgoing: dict[UUID, list[UUID]] = defaultdict(list)
    indegree = {item: 0 for item in elements}
    for before, after in edges:
        if before not in elements or after not in elements:
            raise ValueError("A precedência referencia elemento ausente")
        if before == after:
            raise ValueError("Um elemento não pode preceder a si próprio")
        outgoing[before].append(after)
        indegree[after] += 1
    queue = deque(sorted((node for node, degree in indegree.items() if degree == 0), key=str))
    order: list[UUID] = []
    while queue:
        node = queue.popleft()
        order.append(node)
        for successor in sorted(outgoing[node], key=str):
            indegree[successor] -= 1
            if indegree[successor] == 0:
                queue.append(successor)
    if len(order) != len(elements):
        cyclic = [str(node) for node, degree in indegree.items() if degree > 0]
        raise ValueError("PRECEDENCE_CYCLE: " + ", ".join(cyclic))
    return order


def calculate(study: dict) -> dict:
    p = study["parameters"]
    areas = study["areas"]
    elements = study["elements"]
    station_counts = study["stations"]
    shift = Decimal(str(p["shiftSeconds"]))
    demand = Decimal(str(p["demandPerShift"]))
    takt = shift / demand if demand > 0 else None
    metrics: dict = {"taktSeconds": takt, "current": {}, "future": {}}
    for scenario in ("current", "future"):
        count = station_counts[scenario]
        loads = [Decimal(0) for _ in range(count)]
        area_totals = {str(a["id"]): {"va": Decimal(0), "nva": Decimal(0), "total": Decimal(0)} for a in areas}
        for e in elements:
            data = e[scenario]
            idx = int(data["stationIndex"]) - 1
            va = Decimal(str(data["vaSeconds"]))
            nva = Decimal(str(data["nvaSeconds"]))
            total = va + nva
            loads[idx] += total
            group = area_totals[str(e["areaId"])]
            group["va"] += va
            group["nva"] += nva
            group["total"] += total
        cycle = max(loads, default=Decimal(0))
        bottleneck = [i + 1 for i, load in enumerate(loads) if load == cycle] if cycle > 0 else []
        capacity = shift / cycle if cycle > 0 else None
        labor = Decimal(str(p["laborCostPerShiftCurrent" if scenario == "current" else "laborCostPerShiftFuture"]))
        cmo = labor / capacity if capacity else None
        ops_cost = sum((Decimal(str(a["operationalCostPerPieceCurrent" if scenario == "current" else "operationalCostPerPieceFuture"])) for a in areas), Decimal(0))
        metrics[scenario] = {"stationLoadsSeconds": loads, "cycleSeconds": cycle if cycle > 0 else None,
                             "bottleneckStations": bottleneck, "theoreticalCapacityPerShift": capacity,
                             "cmoPerPiece": cmo, "operationalCostPerPiece": ops_cost,
                             "meetsTakt": (cycle <= takt) if takt is not None and cycle > 0 else None,
                             "areas": area_totals}
    current_cmo = metrics["current"]["cmoPerPiece"]
    future_cmo = metrics["future"]["cmoPerPiece"]
    metrics["monthlyLaborSavingEstimate"] = ((current_cmo - future_cmo) * Decimal(str(p["baselineUnitsPerDay"])) * Decimal(p["productiveDaysPerMonth"])) if current_cmo is not None and future_cmo is not None else None
    return metrics
