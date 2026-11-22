import { test,expect, type Page } from '@playwright/test';
const fixture={version:1,project:{name:'Linha de integração',product:'Corpo A',demand:180},current:[1,2],future:[1,2],
  operations:[{name:'Recebimento',vaCurrent:45,nvaCurrent:10,vaFuture:40,nvaFuture:5},{name:'Teste',vaCurrent:50,nvaCurrent:20,vaFuture:42,nvaFuture:5}]};
async function synced(page:Page){await expect(page.locator('#sync-status-btn')).toContainText('Sincronizado na nuvem',{timeout:18000})}
async function product(page:Page,value:string){
  const el=page.locator('#input-product');await el.fill(value);await el.dispatchEvent('change');
}
test('offline em duas sessões, conflito ETag, escolha remota e histórico real',async({browser,baseURL})=>{
  const first=await browser.newContext({baseURL}),second=await browser.newContext({baseURL});
  const a=await first.newPage(),b=await second.newPage();
  await a.goto('./');await expect(a.locator('#boot-state')).toHaveCount(0);
  await a.locator('input[type=file]').first().setInputFiles({name:'piloto.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});
  await expect(a.locator('#study-picker-label')).toHaveText('Linha de integração');await synced(a);
  await b.goto('./');await synced(b);await expect(b.locator('#study-picker-label')).toHaveText('Linha de integração');
  await first.setOffline(true);await product(a,'Versão no tablet');await expect(a.locator('#input-product')).toHaveValue('Versão no tablet');
  await product(b,'Versão na engenharia');await synced(b);
  await first.setOffline(false);await expect(a.getByRole('dialog')).toContainText('Resolver conflito de versão',{timeout:18000});
  await a.getByRole('button',{name:'Aceitar revisão do servidor'}).click();await synced(a);
  await a.getByRole('button',{name:'Fechar',exact:true}).click();await expect(a.locator('#input-product')).toHaveValue('Versão na engenharia');
  await a.locator('#sync-status-btn').click();await a.getByRole('button',{name:'Consultar histórico'}).click();
  await expect(a.getByRole('dialog')).toContainText('v2');await a.getByRole('button',{name:'Calcular proposta CP-SAT'}).click();
  await expect(a.getByRole('button',{name:'Aplicar revisão proposta'})).toBeVisible();
  await a.getByRole('button',{name:'Aplicar revisão proposta'}).click();await synced(a);
  await first.close();await second.close();
});
