/**
 * Item 01 da v1.0.34 (R-20261124-083005, 083110 e 083356), cobertura do agente `testes` além dos specs do engenheiro-apps
 * (`apps/web/e2e/bko-menu-usuario.spec.ts` e `portal-menu-usuario.spec.ts`):
 * - o menu do usuário no canto superior direito em TODAS as páginas: BKO (Início, Parâmetros, Auditoria, páginas de módulo, rota
 *   inexistente dentro do shell) e portal (Empresas, Nova empresa, Empresa nas abas Integração e Empresa, Diagnósticos, Frases da
 *   carga), nos dois hosts do portal (ADR 0071: `config.` na raiz e `fdv./config`);
 * - nome, perfil e cargo dos perfis base gerente, analista e assistente no BKO (RN-CORE-33; cargo pela base, ADR 0049; o admin
 *   fica no `bko-menu-usuario.spec.ts`);
 * - limites de largura: 1366, 768 (menu na barra do topo), 767 (menu no topo grafite), 640 (nome visível) e 639 (só iniciais);
 * - T-0117: nenhum token de renovação no `localStorage`/`sessionStorage` do portal nem do BKO, antes e depois da troca de senha;
 * - 01b (R-20261124-191902, ADR 0075): o portal mostra o NOME da sessão; embaixo, "Time Macuxi" (super-admin) ou o perfil e o
 *   cargo do admin do cliente ("Administrador · Administrativo" no modo falso);
 * - BKO: a senha atual errada não derruba a sessão nem depois de recarregar; senha nova igual à atual (RN-CORE-34) avisa e limpa.
 *
 * Roda contra o `next dev` no modo falso do portal (`NEXT_PUBLIC_PORTAL_FALSO=1 pnpm --filter web exec next dev -p 3311`), com a
 * API do BKO respondida pelo `page.route`:
 *   MACUXI_PW_CANAL= pnpm exec playwright test tests/e2e/web --trace off
 * Porta: `PORTAL_PORTA` (padrão 3311).
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import {
  abrirMenu,
  entrarNoPortal,
  hostsDoPortal,
  json,
  semDevOverlay,
  semTokenDeRenovacao,
  UMA,
} from './_portal-comum';

const PORTA = process.env.PORTAL_PORTA ?? '3311';
const BKO = `http://fdv.localhost:${PORTA}`;
const HOSTS_DO_PORTAL = hostsDoPortal(PORTA);

// ------------------------------------------------------------------------------------------------------------------- BKO

interface UsuarioBko {
  name: string;
  email: string;
  perfil: string;
}

/** API do BKO falsa: o mínimo para o shell; troca de senha com 401 (`errada`), 422 RN-CORE-34 (`igual`) e 200. */
async function apiDoBko(ctx: BrowserContext, u: UsuarioBko) {
  const pedidos = { troca: 0, logout: 0 };
  await ctx.route('**/api-proxy/**', async (route) => {
    const caminho = new URL(route.request().url()).pathname.replace(/^\/api-proxy/, '');
    if (caminho === '/me/modulos') {
      return json(route, 200, {
        modulos: ['core', 'catalogo', 'vendedor'].map((id) => ({ id, versao: '1.0.0', parametros: {} })),
        versao_licencas: 'v1',
        calculado_em: new Date().toISOString(),
        modulos_contratados: ['core', 'catalogo', 'vendedor'],
      });
    }
    if (caminho === '/auth/senha/trocar') {
      pedidos.troca += 1;
      const c = route.request().postDataJSON() as { senha_atual: string; senha_nova: string };
      if (c.senha_atual === 'errada')
        return json(route, 401, { codigo: 'CREDENCIAIS_INVALIDAS', mensagem: 'x' });
      if (c.senha_nova === c.senha_atual) return json(route, 422, { codigo: 'RN-CORE-34', mensagem: 'x' });
      return json(route, 200, {
        access_token: 'acesso-novo',
        token_type: 'Bearer',
        expires_in: 900,
        usuario: {
          id: '0b6f1a52-5c1e-4c4e-9a43-0000000000a1',
          nome: u.name,
          nome_curto: null,
          email: u.email,
          perfil: u.perfil,
        },
        tenant: { id: UMA, codigo: 'AM2808', nome: 'Distribuidora Uma', fuso: 'America/Manaus' },
      });
    }
    if (caminho === '/auth/logout') {
      pedidos.logout += 1;
      return json(route, 204, null);
    }
    if (caminho === '/auth/refresh')
      return json(route, 200, { access_token: 'acesso-e2e', token_type: 'Bearer', expires_in: 900 });
    return json(route, 404, { codigo: 'NAO_ENCONTRADO', mensagem: 'Rota não encontrada.' });
  });
  return pedidos;
}

