import Decimal from 'decimal.js';
import type { Study, WorkElement } from './types';

export type EdgeAssignment = { elementId: string; stationIndex: number };
const taskTime = (element: WorkElement) => Number(element.future.vaSeconds) + Number(element.future.nvaSeconds);

function topology(study: Study) {
  const ids = study.elements.map(e => e.id);
  const outgoing = new Map(ids.map(id => [id, [] as string[]]));
  const incoming = new Map(ids.map(id => [id, [] as string[]]));
  for (const edge of study.precedences) {
    if (!outgoing.has(edge.predecessorId) || !incoming.has(edge.successorId) || edge.predecessorId === edge.successorId) throw new Error('A precedência referencia um elemento inválido.');
    outgoing.get(edge.predecessorId)!.push(edge.successorId);
    incoming.get(edge.successorId)!.push(edge.predecessorId);
  }
  const indegree = new Map(ids.map(id => [id, incoming.get(id)!.length]));
  const queue = ids.filter(id => indegree.get(id) === 0);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!; order.push(id);
    for (const next of outgoing.get(id)!) {
      indegree.set(next, indegree.get(next)! - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }
  if (order.length !== ids.length) throw new Error('O grafo de precedência possui ciclo. Corrija as relações antes de balancear.');
  return { order, outgoing, incoming };
}

function weights(study: Study, outgoing: Map<string, string[]>) {
  const byId = new Map(study.elements.map(e => [e.id, e]));
  const memo = new Map<string, number>();
  const weight = (id: string): number => {
    if (memo.has(id)) return memo.get(id)!;
    const descendants = new Set<string>();
    const stack = [...(outgoing.get(id) || [])];
    while (stack.length) { const next = stack.pop()!; if (descendants.has(next)) continue; descendants.add(next); stack.push(...(outgoing.get(next) || [])); }
    const value = taskTime(byId.get(id)!) + [...descendants].reduce((sum, child) => sum + taskTime(byId.get(child)!), 0);
    memo.set(id, value); return value;
  };
  return weight;
}

export function rebalanceRPW(study: Study): EdgeAssignment[] {
  const { order, outgoing, incoming } = topology(study);
  const weight = weights(study, outgoing);
  const rank = new Map(order.map((id, index) => [id, index]));
  const pending = new Set(order); const stationOf = new Map<string, number>();
  const loads = Array(study.stations.future).fill(0);
  const byId = new Map(study.elements.map(e => [e.id, e]));
  const fixedStation = (e: WorkElement) => {
    if (!e.fixedEquipmentId) return null;
    const resource = study.equipment.find(x => x.id === e.fixedEquipmentId);
    return resource?.futureStationIndex ?? null;
  };
  const latest = new Map<string,number>();
  for(const id of [...order].reverse()){
    latest.set(id,Math.min(fixedStation(byId.get(id)!)??loads.length,...outgoing.get(id)!.map(next=>latest.get(next)!)));
  }
  while (pending.size) {
    const ready = [...pending].filter(id => (incoming.get(id) || []).every(before => stationOf.has(before)));
    if (!ready.length) throw new Error('Não foi possível ordenar as tarefas conforme as precedências.');
    ready.sort((a,b) => weight(b)-weight(a) || rank.get(a)!-rank.get(b)!);
    const id = ready[0]; const element = byId.get(id)!; const predMin = Math.max(1, ...(incoming.get(id) || []).map(x => stationOf.get(x)!));
    const fixed = fixedStation(element);
    const candidates = fixed == null ? loads.map((_,i)=>i+1).filter(s=>s>=predMin) : [fixed];
    const station = candidates.filter(s=>s>=predMin&&s<=latest.get(id)!&&s<=loads.length).sort((a,b)=>loads[a-1]-loads[b-1]||a-b)[0];
    if (!station) throw new Error(`As precedências ou o equipamento fixo de “${element.name}” não cabem nos postos configurados.`);
    stationOf.set(id,station); loads[station-1]+=taskTime(element); pending.delete(id);
  }
  return order.map(elementId=>({elementId,stationIndex:stationOf.get(elementId)!}));
}

function assignmentIsValid(study: Study, assignment: Map<string, number>) {
  for (const edge of study.precedences) if (assignment.get(edge.predecessorId)! > assignment.get(edge.successorId)!) return false;
  for (const e of study.elements) {
    if (assignment.get(e.id)! < 1 || assignment.get(e.id)! > study.stations.future) return false;
    if (e.fixedEquipmentId) {
      const fixed=study.equipment.find(x=>x.id===e.fixedEquipmentId)?.futureStationIndex;
      if (fixed != null && assignment.get(e.id)! !== fixed) return false;
    }
  }
  return true;
}

function score(study: Study, assignment: Map<string, number>) {
  const loads=Array(study.stations.future).fill(0);
  for(const e of study.elements) loads[assignment.get(e.id)!-1]+=taskTime(e);
  const cycle=Math.max(0,...loads); const si=Math.sqrt(loads.reduce((sum,value)=>sum+(cycle-value)**2,0));
  return {cycle,si,objective:12*cycle+si,loads};
}

export function optimizeSimulatedAnnealing(study: Study, iterations=900, seed=study.version): EdgeAssignment[] {
  const initial=rebalanceRPW(study); let current=new Map(initial.map(x=>[x.elementId,x.stationIndex])); let best=new Map(current); let bestScore=score(study,best).objective; let currentScore=bestScore;
  const existing=new Map(study.elements.map(e=>[e.id,e.future.stationIndex]));
  if(assignmentIsValid(study,existing)&&score(study,existing).objective<bestScore){best=existing;bestScore=score(study,best).objective;}
  let rng=seed>>>0; const random=()=>{rng=(rng*1664525+1013904223)>>>0;return rng/4294967296;};
  const movable=study.elements.filter(e=>!e.fixedEquipmentId||study.equipment.find(x=>x.id===e.fixedEquipmentId)?.futureStationIndex==null);
  if(movable.length<1||study.stations.future<2)return initial;
  for(let i=0;i<iterations;i++){
    const element=movable[Math.floor(random()*movable.length)]; const target=1+Math.floor(random()*study.stations.future); const previous=current.get(element.id)!; if(target===previous)continue;
    current.set(element.id,target);
    if(!assignmentIsValid(study,current)){current.set(element.id,previous);continue;}
    const candidate=score(study,current).objective; const temperature=45*Math.pow(.994,i);
    if(candidate<currentScore||random()<Math.exp((currentScore-candidate)/Math.max(temperature,1e-9))){currentScore=candidate;if(candidate<bestScore){bestScore=candidate;best=new Map(current);}}
    else current.set(element.id,previous);
  }
  return study.elements.map(e=>({elementId:e.id,stationIndex:best.get(e.id)!}));
}

function gaussian(random:()=>number) { const u=Math.max(Number.EPSILON,random()),v=Math.max(Number.EPSILON,random()); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); }
export function runMonteCarlo(study: Study, trials=600, cv=.08, seed=study.version) {
  const count=study.stations.future; const takt=Number(study.parameters.shiftSeconds)*(Number(study.parameters.oeePct??100)/100)/(Number(study.parameters.demandPerShift)*(1+Number(study.parameters.seasonalityPct??0)/100));
  if(!Number.isFinite(takt)||takt<=0) return {riskPct:null as number|null,p95Seconds:null as number|null,trials};
  let rng=seed>>>0; const random=()=>{rng=(rng*1664525+1013904223)>>>0;return rng/4294967296;}; const cycles:number[]=[];
  for(let t=0;t<trials;t++) { const loads=Array(count).fill(0); for(const e of study.elements) {const station=e.future.stationIndex-1;if(station<0||station>=count)continue;const va=Number(e.future.vaSeconds),nva=Number(e.future.nvaSeconds);loads[station]+=Math.max(0,va+gaussian(random)*va*cv*.65)+Math.max(0,nva+gaussian(random)*nva*cv*1.35);}cycles.push(Math.max(0,...loads)); }
  cycles.sort((a,b)=>a-b); const over=cycles.filter(x=>x>takt).length;
  return {riskPct:over/trials*100,p95Seconds:cycles[Math.min(cycles.length-1,Math.ceil(.95*cycles.length)-1)],trials};
}

export function objectiveFor(study:Study, assignments:EdgeAssignment[]) { const assignment=new Map(assignments.map(x=>[x.elementId,x.stationIndex])); const value=score(study,assignment); return {cycleSeconds:new Decimal(value.cycle),smoothnessIndexSeconds:new Decimal(value.si),objective:new Decimal(value.objective)}; }
