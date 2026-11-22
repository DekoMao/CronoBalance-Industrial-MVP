from __future__ import annotations

import hashlib
import json
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, Header, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .db.models import (Area, AuditLog, ElementAssignment, EquipmentResource, Membership, Organization,
                        Precedence, Revision, Station, Study, User, WorkElement, MutationReceipt)
from .db.session import Base, engine, get_db
from .domain.models import CreateStudy, OptimizeRequest, PrecedenceInput, StudyPatch, calculate, validate_dag, valid_exception
from .security import Actor, actor_context, require_role

@asynccontextmanager
async def lifespan(_: FastAPI):
    if os.getenv("AUTO_CREATE_SCHEMA", "true").lower() == "true":
        Base.metadata.create_all(bind=engine)
    if os.getenv("APP_ENV", "development") == "development":
        from .db.session import SessionLocal
        db = SessionLocal()
        try:
            org = db.query(Organization).filter_by(slug="demo-industrial").first()
            user = db.query(User).filter_by(oidc_subject="local-dev").first()
            if not org:
                org = Organization(name="Organização de demonstração", slug="demo-industrial")
                db.add(org); db.flush()
            if not user:
                user = User(oidc_subject="local-dev", email="engenharia@example.local", display_name="Engenharia Demo")
                db.add(user); db.flush()
            if not db.query(Membership).filter_by(organization_id=org.id, user_id=user.id).first():
                db.add(Membership(organization_id=org.id, user_id=user.id, role="admin"))
            db.commit()
        finally:
            db.close()
    yield


app = FastAPI(title="CronoBalance Industrial API", version="1.0.0", openapi_url="/api/v1/openapi.json", lifespan=lifespan)
allowed_origins = [origin.strip() for origin in os.getenv("CORS_ORIGINS", "http://localhost:4173,http://localhost:5173").split(",") if origin.strip()]
app.add_middleware(CORSMiddleware, allow_origins=allowed_origins, allow_credentials=True,
                   allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
                   allow_headers=["Authorization", "Content-Type", "If-Match", "Idempotency-Key", "X-Organization-ID"],
                   expose_headers=["ETag", "Location", "X-Request-ID"])


@app.middleware("http")
async def request_context(request: Request, call_next):
    request.state.request_id = request.headers.get("X-Request-ID", str(uuid4()))
    response = await call_next(request)
    response.headers["X-Request-ID"] = request.state.request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError):
    detail = str(exc)
    code = "PRECEDENCE_CYCLE" if "PRECEDENCE_CYCLE" in detail else "VALIDATION_ERROR"
    return JSONResponse(status_code=422, content={"type":"about:blank", "title":"Dados inválidos", "status":422,
        "detail":detail, "instance":str(request.url.path), "code":code, "requestId":getattr(request.state,"request_id",None)})


def decimal_json(value):
    if isinstance(value, Decimal): return format(value, "f")
    if isinstance(value, datetime): return value.isoformat()
    if isinstance(value, dict): return {str(k): decimal_json(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)): return [decimal_json(v) for v in value]
    return value


def checked_decimal(value, places: int, *, allow_zero: bool = True) -> Decimal:
    try: number=Decimal(str(value))
    except Exception as exc: raise HTTPException(422,"Valor numérico inválido") from exc
    if not number.is_finite() or (number<0 if allow_zero else number<=0) or number.as_tuple().exponent < -places:
        raise HTTPException(422,f"Valor deve ser finito, {'não negativo' if allow_zero else 'positivo'} e ter até {places} casas decimais")
    return number


def study_etag(study: Study) -> str:
    return f'"study-{study.id}-v{study.version}"'


def require_version(study: Study, if_match: str | None):
    if not if_match: raise HTTPException(428, "If-Match é obrigatório para alterar um estudo")
    if if_match != study_etag(study):
        raise HTTPException(412, detail={"code":"VERSION_CONFLICT", "currentVersion":study.version, "etag":study_etag(study)})


def load_study(db: Session, study_id: str, actor: Actor, lock: bool = False) -> Study:
    query = select(Study).where(Study.id == study_id, Study.organization_id == actor.organization_id)
    if lock:
        query = query.with_for_update(of=Study)
    query = query.options(selectinload(Study.areas), selectinload(Study.elements),
                          selectinload(Study.stations), selectinload(Study.precedences))
    study = db.execute(query).scalar_one_or_none()
    if not study:
        raise HTTPException(404, "Estudo não encontrado")
    if lock and study.status == "archived":
        raise HTTPException(409, {"code": "STUDY_ARCHIVED"})
    return study


def domain_dict(study: Study) -> dict:
    areas = [{"id":a.id,"name":a.name,"sortOrder":a.sort_order,"operationalCostPerPieceCurrent":a.operational_cost_current,
              "operationalCostPerPieceFuture":a.operational_cost_future} for a in study.areas]
    element_map = {e.id:e for e in study.elements}
    assignments = {(a.element_id,a.scenario):a for a in db_assignments(study)}
    elements=[]
    for e in study.elements:
        ca=assignments.get((e.id,"current")); fa=assignments.get((e.id,"future"))
        elements.append({"id":e.id,"areaId":e.area_id,"name":e.name,"sortOrder":e.sort_order,
            "current":{"stationIndex":station_index(study,ca),"vaSeconds":e.current_va_seconds,"nvaSeconds":e.current_nva_seconds},
            "future":{"stationIndex":station_index(study,fa),"vaSeconds":e.future_va_seconds,"nvaSeconds":e.future_nva_seconds},
            "ergonomicZone":e.ergonomic_zone,"fixedEquipmentId":e.fixed_equipment_id,
            "validationStatus":e.validation_status,"evidenceRef":e.evidence_ref,"ergonomicException":e.ergonomic_exception})
    parameters={"name":study.name,"productFamily":study.product_family,"shiftSeconds":study.shift_seconds,
        "demandPerShift":study.demand_per_shift,"productiveDaysPerMonth":study.productive_days_per_month,
        "baselineUnitsPerDay":study.baseline_units_per_day,"laborCostPerShiftCurrent":study.labor_cost_current,
        "laborCostPerShiftFuture":study.labor_cost_future,"oeePct":study.oee_pct,
        "seasonalityPct":study.seasonality_pct,"capex":study.capex}
    equipment=[{"id":x.id,"name":x.name,"currentStationIndex":x.current_station_index,"futureStationIndex":x.future_station_index}
        for x in db_equipment(study)]
    return {"parameters":parameters,"stations":{"current":study.current_station_count,"future":study.future_station_count},
            "areas":areas,"elements":elements,"equipment":equipment,"precedences":[{"predecessorId":p.predecessor_id,"successorId":p.successor_id} for p in study.precedences]}


