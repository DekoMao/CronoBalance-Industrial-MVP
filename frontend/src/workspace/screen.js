
import './workbench.css';
import { normalize, importSheets, uid, checkMove, validateGraph, asDomain, validException } from './model';
import { openStore, savePortfolio, connection, sync } from './store';
import { openTools } from './tools';
import { exportPortable, exportExcel, exportCsv, exportJson } from './exports';
import { rebalanceRPW as solveRPW, optimizeSimulatedAnnealing, runMonteCarlo, objectiveFor } from '../domain/edgeEngineering';

    'use strict';

    const STORAGE_KEY = 'cronobalance_sdd_v2_0_studies';
    const LEGACY_STORAGE_KEY = 'cronobalance_sdd_v1_5_studies';
    let riskCache={};
    let chartMode = 'future';
    let expandedAreas = new Set();
    let workFilterQuery = '';
    let workSort = { key: null, dir: 'asc' };
    let undoStack = [];
    
    let toastTimeout = null;
    let deleteTargetIds = new Set();
    let deferredInstallPrompt = null;
    const SIDEBAR_STATE_KEY = 'cronobalance_sidebar_collapsed';

    function toggleSidebar() {
      const collapsed = document.body.classList.toggle('sidebar-collapsed');
      const icon = document.getElementById('sidebar-collapse-icon');
      if (icon) icon.style.transform = collapsed ? 'rotate(180deg)' : 'rotate(0deg)';
      try {
        localStorage.setItem(SIDEBAR_STATE_KEY, collapsed ? '1' : '0');
      } catch (e) {}
      setTimeout(() => {
        if(getActiveStudy())renderChart(getActiveStudy(), computeMetrics(getActiveStudy()));
      }, 240);
    }

    function toggleMobileSidebar(forceOpen) {
      const sidebar = document.getElementById('app-sidebar');
      const backdrop = document.getElementById('mobile-sidebar-backdrop');
      if (!sidebar || !backdrop) return;
      const isCurrentlyOpen = !sidebar.classList.contains('-translate-x-full');
      const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : !isCurrentlyOpen;
      if (shouldOpen) {
        sidebar.classList.remove('-translate-x-full');
        backdrop.classList.remove('hidden');
      } else {
        sidebar.classList.add('-translate-x-full');
        backdrop.classList.add('hidden');
      }
    }

    function initSidebarState() {
      try {
        if (localStorage.getItem(SIDEBAR_STATE_KEY) === '1') {
          document.body.classList.add('sidebar-collapsed');
          const icon = document.getElementById('sidebar-collapse-icon');
          if (icon) icon.style.transform = 'rotate(180deg)';
        }
      } catch (e) {}
    }

    // 1. FORMATTING & SAFETY HELPERS
    const safeNum = v => Math.max(0, Number(v) || 0);
    const formats=[0,1,2].map(places=>new Intl.NumberFormat('pt-BR',{minimumFractionDigits:places,maximumFractionDigits:places}));
    const formatted=(n,places)=>n!=null&&Number.isFinite(Number(n))?formats[places].format(Number(n)):'—';
    const fmt1=n=>formatted(n,1),fmt2=n=>formatted(n,2),fmtInt=n=>formatted(n,0);
    const fmtMoney=n=>n!=null&&Number.isFinite(Number(n))?'R$ '+fmtInt(n):'—';
    const fmtMoney2 = n => 'R$ ' + fmt2(n);
    const fmtPct = n => !Number.isFinite(n) ? '—' : (n < 0 ? '−' : '+') + fmt1(Math.abs(n)) + '%';
    const escHtml = str => String(str ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[ch]);

    function showToast(msg) {
      const box = document.getElementById('toast-box');
      const label = document.getElementById('toast-message');
      if (!box || !label) return;
      label.textContent = msg;
      box.classList.remove('translate-y-16', 'opacity-0');
      clearTimeout(toastTimeout);
      toastTimeout = setTimeout(() => {
        box.classList.add('translate-y-16', 'opacity-0');
      }, 3600);
    }

    // 2. SEED DATA & MULTI-STUDY PERSISTENCE
    function createDefaultStudies() {
      return [
        {
          id: 'study-produto-a',
          name: 'Linha de Montagem - Produto A',
          product: 'Produto A',
          shiftSeconds: 27000,
          days: 22,
          demand: 180,
          dailyVolume: 35.2,
          laborCurrent: 1710,
          laborFuture: 1425,
          oee: 100,
          capex: 15000,
          seasonalityPct: 0,
          author: 'Eng. Processos',
          revision: 'Rev. 1.0',
          stations: { current: 6, future: 5 },
          areas: [
            { name: 'Recebimento', costCurrent: 0.81, costFuture: 0.63 },
            { name: 'Preparação', costCurrent: 1.16, costFuture: 0.81 },
            { name: 'Montagem principal', costCurrent: 2.71, costFuture: 1.63 },
            { name: 'Montagem complementar', costCurrent: 1.32, costFuture: 0.91 },
            { name: 'Inspeção e teste', costCurrent: 1.11, costFuture: 0.85 },
            { name: 'Embalagem e expedição', costCurrent: 0.93, costFuture: 0.80 }
          ],
          elements: [
            { id: 'e01', area: 'Recebimento', name: 'Separar e identificar material', currentStation: 1, vaCurrent: 24, nvaCurrent: 12, futureStation: 1, vaFuture: 24, nvaFuture: 4, fixedStation: null },
            { id: 'e02', area: 'Recebimento', name: 'Abastecer ponto de uso', currentStation: 1, vaCurrent: 22, nvaCurrent: 12, futureStation: 1, vaFuture: 22, nvaFuture: 5, fixedStation: null },
            { id: 'e03', area: 'Preparação', name: 'Preparar componentes A', currentStation: 2, vaCurrent: 32, nvaCurrent: 18, futureStation: 2, vaFuture: 32, nvaFuture: 4, fixedStation: null },
            { id: 'e04', area: 'Preparação', name: 'Preparar componentes B', currentStation: 2, vaCurrent: 30, nvaCurrent: 20, futureStation: 2, vaFuture: 30, nvaFuture: 4, fixedStation: null },
            { id: 'e05', area: 'Montagem principal', name: 'Fixar subconjunto A', currentStation: 3, vaCurrent: 37, nvaCurrent: 32, futureStation: 1, vaFuture: 37, nvaFuture: 4, fixedStation: null },
            { id: 'e06', area: 'Montagem principal', name: 'Fixar subconjunto B', currentStation: 3, vaCurrent: 24, nvaCurrent: 25, futureStation: 2, vaFuture: 24, nvaFuture: 2, fixedStation: null },
            { id: 'e07', area: 'Montagem principal', name: 'Conectar chicote', currentStation: 3, vaCurrent: 20, nvaCurrent: 20.3, futureStation: 3, vaFuture: 20, nvaFuture: 2, fixedStation: null },
            { id: 'e08', area: 'Montagem principal', name: 'Montar acabamento', currentStation: 3, vaCurrent: 15, nvaCurrent: 17, futureStation: 4, vaFuture: 15, nvaFuture: 2, fixedStation: null },
            { id: 'e09', area: 'Montagem principal', name: 'Verificação da montagem', currentStation: 3, vaCurrent: 32, nvaCurrent: 34, futureStation: 5, vaFuture: 32, nvaFuture: 2, fixedStation: null },
            { id: 'e10', area: 'Montagem complementar', name: 'Montar suporte', currentStation: 4, vaCurrent: 35, nvaCurrent: 17.5, futureStation: 4, vaFuture: 35, nvaFuture: 4, fixedStation: null },
            { id: 'e11', area: 'Montagem complementar', name: 'Instalar acabamento', currentStation: 4, vaCurrent: 35, nvaCurrent: 17.5, futureStation: 4, vaFuture: 35, nvaFuture: 5, fixedStation: null },
            { id: 'e12', area: 'Inspeção e teste', name: 'Executar teste funcional A', currentStation: 5, vaCurrent: 32.5, nvaCurrent: 15, futureStation: 3, vaFuture: 32.5, nvaFuture: 4.5, fixedStation: null },
            { id: 'e13', area: 'Inspeção e teste', name: 'Executar teste funcional B', currentStation: 5, vaCurrent: 32.5, nvaCurrent: 15, futureStation: 3, vaFuture: 32.5, nvaFuture: 4.5, fixedStation: null },
            { id: 'e14', area: 'Embalagem e expedição', name: 'Proteger produto', currentStation: 6, vaCurrent: 27, nvaCurrent: 13, futureStation: 5, vaFuture: 27, nvaFuture: 4, fixedStation: null },
            { id: 'e15', area: 'Embalagem e expedição', name: 'Identificar e liberar', currentStation: 6, vaCurrent: 27, nvaCurrent: 13, futureStation: 5, vaFuture: 27, nvaFuture: 4, fixedStation: null }
          ],
          precedences: [
            ['e01', 'e02'],
            ['e02', 'e05'],
            ['e03', 'e06'],
            ['e04', 'e06'],
            ['e05', 'e07'],
            ['e06', 'e07'],
            ['e07', 'e08'],
            ['e10', 'e11'],
            ['e08', 'e09'],
            ['e14', 'e15']
          ],
          auditLog: [
            { ts: '22/11/2026 08:00', actor: 'Eng. Processos', action: 'Baseline', detail: 'Estudo piloto carregado (Ciclo atual 256,3 s → futuro 96,0 s)' }
          ]
        },
        {
          id: 'study-chassi-b',
          name: 'Célula de Soldagem - Chassi B',
          product: 'Chassi B',
          shiftSeconds: 28800,
          days: 22,
          demand: 240,
          dailyVolume: 48.0,
          laborCurrent: 1520,
          laborFuture: 1140,
          oee: 92,
          capex: 22000,
          seasonalityPct: 0,
          author: 'Eng. Soldagem',
          revision: 'Rev. 2.1',
          stations: { current: 4, future: 3 },
          areas: [
            { name: 'Ponteamento MIG', costCurrent: 1.45, costFuture: 1.05 },
            { name: 'Solda Estrutural', costCurrent: 2.30, costFuture: 1.65 },
            { name: 'Acabamento & Inspeção', costCurrent: 1.15, costFuture: 0.80 }
          ],
          elements: [
            { id: 's01', area: 'Ponteamento MIG', name: 'Posicionar gabarito', currentStation: 1, vaCurrent: 35, nvaCurrent: 20, futureStation: 1, vaFuture: 35, nvaFuture: 6, fixedStation: null },
            { id: 's02', area: 'Ponteamento MIG', name: 'Pontear longarinas', currentStation: 1, vaCurrent: 45, nvaCurrent: 18, futureStation: 1, vaFuture: 45, nvaFuture: 5, fixedStation: null },
            { id: 's03', area: 'Solda Estrutural', name: 'Cordão principal A', currentStation: 2, vaCurrent: 68, nvaCurrent: 42, futureStation: 2, vaFuture: 68, nvaFuture: 10, fixedStation: null },
            { id: 's04', area: 'Solda Estrutural', name: 'Cordão reforço B', currentStation: 3, vaCurrent: 52, nvaCurrent: 25, futureStation: 3, vaFuture: 52, nvaFuture: 8, fixedStation: null },
            { id: 's05', area: 'Acabamento & Inspeção', name: 'Escovamento e ultrassom', currentStation: 4, vaCurrent: 32, nvaCurrent: 19, futureStation: 3, vaFuture: 32, nvaFuture: 7, fixedStation: null }
          ],
          precedences: [
            ['s01', 's02'],
            ['s02', 's03'],
            ['s03', 's04'],
            ['s04', 's05']
          ],
          auditLog: [
            { ts: '22/11/2026 09:15', actor: 'Eng. Soldagem', action: 'Baseline', detail: 'Célula de Soldagem Chassi B inicializada' }
          ]
        }
      ];
    }

    const normalizeStudy = normalize;



    let appState;
    let acceptedState;
    let readOnly=false;

    function saveAppState() {
      try {
        if(!appState?.studies.length) throw Error('O portfólio precisa de um estudo.');
        const next={activeStudyId:appState.activeStudyId,studies:appState.studies.map(s=>normalize(s))};
        const idx=appState.studies.findIndex(s=>s.id===appState.activeStudyId);
        next.activeStudyId=next.studies[Math.max(0,idx)].id;
        const commit=savePortfolio(next);
        acceptedState=structuredClone(next);appState=next;
        commit.catch(e=>showToast('Alteração não persistida: '+e.message));
      }catch(e){if(acceptedState)appState=structuredClone(acceptedState);renderAll();throw e;}
    }

    function getActiveStudy() {
      return appState?.studies.find(s => s.id === appState.activeStudyId) || appState?.studies[0];
    }

    // 3. GOVERNANCE, AUDIT TRAIL & UNDO STACK
    function recordAudit(action, detail, customStudy = null) {
      const study = customStudy || getActiveStudy();
      if (!study) return;
      study.auditLog = study.auditLog || [];
      study.auditLog.unshift({
        ts: new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
        actor: study.author || 'Eng. Processos',
        action,
        detail
      });
      if (study.auditLog.length > 60) study.auditLog.length = 60;
    }

    function pushUndoSnapshot() {
      const study = getActiveStudy();
      undoStack.push(JSON.stringify(study));
      if (undoStack.length > 25) undoStack.shift();
      const undoBtn = document.getElementById('undo-btn');
      if (undoBtn) undoBtn.disabled = false;
    }

    function undoLastAction() {
      if (undoStack.length === 0) return;
      const snapshot = JSON.parse(undoStack.pop());
      const idx = appState.studies.findIndex(s => s.id === snapshot.id);
      if (idx >= 0) {
        const history = appState.studies[idx].auditLog;
        appState.studies[idx] = normalizeStudy(snapshot);
        appState.studies[idx].auditLog=history;recordAudit('Desfazer', 'Versão anterior recuperada no editor.',appState.studies[idx]);
      }
      const undoBtn = document.getElementById('undo-btn');
      if (undoBtn) undoBtn.disabled = undoStack.length === 0;
      saveAppState();
      renderAll();
      showToast('Última alteração desfeita');
    }

    // 4. SINGLE SOURCE OF TRUTH METRICS & RPW BALANCING ENGINE
    function computeMetrics(study) {
      const stCurCount = Math.max(1, Number(study.stations.current) || 1);
      const stFutCount = Math.max(1, Number(study.stations.future) || 1);

      const currentLoads = Array(stCurCount).fill(0);
      const futureLoads = Array(stFutCount).fill(0);
      const futureVAStation = Array(stFutCount).fill(0);
      const futureNVAStation = Array(stFutCount).fill(0);

      let vaCurrentTotal = 0;
      let nvaCurrentTotal = 0;
      let vaFutureTotal = 0;
      let nvaFutureTotal = 0;
      let fixedElementsCount = 0;

      study.elements.forEach(el => {
        const vaC = safeNum(el.vaCurrent);
        const nvaC = safeNum(el.nvaCurrent);
        const vaF = safeNum(el.vaFuture);
        const nvaF = safeNum(el.nvaFuture);

        vaCurrentTotal += vaC;
        nvaCurrentTotal += nvaC;
        vaFutureTotal += vaF;
        nvaFutureTotal += nvaF;

        const cIdx = Math.min(stCurCount, Math.max(1, Number(el.currentStation) || 1)) - 1;
        const fIdx = Math.min(stFutCount, Math.max(1, Number(el.futureStation) || 1)) - 1;

        currentLoads[cIdx] += Math.round(vaC*1000) + Math.round(nvaC*1000);
        futureLoads[fIdx] += Math.round(vaF*1000) + Math.round(nvaF*1000);
        futureVAStation[fIdx] += vaF;
        futureNVAStation[fIdx] += nvaF;

        if (el.fixedStation != null && Number(el.fixedStation) >= 1) fixedElementsCount++;
      });

      currentLoads.forEach((v,i)=>currentLoads[i]=v/1000); futureLoads.forEach((v,i)=>futureLoads[i]=v/1000);
      const currentCycle = Math.max(0, ...currentLoads);
      const futureCycle = Math.max(0, ...futureLoads);
      const currentBottleneckIdx = currentLoads.indexOf(currentCycle);

      const oeeFactor = Math.min(100, Math.max(10, safeNum(study.oee) || 100)) / 100;
      const effectiveShiftSeconds = safeNum(study.shiftSeconds) * oeeFactor;
      const seasonalityMult = 1 + ((Number(study.seasonalityPct) || 0) / 100);
      const effectiveDemand = safeNum(study.demand) * seasonalityMult;
      const takt = effectiveDemand > 0 ? effectiveShiftSeconds / effectiveDemand : NaN;

      const totalWorkCurrent = vaCurrentTotal + nvaCurrentTotal;
      const totalWorkFuture = vaFutureTotal + nvaFutureTotal;

      const efficiencyCurrent = (stCurCount * currentCycle) > 0 ? (totalWorkCurrent / (stCurCount * currentCycle)) * 100 : 0;
      const efficiencyFuture = (stFutCount * futureCycle) > 0 ? (totalWorkFuture / (stFutCount * futureCycle)) * 100 : 0;
      const balanceDelayCurrent = Math.max(0, 100 - efficiencyCurrent);
      const balanceDelayFuture = Math.max(0, 100 - efficiencyFuture);
      const minTheoreticalStations = takt > 0 ? Math.max(1, Math.ceil(totalWorkFuture / takt)) : 1;

      const capCurrent = currentCycle > 0 ? effectiveShiftSeconds / currentCycle : 0;
      const capFuture = futureCycle > 0 ? effectiveShiftSeconds / futureCycle : 0;
      const cyclePctChange = currentCycle > 0 ? ((futureCycle / currentCycle) - 1) * 100 : 0;
      const capPctChange = capCurrent > 0 ? ((capFuture / capCurrent) - 1) * 100 : 0;

      const unitLaborCurrent = capCurrent > 0 ? safeNum(study.laborCurrent) / capCurrent : 0;
      const unitLaborFuture = capFuture > 0 ? safeNum(study.laborFuture) / capFuture : 0;
      const unitLaborSaving = unitLaborCurrent - unitLaborFuture;

      const opsCostCurrent = study.areas.reduce((s, a) => s + safeNum(a.costCurrent), 0);
      const opsCostFuture = study.areas.reduce((s, a) => s + safeNum(a.costFuture), 0);

      const effectiveDailyVolume = safeNum(study.dailyVolume) * seasonalityMult;
      const monthlySaving = unitLaborSaving * effectiveDailyVolume * safeNum(study.days);
      const capex = safeNum(study.capex);
      const paybackMonths = (capex > 0 && monthlySaving > 0) ? capex / monthlySaving : 0;
      const annualRoiPct = capex > 0 ? (((monthlySaving * 12) - capex) / capex) * 100 : 0;

      const elMap = new Map(study.elements.map(e => [e.id, e]));
      const violations = [];
      (study.precedences || []).forEach(([u, v]) => {
        const pred = elMap.get(u);
        const succ = elMap.get(v);
        if (pred && succ && Number(pred.futureStation) > Number(succ.futureStation)) {
          violations.push({ pred, succ });
        }
      });

      return {
        currentLoads,
        futureLoads,
        futureVAStation,
        futureNVAStation,
        currentCycle,
        futureCycle,
        currentBottleneckIdx,
        takt,
        effectiveDemand,
        vaCurrentTotal,
        nvaCurrentTotal,
        vaFutureTotal,
        nvaFutureTotal,
        efficiencyCurrent,
        efficiencyFuture,
        balanceDelayCurrent,
        balanceDelayFuture,
        minTheoreticalStations,
        capCurrent,
        capFuture,
        cyclePctChange,
        capPctChange,
        unitLaborCurrent,
        unitLaborFuture,
        unitLaborSaving,
        opsCostCurrent,
        opsCostFuture,
        monthlySaving,
        capex,
        paybackMonths,
        annualRoiPct,
        fixedElementsCount,
        violations
      };
    }

    function rebalanceRPW(){return propose('rpw',getActiveStudy().stations.future);}
    function propose(method,count) {
      const s=getActiveStudy();if(!s.elements.length)throw Error('Adicione elementos para balancear.');
      if(s.elements.some(e=>e.ergonomicZone==='red'&&!validException(e)))throw Error('A zona vermelha requer exceção aprovada e vigente.');
      const input=asDomain(s);input.stations.future=count;
      const result=method==='sa'?optimizeSimulatedAnnealing(input,900):solveRPW(input);
      const score=objectiveFor(input,result);
      const captured=JSON.stringify(s);
      openTools('proposal',{study:s,method,count,result,score,onApply:()=>{
        if(JSON.stringify(getActiveStudy())!==captured)throw Error('O estudo mudou. Recalcule a proposta.');
        pushUndoSnapshot();s.stations.future=count;
        const map=new Map(result.map(x=>[x.elementId,x.stationIndex]));
        s.elements.forEach(e=>e.futureStation=map.get(e.id));
        recordAudit('Balanceamento aplicado',method.toUpperCase()+' · '+count+' postos · ciclo '+fmt1(score.cycleSeconds.toNumber())+' s');
        saveAppState();renderAll();
      }});
    }

    function repairPrecedenceViolations(){rebalanceRPW();}

    // 5. RENDERING FUNCTIONS
    function renderHeaderAndParams(study, m) {
      const labelEl = document.getElementById('study-picker-label');
      const countEl = document.getElementById('study-picker-count');
      const listEl = document.getElementById('study-picker-list');
      if (labelEl) labelEl.textContent = study.name;
      if (countEl) countEl.textContent = `${appState.studies.length} ${appState.studies.length === 1 ? 'estudo' : 'estudos'}`;
      if (listEl) {
        listEl.innerHTML = appState.studies.map(s => {
          const isCurrent = s.id === study.id;
          return `
            <button type="button" role="option" aria-selected="${isCurrent}"
                    onclick="switchActiveStudy('${escHtml(s.id)}')"
                    class="w-full text-left px-3.5 py-2.5 flex items-center justify-between gap-2.5 transition cursor-pointer ${isCurrent ? 'bg-[#172B44] text-white' : 'bg-[#0F1B2B] hover:bg-[#15253A] text-slate-200'}">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="text-xs font-bold truncate ${isCurrent ? 'text-gold' : 'text-slate-100'}">${escHtml(s.name)}</span>
                </div>
                <div class="text-[10px] text-slate-400 mt-0.5 truncate">
                  ${escHtml(s.product)} • ${s.elements.length} elem. • ${s.stations.future} postos futuros
                </div>
              </div>
              ${isCurrent
                ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-gold/20 text-gold border border-gold/40 shrink-0">✓ Ativo</span>'
                : '<span class="text-[10px] text-sky-300/80 font-semibold shrink-0">Abrir →</span>'}
            </button>
          `;
        }).join('');
      }

      document.getElementById('input-product').value = study.product;
      document.getElementById('input-demand').value = study.demand;
      document.getElementById('input-daily-volume').value = study.dailyVolume;
      document.getElementById('input-labor-current').value = study.laborCurrent;
      document.getElementById('input-labor-future').value = study.laborFuture;

      document.getElementById('input-shift-seconds').value = study.shiftSeconds;
      document.getElementById('input-days').value = study.days;
      document.getElementById('input-oee').value = study.oee || 100;
      document.getElementById('input-capex').value = safeNum(study.capex);
      document.getElementById('input-author').value = study.author || 'Eng. Manufatura';
      document.getElementById('input-revision').value = study.revision || 'Rev. 1.0';

      document.getElementById('premise-takt-readout').textContent = fmt1(m.takt) + ' s';
      document.getElementById('card-takt-badge').textContent = 'Takt ' + fmt1(m.takt) + 's';

      const seasPct = Number(study.seasonalityPct) || 0;
      document.getElementById('seasonality-slider').value = seasPct;
      const seasBadge = document.getElementById('seasonality-badge');
      seasBadge.textContent = (seasPct > 0 ? '+' : '') + seasPct + '%';
      seasBadge.className = seasPct === 0
        ? 'px-2 py-0.5 rounded-md text-xs font-mono font-extrabold bg-obsidian-inner text-slate-200 border border-obsidian-border'
        : (seasPct > 0
          ? 'px-2 py-0.5 rounded-md text-xs font-mono font-extrabold bg-amber-500/20 text-gold border border-gold/40'
          : 'px-2 py-0.5 rounded-md text-xs font-mono font-extrabold bg-sky-500/20 text-sky-300 border border-sky-400/40');

      document.getElementById('seasonality-demand-readout').textContent = `${fmtInt(Math.round(m.effectiveDemand))} un/turno`;
      document.getElementById('seasonality-takt-readout').textContent = `${fmt1(m.takt)} s`;
      document.getElementById('strip-capex-val').textContent = fmtMoney(m.capex);
      document.getElementById('strip-payback-val').textContent = m.paybackMonths > 0 ? `${fmt1(m.paybackMonths)} meses` : (m.capex === 0 ? 'Imediato (R$ 0)' : 'Sem retorno');
      document.getElementById('strip-roi-val').textContent = m.capex > 0 ? fmtPct(m.annualRoiPct) : '—';
    }

    function renderDAG(study, m) {
      const svg = document.getElementById('dag-svg');
      const alertBox = document.getElementById('precedence-alert');
      const alertText = document.getElementById('precedence-alert-text');
      const edgeCountLabel = document.getElementById('dag-edge-count');

      const edges = study.precedences || [];
      edgeCountLabel.textContent = `${edges.length} regras • ${m.fixedElementsCount} fixos`;

      if (m.violations.length > 0) {
        const first = m.violations[0];
        alertText.textContent = `${m.violations.length} violação(ões): "${first.pred.name}" (F${first.pred.futureStation}) deve vir antes de "${first.succ.name}" (F${first.succ.futureStation})`;
        alertBox.classList.remove('hidden');
      } else {
        alertBox.classList.add('hidden');
      }

      const count = Math.max(1, Number(study.stations.future) || 1);
      const nodes = [];
      const rx = 115;
      const ry = 76;
      for (let i = 0; i < count; i++) {
        const angle = (-Math.PI / 2) + (i * 2 * Math.PI / count);
        nodes.push({
          code: 'F' + (i + 1),
          label: 'Posto ' + (i + 1),
          time: m.futureLoads[i] || 0,
          x: 180 + Math.cos(angle) * rx,
          y: 118 + Math.sin(angle) * ry,
          isCritical: (m.futureLoads[i] || 0) > m.takt
        });
      }

      let html = `
        <defs>
          <marker id="arrow-gold" viewBox="0 0 10 10" refX="26" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#F4BA25" />
          </marker>
          <marker id="arrow-sky" viewBox="0 0 10 10" refX="26" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#38BDF8" />
          </marker>
        </defs>
      `;

      const stationById = new Map(study.elements.map(e=>[e.id,e.futureStation]));
      const pairs = new Set(edges.map(([u,v])=>stationById.get(u)+','+stationById.get(v)));
      for (const pair of pairs) {
        const [from,to]=pair.split(',').map(Number);
        if(from===to)continue;
        const a=nodes[from-1], b=nodes[to-1];
        const isCritEdge = a.isCritical || b.isCritical;
        html += `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${isCritEdge ? '#F4BA25' : '#38BDF8'}" stroke-width="1.8" stroke-opacity="0.75" marker-end="url(#${isCritEdge ? 'arrow-gold' : 'arrow-sky'})" />`;
      }

      nodes.forEach(n => {
        const fill = n.isCritical ? '#3B2618' : '#163552';
        const stroke = n.isCritical ? '#F4BA25' : '#38BDF8';
        html += `
          <g class="cursor-pointer" onmouseenter="showDagTooltip('Posto ${n.code}: ${fmt1(n.time)}s (Takt ${fmt1(m.takt)}s)')" onmouseleave="hideDagTooltip()">
            <circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="26" fill="${fill}" stroke="${stroke}" stroke-width="2" />
            <text x="${n.x.toFixed(1)}" y="${(n.y - 3).toFixed(1)}" text-anchor="middle" fill="#FFFFFF" font-size="10.5" font-weight="700">${n.label}</text>
            <text x="${n.x.toFixed(1)}" y="${(n.y + 11).toFixed(1)}" text-anchor="middle" fill="${n.isCritical ? '#F4BA25' : '#7DD3FC'}" font-size="9.5" font-weight="600">${fmt1(n.time)}s</text>
          </g>
        `;
      });

      svg.innerHTML = html;
    }

    function showDagTooltip(text) {
      const tip = document.getElementById('dag-tooltip');
      if (!tip) return;
      tip.textContent = text;
      tip.classList.remove('hidden');
    }

    function hideDagTooltip() {
      const tip = document.getElementById('dag-tooltip');
      if (tip) tip.classList.add('hidden');
    }

    function renderStations(study, m) {
      const container = document.getElementById('stations-container');
      const count = Math.max(1, Number(study.stations.future) || 1);

      let html = '';
      for (let st = 1; st <= count; st++) {
        const load = m.futureLoads[st - 1] || 0;
        const isOverTakt = load > m.takt;
        const stationElements = study.elements.filter(el => Number(el.futureStation) === st);

        html += `
          <div class="station-dropzone rounded-xl border ${isOverTakt ? 'border-rose-500/60 bg-rose-500/10' : 'border-obsidian-border bg-obsidian-slot'} p-2 transition"
               ondragover="event.preventDefault(); this.classList.add('drag-over')"
               ondragleave="this.classList.remove('drag-over')"
               ondrop="handleStationDrop(event, ${st})">
            <div class="flex items-center justify-between gap-2 mb-1.5">
              <div class="flex items-center gap-2">
                <span class="px-2 py-0.5 rounded-md text-[11px] font-bold ${isOverTakt ? 'bg-rose-500 text-white' : 'bg-obsidian-inner text-slate-200 border border-obsidian-border'}">
                  Posto ${st} (F${st})
                </span>
                ${isOverTakt ? `<span class="px-2 py-0.5 rounded bg-rose-600 text-white text-[10px] font-extrabold uppercase tracking-wide">Gargalo (+${fmt1(load - m.takt)}s)</span>` : ''}
              </div>
              <span class="text-xs font-extrabold tabular-nums ${isOverTakt ? 'text-rose-300' : 'text-emerald-400'}">${fmt1(load)} s</span>
            </div>

            <div class="flex flex-wrap gap-1.5 min-h-[28px]">
              ${stationElements.length === 0
                ? `<span class="text-[11px] text-slate-500 italic px-1 py-0.5">Arraste elementos aqui</span>`
                : stationElements.map(el => {
                    const dur = safeNum(el.vaFuture) + safeNum(el.nvaFuture);
                    const isPinned = Number(el.fixedStation) === st;
                    return `
                      <div draggable="${!isPinned}"
                           ondragstart="handleElementDragStart(event, '${escHtml(el.id)}')"
                           class="${isPinned ? 'cursor-default border-gold/60 bg-[#252015]' : 'cursor-grab active:cursor-grabbing border-sky-400/25 bg-obsidian-inner hover:bg-slate-700/90'} px-2 py-1 rounded-lg border text-[11px] text-slate-100 flex items-center gap-1.5 shadow-xs"
                           title="${escHtml(el.area)} • VA ${fmt1(el.vaFuture)}s + NVA ${fmt1(el.nvaFuture)}s${isPinned ? ' • Monumento fixo neste posto' : ''}">
                        <button type="button" onclick="toggleElementFixedStation('${escHtml(el.id)}', ${st})" class="text-[10px] ${isPinned ? 'text-gold' : 'text-slate-400 hover:text-gold'} transition cursor-pointer" title="${isPinned ? 'Desafixar monumento deste posto' : 'Fixar como monumento no Posto F' + st}">
                          ${isPinned ? '📌' : '○'}
                        </button>
                        <span class="truncate max-w-[115px]">${escHtml(el.name)}</span>
                        <span class="font-mono font-bold text-gold tabular-nums">${fmt1(dur)}s</span>
                      </div>
                    `;
                  }).join('')
              }
            </div>
          </div>
        `;
      }

      container.innerHTML = html;

      // Update Efficiency, Smoothness Index (SI), Monte Carlo Takt Risk & Min Stations
      const effVal = document.getElementById('station-efficiency-val');
      const siVal = document.getElementById('station-smoothness-val');
      const mcBadge = document.getElementById('monte-carlo-risk-badge');
      const minVal = document.getElementById('station-min-val');

      const si = computeSmoothnessIndex(m.futureLoads, m.futureCycle);
      const mc = runMonteCarloSimulation(study, m, 600);

      if (effVal) effVal.textContent = fmt1(m.efficiencyFuture) + '%';
      if (siVal) siVal.textContent = fmt1(si) + 's';
      if (minVal) minVal.textContent = String(m.minTheoreticalStations);
      if (mcBadge) {
        const risk = mc.overrunProbabilityPct==null?null:Math.round(mc.overrunProbabilityPct);
        mcBadge.textContent = risk==null?'Risco Takt: —':`Risco Takt: ${risk}%`;
        mcBadge.className = risk > 35
          ? 'px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 font-bold tabular-nums'
          : (risk > 12
            ? 'px-1.5 py-0.5 rounded bg-amber-500/20 text-gold border border-gold/40 font-bold tabular-nums'
            : 'px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-bold tabular-nums');
      }

      const statusBar = document.getElementById('station-status-bar');
      const statusText = document.getElementById('station-status-text');
      const cycleVal = document.getElementById('station-cycle-val');
      cycleVal.textContent = fmt1(m.futureCycle) + 's';

      if (m.futureCycle > 0 && m.futureCycle <= m.takt) {
        statusBar.className = 'px-3 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/35 flex items-center justify-between text-xs';
        statusText.className = 'font-semibold text-emerald-300';
        statusText.textContent = m.futureCycle===m.takt?'Linha balanceada · no Takt':`Linha balanceada · ${fmt1(m.takt - m.futureCycle)}s abaixo do takt`;
      } else {
        statusBar.className = 'px-3 py-2 rounded-xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-between text-xs';
        statusText.className = 'font-semibold text-amber-300';
        statusText.textContent = `Atenção · ${fmt1(m.futureCycle - m.takt)}s acima do takt`;
      }
    }

    let draggedElementId = null;
    function handleElementDragStart(event, id) {
      draggedElementId = id;
      event.dataTransfer.setData('text/plain', id);
    }

    function handleStationDrop(event,target) {
      event.preventDefault();event.currentTarget.classList.remove('drag-over');
      const id=event.dataTransfer.getData('text/plain')||draggedElementId;
      draggedElementId=null;
      if(id)updateElementField(id,'futureStation',target);
    }

    function setChartMode(mode) {
      chartMode = mode;
      document.querySelectorAll('.chart-mode-btn').forEach(btn => {
        const active = btn.dataset.chartMode === mode;
        btn.className = active
          ? 'chart-mode-btn px-2 py-1 rounded-lg text-[10px] font-bold bg-cyanbar text-white transition'
          : 'chart-mode-btn px-2 py-1 rounded-lg text-[10px] font-bold text-slate-400 hover:text-white transition';
      });
      const title = document.getElementById('chart-card-title');
      const subtitle = document.getElementById('chart-card-subtitle');
      const legend = document.getElementById('chart-legend-bar');

      if (mode === 'future') {
        title.textContent = 'Estado Futuro';
        subtitle.textContent = 'Carga por posto vs. Takt Time';
        legend.innerHTML = `
          <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-xs bg-cyanbar inline-block"></span> Ciclo do Posto</span>
          <span class="flex items-center gap-1.5"><span class="w-3.5 border-t-2 border-dashed border-gold inline-block"></span> Takt Time</span>
          <span class="text-emerald-400 font-semibold">● Tempo Real</span>
        `;
      } else if (mode === 'yamazumi') {
        title.textContent = 'Gráfico Yamazumi (Futuro)';
        subtitle.textContent = 'Composição empilhada VA × NVA × Ociosidade';
        legend.innerHTML = `
          <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-xs bg-sky-400 inline-block"></span> VA</span>
          <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-xs bg-amber-400 inline-block"></span> NVA</span>
          <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-xs border border-dashed border-slate-400 inline-block"></span> Ociosidade</span>
          <span class="flex items-center gap-1.5"><span class="w-3 border-t-2 border-dashed border-gold inline-block"></span> Takt</span>
        `;
      } else if (mode === 'current') {
        title.textContent = 'Estado Atual — Gargalo Crítico';
        subtitle.textContent = 'Diagnóstico inicial cronometrado';
        legend.innerHTML = `
          <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-xs bg-cyanbar inline-block"></span> Posto Normal</span>
          <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-xs bg-rose-500 inline-block"></span> Gargalo</span>
          <span class="flex items-center gap-1.5"><span class="w-3 border-t-2 border-dashed border-gold inline-block"></span> Takt</span>
        `;
      } else {
        title.textContent = 'Comparativo Atual × Futuro';
        subtitle.textContent = 'Evolução lado a lado por posto';
        legend.innerHTML = `
          <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-xs bg-slate-500 inline-block"></span> Atual</span>
          <span class="flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-xs bg-cyanbar inline-block"></span> Futuro</span>
          <span class="flex items-center gap-1.5"><span class="w-3 border-t-2 border-dashed border-gold inline-block"></span> Takt</span>
        `;
      }

      if(getActiveStudy())renderChart(getActiveStudy(), computeMetrics(getActiveStudy()));
    }

    let chartBarHitboxes = [];

    function renderChart(study, m) {
      const canvas = document.getElementById('cycle-canvas');
      if (!canvas) return;
      const box = canvas.getBoundingClientRect();
      if (!box.width || !box.height) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(box.width * dpr);
      canvas.height = Math.round(box.height * dpr);
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);

      const w = box.width;
      const h = box.height;
      const pad = { left: 34, right: 14, top: 20, bottom: 28 };
      const plotW = w - pad.left - pad.right;
      const plotH = h - pad.top - pad.bottom;

      chartBarHitboxes = [];
      ctx.clearRect(0, 0, w, h);

      const valuesPrimary = chartMode === 'current' ? m.currentLoads : m.futureLoads;
      const maxVal = Math.max(250, ...m.currentLoads, ...m.futureLoads, Number.isFinite(m.takt)?m.takt*1.15:0);
      const magnitude=10**Math.floor(Math.log10(maxVal/5));
      const step=([1,2,5,10].find(n=>n*magnitude>=maxVal/6)??10)*magnitude;
      const ceiling=Math.ceil(maxVal/step)*step;
      const yPos = val => pad.top + plotH - (val / ceiling) * plotH;

      ctx.font = '10px Inter, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (let v = 0; v <= ceiling; v += step) {
        const py = yPos(v);
        ctx.beginPath();
        ctx.moveTo(pad.left, py);
        ctx.lineTo(w - pad.right, py);
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = '#64748B';
        ctx.fillText(String(v), pad.left - 6, py);
      }

      if (chartMode === 'yamazumi') {
        const n = m.futureLoads.length;
        const gap = Math.min(14,plotW/(n*3));
        const barW = Math.min(46, (plotW - gap * (n - 1)) / n);
        const totalW = n * barW + (n - 1) * gap;
        const startX = pad.left + (plotW - totalW) / 2;

        m.futureLoads.forEach((totalVal, i) => {
          const vaVal = m.futureVAStation[i] || 0;
          const nvaVal = m.futureNVAStation[i] || 0;
          const idleVal = Math.max(0, m.takt - totalVal);
          const bx = startX + i * (barW + gap);

          const yBase = pad.top + plotH;
          const yVaTop = yPos(vaVal);
          const yNvaTop = yPos(vaVal + nvaVal);

          if (vaVal > 0) {
            ctx.fillStyle = '#38BDF8';
            ctx.fillRect(bx, yVaTop, barW, Math.max(1, yBase - yVaTop));
          }
          if (nvaVal > 0) {
            ctx.fillStyle = '#F59E0B';
            ctx.fillRect(bx, yNvaTop, barW, Math.max(1, yVaTop - yNvaTop));
          }
          if (idleVal > 0.2 && m.takt <= ceiling) {
            const yTaktTop = yPos(m.takt);
            ctx.save();
            ctx.fillStyle = 'rgba(148, 163, 184, 0.10)';
            ctx.fillRect(bx, yTaktTop, barW, Math.max(1, yNvaTop - yTaktTop));
            ctx.setLineDash([3, 3]);
            ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
            ctx.strokeRect(bx + 0.5, yTaktTop + 0.5, barW - 1, Math.max(1, yNvaTop - yTaktTop - 1));
            ctx.restore();
          }

          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillStyle = totalVal > m.takt ? '#FDA4AF' : '#E2E8F0';
          ctx.font = '700 10px Inter, sans-serif';
          ctx.fillText(fmt1(totalVal), bx + barW / 2, yNvaTop - 4);

          ctx.textBaseline = 'top';
          ctx.fillStyle = '#CBD5E1';
          ctx.font = '600 10px Inter, sans-serif';
          ctx.fillText(`F${i + 1}`, bx + barW / 2, pad.top + plotH + 8);

          chartBarHitboxes.push({
            x: bx,
            y: Math.min(yNvaTop, m.takt <= ceiling ? yPos(m.takt) : yNvaTop),
            w: barW,
            h: yBase - Math.min(yNvaTop, m.takt <= ceiling ? yPos(m.takt) : yNvaTop),
            label: `F${i + 1} Yamazumi • VA: ${fmt1(vaVal)}s | NVA: ${fmt1(nvaVal)}s | Ociosidade: ${fmt1(idleVal)}s`
          });
        });
      } else if (chartMode === 'compare') {
        const stationCount = Math.max(m.currentLoads.length, m.futureLoads.length);
        const groupW = plotW / stationCount;
        const barW = Math.min(22, groupW * 0.34);

        for (let i = 0; i < stationCount; i++) {
          const cx = pad.left + i * groupW + groupW / 2;
          const vCur = m.currentLoads[i] || 0;
          const vFut = m.futureLoads[i] || 0;

          if (i < m.currentLoads.length) {
            const yC = yPos(vCur);
            const hC = Math.max(2, pad.top + plotH - yC);
            ctx.fillStyle = vCur > m.takt ? '#E11D48' : '#475569';
            ctx.fillRect(cx - barW - 2, yC, barW, hC);
            chartBarHitboxes.push({ x: cx - barW - 2, y: yC, w: barW, h: hC, label: `F${i + 1} Atual: ${fmt1(vCur)}s` });
          }

          if (i < m.futureLoads.length) {
            const yF = yPos(vFut);
            const hF = Math.max(2, pad.top + plotH - yF);
            ctx.fillStyle = vFut > m.takt ? '#F43F5E' : '#1E90B8';
            ctx.fillRect(cx + 2, yF, barW, hF);
            chartBarHitboxes.push({ x: cx + 2, y: yF, w: barW, h: hF, label: `F${i + 1} Futuro: ${fmt1(vFut)}s` });
          }

          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillStyle = '#CBD5E1';
          ctx.font = '600 10px Inter, sans-serif';
          ctx.fillText(`F${i + 1}`, cx, pad.top + plotH + 8);
        }
      } else {
        const n = valuesPrimary.length;
        const gap = Math.min(14,plotW/(n*3));
        const barW = Math.min(44, (plotW - gap * (n - 1)) / n);
        const totalW = n * barW + (n - 1) * gap;
        const startX = pad.left + (plotW - totalW) / 2;

        valuesPrimary.forEach((val, i) => {
          const bx = startX + i * (barW + gap);
          const by = yPos(val);
          const bh = Math.max(2, pad.top + plotH - by);
          const isBottleneck = chartMode === 'current' ? val > 0 && val === m.currentCycle : val > m.takt;

          const grad = ctx.createLinearGradient(0, by, 0, pad.top + plotH);
          if (isBottleneck) {
            grad.addColorStop(0, '#F43F5E');
            grad.addColorStop(1, '#9F1239');
          } else {
            grad.addColorStop(0, '#38BDF8');
            grad.addColorStop(1, '#16658A');
          }

          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.roundRect(bx, by, barW, bh, [4, 4, 0, 0]);
          ctx.fill();

          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillStyle = isBottleneck ? '#FDA4AF' : '#E2E8F0';
          ctx.font = '700 10px Inter, sans-serif';
          ctx.fillText(fmt1(val), bx + barW / 2, by - 4);

          ctx.textBaseline = 'top';
          ctx.fillStyle = '#CBD5E1';
          ctx.font = '600 10px Inter, sans-serif';
          ctx.fillText(`F${i + 1}`, bx + barW / 2, pad.top + plotH + 8);

          const sat = m.takt > 0 ? (val / m.takt) * 100 : 0;
          chartBarHitboxes.push({
            x: bx,
            y: by,
            w: barW,
            h: bh,
            label: `Posto F${i + 1}: ${fmt1(val)}s • Saturação: ${fmt1(sat)}%`
          });
        });
      }

      if (m.takt > 0 && m.takt <= ceiling) {
        const ty = yPos(m.takt);
        ctx.save();
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(pad.left, ty);
        ctx.lineTo(w - pad.right, ty);
        ctx.strokeStyle = '#F4BA25';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();

        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = '#F4BA25';
        ctx.font = '700 10px Inter, sans-serif';
        ctx.fillText(`Takt Time ${fmt1(m.takt)}s`, w - pad.right - 4, ty - 4);
      }
    }

    // 6. WORK COMPOSITION MASTER-DETAIL TABLE
    function setWorkFilter(val) {
      workFilterQuery = String(val || '').trim().toLowerCase();
      renderWorkCompositionTable(getActiveStudy(), computeMetrics(getActiveStudy()));
    }

    function toggleWorkSort(key) {
      if (workSort.key === key) {
        if (workSort.dir === 'asc') workSort.dir = 'desc';
        else workSort = { key: null, dir: 'asc' };
      } else {
        workSort = { key, dir: 'desc' };
      }
      ['name', 'totCur', 'totFut', 'costCur', 'costFut'].forEach(k => {
        const el = document.getElementById('sort-icon-' + k);
        if (!el) return;
        if (workSort.key === k) {
          el.textContent = workSort.dir === 'asc' ? '↑' : '↓';
          el.className = 'text-[11px] font-mono font-extrabold text-gold';
        } else {
          el.textContent = '⇅';
          el.className = 'text-[11px] font-mono text-slate-400';
        }
      });
      renderWorkCompositionTable(getActiveStudy(), computeMetrics(getActiveStudy()));
    }

    function renderStepper(inputId, value, step, min, textColorClass, widthClass, onChangeAttr) {
      return `
        <div class="num-stepper">
          <input id="${inputId}" type="number" min="${min}" step="${step}" value="${value}"
                 onchange="${onChangeAttr}"
                 class="${widthClass} text-right px-2 py-1 text-xs font-semibold ${textColorClass}" />
          <div class="num-stepper-btns">
            <button type="button" class="num-stepper-btn" onclick="stepInput('${inputId}', ${step})" aria-label="Aumentar">▲</button>
            <button type="button" class="num-stepper-btn" onclick="stepInput('${inputId}', ${-step})" aria-label="Diminuir">▼</button>
          </div>
        </div>
      `;
    }

    function renderWorkCompositionTable(study, m) {
      const tbody = document.getElementById('work-table-body');
      const tfoot = document.getElementById('work-table-foot');

      let enrichedAreas = study.areas.map((area, areaIdx) => {
        const allAreaElements = study.elements.filter(e => e.area === area.name);
        const vaCur = allAreaElements.reduce((s, e) => s + safeNum(e.vaCurrent), 0);
        const nvaCur = allAreaElements.reduce((s, e) => s + safeNum(e.nvaCurrent), 0);
        const totCur = vaCur + nvaCur;
        const vaFut = allAreaElements.reduce((s, e) => s + safeNum(e.vaFuture), 0);
        const nvaFut = allAreaElements.reduce((s, e) => s + safeNum(e.nvaFuture), 0);
        const totFut = vaFut + nvaFut;
        return { area, areaIdx, allAreaElements, vaCur, nvaCur, totCur, vaFut, nvaFut, totFut };
      });

      if (workSort.key) {
        const mult = workSort.dir === 'asc' ? 1 : -1;
        enrichedAreas.sort((a, b) => {
          if (workSort.key === 'name') return a.area.name.localeCompare(b.area.name, 'pt-BR') * mult;
          if (workSort.key === 'totCur') return (a.totCur - b.totCur) * mult;
          if (workSort.key === 'totFut') return (a.totFut - b.totFut) * mult;
          if (workSort.key === 'costCur') return (safeNum(a.area.costCurrent) - safeNum(b.area.costCurrent)) * mult;
          if (workSort.key === 'costFut') return (safeNum(a.area.costFuture) - safeNum(b.area.costFuture)) * mult;
          return 0;
        });
      }

      let rowsHtml = '';

      enrichedAreas.forEach(item => {
        const { area, areaIdx, allAreaElements, vaCur, nvaCur, totCur, vaFut, nvaFut, totFut } = item;
        const areaMatches = !workFilterQuery || area.name.toLowerCase().includes(workFilterQuery);
        const matchingElements = workFilterQuery
          ? allAreaElements.filter(e =>
              e.name.toLowerCase().includes(workFilterQuery) ||
              e.id.toLowerCase().includes(workFilterQuery) ||
              ('f' + e.currentStation) === workFilterQuery ||
              ('f' + e.futureStation) === workFilterQuery
            )
          : allAreaElements;

        if (workFilterQuery && !areaMatches && matchingElements.length === 0) return;

        const isExpanded = expandedAreas.has(area.name) || (workFilterQuery.length > 0 && matchingElements.length > 0);
        const elementsToRender = (workFilterQuery && !areaMatches) ? matchingElements : allAreaElements;

        rowsHtml += `
          <tr class="bg-obsidian-card hover:bg-obsidian-inner/70 transition">
            <td class="py-2.5 px-3.5 font-semibold text-white">
              <div class="flex flex-wrap items-center gap-2">
                <button type="button"
                        onclick="toggleAreaDetails(getActiveStudy().areas[${areaIdx}].name)"
                        class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold transition cursor-pointer ${isExpanded ? 'bg-gold/20 text-gold border border-gold/45 shadow-xs' : 'bg-sky-500/15 text-sky-300 border border-sky-400/35 hover:bg-sky-500/25'}">
                  <span>${isExpanded ? '− ocultar detalhes' : '+ mostrar detalhes'}</span>
                </button>
                <span>${escHtml(area.name)}</span>
                <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-obsidian-slot text-slate-400 border border-obsidian-border">${allAreaElements.length} el.</span>
              </div>
            </td>
            <td class="py-2.5 px-3 text-right text-sky-300 font-semibold">${fmt1(vaCur)}</td>
            <td class="py-2.5 px-3 text-right text-amber-300 font-semibold">${fmt1(nvaCur)}</td>
            <td class="py-2.5 px-3 text-right text-white font-bold">${fmt1(totCur)}</td>
            <td class="py-2.5 px-3 text-right text-sky-300 font-semibold">${fmt1(vaFut)}</td>
            <td class="py-2.5 px-3 text-right text-emerald-300 font-semibold">${fmt1(nvaFut)}</td>
            <td class="py-2.5 px-3 text-right text-white font-bold">${fmt1(totFut)}</td>
            <td class="py-2.5 px-3 text-right">
              ${renderStepper(`area-cost-cur-${areaIdx}`, Number(area.costCurrent).toFixed(2), 0.05, 0, 'text-slate-200', 'w-14', `updateAreaCost(${areaIdx}, 'costCurrent', this.value)`)}
            </td>
            <td class="py-2.5 px-3 text-right">
              ${renderStepper(`area-cost-fut-${areaIdx}`, Number(area.costFuture).toFixed(2), 0.05, 0, 'text-emerald-300', 'w-14', `updateAreaCost(${areaIdx}, 'costFuture', this.value)`)}
            </td>
            <td class="py-2.5 px-3 text-center">
              <div class="inline-flex items-center gap-1">
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#163654] text-sky-300 border border-sky-400/30">VA</span>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#3E3219] text-gold border border-gold/30">NVA</span>
              </div>
            </td>
            <td class="py-2.5 px-2 text-center">
              <button type="button" onclick="removeArea(${areaIdx})" class="text-rose-400 hover:text-rose-300 font-bold px-1.5 py-0.5 rounded" title="Excluir área">🗑</button>
            </td>
          </tr>
        `;

        if (isExpanded) {
          elementsToRender.forEach(el => {
            const elTotCur = safeNum(el.vaCurrent) + safeNum(el.nvaCurrent);
            const elTotFut = safeNum(el.vaFuture) + safeNum(el.nvaFuture);
            const safeElId = escHtml(el.id);

            rowsHtml += `
              <tr class="bg-[#0E1724] text-[11px] text-slate-300">
                <td class="py-2 pl-9 pr-3">
                  <div class="flex items-center gap-2">
                    <span class="font-mono text-[10px] text-gold">${escHtml(el.id.toUpperCase())}</span>
                    <input type="text" value="${escHtml(el.name)}"
                           onchange="updateElementField('${safeElId}', 'name', this.value)"
                           class="bg-transparent border-b border-transparent focus:border-gold text-slate-200 focus:outline-none w-full" />
                  </div>
                </td>
                <td class="py-2 px-3 text-right">
                  ${renderStepper(`el-${safeElId}-vaCur`, el.vaCurrent, 0.5, 0, 'text-sky-200', 'w-12', `updateElementField('${safeElId}', 'vaCurrent', this.value)`)}
                </td>
                <td class="py-2 px-3 text-right">
                  ${renderStepper(`el-${safeElId}-nvaCur`, el.nvaCurrent, 0.5, 0, 'text-amber-200', 'w-12', `updateElementField('${safeElId}', 'nvaCurrent', this.value)`)}
                </td>
                <td class="py-2 px-3 text-right font-semibold text-slate-200">${fmt1(elTotCur)}</td>
                <td class="py-2 px-3 text-right">
                  ${renderStepper(`el-${safeElId}-vaFut`, el.vaFuture, 0.5, 0, 'text-sky-200', 'w-12', `updateElementField('${safeElId}', 'vaFuture', this.value)`)}
                </td>
                <td class="py-2 px-3 text-right">
                  ${renderStepper(`el-${safeElId}-nvaFut`, el.nvaFuture, 0.5, 0, 'text-emerald-300', 'w-12', `updateElementField('${safeElId}', 'nvaFuture', this.value)`)}
                </td>
                <td class="py-2 px-3 text-right font-semibold text-white">${fmt1(elTotFut)}</td>
                <td colspan="2" class="py-2 px-3 text-center">
                  <div class="inline-flex items-center gap-1.5 text-[10px]">
                    <span class="text-slate-400">Posto Atual:</span>
                    <select onchange="updateElementField('${safeElId}', 'currentStation', this.value)" class="custom-select bg-obsidian-card border border-obsidian-border hover:border-gold/50 rounded-md pl-2 py-0.5 text-white font-semibold cursor-pointer">
                      ${Array.from({ length: study.stations.current }, (_, k) => `<option value="${k + 1}" ${Number(el.currentStation) === k + 1 ? 'selected' : ''}>F${k + 1}</option>`).join('')}
                    </select>
                    <span class="text-slate-400 ml-1">Futuro:</span>
                    <select onchange="updateElementField('${safeElId}', 'futureStation', this.value)" class="custom-select bg-obsidian-card border border-gold/40 hover:border-gold rounded-md pl-2 py-0.5 text-gold font-bold cursor-pointer">
                      ${Array.from({ length: study.stations.future }, (_, k) => `<option value="${k + 1}" ${Number(el.futureStation) === k + 1 ? 'selected' : ''}>F${k + 1}</option>`).join('')}
                    </select>
                    <button type="button" onclick="toggleElementFixedStation('${safeElId}', ${Number(el.futureStation)})"
                            class="ml-1 px-1.5 py-0.5 rounded border text-[10px] font-bold transition cursor-pointer ${el.fixedStation ? 'bg-gold/20 border-gold text-gold' : 'bg-obsidian-card border-obsidian-border text-slate-400 hover:text-gold'}"
                            title="${el.fixedStation ? 'Monumento fixo em F' + el.fixedStation + ' (clique para liberar)' : 'Fixar elemento como monumento no posto futuro'}">
                      ${el.fixedStation ? '📌 Fixo' : 'Fixar'}
                    </button>
                  </div>
                </td>
                <td class="py-2 px-3 text-center text-[10px] text-slate-400">Elemento</td>
                <td class="py-2 px-2 text-center">
                  <button type="button" onclick="removeElement('${safeElId}')" class="text-slate-400 hover:text-rose-400 font-bold" title="Remover elemento">×</button>
                </td>
              </tr>
            `;
          });
        }
      });

      tbody.innerHTML = rowsHtml;

      tfoot.innerHTML = `
        <tr>
          <td class="py-3 px-3.5 text-gold uppercase tracking-wide">TOTAL POR PEÇA</td>
          <td class="py-3 px-3 text-right text-sky-300">${fmt1(m.vaCurrentTotal)}</td>
          <td class="py-3 px-3 text-right text-amber-300">${fmt1(m.nvaCurrentTotal)}</td>
          <td class="py-3 px-3 text-right">${fmt1(m.vaCurrentTotal + m.nvaCurrentTotal)}</td>
          <td class="py-3 px-3 text-right text-sky-300">${fmt1(m.vaFutureTotal)}</td>
          <td class="py-3 px-3 text-right text-emerald-300">${fmt1(m.nvaFutureTotal)}</td>
          <td class="py-3 px-3 text-right">${fmt1(m.vaFutureTotal + m.nvaFutureTotal)}</td>
          <td class="py-3 px-3 text-right">${fmtMoney2(m.opsCostCurrent)}</td>
          <td class="py-3 px-3 text-right text-emerald-400">${fmtMoney2(m.opsCostFuture)}</td>
          <td colspan="2" class="py-3 px-3 text-center text-[10px] font-medium text-slate-400">Fonte Única da Verdade</td>
        </tr>
      `;
    }

    function renderKPIsAndFinancials(study, m) {
      const cycleIsGain = m.cyclePctChange <= 0;
      const cyclePctEl = document.getElementById('kpi-cycle-pct');
      const cycleBadgeEl = document.getElementById('kpi-cycle-badge');
      const cycleAccentEl = document.getElementById('kpi-cycle-accent');

      cyclePctEl.textContent = fmtPct(m.cyclePctChange);
      cyclePctEl.className = `text-xl sm:text-[22px] font-extrabold tracking-tight leading-none ${cycleIsGain ? 'text-emerald-400' : 'text-rose-400'}`;
      if (cycleBadgeEl) {
        cycleBadgeEl.textContent = cycleIsGain ? 'GANHO' : 'ALERTA';
        cycleBadgeEl.className = cycleIsGain
          ? 'px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
          : 'px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-rose-500/15 text-rose-300 border border-rose-500/30';
      }
      if (cycleAccentEl) {
        cycleAccentEl.className = cycleIsGain
          ? 'absolute top-0 inset-x-0 h-0.5 bg-gradient-to-r from-emerald-400/80 to-emerald-500/20'
          : 'absolute top-0 inset-x-0 h-0.5 bg-gradient-to-r from-rose-500/90 to-rose-500/20';
      }

      document.getElementById('kpi-cap-pct').textContent = fmtPct(m.capPctChange);
      document.getElementById('kpi-unit-saving').textContent = fmtMoney2(m.unitLaborSaving);
      document.getElementById('kpi-monthly-saving').textContent = fmtMoney(m.monthlySaving);

      document.getElementById('kpi-cycle-vals').textContent = `${fmt1(m.currentCycle)}s ➜ ${fmt1(m.futureCycle)}s`;
      document.getElementById('kpi-cap-vals').textContent = `${fmt1(m.capCurrent)} ➜ ${fmt1(m.capFuture)}`;
      document.getElementById('kpi-mo-vals').textContent = `${fmtMoney2(m.unitLaborCurrent)} ➜ ${fmt2(m.unitLaborFuture)}`;
      document.getElementById('kpi-payback-vals').textContent = m.paybackMonths > 0
        ? `${fmt1(m.paybackMonths)}m • ${fmtPct(m.annualRoiPct)}`
        : (m.capex === 0 ? 'Sem CAPEX • ROI ∞' : 'Sem retorno');

      const circ = 238.76;
      const totalCurrentUnitCost = m.unitLaborCurrent + m.opsCostCurrent;
      const totalFutureUnitCost = m.unitLaborFuture + m.opsCostFuture;
      const moRatio = totalFutureUnitCost > 0 ? m.unitLaborFuture / totalFutureUnitCost : 0.5;
      const moDash = moRatio * circ;
      const opsDash = (1 - moRatio) * circ;

      const moArc = document.getElementById('donut-mo-arc');
      const opsArc = document.getElementById('donut-ops-arc');
      moArc.setAttribute('stroke-dasharray', `${moDash.toFixed(1)} ${circ.toFixed(1)}`);
      opsArc.setAttribute('stroke-dasharray', `${opsDash.toFixed(1)} ${circ.toFixed(1)}`);
      opsArc.setAttribute('stroke-dashoffset', `${(-moDash).toFixed(1)}`);

      document.getElementById('donut-total-cost').textContent = fmtMoney2(totalFutureUnitCost);
      document.getElementById('legend-mo-val').textContent = fmtMoney2(m.unitLaborFuture);
      document.getElementById('legend-ops-val').textContent = fmtMoney2(m.opsCostFuture);

      const moSharePct = Math.round(moRatio * 100);
      const opsSharePct = Math.max(0, 100 - moSharePct);
      const moPctEl = document.getElementById('legend-mo-pct');
      const opsPctEl = document.getElementById('legend-ops-pct');
      const prevTotEl = document.getElementById('donut-prev-total');
      if (moPctEl) moPctEl.textContent = `${moSharePct}%`;
      if (opsPctEl) opsPctEl.textContent = `${opsSharePct}%`;
      if (prevTotEl) prevTotEl.textContent = `${fmtMoney2(totalCurrentUnitCost)} / pç`;

      const moPct = m.unitLaborCurrent > 0 ? ((m.unitLaborFuture / m.unitLaborCurrent) - 1) * 100 : 0;
      const opsPct = m.opsCostCurrent > 0 ? ((m.opsCostFuture / m.opsCostCurrent) - 1) * 100 : 0;
      const barMoLbl = document.getElementById('bar-mo-label');
      const barOpsLbl = document.getElementById('bar-ops-label');
      barMoLbl.textContent = fmtPct(moPct);
      barOpsLbl.textContent = fmtPct(opsPct);

      barMoLbl.className = moPct <= 0
        ? 'px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
        : 'px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-rose-500/15 text-rose-300 border border-rose-500/30';
      barOpsLbl.className = opsPct <= 0
        ? 'px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
        : 'px-1.5 py-0.5 rounded text-[10px] font-extrabold bg-rose-500/15 text-rose-300 border border-rose-500/30';

      const barMoVals = document.getElementById('bar-mo-vals');
      const barOpsVals = document.getElementById('bar-ops-vals');
      if (barMoVals) {
        barMoVals.innerHTML = `<span>Atual: ${fmtMoney2(m.unitLaborCurrent)}</span><strong class="text-sky-300">Futuro: ${fmtMoney2(m.unitLaborFuture)}</strong>`;
      }
      if (barOpsVals) {
        barOpsVals.innerHTML = `<span>Atual: ${fmtMoney2(m.opsCostCurrent)}</span><strong class="text-gold">Futuro: ${fmtMoney2(m.opsCostFuture)}</strong>`;
      }

      const moWidth = m.unitLaborCurrent > 0 ? Math.min(100, Math.max(8, (m.unitLaborFuture / m.unitLaborCurrent) * 100)) : 50;
      const opsWidth = m.opsCostCurrent > 0 ? Math.min(100, Math.max(8, (m.opsCostFuture / m.opsCostCurrent) * 100)) : 50;
      document.getElementById('bar-mo-future').style.width = moWidth.toFixed(0) + '%';
      document.getElementById('bar-ops-future').style.width = opsWidth.toFixed(0) + '%';

      const concBadge = document.getElementById('conclusion-badge');
      const concText = document.getElementById('conclusion-text');
      if (concBadge && concText) {
        const withinTakt = m.futureCycle > 0 && m.futureCycle <= m.takt;
        if (withinTakt) {
          concBadge.className = 'px-2.5 py-1 rounded-lg bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 text-[10px] font-extrabold uppercase tracking-wider shrink-0';
          concBadge.textContent = '✓ Linha Balanceada & Competitiva';
          concText.innerHTML = `<strong class="text-gold">Conclusão:</strong> o ciclo ${m.cyclePctChange>0?'aumenta':'diminui'} em <strong class="text-emerald-300">${fmt1(Math.abs(m.cyclePctChange))}%</strong> (atendendo ao Takt de <strong class="text-white">${fmt1(m.takt)}s</strong>), varia a capacidade em <strong class="text-sky-300">${fmtPct(m.capPctChange)}</strong> e projeta ${m.monthlySaving<0?'acréscimo de custo':'economia'} de <strong class="text-emerald-300">${fmtMoney(Math.abs(m.monthlySaving))}/mês</strong>.`;
        } else {
          const gap = m.futureCycle - m.takt;
          concBadge.className = 'px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-400/45 text-amber-300 text-[10px] font-extrabold uppercase tracking-wider shrink-0';
          concBadge.textContent = `⚠ ${fmt1(gap)}s Acima do Takt`;
          concText.innerHTML = `<strong class="text-gold">Diagnóstico:</strong> embora o ciclo tenha variado <strong class="text-white">${fmtPct(m.cyclePctChange)}</strong>, o posto gargalo está <strong class="text-amber-300">${fmt1(gap)}s acima do Takt (${fmt1(m.takt)}s)</strong>. Reduza perdas NVA ou adicione um posto para estabilizar a demanda.`;
        }
      }

      renderComparativeIndicatorsTable(study, m);
    }

    function renderComparativeIndicatorsTable(study, m) {
      const tbody = document.getElementById('comparative-table-body');
      if (!tbody) return;
      const rows = [
        ['Ciclo da linha (s)', fmt1(m.currentCycle) + ' s', fmt1(m.futureCycle) + ' s', fmtPct(m.cyclePctChange), m.cyclePctChange <= 0],
        ['Takt Time efetivo (s)', fmt1(m.takt) + ' s', fmt1(m.takt) + ' s', 'Meta operacional', true],
        ['Eficiência de balanceamento (%)', fmt1(m.efficiencyCurrent) + '%', fmt1(m.efficiencyFuture) + '%', fmtPct(m.efficiencyFuture - m.efficiencyCurrent), m.efficiencyFuture >= m.efficiencyCurrent],
        ['Ociosidade / Balance Delay (%)', fmt1(m.balanceDelayCurrent) + '%', fmt1(m.balanceDelayFuture) + '%', fmtPct(m.balanceDelayFuture - m.balanceDelayCurrent), m.balanceDelayFuture <= m.balanceDelayCurrent],
        ['Capacidade teórica (un/turno)', fmt1(m.capCurrent), fmt1(m.capFuture), fmtPct(m.capPctChange), m.capPctChange >= 0],
        ['Postos / Operadores', `${study.stations.current} postos`, `${study.stations.future} postos`, `${study.stations.future - study.stations.current} postos`, study.stations.future <= study.stations.current],
        ['Custo da equipe (R$/turno)', fmtMoney(study.laborCurrent), fmtMoney(study.laborFuture), fmtMoney(study.laborFuture - study.laborCurrent), study.laborFuture <= study.laborCurrent],
        ['Mão de obra por peça (R$)', fmtMoney2(m.unitLaborCurrent), fmtMoney2(m.unitLaborFuture), fmtMoney2(m.unitLaborFuture - m.unitLaborCurrent), m.unitLaborFuture <= m.unitLaborCurrent],
        ['Custo operacional alocado (R$/peça)', fmtMoney2(m.opsCostCurrent), fmtMoney2(m.opsCostFuture), fmtMoney2(m.opsCostFuture - m.opsCostCurrent), m.opsCostFuture <= m.opsCostCurrent],
        [`Economia mensal estimada (${study.days} dias)`, '—', fmtMoney(m.monthlySaving), fmtMoney(m.monthlySaving) + '/mês', m.monthlySaving >= 0]
      ];
      tbody.innerHTML = rows.map(([label, cur, fut, delta, good]) => `
        <tr class="hover:bg-obsidian-slot/60">
          <td class="py-2 px-3 font-medium text-slate-200">${label}</td>
          <td class="py-2 px-3 text-right text-slate-300">${cur}</td>
          <td class="py-2 px-3 text-right font-bold text-white">${fut}</td>
          <td class="py-2 px-3 text-right font-bold ${good ? 'text-emerald-400' : 'text-amber-300'}">${delta}</td>
        </tr>
      `).join('');
    }

    function renderAll() {
      const study = getActiveStudy();if(!study)return;
      const t0=performance.now(),m=computeMetrics(study);
      performance.measure('cb-recalculo',{start:t0,end:performance.now()});
      renderHeaderAndParams(study, m);
      renderDAG(study, m);
      renderStations(study, m);
      renderChart(study, m);
      renderWorkCompositionTable(study, m);
      renderKPIsAndFinancials(study, m);
      if(!study.demand||!m.futureCycle){
        const label=study.demand?'Adicione tempos de trabalho':'Informe a demanda por turno';
        document.getElementById('station-status-text').textContent=label;
        document.getElementById('station-status-bar').className='cb-neutral';
        document.getElementById('conclusion-badge').textContent='Sem avaliação';
        document.getElementById('conclusion-badge').className='cb-neutral';
        document.getElementById('conclusion-text').textContent=label;
        document.getElementById('monte-carlo-risk-badge').textContent='Risco Takt: —';
      }
      document.getElementById('hypothesis-count').textContent=study.elements.filter(e=>e.validationStatus!=='validated').length+' hipóteses · '+study.elements.filter(e=>e.validationStatus==='validated').length+' validados';
    }

    // 7. USER ACTIONS, PORTFOLIO MANAGEMENT & INTERACTIVITY
    function stepInput(inputId, delta) {
      const input = document.getElementById(inputId);
      if (!input) return;
      const min = input.min !== '' ? Number(input.min) : -Infinity;
      const max = input.max !== '' ? Number(input.max) : Infinity;
      const current = Number(input.value) || 0;
      const decimals = (String(delta).split('.')[1] || '').length;
      const next = Math.min(max, Math.max(min, Number((current + delta).toFixed(Math.max(decimals, 2)))));
      input.value = decimals > 0 ? next.toFixed(decimals) : String(next);
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function toggleStudyPickerMenu(forceState) {
      const menu = document.getElementById('study-picker-menu');
      const chevron = document.getElementById('study-picker-chevron');
      if (!menu) return;
      const shouldShow = typeof forceState === 'boolean' ? forceState : menu.classList.contains('hidden');
      menu.classList.toggle('hidden', !shouldShow);
      if (chevron) chevron.style.transform = shouldShow ? 'rotate(180deg)' : 'rotate(0deg)';
    }

    function switchActiveStudy(studyId) {
      if (!appState.studies.some(s => s.id === studyId)) return;
      appState.activeStudyId = studyId;
      undoStack = [];
      const undoBtn = document.getElementById('undo-btn');
      if (undoBtn) undoBtn.disabled = true;
      toggleStudyPickerMenu(false);
      saveAppState();
      renderAll();
      showToast(`Estudo ativo: ${getActiveStudy().name}`);
    }

    function createNewStudy() {
      const num = appState.studies.length + 1;
      const newStudy = normalizeStudy({
        id: 'study-' + Date.now(),
        name: `Novo Estudo Industrial #${num}`,
        product: `Produto ${String.fromCharCode(64 + Math.min(26, num))}`,
        shiftSeconds: 27000,
        days: 22,
        demand: 180,
        dailyVolume: 36,
        laborCurrent: 1500,
        laborFuture: 1200,
        oee: 95,
        capex: 10000,
        stations: { current: 4, future: 3 },
        areas: [
          { name: 'Preparação Inicial', costCurrent: 0.90, costFuture: 0.65 },
          { name: 'Montagem & Teste', costCurrent: 1.50, costFuture: 1.05 }
        ],
        elements: [
          { id: 'n01', area: 'Preparação Inicial', name: 'Separar componentes', currentStation: 1, vaCurrent: 30, nvaCurrent: 15, futureStation: 1, vaFuture: 30, nvaFuture: 5 },
          { id: 'n02', area: 'Montagem & Teste', name: 'Montar subconjunto', currentStation: 2, vaCurrent: 45, nvaCurrent: 25, futureStation: 2, vaFuture: 45, nvaFuture: 8 },
          { id: 'n03', area: 'Montagem & Teste', name: 'Teste funcional e liberação', currentStation: 3, vaCurrent: 35, nvaCurrent: 20, futureStation: 3, vaFuture: 35, nvaFuture: 6 }
        ],
        precedences: [['n01', 'n02'], ['n02', 'n03']],
        auditLog: [{ ts: new Date().toLocaleString('pt-BR'), actor: 'Eng. Processos', action: 'Criação', detail: 'Novo estudo criado' }]
      });
      appState.studies.push(newStudy);
      appState.activeStudyId = newStudy.id;
      saveAppState();
      renderAll();
      showToast(`Criado: ${newStudy.name}`);
    }

    function duplicateActiveStudy() {
      const current = getActiveStudy();
      const copy = normalize(current,true);
      copy.id = uid();
      copy.name = `${current.name} (Cópia)`;
      recordAudit('Duplicação', `Cenário duplicado a partir de "${current.name}"`, copy);
      appState.studies.push(copy);
      appState.activeStudyId = copy.id;
      saveAppState();
      renderAll();
      showToast(`Estudo duplicado: ${copy.name}`);
    }

    function renameActiveStudy() {
      const study = getActiveStudy();
      const trigger = document.getElementById('study-picker-trigger');
      if (!trigger) return;
      const inlineForm = document.createElement('div');
      inlineForm.className = 'inline-flex items-center gap-1.5 bg-[#0B1E30] border border-gold rounded-xl px-2.5 py-1';
      inlineForm.innerHTML = `
        <input id="inline-rename-input" type="text" maxlength="70" value="${escHtml(study.name)}"
               class="bg-transparent text-xs font-extrabold text-white focus:outline-none w-52 sm:w-64" />
        <button type="button" id="inline-rename-save" class="px-2 py-0.5 rounded bg-gold text-[#0B1E2E] text-[10px] font-extrabold cursor-pointer">OK</button>
        <button type="button" id="inline-rename-cancel" class="px-1.5 py-0.5 rounded bg-slate-700 text-slate-200 text-[10px] font-bold cursor-pointer">×</button>
      `;
      trigger.replaceWith(inlineForm);
      const inp = document.getElementById('inline-rename-input');
      inp.focus();
      inp.select();

      const commit = () => {
        const val = inp.value.trim();
        if (val && val !== study.name) {
          recordAudit('Renomeado', `"${study.name}" → "${val}"`);
          study.name = val;
          saveAppState();
        }
        inlineForm.replaceWith(trigger);
        renderAll();
      };
      const cancel = () => {
        inlineForm.replaceWith(trigger);
        renderAll();
      };
      document.getElementById('inline-rename-save').onclick = commit;
      document.getElementById('inline-rename-cancel').onclick = cancel;
      inp.onkeydown = e => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      };
    }

    function openDeleteStudyModal() {
      if (appState.studies.length <= 1) {
        showToast('Não é possível excluir o único estudo do portfólio');
        return;
      }
      deleteTargetIds = new Set([appState.activeStudyId]);
      const confirmCb = document.getElementById('delete-confirm-checkbox');
      if (confirmCb) confirmCb.checked = false;
      renderDeleteChecklist();
      document.getElementById('delete-study-modal').classList.remove('hidden');
    }

    function closeDeleteStudyModal() {
      document.getElementById('delete-study-modal').classList.add('hidden');
    }

    function toggleDeleteTarget(id) {
      if (deleteTargetIds.has(id)) {
        deleteTargetIds.delete(id);
      } else {
        if (appState.studies.length - deleteTargetIds.size <= 1) {
          showToast('Pelo menos 1 estudo deve permanecer no portfólio');
          renderDeleteChecklist();
          return;
        }
        deleteTargetIds.add(id);
      }
      renderDeleteChecklist();
    }

    function renderDeleteChecklist() {
      const listEl = document.getElementById('delete-study-checklist');
      const summaryEl = document.getElementById('delete-target-summary');
      const metaEl = document.getElementById('delete-target-meta');
      if (!listEl) return;

      listEl.innerHTML = appState.studies.map(s => {
        const checked = deleteTargetIds.has(s.id);
        return `
          <label class="flex items-center justify-between gap-2.5 p-2.5 rounded-xl border transition cursor-pointer ${checked ? 'bg-rose-950/35 border-rose-500/50' : 'bg-obsidian-slot border-obsidian-border hover:border-slate-600'}">
            <div class="flex items-center gap-2.5 min-w-0">
              <input type="checkbox" ${checked ? 'checked' : ''} onchange="toggleDeleteTarget('${escHtml(s.id)}')"
                     class="w-4 h-4 rounded border-slate-500 bg-obsidian-card text-rose-500 accent-rose-500 cursor-pointer shrink-0" />
              <div class="min-w-0">
                <div class="text-xs font-bold text-white truncate">${escHtml(s.name)}</div>
                <div class="text-[10px] text-slate-400 truncate">${escHtml(s.product)} • ${s.elements.length} elementos</div>
              </div>
            </div>
            ${s.id === appState.activeStudyId ? '<span class="text-[10px] font-bold px-2 py-0.5 rounded bg-gold/20 text-gold shrink-0">Ativo</span>' : ''}
          </label>
        `;
      }).join('');

      const selected = appState.studies.filter(s => deleteTargetIds.has(s.id));
      if (selected.length === 0) {
        summaryEl.textContent = 'Nenhum estudo selecionado';
        metaEl.textContent = 'Marque ao menos 1 caixa acima para prosseguir';
      } else {
        summaryEl.textContent = selected.map(s => s.name).join(' + ');
        metaEl.textContent = `${selected.length} estudo(s) selecionado(s) • Restarão ${appState.studies.length - selected.length} estudo(s) no portfólio`;
      }
      updateDeleteConfirmState();
    }

    function updateDeleteConfirmState() {
      const cb = document.getElementById('delete-confirm-checkbox');
      const btn = document.getElementById('confirm-delete-submit-btn');
      if (!cb || !btn) return;
      btn.disabled = !(cb.checked && deleteTargetIds.size > 0 && (appState.studies.length - deleteTargetIds.size) >= 1);
    }

    function confirmDeleteSelectedStudies() {
      if (!document.getElementById("delete-confirm-checkbox").checked || deleteTargetIds.size === 0 || (appState.studies.length - deleteTargetIds.size) < 1) return;
      const removedCount = deleteTargetIds.size;
      appState.studies = appState.studies.filter(s => !deleteTargetIds.has(s.id));
      if (!appState.studies.some(s => s.id === appState.activeStudyId)) {
        appState.activeStudyId = appState.studies[0].id;
      }
      deleteTargetIds.clear();
      closeDeleteStudyModal();
      saveAppState();
      renderAll();
      showToast(`${removedCount} estudo(s) excluído(s) do portfólio`);
    }

    function updateParam(field, rawValue) {
      const study = getActiveStudy();
      pushUndoSnapshot();
      if (['product', 'author', 'revision'].includes(field)) {
        study[field] = String(rawValue || '').trim() || study[field];
      } else {
        const val = Number(rawValue);
        if (!Number.isNaN(val)) {
          study[field] = field === 'days' ? Math.min(31, Math.max(1, val)) : (field === 'oee' ? Math.min(100, Math.max(10, val)) : Math.max(0, val));
        }
      }
      recordAudit('Premissa Atualizada', `Campo "${field}" alterado para ${study[field]}`);
      saveAppState();
      renderAll();
    }

    function updateSeasonality(val) {
      const study = getActiveStudy();
      if(study.seasonalityPct===Number(val))return;pushUndoSnapshot();study.seasonalityPct = Number(val) || 0;
      recordAudit("Simulação de sazonalidade",study.seasonalityPct+"%");
      saveAppState();
      renderAll();
    }

    function togglePremisesDrawer() {
      document.getElementById('premises-drawer')?.classList.toggle('hidden');
    }

    function toggleGuideDrawer() {
      document.getElementById('guide-drawer')?.classList.toggle('hidden');
    }

    function resetDemoStudies() {
      appState.studies = createDefaultStudies();
      appState.activeStudyId = appState.studies[0].id;
      undoStack = [];
      saveAppState();
      renderAll();
      showToast('Dados originais restaurados');
    }



    // 8. PRECEDENCE EDITOR, STATIONS & TABLE ACTIONS
    function togglePrecedenceModal() {
      const modal = document.getElementById('precedence-modal');
      if (!modal) return;
      const willOpen = modal.classList.contains('hidden');
      modal.classList.toggle('hidden');
      if (willOpen) renderPrecedenceModal();
    }

    function renderPrecedenceModal() {
      const study = getActiveStudy();
      const predSel = document.getElementById('pred-select');
      const succSel = document.getElementById('succ-select');
      const listEl = document.getElementById('precedence-rules-list');
      if (!predSel || !succSel || !listEl) return;

      const opts = study.elements.map(e => `<option value="${escHtml(e.id)}">${escHtml(e.id.toUpperCase())} — ${escHtml(e.name)}</option>`).join('');
      predSel.innerHTML = opts;
      succSel.innerHTML = opts;
      if (study.elements.length > 1) succSel.selectedIndex = 1;

      const elMap = new Map(study.elements.map(e => [e.id, e]));
      const rules = study.precedences || [];
      listEl.innerHTML = rules.length === 0
        ? '<div class="text-slate-400 italic p-2">Nenhuma regra cadastrada. Use "✨ Inferir Precedências por Texto (PLN)" para gerar automaticamente.</div>'
        : rules.map(([u, v], idx) => {
            const p = elMap.get(u);
            const s = elMap.get(v);
            if (!p || !s) return '';
            const violated = Number(p.futureStation) > Number(s.futureStation);
            return `
              <div class="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border ${violated ? 'bg-rose-500/15 border-rose-500/45 text-rose-200' : 'bg-obsidian-slot border-obsidian-border text-slate-200'}">
                <span class="truncate">
                  <strong class="text-gold font-mono">${escHtml(p.id.toUpperCase())}</strong> ${escHtml(p.name)}
                  <span class="text-sky-400 mx-1.5">➜</span>
                  <strong class="text-gold font-mono">${escHtml(s.id.toUpperCase())}</strong> ${escHtml(s.name)}
                </span>
                <button type="button" onclick="removePrecedenceRule(${idx})" class="text-rose-400 hover:text-rose-200 font-bold px-1.5 cursor-pointer">×</button>
              </div>
            `;
          }).join('');
    }

    function addPrecedenceRule() {
      const study = getActiveStudy();
      const u = document.getElementById('pred-select')?.value;
      const v = document.getElementById('succ-select')?.value;
      if (!u || !v || u === v) {
        showToast('Selecione dois elementos distintos');
        return;
      }
      if ((study.precedences || []).some(([a, b]) => a === u && b === v)) {
        showToast('Esta regra de precedência já existe');
        return;
      }
      validateGraph(study.elements,[...study.precedences,[u,v]]);
      pushUndoSnapshot();
      study.precedences = [...(study.precedences || []), [u, v]];
      recordAudit('Regra DAG', `Adicionada precedência ${u.toUpperCase()} ➜ ${v.toUpperCase()}`);
      saveAppState();
      renderPrecedenceModal();
      renderAll();
    }

    function removePrecedenceRule(idx) {
      const study = getActiveStudy();
      pushUndoSnapshot();
      study.precedences.splice(idx, 1);
      recordAudit('Precedência removida','Regra técnica removida.');
      saveAppState();
      renderPrecedenceModal();
      renderAll();
    }

    function adjustStationCount(delta) {
      const s=getActiveStudy(),n=s.stations.future+delta;
      if(n<1||n>Math.max(12,s.stations.future))throw Error('Selecione de 1 a 12 postos futuros.');
      if(s.elements.some(e=>e.futureStation>n||e.fixedStation>n)||s.equipment.some(r=>r.futureStationIndex>n))throw Error('Posto ocupado. Realoque os elementos e equipamentos antes de remover o posto.');
      pushUndoSnapshot();s.stations.future=n;recordAudit('Postos futuros',String(n));saveAppState();renderAll();
    }

    function applyTheoreticalMinStations() {
      const s=getActiveStudy(), n=computeMetrics(s).minTheoreticalStations;
      if(!s.demand||n>12)throw Error('Sem dimensionamento viável dentro do limite de postos.');
      propose('rpw',n);
    }

    function toggleElementFixedStation(elId, stationNum) {
      const study = getActiveStudy();
      const el = study.elements.find(x => x.id === elId);
      if (!el) return;
      pushUndoSnapshot();
      if (Number(el.fixedStation) === Number(stationNum)) {
        el.fixedStation = null;el.fixedEquipmentId=null;
        showToast(`Monumento liberado: "${el.name}"`);
      } else {
        el.fixedStation = Number(stationNum);
        el.futureStation = Number(stationNum);
        showToast(`📌 "${el.name}" fixado no Posto F${stationNum}`);
      }
      saveAppState();
      renderAll();
    }

    function toggleAreaDetails(areaName) {
      if (expandedAreas.has(areaName)) expandedAreas.delete(areaName);
      else expandedAreas.add(areaName);
      renderWorkCompositionTable(getActiveStudy(), computeMetrics(getActiveStudy()));
    }

    function toggleAllAreas() {
      const study = getActiveStudy();
      const btn = document.getElementById('toggle-all-areas-btn');
      if (expandedAreas.size === study.areas.length) {
        expandedAreas.clear();
        if (btn) btn.textContent = '+ mostrar todos os detalhes';
      } else {
        study.areas.forEach(a => expandedAreas.add(a.name));
        if (btn) btn.textContent = '− ocultar todos os detalhes';
      }
      renderWorkCompositionTable(study, computeMetrics(study));
    }

    function toggleComparativeDrawer() {
      document.getElementById('comparative-drawer')?.classList.toggle('hidden');
    }

    function openAddAreaModal() {
      document.getElementById('area-modal')?.classList.remove('hidden');
    }

    function closeAddAreaModal() {
      document.getElementById('area-modal')?.classList.add('hidden');
    }

    function submitNewArea(event) {
      event.preventDefault();
      const form = event.target;
      const fd = new FormData(form);
      const name = String(fd.get('name') || '').trim();
      if (!name) return;

      const study = getActiveStudy();
      pushUndoSnapshot();
      study.areas.push({
        name,
        costCurrent: safeNum(fd.get('costCurrent')),
        costFuture: safeNum(fd.get('costFuture'))
      });
      const newId = uid();
      study.elements.push({
        id: newId,
        area: name,
        name: `Operação ${name}`,
        currentStation: study.stations.current,
        vaCurrent: safeNum(fd.get('vaCurrent')),
        nvaCurrent: safeNum(fd.get('nvaCurrent')),
        futureStation: study.stations.future,
        vaFuture: safeNum(fd.get('vaFuture')),
        nvaFuture: safeNum(fd.get('nvaFuture')),
        fixedStation: null
      });
      expandedAreas.add(name);
      recordAudit('Nova Área', `Área "${name}" adicionada ao estudo`);
      saveAppState();
      form.reset();
      closeAddAreaModal();
      renderAll();
      showToast(`Área "${name}" adicionada`);
    }

    function addWorkElement() {
      const study = getActiveStudy();
      const targetArea = [...expandedAreas].at(-1) || study.areas[study.areas.length - 1]?.name || 'Operação';
      pushUndoSnapshot();
      const nextNum = study.elements.length + 1;
      const newEl = {
        id: uid(),
        area: targetArea,
        name: `Novo elemento #${nextNum}`,
        currentStation: 1,
        vaCurrent: 20,
        nvaCurrent: 8,
        futureStation: 1,
        vaFuture: 20,
        nvaFuture: 3,
        fixedStation: null
      };
      study.elements.push(newEl);
      expandedAreas.add(targetArea);
      recordAudit('Novo Elemento', `Elemento "${newEl.name}" adicionado em "${targetArea}"`);
      saveAppState();
      renderAll();
      showToast(`Elemento adicionado em "${targetArea}"`);
    }

    function updateAreaCost(areaIdx, field, val) {
      const study = getActiveStudy();
      if (!study.areas[areaIdx]) return;
      pushUndoSnapshot();
      const before=study.areas[areaIdx][field];study.areas[areaIdx][field]=Number(val);
      recordAudit("Custo operacional",study.areas[areaIdx].name+" · "+field+": "+before+" → "+val);
      saveAppState();
      renderAll();
    }

    function updateElementField(id,field,value) {
      const study=getActiveStudy(), el=study.elements.find(e=>e.id===id);
      if(!el)return;
      const v=field==='name'?String(value).trim():Number(value);
      if(el[field]===v)return;
      if(field==='futureStation')checkMove(study,el,v);
      if(field==='currentStation'&&el.fixedEquipmentId){
        const fixed=study.equipment.find(r=>r.id===el.fixedEquipmentId)?.currentStationIndex;
        if(fixed!=null&&fixed!==v)throw Error('Este equipamento está fixado em F'+fixed+'.');
      }
      pushUndoSnapshot();
      const prior=el[field]; el[field]=v;
      if(['vaFuture','nvaFuture','vaCurrent','nvaCurrent'].includes(field)){el.validationStatus='hypothesis';el.evidenceRef=null;}
      recordAudit('Elemento editado',el.name+' · '+field+': '+prior+' → '+v);
      saveAppState();renderAll();
    }

    function removeArea(areaIdx) {
      const study = getActiveStudy();
      if (study.areas.length <= 1) {
        showToast('O estudo deve manter pelo menos 1 área operacional');
        return;
      }
      pushUndoSnapshot();
      const removed = study.areas.splice(areaIdx, 1)[0];
      const removedIds = new Set(study.elements.filter(e => e.area === removed.name).map(e => e.id));
      study.elements = study.elements.filter(e => e.area !== removed.name);
      study.precedences = (study.precedences || []).filter(([u, v]) => !removedIds.has(u) && !removedIds.has(v));
      recordAudit('Área Removida', `Área "${removed.name}" removida`);
      saveAppState();
      renderAll();
      showToast(`Área "${removed.name}" removida`);
    }

    function removeElement(elId) {
      const study = getActiveStudy();
      if (study.elements.length <= 1) {
        showToast('O estudo deve manter pelo menos 1 elemento');
        return;
      }
      pushUndoSnapshot();
      study.elements = study.elements.filter(e => e.id !== elId);
      study.precedences = (study.precedences || []).filter(([u, v]) => u !== elId && v !== elId);
      saveAppState();
      renderAll();
      showToast('Elemento removido');
    }

    // 9. STOPWATCH, COMPARATOR, AUDIT & EXPORT / IMPORT
    let swRunning = false;
    let swStartTime = 0;
    let swElapsedMs = 0;
    let swTimerId = null;
    let swLaps = [];

    function openStopwatchModal() {
      const study = getActiveStudy();
      const sel = document.getElementById('sw-target-element');
      if (sel) {
        sel.innerHTML = study.elements.map(e => `<option value="${escHtml(e.id)}">${escHtml(e.id.toUpperCase())} — ${escHtml(e.name)}</option>`).join('');
      }
      document.getElementById('stopwatch-modal')?.classList.remove('hidden');
    }

    function closeStopwatchModal() {
      stopVisionCamera();
      if (swRunning) toggleStopwatch();
      document.getElementById('stopwatch-modal')?.classList.add('hidden');
    }

    function toggleStopwatch() {
      const btn = document.getElementById('sw-start-btn');
      if (!swRunning) {
        swRunning = true;
        swStartTime = performance.now() - swElapsedMs;
        swTimerId = setInterval(() => {
          swElapsedMs = performance.now() - swStartTime;
          updateStopwatchDisplay();
        }, 40);
        if (btn) {
          btn.textContent = '⏸ Pausar';
          btn.className = 'px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-extrabold transition cursor-pointer';
        }
      } else {
        swRunning = false;
        clearInterval(swTimerId);
        if (btn) {
          btn.textContent = '▶ Continuar';
          btn.className = 'px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-extrabold transition cursor-pointer';
        }
      }
    }

    function updateStopwatchDisplay() {
      const el = document.getElementById('sw-display');
      if (!el) return;
      const totalSec = swElapsedMs / 1000;
      const mins = Math.floor(totalSec / 60);
      const secs = Math.floor(totalSec % 60);
      const centis = Math.floor((swElapsedMs % 1000) / 10);
      el.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
    }

    function recordStopwatchLap() {
      const sec = Number((swElapsedMs / 1000).toFixed(2));
      if (sec <= 0.1) return;
      swLaps.push(sec);
      swElapsedMs = 0;
      swStartTime = performance.now();
      updateStopwatchDisplay();
      renderStopwatchLaps();
      recalcStopwatchStats();
    }

    function resetStopwatch() {
      if (swRunning) toggleStopwatch();
      swElapsedMs = 0;
      updateStopwatchDisplay();
      const btn = document.getElementById('sw-start-btn');
      if (btn) btn.textContent = '▶ Iniciar';
    }

    function clearStopwatchLaps() {
      swLaps = [];
      renderStopwatchLaps();
      recalcStopwatchStats();
    }

    function renderStopwatchLaps() {
      const list = document.getElementById('sw-laps-list');
      const count = document.getElementById('sw-lap-count');
      if (count) count.textContent = String(swLaps.length);
      if (!list) return;
      list.innerHTML = swLaps.length === 0
        ? '<span class="text-slate-500 italic text-[11px]">Inicie o cronômetro e clique em "Registrar Tomada" a cada ciclo...</span>'
        : swLaps.map((v, i) => `<span class="px-2 py-0.5 rounded bg-obsidian-card border border-obsidian-border text-sky-200 font-mono">#${i + 1}: <strong>${fmt2(v)}s</strong></span>`).join('');
    }

    function recalcStopwatchStats() {
      const meanEl = document.getElementById('sw-stat-mean');
      const sdEl = document.getElementById('sw-stat-sd');
      const nreqEl = document.getElementById('sw-stat-nreq');
      const badgeEl = document.getElementById('sw-stat-badge');
      const stdEl = document.getElementById('sw-standard-time');

      if (swLaps.length === 0) {
        if (meanEl) meanEl.textContent = '0,00s';
        if (sdEl) sdEl.textContent = '0,00s';
        if (nreqEl) nreqEl.textContent = '—';
        if (stdEl) stdEl.textContent = '0,0 s';
        return;
      }

      const n = swLaps.length;
      const mean = swLaps.reduce((a, b) => a + b, 0) / n;
      const sd = n > 1 ? Math.sqrt(swLaps.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / (n - 1)) : 0;
      const nReq = (n > 1 && mean > 0) ? Math.max(2, Math.ceil(Math.pow((1.96 * sd) / (0.05 * mean), 2))) : 2;

      const rating = (Number(document.getElementById('sw-rating')?.value) || 100) / 100;
      const allowance = (Number(document.getElementById('sw-allowance')?.value) || 0) / 100;
      const stdTime = mean * rating * (1 + allowance);

      if (meanEl) meanEl.textContent = fmt2(mean) + 's';
      if (sdEl) sdEl.textContent = fmt2(sd) + 's';
      if (nreqEl) nreqEl.textContent = n > 1 ? `${nReq} ciclos` : '≥ 2';
      if (stdEl) stdEl.textContent = fmt1(stdTime) + ' s';

      if (badgeEl && n > 1) {
        if (n >= nReq) {
          badgeEl.className = 'px-2.5 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-[11px] font-bold text-emerald-300';
          badgeEl.textContent = `✓ Amostra válida (${n}/${nReq} ciclos)`;
        } else {
          badgeEl.className = 'px-2.5 py-1 rounded-lg bg-amber-500/20 border border-gold/40 text-[11px] font-bold text-gold';
          badgeEl.textContent = `⚠ Colete mais ${nReq - n} ciclo(s) para 95% conf.`;
        }
      }
    }

    function applyStopwatchToElement() {
      if (swLaps.length === 0) {
        showToast('Registre pelo menos 1 tomada de tempo antes de aplicar');
        return;
      }
      const n = swLaps.length;
      const mean = swLaps.reduce((a, b) => a + b, 0) / n;
      const rating = (Number(document.getElementById('sw-rating')?.value) || 100) / 100;
      const allowance = (Number(document.getElementById('sw-allowance')?.value) || 0) / 100;
      const stdTime = Number((mean * rating * (1 + allowance)).toFixed(1));

      const elId = document.getElementById('sw-target-element')?.value;
      const field = document.getElementById('sw-target-field')?.value;
      const study = getActiveStudy();
      const el = study.elements.find(x => x.id === elId);
      if (!el || !field) return;

      pushUndoSnapshot();
      el[field] = stdTime;el.validationStatus='hypothesis';el.evidenceRef=null;
      if(n>1&&mean>0){const sd=Math.sqrt(swLaps.reduce((sum,v)=>sum+(v-mean)**2,0)/(n-1));study.cv=Number(Math.min(10,sd/mean).toFixed(6));}
      recordAudit('Cronoanálise Aplicada', `Tempo padrão ${fmt1(stdTime)}s aplicado em "${el.name}" (${field})`);
      saveAppState();
      renderAll();
      closeStopwatchModal();
      showToast(`Tempo padrão ${fmt1(stdTime)}s aplicado em "${el.name}"`);
    }

    function openCompareModal() {
      const selA = document.getElementById('compare-study-a');
      const selB = document.getElementById('compare-study-b');
      if (!selA || !selB) return;
      const opts = appState.studies.map(s => `<option value="${escHtml(s.id)}">${escHtml(s.name)}</option>`).join('');
      selA.innerHTML = opts;
      selB.innerHTML = opts;
      selA.value = appState.activeStudyId;
      if (appState.studies.length > 1) {
        const alt = appState.studies.find(s => s.id !== appState.activeStudyId);
        if (alt) selB.value = alt.id;
      }
      renderCompareTable();
      document.getElementById('compare-modal')?.classList.remove('hidden');
    }

    function closeCompareModal() {
      document.getElementById('compare-modal')?.classList.add('hidden');
    }

    function renderCompareTable() {
      const idA = document.getElementById('compare-study-a')?.value;
      const idB = document.getElementById('compare-study-b')?.value;
      const tbody = document.getElementById('compare-table-body');
      const sA = appState.studies.find(s => s.id === idA) || appState?.studies[0];
      const sB = appState.studies.find(s => s.id === idB) || appState?.studies[0];
      if (!sA || !sB || !tbody) return;

      const mA = computeMetrics(sA);
      const mB = computeMetrics(sB);
      const siA = computeSmoothnessIndex(mA.futureLoads, mA.futureCycle);
      const siB = computeSmoothnessIndex(mB.futureLoads, mB.futureCycle);

      const rows = [
        ['Ciclo Futuro (s)', mA.futureCycle, mB.futureCycle, v => fmt1(v) + 's', true],
        ['Eficiência Balanceamento (%)', mA.efficiencyFuture, mB.efficiencyFuture, v => fmt1(v) + '%', false],
        ['Smoothness Index SI (s)', siA, siB, v => fmt1(v) + 's', true],
        ['Capacidade (un/turno)', mA.capFuture, mB.capFuture, v => fmt1(v), false],
        ['Postos / Operadores', sA.stations.future, sB.stations.future, v => fmtInt(v), true],
        ['Mão de Obra Unitária (R$/pç)', mA.unitLaborFuture, mB.unitLaborFuture, v => fmtMoney2(v), true],
        ['Custo Operacional (R$/pç)', mA.opsCostFuture, mB.opsCostFuture, v => fmtMoney2(v), true],
        ['Economia Mensal (R$)', mA.monthlySaving, mB.monthlySaving, v => fmtMoney(v), false],
        ['CAPEX Investido (R$)', mA.capex, mB.capex, v => fmtMoney(v), true],
        ['Payback Estimado (meses)', mA.paybackMonths, mB.paybackMonths, v => v > 0 ? fmt1(v) + 'm' : '—', true]
      ];

      tbody.innerHTML = rows.map(([label, a, b, fmt, lowerBetter]) => {
        const diff = b - a;
        const bWins = lowerBetter ? b < a - 0.001 : b > a + 0.001;
        const aWins = lowerBetter ? a < b - 0.001 : a > b + 0.001;
        const winner = bWins ? '<span class="text-gold font-extrabold">★ B</span>' : (aWins ? '<span class="text-sky-300 font-extrabold">★ A</span>' : '<span class="text-slate-500">=</span>');
        return `
          <tr class="hover:bg-obsidian-slot/60">
            <td class="py-2 px-3 font-medium text-slate-200">${label}</td>
            <td class="py-2 px-3 text-right text-slate-300">${fmt(a)}</td>
            <td class="py-2 px-3 text-right font-bold text-white">${fmt(b)}</td>
            <td class="py-2 px-3 text-right font-mono ${bWins ? 'text-emerald-400' : (aWins ? 'text-amber-300' : 'text-slate-400')}">${diff === 0 ? '0' : (diff > 0 ? '+' : '') + fmt(diff)}</td>
            <td class="py-2 px-3 text-center">${winner}</td>
          </tr>
        `;
      }).join('');
    }

    function openAuditModal() {
      const study = getActiveStudy();
      document.getElementById('audit-author-badge').textContent = study.author || 'Eng. Processos';
      document.getElementById('audit-rev-badge').textContent = study.revision || 'Rev. 1.0';
      const list = document.getElementById('audit-log-list');
      const logs = study.auditLog || [];
      list.innerHTML = logs.length === 0
        ? '<div class="text-slate-400 italic p-2">Nenhum evento registrado ainda.</div>'
        : logs.map(item => `
            <div class="bg-obsidian-slot border border-obsidian-border rounded-xl p-2.5 flex items-start justify-between gap-2">
              <div>
                <div class="flex items-center gap-2">
                  <span class="px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 font-bold text-[10px]">${escHtml(item.action)}</span>
                  <span class="text-slate-400 text-[10px]">por ${escHtml(item.actor)}</span>
                </div>
                <div class="text-slate-200 mt-1">${escHtml(item.detail)}</div>
              </div>
              <span class="text-[10px] font-mono text-slate-400 shrink-0">${escHtml(item.ts)}</span>
            </div>
          `).join('');
      document.getElementById('audit-modal')?.classList.remove('hidden');
    }

    function closeAuditModal() {
      document.getElementById('audit-modal')?.classList.add('hidden');
    }

    function clearStudyAuditLog() {
      const study = getActiveStudy();
      study.auditLog = [];
      saveAppState();
      openAuditModal();
    }

    function openSharePwaModal() {
      const study = getActiveStudy();
      const payload = btoa(unescape(encodeURIComponent(JSON.stringify(study))));
      const baseUrl = window.location.href.split('#')[0];
      const shareInput = document.getElementById('share-url-input');
      if (shareInput) shareInput.value = `${baseUrl}#study=${payload}`;
      document.getElementById('share-pwa-modal')?.classList.remove('hidden');
    }

    function closeSharePwaModal() {
      document.getElementById('share-pwa-modal')?.classList.add('hidden');
    }

    function copyShareUrl() {
      const inp = document.getElementById('share-url-input');
      if (!inp) return;
      inp.select();
      try {
        document.execCommand('copy');
        showToast('Link direto do estudo copiado!');
      } catch (e) {
        showToast('Copie o link manualmente');
      }
    }

    async function triggerPwaInstall() {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      document.getElementById('pwa-install-trigger')?.classList.add('hidden');
    }

    async function downloadStandaloneProject(){await exportPortable(appState);showToast('Projeto autônomo preparado.');}

    function exportStudyJSON(){exportJson(appState);}

    async function importStudyJSON(event){
      const file=event.target.files[0];event.target.value='';if(!file)return;
      if(file.size>5*1024*1024)throw Error('Limite de 5 MiB por arquivo.');
      const imported=importSheets(JSON.parse(await file.text()));
      appState.studies.push(...imported.studies);appState.activeStudyId=imported.activeStudyId;
      recordAudit('Importação','Arquivo JSON validado.');saveAppState();renderAll();showToast('Estudos importados.');
    }

    function exportStudyCSV(){exportCsv(getActiveStudy());}

    // 10. ARTIFICIAL INTELLIGENCE ENGINE (4 PILLARS: EDGE AI, KAIZEN COPILOT, NLP & COMPUTER VISION)
    const gateway = {endpoint:'',key:'',model:''};

    // Pillar 1A: Smoothness Index (SI = sqrt(sum((TC - C(Fi))^2)))
    function computeSmoothnessIndex(loads, cycle) {
      if (!Array.isArray(loads) || loads.length === 0) return 0;
      const tc = Number(cycle) || Math.max(0, ...loads);
      const sumSq = loads.reduce((acc, c) => acc + Math.pow(Math.max(0, tc - (Number(c) || 0)), 2), 0);
      return Math.sqrt(sumSq);
    }

    // Pillar 1B: Stochastic Monte Carlo Simulation (Takt overrun probability & P95 cycle)
    function runMonteCarloSimulation(study,m,iterations=600) {
      const key=JSON.stringify([study.stations.future,study.elements.map(e=>[e.vaFuture,e.nvaFuture,e.futureStation]),m.takt,study.cv,iterations]);
      if(riskCache.key!==key){const r=runMonteCarlo(asDomain(study),iterations,study.cv??.08,47);
        riskCache={key,value:{overrunProbabilityPct:r.riskPct,p95Cycle:r.p95Seconds,p95CycleSeconds:r.p95Seconds,trials:iterations,iterations,cv:study.cv??.08}};}
      return riskCache.value;
    }

    // Pillar 1C: Multi-Objective Simulated Annealing Optimizer (Cycle Time + Smoothness Index + Precedence + Monuments)
    function optimizeSimulatedAnnealingAI(){return propose('sa',getActiveStudy().stations.future);}

    // Pillar 2: Kaizen Copilot, Prescriptive NVA Analyzer & Executive CAPEX Report
    function buildKaizenDiagnostic(study, m) {
      const candidates = study.elements
        .map(el => {
          const nva = safeNum(el.nvaFuture);
          const va = safeNum(el.vaFuture);
          const labelLower = `${el.area} ${el.name}`.toLowerCase();
          let tactic = 'Padronização SMED & Dispositivo de Fixação Rápida';
          let reductionFactor = 0.35;

          if (/test|inspec|estanque|verif|dielétric|chec/.test(labelLower)) {
            tactic = 'Poka-Yoke Integrado & Teste Automatizado em Linha';
            reductionFactor = 0.45;
          } else if (/separ|abastec|kit|receb|prepar/.test(labelLower)) {
            tactic = 'Kitting Point-of-Use & Supermercado Kanban';
            reductionFactor = 0.40;
          } else if (/embal|etiquet|proteg|liber/.test(labelLower)) {
            tactic = 'Embalagem Pré-Formada & Etiquetagem Automática';
            reductionFactor = 0.35;
          } else if (/sold|brasag|fix|mont|acopl|conect/.test(labelLower)) {
            tactic = 'Gabarito Ergonômico Zero-Ajuste & Parafusadeira Torqueada';
            reductionFactor = 0.38;
          }

          const savingSec = Number((nva * reductionFactor).toFixed(1));
          return { el, nva, va, tactic, savingSec };
        })
        .filter(item => item.savingSec >= 0.8)
        .sort((a, b) => b.savingSec - a.savingSec)
        .slice(0, 4);

      const totalSavedSec = candidates.reduce((s, c) => s + c.savingSec, 0);
      return { candidates, totalSavedSec };
    }

    function openAiCopilotModal() {
      const study = getActiveStudy();
      const m = computeMetrics(study);
      const si = computeSmoothnessIndex(m.futureLoads, m.futureCycle);
      const mc = runMonteCarloSimulation(study, m, 800);
      const diag = buildKaizenDiagnostic(study, m);

      const telemetryEl = document.getElementById('ai-telemetry-strip');
      if (telemetryEl) {
        telemetryEl.innerHTML = `
          <div class="bg-obsidian-inner border border-violet-400/35 rounded-xl p-3">
            <div class="text-[10px] font-bold uppercase text-violet-300">Smoothness Index (SI)</div>
            <div class="text-lg font-extrabold text-white mt-0.5">${fmt1(si)} s</div>
            <div class="text-[10px] text-slate-400 mt-0.5">Equilíbrio de carga entre ${study.stations.future} postos</div>
          </div>
          <div class="bg-obsidian-inner border border-sky-400/35 rounded-xl p-3">
            <div class="text-[10px] font-bold uppercase text-sky-300">Risco Takt (Monte Carlo)</div>
            <div class="text-lg font-extrabold ${mc.overrunProbabilityPct > 25 ? 'text-rose-400' : 'text-emerald-400'} mt-0.5">${fmt1(mc.overrunProbabilityPct)}%</div>
            <div class="text-[10px] text-slate-400 mt-0.5">Ciclo P95 estocástico: ${fmt1(mc.p95Cycle)} s</div>
          </div>
          <div class="bg-obsidian-inner border border-gold/40 rounded-xl p-3">
            <div class="text-[10px] font-bold uppercase text-gold">Potencial Kaizen NVA</div>
            <div class="text-lg font-extrabold text-gold mt-0.5">−${fmt1(diag.totalSavedSec)} s / pç</div>
            <div class="text-[10px] text-slate-400 mt-0.5">Nas ${diag.candidates.length} principais oportunidades</div>
          </div>
        `;
      }

      const recEl = document.getElementById('ai-kaizen-recommendations');
      if (recEl) {
        recEl.innerHTML = diag.candidates.length === 0
          ? '<div class="text-slate-400 italic p-2">Perdas NVA já estão altamente enxutas neste estudo.</div>'
          : diag.candidates.map(c => `
              <div class="bg-obsidian-slot border border-obsidian-border rounded-xl p-2.5 flex flex-wrap items-center justify-between gap-2">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="px-1.5 py-0.5 rounded bg-gold/20 text-gold font-mono text-[10px] font-bold">${escHtml(c.el.id.toUpperCase())}</span>
                    <strong class="text-white truncate">${escHtml(c.el.name)}</strong>
                    <span class="text-[10px] text-slate-400">(${escHtml(c.el.area)})</span>
                  </div>
                  <div class="text-[11px] text-sky-300 mt-1">💡 Contramedida: <strong>${escHtml(c.tactic)}</strong></div>
                </div>
                <div class="text-right shrink-0">
                  <div class="text-xs font-extrabold text-emerald-400">−${fmt1(c.savingSec)} s NVA</div>
                  <div class="text-[10px] text-slate-400">${fmt1(c.nva)}s ➜ ${fmt1(Math.max(0.5, c.nva - c.savingSec))}s</div>
                </div>
              </div>
            `).join('');
      }

      const reportBox = document.getElementById('ai-executive-report-text');
      if (reportBox) {
        const lines = [
          `PARECER TÉCNICO DE ENGENHARIA DE MANUFATURA — ${study.name.toUpperCase()}`,
          `Produto: ${study.product} | Responsável: ${study.author} (${study.revision})`,
          `--------------------------------------------------------------------------------`,
          `1. DIAGNÓSTICO DO PROCESSO: O cenário atual opera em ${study.stations.current} postos com ciclo gargalo de ${fmt1(m.currentCycle)}s (capacidade de ${fmt1(m.capCurrent)} un/turno) frente ao Takt Time efetivo de ${fmt1(m.takt)}s.`,
          `2. PROPOSTA BALANCEADA (SDD v2.0 AI): Reestruturação para ${study.stations.future} postos reduzindo o ciclo para ${fmt1(m.futureCycle)}s (${fmtPct(m.cyclePctChange)}), elevando a eficiência de balanceamento para ${fmt1(m.efficiencyFuture)}% (SI = ${fmt1(si)}s) e capacidade para ${fmt1(m.capFuture)} un/turno (${fmtPct(m.capPctChange)}).`,
          `3. VIABILIDADE FINANCEIRA & ROI: Redução do custo unitário de mão de obra de ${fmtMoney2(m.unitLaborCurrent)} para ${fmtMoney2(m.unitLaborFuture)}/pç, gerando economia estimada de ${fmtMoney(m.monthlySaving)}/mês. Para um CAPEX de ${fmtMoney(m.capex)}, o Payback estimado é de ${m.paybackMonths > 0 ? fmt1(m.paybackMonths) + ' meses' : 'imediato'} (ROI anual: ${m.capex > 0 ? fmtPct(m.annualRoiPct) : '∞'}).`
        ];
        reportBox.value = lines.join('\n');
      }

      try {
        const savedGw = gateway;
        if (savedGw.endpoint) document.getElementById('ai-llm-endpoint').value = savedGw.endpoint;
        if (savedGw.key) document.getElementById('ai-llm-key').value = savedGw.key;
      } catch (e) {}

      document.getElementById('ai-copilot-modal')?.classList.remove('hidden');
    }

    function closeAiCopilotModal() {
      document.getElementById('ai-copilot-modal')?.classList.add('hidden');
    }

    function applyAiKaizenPlan() {
      const study = getActiveStudy();
      const m = computeMetrics(study);
      const diag = buildKaizenDiagnostic(study, m);
      if (diag.candidates.length === 0) {
        showToast('Nenhuma redução NVA adicional recomendada no momento');
        return;
      }

      pushUndoSnapshot();
      diag.candidates.forEach(c => {
        c.el.validationStatus="hypothesis"; c.el.evidenceRef=null; c.el.nvaFuture = Math.max(0.5, Number((safeNum(c.el.nvaFuture) - c.savingSec).toFixed(1)));
      });
      recordAudit('[IA Copiloto] Plano Kaizen', `Aplicadas ${diag.candidates.length} contramedidas Lean (−${fmt1(diag.totalSavedSec)}s NVA/peça)`);
      saveAppState();
      renderAll();
      openAiCopilotModal();
      showToast(`✨ Plano Kaizen aplicado: −${fmt1(diag.totalSavedSec)}s de redução de NVA projetada.`);
    }

    function copyExecutiveReportAI() {
      const box = document.getElementById('ai-executive-report-text');
      if (!box) return;
      box.select();
      try {
        document.execCommand('copy');
        showToast('Parecer Técnico copiado para a área de transferência!');
      } catch (e) {
        showToast('Selecione e copie o texto manualmente');
      }
    }

    function saveAiGatewayConfig(){
      const endpoint=document.getElementById('ai-llm-endpoint').value.trim();
      const url=new URL(endpoint);
      if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)))throw Error('Use HTTPS ou um gateway local.');
      if(url.username||url.password||url.search||url.hash)throw Error('Informe a URL do serviço sem credenciais ou parâmetros.');
      gateway.endpoint=url.href;gateway.key=document.getElementById('ai-llm-key').value.trim();gateway.model=document.getElementById('ai-llm-model').value.trim();
    }
    async function requestGatewayReport(){
      saveAiGatewayConfig();const s=getActiveStudy(),m=computeMetrics(s),button=document.getElementById('ask-gateway');
      const aggregate={takt_s:m.takt,ciclo_atual_s:m.currentCycle,ciclo_futuro_s:m.futureCycle,capacidade_futura:m.capFuture,delta_mensal_brl:m.monthlySaving};
      const prompt='Redija um parecer industrial em português do Brasil a partir destas estimativas. Distinga hipóteses de medições. '+JSON.stringify(aggregate);
      const gemini=new URL(gateway.endpoint).hostname==='generativelanguage.googleapis.com';
      if(!gemini&&!gateway.model)throw Error('Informe o modelo disponibilizado pelo gateway.');
      button.disabled=true;button.textContent='Consultando…';
      try{
        const response=await fetch(gateway.endpoint,{method:'POST',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(40000),
          headers:{'Content-Type':'application/json',...(gateway.key?(gemini?{'x-goog-api-key':gateway.key}:{Authorization:'Bearer '+gateway.key}):{})},
          body:JSON.stringify(gemini?{contents:[{parts:[{text:prompt}]}]}:{model:gateway.model,messages:[{role:'user',content:prompt}]})});
        if(!response.ok)throw Error('O gateway respondeu HTTP '+response.status+'.');
        const body=await response.json();const result=gemini?body.candidates?.[0]?.content?.parts?.map(p=>p.text).join(''):body.choices?.[0]?.message?.content;
        if(typeof result!=='string'||!result.trim())throw Error('O provedor devolveu um parecer vazio.');
        document.getElementById('ai-executive-report-text').value=result.slice(0,20000);
        showToast('Parecer do gateway recebido.');
      }finally{button.disabled=false;button.textContent='Enviar indicadores e gerar parecer';}
    }

    // Pillar 3: NLP Engineering Assistant (Precedence Auto-Inference & VA/NVA Classification)
    function inferPrecedencesNLP() {
      const study = getActiveStudy();
      if (study.elements.length < 2) {
        showToast('Adicione pelo menos 2 elementos para inferir precedências');
        return;
      }

      const stageScore = el => {
        const txt = `${el.area} ${el.name}`.toLowerCase();
        if (/receb|separ|identif|kit|abastec|desembal/.test(txt)) return 1;
        if (/prepar|posic|gabarit|cort|dobr|ajust/.test(txt)) return 2;
        if (/mont|fix|acopl|sold|brasag|instal|conect|parafus|prens/.test(txt)) return 3;
        if (/test|inspec|estanque|verif|dielétric|medi|calibr|ultrassom/.test(txt)) return 4;
        if (/acab|proteg|etiquet|embal|exped|liber/.test(txt)) return 5;
        return 3;
      };

      pushUndoSnapshot();
      const sorted = [...study.elements].sort((a, b) => stageScore(a) - stageScore(b));
      const newEdges = [];
      for (let i = 0; i < sorted.length - 1; i++) {
        newEdges.push([sorted[i].id, sorted[i + 1].id]);
      }

      const technical=[...study.precedences];
      for(const edge of newEdges){
        if(technical.some(([u,v])=>u===edge[0]&&v===edge[1]))continue;
        try{validateGraph(study.elements,[...technical,edge]); technical.push(edge)}catch{}
      }
      study.precedences=technical;
      recordAudit('[IA PLN] Grafo DAG Inferido', `${newEdges.length} regras de precedência geradas semanticamente`);
      saveAppState();
      renderPrecedenceModal();
      renderAll();
      showToast(`✨ PLN gerou ${newEdges.length} regras de precedência técnica!`);
    }

    function classifyOperationNLP(name) {
      const txt = String(name || '').toLowerCase();
      if (!txt.trim()) return null;
      if (/test|inspec|verif|separ|abastec|transport|moviment|espera|confer|embal|etiquet/.test(txt)) {
        return {
          category: 'Atividade de Suporte / Verificação (Predomínio NVA)',
          vaCurrent: 12,
          vaFuture: 12,
          nvaCurrent: 24,
          nvaFuture: 7
        };
      }
      return {
        category: 'Transformação Direta do Produto (Predomínio VA)',
        vaCurrent: 36,
        vaFuture: 36,
        nvaCurrent: 14,
        nvaFuture: 4
      };
    }

    function previewNlpAreaClassification(name) {
      const hint = document.getElementById('nlp-area-hint');
      if (!hint) return;
      const res = classifyOperationNLP(name);
      hint.textContent = res ? `PLN: ${res.category} • Sugestão: VA ${res.vaCurrent}s / NVA ${res.nvaCurrent}s➜${res.nvaFuture}s` : '';
    }

    function applyNlpAreaSuggestion() {
      const nameInput = document.getElementById('new-area-name-input');
      const form = nameInput?.closest('form');
      if (!nameInput || !form) return;
      const res = classifyOperationNLP(nameInput.value || 'Montagem');
      if (!res) return;
      form.querySelector('[name="vaCurrent"]').value = res.vaCurrent;
      form.querySelector('[name="vaFuture"]').value = res.vaFuture;
      form.querySelector('[name="nvaCurrent"]').value = res.nvaCurrent;
      form.querySelector('[name="nvaFuture"]').value = res.nvaFuture;
      previewNlpAreaClassification(nameInput.value || 'Montagem');
      showToast('Tempos VA × NVA sugeridos pelo motor PLN');
    }

    // Pillar 4: Computer Vision Time Study (WebRTC Optical Zone Tracking + Bench Simulator)
    let visionStream = null;
    let visionAnimId = null;
    let visionSimulated = false;
    let visionPrevFrame = null;
    let visionPhase = 0;
    let visionCycleStartMs = 0;
    let visionStage = 0;

    function setStopwatchMode(mode) {
      const visionPanel = document.getElementById('sw-vision-panel');
      const btnManual = document.getElementById('sw-mode-manual-btn');
      const btnVision = document.getElementById('sw-mode-vision-btn');
      if (!visionPanel || !btnManual || !btnVision) return;

      if (mode === 'vision') {
        visionPanel.classList.remove('hidden');
        btnVision.className = 'py-1.5 px-3 rounded-lg font-bold bg-violet-600 text-white transition cursor-pointer';
        btnManual.className = 'py-1.5 px-3 rounded-lg font-bold text-slate-300 hover:text-white transition cursor-pointer';
        drawVisionIdleGrid();
      } else {
        stopVisionCamera();
        visionPanel.classList.add('hidden');
        btnManual.className = 'py-1.5 px-3 rounded-lg font-bold bg-sky-600 text-white transition cursor-pointer';
        btnVision.className = 'py-1.5 px-3 rounded-lg font-bold text-slate-300 hover:text-white transition cursor-pointer';
      }
    }

    function drawVisionIdleGrid() {
      const canvas = document.getElementById('vision-canvas');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const w = canvas.width;
      const h = canvas.height;
      ctx.fillStyle = '#070D15';
      ctx.fillRect(0, 0, w, h);
      const zoneW = w / 3;
      const colors = ['rgba(56,189,248,0.28)', 'rgba(244,186,37,0.28)', 'rgba(52,211,153,0.28)'];
      const labels = ['ZONA 1: PICK', 'ZONA 2: MONTAGEM', 'ZONA 3: LIBERAÇÃO'];
      for (let i = 0; i < 3; i++) {
        ctx.strokeStyle = colors[i];
        ctx.lineWidth = 1.5;
        ctx.strokeRect(i * zoneW + 4, 4, zoneW - 8, h - 28);
        ctx.fillStyle = '#94A3B8';
        ctx.font = 'bold 10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(labels[i], i * zoneW + zoneW / 2, 20);
      }
    }

    async function startVisionCamera() {
      stopVisionCamera();
      const video = document.getElementById('vision-video');
      const statusEl = document.getElementById('vision-status-text');
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        if (statusEl) statusEl.textContent = 'Câmera indisponível neste navegador — use "🤖 Simular Bancada".';
        showToast('Câmera não detectada; iniciando modo bancada simulada');
        toggleSimulatedVision();
        return;
      }
      try {
        visionStream = await navigator.mediaDevices.getUserMedia({ video: { width: 480, height: 160 } });
        video.srcObject = visionStream;
        await video.play();
        if (!swRunning) toggleStopwatch();
        visionCycleStartMs = performance.now();
        visionStage = 0;
        if (statusEl) statusEl.textContent = 'Câmera ativa: monitorando movimento nas zonas Z1 → Z2 → Z3...';
        runVisionLoop(video);
      } catch (err) {
        if (statusEl) statusEl.textContent = 'Permissão de câmera negada — use "🤖 Simular Bancada".';
        showToast('Sem acesso à câmera; use "Simular Bancada" para testar');
      }
    }

    function toggleSimulatedVision() {
      if (visionSimulated) {
        stopVisionCamera();
        return;
      }
      stopVisionCamera();
      visionSimulated = true;
      visionPhase = 0;
      visionCycleStartMs = performance.now();
      const simBtn = document.getElementById('vision-sim-btn');
      const statusEl = document.getElementById('vision-status-text');
      if (simBtn) simBtn.textContent = '⏹ Parar Simulação';
      if (statusEl) statusEl.textContent = 'Bancada Óptica Simulada ativa: capturando ciclos automaticamente...';
      if (!swRunning) toggleStopwatch();
      runSimulatedBenchLoop();
    }

    function runSimulatedBenchLoop() {
      if (!visionSimulated) return;
      const canvas = document.getElementById('vision-canvas');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const w = canvas.width;
      const h = canvas.height;

      drawVisionIdleGrid();
      visionPhase += 0.024;
      const progress = (visionPhase % (Math.PI * 2)) / (Math.PI * 2);
      const handX = 45 + progress * (w - 90);
      const handY = 76 + Math.sin(visionPhase * 4) * 14;

      // Highlight active zone
      const activeZone = progress < 0.33 ? 1 : (progress < 0.72 ? 2 : 3);
      const z1 = activeZone === 1 ? Math.round(65 + Math.random() * 25) : 4;
      const z2 = activeZone === 2 ? Math.round(72 + Math.random() * 24) : 6;
      const z3 = activeZone === 3 ? Math.round(68 + Math.random() * 25) : 3;

      document.getElementById('vz-1').textContent = `Z1: Pick (${z1}%)`;
      document.getElementById('vz-2').textContent = `Z2: Montagem (${z2}%)`;
      document.getElementById('vz-3').textContent = `Z3: Liberação (${z3}%)`;

      // Draw optical tracking target on operator hand
      ctx.beginPath();
      ctx.arc(handX, handY, 13, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(244, 186, 37, 0.35)';
      ctx.fill();
      ctx.strokeStyle = '#F4BA25';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Auto-record cycle upon completing Z3 release
      if (progress > 0.96 && (performance.now() - visionCycleStartMs) > 2200) {
        visionCycleStartMs = performance.now();
        recordStopwatchLap();
      }

      visionAnimId = requestAnimationFrame(runSimulatedBenchLoop);
    }

    function runVisionLoop(video) {
      const canvas = document.getElementById('vision-canvas');
      if (!canvas || !visionStream) return;
      const ctx = canvas.getContext('2d');
      const w = canvas.width;
      const h = canvas.height;
      ctx.drawImage(video, 0, 0, w, h);

      const frame = ctx.getImageData(0, 0, w, h).data;
      if (visionPrevFrame) {
        const zoneW = Math.floor(w / 3);
        const motion = [0, 0, 0];
        for (let y = 0; y < h; y += 4) {
          for (let x = 0; x < w; x += 4) {
            const idx = (y * w + x) * 4;
            const diff = Math.abs(frame[idx] - visionPrevFrame[idx]) + Math.abs(frame[idx + 1] - visionPrevFrame[idx + 1]);
            if (diff > 45) {
              const z = Math.min(2, Math.floor(x / zoneW));
              motion[z]++;
            }
          }
        }
        const norm = (w / 12) * (h / 4);
        const pcts = motion.map(m => Math.min(99, Math.round((m / Math.max(1, norm)) * 350)));
        document.getElementById('vz-1').textContent = `Z1: Pick (${pcts[0]}%)`;
        document.getElementById('vz-2').textContent = `Z2: Montagem (${pcts[1]}%)`;
        document.getElementById('vz-3').textContent = `Z3: Liberação (${pcts[2]}%)`;

        if(visionStage===0&&pcts[0]>18)visionStage=1;
        else if(visionStage===1&&pcts[1]>18)visionStage=2;
        if (visionStage===2 && pcts[2] > 22 && (performance.now() - visionCycleStartMs) > 2500) {
          visionStage = 0;
          visionCycleStartMs = performance.now();
          recordStopwatchLap();
        }
      }
      visionPrevFrame = new Uint8ClampedArray(frame);

      // Overlay zones
      const zw = w / 3;
      ctx.strokeStyle = 'rgba(244, 186, 37, 0.55)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(2, 2, zw - 4, h - 24);
      ctx.strokeRect(zw + 2, 2, zw - 4, h - 24);
      ctx.strokeRect(zw * 2 + 2, 2, zw - 4, h - 24);

      visionAnimId = requestAnimationFrame(() => runVisionLoop(video));
    }

    function stopVisionCamera() {
      visionSimulated = false;
      if (visionAnimId) {
        cancelAnimationFrame(visionAnimId);
        visionAnimId = null;
      }
      if (visionStream) {
        visionStream.getTracks().forEach(t => t.stop());
        visionStream = null;
      }
      visionPrevFrame = null;visionStage=0;
      const simBtn = document.getElementById('vision-sim-btn');
      if (simBtn) simBtn.textContent = '🤖 Simular Bancada';
    }

    // 11. APPLICATION BOOTSTRAP
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      deferredInstallPrompt = e;
      document.getElementById('pwa-install-trigger')?.classList.remove('hidden');
    });

    document.addEventListener('click', e => {
      const wrapper = document.getElementById('study-picker-wrapper');
      if (wrapper && !wrapper.contains(e.target)) {
        toggleStudyPickerMenu(false);
      }
    });

    window.addEventListener('resize', () => {
      if(getActiveStudy())renderChart(getActiveStudy(), computeMetrics(getActiveStudy()));
    });

    async function bootstrapApp() {
      const embedded=document.getElementById('cb-embedded');
      appState=await openStore(createDefaultStudies, p=>{appState=p;acceptedState=structuredClone(p);undoStack=[];renderAll()}, updateSync, embedded?.textContent?.trim()?JSON.parse(embedded.textContent):null);
      acceptedState=structuredClone(appState);
      // Load shared study from URL hash if present (#study=...)
      try {
        if (window.location.hash.startsWith('#study=')) {
          const encoded = window.location.hash.slice(7);
          if(encoded.length>7000000)throw Error('Snapshot excede 5 MiB');
          const decoded = JSON.parse(decodeURIComponent(escape(atob(encoded))));
          if (decoded && Array.isArray(decoded.elements)) {
            const sharedStudy=normalize(decoded,true);
            appState.studies.unshift(sharedStudy);
            appState.activeStudyId = sharedStudy.id;
            saveAppState();
            history.replaceState(null, '', window.location.pathname + window.location.search);
            showToast(`Estudo compartilhado carregado: ${sharedStudy.name}`);
          }
        }
      } catch (e) {}

      // Attach chart canvas interactive hover tooltip
      const canvas = document.getElementById('cycle-canvas');
      const tooltip = document.getElementById('chart-tooltip');
      if (canvas && tooltip) {
        canvas.addEventListener('mousemove', ev => {
          const rect = canvas.getBoundingClientRect();
          const mx = ev.clientX - rect.left;
          const my = ev.clientY - rect.top;
          const hit = chartBarHitboxes.find(b => mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h);
          if (hit) {
            tooltip.textContent = hit.label;
            tooltip.classList.remove('hidden');
          } else {
            tooltip.classList.add('hidden');
          }
        });
        canvas.addEventListener('mouseleave', () => tooltip.classList.add('hidden'));
      }

      document.getElementById("boot-state")?.remove();document.body.classList.remove("cb-loading");
      initSidebarState();
      renderAll();
    }
  
    function updateSync(label){
      const elem=document.getElementById('sync-status-label');if(elem)elem.textContent=label;
      const btn=document.getElementById('sync-status-btn');btn?.setAttribute('data-state',label.startsWith('Sincronizado')?'synced':label.includes('Conflito')?'conflict':'local');
      if(label==='Conflito de versão')openCloudPanel();
    }
    function openCloudPanel(){openTools('cloud',{study:getActiveStudy(),notify:showToast});}
    function openQualityPanel(){openTools('quality',{study:getActiveStudy(),notify:showToast,onApply:(work,detail)=>{
      pushUndoSnapshot();Object.assign(getActiveStudy(),work);recordAudit('Restrições e evidências',detail);saveAppState();renderAll();
    }});}
    function exportWorkbook(){exportExcel(getActiveStudy(),computeMetrics(getActiveStudy()));}
    function toggleTheme(){const light=document.documentElement.classList.toggle('industrial-light');localStorage.setItem('cb-theme',light?'light':'dark');renderAll();}
    if(localStorage.getItem('cb-theme')==='light')document.documentElement.classList.add('industrial-light');

    const commands={addPrecedenceRule, addWorkElement, adjustStationCount, applyAiKaizenPlan, applyNlpAreaSuggestion, applyStopwatchToElement, applyTheoreticalMinStations, clearStopwatchLaps, closeAddAreaModal, closeAiCopilotModal, closeAuditModal, closeCompareModal, closeDeleteStudyModal, closeSharePwaModal, closeStopwatchModal, confirmDeleteSelectedStudies, copyExecutiveReportAI, copyShareUrl, createNewStudy, downloadStandaloneProject, duplicateActiveStudy, exportStudyCSV, exportStudyJSON, exportWorkbook, getActiveStudy, handleElementDragStart, handleStationDrop, hideDagTooltip, importStudyJSON, inferPrecedencesNLP, openAddAreaModal, openAiCopilotModal, openAuditModal, openCloudPanel, openCompareModal, openDeleteStudyModal, openQualityPanel, openSharePwaModal, openStopwatchModal, optimizeSimulatedAnnealingAI, previewNlpAreaClassification, rebalanceRPW, recalcStopwatchStats, recordStopwatchLap, removeArea, removeElement, removePrecedenceRule, renameActiveStudy, renderCompareTable, repairPrecedenceViolations, resetDemoStudies, resetStopwatch, requestGatewayReport, saveAiGatewayConfig, setChartMode, setStopwatchMode, setWorkFilter, showDagTooltip, startVisionCamera, stepInput, submitNewArea, switchActiveStudy, toggleAllAreas, toggleAreaDetails, toggleComparativeDrawer, toggleDeleteTarget, toggleElementFixedStation, toggleGuideDrawer, toggleMobileSidebar, togglePrecedenceModal, togglePremisesDrawer, toggleSidebar, toggleSimulatedVision, toggleStopwatch, toggleStudyPickerMenu, toggleTheme, toggleWorkSort, triggerPwaInstall, undoLastAction, updateAreaCost, updateDeleteConfirmState, updateElementField, updateParam, updateSeasonality};
    for (const [name,command] of Object.entries(commands)){
      window[name]=(...args)=>{try{const r=command(...args);if(r?.catch)r.catch(e=>{showToast(e.message);renderAll()});return r}catch(e){showToast(e.message);renderAll()}};
    }
    bootstrapApp().catch(e=>{document.getElementById('boot-state').textContent='Falha ao abrir o estudo: '+e.message;showToast(e.message)});
    if(import.meta.env.PROD && location.protocol!=='file:' && 'serviceWorker' in navigator)navigator.serviceWorker.register(import.meta.env.BASE_URL+'sw.js',{scope:import.meta.env.BASE_URL}).catch(e=>showToast('Instalação offline indisponível: '+e.message));