async function comSessaoDoBko(ctx: BrowserContext, u: UsuarioBko) {
  const usuario = {
    id: '0b6f1a52-5c1e-4c4e-9a43-0000000000a1',
    ...u,
    empresa: 'Distribuidora Uma',
    fuso: 'America/Manaus',
    codigoEmpresa: 'AM2808',
  };
  await ctx.addInitScript((x) => {
    if (sessionStorage.getItem('e2e.sessao-posta')) return;
    sessionStorage.setItem('e2e.sessao-posta', '1');
    const texto = JSON.stringify(x);
    localStorage.setItem('macuxi.web.user', texto);
    sessionStorage.setItem('macuxi.web.token', 'acesso-e2e');
    sessionStorage.setItem('macuxi.web.token.usuario', texto);
  }, usuario);
}

/**
 * Botão visível, um só, no canto superior direito: no BKO, da janela; no portal (`limite`), do conteúdo da faixa, que tem
 * largura máxima de 1120 px e fica centrado (o mesmo lugar do "Sair" antigo).
 */
async function menuNoCantoSuperiorDireito(page: Page, largura: number, limite?: string) {
  const botao = page.getByTestId('menu-usuario.botao');
  await expect(botao).toHaveCount(1);
  await expect(botao).toBeVisible({ timeout: 90000 });
  const c = await botao.boundingBox();
  expect(c, 'caixa do botão').toBeTruthy();
  if (!c) return;
  const caixa = limite ? await page.locator(limite).first().boundingBox() : null;
  const direita = caixa ? caixa.x + caixa.width : largura;
  expect(c.x + c.width, 'borda direita do botão').toBeGreaterThan(direita - 64);
  expect(c.y, 'topo do botão').toBeLessThan(48);
}

/** Conteúdo da faixa do portal (a largura máxima centrada). */
const FAIXA_DO_PORTAL = 'header > div';

const PERFIS_DO_BKO = [
  { perfil: 'gerente', nome: 'Gil Martins', detalhe: 'Gerente', cargo: 'Gerente', perfilRotulo: 'Gerente' },
  {
    perfil: 'analista',
    nome: 'Lia Prado',
    detalhe: 'Analista · Administrativo',
    cargo: 'Administrativo',
    perfilRotulo: 'Analista',
  },
  {
    perfil: 'assistente',
    nome: 'Rui Alves Costa',
    detalhe: 'Assistente · Administrativo',
    cargo: 'Administrativo',
    perfilRotulo: 'Assistente',
  },
] as const;