def db_assignments(study: Study):
    # Relationship is loaded through an explicit query in serializers; attached for convenient domain mapping.
    return getattr(study, "_assignments", [])


def db_equipment(study: Study):
    return getattr(study, "_equipment", [])


def station_index(study: Study, assignment: ElementAssignment | None) -> int:
    if assignment is None: return 1
    st = next((s for s in study.stations if s.id == assignment.station_id and s.scenario == assignment.scenario), None)
    return st.station_index if st else 1


def study_payload(db: Session, study: Study) -> dict:
    study._assignments = db.query(ElementAssignment).filter_by(study_id=study.id).all()
    study._equipment = db.query(EquipmentResource).filter_by(study_id=study.id).all()
    raw=domain_dict(study); metrics=calculate(raw)
    areas=[]
    for a in raw["areas"]:
        cur=metrics["current"]["areas"][a["id"]]; fut=metrics["future"]["areas"][a["id"]]
        areas.append({**a,"derivedCurrent":cur,"derivedFuture":fut})
    stations={}
    for scenario in ("current","future"):
        loads=metrics[scenario]["stationLoadsSeconds"]
        stations[scenario]=[{"id":s.id,"index":s.station_index,"label":s.label,"loadSeconds":loads[s.station_index-1]}
            for s in sorted((x for x in study.stations if x.scenario==scenario and x.station_index<=len(loads)),key=lambda x:x.station_index)]
    out={"id":study.id,"version":study.version,"status":study.status,"name":study.name,"productFamily":study.product_family,
         "parameters":{**raw["parameters"],"taktSeconds":metrics["taktSeconds"]},"stations":stations,"areas":areas,
         "elements":raw["elements"],"equipment":raw["equipment"],"precedences":raw["precedences"],"metrics":metrics,
         "validation":{"isValid":True,"hypothesisCount":sum(e.validation_status=="hypothesis" for e in study.elements),"unresolvedWarnings":[]},
         "workspace":study.workspace_metadata or {},"updatedAt":study.updated_at}
    return decimal_json(out)


def snapshot(db: Session, study: Study) -> dict:
    return study_payload(db, study)


def record_revision(db: Session, study: Study, actor: Actor, summary: str, request_id: str, action: str,
                    before: dict | None = None, client_mutation_id: str | None = None):
    db.flush()
    db.expire(study, ["areas","elements","stations","precedences"])
    snap=snapshot(db,study)
    db.add(Revision(study_id=study.id,revision_number=study.version,source_version=study.version,snapshot=snap,
                    change_summary=summary,created_by=actor.user.id))
    db.add(AuditLog(organization_id=study.organization_id,study_id=study.id,actor_user_id=actor.user.id,
                    action=action,entity_type="study",entity_id=study.id,before_data=before,after_data=snap,
                    request_id=request_id,client_mutation_id=client_mutation_id))
    db.flush()


def write_graph(db: Session, study: Study, actor: Actor, payload: CreateStudy):
    stations={}
    for scenario,count in (("current",payload.stations.current),("future",payload.stations.future)):
        stations[scenario]={}
        for index in range(1,count+1):
            station=Station(study_id=study.id,scenario=scenario,station_index=index,label=f"F{index}")
            db.add(station); db.flush(); stations[scenario][index]=station
    area_by_client={}; area_by_id={}; area_by_name={}
    for item in payload.areas:
        area=Area(id=str(item.id or uuid4()),study_id=study.id,name=item.name,sort_order=item.sortOrder,
                  operational_cost_current=item.operationalCostPerPieceCurrent,operational_cost_future=item.operationalCostPerPieceFuture)
        db.add(area); db.flush(); area_by_client[item.clientId]=area; area_by_id[item.id]=area; area_by_name[item.name]=area
    equipment_by_client={};equipment_by_id={}
    for item in payload.equipment:
        resource=EquipmentResource(id=str(item.id or uuid4()),study_id=study.id,name=item.name,
            current_station_index=item.currentStationIndex,future_station_index=item.futureStationIndex)
        db.add(resource);db.flush();equipment_by_id[resource.id]=resource
        if item.clientId: equipment_by_client[item.clientId]=resource
    element_by_client={}; element_ids=set()
    for item in payload.elements:
        area=area_by_id.get(item.areaId) if item.areaId else area_by_client.get(item.areaClientId)
        if area is None: raise HTTPException(422, f"Área ausente para o elemento {item.name}")
        element=WorkElement(id=str(item.id or uuid4()),study_id=study.id,area_id=area.id,name=item.name,sort_order=item.sortOrder,
            current_va_seconds=item.current.vaSeconds,current_nva_seconds=item.current.nvaSeconds,
            future_va_seconds=item.future.vaSeconds,future_nva_seconds=item.future.nvaSeconds,
            fixed_equipment_id=equipment_by_id[str(item.fixedEquipmentId)].id if item.fixedEquipmentId and str(item.fixedEquipmentId) in equipment_by_id else (equipment_by_client.get(str(item.fixedEquipmentId)).id if item.fixedEquipmentId and str(item.fixedEquipmentId) in equipment_by_client else None),ergonomic_zone=item.ergonomicZone,
            validation_status=item.validationStatus,evidence_ref=item.evidenceRef)
        db.add(element); db.flush(); element_ids.add(element.id); element_by_client[item.clientId]=element
        db.add(ElementAssignment(study_id=study.id,element_id=element.id,scenario="current",station_id=stations["current"][item.current.stationIndex].id))
        db.add(ElementAssignment(study_id=study.id,element_id=element.id,scenario="future",station_id=stations["future"][item.future.stationIndex].id))
    edge_ids=[]
    for edge in payload.precedences:
        pred=str(edge.predecessorId); succ=str(edge.successorId)
        edge_ids.append((pred,succ))
    validate_dag(element_ids,edge_ids)
    for pred,succ in edge_ids:
        db.add(Precedence(study_id=study.id,predecessor_id=pred,successor_id=succ,created_by=actor.user.id))


