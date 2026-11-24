// Passo 1a: o super-admin gera a credencial tipo nuvem `macuxierp` na aba Integração da empresa (portal config.).
// A chave em claro vai só para /home/user/jornada/credencial.json (fora do repositório); no print ela sai mascarada.
const { writeFileSync } = require('node:fs');
const { abrir, print, mascararChaves, entrarPortal, PORTAL } = require('./apoio.cjs');
(async () => {
  const { navegador, p } = await abrir();
  await entrarPortal(p);
  await print(p, '01a-portal-empresas', { inteira: false });
  await p.getByRole('link', { name: 'Thathyany Teste' }).click();
  await p.waitForLoadState('networkidle');
  await p.getByTestId('integracao.aba').waitFor();
  await p.getByTestId('integracao.api-identificador').fill('macuxierp');
  await p.getByTestId('integracao.api-nome').fill('ERP Thathyany (teste, simulado)');
  const caixa = p.getByTestId('integracao.api-recebe-pedidos');
  if (!(await caixa.isChecked())) await caixa.check();
  await print(p, '01b-portal-integracao-antes');
  await p.getByTestId('integracao.api-gerar').click();
  const el = p.getByTestId('integracao.api-chave');
  await el.waitFor({ timeout: 20000 });
  const chave = (await el.innerText()).trim();
  writeFileSync('/home/user/jornada/credencial.json', JSON.stringify({ conector_id: 'macuxierp', chave }) + '\n', { mode: 0o600 });
  await mascararChaves(p);
  await print(p, '01c-portal-credencial-gerada');
  await navegador.close();
})();