test.describe('BKO: menu do usuário', () => {
  for (const p of PERFIS_DO_BKO) {
    test(`perfil ${p.perfil}: nome, perfil e cargo no botão e nos Dados cadastrais`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 } });
      const u = { name: p.nome, email: `${p.perfil}@uma.com.br`, perfil: p.perfil };
      await apiDoBko(ctx, u);
      await comSessaoDoBko(ctx, u);
      const page = await ctx.newPage();
      await page.goto(`${BKO}/bko`);
      await menuNoCantoSuperiorDireito(page, 1366);
      await semDevOverlay(page);
      await expect(page.getByTestId('menu-usuario.titulo')).toHaveText(p.nome);
      await expect(page.getByTestId('menu-usuario.detalhe')).toHaveText(p.detalhe);
      await abrirMenu(page);
      await page.getByTestId('menu-usuario.dados').click();
      await expect(page.getByTestId('dados-cadastrais.nome')).toHaveText(p.nome);
      await expect(page.getByTestId('dados-cadastrais.perfil')).toHaveText(p.perfilRotulo);
      await expect(page.getByTestId('dados-cadastrais.cargo')).toHaveText(p.cargo);
      // só leitura: nenhum campo editável na gaveta
      const gaveta = page.getByRole('dialog', { name: 'Dados cadastrais' });
      await expect(gaveta.locator('input, textarea, select, [contenteditable="true"]')).toHaveCount(0);
      await ctx.close();
    });
  }

  test('em todas as páginas do shell: Início, Parâmetros, Auditoria, módulos e rota inexistente', async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 } });
    const u = { name: 'Ana Souza', email: 'ana@uma.com.br', perfil: 'admin' };
    await apiDoBko(ctx, u);
    await comSessaoDoBko(ctx, u);
    const page = await ctx.newPage();
    for (const caminho of [
      '/bko',
      '/parametros',
      '/parametros/clientes',
      '/auditoria',
      '/catalogo',
      '/usuarios',
      '/pedidos',
      '/rota-que-nao-existe',
    ]) {
      await test.step(caminho, async () => {
        await page.goto(`${BKO}${caminho}`);
        await menuNoCantoSuperiorDireito(page, 1366);
        await expect(page.getByTestId('menu-usuario.titulo')).toHaveText('Ana Souza');
        // o "Trocar perfil" solto e o nome no rodapé do menu lateral saíram
        await expect(page.getByTestId('trocar-perfil')).toHaveCount(0);
        await expect(page.getByText('Ana Souza', { exact: true })).toHaveCount(1);
      });
    }
    await ctx.close();
  });

  for (const v of [
    { largura: 768, larga: true, nome: true },
    { largura: 767, larga: false, nome: true },
    { largura: 640, larga: false, nome: true },
    { largura: 639, larga: false, nome: false },
  ]) {
    test(`${v.largura} px: um menu só, no canto superior direito; nome ${v.nome ? 'visível' : 'só nas iniciais e no rótulo'}`, async ({
      browser,
    }) => {
      const ctx = await browser.newContext({ viewport: { width: v.largura, height: 800 } });
      const u = { name: 'Ana Souza', email: 'ana@uma.com.br', perfil: 'admin' };
      await apiDoBko(ctx, u);
      await comSessaoDoBko(ctx, u);
      const page = await ctx.newPage();
      await page.goto(`${BKO}/bko`);
      await menuNoCantoSuperiorDireito(page, v.largura);
      const botao = page.getByTestId('menu-usuario.botao');
      // abaixo de 768 px o menu fica dentro do topo grafite (nav do menu estreito)
      await expect(
        page.getByRole('navigation', { name: 'Menu do backoffice' }).getByTestId('menu-usuario.botao'),
      ).toHaveCount(v.larga ? 0 : 1);
      if (v.nome) await expect(page.getByTestId('menu-usuario.titulo')).toBeVisible();
      else await expect(page.getByTestId('menu-usuario.titulo')).toBeHidden();
      await expect(botao).toHaveAttribute('aria-label', 'Menu do usuário: Ana Souza, Admin · Administrativo');
      await semDevOverlay(page);
      await abrirMenu(page);
      const l = await page.getByTestId('menu-usuario.lista').boundingBox();
      expect(l && l.x >= 0 && l.x + l.width <= v.largura).toBeTruthy();
      // sem rolagem horizontal
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(v.largura);
      await ctx.close();
    });
  }

  test('Trocar a senha: atual errada não derruba nem depois de recarregar; igual à atual (RN-CORE-34); regra local sem chamar a API', async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 } });
    const u = { name: 'Ana Souza', email: 'ana@uma.com.br', perfil: 'admin' };
    const pedidos = await apiDoBko(ctx, u);
    await comSessaoDoBko(ctx, u);
    const page = await ctx.newPage();
    await page.goto(`${BKO}/bko`);
    await menuNoCantoSuperiorDireito(page, 1366);
    await semDevOverlay(page);
    await abrirMenu(page);
    await page.getByTestId('menu-usuario.trocar-senha').click();

    // regra da senha (RN-CORE-32) e a repetição diferente: não chama a API
    await page.getByTestId('trocar-senha.atual').fill('Senha-atual-1');
    await page.getByTestId('trocar-senha.nova').fill('curta');
    await page.getByTestId('trocar-senha.repita').fill('curta');
    await page.getByTestId('trocar-senha.salvar').click();
    await page.getByTestId('trocar-senha.nova').fill('Nova-senha-123');
    await page.getByTestId('trocar-senha.repita').fill('Nova-senha-124');
    await page.getByTestId('trocar-senha.salvar').click();
    await expect(page.getByRole('dialog', { name: 'Trocar a senha' })).toBeVisible();
    expect(pedidos.troca).toBe(0);

    // senha atual errada: aviso, a sessão fica
    await page.getByTestId('trocar-senha.repita').fill('Nova-senha-123');
    await page.getByTestId('trocar-senha.atual').fill('errada');
    await page.getByTestId('trocar-senha.salvar').click();
    await expect(page.getByTestId('trocar-senha.aviso')).toHaveText(
      'A senha atual está errada. Digite de novo.',
    );
    expect(await page.evaluate(() => sessionStorage.getItem('macuxi.web.token'))).toBe('acesso-e2e');

    // igual à atual: aviso e as duas novas limpas
    await page.getByTestId('trocar-senha.atual').fill('Nova-senha-123');
    await page.getByTestId('trocar-senha.salvar').click();
    await expect(page.getByTestId('trocar-senha.aviso')).toHaveText(/diferente/i);
    await expect(page.getByTestId('trocar-senha.nova')).toHaveValue('');
    await expect(page.getByTestId('trocar-senha.repita')).toHaveValue('');
    expect(pedidos.troca).toBe(2);

    // recarregar: continua logado (o 401 da senha errada não apagou a sessão)
    await page.reload();
    await menuNoCantoSuperiorDireito(page, 1366);
    await expect(page).toHaveURL(/\/bko/);

    // a troca certa mantém logado, com o acesso novo, e sem token de renovação no navegador
    await semDevOverlay(page);
    await abrirMenu(page);
    await page.getByTestId('menu-usuario.trocar-senha').click();
    await page.getByTestId('trocar-senha.atual').fill('Senha-atual-1');
    await page.getByTestId('trocar-senha.nova').fill('Nova-senha-123');
    await page.getByTestId('trocar-senha.repita').fill('Nova-senha-123');
    await page.getByTestId('trocar-senha.salvar').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByTestId('menu-usuario.botao')).toBeFocused();
    expect(await page.evaluate(() => sessionStorage.getItem('macuxi.web.token'))).toBe('acesso-novo');
    await semTokenDeRenovacao(page);

    // Sair: chama o logout e volta ao login; voltar não reabre o BKO
    await abrirMenu(page);
    await page.getByTestId('menu-usuario.sair').click();
    await expect(page).toHaveURL(/\/login/, { timeout: 30000 });
    expect(pedidos.logout).toBe(1);
    expect(await page.evaluate(() => sessionStorage.getItem('macuxi.web.token'))).toBeNull();
    await page.goto(`${BKO}/bko`);
    await expect(page).toHaveURL(/\/login/, { timeout: 30000 });
    await ctx.close();
  });
});

