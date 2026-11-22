(() => {
  'use strict';
  const KEY = 'cronobalance-industrial-v2';
  const LEGACY_KEY = 'cronobalance-industrial-v1';
  const $ = (q, root = document) => root.querySelector(q);
  const $$ = (q, root = document) => [...root.querySelectorAll(q)];
  let toastTimer;
  let deferredInstall;
  let migrationNotice = '';

  function seed() {
    return {
      version: 2,
      project: { name: 'Linha de montagem · Projeto piloto', product: 'Produto A', shiftSeconds: 27000, days: 22, demand: 180, dailyVolume: 35.2, laborCurrent: 1710, laborFuture: 1425, stations: { current: 6, future: 5 } },
      areas: [
        { name: 'Recebimento', costCurrent: 0.81, costFuture: 0.63 },
        { name: 'Preparação', costCurrent: 1.16, costFuture: 0.81 },
        { name: 'Montagem principal', costCurrent: 2.71, costFuture: 1.63 },
        { name: 'Montagem complementar', costCurrent: 1.32, costFuture: 0.91 },
        { name: 'Inspeção e teste', costCurrent: 1.11, costFuture: 0.85 },
        { name: 'Embalagem e expedição', costCurrent: 0.93, costFuture: 0.80 }
      ],
      elements: [
        { id: 'e01', area: 'Recebimento', name: 'Separar e identificar material', currentStation: 1, vaCurrent: 24, nvaCurrent: 12, futureStation: 1, vaFuture: 24, nvaFuture: 4 },
        { id: 'e02', area: 'Recebimento', name: 'Abastecer ponto de uso', currentStation: 1, vaCurrent: 22, nvaCurrent: 12, futureStation: 1, vaFuture: 22, nvaFuture: 5 },
        { id: 'e03', area: 'Preparação', name: 'Preparar componentes A', currentStation: 2, vaCurrent: 32, nvaCurrent: 18, futureStation: 2, vaFuture: 32, nvaFuture: 4 },
        { id: 'e04', area: 'Preparação', name: 'Preparar componentes B', currentStation: 2, vaCurrent: 30, nvaCurrent: 20, futureStation: 2, vaFuture: 30, nvaFuture: 4 },
        { id: 'e05', area: 'Montagem principal', name: 'Fixar subconjunto A', currentStation: 3, vaCurrent: 37, nvaCurrent: 32, futureStation: 1, vaFuture: 37, nvaFuture: 4 },
        { id: 'e06', area: 'Montagem principal', name: 'Fixar subconjunto B', currentStation: 3, vaCurrent: 24, nvaCurrent: 25, futureStation: 2, vaFuture: 24, nvaFuture: 2 },
        { id: 'e07', area: 'Montagem principal', name: 'Conectar chicote', currentStation: 3, vaCurrent: 20, nvaCurrent: 20.3, futureStation: 3, vaFuture: 20, nvaFuture: 2 },
        { id: 'e08', area: 'Montagem principal', name: 'Montar acabamento', currentStation: 3, vaCurrent: 15, nvaCurrent: 17, futureStation: 4, vaFuture: 15, nvaFuture: 2 },
        { id: 'e09', area: 'Montagem principal', name: 'Verificação da montagem', currentStation: 3, vaCurrent: 32, nvaCurrent: 34, futureStation: 5, vaFuture: 32, nvaFuture: 2 },
        { id: 'e10', area: 'Montagem complementar', name: 'Montar suporte', currentStation: 4, vaCurrent: 35, nvaCurrent: 17.5, futureStation: 4, vaFuture: 35, nvaFuture: 4 },
        { id: 'e11', area: 'Montagem complementar', name: 'Instalar acabamento', currentStation: 4, vaCurrent: 35, nvaCurrent: 17.5, futureStation: 4, vaFuture: 35, nvaFuture: 5 },
        { id: 'e12', area: 'Inspeção e teste', name: 'Executar teste funcional A', currentStation: 5, vaCurrent: 32.5, nvaCurrent: 15, futureStation: 3, vaFuture: 32.5, nvaFuture: 4.5 },
        { id: 'e13', area: 'Inspeção e teste', name: 'Executar teste funcional B', currentStation: 5, vaCurrent: 32.5, nvaCurrent: 15, futureStation: 3, vaFuture: 32.5, nvaFuture: 4.5 },
        { id: 'e14', area: 'Embalagem e expedição', name: 'Proteger produto', currentStation: 6, vaCurrent: 27, nvaCurrent: 13, futureStation: 5, vaFuture: 27, nvaFuture: 4 },
        { id: 'e15', area: 'Embalagem e expedição', name: 'Identificar e liberar', currentStation: 6, vaCurrent: 27, nvaCurrent: 13, futureStation: 5, vaFuture: 27, nvaFuture: 4 }
      ]
    };
  }
  function migrateLegacy(old) {
    const areas = (old.operations || []).map(op => ({
      name: String(op.name || 'Operação'),
      costCurrent: Number(op.costCurrent) || 0,
      costFuture: Number(op.costFuture) || 0
    }));
    const elements = (old.operations || []).map((op, i) => ({
      id: 'm' + (i + 1), area: areas[i].name, name: areas[i].name,
      currentStation: i + 1,
      vaCurrent: Number(op.vaCurrent) || 0, nvaCurrent: Number(op.nvaCurrent) || 0,
      futureStation: 1,
      vaFuture: Number(op.vaFuture) || 0, nvaFuture: Number(op.nvaFuture) || 0
    }));
    const futureCount = Math.max(1, Math.min(20, (old.future || []).length || 1));
    const loads = Array(futureCount).fill(0);
    [...elements].sort((a, b) => futureTime(b) - futureTime(a)).forEach(el => {
      const slot = loads.indexOf(Math.min(...loads));
      el.futureStation = slot + 1; loads[slot] += futureTime(el);
    });
    migrationNotice = 'Estudo antigo convertido: os ciclos agora são derivados dos tempos VA/NVA da tabela. Revise a alocação futura.';
    return {
      version: 2,
      project: { ...old.project, stations: { current: Math.max(1, Math.min(20, (old.current || []).length || elements.length || 1)), future: futureCount } },
      areas, elements
    };
  }
  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY));
      if (saved && saved.version === 2 && saved.project && Array.isArray(saved.elements) && Array.isArray(saved.areas)) return saved;
      const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY));
      if (legacy && legacy.version === 1) return migrateLegacy(legacy);
    } catch (_) { /* Usa o estudo de demonstração se o armazenamento não for válido. */ }
    return seed();
  }
  const clone = obj => JSON.parse(JSON.stringify(obj));
  const sum = (arr, fn = x => x) => arr.reduce((total, item) => total + fn(item), 0);
  const max = arr => Math.max(0, ...arr);
  const f1 = n => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(Number(n) || 0);
  const f2 = n => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);
  const money = n => 'R$ ' + new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(Number(n) || 0);
  const money2 = n => 'R$ ' + f2(n);
  const pct = n => (n < 0 ? '−' : '+') + f1(Math.abs(n)) + '%';
  const escapeHtml = text => String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const safeNum = value => Math.max(0, Number(value) || 0);
  const fieldTotals = (area, field) => sum(data.elements.filter(el => el.area === area), el => Number(el[field]) || 0);
  const futureTime = el => safeNum(el.vaFuture) + safeNum(el.nvaFuture);
  const currentTime = el => safeNum(el.vaCurrent) + safeNum(el.nvaCurrent);
  let data = load();

  function save(message = 'Salvo localmente') {
    try { localStorage.setItem(KEY, JSON.stringify(data)); $('#saved-state').textContent = message; }
    catch (_) { $('#saved-state').textContent = 'Armazenamento cheio — exporte um backup'; }
  }
  function toast(message) {
    const el = $('#toast'); el.textContent = message; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3800);
  }
  function loads(type) {
    const count = Math.max(1, Number(data.project.stations[type]) || 1);
    const arr = Array(count).fill(0);
    data.elements.forEach(el => {
      const station = Math.min(count, Math.max(1, Number(el[type === 'current' ? 'currentStation' : 'futureStation']) || 1));
      arr[station - 1] += type === 'current' ? currentTime(el) : futureTime(el);
    });
    return arr;
  }
  function metrics() {
    const current = loads('current'), future = loads('future');
    const currentCycle = max(current), futureCycle = max(future);
    const shift = safeNum(data.project.shiftSeconds), demand = safeNum(data.project.demand);
    const capCurrent = currentCycle ? shift / currentCycle : 0, capFuture = futureCycle ? shift / futureCycle : 0;
    const laborCurrent = safeNum(data.project.laborCurrent), laborFuture = safeNum(data.project.laborFuture);
    const costCurrent = capCurrent ? laborCurrent / capCurrent : 0, costFuture = capFuture ? laborFuture / capFuture : 0;
    const unitSaving = costCurrent - costFuture;
    const monthlySaving = unitSaving * safeNum(data.project.dailyVolume) * safeNum(data.project.days);
    const takt = demand ? shift / demand : 0;
    const currentVA = sum(data.elements, e => safeNum(e.vaCurrent)), futureVA = sum(data.elements, e => safeNum(e.vaFuture));
    const currentNVA = sum(data.elements, e => safeNum(e.nvaCurrent)), futureNVA = sum(data.elements, e => safeNum(e.nvaFuture));
    const workReduction = (currentVA + currentNVA) - (futureVA + futureNVA);
    const costOpsCurrent = sum(data.areas, a => safeNum(a.costCurrent));
    const costOpsFuture = sum(data.areas, a => safeNum(a.costFuture));
    return {
      current, future, currentCycle, futureCycle, capCurrent, capFuture, laborCurrent, laborFuture, costCurrent, costFuture, unitSaving, monthlySaving, takt,
      currentVA, futureVA, currentNVA, futureNVA, workReduction, costOpsCurrent, costOpsFuture,
      currentOperators: Number(data.project.stations.current) || 0, futureOperators: Number(data.project.stations.future) || 0,
      cycleChange: currentCycle ? (futureCycle / currentCycle - 1) * 100 : 0,
      capacityChange: capCurrent ? (capFuture / capCurrent - 1) * 100 : 0
    };
  }
  function setValue(id, value) {
    const input = $('#' + id);
    if (input && document.activeElement !== input) input.value = value;
  }
  function renderProject() {
    setValue('project-name', data.project.name); setValue('product-name', data.project.product);
    setValue('shift-time', data.project.shiftSeconds); setValue('month-days', data.project.days);
    setValue('shift-demand', data.project.demand); setValue('daily-volume', data.project.dailyVolume);
    setValue('labor-current', data.project.laborCurrent); setValue('labor-future', data.project.laborFuture);
  }
  function drawChart(canvas, values, prefix, takt, color, criticalIndex, state) {
    const box = canvas.getBoundingClientRect(); if (!box.width || !box.height) return;
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(box.width * scale); canvas.height = Math.round(box.height * scale);
    const ctx = canvas.getContext('2d'); ctx.scale(scale, scale);
    const w = box.width, h = box.height, pad = { left: 28, right: 12, top: 19, bottom: 28 };
    const plotW = w - pad.left - pad.right, plotH = h - pad.top - pad.bottom;
    const ceiling = Math.max(300, Math.ceil(Math.max(max(values), takt) / 50) * 50);
    const y = val => pad.top + plotH - val / ceiling * plotH;
    ctx.clearRect(0, 0, w, h); ctx.font = '10px Inter,Arial'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    const step = ceiling > 300 ? 100 : 50;
    for (let v = 0; v <= ceiling; v += step) {
      const py = y(v); ctx.beginPath(); ctx.moveTo(pad.left, py); ctx.lineTo(w - pad.right, py); ctx.strokeStyle = '#e6edf1'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = '#647785'; ctx.fillText(String(v), pad.left - 6, py);
    }
    if (takt > 0) {
      const taktColor = state === 'current' ? '#c92c31' : '#15822d';
      ctx.beginPath(); ctx.setLineDash([5, 4]); ctx.moveTo(pad.left, y(takt)); ctx.lineTo(w - pad.right, y(takt)); ctx.strokeStyle = taktColor; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);
      ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillStyle = state === 'current' ? '#b3242b' : '#146e2a'; ctx.font = '700 10px Inter,Arial'; ctx.fillText('Takt ' + f1(takt) + ' s', w - pad.right - 3, y(takt) - 3);
    }
    const gap = Math.min(9, plotW * 0.035), bw = Math.max(13, (plotW - gap * (values.length - 1)) / values.length), usedW = values.length * bw + (values.length - 1) * gap, start = pad.left + (plotW - usedW) / 2;
    values.forEach((val, i) => {
      const bx = start + i * (bw + gap), by = y(val), bh = Math.max(1, pad.top + plotH - by);
      ctx.fillStyle = i === criticalIndex ? '#ce2d33' : color; ctx.fillRect(bx, by, bw, bh);
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillStyle = '#1c3343'; ctx.font = '700 10px Inter,Arial'; ctx.fillText(f1(val), bx + bw / 2, by - 3);
      ctx.textBaseline = 'top'; ctx.fillStyle = '#243d4f'; ctx.font = '600 10px Inter,Arial'; ctx.fillText(prefix + (i + 1), bx + bw / 2, pad.top + plotH + 7);
    });
  }
  function renderStations(m) {
    const mount = (type, id, values) => {
      const el = $('#' + id), stationName = type === 'current' ? 'atual' : 'futuro';
      el.innerHTML = values.map((v, i) => '<span class="station-chip"><b>F' + (i + 1) + '</b><span>' + f1(v) + ' s</span></span>').join('') +
        '<button class="mini-button add-station" type="button" data-station-add="' + type + '" aria-label="Adicionar posto ' + stationName + '">+ posto</button>' +
        '<button class="mini-button add-station" type="button" data-station-remove="' + type + '" aria-label="Remover último posto ' + stationName + '">− vazio</button>';
    };
    mount('current', 'current-station-editor', m.current); mount('future', 'future-station-editor', m.future);
    $$('[data-station-add]').forEach(button => button.addEventListener('click', () => {
      const type = button.dataset.stationAdd;
      if (data.project.stations[type] >= 20) return toast('Limite de 20 postos por cenário');
      data.project.stations[type] += 1; renderAll(); save(); toast('Posto ' + type + ' adicionado. Aloque os elementos de trabalho nele.');
    }));
    $$('[data-station-remove]').forEach(button => button.addEventListener('click', () => {
      const type = button.dataset.stationRemove, count = data.project.stations[type];
      if (count <= 1) return toast('O cenário precisa ter pelo menos um posto');
      const field = type === 'current' ? 'currentStation' : 'futureStation';
      if (data.elements.some(el => Number(el[field]) === count)) return toast('Realoque os elementos do último posto antes de removê-lo');
      data.project.stations[type] -= 1; renderAll(); save(); toast('Último posto vazio removido');
    }));
  }
  function renderOperations(m) {
    const body = $('#operations-table tbody'), foot = $('#operations-table tfoot');
    body.innerHTML = data.areas.map((area, index) =>
      '<tr><td><input class="inline-input name-input" aria-label="Nome da operação" data-area-index="' + index + '" data-area-field="name" value="' + escapeHtml(area.name) + '" maxlength="80"></td>' +
      '<td>' + f1(fieldTotals(area.name, 'vaCurrent')) + '</td><td>' + f1(fieldTotals(area.name, 'vaFuture')) + '</td>' +
      '<td>' + f1(fieldTotals(area.name, 'nvaCurrent')) + '</td><td>' + f1(fieldTotals(area.name, 'nvaFuture')) + '</td>' +
      '<td><input class="inline-input" aria-label="Custo operacional atual por peça" data-area-index="' + index + '" data-area-field="costCurrent" type="number" min="0" step=".01" value="' + Number(area.costCurrent) + '"></td>' +
      '<td><input class="inline-input" aria-label="Custo operacional futuro por peça" data-area-index="' + index + '" data-area-field="costFuture" type="number" min="0" step=".01" value="' + Number(area.costFuture) + '"></td>' +
      '<td><button class="row-remove" aria-label="Excluir ' + escapeHtml(area.name) + '" data-area-remove="' + index + '">×</button></td></tr>'
    ).join('');
    foot.innerHTML = '<tr><td>TOTAL DO ESTUDO</td><td>' + f1(m.currentVA) + '</td><td>' + f1(m.futureVA) + '</td><td>' + f1(m.currentNVA) + '</td><td>' + f1(m.futureNVA) + '</td><td>' + money2(m.costOpsCurrent) + '</td><td>' + money2(m.costOpsFuture) + '</td><td></td></tr>';
    $$('.inline-input[data-area-field]', body).forEach(input => input.addEventListener('change', () => {
      const area = data.areas[Number(input.dataset.areaIndex)], field = input.dataset.areaField;
      if (field === 'name') {
        const name = input.value.trim() || 'Operação sem nome';
        if (data.areas.some((item, i) => i !== Number(input.dataset.areaIndex) && item.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR'))) {
          toast('Já existe uma área com esse nome'); renderAll(); return;
        }
        const oldName = area.name; area.name = name;
        data.elements.filter(el => el.area === oldName).forEach(el => { el.area = name; });
      } else area[field] = safeNum(input.value);
      renderAll(); save();
    }));
    $$('[data-area-remove]', body).forEach(button => button.addEventListener('click', () => {
      const area = data.areas.splice(Number(button.dataset.areaRemove), 1)[0];
      data.elements = data.elements.filter(el => el.area !== area.name);
      renderAll(); save(); toast('Operação e elementos associados removidos');
    }));
  }
  function stationOptions(count, selected, type, id) {
    let html = '<select class="task-select" aria-label="' + type + '" data-element="' + id + '" data-field="' + type + '">';
    for (let i = 1; i <= count; i++) html += '<option value="' + i + '"' + (Number(selected) === i ? ' selected' : '') + '>F' + i + '</option>';
    return html + '</select>';
  }
  function renderTasks() {
    const body = $('#tasks-table tbody');
    body.innerHTML = data.elements.map((el, index) =>
      '<tr><td><select class="task-select task-area-select" aria-label="Área de ' + escapeHtml(el.name) + '" data-element="' + escapeHtml(el.id) + '" data-field="area">' +
      data.areas.map(a => '<option' + (a.name === el.area ? ' selected' : '') + '>' + escapeHtml(a.name) + '</option>').join('') + '</select>' +
      '<input class="task-cell-input task-name-input" aria-label="Elemento de trabalho" data-element="' + escapeHtml(el.id) + '" data-field="name" value="' + escapeHtml(el.name) + '"></td>' +
      '<td>' + stationOptions(data.project.stations.current, el.currentStation, 'currentStation', el.id) + '</td>' +
      numberTaskCell(el, 'vaCurrent', 'VA atual') + numberTaskCell(el, 'nvaCurrent', 'NVA atual') +
      '<td class="task-total">' + f1(currentTime(el)) + '</td>' +
      '<td>' + stationOptions(data.project.stations.future, el.futureStation, 'futureStation', el.id) + '</td>' +
      numberTaskCell(el, 'vaFuture', 'VA futuro') + numberTaskCell(el, 'nvaFuture', 'NVA futuro') +
      '<td class="task-total">' + f1(futureTime(el)) + '</td>' +
      '<td><button class="row-remove" aria-label="Excluir elemento ' + escapeHtml(el.name) + '" data-element-remove="' + escapeHtml(el.id) + '">×</button></td></tr>'
    ).join('');
    $$('.task-cell-input,.task-select', body).forEach(input => input.addEventListener('change', () => {
      const el = data.elements.find(item => item.id === input.dataset.element), field = input.dataset.field;
      if (!el) return;
      el[field] = field === 'name' ? (input.value.trim() || 'Elemento sem nome') :
        (field === 'area' ? input.value : (field.includes('Station') ? Math.max(1, Number(input.value) || 1) : safeNum(input.value)));
      renderAll(); save();
    }));
    $$('[data-element-remove]', body).forEach(button => button.addEventListener('click', () => {
      data.elements = data.elements.filter(el => el.id !== button.dataset.elementRemove);
      renderAll(); save(); toast('Elemento removido; os ciclos foram recalculados');
    }));
    const m = metrics();
    const reduction = m.currentVA + m.currentNVA - m.futureVA - m.futureNVA;
    $('#task-summary').textContent = 'Conteúdo VA + NVA: atual ' + f1(m.currentVA + m.currentNVA) + ' s → futuro ' + f1(m.futureVA + m.futureNVA) + ' s · NVA: ' + f1(m.currentNVA) + ' → ' + f1(m.futureNVA) + ' s · redução planejada: ' + f1(reduction) + ' s. Valide a hipótese de melhoria com dados do processo.';
  }
  function numberTaskCell(el, field, label) {
    return '<td><input class="task-cell-input" aria-label="' + label + ' para ' + escapeHtml(el.name) + '" data-element="' + escapeHtml(el.id) + '" data-field="' + field + '" type="number" min="0" step=".1" value="' + Number(el[field]) + '"></td>';
  }
  function indicatorRow(label, current, future, variation, goodWhenUp = false, formatter = f1, deltaFormatter = pct) {
    const favorable = variation === 'Referência' ? null : (typeof variation === 'string' ? goodWhenUp : variation === 0 ? null : (goodWhenUp ? variation > 0 : variation < 0));
    const delta = typeof variation === 'string' ? variation : deltaFormatter(variation);
    return '<tr><td>' + label + '</td><td>' + formatter(current) + '</td><td>' + formatter(future) + '</td><td><span class="' + (favorable === null ? '' : favorable ? 'delta-good' : 'delta-bad') + '">' + delta + '</span></td></tr>';
  }
  function renderIndicators(m) {
    const currentBottleneck = m.current.indexOf(m.currentCycle), futureBottleneck = m.future.indexOf(m.futureCycle);
    $('#current-bottleneck').textContent = 'Gargalo: Posto F' + (currentBottleneck + 1) + ' (' + f1(m.currentCycle) + ' s)';
    $('#current-bottleneck-pill').textContent = 'Gargalo F' + (currentBottleneck + 1);
    $('#current-cycle-label').textContent = f1(m.currentCycle) + ' s';
    $('#future-cycle-label').textContent = f1(m.futureCycle) + ' s';
    const hasTakt = m.takt > 0;
    const meetsTakt = hasTakt && m.futureCycle <= m.takt;
    const taktGap = m.futureCycle - m.takt;
    const status = meetsTakt ? 'Cenário futuro · dentro do takt' : (hasTakt ? 'Plano futuro · ' + f1(taktGap) + ' s acima do takt' : 'Informe demanda e tempo do turno');
    $('#future-status').textContent = status;
    const futureFoot = $('.future-card .chart-foot');
    futureFoot.classList.toggle('warning-foot', !meetsTakt);
    futureFoot.classList.toggle('green-foot', meetsTakt);
    const outcome = $('#line-outcome');
    outcome.classList.toggle('warning-note', !meetsTakt);
    outcome.querySelector('strong').textContent = meetsTakt ?
      'Cenário futuro atende ao takt, sujeito à validação das tarefas.' :
      (hasTakt ? 'Rever plano: o ciclo futuro está acima do takt informado.' : 'Informe jornada e demanda para avaliar o takt.');
    const rows = [
      indicatorRow('◷ &nbsp; Ciclo da linha (s)', m.currentCycle, m.futureCycle, m.cycleChange),
      indicatorRow('⏱ &nbsp; Takt calculado (s)', m.takt, m.takt, 'Referência'),
      indicatorRow('✓ &nbsp; Atendimento ao takt', m.currentCycle <= m.takt, meetsTakt, 'Atual ' + (m.currentCycle <= m.takt ? 'sim' : 'não') + ' · futuro ' + (meetsTakt ? 'sim' : 'não'), meetsTakt, v => v ? 'Sim' : 'Não', v => v),
      indicatorRow('▦ &nbsp; Capacidade teórica (un/turno)', m.capCurrent, m.capFuture, m.capacityChange, true),
      indicatorRow('♟ &nbsp; Postos / operadores', m.currentOperators, m.futureOperators, m.futureOperators - m.currentOperators, false, n => f1(n), n => (n < 0 ? '−' : '+') + f1(Math.abs(n))),
      indicatorRow('$ &nbsp; Custo da equipe (R$/turno)', m.laborCurrent, m.laborFuture, m.laborFuture - m.laborCurrent, false, money, n => (n < 0 ? '−' : '+') + money(Math.abs(n))),
      indicatorRow('▤ &nbsp; Mão de obra por peça (R$)', m.costCurrent, m.costFuture, m.costFuture - m.costCurrent, false, money2, n => (n < 0 ? '−' : '+') + money2(Math.abs(n))),
      indicatorRow('▧ &nbsp; Custo operacional alocado (R$/peça)', m.costOpsCurrent, m.costOpsFuture, m.costOpsFuture - m.costOpsCurrent, false, money2, n => (n < 0 ? '−' : '+') + money2(Math.abs(n))),
      '<tr><td>▣ &nbsp; Economia potencial/mês (' + data.project.days + ' dias)</td><td>—</td><td colspan="2"><span class="' + (m.monthlySaving >= 0 ? 'delta-good' : 'delta-bad') + '">' + money(m.monthlySaving) + '</span></td></tr>'
    ];
    $('#indicators-table tbody').innerHTML = rows.join('');
    $('#cycle-gain').textContent = pct(m.cycleChange);
    $('#capacity-gain').textContent = pct(m.capacityChange);
    $('#unit-saving').textContent = money2(m.unitSaving);
    $('#monthly-saving').textContent = money(m.monthlySaving);
    drawChart($('#current-chart'), m.current, 'F', m.takt, '#2584bd', currentBottleneck, 'current');
    drawChart($('#future-chart'), m.future, 'F', m.takt, '#2181b7', -1, 'future');
  }
  function renderAll() {
    const m = metrics();
    renderProject(); renderStations(m); renderOperations(m); renderTasks(); renderIndicators(m);
  }
  function addAreaAndElement(values) {
    const area = values || { name: 'Nova operação', costCurrent: 0, costFuture: 0 };
    if (data.areas.some(a => a.name === area.name)) area.name = area.name + ' ' + (data.areas.length + 1);
    data.areas.push(area);
    const futureSlot = loads('future').indexOf(Math.min(...loads('future'))) + 1;
    data.elements.push({
      id: 'e' + Date.now(), area: area.name, name: 'Novo elemento de trabalho',
      currentStation: Math.min(data.project.stations.current, data.project.stations.current),
      vaCurrent: 30, nvaCurrent: 10, futureStation: futureSlot, vaFuture: 30, nvaFuture: 5
    });
  }
  function addElement() {
    if (!data.areas.length) addAreaAndElement();
    else {
      const futureLoads = loads('future'), slot = futureLoads.indexOf(Math.min(...futureLoads)) + 1;
      data.elements.push({ id: 'e' + Date.now(), area: data.areas[0].name, name: 'Novo elemento de trabalho', currentStation: 1, vaCurrent: 10, nvaCurrent: 3, futureStation: slot, vaFuture: 10, nvaFuture: 1 });
    }
    renderAll(); save(); toast('Elemento adicionado. Atualize tempos e postos para refletir o processo.');
  }
  function rebalance() {
    const count = Number(data.project.stations.future) || 1;
    const bins = Array(count).fill(0);
    [...data.elements].sort((a, b) => futureTime(b) - futureTime(a)).forEach(el => {
      const i = bins.indexOf(Math.min(...bins));
      el.futureStation = i + 1; bins[i] += futureTime(el);
    });
    renderAll(); save(); toast('Alocação heurística sugerida por carga. Confira precedências, ergonomia e viabilidade antes de aplicar.');
  }
  function importData(obj) {
    if (obj && obj.version === 1 && Array.isArray(obj.operations)) { data = migrateLegacy(obj); return; }
    if (!obj || obj.version !== 2 || !obj.project || !obj.project.stations || !Array.isArray(obj.elements) || !Array.isArray(obj.areas)) throw new Error('Formato do projeto não reconhecido');
    if (obj.elements.length > 500 || obj.areas.length > 100 || obj.project.stations.current > 20 || obj.project.stations.future > 20) throw new Error('O arquivo excede o limite de elementos, áreas ou postos');
    data = obj;
  }

  $('#project-name').addEventListener('change', e => { data.project.name = e.target.value.trim() || 'Estudo sem título'; save(); });
  $('#product-name').addEventListener('change', e => { data.project.product = e.target.value.trim() || 'Produto'; save(); });
  const numberBindings = { 'shift-time': 'shiftSeconds', 'month-days': 'days', 'shift-demand': 'demand', 'daily-volume': 'dailyVolume', 'labor-current': 'laborCurrent', 'labor-future': 'laborFuture' };
  Object.entries(numberBindings).forEach(([id, field]) => $('#' + id).addEventListener('change', e => {
    const min = field === 'days' ? 1 : 0;
    const maxValue = field === 'days' ? 31 : Number.MAX_SAFE_INTEGER;
    data.project[field] = Math.min(maxValue, Math.max(min, Number(e.target.value) || 0));
    renderAll(); save();
  }));
  $('#rebalance-button').addEventListener('click', rebalance);
  $('#add-element').addEventListener('click', addElement);
  $('#add-operation').addEventListener('click', () => $('#operation-dialog').showModal());
  $('#operation-form').addEventListener('submit', event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget), name = String(form.get('name')).trim();
    const area = { name: name || 'Nova operação', costCurrent: safeNum(form.get('costCurrent')), costFuture: safeNum(form.get('costFuture')) };
    if (data.areas.some(item => item.name.toLocaleLowerCase('pt-BR') === area.name.toLocaleLowerCase('pt-BR'))) {
      toast('Já existe uma operação com esse nome'); return;
    }
    const element = {
      id: 'e' + Date.now(), area: area.name, name: name || 'Novo elemento',
      currentStation: data.project.stations.current, vaCurrent: safeNum(form.get('vaCurrent')), nvaCurrent: safeNum(form.get('nvaCurrent')),
      futureStation: loads('future').indexOf(Math.min(...loads('future'))) + 1,
      vaFuture: safeNum(form.get('vaFuture')), nvaFuture: safeNum(form.get('nvaFuture'))
    };
    data.areas.push(area); data.elements.push(element);
    event.currentTarget.reset(); $('#operation-dialog').close(); renderAll(); save(); toast('Operação e elemento adicionados ao estudo');
  });
  $('#export-button').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'cronobalance-' + new Date().toISOString().slice(0, 10) + '.json'; a.click(); URL.revokeObjectURL(a.href); toast('Backup do estudo exportado');
  });
  $('#import-file').addEventListener('change', async event => {
    const file = event.target.files && event.target.files[0]; if (!file) return;
    try {
      importData(JSON.parse(await file.text())); renderAll(); save();
      toast(migrationNotice || 'Estudo importado. Confira dados e premissas.'); migrationNotice = '';
    } catch (error) { toast(error.message || 'Não foi possível importar esse arquivo'); }
    event.target.value = '';
  });
  $('#reset-button').addEventListener('click', () => { data = seed(); renderAll(); save(); toast('Estudo de demonstração restaurado'); });
  window.addEventListener('resize', () => renderIndicators(metrics()));
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredInstall = event; $('#install-button').hidden = false; });
  $('#install-button').addEventListener('click', async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; $('#install-button').hidden = true; });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('service-worker.js').catch(() => {});
  if (location.protocol === 'https:' || location.hostname === 'localhost') $('#connection-label').textContent = 'Local-first · pronto para uso offline';
  renderAll(); save();
  if (migrationNotice) { toast(migrationNotice); migrationNotice = ''; }
})();
