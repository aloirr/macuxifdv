// Passos 4–6: o pedido no BKO (Operação → Pedidos, lista e detalhe) e no monitor da Integração ERP. Uso: node 06-bko-pedido.cjs <sufixo>
const { abrir, print, entrarBko, BKO } = require('./apoio.cjs');
const suf = process.argv[2] ?? 'x';
(async () => {
  const { navegador, p } = await abrir();
  await entrarBko(p);
  await p.goto(`${BKO}/pedidos`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);
  await print(p, `06-bko-pedidos-${suf}`, { inteira: false });
  await p.setViewportSize({ width: 1366, height: 2300 });
  await p.getByText('000001').first().click();
  await p.waitForTimeout(3000);
  await print(p, `06-bko-pedido-detalhe-${suf}`, { inteira: false });
  await p.setViewportSize({ width: 1366, height: 860 });
  console.log(p.url());
  await p.goto(`${BKO}/integracao`, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2500);
  // o monitor da Integração ERP não muda com o pedido (só as cargas): o print dele fica no passo 2
  await navegador.close();
})();