def create_study_rows(db: Session, actor: Actor, payload: CreateStudy, request_id: str, summary="Estudo criado") -> Study:
    p=payload.parameters
    study=Study(id=str(payload.studyId or uuid4()),organization_id=actor.organization_id,name=p.name,product_family=p.productFamily,shift_seconds=p.shiftSeconds,
        demand_per_shift=p.demandPerShift,productive_days_per_month=p.productiveDaysPerMonth,baseline_units_per_day=p.baselineUnitsPerDay,
        labor_cost_current=p.laborCostPerShiftCurrent,labor_cost_future=p.laborCostPerShiftFuture,
        oee_pct=p.oeePct,seasonality_pct=p.seasonalityPct,capex=p.capex,
        current_station_count=payload.stations.current,future_station_count=payload.stations.future, workspace_metadata=payload.workspace.model_dump(mode="json"),
        created_by=actor.user.id,updated_by=actor.user.id)
    db.add(study); db.flush()
    write_graph(db, study, actor, payload)
    study.version=1; study.updated_by=actor.user.id
    db.flush(); record_revision(db,study,actor,summary,request_id,"study.create")
    return study


@app.get("/api/v1/health/live")
def live(): return {"status":"live"}


@app.get("/api/v1/health/ready")
def ready(db: Session = Depends(get_db)):
    try: db.execute(select(1))
    except Exception as exc: raise HTTPException(503,"Banco indisponível") from exc
    return {"status":"ready"}


@app.get("/api/v1/studies")
def list_studies(cursor: str | None=None, limit: int=50, actor: Actor=Depends(actor_context), db: Session=Depends(get_db)):
    limit=max(1,min(100,limit))
    try: offset=max(0,int(cursor or 0))
    except ValueError: raise HTTPException(422,"Cursor deve ser um offset numérico não negativo")
    query=db.query(Study).filter_by(organization_id=actor.organization_id).filter(Study.status!="archived").order_by(Study.updated_at.desc(),Study.id)
    rows=query.offset(offset).limit(limit+1).all(); has_more=len(rows)>limit; rows=rows[:limit]
    return {"items":[{"id":s.id,"name":s.name,"productFamily":s.product_family,"version":s.version,"status":s.status,"updatedAt":s.updated_at} for s in rows],"nextCursor":str(offset+limit) if has_more else None}


@app.post("/api/v1/studies", status_code=201)
def create_study(payload: CreateStudy, response: Response, request: Request, actor: Actor=Depends(require_role("engineer","admin")), db: Session=Depends(get_db), idempotency_key: str | None=Header(default=None,alias="Idempotency-Key")):
    if payload.stations.future>12 or payload.stations.current>20:
        raise HTTPException(422,"Limite de 12 postos futuros e 20 atuais na criação")
    try:
        if payload.studyId:
            existing=db.query(Study).filter_by(id=str(payload.studyId),organization_id=actor.organization_id).first()
            if existing:
                response.status_code=200;response.headers["ETag"]=study_etag(existing);response.headers["Location"]=f"/api/v1/studies/{existing.id}"
                return study_payload(db,existing)
        study=create_study_rows(db,actor,payload,request.state.request_id)
        db.commit(); response.headers["ETag"]=study_etag(study); response.headers["Location"]=f"/api/v1/studies/{study.id}"
        return study_payload(db,study)
    except Exception: db.rollback(); raise


@app.get("/api/v1/studies/{study_id}")
def get_study(study_id: str, response: Response, actor: Actor=Depends(actor_context), db: Session=Depends(get_db)):
    study=load_study(db,study_id,actor); response.headers["ETag"]=study_etag(study)
    return study_payload(db,study)


