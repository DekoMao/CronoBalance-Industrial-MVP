import * as XLSX from 'xlsx';
import type { Portfolio, Sheet } from './model';
const originalFile=location.protocol==='file:'?document.documentElement.outerHTML:null;
const filename=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9_-]+/g,'-').slice(0,80)||'CronoBalance';
function download(content:BlobPart,type:string,name:string){
  const url=URL.createObjectURL(new Blob([content],{type})),link=document.createElement('a');
  link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
export function exportJson(p:Portfolio){download(JSON.stringify({schemaVersion:2,...p},null,2),'application/json','CronoBalance-portfolio.json')}
function elements(s:Sheet){
  return [['Área','Elemento','Posto atual','VA atual (s)','NVA atual (s)','Posto futuro','VA futuro (s)','NVA futuro (s)','Validação','Evidência'],...s.elements.map(e=>[e.area,e.name,e.currentStation,e.vaCurrent,e.nvaCurrent,e.futureStation,e.vaFuture,e.nvaFuture,e.validationStatus==='validated'?'Validado':'Hipótese',e.evidenceRef??''])];
}
function csvCell(v:string|number){
  let str=typeof v==='number'?String(v).replace('.',','):v;
  if(typeof v==='string'&&/^[\s]*[=+@-]/.test(str))str="'"+str;
  return '"'+str.replace(/"/g,'""')+'"';
}
export function exportCsv(s:Sheet){download('\ufeff'+elements(s).map(r=>r.map(csvCell).join(';')).join('\r\n'),'text/csv;charset=utf-8',filename(s.name)+'.csv')}
export function exportExcel(s:Sheet,m:Record<string,number>){
  const wb=XLSX.utils.book_new();
  const add=(name:string,rows:(string|number)[][])=>XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),name);
  add('Elementos',elements(s));
  add('Operações',[['Área','Custo operacional atual (R$/peça)','Custo operacional futuro (R$/peça)'],...s.areas.map(a=>[a.name,a.costCurrent,a.costFuture])]);
  add('Indicadores',[['Indicador','Atual','Futuro'],['Ciclo (s)',m.currentCycle,m.futureCycle],['Capacidade (un/turno)',m.capCurrent,m.capFuture],['Mão de obra (R$/peça)',m.unitLaborCurrent,m.unitLaborFuture],['Custo operacional (R$/peça)',m.opsCostCurrent,m.opsCostFuture],['Economia mensal estimada (R$)','',m.monthlySaving],['Takt efetivo (s)','',Number.isFinite(m.takt)?m.takt:'Indefinido']]);
  add('Premissas',[['Parâmetro','Valor'],['Tempo do turno (s)',s.shiftSeconds],['Demanda nominal (un/turno)',s.demand],['Produção base (un/dia)',s.dailyVolume],['Dias produtivos',s.days],['OEE (%)',s.oee],['Sazonalidade (%)',s.seasonalityPct],['CAPEX (R$)',s.capex]]);
  download(XLSX.write(wb,{bookType:'xlsx',type:'array'}),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',filename(s.name)+'.xlsx');
}
export async function exportPortable(p:Portfolio){
  let html=originalFile;
  if(!html){const response=await fetch(import.meta.env.BASE_URL+'portable.html');if(!response.ok)throw Error('O pacote HTML precisa do build de distribuição.');html=await response.text();}
  const marker=/<script type="application\/json" id="cb-embedded">[\s\S]*?<\/script>/;
  if(!marker.test(html))throw Error('O pacote autônomo não está disponível neste servidor.');
  const snapshot=JSON.stringify({schemaVersion:2,...p}).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026');
  html=html.replace(marker,()=>'<script type="application/json" id="cb-embedded">'+snapshot+'</script>');
  download('<!doctype html>\n'+html.replace(/^\s*<!doctype html>/i,''),'text/html;charset=utf-8','CronoBalance-Industrial.html');
}