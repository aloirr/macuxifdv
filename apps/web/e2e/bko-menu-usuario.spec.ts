/**
 * e2e do menu do usuário no BKO (v1.0.34; R-20261124-083005, 083110 e 083356), no `fdv.localhost/bko`: a sessão do login real
 * posta no navegador (usuário no `localStorage`, acesso no `sessionStorage`, como o SDK grava) e a API respondida pelo `page.route`.
 * Cobre o botão no canto superior direito (nome, perfil e cargo), sem o "Trocar perfil" solto, abrir e fechar, "Dados cadastrais",
 * "Trocar a senha" (senha atual errada e a troca, que grava a sessão nova) e o "Sair". Na tela estreita, o menu fica no topo grafite.
 * Print em 1366 px (escala 2) com o menu aberto em `E2E_PRINTS_DIR`, quando definido.
 */
import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';

const TENANT = '0b6f1a52-5c1e-4c4e-9a43-000000000001';
const USUARIO = {
  id: '0b6f1a52-5c1e-4c4e-9a43-0000000000a1',
  name: 'Ana Souza',
  email: 'ana@uma.com.br',
  perfil: 'admin',
  empresa: 'Distribuidora Uma',
  fuso: 'America/Manaus',
  codigoEmpresa: 'AM2808',
};

const json = (route: Route, status: number, corpo: unknown) => route.fulfill({ status, contentType: 'application/json', body: status === 204 ? '' : JSON.stringify(corpo) });

/** A API do BKO (só o que o shell e o Início pedem; o resto, 404 de rota). Guarda os pedidos de troca e de saída. */
async function apiFalsa(ctx: BrowserContext) {
  const pedidos = { troca: [] as { corpo: unknown; autorizacao: string | undefined }[], sair: 0 };
  await ctx.route('**/api-proxy/**', async (route) => {
    const url = new URL(route.request().url());
    const caminho = url.pathname.replace(/^\/api-proxy/, '');
    if (caminho === '/me/modulos') {
      return json(route, 200, { modulos: [{ id: 'core', versao: '1.0.0', parametros: {} }], versao_licencas: 'v1', calculado_em: new Date().toISOString(), modulos_contratados: ['core'] });
    }
    if (caminho === '/auth/senha/trocar') {
      const corpo = route.request().postDataJSON() as { senha_atual: string; email: string };
      pedidos.troca.push({ corpo, autorizacao: route.request().headers()['authorization'] });
      if (corpo.senha_atual === 'errada') return json(route, 401, { codigo: 'CREDENCIAIS_INVALIDAS', mensagem: 'Código da empresa, e-mail ou senha incorretos.' });
      return json(route, 200, {
        access_token: 'acesso-novo',
        token_type: 'Bearer',
        expires_in: 900,
        usuario: { id: USUARIO.id, nome: USUARIO.name, nome_curto: null, email: USUARIO.email, perfil: 'admin' },
        tenant: { id: TENANT, codigo: 'AM2808', nome: USUARIO.empresa, fuso: USUARIO.fuso },
      });
    }
    if (caminho === '/auth/logout') {
      pedidos.sair += 1;
      return json(route, 204, null);
    }
    if (caminho === '/auth/refresh') return json(route, 200, { access_token: 'acesso-e2e', token_type: 'Bearer', expires_in: 900 });
    return json(route, 404, { codigo: 'NAO_ENCONTRADO', mensagem: 'Rota não encontrada.' });
  });
  return pedidos;
}

/** Sessão como o `salvarSessaoReal` grava: usuário no `localStorage` e o acesso, com a cópia do usuário, no `sessionStorage`. */
async function comSessao(ctx: BrowserContext) {
  await ctx.addInitScript((u) => {
    if (sessionStorage.getItem('e2e.sessao-posta')) return;
    sessionStorage.setItem('e2e.sessao-posta', '1');
    const texto = JSON.stringify(u);
    localStorage.setItem('macuxi.web.user', texto);
    sessionStorage.setItem('macuxi.web.token', 'acesso-e2e');
    sessionStorage.setItem('macuxi.web.token.usuario', texto);
  }, USUARIO);
}

async function abrirBko(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto('/bko');
  await expect(page.getByTestId('menu-usuario.botao')).toBeVisible({ timeout: 90000 });
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  return page;
}