@app.patch("/api/v1/studies/{study_id}/elements/batch")
def patch_batch(study_id: str,payload: StudyPatch,request: Request,response: Response,if_match: str | None=Header(default=None,alias="If-Match"),
                actor: Actor=Depends(require_role("engineer","admin")),db: Session=Depends(get_db)):
    study=load_study(db,study_id,actor,lock=True)
    old_receipt=db.query(MutationReceipt).filter_by(study_id=study.id,client_mutation_id=str(payload.clientMutationId)).first()
    if old_receipt: response.headers["ETag"]=study_etag(study); return study_payload(db,study)
    require_version(study,if_match); before=study_payload(db,study)
    area_map={a.id:a for a in study.areas}; element_map={e.id:e for e in study.elements}
    equipment_map={x.id:x for x in db.query(EquipmentResource).filter_by(study_id=study.id).all()}
    try:
        for op in payload.operations:
            entity=op.get("entity"); changes=op.get("changes",{}); target_id=op.get("id")
            action=op.get("op")
            if action not in ("replace","move","create","delete") or not isinstance(changes,dict): raise HTTPException(422,"Operação de lote inválida")
            if action=="create" and entity=="area":
                area_id=str(target_id or uuid4())
                area_name=str(changes.get("name","Nova área")).strip()
                if not area_name or len(area_name)>120: raise HTTPException(422,"Nome da área deve ter entre 1 e 120 caracteres")
                if db.query(Area).filter_by(study_id=study.id,name=area_name).first(): raise HTTPException(409,"Já existe uma área com esse nome")
                area=Area(id=area_id,study_id=study.id,name=area_name,sort_order=int(changes.get("sortOrder",len(study.areas))),operational_cost_current=checked_decimal(changes.get("operationalCostPerPieceCurrent",0),2),operational_cost_future=checked_decimal(changes.get("operationalCostPerPieceFuture",0),2))
                db.add(area); db.flush(); area_map[area.id]=area
                continue
            if action=="create" and entity=="equipmentResource":
                resource_id=str(target_id or uuid4()); name=str(changes.get("name","Equipamento"))[:160]
                current_index=changes.get("currentStationIndex");future_index=changes.get("futureStationIndex")
                if current_index is not None and not 1<=int(current_index)<=study.current_station_count: raise HTTPException(422,"Posto atual de equipamento inválido")
                if future_index is not None and not 1<=int(future_index)<=study.future_station_count: raise HTTPException(422,"Posto futuro de equipamento inválido")
                resource=EquipmentResource(id=resource_id,study_id=study.id,name=name,current_station_index=int(current_index) if current_index is not None else None,future_station_index=int(future_index) if future_index is not None else None)
                db.add(resource);db.flush();equipment_map[resource.id]=resource
                continue
            if action=="create" and entity=="workElement":
                element_id=str(target_id or uuid4()); area_id=str(changes.get("areaId","")); area=area_map.get(area_id)
                if not area: raise HTTPException(422,"Área do mesmo estudo é obrigatória")
                cur=changes.get("current",{}); fut=changes.get("future",{})
                ca=db.query(Station).filter_by(study_id=study.id,scenario="current",station_index=int(cur.get("stationIndex",1))).first()
                fa=db.query(Station).filter_by(study_id=study.id,scenario="future",station_index=int(fut.get("stationIndex",1))).first()
                if not ca or not fa: raise HTTPException(422,"Posto atual/futuro inválido")
                fixed_id=changes.get("fixedEquipmentId")
                if fixed_id and str(fixed_id) not in equipment_map: raise HTTPException(422,"Equipamento fixo não pertence a este estudo")
                element_name=str(changes.get("name","Novo elemento")).strip()
                if not element_name or len(element_name)>200: raise HTTPException(422,"Nome do elemento deve ter entre 1 e 200 caracteres")
                element=WorkElement(id=element_id,study_id=study.id,area_id=area.id,name=element_name,sort_order=int(changes.get("sortOrder",len(study.elements))),current_va_seconds=checked_decimal(cur.get("vaSeconds",0),3),current_nva_seconds=checked_decimal(cur.get("nvaSeconds",0),3),future_va_seconds=checked_decimal(fut.get("vaSeconds",0),3),future_nva_seconds=checked_decimal(fut.get("nvaSeconds",0),3),ergonomic_zone=changes.get("ergonomicZone","green"),fixed_equipment_id=changes.get("fixedEquipmentId"),validation_status=changes.get("validationStatus","hypothesis"),evidence_ref=changes.get("evidenceRef"))
                db.add(element); db.flush(); element_map[element.id]=element
                db.add_all([ElementAssignment(study_id=study.id,element_id=element.id,scenario="current",station_id=ca.id),ElementAssignment(study_id=study.id,element_id=element.id,scenario="future",station_id=fa.id)])
                continue
            if action=="delete" and entity=="workElement":
                element=element_map.get(str(target_id))
                if not element: raise HTTPException(404,"Elemento não encontrado")
                db.query(Precedence).filter(Precedence.study_id==study.id,((Precedence.predecessor_id==element.id)|(Precedence.successor_id==element.id))).delete(synchronize_session=False)
                db.delete(element); element_map.pop(str(target_id),None)
                continue
            if action=="delete" and entity=="area":
                area=area_map.get(str(target_id))
                if not area: raise HTTPException(404,"Área não encontrada")
                linked=db.query(WorkElement.id).filter_by(study_id=study.id,area_id=area.id).all()
                if linked: raise HTTPException(409,detail={"code":"AREA_NOT_EMPTY","elementIds":[x[0] for x in linked]})
                db.delete(area); area_map.pop(str(target_id),None)
                continue
            if action=="delete" and entity=="equipmentResource":
                resource=equipment_map.get(str(target_id))
                if not resource: raise HTTPException(404,"Equipamento não encontrado")
                attached=db.query(WorkElement.id).filter_by(study_id=study.id,fixed_equipment_id=resource.id).all()
                reserved=db.query(Station.id).filter_by(study_id=study.id,fixed_equipment_id=resource.id).all()
                if attached or reserved: raise HTTPException(409,detail={"code":"EQUIPMENT_IN_USE"})
                db.delete(resource);equipment_map.pop(resource.id,None)
                continue
            if entity=="precedences":
                if action!="replace": raise HTTPException(422,"Precedências só aceitam substituição completa")
                edges=changes.get("edges",[])
                try: pairs=[(UUID(str(x["predecessorId"])),UUID(str(x["successorId"]))) for x in edges]
                except (KeyError,TypeError,ValueError): raise HTTPException(422,"Lista de precedências inválida")
                validate_dag({UUID(x) for x in element_map},pairs)
                db.query(Precedence).filter_by(study_id=study.id).delete()
                for predecessor,successor in pairs:
                    db.add(Precedence(study_id=study.id,predecessor_id=str(predecessor),successor_id=str(successor),created_by=actor.user.id))
                continue
            if entity=="stations":
                scenario=changes.get("scenario"); count=int(changes.get("count",0))
                if scenario not in ("current","future") or count<1 or count>100: raise HTTPException(422,"Cenário ou quantidade de postos inválida")
                rows={s.station_index:s for s in study.stations if s.scenario==scenario}
                if count<len(rows):
                    for index,station in rows.items():
                        if index>count:
                            linked=db.query(ElementAssignment.element_id).filter_by(study_id=study.id,scenario=scenario,station_id=station.id).all()
                            if linked: raise HTTPException(409,detail={"code":"STATION_NOT_EMPTY","station":station.label,"elementIds":[x[0] for x in linked]})
                            db.delete(station)
                else:
                    for index in range(1,count+1):
                        if index not in rows: db.add(Station(study_id=study.id,scenario=scenario,station_index=index,label=f"F{index}"))
                if scenario=="current": study.current_station_count=count
                else: study.future_station_count=count
                continue
            if entity=="workElement":
                element=element_map.get(str(target_id))
                if not element: raise HTTPException(404,"Elemento não encontrado")
                for path,value in changes.items():
                    if path=="name": element.name=str(value)[:200]
                    elif path=="areaId":
                        if str(value) not in area_map: raise HTTPException(422,"Área do mesmo estudo é obrigatória")
                        element.area_id=str(value)
                    elif path in ("current.vaSeconds","current.nvaSeconds","future.vaSeconds","future.nvaSeconds"):
                        field={"current.vaSeconds":"current_va_seconds","current.nvaSeconds":"current_nva_seconds","future.vaSeconds":"future_va_seconds","future.nvaSeconds":"future_nva_seconds"}[path]
                        amount=checked_decimal(value,3)
                        setattr(element,field,amount)
                    elif path in ("current.stationIndex","future.stationIndex"):
                        scenario=path.split(".")[0]; idx=int(value)
                        station=db.query(Station).filter_by(study_id=study.id,scenario=scenario,station_index=idx).first()
                        if not station: raise HTTPException(422,"Posto não existe neste cenário")
                        assignment=db.query(ElementAssignment).filter_by(study_id=study.id,element_id=element.id,scenario=scenario).one()
                        assignment.station_id=station.id
                    elif path=="ergonomicZone":
                        if value not in (None,"green","yellow","red"): raise HTTPException(422,"Zona ergonômica inválida")
                        element.ergonomic_zone=value
                    elif path=="fixedEquipmentId":
                        if value is not None and str(value) not in equipment_map: raise HTTPException(422,"Equipamento fixo não pertence a este estudo")
                        element.fixed_equipment_id=str(value) if value else None
                    elif path=="evidenceRef": element.evidence_ref=str(value)[:500]
                    elif path=="validation.status":
                        if value not in ("hypothesis","validated"): raise HTTPException(422,"Status de validação inválido")
                        element.validation_status=value
                    else: raise HTTPException(422,f"Campo não editável: {path}")
            elif entity=="area":
                area=area_map.get(str(target_id))
                if not area: raise HTTPException(404,"Área não encontrada")
                for path,value in changes.items():
                    if path=="name":
                        text=str(value).strip()
                        if not text or len(text)>120: raise HTTPException(422,"Nome da área deve ter entre 1 e 120 caracteres")
                        area.name=text
                    elif path=="sortOrder": area.sort_order=int(value)
                    elif path=="operationalCostPerPieceCurrent": area.operational_cost_current=checked_decimal(value,2)
                    elif path=="operationalCostPerPieceFuture": area.operational_cost_future=checked_decimal(value,2)
                    else: raise HTTPException(422,f"Campo não editável: {path}")
            elif entity=="equipmentResource":
                resource=equipment_map.get(str(target_id))
                if not resource: raise HTTPException(404,"Equipamento não encontrado")
                for path,value in changes.items():
                    if path=="name": resource.name=str(value)[:160]
                    elif path in ("currentStationIndex","futureStationIndex"):
                        scenario="current" if path.startswith("current") else "future";count=study.current_station_count if scenario=="current" else study.future_station_count
                        if value is not None and not 1<=int(value)<=count: raise HTTPException(422,"Posto de equipamento inválido")
                        setattr(resource,"current_station_index" if scenario=="current" else "future_station_index",int(value) if value is not None else None)
                    else: raise HTTPException(422,f"Campo não editável: {path}")
            elif entity=="studyParameters":
                mapping={"name":"name","productFamily":"product_family","shiftSeconds":"shift_seconds","demandPerShift":"demand_per_shift",
                         "productiveDaysPerMonth":"productive_days_per_month","baselineUnitsPerDay":"baseline_units_per_day",
                         "laborCostPerShiftCurrent":"labor_cost_current","laborCostPerShiftFuture":"labor_cost_future",
                         "oeePct":"oee_pct","seasonalityPct":"seasonality_pct","capex":"capex"}
                for path,value in changes.items():
                    if path not in mapping: raise HTTPException(422,f"Campo não editável: {path}")
                    if path=="name":
                        text=str(value).strip()
                        if not text or len(text)>160: raise HTTPException(422,"Nome do estudo deve ter entre 1 e 160 caracteres")
                        setattr(study,mapping[path],text)
                    elif path=="productFamily": setattr(study,mapping[path],str(value)[:120])
                    elif path=="productiveDaysPerMonth":
                        days=int(value)
                        if days<0 or days>31: raise HTTPException(422,"Dias produtivos deve ficar entre 0 e 31")
                        setattr(study,mapping[path],days)
                    elif path=="oeePct":
                        number=checked_decimal(value,2,allow_zero=False)
                        if number<10 or number>100: raise HTTPException(422,"OEE deve ficar entre 10% e 100%")
                        setattr(study,mapping[path],number)
                    elif path=="seasonalityPct":
                        number=Decimal(str(value))
                        if not number.is_finite() or number.as_tuple().exponent < -2 or number < -30 or number > 50: raise HTTPException(422,"Sazonalidade deve ficar entre -30% e +50%")
                        setattr(study,mapping[path],number)
                    elif path=="capex": setattr(study,mapping[path],checked_decimal(value,2))
                    else: setattr(study,mapping[path],checked_decimal(value,2 if path.startswith("laborCost") else 3,allow_zero=path!="shiftSeconds"))
            else: raise HTTPException(422,"Entidade de lote desconhecida")
        study.status="draft"; study.version+=1; study.updated_by=actor.user.id; study.updated_at=datetime.now(timezone.utc)
        record_revision(db,study,actor,"Atualização em lote",request.state.request_id,"study.batch.update",before,str(payload.clientMutationId))
        result=study_payload(db,study)
        db.add(MutationReceipt(study_id=study.id,client_mutation_id=str(payload.clientMutationId),response=result))
        db.commit(); response.headers["ETag"]=study_etag(study)
        return result
    except Exception: db.rollback(); raise


