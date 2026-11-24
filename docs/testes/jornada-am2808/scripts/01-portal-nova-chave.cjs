// Passo 1a (refeito): a primeira chave apareceu num print sem máscara (descartado) e foi trocada por "Gerar nova chave".
// A chave nova vai só para /home/user/jornada/credencial.json; o print sai mascarado e é conferido antes de salvar.
const { writeFileSync } = require('node:fs');
const { abrir, print, mascararChaves, entrarPortal } = require('./apoio.cjs');
(async () => {
  const { navegador, p } = await abrir();
  await entrarPortal(p);
  await p.getByRole('link', { name: 'Thathyany Teste' }).click();
  await p.getByTestId('integracao.aba').waitFor();
  await p.waitForLoadState('networkidle');
  await p.getByTestId('integracao.nova-chave-macuxierp').click();
  await p.getByRole('dialog').getByRole('button', { name: 'Gerar nova chave' }).click();
  const el = p.getByTestId('integracao.nova-chave-macuxierp.chave');
  await el.waitFor({ timeout: 20000 });
  const chave = (await el.innerText()).trim();
  writeFileSync('/home/user/jornada/credencial.json', JSON.stringify({ conector_id: 'macuxierp', chave }) + '\n', { mode: 0o600 });
  await mascararChaves(p);
  const sobrou = (await p.innerText('body')).includes(chave);
  if (sobrou) throw new Error('chave ainda visível: print cancelado');
  await print(p, '01c-portal-credencial-gerada');
  await navegador.close();
})();
