/**
 * e2e do menu do usuário no portal (v1.0.34; R-20261124-083005, 083110, 083356 e 191902; ADR 0075), modo falso, nos dois hosts
 * (`config.localhost` na raiz e `fdv.localhost/config`, ADR 0071): o botão no canto superior direito com o NOME de quem entrou e,
 * embaixo, o perfil ("Time Macuxi" ou o perfil e o cargo do admin do cliente), abrir e fechar (clique, Esc, setas), "Dados
 * cadastrais", "Trocar a senha" do time Macuxi (rota do portal, só a sessão) e do admin do cliente (rota pública do Core, com o
 * e-mail digitado): senha atual errada e a troca que encerra a sessão do portal, com "Senha trocada. Entre de novo."; e o "Sair". Prints em 1366 px (escala 2), prefixo `01b-`, em
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

const print = async (page: Page, nome: string) => {
  if (process.env.E2E_PRINTS_DIR) await page.screenshot({ animations: 'disabled', path: `${process.env.E2E_PRINTS_DIR}/01b-${nome}-${test.info().project.name}-1366.png` });
};

/**
 * Troca a senha pela gaveta: a atual errada fica na gaveta (a sessão segue); a certa volta à entrada com o aviso. `email`: o admin
 * do cliente digita o e-mail (rota pública do Core); sem ele, o time Macuxi (a sessão diz quem é, ADR 0075).
 */
async function trocarSenha(page: Page, prefixo: string, email?: string) {
  await abrirMenu(page);
  await page.getByTestId('menu-usuario.trocar-senha').click();
  const gaveta = page.getByRole('dialog', { name: 'Trocar a senha' });
  await expect(gaveta).toBeVisible();
  // o código da empresa vem da sessão; o e-mail, só o admin do cliente digita
  await expect(page.getByTestId('trocar-senha.email')).toHaveCount(email ? 1 : 0);
  await expect(page.getByTestId('trocar-senha.codigo')).toHaveCount(0);
  // antes de enviar: senha atual vazia e regras em aberto não chamam a API
  await page.getByTestId('trocar-senha.salvar').click();
  await expect(gaveta).toContainText('Digite a senha atual.');
  if (email) await page.getByTestId('trocar-senha.email').fill(email);
  await page.getByTestId('trocar-senha.atual').fill('errada');
  await page.getByTestId('trocar-senha.nova').fill('Nova-senha-123');
  await page.getByTestId('trocar-senha.repita').fill('Nova-senha-123');
  await page.getByTestId('trocar-senha.salvar').click();
  await expect(page.getByTestId('trocar-senha.aviso')).toHaveText('A senha atual está errada. Digite de novo.');
  await expect(page.getByTestId('trocar-senha.atual')).toHaveValue('');
  await expect(page.getByTestId('trocar-senha.atual')).toBeFocused();
  // o 401 da senha atual errada não derruba a sessão
  await expect(page.getByTestId('menu-usuario.botao')).toBeVisible();
  await print(page, `${prefixo}-trocar-senha`);

  await page.getByTestId('trocar-senha.atual').fill('Senha-atual-1');
  await page.getByTestId('trocar-senha.salvar').click();
  // a troca derruba a sessão do portal: a entrada abre com o aviso, sem o "Sua sessão terminou"
  await expect(page.getByTestId('entrar.aviso')).toHaveText('Senha trocada. Entre de novo.', { timeout: 30000 });
  await print(page, `${prefixo}-senha-trocada`);
}

test('time Macuxi: o nome e "Time Macuxi" no botão; Trocar a senha e Sair (sem Dados cadastrais, que repetiriam o botão); teclado e Esc', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await entrar(page, 'time@macuxi.com.br');
  const botao = page.getByTestId('menu-usuario.botao');
  await expect(botao).toHaveAttribute('aria-haspopup', 'menu');
  await expect(botao).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('menu-usuario.titulo')).toHaveText('Carla Menezes');
  await expect(page.getByTestId('menu-usuario.detalhe')).toHaveText('Time Macuxi');
  // o "Sair" solto saiu do cabeçalho
  await expect(page.getByTestId('portal.sair')).toHaveCount(0);
  await print(page, 'time-macuxi-menu');

  await abrirMenu(page);
  await expect(botao).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('menuitem')).toHaveText(['Trocar a senha', 'Sair']);
  await expect(page.getByTestId('menu-usuario.dados')).toHaveCount(0);
  await expect(page.getByTestId('menu-usuario.trocar-senha')).toBeFocused();
  await print(page, 'time-macuxi-menu-aberto');
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

test('time Macuxi: Trocar a senha (atual errada, depois a troca) e a volta à entrada com o aviso', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await entrar(page, 'time@macuxi.com.br');
  await trocarSenha(page, 'time-macuxi');
  await ctx.close();
});

test('admin do cliente: nome, perfil e cargo; Dados cadastrais; Trocar a senha e a volta à entrada com o aviso', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await entrar(page, 'admin@uma.com.br');
  await expect(page.getByTestId('menu-usuario.titulo')).toHaveText('Paulo Ribeiro');
  await expect(page.getByTestId('menu-usuario.detalhe')).toHaveText('Administrador · Administrativo');

  await abrirMenu(page);
  await expect(page.getByRole('menuitem')).toHaveText(['Dados cadastrais', 'Trocar a senha', 'Sair']);
  await print(page, 'admin-menu-aberto');
  await page.getByTestId('menu-usuario.dados').click();
  await expect(page.getByTestId('dados-cadastrais.nome')).toHaveText('Paulo Ribeiro');
  await expect(page.getByTestId('dados-cadastrais.empresa')).toHaveText('Distribuidora Uma Ltda');
  await page.getByRole('button', { name: 'Fechar painel' }).click();

  await trocarSenha(page, 'admin', 'admin@uma.com.br');
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
