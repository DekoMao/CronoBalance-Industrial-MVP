import Dexie, { type Table } from 'dexie';
import { accessToken, oidcEnabled, userManager } from '../services/auth';
import { apiConfigured, ApiError } from '../services/api';
import { asDomain, importSheets, normalize, uid, type Portfolio, type Sheet } from './model';

type Account = { userId:string; organizationId:string; displayName:string; role:string };
type Row = { id:string; sheet:Sheet; base:Sheet|null; etag:string; dirty:boolean; removed:boolean; mutation:string; stamp:number };
export type Clash={id:string;remote:Sheet|null;etag:string;paths:string[]};
class WorkspaceDb extends Dexie {
  rows!:Table<Row,string>; meta!:Table<{key:string;value:any},string>;
  constructor(scope:string){super('cronobalance-v3:'+scope);this.version(1).stores({rows:'id',meta:'key'});}
}
let db:WorkspaceDb, account:Account|null=null,token:string|null=null;
let persisted:Portfolio, writeChain=Promise.resolve(), flight:Promise<void>|undefined, timer=0, attempts=0;
let update:(p:Portfolio)=>void, info:(s:string)=>void, clash:Clash|null=null;
const base=(import.meta.env.VITE_API_BASE_URL??'').replace(/\/$/,'');
const isFile=location.protocol==='file:';
const authCache='cb-account:'+base;
let status='Salvo localmente';
const state=(s:string)=>{status=s;info?.(s)};
export const connection=()=>({status,account,conflict:clash,configured:apiConfigured&&!isFile,canLogin:oidcEnabled});
export const login=()=>userManager?.signinRedirect();
export async function logout(clear=false){await writeChain;if(clear&&db)await db.delete();sessionStorage.removeItem(authCache);await userManager?.removeUser();location.href=import.meta.env.BASE_URL;}
export async function request(path:string,method='GET',payload?:unknown,etag?:string,key?:string){
  if(!base||!token)throw Error('A API corporativa exige uma sessão ativa.');
  const r=await fetch(base+'/api/v1'+path,{method,cache:'no-store',signal:AbortSignal.timeout(20000),headers:{Authorization:'Bearer '+token,...((account?.organizationId||import.meta.env.VITE_ORGANIZATION_ID)?{'X-Organization-ID':account?.organizationId||import.meta.env.VITE_ORGANIZATION_ID}:{}),...(payload?{'Content-Type':'application/json'}:{}),...(etag?{'If-Match':etag}:{}),...(key?{'Idempotency-Key':key}:{})},body:payload?JSON.stringify(payload):undefined});
  const body=r.status===204?null:await r.json().catch(()=>null);
  if(!r.ok){const problem=body?.detail;throw new ApiError(r.status,{detail:typeof problem==='string'?problem:problem?.detail??problem?.code??('Resposta '+r.status)});}
  return {body,etag:r.headers.get('ETag')??''};
}
function remoteShape(raw:any){
  const local=normalize({...raw,...raw.workspace,areas:raw.areas,elements:raw.elements,equipment:raw.equipment});
  // A pinned element uses its own identity as a synthetic physical resource.
  local.elements.forEach(e=>{if(e.fixedEquipmentId===e.id)e.fixedEquipmentId=null});
  local.equipment=local.equipment.filter(r=>!local.elements.some(e=>e.id===r.id));
  return local;
}
function payload(s:Sheet){const d=asDomain(s);return {studyId:d.id,parameters:{name:s.name,productFamily:s.product,...d.parameters},stations:d.stations,areas:d.areas,equipment:d.equipment,elements:d.elements,precedences:d.precedences,workspace:{author:s.author,revision:s.revision,cv:s.cv,auditLog:s.auditLog}}}
const identical=(a:any,b:any)=>JSON.stringify(a)===JSON.stringify(b);
export function mergeVersions(base:any,local:any,remote:any){
  const paths:string[]=[];
  function merge(b:any,l:any,r:any,path:string):any {
    if(identical(l,b))return r;
    if(identical(r,b)||identical(l,r))return l;
    if(path==='auditLog'){const seen=new Set<string>();return [...l,...r].filter(v=>{const k=JSON.stringify(v);if(seen.has(k))return false;seen.add(k);return true}).slice(0,1000)}
    if(b&&l&&r&&typeof b==='object'&&typeof l==='object'&&typeof r==='object'){
      if(Array.isArray(b)&&Array.isArray(l)&&Array.isArray(r)&&['elements','equipment','areas'].includes(path)){
        const ids=[...new Set([...r,...l,...b].map(v=>v.id))];
        return ids.map(id=>merge(b.find((v:any)=>v.id===id),l.find((v:any)=>v.id===id),r.find((v:any)=>v.id===id),path+'.'+id)).filter(Boolean);
      }
      if(!Array.isArray(b)&&!Array.isArray(l)&&!Array.isArray(r)){
        const obj:Record<string,unknown>={};for(const key of new Set([...Object.keys(b),...Object.keys(l),...Object.keys(r)]))obj[key]=merge(b[key],l[key],r[key],path?path+'.'+key:key);return obj;
      }
    }
    paths.push(path);return l;
  }
  const sheet=merge(base,local,remote,'');return {sheet,paths};
}
async function portfolio():Promise<Portfolio>{
  const sheets=(await db.rows.toArray()).filter(r=>!r.removed).map(r=>r.sheet);
  const active=(await db.meta.get('active'))?.value;
  return {activeStudyId:sheets.some(s=>s.id===active)?active:sheets[0]?.id,studies:sheets};
}
function schedule(delay=500){clearTimeout(timer);if(account&&navigator.onLine&&!clash)timer=window.setTimeout(()=>void sync(),delay)}
async function attach(){
  if(!apiConfigured||isFile)return;
  const callback=new URLSearchParams(location.search);
  if(callback.has('code')&&userManager){await userManager.signinCallback();history.replaceState(null,'',import.meta.env.BASE_URL)}
  token=await accessToken();
  if(!token)return;
  let cached:Account|null=null;
  try{cached=JSON.parse(sessionStorage.getItem(authCache)??'null')}catch{}
  try{const result=await request('/session');account=result.body;sessionStorage.setItem(authCache,JSON.stringify(account))}catch(error){if(error instanceof ApiError)throw error;account=cached}
}
export async function openStore(seed:()=>any[],onRemote:(p:Portfolio)=>void,onStatus:(s:string)=>void,embedded?:any){
  update=onRemote;info=onStatus;
  await attach();
  const scope=account?base+':'+account.organizationId+':'+account.userId:'local';
  db=new WorkspaceDb(scope+(embedded?':file:'+String(embedded.activeStudyId):''));
  let p=await portfolio();
  if(!p.studies.length){
    let data=embedded;
    if(!data&&!account){
      for(const k of ['cronobalance_sdd_v2_0_studies','cronobalance_sdd_v1_5_studies','cronobalance-industrial-v2','cronobalance-industrial-v1']){const legacy=localStorage.getItem(k);if(legacy){data=JSON.parse(legacy);break}}
      if(!data&&await Dexie.exists('cronobalance-industrial-v24')){
        const prev=new Dexie('cronobalance-industrial-v24');await prev.open();const list=await prev.table('studies').toArray();prev.close();if(list.length)data={studies:list};
      }
    }
    if(account&&navigator.onLine){
      const items=await remoteList();
      for(const item of items){const r=await request('/studies/'+item.id);const s=remoteShape(r.body);await db.rows.put(row(s,s,r.etag,false));}
      p=await portfolio();
    }
    if(!p.studies.length){
      const initial=account?[{name:'Novo estudo',product:'Produto',areas:[],elements:[],stations:{current:1,future:1}}]:seed();
      p=data?importSheets(data,false):importSheets({studies:initial},true);
      await db.transaction('rw',db.rows,db.meta,async()=>{for(const s of p.studies)await db.rows.put(row(s,null,'',false));await db.meta.put({key:'active',value:p.activeStudyId})});
    }
  }
  persisted=structuredClone(p);
  window.addEventListener('online',()=>schedule(0));window.addEventListener('offline',()=>state(account?'Offline · salvo localmente':'Salvo localmente'));
  if(account) schedule(0);else state('Salvo localmente');
  return p;
}
function row(sheet:Sheet,base:Sheet|null,etag:string,dirty:boolean):Row{return {id:sheet.id,sheet,base,etag,dirty,removed:false,mutation:uid(),stamp:Date.now()}}
async function remoteList(){
  const all:any[]=[];let next='';
  do{const q=await request('/studies?limit=100'+(next?'&cursor='+encodeURIComponent(next):''));all.push(...q.body.items);next=q.body.nextCursor??'';}while(next);
  return all;
}
export function savePortfolio(next:Portfolio){
  const clean=structuredClone(next),prev=persisted;
  if(!prev)return Promise.resolve();
  const removed=prev.studies.filter(s=>!clean.studies.some(t=>s.id===t.id));
  const changed=clean.studies.filter(s=>!identical(s,prev.studies.find(t=>s.id===t.id)));
  if(account?.role==='viewer'&&(changed.length||removed.length))throw Error('Seu perfil permite apenas visualizar estudos.');
  persisted=structuredClone(clean);
  const work=writeChain.then(()=>db.transaction('rw',db.rows,db.meta,async()=>{
    for(const s of changed){
      const old=await db.rows.get(s.id),previous=prev.studies.find(x=>x.id===s.id);
      if(old&&previous&&!identical(old.sheet,previous)){
        const result=mergeVersions(previous,s,old.sheet);
        if(result.paths.length)throw Error('Outra aba alterou o mesmo campo. Reabra o estudo para comparar as alterações.');
        Object.assign(s,normalize(result.sheet));
      }
      await db.rows.put(row(s,old?.base??null,old?.etag??'',!!account));
    }
    for(const s of removed){const old=await db.rows.get(s.id);if(old?.base)await db.rows.put({...old,removed:true,dirty:true,mutation:uid()});else await db.rows.delete(s.id)}
    await db.meta.put({key:'active',value:clean.activeStudyId});
  })).then(()=>{if(changed.length||removed.length){state(account?'Alterações pendentes':'Salvo localmente');schedule()}});
  writeChain=work.catch(async()=>{if(identical(persisted,clean)){persisted=await portfolio();update(structuredClone(persisted))}state('Falha ao salvar')});
  return work;
}
export async function historyFor(id:string){return (await request('/studies/'+id+'/revisions')).body}
export async function revisionFor(id:string,n:number){return remoteShape((await request('/studies/'+id+'/revisions/'+n)).body)}
export async function serverAction(id:string,kind:'optimize'|'approve'|'exception',data:any){
  await sync();const item=await db.rows.get(id);
  if(!item?.etag||item.dirty||clash)throw Error('Sincronize esta revisão antes de continuar.');
  const version=Number(/-v(\d+)"$/.exec(item.etag)?.[1]);
  if(kind==='optimize')return (await request('/studies/'+id+'/optimize','POST',{inputVersion:version,targetStationCount:item.sheet.stations.future,maxStationCount:item.sheet.stations.future,meetTakt:item.sheet.demand>0,solverTimeLimitSeconds:5})).body;
  const path=kind==='approve'?'/approve':'/elements/'+data.elementId+'/ergonomic-exception';
  await request('/studies/'+id+path,kind==='approve'?'POST':'PUT',data,item.etag);
  await sync();
}
async function refreshScreen(){
  await writeChain;
  const p=await portfolio();
  if(p.studies.length&&!identical(p,persisted)){persisted=structuredClone(p);update(p)}
}
async function flush(){
  await writeChain;if(!account||!token||clash)return;
  if(!navigator.onLine){state('Offline · salvo localmente');return}
  state('Sincronizando');
  try{
    const listed=await remoteList(),all=await db.rows.toArray();
    for(const item of all.filter(i=>i.dirty)){
      const path='/studies/'+item.id;let result:{body:any;etag:string};
      try{
        result=item.removed?await request(path,'DELETE',undefined,item.etag,item.mutation):item.etag?await request(path,'PUT',payload(item.sheet),item.etag,item.mutation):await request('/studies','POST',payload(item.sheet),undefined,item.id);
      }catch(e){
        if(!(e instanceof ApiError)||![409,412].includes(e.status))throw e;
        const fetched=await request(path),remote=fetched.body.status==='archived'?null:remoteShape(fetched.body);
        const latest=(await db.rows.get(item.id))!;
        const merge=remote&&!latest.removed&&latest.base?mergeVersions(latest.base,latest.sheet,remote):{sheet:latest.sheet,paths:['portfólio']};
        if(!merge.paths.length){await db.rows.put(row(normalize(merge.sheet),remote,fetched.etag,true));schedule(20);await refreshScreen();state('Alterações pendentes');return}
        clash={id:item.id,remote,etag:fetched.etag,paths:merge.paths};state('Conflito de versão');return;
      }
      await db.transaction('rw',db.rows,async()=>{
        const latest=await db.rows.get(item.id);if(!latest)return;
        if(item.removed&&latest.mutation===item.mutation){await db.rows.delete(item.id);return}
        if(!result.body)return;
        const canonical=remoteShape(result.body);
        const noNewEdits=latest.mutation===item.mutation;
        await db.rows.put({...latest,sheet:noNewEdits?canonical:latest.sheet,base:canonical,etag:result.etag,dirty:!noNewEdits});
      });
    }
    for(const remote of listed){
      const local=await db.rows.get(remote.id);
      if(local?.dirty||local?.etag==='"study-'+remote.id+'-v'+remote.version+'"')continue;
      const fetched=await request('/studies/'+remote.id);
      const s=remoteShape(fetched.body);
      await db.transaction('rw',db.rows,async()=>{if(!(await db.rows.get(s.id))?.dirty)await db.rows.put(row(s,s,fetched.etag,false))});
    }
    for(const l of all){if(l.base&&!l.dirty&&!listed.some(r=>r.id===l.id))await db.transaction('rw',db.rows,async()=>{if(!(await db.rows.get(l.id))?.dirty)await db.rows.delete(l.id)})}
    await refreshScreen();
    const pending=(await db.rows.toArray()).some(r=>r.dirty);attempts=0;state(pending?'Alterações pendentes':'Sincronizado na nuvem');if(pending)schedule(50);
  }catch(e){
    const stop=e instanceof ApiError&&[400,401,403,404,422].includes(e.status);
    state(stop?'Sincronização bloqueada · '+(e as Error).message:'Offline · alterações preservadas');
    if(!stop&&++attempts<=10)schedule(Math.min(30000,1000*2**(attempts-1))*(.8+Math.random()*.4));
  }
}
export function sync(){if(!flight)flight=flush().finally(()=>{flight=undefined});return flight}
export async function resolveConflict(choice:'remote'|'copy'|'local'){
  if(!clash)return;
  const c=clash,item=await db.rows.get(c.id);if(!item)return;
  await db.transaction('rw',db.rows,async()=>{
    if(choice==='copy'){const copy=normalize(item.sheet,true);copy.name=copy.name.slice(0,145)+' · cópia local';await db.rows.put(row(copy,null,'',true))}
    if(choice==='local'&&c.remote)await db.rows.put(row(item.sheet,c.remote,c.etag,true));
    else if(c.remote)await db.rows.put(row(c.remote,c.remote,c.etag,false));else await db.rows.delete(c.id);
  });
  clash=null;await refreshScreen();await sync();
}

export async function applyServerProposal(id:string,proposal:unknown){
  await sync();
  const item=await db.rows.get(id);
  if(!item?.etag||item.dirty||clash)throw Error('Sincronize a revisão antes de aplicar a proposta.');
  await request('/studies/'+id+'/optimization-proposals/apply','POST',proposal,item.etag);
  await sync();
}
