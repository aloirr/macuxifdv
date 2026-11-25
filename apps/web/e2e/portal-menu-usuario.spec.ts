/**
 * e2e do menu do usuário no portal (v1.0.34; R-20261124-083005, 083110 e 083356), modo falso, nos dois hosts (`config.localhost`
 * na raiz e `fdv.localhost/config`, ADR 0071): o botão no canto superior direito com o perfil (e o cargo do admin do cliente),
 * abrir e fechar (clique, Esc, setas), sem "Dados cadastrais" (repetiriam a tela), "Trocar a senha" do admin do cliente (senha atual errada e a troca que
 * encerra a sessão do portal, com "Senha trocada. Entre de novo.") e o "Sair". Print em 1366 px (escala 2) com o menu aberto em
 * `E2E_PRINTS_DIR`, quando definido.
 */
import { expect, test, type Page } from '@playwright/test';

import { urlDoPortal } from './enderecos';

const SENHA = 'Senha#Forte2026';

async function entrar(page: Page, email: string) {
  await page.goto(urlDoPortal('/entrar'));
  await page.getByTestId('entrar.email').fill(email);
  await page.getByTestId('entrar.senha').fill(SENHA);
  await page.getByTestId('entrar.entrar').click();
  await expect(page.getByTestId('menu-usuario.botao')).toBeVisible({ timeout: 60000 });
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
}

/** O 1º clique pode chegar antes da hidratação: repete até a lista abrir. */
async function abrirMenu(page: Page) {
  await expect(async () => {
    if (!(await page.getByTestId('menu-usuario.lista').isVisible())) await page.getByTestId('menu-usuario.botao').click();
    await expect(page.getByTestId('menu-usuario.lista')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30000 });
}

test('time Macuxi: menu com "Time Macuxi" e só Sair (sem Dados cadastrais, que repetiriam o botão, nem Trocar a senha); teclado e Esc', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await entrar(page, 'time@macuxi.com.br');
  const botao = page.getByTestId('menu-usuario.botao');
  await expect(botao).toHaveAttribute('aria-haspopup', 'menu');
  await expect(botao).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('menu-usuario.titulo')).toHaveText('Time Macuxi');
  // o "Sair" solto saiu do cabeçalho
  await expect(page.getByTestId('portal.sair')).toHaveCount(0);

  await abrirMenu(page);
  await expect(botao).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('menuitem')).toHaveText(['Sair']);
  await expect(page.getByTestId('menu-usuario.dados')).toHaveCount(0);
  await expect(page.getByTestId('menu-usuario.sair')).toBeFocused();
  if (process.env.E2E_PRINTS_DIR) await page.screenshot({ animations: 'disabled', path: `${process.env.E2E_PRINTS_DIR}/portal-time-macuxi-menu-aberto-${test.info().project.name}-1366.png` });
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('menu-usuario.sair')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('menu-usuario.lista')).toHaveCount(0);
  await expect(botao).toBeFocused();
  // clique fora fecha
  await abrirMenu(page);
  await page.mouse.click(10, 500);
  await expect(page.getByTestId('menu-usuario.lista')).toHaveCount(0);

  await abrirMenu(page);
  await page.getByTestId('menu-usuario.sair').click();
  await expect(page.getByTestId('entrar.email')).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('entrar.aviso')).toHaveCount(0);
  await ctx.close();
});

test('admin do cliente: perfil e cargo; Trocar a senha (atual errada, depois a troca) e a volta à entrada com o aviso', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await entrar(page, 'admin@uma.com.br');
  await expect(page.getByTestId('menu-usuario.titulo')).toHaveText('Admin');
  await expect(page.getByTestId('menu-usuario.detalhe')).toHaveText('Administrativo');

  await abrirMenu(page);
  // sem "Dados cadastrais": perfil e cargo estão no botão e a empresa é o título da página (RD-3122)
  await expect(page.getByRole('menuitem')).toHaveText(['Trocar a senha', 'Sair']);
  await expect(page.getByTestId('menu-usuario.dados')).toHaveCount(0);
  if (process.env.E2E_PRINTS_DIR) await page.screenshot({ animations: 'disabled', path: `${process.env.E2E_PRINTS_DIR}/portal-admin-menu-aberto-${test.info().project.name}-1366.png` });
  await page.getByTestId('menu-usuario.trocar-senha').click();
  const gaveta = page.getByRole('dialog', { name: 'Trocar a senha' });
  await expect(gaveta).toBeVisible();
  // antes de enviar: senha atual vazia e regras em aberto não chamam a API
  await page.getByTestId('trocar-senha.salvar').click();
  await expect(gaveta).toContainText('Digite a senha atual.');
  await page.getByTestId('trocar-senha.email').fill('admin@uma.com.br');
  await page.getByTestId('trocar-senha.atual').fill('errada');
  await page.getByTestId('trocar-senha.nova').fill('Nova-senha-123');
  await page.getByTestId('trocar-senha.repita').fill('Nova-senha-123');
  await page.getByTestId('trocar-senha.salvar').click();
  await expect(page.getByTestId('trocar-senha.aviso')).toHaveText('A senha atual está errada. Digite de novo.');
  await expect(page.getByTestId('trocar-senha.atual')).toHaveValue('');
  await expect(page.getByTestId('trocar-senha.atual')).toBeFocused();
  if (process.env.E2E_PRINTS_DIR) await page.screenshot({ animations: 'disabled', path: `${process.env.E2E_PRINTS_DIR}/portal-admin-trocar-senha-${test.info().project.name}-1366.png` });

  await page.getByTestId('trocar-senha.atual').fill('Senha-atual-1');
  await page.getByTestId('trocar-senha.salvar').click();
  // a troca revoga a sessão do portal: a entrada abre com o aviso, sem o "Sua sessão terminou"
  await expect(page.getByTestId('entrar.aviso')).toHaveText('Senha trocada. Entre de novo.', { timeout: 30000 });
  await ctx.close();
});

test('tela estreita (390 px): o menu fica na 1ª linha, ao lado da marca', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await entrar(page, 'admin@uma.com.br');
  const marca = await page.getByTestId('portal.marca').boundingBox();
  const botao = await page.getByTestId('menu-usuario.botao').boundingBox();
  expect(marca && botao).toBeTruthy();
  if (marca && botao) {
    expect(Math.abs(marca.y + marca.height / 2 - (botao.y + botao.height / 2))).toBeLessThan(20);
    expect(botao.x + botao.width).toBeLessThanOrEqual(390);
  }
  await abrirMenu(page);
  const lista = await page.getByTestId('menu-usuario.lista').boundingBox();
  expect(lista && lista.x >= 0 && lista.x + lista.width <= 390).toBeTruthy();
  await ctx.close();
});
