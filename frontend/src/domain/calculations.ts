import Decimal from 'decimal.js';
import type { Scenario, Study } from './types';

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });
export const D=(value: Decimal.Value)=>new Decimal(value || 0);
export const fmt=(value: Decimal.Value | null | undefined, digits=1)=>value == null ? '—' : D(value).toDecimalPlaces(digits).toNumber().toLocaleString('pt-BR',{maximumFractionDigits:digits});
export const money=(value: Decimal.Value | null | undefined)=>value == null ? '—' : `R$ ${D(value).toDecimalPlaces(2).toNumber().toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
export const percent=(a: Decimal.Value|null,b: Decimal.Value|null)=>a==null||b==null||D(a).eq(0)?'—':`${D(b).minus(a).div(a).mul(100).toDecimalPlaces(1).toNumber().toLocaleString('pt-BR',{maximumFractionDigits:1})}%`;
export function derive(study:Study,scenario:Scenario){
  const count=study.stations[scenario]; const loads=Array.from({length:count},()=>new Decimal(0));
  const areaTotals=new Map(study.areas.map(a=>[a.id,{va:new Decimal(0),nva:new Decimal(0),total:new Decimal(0)}]));
  for(const e of study.elements){const x=e[scenario],va=D(x.vaSeconds),nva=D(x.nvaSeconds),total=va.plus(nva); if(x.stationIndex>0&&x.stationIndex<=count)loads[x.stationIndex-1]=loads[x.stationIndex-1].plus(total);const a=areaTotals.get(e.areaId); if(a){a.va=a.va.plus(va);a.nva=a.nva.plus(nva);a.total=a.total.plus(total);}}
  const cycle=loads.reduce((m,v)=>Decimal.max(m,v),new Decimal(0));const shift=D(study.parameters.shiftSeconds);const oee=D(study.parameters.oeePct??100).div(100);const seasonality=D(study.parameters.seasonalityPct??0).div(100);const effectiveShift=shift.mul(oee);const demand=D(study.parameters.demandPerShift).mul(new Decimal(1).plus(seasonality));const takt=demand.gt(0)?effectiveShift.div(demand):null;const capacity=cycle.gt(0)?effectiveShift.div(cycle):null;
  const labor=D(scenario==='current'?study.parameters.laborCostPerShiftCurrent:study.parameters.laborCostPerShiftFuture);const cmo=capacity?.gt(0)?labor.div(capacity):null;
  const opCost=study.areas.reduce((sum,a)=>sum.plus(scenario==='current'?a.operationalCostPerPieceCurrent:a.operationalCostPerPieceFuture),new Decimal(0));
  const bottleneck=cycle.gt(0)?loads.flatMap((x,i)=>x.eq(cycle)?[i+1]:[]):[];
  const totalWork=loads.reduce((sum,value)=>sum.plus(value),new Decimal(0));const efficiency=cycle.gt(0)&&count>0?totalWork.div(new Decimal(count).mul(cycle)).mul(100):null;const balanceDelay=efficiency?new Decimal(100).minus(efficiency):null;const minStations=takt&&takt.gt(0)?Math.max(1,Math.ceil(totalWork.div(takt).toNumber())):null;const smoothnessIndex=cycle.gt(0)?Decimal.sqrt(loads.reduce((sum,value)=>sum.plus(cycle.minus(value).pow(2)),new Decimal(0))):null;
  return {loads,cycle:cycle.gt(0)?cycle:null,takt,capacity,cmo,opCost,bottleneck,meetsTakt:cycle.gt(0)&&takt?cycle.lte(takt):null,areaTotals,totalWork,efficiency,balanceDelay,minStations,smoothnessIndex,effectiveShift};
}
export function monthlySaving(study:Study){const c=derive(study,'current').cmo,f=derive(study,'future').cmo;if(!c||!f)return null;const seasonalFactor=new Decimal(1).plus(D(study.parameters.seasonalityPct??0).div(100));return c.minus(f).mul(study.parameters.baselineUnitsPerDay).mul(seasonalFactor).mul(study.parameters.productiveDaysPerMonth);}
export function investmentMetrics(study:Study){const saving=monthlySaving(study);const capex=D(study.parameters.capex??0);const payback=saving&&saving.gt(0)&&capex.gt(0)?capex.div(saving):null;const annualRoi=saving&&capex.gt(0)?saving.mul(12).minus(capex).div(capex).mul(100):null;return {payback,annualRoi};}
export function hasCycle(edges:{predecessorId:string;successorId:string}[],ids:string[]){const next=new Map<string,string[]>(),deg=new Map(ids.map(id=>[id,0]));for(const e of edges){next.set(e.predecessorId,[...(next.get(e.predecessorId)||[]),e.successorId]);deg.set(e.successorId,(deg.get(e.successorId)||0)+1);}const q=ids.filter(id=>deg.get(id)===0);let n=0;while(q.length){const id=q.shift()!;n++;for(const s of next.get(id)||[]){deg.set(s,deg.get(s)!-1);if(deg.get(s)===0)q.push(s);}}return n!==ids.length;}