@app.put("/api/v1/studies/{study_id}/precedences")
def replace_precedences(study_id: str, edges: list[PrecedenceInput], request: Request,response: Response,
    if_match: str | None=Header(default=None,alias="If-Match"),actor: Actor=Depends(require_role("engineer","admin")),db: Session=Depends(get_db)):
    study=load_study(db,study_id,actor,lock=True); require_version(study,if_match); before=study_payload(db,study)
    edge_pairs=[(str(e.predecessorId),str(e.successorId)) for e in edges]
    try:
        validate_dag({e.id for e in study.elements},edge_pairs)
        db.query(Precedence).filter_by(study_id=study.id).delete()
        for a,b in edge_pairs: db.add(Precedence(study_id=study.id,predecessor_id=a,successor_id=b,created_by=actor.user.id))
        study.status="draft"; study.version+=1; study.updated_by=actor.user.id
        record_revision(db,study,actor,"Precedências atualizadas",request.state.request_id,"precedence.replace",before)
        out=study_payload(db,study); db.commit(); response.headers["ETag"]=study_etag(study); return out
    except Exception: db.rollback(); raise


@app.patch("/api/v1/studies/{study_id}/stations/{scenario}")
def resize_stations(study_id: str,scenario: str,payload: dict,request: Request,response: Response,
    if_match: str | None=Header(default=None,alias="If-Match"),actor: Actor=Depends(require_role("engineer","admin")),db: Session=Depends(get_db)):
    if scenario not in ("current","future"): raise HTTPException(422,"Cenário deve ser current ou future")
    try: count=int(payload.get("count",0))
    except (TypeError,ValueError): raise HTTPException(422,"Quantidade de postos inválida")
    if count<1 or count>100: raise HTTPException(422,"A quantidade deve ficar entre 1 e 100 postos")
    study=load_study(db,study_id,actor,lock=True); require_version(study,if_match); before=study_payload(db,study)
    try:
        existing={s.station_index:s for s in study.stations if s.scenario==scenario}
        if count<len(existing):
            for index,station in existing.items():
                if index>count:
                    element_ids=[row[0] for row in db.query(ElementAssignment.element_id).filter_by(study_id=study.id,scenario=scenario,station_id=station.id).all()]
                    if element_ids: raise HTTPException(409,detail={"code":"STATION_NOT_EMPTY","station":station.label,"elementIds":element_ids})
                    db.delete(station)
        else:
            for index in range(1,count+1):
                if index not in existing: db.add(Station(study_id=study.id,scenario=scenario,station_index=index,label=f"F{index}"))
        if scenario=="current": study.current_station_count=count
        else: study.future_station_count=count
        study.status="draft"; study.version+=1; study.updated_by=actor.user.id
        record_revision(db,study,actor,f"Postos do cenário {scenario} ajustados para {count}",request.state.request_id,"station.resize",before)
        out=study_payload(db,study); db.commit(); response.headers["ETag"]=study_etag(study); return out
    except Exception: db.rollback(); raise


