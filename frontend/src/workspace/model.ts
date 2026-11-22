import { hasCycle } from '../domain/calculations';
import type { Study } from '../domain/types';

export type Edge = [string,string];
export interface Log { ts:string; actor:string; action:string; detail:string }
export interface Resource { id:string; name:string; currentStationIndex:number|null; futureStationIndex:number|null }
export interface Task {
  id:string; area:string; name:string; currentStation:number; futureStation:number;
  vaCurrent:number; nvaCurrent:number; vaFuture:number; nvaFuture:number;
  fixedStation:number|null; fixedEquipmentId:string|null; ergonomicZone:'green'|'yellow'|'red';
  validationStatus:'hypothesis'|'validated'; evidenceRef:string|null;
  ergonomicException?:{reason:string;approvedBy:string;expiresAt:string}|null;
}
export interface Sheet {
  id:string; name:string; product:string; shiftSeconds:number; days:number; demand:number; dailyVolume:number;
  laborCurrent:number; laborFuture:number; oee:number; seasonalityPct:number; capex:number; author:string; revision:string;
  stations:{current:number;future:number}; areas:{id:string;name:string;costCurrent:number;costFuture:number}[];
  elements:Task[]; equipment:Resource[]; precedences:Edge[]; auditLog:Log[]; cv:number;
}
export interface Portfolio { activeStudyId:string; studies:Sheet[] }
const uuidPattern=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
export const uid=()=>crypto.randomUUID();
function identifier(value:unknown,fresh:boolean){return !fresh&&typeof value==='string'&&uuidPattern.test(value)?value:uid()}
function number(value:unknown,name:string,min=0,max=999999999,places=3):number {
  if(typeof value!=='number'&&typeof value!=='string'||String(value).trim()==='')throw Error('Informe '+name);
  const n=Number(value);
  if(!Number.isFinite(n)||n<min||n>max||Math.abs(n-Number(n.toFixed(places)))>1e-9)throw Error(name+' fora da faixa ou precisão permitidas.');
  return n;
}
function label(value:unknown,fallback:string,max:number){const result=String(value??fallback).trim();if(!result||result.length>max)throw Error('Nome ou descrição inválida: '+fallback);return result}
function mapUnique(map:Map<string,string>,key:unknown,value:string){if(key==null)return;const k=String(key);if(map.has(k))throw Error('Identificador duplicado: '+k);map.set(k,value)}
function array(value:any,max:number,name:string):any[]{if(!Array.isArray(value)||value.length>max)throw Error('Limite de '+max+' '+name+' por estudo.');return value}
export function normalize(raw:any,fresh=false):Sheet {
  if(!raw||typeof raw!=='object'||!Array.isArray(raw.areas)||!Array.isArray(raw.elements))throw Error('Estudo sem áreas ou elementos de trabalho.');
  const p={...raw,...raw.parameters,...raw.project};
  const stationInput=raw.stations??p.stations??{current:1,future:1};
  const count=(v:any)=>Array.isArray(v)?v.length:v;
  const stations={current:number(count(stationInput.current),'Postos atuais',1,20,0),future:number(count(stationInput.future),'Postos futuros',1,20,0)};
  const station=(value:any,scenario:'current'|'future')=>number(value,'Posto',1,stations[scenario],0);
  const areaIds=new Map<string,string>(), areaNames=new Set<string>(), elementIds=new Map<string,string>(), equipIds=new Map<string,string>();
  const areas=array(raw.areas,100,'áreas').map((a,i)=>{
    const name=label(a.name,'Área '+(i+1),120),id=identifier(a.id,fresh);
    if(areaNames.has(name))throw Error('Duas áreas têm o mesmo nome: '+name);
    areaNames.add(name);mapUnique(areaIds,a.id,name);
    return {id,name,costCurrent:number(a.costCurrent??a.operationalCostPerPieceCurrent??0,'Custo atual',0,999999999,2),costFuture:number(a.costFuture??a.operationalCostPerPieceFuture??0,'Custo futuro',0,999999999,2)};
  });
  const equipment:Resource[]=array(raw.equipment??[],100,'equipamentos').map(r=>{
    const id=identifier(r.id,fresh);mapUnique(equipIds,r.id,id);
    return {id,name:label(r.name,'Equipamento',160),currentStationIndex:r.currentStationIndex==null?null:station(r.currentStationIndex,'current'),futureStationIndex:r.futureStationIndex==null?null:station(r.futureStationIndex,'future')};
  });
  const elements:Task[]=array(raw.elements,500,'elementos').map((e,i)=>{
    const id=identifier(e.id,fresh),area=e.area??areaIds.get(String(e.areaId));mapUnique(elementIds,e.id,id);
    if(!areaNames.has(area))throw Error('Área desconhecida no elemento '+(i+1));
    const zone=e.ergonomicZone??'green';if(!['red','yellow','green'].includes(zone))throw Error('Zona ergonômica inválida');
    const fixed=e.fixedEquipmentId?equipIds.get(e.fixedEquipmentId):null;
    if(e.fixedEquipmentId&&!fixed)throw Error('Equipamento não cadastrado');
    const resource=equipment.find(r=>r.id===fixed);
    const fixedStation=resource?.futureStationIndex??(e.fixedStation==null?null:station(e.fixedStation,'future'));
    const exception=e.ergonomicException??null;
    return {id,area,name:label(e.name,'Elemento '+(i+1),200),currentStation:station(e.currentStation??e.current?.stationIndex??1,'current'),futureStation:station(e.futureStation??e.future?.stationIndex??1,'future'),
      vaCurrent:number(e.vaCurrent??e.current?.vaSeconds??0,'VA atual'),nvaCurrent:number(e.nvaCurrent??e.current?.nvaSeconds??0,'NVA atual'),
      vaFuture:number(e.vaFuture??e.future?.vaSeconds??0,'VA futuro'),nvaFuture:number(e.nvaFuture??e.future?.nvaSeconds??0,'NVA futuro'),
      fixedStation,fixedEquipmentId:fixed??null,ergonomicZone:zone,validationStatus:e.validationStatus==='validated'&&e.evidenceRef?'validated':'hypothesis',evidenceRef:e.evidenceRef?String(e.evidenceRef).slice(0,500):null,
      ergonomicException:exception?{reason:String(exception.reason??'').slice(0,300),approvedBy:String(exception.approvedBy??'').slice(0,160),expiresAt:String(exception.expiresAt??'').slice(0,40)}:null};
  });
  const precedences:Edge[]=array(raw.precedences??[],5000,'precedências').map(e=>{
    const a=elementIds.get(String(e[0]??e.predecessorId)),b=elementIds.get(String(e[1]??e.successorId));
    if(!a||!b)throw Error('Uma precedência aponta para um elemento ausente.');return [a,b];
  });
  validateGraph(elements,precedences);
  const name=label(p.name,'Estudo industrial',160);
  return {id:identifier(raw.id,fresh),name,product:label(p.product??p.productFamily,'Produto',120),shiftSeconds:number(p.shiftSeconds??27000,'Tempo de turno',0.001),days:number(p.days??p.productiveDaysPerMonth??22,'Dias',0,31,0),
    demand:number(p.demand??p.demandPerShift??0,'Demanda'),dailyVolume:number(p.dailyVolume??p.baselineUnitsPerDay??0,'Produção base'),
    laborCurrent:number(p.laborCurrent??p.laborCostPerShiftCurrent??0,'Equipe atual',0,999999999,2),laborFuture:number(p.laborFuture??p.laborCostPerShiftFuture??0,'Equipe futura',0,999999999,2),
    oee:number(p.oee??p.oeePct??100,'OEE',10,100,2),capex:number(p.capex??0,'CAPEX',0,999999999,2),seasonalityPct:number(p.seasonalityPct??0,'Sazonalidade',-30,50,2),author:String(p.author??'Engenharia').slice(0,80),revision:String(p.revision??'Rev. 1').slice(0,32),
    cv:number(raw.cv??.08,'Coeficiente de variação',0,10,6),stations,areas,equipment,elements,precedences,
    auditLog:array(raw.auditLog??[],1000,'eventos locais').map(l=>({ts:String(l.ts).slice(0,60),actor:String(l.actor).slice(0,80),action:String(l.action).slice(0,130),detail:String(l.detail).slice(0,1000)}))};
}
export function validateGraph(elements:{id:string}[],edges:Edge[]){
  if(new Set(edges.map(e=>e.join('|'))).size!==edges.length)throw Error('Precedência duplicada.');
  if(hasCycle(edges.map(([predecessorId,successorId])=>({predecessorId,successorId})),elements.map(e=>e.id)))throw Error('A relação criaria um ciclo de precedência.');
}
export function checkMove(s:Sheet,e:Task,target:number){
  if(e.fixedStation!=null&&e.fixedStation!==target)throw Error('O equipamento fixa este elemento no posto F'+e.fixedStation+'.');
  if(e.ergonomicZone==='red'&&!validException(e))throw Error('Zona vermelha exige autorização ergonômica vigente.');
  const assignments=new Map(s.elements.map(x=>[x.id,x.id===e.id?target:x.futureStation]));
  if(s.precedences.some(([a,b])=>(a===e.id||b===e.id)&&assignments.get(a)!>assignments.get(b)!))throw Error('A alocação viola a precedência técnica. O posto de origem foi preservado.');
}
export function validException(e:Task){const x=e.ergonomicException;return !!(x?.reason&&x.approvedBy&&Date.parse(x.expiresAt)>Date.now())}
export function asDomain(s:Sheet):Study {
  const byName=new Map(s.areas.map(a=>[a.name,a.id]));
  const equipment=s.equipment.map(e=>({...e}));
  const elements=s.elements.map((e,i)=>{
    let fixed=e.fixedEquipmentId;
    if(!fixed&&e.fixedStation!=null){fixed=e.id;equipment.push({id:e.id,name:'Monumento · '+e.name.slice(0,145),currentStationIndex:null,futureStationIndex:e.fixedStation})}
    return {id:e.id,areaId:byName.get(e.area)!,name:e.name,sortOrder:i,fixedEquipmentId:fixed,ergonomicZone:e.ergonomicZone,validationStatus:e.validationStatus,evidenceRef:e.evidenceRef,
      current:{stationIndex:e.currentStation,vaSeconds:String(e.vaCurrent),nvaSeconds:String(e.nvaCurrent)},future:{stationIndex:e.futureStation,vaSeconds:String(e.vaFuture),nvaSeconds:String(e.nvaFuture)}};
  });
  return {id:s.id,version:1,name:s.name,productFamily:s.product,parameters:{shiftSeconds:String(s.shiftSeconds),demandPerShift:String(s.demand),productiveDaysPerMonth:s.days,baselineUnitsPerDay:String(s.dailyVolume),laborCostPerShiftCurrent:String(s.laborCurrent),laborCostPerShiftFuture:String(s.laborFuture),oeePct:String(s.oee),seasonalityPct:s.seasonalityPct,capex:String(s.capex)},
    areas:s.areas.map((a,i)=>({id:a.id,name:a.name,sortOrder:i,operationalCostPerPieceCurrent:String(a.costCurrent),operationalCostPerPieceFuture:String(a.costFuture)})),equipment,elements,stations:s.stations,precedences:s.precedences.map(([predecessorId,successorId])=>({predecessorId,successorId}))};
}
export function importSheets(raw:any,fresh=true):Portfolio {
  if((raw?.schemaVersion!=null||raw?.project&&raw?.version!=null)&&![1,2].includes(Number(raw.schemaVersion??raw.version)))throw Error('Versão JSON não suportada.');
  let source=raw;
  if(raw.operations){
    const ops=array(raw.operations,100,'operações'),cur=raw.current?.length||ops.length||1,fut=raw.future?.length??raw.futureStations??1;
    if(cur>20||fut<1||fut>20)throw Error('Limite legado de 20 postos.');
    const loads=Array(fut).fill(0);
    const tasks=ops.map((o,i)=>({...o,id:'e'+i,area:o.name,currentStation:o.currentStation??Math.min(i+1,cur),vaFuture:o.vaFuture??o.vaCurrent??0,nvaFuture:o.nvaFuture??o.nvaCurrent??0}));
    [...tasks].sort((a,b)=>(+b.vaFuture + +b.nvaFuture)-(+a.vaFuture + +a.nvaFuture)).forEach(e=>{const pos=loads.indexOf(Math.min(...loads));e.futureStation=pos+1;loads[pos]+=+e.vaFuture + +e.nvaFuture});
    source={...raw.project,areas:ops,elements:tasks,stations:{current:cur,future:fut}};
  }
  const items=Array.isArray(source.studies)?array(source.studies,100,'estudos'):[source];
  if(!items.length)throw Error('Portfólio vazio.');
  const studies=items.map((s:any)=>normalize(s,fresh));const n=items.findIndex((s:any)=>s.id===source.activeStudyId);
  return {studies,activeStudyId:studies[Math.max(0,n)].id};
}
