import { test, expect, type Page } from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const boot=async(page:Page)=>{await page.goto('./');await expect(page.locator('#boot-state')).toHaveCount(0);await expect(page.locator('#study-picker-label')).toContainText(/Produto A|Soldagem/);};
test('Produto A deriva capacidade, ciclos e custos dos 15 elementos',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await boot(page);
  await expect(page.locator('#station-cycle-val')).toHaveText('96,0s');
  await expect(page.locator('#hypothesis-count')).toContainText('15 hipóteses');
  await expect(page.locator('#conclusion-text')).toContainText('8.647');
  await expect(page.locator('#bar-mo-vals')).toContainText('16,23');
  await expect(page.locator('#bar-ops-vals')).toContainText('5,63');
  await expect(page.locator('#sync-status-btn')).toContainText('Salvo localmente');
  await page.screenshot({path:info.outputPath('CronoBalance-desktop.png'),fullPage:true});
  for(const name of ['Yamazumi','Atual','Atual × Futuro','Futuro'])await page.getByRole('button',{name,exact:true}).first().click();
  expect(errors).toEqual([]);
});
test('edição NVA reativa, igualdade, excesso de Takt e persistência',async({page})=>{
  await boot(page);await page.getByRole('button',{name:'+ mostrar detalhes',exact:true}).first().click();
  const nva=page.locator('input[id$="-nvaFut"]').first();
  for(const [value,text] of [['58','Linha balanceada'],['59','acima do takt']] as const){await nva.fill(value);await nva.press('Tab');await expect(page.locator('#station-status-text')).toContainText(text)}
  await expect(page.locator('#station-cycle-val')).toHaveText('151,0s');await page.reload();await expect(page.locator('#station-cycle-val')).toHaveText('151,0s');
  await page.locator('#input-demand').fill('0');await page.locator('#input-demand').press('Tab');await expect(page.locator('#conclusion-badge')).toHaveText('Sem avaliação');
});
test('posto ocupado, monumento e proposta de alocação',async({page})=>{
  await boot(page);await page.getByRole('button',{name:'− Posto'}).click();await expect(page.locator('#toast-message')).toContainText('Posto ocupado');
  await page.getByTitle('Fixar como monumento no Posto F1').first().click();
  await page.getByRole('button',{name:/Otimizar \(I\.A\.\)/}).click();
  await expect(page.getByRole('dialog')).toContainText('ciclo proposto');await page.getByRole('button',{name:'Aplicar proposta'}).click();
  await expect(page.locator('#precedence-alert')).toBeHidden();await expect(page.locator('#station-cycle-val')).toHaveText('96,0s');
  await expect(page.locator('#stations-container').getByText('Separar e identificar material',{exact:true})).toBeVisible();
});
test('importa v1 e gera planilha XLSX e HTML autônomo',async({page,browser},info)=>{
  await boot(page);
  const file={version:1,project:{name:'Auditoria piloto',demand:180},current:[1],future:[1],operations:[{name:'Inspecionar',vaCurrent:50,nvaCurrent:20,vaFuture:50,nvaFuture:5}]};
  await page.locator('input[type=file]').first().setInputFiles({name:'legado.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(file))});
  await expect(page.locator('#study-picker-label')).toHaveText('Auditoria piloto');await expect(page.locator('#station-cycle-val')).toHaveText('55,0s');
  const xlsx=page.waitForEvent('download');await page.getByRole('button',{name:/Exportar Excel/}).click();
  const fileX=await xlsx;expect((await readFile((await fileX.path())!)).subarray(0,2).toString()).toBe('PK');
  const html=page.waitForEvent('download');await page.getByRole('button',{name:/Baixar Projeto/}).click();const path=info.outputPath('CronoBalance.html');await(await html).saveAs(path);
  const ctx=await browser.newContext({offline:true});const standalone=await ctx.newPage();await standalone.goto(pathToFileURL(path).href);
  await expect(standalone.locator('#study-picker-label')).toHaveText('Auditoria piloto');await expect(standalone.locator('#station-cycle-val')).toHaveText('55,0s');await ctx.close();
});
test('PWA reabre e edita sem rede',async({page,context})=>{
  await boot(page);await page.evaluate(async()=>{await navigator.serviceWorker.ready});
  await expect.poll(()=>page.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);await page.reload();await expect(page.locator('#station-cycle-val')).toHaveText('96,0s');
  await page.locator('#input-demand').fill('300');await page.locator('#input-demand').press('Tab');await expect(page.locator('#station-status-text')).toContainText('acima do takt');
  await page.reload();await expect(page.locator('#input-demand')).toHaveValue('300');
});
test('validação de evidências e confirmação de exclusão',async({page})=>{
  await boot(page);await page.locator('#hypothesis-count').click();await page.getByLabel('Estado da medição').selectOption('validated');
  await page.getByRole('button',{name:'Salvar restrições e evidência'}).click();await expect(page.getByRole('alert').last()).toContainText('evidência');
  await page.getByLabel('Evidência de validação').fill('REL-042');await page.getByRole('button',{name:'Salvar restrições e evidência'}).click();
  await expect(page.locator('#hypothesis-count')).toContainText('1 validado');
  await page.locator('#delete-study-btn').click();await expect(page.getByRole('button',{name:/Excluir Definitivamente/i})).toBeDisabled();
});
for(const width of [390,820]){
  test('navegação adaptada à largura de '+width+' px',async({page},info)=>{
    await page.setViewportSize({width,height:900});await boot(page);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
    await page.screenshot({path:info.outputPath('CronoBalance-'+width+'.png'),fullPage:true});
  });
}

test('500 elementos, simulação em worker e recálculo dos agregados abaixo de 16 ms',async({page},info)=>{
  await boot(page);
  const elements=Array.from({length:500},(_,i)=>({id:'E'+i,area:'Montagem',name:'Elemento '+i,
    currentStation:1+i%5,futureStation:1+i%5,vaCurrent:1,nvaCurrent:1,vaFuture:1,nvaFuture:0}));
  const file={version:2,project:{name:'Linha de carga',product:'P',shiftSeconds:27000,demand:180,stations:{current:5,future:5}},areas:[{name:'Montagem'}],elements};
  await page.locator('input[type=file]').first().setInputFiles({name:'carga.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(file))});
  await expect(page.locator('#station-cycle-val')).toHaveText('100,0s');
  await expect(page.locator('#monte-carlo-risk-badge')).toHaveText(/Risco Takt: \d+%/);
  await page.locator('#work-filter-input').fill('Elemento 499');
  const nva=page.locator('input[id$="-nvaFut"]').first();
  await page.evaluate(()=>performance.clearMeasures('cb-recalculo'));
  for(let n=1;n<=12;n++)await nva.fill(String(n));
  await expect(page.locator('#station-cycle-val')).toHaveText('112,0s');
  const samples=await page.evaluate(()=>performance.getEntriesByName('cb-recalculo').map(e=>e.duration).sort((a,b)=>a-b));
  expect(samples.length).toBeGreaterThanOrEqual(12);
  const p95=samples[Math.ceil(samples.length*.95)-1];
  await info.attach('tempos-de-calculo.json',{body:Buffer.from(JSON.stringify({elementos:500,p95,samples})),contentType:'application/json'});
  expect(p95).toBeLessThan(16);
});

test('a referência abre com dez regras e preserva o portfólio migrado',async({page})=>{
  await page.addInitScript(()=>{localStorage.setItem('cronobalance-industrial-v2',JSON.stringify({version:2,project:{name:'Meu piloto',stations:{current:1,future:1}},areas:[{name:'Controle'}],elements:[]}))});
  await page.goto('./');await expect(page.locator('#study-picker-label')).toHaveText('Meu piloto');
  await page.locator('#study-picker-trigger').click();await page.locator('#cb-reference-link').click();
  await expect(page.locator('#station-cycle-val')).toHaveText('96,0s');
  await expect(page.getByText(/10 regras/).first()).toBeVisible();
  await expect(page.locator('#strip-roi-val')).toContainText('591,7');
  await page.locator('#study-picker-trigger').click();await page.locator('#cb-reference-link').click();
  await expect(page.locator('#study-picker-label')).toHaveText('Meu piloto');
});
