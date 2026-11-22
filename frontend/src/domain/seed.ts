import type { Study } from './types';
const uid = () => crypto.randomUUID();
const areaNames = ['Recebimento','Preparação','Montagem principal','Montagem complementar','Inspeção e teste','Embalagem e expedição'];
const areaCosts = [[.81,.63],[1.16,.81],[2.71,1.63],[1.32,.91],[1.11,.85],[.93,.80]];
const rows: [number,number,number,number,number,number][] = [
  [24,12,24,4,1,1],[22,12,22,5,1,1],[32,18,32,4,2,2],[30,20,30,4,2,2],
  [37,32,37,4,3,1],[24,25,24,2,3,2],[20,20.3,20,2,3,3],[15,17,15,2,3,4],
  [32,34,32,2,3,5],[35,17.5,35,4,4,4],[35,17.5,35,5,4,4],
  [32.5,15,32.5,4.5,5,3],[32.5,15,32.5,4.5,5,3],[27,13,27,4,6,5],[27,13,27,4,6,5]
];
const tasks = ['Separar e identificar material','Abastecer ponto de uso','Preparar componentes A','Preparar componentes B','Fixar subconjunto A','Fixar subconjunto B','Conectar chicote','Montar acabamento','Verificação da montagem','Montar suporte','Instalar acabamento','Executar teste funcional A','Executar teste funcional B','Proteger produto','Identificar e liberar'];
const elementArea = [0,0,1,1,2,2,2,2,2,3,3,4,4,5,5];
export function makeSeed(): Study {
  const areas=areaNames.map((name,i)=>({id:uid(),name,sortOrder:i,operationalCostPerPieceCurrent:String(areaCosts[i][0]),operationalCostPerPieceFuture:String(areaCosts[i][1])}));
  return {id:uid(),version:1,name:'Linha de montagem · Projeto piloto',productFamily:'Produto A',parameters:{shiftSeconds:'27000',demandPerShift:'180',productiveDaysPerMonth:22,baselineUnitsPerDay:'35.2',laborCostPerShiftCurrent:'1710',laborCostPerShiftFuture:'1425'},stations:{current:6,future:5},areas,elements:rows.map((r,i)=>({id:uid(),areaId:areas[elementArea[i]].id,name:tasks[i],sortOrder:i,current:{stationIndex:r[4],vaSeconds:String(r[0]),nvaSeconds:String(r[1])},future:{stationIndex:r[5],vaSeconds:String(r[2]),nvaSeconds:String(r[3])},ergonomicZone:'green',fixedEquipmentId:null,validationStatus:'hypothesis'})),equipment:[],precedences:[]};
}
