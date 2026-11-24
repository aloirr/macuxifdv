// Passo 2a: o admin libera o acesso do vendedor que veio do ERP (Usuários → ⋯ → Enviar acesso).
const { abrir, print, entrarBko, BKO } = require('./apoio.cjs');
(async () => {
  const { navegador, p } = await abrir();
  await entrarBko(p);
  await p.goto(`${BKO}/usuarios`, { waitUntil: 'networkidle' });
  await p.getByText('Vendedor Teste').first().waitFor();
  await print(p, '02a-bko-usuarios-vendedor-do-erp', { inteira: false });
  const menu = p.locator('[data-testid^="usuarios.menu."]').nth(1);
  await menu.click();
  await p.waitForTimeout(500);
  // (o print do menu aberto ficou fora do PDF)
  await p.getByRole('menuitem', { name: /Enviar acesso|Redefinir senha/ }).click();
  await p.waitForTimeout(500);
  await print(p, '02c-bko-enviar-acesso-dialogo', { inteira: false });
  await p.getByTestId('usuarios.senha-confirmar').click();
  await p.waitForTimeout(2500);
  await print(p, '02d-bko-enviar-acesso-resultado', { inteira: false });
  console.log((await p.innerText('body')).slice(0, 3000));
  await navegador.close();
})();
