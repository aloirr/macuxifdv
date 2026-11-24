// Passo 2: os dados da carga no BKO (admin): Integração ERP (monitor), Filiais, Clientes (Código FDV e Código ERP), Catálogo,
// Tabelas de preço e Formas de pagamento. Mostra também a aba Integração da empresa no portal depois da carga.
const { abrir, print, entrarBko, entrarPortal, mascararChaves, BKO } = require('./apoio.cjs');
const espera = async (p, url) => { await p.goto(`${BKO}${url}`, { waitUntil: 'networkidle' }); await p.waitForTimeout(2500); };
(async () => {
  const { navegador, p } = await abrir();
  await entrarBko(p);
  for (const [url, nome] of [['/integracao', '03a-bko-integracao-monitor'], ['/filiais', '03b-bko-filiais'], ['/clientes', '03c-bko-clientes'], ['/catalogo', '03e-bko-catalogo'], ['/tabelas-preco', '03f-bko-tabelas-preco'], ['/formas-pagamento', '03g-bko-formas-pagamento']]) {
    await espera(p, url);
    await print(p, nome);
    if (url === '/clientes') {
      await p.getByRole('link', { name: 'Mercadinho Teste' }).first().click();
      await p.waitForTimeout(2500);
      await print(p, '03d-bko-cliente-ficha');
    }
    if (url === '/tabelas-preco') {
      const linha = p.getByRole('link', { name: /Tabela Teste/ }).first();
      if (await linha.count()) { await linha.click(); await p.waitForTimeout(2500); await print(p, '03f2-bko-tabela-preco-itens'); }
    }
  }
  const pt = await (await navegador.newContext({ viewport: { width: 1366, height: 860 }, deviceScaleFactor: 2, timezoneId: 'America/Manaus', locale: 'pt-BR' })).newPage();
  await entrarPortal(pt);
  await pt.getByRole('link', { name: 'Thathyany Teste' }).click();
  await pt.getByTestId('integracao.aba').waitFor();
  await pt.waitForLoadState('networkidle');
  await pt.waitForTimeout(1500);
  await mascararChaves(pt);
  await print(pt, '03h-portal-integracao-depois-da-carga');
  await navegador.close();
})();
