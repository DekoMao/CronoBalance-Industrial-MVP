"""Translate supported exports into validated inputs. Legacy identifiers are file-local."""
from decimal import Decimal
from uuid import uuid4
from fastapi import HTTPException
from ..domain.models import CreateStudy

def rows(value, limit, label):
    if not isinstance(value, list) or len(value) > limit or any(not isinstance(x, dict) for x in value):
        raise HTTPException(422, f"Lista inválida ou limite de {limit} {label} excedido")
    return value

def count(value):
    number = len(value) if isinstance(value, list) else value
    if isinstance(number, bool) or not isinstance(number, int) or not 1 <= number <= 20:
        raise HTTPException(422, "O arquivo deve conter entre 1 e 20 postos em cada cenário")
    return number

def ids(items):
    values = [str(row.get("id",i)) for i,row in enumerate(items)]
    if len(set(values)) != len(values):
        raise HTTPException(422,"IDs duplicados no arquivo")
    return {v:str(uuid4()) for v in values}

def legacy_study(data, version):
    project = data.get("project") or data.get("parameters") or data
    params = {"name":project.get("name",data.get("name","Estudo importado")),"productFamily":project.get("productFamily",project.get("product","")),
              "shiftSeconds":project.get("shiftSeconds",27000),"demandPerShift":project.get("demandPerShift",project.get("demand",0)),
              "productiveDaysPerMonth":project.get("productiveDaysPerMonth",project.get("days",22)),
              "baselineUnitsPerDay":project.get("baselineUnitsPerDay",project.get("dailyVolume",0)),
              "laborCostPerShiftCurrent":project.get("laborCostPerShiftCurrent",project.get("laborCurrent",0)),
              "laborCostPerShiftFuture":project.get("laborCostPerShiftFuture",project.get("laborFuture",0)),
              "oeePct":project.get("oeePct",project.get("oee",100)),"seasonalityPct":project.get("seasonalityPct",0),"capex":project.get("capex",0)}
    if version==1:
        ops=rows(data.get("operations",[]),100,"operações")
        stations={"current":count(data.get("current") or len(ops) or 1),"future":count(data.get("future") or data.get("futureStations",1))}
        areas=ops
        elements=[{**o,"area":o["name"],"currentStation":o.get("currentStation",min(i+1,stations["current"]))} for i,o in enumerate(ops)]
        loads=[Decimal(0)]*stations["future"]
        def weight(o):
            return sum((Decimal(str(o.get(k+"Future",o.get(k+"Current",0)))) for k in ("va","nva")),Decimal(0))
        for e in sorted(elements,key=weight,reverse=True):
            slot=loads.index(min(loads));e["futureStation"]=slot+1;loads[slot]+=weight(e)
    else:
        areas=rows(data.get("areas",[]),100,"áreas");elements=rows(data.get("elements",[]),500,"elementos")
        sc=data.get("stations",project.get("stations",{}))
        stations={k:count(sc.get(k,1)) for k in ("current","future")}
    resources=rows(data.get("equipment",[]),100,"equipamentos"); a_ids,e_ids,r_ids=ids(areas),ids(elements),ids(resources)
    by_name={a["name"]:a_ids[str(a.get("id",i))] for i,a in enumerate(areas)}
    if len(by_name)!=len(areas):raise HTTPException(422,"Áreas com nomes duplicados")
    formatted_areas=[{"id":a_ids[str(a.get("id",i))],"name":a["name"],"sortOrder":i,
                      "operationalCostPerPieceCurrent":a.get("operationalCostPerPieceCurrent",a.get("costCurrent",0)),
                      "operationalCostPerPieceFuture":a.get("operationalCostPerPieceFuture",a.get("costFuture",0))} for i,a in enumerate(areas)]
    equipment=[{**{k:r.get(k) for k in ("name","currentStationIndex","futureStationIndex")},"id":r_ids[str(r.get("id",i))]} for i,r in enumerate(resources)]
    tasks=[]
    for i,e in enumerate(elements):
        area=a_ids[str(e["areaId"])] if e.get("areaId") else by_name[e["area"]]
        resource=r_ids[str(e["fixedEquipmentId"])] if e.get("fixedEquipmentId") else None
        if resource is None and e.get("fixedStation") is not None:
            resource=str(uuid4());equipment.append({"id":resource,"name":"Monumento · "+e["name"][:145],"futureStationIndex":e["fixedStation"]})
        t={"id":e_ids[str(e.get("id",i))],"name":e["name"],"areaId":area,"sortOrder":i,"fixedEquipmentId":resource,
           "ergonomicZone":e.get("ergonomicZone") or "green","validationStatus":e.get("validationStatus","hypothesis"),"evidenceRef":e.get("evidenceRef")}
        for side in ("current","future"):
            t[side]=e.get(side) or {"stationIndex":e.get(side+"Station",1),"vaSeconds":e.get("va"+side.title(),e.get("vaCurrent",0)),"nvaSeconds":e.get("nva"+side.title(),e.get("nvaCurrent",0))}
        tasks.append(t)
    edges=[]
    for edge in data.get("precedences",[]):
        a,b=(edge["predecessorId"],edge["successorId"]) if isinstance(edge,dict) else edge
        edges.append({"predecessorId":e_ids[str(a)],"successorId":e_ids[str(b)]})
    return CreateStudy.model_validate({"parameters":params,"stations":stations,"areas":formatted_areas,"elements":tasks,"equipment":equipment,"precedences":edges,
               "workspace":data.get("workspace") or {k:data[k] for k in ("author","revision","cv","auditLog") if k in data}})