async function abrirMenu(page: Page) {
  await expect(async () => {
    if (!(await page.getByTestId('menu-usuario.lista').isVisible())) await page.getByTestId('menu-usuario.botao').click();
    await expect(page.getByTestId('menu-usuario.lista')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30000 });
}

test('1366 px: menu no canto superior direito, Dados cadastrais, Trocar a senha e Sair', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 }, deviceScaleFactor: 2 });
  const pedidos = await apiFalsa(ctx);
  await comSessao(ctx);
  const page = await abrirBko(ctx);

  await expect(page.getByTestId('menu-usuario.titulo')).toHaveText('Ana Souza');
  await expect(page.getByTestId('menu-usuario.detalhe')).toHaveText('Admin · Administrativo');
  await expect(page.getByTestId('trocar-perfil')).toHaveCount(0);
  await expect(page.getByText('Trocar perfil')).toHaveCount(0);
  // canto superior direito
  const caixa = await page.getByTestId('menu-usuario.botao').boundingBox();
  expect(caixa && caixa.x + caixa.width > 1366 - 60 && caixa.y < 40).toBeTruthy();
  // uma informação, um lugar: o nome só no menu
  await expect(page.getByText('Ana Souza', { exact: true })).toHaveCount(1);

  await abrirMenu(page);
  await expect(page.getByRole('menuitem')).toHaveText(['Dados cadastrais', 'Trocar a senha', 'Sair']);
  if (process.env.E2E_PRINTS_DIR) await page.screenshot({ animations: 'disabled', path: `${process.env.E2E_PRINTS_DIR}/bko-menu-aberto-1366.png` });
  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('menu-usuario.sair')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.getByTestId('menu-usuario.dados')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Dados cadastrais' })).toBeVisible();
  await expect(page.getByTestId('dados-cadastrais.nome')).toHaveText('Ana Souza');
  await expect(page.getByTestId('dados-cadastrais.email')).toHaveText('ana@uma.com.br');
  await expect(page.getByTestId('dados-cadastrais.perfil')).toHaveText('Admin');
  await expect(page.getByTestId('dados-cadastrais.cargo')).toHaveText('Administrativo');
  await expect(page.getByTestId('dados-cadastrais.empresa')).toHaveText('Distribuidora Uma');
  if (process.env.E2E_PRINTS_DIR) await page.screenshot({ animations: 'disabled', path: `${process.env.E2E_PRINTS_DIR}/bko-dados-cadastrais-1366.png` });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await abrirMenu(page);
  await page.getByTestId('menu-usuario.trocar-senha').click();
  await expect(page.getByRole('dialog', { name: 'Trocar a senha' })).toBeVisible();
  await expect(page.getByTestId('trocar-senha.email')).toHaveCount(0);
  await expect(page.getByTestId('trocar-senha.codigo')).toHaveCount(0);
  await page.getByTestId('trocar-senha.atual').fill('errada');
  await page.getByTestId('trocar-senha.nova').fill('Nova-senha-123');
  await page.getByTestId('trocar-senha.repita').fill('Nova-senha-123');
  await page.getByTestId('trocar-senha.salvar').click();
  await expect(page.getByTestId('trocar-senha.aviso')).toHaveText('A senha atual está errada. Digite de novo.');
  // a senha errada não derruba a sessão (o pedido vai sem o token de acesso)
  await expect(page.getByTestId('menu-usuario.botao')).toBeVisible();
  if (process.env.E2E_PRINTS_DIR) await page.screenshot({ animations: 'disabled', path: `${process.env.E2E_PRINTS_DIR}/bko-trocar-senha-1366.png` });
  await page.getByTestId('trocar-senha.atual').fill('Senha-atual-1');
  await page.getByTestId('trocar-senha.salvar').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Senha trocada.')).toBeVisible();
  expect(pedidos.troca.map((p) => p.autorizacao)).toEqual([undefined, undefined]);
  expect(pedidos.troca[1]?.corpo).toEqual({ codigo_empresa: 'AM2808', email: 'ana@uma.com.br', senha_atual: 'Senha-atual-1', senha_nova: 'Nova-senha-123', app: 'web' });
  expect(await page.evaluate(() => sessionStorage.getItem('macuxi.web.token'))).toBe('acesso-novo');

  await abrirMenu(page);
  await page.getByTestId('menu-usuario.sair').click();
  await expect(page).toHaveURL(/\/login/, { timeout: 30000 });
  expect(pedidos.sair).toBe(1);
  await ctx.close();
});

test('390 px: o menu fica no topo grafite, ao lado da marca, sem o nome repetido embaixo', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await apiFalsa(ctx);
  await comSessao(ctx);
  const page = await abrirBko(ctx);
  await expect(page.getByTestId('menu-usuario.botao')).toHaveCount(1);
  await expect(page.getByText('Ana Souza', { exact: true })).toHaveCount(1);
  await abrirMenu(page);
  const lista = await page.getByTestId('menu-usuario.lista').boundingBox();
  expect(lista && lista.x >= 0 && lista.x + lista.width <= 390).toBeTruthy();
  await ctx.close();
});
