from decimal import Decimal, ROUND_FLOOR
from ortools.sat.python import cp_model
from fastapi import HTTPException
from sqlalchemy.orm import Session
from ..db.models import ElementAssignment, EquipmentResource, Station
from ..domain.models import OptimizeRequest, validate_dag, valid_exception


def optimize_study(db: Session, study, request: OptimizeRequest) -> dict:
    elements = list(study.elements)
    if not elements:
        raise HTTPException(422, {"code":"EMPTY_STUDY", "detail":"Adicione elementos antes de balancear."})
    by_id = {e.id:e for e in elements}
    edges = [(p.predecessor_id,p.successor_id) for p in study.precedences]
    try: topo = validate_dag(set(by_id), edges)
    except ValueError as exc: raise HTTPException(422, {"code":"PRECEDENCE_CYCLE", "detail":str(exc)}) from exc
    for e in elements:
        if e.ergonomic_zone == "red" and not valid_exception(e.ergonomic_exception):
            raise HTTPException(422, {"code":"ERGONOMIC_RESTRICTION", "elementId":e.id,
                "detail":"Elemento em zona ergonômica vermelha exige exceção aprovada com motivo e validade."})
    assignments={(a.element_id,a.scenario):a for a in db.query(ElementAssignment).filter_by(study_id=study.id).all()}
    equip={x.id:x for x in db.query(EquipmentResource).filter_by(study_id=study.id).all()}
    baseline={}
    for e in elements:
        a=assignments.get((e.id,"future"))
        baseline[e.id]=next((s.station_index for s in study.stations if a and s.id==a.station_id),1)
    raw_weights=[(Decimal(str(e.future_va_seconds))+Decimal(str(e.future_nva_seconds)))*1000 for e in elements]
    if any(x != x.to_integral_value() for x in raw_weights):
        raise HTTPException(422,{"code":"TIME_PRECISION","detail":"O solver exige tempos com até 3 casas decimais."})
    weights=[int(x) for x in raw_weights]
    demand = Decimal(str(study.demand_per_shift)) * (1 + Decimal(str(study.seasonality_pct)) / 100)
    takt = Decimal(str(study.shift_seconds)) * Decimal(str(study.oee_pct)) / 100 / demand if demand else None
    threshold=request.cycleTargetSeconds or (takt if request.meetTakt else None)
    max_count=max(request.targetStationCount, request.maxStationCount)
    start_count=request.targetStationCount
    candidates=range(start_count,max_count+1) if request.meetTakt else [start_count]
    result=None; total_budget=max(1,request.solverTimeLimitSeconds); per_candidate=max(.2,total_budget/max(1,len(candidates)))
    for count in candidates:
        model=cp_model.CpModel(); n=len(elements)
        choices=[[model.new_bool_var(f"x_{i}_{j}") for j in range(count)] for i in range(n)]
        for i in range(n): model.add_exactly_one(choices[i])
        element_index={e.id:i for i,e in enumerate(elements)}
        for predecessor,successor in edges:
            a=element_index[predecessor]; b=element_index[successor]
            model.add(sum((j+1)*choices[a][j] for j in range(count)) <= sum((j+1)*choices[b][j] for j in range(count)))
        station_rows={s.station_index:s for s in study.stations if s.scenario=="future"}
        for i,e in enumerate(elements):
            fixed=None
            resource=equip.get(e.fixed_equipment_id) if e.fixed_equipment_id else None
            if resource:
                fixed=resource.future_station_index
            if fixed is None:
                fixed_station=next((s for s in station_rows.values() if s.fixed_equipment_id==e.fixed_equipment_id and e.fixed_equipment_id),None)
                fixed=fixed_station.station_index if fixed_station else None
            if fixed is not None:
                if fixed < 1 or fixed > count:
                    # A fixed resource outside the candidate station count makes
                    # this candidate infeasible; silently skipping this would
                    # violate the physical constraint.
                    model.add_bool_or([])
                else:
                    model.add(choices[i][fixed-1] == 1)
        max_possible=sum(weights)
        max_load=model.new_int_var(0,max_possible,"max_cycle_ms")
        for j in range(count):
            load=sum(weights[i]*choices[i][j] for i in range(n))
            model.add(load <= max_load)
        if threshold is not None:
            max_allowed=int((threshold*1000).to_integral_value(rounding=ROUND_FLOOR))
            model.add(max_load <= max_allowed)
        moves=sum(choices[i][j] * int(request.moveFromBaseline) for i,e in enumerate(elements) for j in range(count) if j+1 != baseline[e.id])
        yellow_loads=[]
        for j in range(count):
            y=model.new_int_var(0,n,f"yellow_{j}")
            model.add(y == sum(choices[i][j] for i,e in enumerate(elements) if e.ergonomic_zone=="yellow"))
            yellow_loads.append(y)
        max_yellow=model.new_int_var(0,n,"max_yellow_per_station")
        for y in yellow_loads: model.add(y<=max_yellow)
        # Lexicographic objective: minimize cycle first, then distribute yellow-zone work, then avoid unnecessary moves.
        secondary_bound=(n*max(1,request.yellowErgonomicZone)+n*max(1,request.moveFromBaseline)+1)
        model.minimize(max_load*secondary_bound + max_yellow*max(1,request.yellowErgonomicZone) + moves)
        solver=cp_model.CpSolver(); solver.parameters.max_time_in_seconds=per_candidate
        solver.parameters.num_search_workers=1; solver.parameters.random_seed=0; solver.parameters.log_search_progress=False
        status=solver.solve(model)
        if status in (cp_model.OPTIMAL,cp_model.FEASIBLE):
            chosen=[]
            for i,e in enumerate(elements):
                station=next(j+1 for j in range(count) if solver.value(choices[i][j]))
                chosen.append({"elementId":e.id,"stationIndex":station,"sequence":topo.index(e.id)+1})
            cycle=Decimal(solver.value(max_load))/Decimal(1000)
            result={"status":"optimal" if status==cp_model.OPTIMAL else "feasible_timeout","inputVersion":study.version,
                    "objective":{"cycleSeconds":format(cycle,"f"),"targetMet":(takt is not None and cycle<=takt),
                                 "optimalityGap":format(Decimal(str(solver.best_objective_bound-solver.objective_value))/Decimal(max(1,solver.objective_value)),".4f") if status==cp_model.FEASIBLE else "0"},
                    "targetStationCount":count,"assignments":chosen,
                    "checks":{"precedence":"pass","fixedEquipment":"pass","ergonomics":"pass","takt":"pass" if takt is not None and cycle<=takt else ("not_evaluated" if takt is None else "fail")},
                    "warnings":(["Solução viável encontrada dentro do limite; otimalidade não comprovada."] if status==cp_model.FEASIBLE else []),
                    "canApply":True}
            break
    if not result:
        return {"status":"infeasible","inputVersion":study.version,"objective":None,"assignments":[],
                "checks":{"precedence":"pass","fixedEquipment":"review","ergonomics":"pass","takt":"fail" if threshold else "not_evaluated"},
                "conflicts":["Não foi encontrada alocação viável com o número de postos e limite de ciclo solicitados."],"canApply":False}
    return result