// ------------------------------------------------------------------------------------------------------------------ portal

for (const host of HOSTS_DO_PORTAL) {
  test.describe(`portal (${host.nome}): menu do usuário`, () => {
    test('time Macuxi: em Empresas, Nova empresa, Empresa (abas), Diagnósticos e Frases da carga; sem token de renovação', async ({
      browser,
    }) => {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 } });
      const page = await ctx.newPage();
      await entrarNoPortal(page, host.base, 'time@macuxi.com.br');
      await semTokenDeRenovacao(page);
      for (const caminho of [
        '/empresas',
        '/empresas/nova',
        `/empresas/${UMA}`,
        `/empresas/${UMA}#empresa`,
        '/diagnosticos',
        '/frases-carga',
      ]) {
        await test.step(caminho, async () => {
          await page.goto(`${host.base}${caminho}`);
          await menuNoCantoSuperiorDireito(page, 1366, FAIXA_DO_PORTAL);
          await expect(page.getByTestId('menu-usuario.titulo')).toHaveText('Carla Menezes');
          await expect(page.getByTestId('menu-usuario.detalhe')).toHaveText('Time Macuxi');
          await expect(page.getByTestId('portal.sair')).toHaveCount(0);
        });
      }
      // Sair encerra: voltar a uma página interna leva à entrada
      await semDevOverlay(page);
      await abrirMenu(page);
      await page.getByTestId('menu-usuario.sair').click();
      await expect(page.getByTestId('entrar.email')).toBeVisible({ timeout: 30000 });
      await page.goto(`${host.base}/empresas`);
      await expect(page.getByTestId('entrar.email')).toBeVisible({ timeout: 30000 });
      await ctx.close();
    });

    test('admin do cliente: menu nas abas da empresa; Dados cadastrais só leitura', async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 } });
      const page = await ctx.newPage();
      await entrarNoPortal(page, host.base, 'admin@uma.com.br');
      for (const caminho of [`/empresas/${UMA}`, `/empresas/${UMA}#empresa`]) {
        await page.goto(`${host.base}${caminho}`);
        await menuNoCantoSuperiorDireito(page, 1366, FAIXA_DO_PORTAL);
        await expect(page.getByTestId('menu-usuario.titulo')).toHaveText('Paulo Ribeiro');
        await expect(page.getByTestId('menu-usuario.detalhe')).toHaveText('Administrador · Administrativo');
      }
      await semDevOverlay(page);
      await abrirMenu(page);
      await page.getByTestId('menu-usuario.dados').click();
      const dados = page.getByRole('dialog', { name: 'Dados cadastrais' });
      await expect(dados.locator('input, textarea, select, [contenteditable="true"]')).toHaveCount(0);
      // 01b: os Dados cadastrais só aparecem porque trazem o que o botão não mostra (a empresa)
      await expect(page.getByTestId('dados-cadastrais.nome')).toHaveText('Paulo Ribeiro');
      await expect(page.getByTestId('dados-cadastrais.perfil')).toHaveText('Administrador');
      await expect(page.getByTestId('dados-cadastrais.cargo')).toHaveText('Administrativo');
      await expect(page.getByTestId('dados-cadastrais.empresa')).toHaveText('Distribuidora Uma Ltda');
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('menu-usuario.botao')).toBeFocused();
      // o nome "Dados cadastrais" é só do menu do usuário: o cartão da aba Empresa chama-se "Dados da empresa"
      await expect(page.getByRole('dialog', { name: 'Dados cadastrais' })).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'Dados cadastrais' })).toHaveCount(0);
      await ctx.close();
    });
  });
}
