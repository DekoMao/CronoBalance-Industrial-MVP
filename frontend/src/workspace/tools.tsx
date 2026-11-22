import { useState, type FormEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Sheet, Task } from './model';
import { checkMove, uid } from './model';
import { connection, login, logout, sync, historyFor, revisionFor, serverAction, resolveConflict, applyServerProposal } from './store';

type Assignment = {elementId:string;stationIndex:number};
type Context = {study:Sheet; method?:string; count?:number; result?:Assignment[]; score?:{cycleSeconds:{toNumber():number}}; onApply?:(sheet:Sheet,detail:string)=>void};
type Action = (run:()=>void|Promise<unknown>)=>void;
const fmt=(n:number)=>n.toLocaleString('pt-BR',{maximumFractionDigits:3});
let dialog:HTMLDialogElement,root:Root;

function Quality({study,onApply,act}:{study:Sheet;onApply:Context['onApply'];act:Action}){
  const [id,select]=useState(study.elements[0]?.id);
  const element=study.elements.find(e=>e.id===id);
  return <><label>Elemento de trabalho<select value={id??''} onChange={e=>select(e.target.value)}>{study.elements.map(e=><option key={e.id} value={e.id}>{e.area} · {e.name}</option>)}</select></label>{element?<QualityEditor key={id} {...{study,element,onApply,act}}/>:<p>Adicione um elemento à matriz para registrar restrições.</p>}</>;
}
function QualityEditor({study,element:e,onApply,act}:{study:Sheet;element:Task;onApply:Context['onApply'];act:Action}){
  const [resource,setResource]=useState(e.fixedEquipmentId??(e.fixedStation?'@pin':''));
  function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const form=new FormData(event.currentTarget);
    act(()=>{const work=structuredClone(study),el=work.elements.find(x=>x.id===e.id)!;
      el.ergonomicZone=String(form.get('zone')) as Task['ergonomicZone'];
      el.validationStatus=String(form.get('validation')) as Task['validationStatus'];
      el.evidenceRef=String(form.get('evidence')??'').trim()||null;
      if(el.validationStatus==='validated'&&!el.evidenceRef)throw Error('Informe a evidência que valida a medição.');
      if(resource==='@new'){
        const name=String(form.get('newResource')??'').trim();if(!name||work.equipment.some(v=>v.name===name))throw Error('Informe um nome único para o equipamento.');
        const r={id:uid(),name,currentStationIndex:el.currentStation,futureStationIndex:el.futureStation};work.equipment.push(r);el.fixedEquipmentId=r.id;el.fixedStation=r.futureStationIndex;
      }else{
        const r=work.equipment.find(v=>v.id===resource);
        if(r?.currentStationIndex!=null&&r.currentStationIndex!==el.currentStation)throw Error('O equipamento está em outro posto atual.');
        const target=r?.futureStationIndex??el.futureStation;
        el.fixedEquipmentId=r?.id??null;el.fixedStation=r?.futureStationIndex??(resource==='@pin'?el.futureStation:null);
        if(target!==el.futureStation){checkMove(work,el,target);el.futureStation=target;}
      }
      onApply?.(work,el.name+' · '+el.validationStatus+' · '+el.ergonomicZone);dialog.close();
    });
  }
  return <form onSubmit={save}><div className="cb-grid"><label>Zona ergonômica<select name="zone" defaultValue={e.ergonomicZone}><option value="green">Verde · regular</option><option value="yellow">Amarela · atenção</option><option value="red">Vermelha · requer exceção</option></select></label><label>Estado da medição<select name="validation" defaultValue={e.validationStatus}><option value="hypothesis">Hipótese de engenharia</option><option value="validated">Ganho validado</option></select></label></div>
    <label>Evidência de validação<input name="evidence" maxLength={500} defaultValue={e.evidenceRef??''} placeholder="Relatório, ensaio ou medição identificável"/></label><label>Equipamento ou monumento<select value={resource} onChange={v=>setResource(v.target.value)}><option value="">Livre</option><option value="@pin">Fixar no posto futuro atual</option>{study.equipment.map(r=><option value={r.id} key={r.id}>{r.name} · F{r.futureStationIndex??'livre'}</option>)}<option value="@new">Cadastrar equipamento neste posto</option></select></label>{resource==='@new'&&<label>Nome do equipamento<input name="newResource" required maxLength={120}/></label>}
    <button className="cb-primary" type="submit">Salvar restrições e evidência</button></form>;
}
function Proposal({ctx,act}:{ctx:Context;act:Action}){
  const rows=ctx.result??[],s=ctx.study;
  return <><p>{ctx.method==='sa'?'Recozimento simulado':'Peso posicional ordenado (RPW)'} · {ctx.count} postos · ciclo proposto <strong>{fmt(ctx.score!.cycleSeconds.toNumber())} s</strong></p>
    <div className="cb-scroll"><table><thead><tr><th>Elemento</th><th>Origem</th><th>Proposta</th></tr></thead><tbody>{rows.map(row=>{const e=s.elements.find(v=>v.id===row.elementId)!;return <tr key={e.id}><td>{e.name}</td><td>F{e.futureStation}</td><td>F{row.stationIndex}</td></tr>;})}</tbody></table></div><button className="cb-primary" onClick={()=>act(()=>{ctx.onApply?.(s,'');dialog.close()})}>Aplicar proposta</button></>;
}
function Cloud({ctx,act,reload}:{ctx:Context;act:Action;reload:()=>void}){
  const c=connection(),id=ctx.study.id;
  const [revs,setRevs]=useState<any[]>([]),[rev,setRev]=useState<Sheet|null>(null),[proposal,setProposal]=useState<any>(),[memo,setMemo]=useState(''),[el,setEl]=useState(ctx.study.elements[0]?.id??''),[until,setUntil]=useState('');
  return <><p className="cb-status">{c.status}</p>{c.account?<p>{c.account.displayName} · {({admin:'Administrador',engineer:'Engenheiro',viewer:'Visualizador'} as Record<string,string>)[c.account.role]}</p>:<p>{c.configured?'Entre com sua identidade corporativa para sincronizar estudos.':'Este endereço salva os estudos neste dispositivo. A sincronização corporativa exige uma API e um provedor de identidade configurados.'}</p>}
  {c.conflict&&<section><h3>Resolver conflito de versão</h3><p>Campos que mudaram nas duas versões</p><code>{c.conflict.paths.join(' · ')}</code><div className="cb-actions">{(['copy','remote','local'] as const).filter(k=>k!=='local'||c.conflict?.remote).map((k,i)=><button key={k} onClick={()=>act(async()=>{await resolveConflict(k);reload()})}>{['Preservar cópia local','Aceitar revisão do servidor','Manter minha edição'][i]}</button>)}</div></section>}
  {!c.account&&c.canLogin&&<button className="cb-primary" onClick={()=>act(login)}>Entrar com SSO</button>}
  {c.account&&<><div className="cb-actions"><button onClick={()=>act(async()=>{await sync();reload()})}>Sincronizar agora</button><button onClick={()=>act(async()=>setRevs(await historyFor(id)))}>Consultar histórico</button><button onClick={()=>act(()=>logout())}>Sair da sessão</button></div>
  {revs.map(r=><button className="cb-line" key={r.revision} onClick={()=>act(async()=>setRev(await revisionFor(id,r.revision)))}>v{r.revision} · {r.summary}</button>)}{rev&&<p>{rev.name} · {rev.elements.length} elementos · {fmt(rev.laborFuture)} R$/turno</p>}
  {c.account.role!=='viewer'&&<section><h3>Balanceamento no servidor</h3><button onClick={()=>act(async()=>setProposal(await serverAction(id,'optimize',{})))}>Calcular proposta CP-SAT</button>{proposal&&<><p>{proposal.canApply?'Proposta viável':'Sem alocação aplicável'} · {proposal.assignments.length} alocações</p>{proposal.conflicts?.map((v:string)=><p key={v}>{v}</p>)}{proposal.canApply&&<button className="cb-primary" onClick={()=>act(async()=>{await applyServerProposal(id,proposal);setProposal(null);reload()})}>Aplicar revisão proposta</button>}</>}</section>}
  {c.account.role==='admin'&&<section><h3>Aprovação industrial</h3><label>Justificativa<input value={memo} onChange={e=>setMemo(e.target.value)} maxLength={300}/></label><button disabled={!memo.trim()} onClick={()=>act(async()=>{await serverAction(id,'approve',{comment:memo.trim()});setMemo('');setRevs(await historyFor(id))})}>Aprovar cenário</button>
  <details><summary>Autorizar exceção ergonômica</summary><label>Elemento<select value={el} onChange={e=>setEl(e.target.value)}>{ctx.study.elements.map(v=><option value={v.id} key={v.id}>{v.name}</option>)}</select></label><label>Validade local<input type="datetime-local" value={until} onChange={e=>setUntil(e.target.value)}/></label><button disabled={!memo.trim()||!el||!(Date.parse(until)>Date.now())} onClick={()=>act(async()=>{await serverAction(id,'exception',{elementId:el,reason:memo,expiresAt:new Date(until).toISOString()});reload()})}>Registrar exceção com a justificativa</button></details></section>}</>}</>;
}
function Panel({kind,ctx}:{kind:string;ctx:Context}){
  const [msg,setMsg]=useState(''),[busy,setBusy]=useState(false),[,setTick]=useState(0);
  const act:Action=async run=>{setMsg('');setBusy(true);try{await run()}catch(e){setMsg(e instanceof Error?e.message:String(e))}finally{setBusy(false)}};
  return <><header><h2 id="cb-panel-title">{{quality:'Restrições e evidências',cloud:'Sincronização e revisões',proposal:'Revisar balanceamento'}[kind]}</h2><button aria-label="Fechar" onClick={()=>dialog.close()}>×</button></header><fieldset disabled={busy}>{kind==='quality'?<Quality study={ctx.study} onApply={ctx.onApply} act={act}/>:kind==='proposal'?<Proposal ctx={ctx} act={act}/>:<Cloud ctx={ctx} act={act} reload={()=>setTick(v=>v+1)}/>}</fieldset><div role="alert">{msg}</div></>;
}
export function openTools(kind:'quality'|'cloud'|'proposal',ctx:Context){
  if(!dialog){dialog=document.createElement('dialog');dialog.className='cb-dialog';dialog.setAttribute('aria-labelledby','cb-panel-title');document.body.append(dialog);root=createRoot(dialog)}
  root.render(<Panel key={uid()} kind={kind} ctx={ctx}/>);if(!dialog.open)dialog.showModal();
}