@app.post("/api/v1/studies/{study_id}/optimize")
def optimize(study_id: str,payload: OptimizeRequest,actor: Actor=Depends(require_role("engineer","admin")),db: Session=Depends(get_db)):
    study=load_study(db,study_id,actor)
    if payload.inputVersion!=study.version: raise HTTPException(412,detail={"code":"VERSION_CONFLICT","currentVersion":study.version})
    from .services.optimizer import optimize_study
    return optimize_study(db,study,payload)


@app.post("/api/v1/studies/{study_id}/optimization-proposals/apply")
def apply_proposal(study_id: str,proposal: dict,request: Request,response: Response,
                   if_match: str | None=Header(default=None,alias="If-Match"),actor: Actor=Depends(require_role("engineer","admin")),db: Session=Depends(get_db)):
    study=load_study(db,study_id,actor,lock=True); require_version(study,if_match)
    if int(proposal.get("inputVersion",-1))!=study.version: raise HTTPException(412,"A proposta está baseada em outra revisão")
    before=study_payload(db,study)
    try:
        if proposal.get("canApply") is not True:
            raise HTTPException(422,"A proposta não passou pelas verificações de aplicação")
        assignments=proposal.get("assignments")
        if not assignments: raise HTTPException(422,"Proposta sem alocações")
        target_count=int(proposal.get("targetStationCount",study.future_station_count))
        if target_count<1 or target_count>100: raise HTTPException(422,"Quantidade de postos futura inválida")
        element_ids={e.id for e in study.elements}
        assignment_ids=[str(row.get("elementId")) for row in assignments]
        if len(assignment_ids)!=len(element_ids) or set(assignment_ids)!=element_ids:
            raise HTTPException(422,"A proposta deve alocar cada elemento exatamente uma vez")
        if any(int(row.get("stationIndex",0))<1 or int(row.get("stationIndex",0))>target_count for row in assignments):
            raise HTTPException(422,"A proposta contém posto fora da faixa futura")
        proposed={str(row["elementId"]):row for row in assignments}
        for edge in study.precedences:
            predecessor=proposed[edge.predecessor_id]; successor=proposed[edge.successor_id]
            pred_station=int(predecessor["stationIndex"]); succ_station=int(successor["stationIndex"])
            if pred_station>succ_station or (pred_station==succ_station and int(predecessor.get("sequence",0))>=int(successor.get("sequence",0))):
                raise HTTPException(422,"A proposta viola a precedência técnica declarada")
        equipment={x.id:x for x in db.query(EquipmentResource).filter_by(study_id=study.id).all()}
        fixed_stations={s.station_index:s for s in study.stations if s.scenario=="future" and s.fixed_equipment_id}
        for element in study.elements:
            if element.ergonomic_zone=="red" and not valid_exception(element.ergonomic_exception):
                raise HTTPException(422,detail={"code":"ERGONOMIC_RESTRICTION","elementId":element.id})
            if element.fixed_equipment_id:
                resource=equipment.get(element.fixed_equipment_id)
                fixed=resource.future_station_index if resource else None
                if fixed is None:
                    fixed=next((index for index,station in fixed_stations.items() if station.fixed_equipment_id==element.fixed_equipment_id),None)
                if fixed is not None and int(proposed[element.id]["stationIndex"])!=fixed:
                    raise HTTPException(422,"A proposta viola o posto reservado ao equipamento fixo")
        projected_loads=[Decimal(0) for _ in range(target_count)]
        by_element={e.id:e for e in study.elements}
        for element_id,row in proposed.items():
            element=by_element[element_id]; idx=int(row["stationIndex"])-1
            projected_loads[idx]+=Decimal(str(element.future_va_seconds))+Decimal(str(element.future_nva_seconds))
        projected_cycle=max(projected_loads,default=Decimal(0))
        if proposal.get("objective",{}).get("cycleSeconds") is None or Decimal(str(proposal["objective"]["cycleSeconds"]))!=projected_cycle:
            raise HTTPException(422,"O ciclo informado na proposta não corresponde às cargas recalculadas")
        if proposal.get("checks",{}).get("takt")=="pass":
            effective_demand=Decimal(str(study.demand_per_shift))*(Decimal(1)+Decimal(str(study.seasonality_pct))/Decimal(100))
            takt=Decimal(str(study.shift_seconds))*Decimal(str(study.oee_pct))/Decimal(100)/effective_demand if effective_demand>0 else None
            if takt is None or projected_cycle>takt: raise HTTPException(422,"A proposta informa atendimento ao Takt sem atingir o limite")
        # Build new stations first, then move assignments, then delete empty
        # surplus stations. This avoids rejecting valid station reductions due
        # to assignments that the proposal itself is about to move.
        existing={s.station_index for s in study.stations if s.scenario=="future"}
        for index in range(1,target_count+1):
            if index not in existing: db.add(Station(study_id=study.id,scenario="future",station_index=index,label=f"F{index}"))
        db.flush(); study.future_station_count=target_count
        for row in assignments:
            element_id=str(row["elementId"]); index=int(row["stationIndex"])
            station=db.query(Station).filter_by(study_id=study.id,scenario="future",station_index=index).first()
            if not station: raise HTTPException(422,"Posto futuro inexistente na proposta")
            a=db.query(ElementAssignment).filter_by(study_id=study.id,element_id=element_id,scenario="future").one(); a.station_id=station.id; a.sequence_order=int(row.get("sequence",1))
        db.flush()
        for station in list(study.stations):
            if station.scenario=="future" and station.station_index>target_count:
                occupied=db.query(ElementAssignment).filter_by(study_id=study.id,scenario="future",station_id=station.id).first()
                if occupied: raise HTTPException(409,"O posto excedente continua ocupado após aplicar as alocações")
                db.delete(station)
        pairs=[(p.predecessor_id,p.successor_id) for p in study.precedences]; validate_dag({e.id for e in study.elements},pairs)
        study.status="draft"; study.version+=1; study.updated_by=actor.user.id
        record_revision(db,study,actor,"Proposta de balanceamento aplicada",request.state.request_id,"optimizer.apply",before)
        result=study_payload(db,study); db.commit(); response.headers["ETag"]=study_etag(study); return result
    except Exception: db.rollback(); raise


