// Passo 4: o vendedor faz o pedido na TELA REAL do Novo pedido (react-native-web, motor de sync real) e sincroniza.
import { writeFileSync } from 'node:fs';
import { tela } from '../app-campo/gerar.mjs';
const CLIENTE = process.argv[2] ?? '346011f8-ef55-449b-8bdc-5874eae4f6dd';
const shot = async (p, nome) => { await p.waitForTimeout(800); await p.screenshot({ path: new URL(`../telas/${nome}.png`, import.meta.url).pathname, fullPage: true }); console.log('print', nome); };
const corpo = async (p) => (await p.innerText('body')).replace(/\n+/g, ' | ').slice(0, 900);
const info = await tela('novo-pedido', '_depois-do-envio', { params: { customerId: CLIENTE } }, {
  antes: async (p) => {
    await shot(p, '05a-campo-novo-pedido');
    await p.getByTestId('avancar').click();
    for (const [busca, sku, qtd] of [['Café', 'P001', '10'], ['Açúcar', 'P002', '20']]) {
      const campo = p.locator('[data-testid="product-search"] input, input[data-testid="product-search"]').first();
      await campo.fill(busca);
      await p.getByTestId(`adicionar-${sku}`).click();
      await p.getByTestId('popup-item-qtd-valor').fill(qtd);
      await p.waitForTimeout(500);
      if (sku === 'P001') await shot(p, '05b-campo-novo-pedido-item');
      await p.getByTestId('popup-item-confirmar').click();
      await p.waitForTimeout(800);
    }
    await shot(p, '05c-campo-novo-pedido-itens');
    for (let i = 0; i < 3 && (await p.getByTestId('avancar').count()); i += 1) { await p.getByTestId('avancar').click(); await p.waitForTimeout(1200); }
    console.log('RESUMO:', await corpo(p));
    console.log((await p.$$eval('[data-testid]', (es) => es.map((e) => e.getAttribute('data-testid')))).join(' '));
    await shot(p, '05d-campo-novo-pedido-resumo');
    await p.getByTestId('send-order').click();
    await p.waitForTimeout(1500);
    console.log('DEPOIS DO ENVIAR:', await corpo(p));
    console.log((await p.$$eval('[data-testid]', (es) => es.map((e) => e.getAttribute('data-testid')))).join(' '));
    await shot(p, '05e0-campo-confirmacao');
    const conf = p.getByText(/^(Enviar|Confirmar|Enviar pedido|Sim, enviar)$/);
    if (await conf.count()) { await conf.last().click(); await p.waitForTimeout(2500); }
    await p.evaluate(async () => { await window.__motor.sincronizar(); });
    await p.waitForTimeout(1500);
    await shot(p, '05e-campo-pedido-enviado');
    const est = await p.evaluate(() => ({ fila: window.__motor.estado().fila.length, erro: window.__motor.estado().erro, aceitos: window.__motor.estado().aceitos, nav: window.__nav }));
    console.log('ESTADO:', JSON.stringify(est).slice(0, 1500));
    writeFileSync('/home/user/jornada/saida/pedido-campo.json', JSON.stringify(est, null, 2));
  },
});