@app.post("/api/v1/studies/import-legacy", status_code=201)
def import_legacy(payload: dict,response: Response,request: Request,actor: Actor=Depends(require_role("engineer","admin")),db: Session=Depends(get_db)):
    data=payload
    version=data.get("schemaVersion",data.get("version"))
    if version not in (1,2): raise HTTPException(422,"Somente os arquivos legados v1 e v2 são aceitos")
    if len(json.dumps(data))>5*1024*1024: raise HTTPException(413,"Arquivo excede 5 MiB")
    from .services.legacy import legacy_study
    try:
        parsed = legacy_study(data,version)
    except (KeyError, TypeError, ArithmeticError, ValueError) as exc:
        raise HTTPException(422, "Arquivo legado inválido: " + str(exc)[:300]) from exc
    try:
        source_hash=hashlib.sha256(json.dumps(data,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
        study=create_study_rows(db,actor,parsed,request.state.request_id,"Importação de arquivo legado")
        db.add(AuditLog(organization_id=study.organization_id,study_id=study.id,actor_user_id=actor.user.id,action="study.import",entity_type="study",entity_id=study.id,after_data={"schemaVersion":version,"sourceSha256":source_hash,"areaCount":len(parsed.areas),"elementCount":len(parsed.elements)},request_id=request.state.request_id))
        db.commit(); response.headers["ETag"]=study_etag(study)
        return {"study":study_payload(db,study),"migration":{"sourceVersion":version,"areaCount":len(parsed.areas),"elementCount":len(parsed.elements),"sourceSha256":source_hash,"precedencesCreated":len(parsed.precedences)}}
    except Exception: db.rollback(); raise


@app.get("/api/v1/studies/{study_id}/revisions")
def revisions(study_id: str,actor: Actor=Depends(actor_context),db: Session=Depends(get_db)):
    study=load_study(db,study_id,actor)
    return [{"revision":r.revision_number,"version":r.source_version,"summary":r.change_summary,"createdBy":r.created_by,"createdAt":r.created_at} for r in db.query(Revision).filter_by(study_id=study.id).order_by(Revision.revision_number.desc()).all()]


@app.get("/api/v1/studies/{study_id}/revisions/{revision_number}")
def revision_detail(study_id: str,revision_number: int,actor: Actor=Depends(actor_context),db: Session=Depends(get_db)):
    study=load_study(db,study_id,actor); rev=db.query(Revision).filter_by(study_id=study.id,revision_number=revision_number).first()
    if not rev: raise HTTPException(404,"Revisão não encontrada")
    return rev.snapshot


@app.post("/api/v1/studies/{study_id}/approve")
def approve(study_id: str,payload: dict,request: Request,response: Response,if_match: str | None=Header(default=None,alias="If-Match"),
            actor: Actor=Depends(require_role("admin")),db: Session=Depends(get_db)):
    study=load_study(db,study_id,actor,lock=True); require_version(study,if_match)
    if not payload.get("comment") or len(payload["comment"])>1000: raise HTTPException(422,"Comentário de aprovação obrigatório, até 1000 caracteres")
    before={"status":study.status}; study.status="approved"; study.version+=1; study.updated_by=actor.user.id
    record_revision(db,study,actor,"Estudo aprovado: "+payload["comment"],request.state.request_id,"study.approve",before)
    db.commit(); response.headers["ETag"]=study_etag(study); return {"id":study.id,"status":study.status,"version":study.version}


@app.get("/api/v1/studies/{study_id}/audit")
def audit(study_id: str,actor: Actor=Depends(actor_context),db: Session=Depends(get_db)):
    study=load_study(db,study_id,actor)
    return [{"id":a.id,"action":a.action,"entityType":a.entity_type,"actorUserId":a.actor_user_id,"before":a.before_data,"after":a.after_data,"requestId":a.request_id,"occurredAt":a.occurred_at} for a in db.query(AuditLog).filter_by(study_id=study.id).order_by(AuditLog.occurred_at.desc()).limit(200).all()]


@app.get("/api/v1/session")
def session_details(actor: Actor = Depends(actor_context)):
    return {"userId": actor.user.id, "organizationId": actor.organization_id,
            "displayName": actor.user.display_name, "role": actor.role}


@app.put("/api/v1/studies/{study_id}")
def replace_study(study_id: str, payload: CreateStudy, request: Request, response: Response,
                  if_match: str | None = Header(None, alias="If-Match"),
                  key: UUID | None = Header(None, alias="Idempotency-Key"),
                  actor: Actor = Depends(require_role("engineer", "admin")), db: Session = Depends(get_db)):
    study = load_study(db, study_id, actor, lock=True)
    if payload.studyId and str(payload.studyId) != study_id:
        raise HTTPException(422, "Identidade do estudo divergente")
    if key and db.query(MutationReceipt).filter_by(study_id=study.id, client_mutation_id=str(key)).first():
        response.headers["ETag"] = study_etag(study)
        return study_payload(db, study)
    if payload.stations.future>max(12,study.future_station_count) or payload.stations.current>20:
        raise HTTPException(422,"Quantidade de postos fora da faixa")
    require_version(study, if_match)
    before = study_payload(db, study)
    old = {e.id: e.ergonomic_exception for e in study.elements}
    previous_station = {e["id"]: e["future"]["stationIndex"] for e in before["elements"]}
    assigned = {str(e.id): e.future.stationIndex for e in payload.elements}
    moved = {identifier for identifier, pos in assigned.items() if identifier in previous_station and previous_station[identifier] != pos}
    for edge in payload.precedences:
        a,b = str(edge.predecessorId), str(edge.successorId)
        if (a in moved or b in moved) and assigned.get(a, 0)>assigned.get(b, 0):
            raise HTTPException(422,"Movimento viola a precedência técnica")
    resources = {str(e.id): e for e in payload.equipment}
    for e in payload.elements:
        identifier = str(e.id)
        if e.fixedEquipmentId and resources[str(e.fixedEquipmentId)].futureStationIndex not in (None,e.future.stationIndex):
            raise HTTPException(422, "Movimento incompatível com equipamento fixo")
        if identifier in moved and e.ergonomicZone == "red" and not valid_exception(old[identifier]):
            raise HTTPException(422, "Movimento em zona vermelha exige autorização vigente")
        if e.validationStatus == "validated" and not e.evidenceRef:
            raise HTTPException(422,"Validação exige referência de evidência")
    try:
        for model in (Precedence, ElementAssignment, WorkElement, Station, EquipmentResource, Area):
            db.query(model).filter_by(study_id=study.id).delete(synchronize_session="fetch")
        db.flush()
        p = payload.parameters
        mapping = {"name":"name","productFamily":"product_family","shiftSeconds":"shift_seconds","demandPerShift":"demand_per_shift",
                   "productiveDaysPerMonth":"productive_days_per_month","baselineUnitsPerDay":"baseline_units_per_day",
                   "laborCostPerShiftCurrent":"labor_cost_current","laborCostPerShiftFuture":"labor_cost_future",
                   "oeePct":"oee_pct","seasonalityPct":"seasonality_pct","capex":"capex"}
        for field, attr in mapping.items():
            setattr(study, attr, getattr(p,field))
        study.workspace_metadata = payload.workspace.model_dump(mode="json")
        study.current_station_count, study.future_station_count = payload.stations.current, payload.stations.future
        write_graph(db, study, actor, payload)
        for item in db.query(WorkElement).filter_by(study_id=study.id):
            if old.get(item.id): item.ergonomic_exception = old[item.id]
            if item.validation_status == "validated":
                item.validated_by, item.validated_at = actor.user.id, datetime.now(timezone.utc)
        study.status, study.updated_by, study.version = "draft", actor.user.id, study.version+1
        record_revision(db,study,actor,"Edição do estudo",request.state.request_id,"study.replace",before,str(key) if key else None)
        result = study_payload(db,study)
        if key: db.add(MutationReceipt(study_id=study.id,client_mutation_id=str(key),response=result))
        db.commit()
        response.headers["ETag"] = study_etag(study)
        return result
    except Exception:
        db.rollback()
        raise


@app.put("/api/v1/studies/{study_id}/elements/{element_id}/ergonomic-exception")
def ergonomic_exception(study_id: str, element_id: str, payload: dict, request: Request, response: Response,
                        if_match: str | None=Header(None,alias="If-Match"),
                        actor: Actor=Depends(require_role("admin")), db: Session=Depends(get_db)):
    study=load_study(db,study_id,actor,lock=True)
    require_version(study,if_match)
    element=next((e for e in study.elements if e.id==element_id),None)
    if not element: raise HTTPException(404,"Elemento não encontrado")
    data={"reason":str(payload.get("reason","")).strip()[:300],"expiresAt":str(payload.get("expiresAt","")),"approvedBy":actor.user.display_name}
    if not valid_exception(data): raise HTTPException(422,"Informe o motivo e uma validade futura com fuso horário")
    before=study_payload(db,study)
    element.ergonomic_exception=data
    study.version+=1
    study.status="draft"
    study.updated_by=actor.user.id
    record_revision(db,study,actor,"Exceção ergonômica autorizada",request.state.request_id,"ergonomic.approve",before)
    db.commit()
    response.headers["ETag"]=study_etag(study)
    return study_payload(db,study)


@app.delete("/api/v1/studies/{study_id}",status_code=204)
def archive_study(study_id:str,request:Request,if_match:str|None=Header(None,alias="If-Match"),
                  actor:Actor=Depends(require_role("engineer","admin")),db:Session=Depends(get_db)):
    study=load_study(db,study_id,actor)
    if study.status=="archived": return Response(status_code=204)
    study=load_study(db,study_id,actor,lock=True)
    require_version(study,if_match)
    before=study_payload(db,study)
    study.status,study.updated_by,study.version="archived",actor.user.id,study.version+1
    record_revision(db,study,actor,"Estudo removido do portfólio",request.state.request_id,"study.archive",before)
    db.commit()
    return Response(status_code=204)
