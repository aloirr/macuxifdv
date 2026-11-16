/**
 * T-0028 — BKO na demo (Playwright): login do analista e do admin na base `demo` e cada página do menu, com a API real.
 *
 * Pré-requisito (não sobe nada sozinho): demo no ar (`scripts\demo\subir-demo.ps1 -SemTunel`, API em 8100) e o BKO
 * (`pnpm --filter web dev`, porta 3000). Rodar na raiz: `pnpm test:e2e`. `MACUXI_BKO_URL` muda o endereço do BKO.
 *
 * Convenção: `test` = funciona hoje; `test.fail` = quebrado (a página trava em "Carregando…" ou mostra "Rota não
 * encontrada" porque chama rota da Fase M que a API nova não tem). Quando a correção chega, o `test.fail` fica
 * vermelho e vira `test`. T-0030: D-B10 (Rotas) funciona. T-0081: D-B21 é o Farol real (GET /v1/core/farol) e D-B23
 * a tela de Metas. T-0082: D-B25 é o Plano de RV real (GET /v1/core/plano-rv e /v1/core/rv); nenhuma página do menu
 * segue "em construção".
 * D-B31 (T-0081, R-20261105-072330): nenhuma página do menu tem `table table` no DOM (o verificador estático está em
 * tests/modulos/bko-sem-tabela-aninhada.test.ts). Matriz e causas: tests/plano/demo-matriz.md (IDs D-Bnn).
 * ADR 0060 (menu Parâmetros): o menu é sanfona (o item só aparece com o grupo aberto: `mostrarItem`); Perfis, Motivos,
 * Plano de RV, Alçadas e Usuários e módulos saíram do menu e abrem pelo item Parâmetros (`abrirParametros`). O menu novo
 * (ordem, cadeado, links antigos) está em menu-parametros.spec.ts, com a API simulada.
 */
import { expect, test, type Page } from '@playwright/test';

const SENHA = 'demo-macuxi';
/** O BKO trava em "Carregando…" ou cai em "Rota não encontrada." quando uma rota da Fase M responde 404. */
const QUEBRA = /Carregando…|Carregando o plano|Rota não encontrada|This page could not be found/;

/** Rotas da Fase M que a API nova não tem: as páginas migradas (T-0030) não podem mais chamá-las. */
const FASE_M = /^\/(me$|(teams|sellers|branches|goals|goal-periods|incentive-plans|dashboards|routes|orders|discount-policy|audit-log)(\/|$))/;

interface Aberta {
  falhas: string[];
  /** Todas as chamadas ao proxy (`GET /me`, `GET /core/rotas`...), sem query. */
  chamadas: string[];
}

/** Respostas 4xx/5xx que passaram pelo proxy do BKO (`/api-proxy/...` → API 8100). */
function vigiar(page: Page): Aberta {
  const a: Aberta = { falhas: [], chamadas: [] };
  page.on('request', (r) => {
    const u = r.url();
    if (u.includes('/api-proxy/')) a.chamadas.push(`${r.method()} ${u.replace(/^.*\/api-proxy/, '').split('?')[0]}`);
  });
  page.on('response', (r) => {
    const u = r.url();
    if (u.includes('/api-proxy/') && r.status() >= 400) a.falhas.push(`${r.status()} ${r.request().method()} ${u.replace(/^.*\/api-proxy/, '').split('?')[0]}`);
  });
  return a;
}

/**
 * Login pelo formulário. No `next dev`, a hidratação ou um recarregamento do HMR (outro agente editando apps/web) pode
 * limpar os campos entre o preencher e o clicar — o formulário volta com "Informe..." (T-0029: 3 casos caíram assim).
 * Preenche, confere, clica e espera `espera` (o menu, ou `login.erro` no login recusado); se não veio, repete.
 */
async function entrar(page: Page, email: string, espera = 'nav-plataforma-parametros') {
  await page.goto('/login');
  const campos: Array<[string, string]> = [['login.codigo-empresa', 'demo'], ['login.email', email], ['login.senha', SENHA]];
  await expect(async () => {
    if (await page.getByTestId(espera).first().isVisible()) return;
    for (const [id, valor] of campos) await page.getByTestId(id).fill(valor);
    for (const [id, valor] of campos) await expect(page.getByTestId(id)).toHaveValue(valor, { timeout: 1_000 });
    await page.getByTestId('login.entrar').click();
    await expect(page.getByTestId(espera).first()).toBeVisible({ timeout: 20_000 });
  }).toPass({ timeout: 90_000 });
}

/** Grupo do menu (ADR 0060) de cada item que os casos abrem: na sanfona, o item só existe com o grupo aberto. */
const GRUPO_DO_ITEM: Readonly<Record<string, string>> = {
  'nav-core-aparelhos': 'acesso',
  'nav-core-usuarios': 'acesso',
  'nav-core-indicadores': 'analise',
  'nav-core-metas': 'analise',
  'nav-core-carteira': 'cadastros',
  'nav-core-clientes': 'cadastros',
  'nav-core-coordenadas-sugeridas': 'cadastros',
  'nav-core-recados': 'comunicacao',
  'nav-core-rotas': 'operacao',
  'nav-core-visitas': 'operacao',
  'nav-vendedor-pedidos': 'operacao',
};

/** Deixa o item do menu visível: abre o grupo dele quando o menu está em sanfona (com tudo aberto, o título não faz nada). */
async function mostrarItem(page: Page, nav: string) {
  const item = page.getByTestId(nav).first();
  if (await item.isVisible()) return;
  const grupo = GRUPO_DO_ITEM[nav];
  if (grupo) await page.getByTestId(`nav-grupo-${grupo}`).click();
  await expect(item, nav).toBeVisible({ timeout: 10_000 });
}

/**
 * Todos os itens do menu (ADR 0060), com o grupo que é preciso abrir para vê-los (`null` = item direto ou já aberto). Na
 * sanfona o grupo fechado não tem os itens no DOM: abre cada grupo e junta. Entrada com cadeado (`data-bloqueado`) fica fora.
 */
async function itensDoMenu(page: Page): Promise<Map<string, string | null>> {
  const menu = page.getByTestId('menu-bko');
  const grupos = await menu.locator('[data-testid^="nav-grupo-"]:not([data-bloqueado])').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid') ?? ''));
  const itensVisiveis = () =>
    menu
      .locator('[data-testid^="nav-"]:not([data-testid^="nav-grupo-"]):not([data-bloqueado])')
      .evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent !== null).map((e) => e.getAttribute('data-testid') ?? '').filter(Boolean));
  const porItem = new Map<string, string | null>((await itensVisiveis()).map((n) => [n, null]));
  for (const g of grupos) {
    await page.getByTestId(g).click();
    for (const n of await itensVisiveis()) if (!porItem.has(n)) porItem.set(n, g);
  }
  return porItem;
}

/** Abre a página pelo MENU (navegação do cliente) e espera as consultas assentarem. */
async function abrirPeloMenu(page: Page, a: Aberta, nav: string, pagina: string) {
  a.falhas.length = 0;
  a.chamadas.length = 0;
  await mostrarItem(page, nav);
  await page.getByTestId(nav).first().click();
  await expect(page.getByTestId(pagina)).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3_000);
}

/**
 * ADR 0060: abre pelo item Parâmetros (`nav-plataforma-parametros`) a seção (`parametros-secao-<secao>`) e espera o painel
 * (`parametros-<modulo>-<id>`; a página que virou painel mantém dentro dele o `pagina-<modulo>-<id>`).
 */
async function abrirParametros(page: Page, a: Aberta, secao: string, painel: string) {
  a.falhas.length = 0;
  a.chamadas.length = 0;
  await page.getByTestId('menu-bko').getByTestId('nav-plataforma-parametros').click();
  await expect(page.getByTestId('pagina-parametros')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId(`parametros-secao-${secao}`).click();
  await expect(page).toHaveURL(new RegExp(`/parametros/${secao}$`));
  await expect(page.getByTestId(painel)).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3_000);
}

async function semQuebra(page: Page, a: Aberta) {
  expect([...new Set(a.falhas)], 'rotas que responderam erro').toEqual([]);
  await expect(page.locator('main')).not.toHaveText(QUEBRA);
}

test.describe('Login do BKO', () => {
  test('D-B01: analista e admin entram com o código demo; vendedor e promotor recebem o aviso do app certo', async ({ page }) => {
    // 4 logins e, no 1º caso da rodada, a compilação a frio do `next dev` (passou de 120 s na T-0030)
    test.slow();
    for (const email of ['analista@exemplo.com.br', 'admin@exemplo.com.br']) {
      await entrar(page, email);
      await expect(page.getByTestId('menu-bko').getByTestId('nav-plataforma-parametros')).toBeVisible({ timeout: 60_000 });
      await page.context().clearCookies();
      await page.evaluate(() => window.localStorage.clear());
    }
    for (const email of ['vendedor@exemplo.com.br', 'promotor@exemplo.com.br']) {
      await entrar(page, email, 'login.erro');
      await expect(page.getByTestId('login.erro')).toContainText('Campo', { timeout: 30_000 });
    }
  });
});

for (const quem of ['analista', 'admin'] as const) {
  test.describe(`BKO — ${quem}`, () => {
    let a: Aberta;
    test.beforeEach(async ({ page }) => {
      a = vigiar(page);
      await entrar(page, `${quem}@exemplo.com.br`);
      await expect(page.getByTestId('menu-bko').getByTestId('nav-plataforma-parametros')).toBeVisible({ timeout: 60_000 });
    });

    test('D-B00: o menu tem as páginas dos módulos licenciados (Core e Vendedor); Alçadas e Perfis estão em Parâmetros (ADR 0060)', async ({ page }) => {
      for (const n of ['nav-core-clientes', 'nav-core-rotas', 'nav-core-visitas', 'nav-core-recados', 'nav-core-carteira', 'nav-core-metas', 'nav-core-indicadores', 'nav-core-aparelhos', 'nav-vendedor-pedidos']) {
        await mostrarItem(page, n);
      }
      // ADR 0060: Alçadas, Perfis, Motivos e Plano de RV saíram do menu (viraram painéis de Parâmetros); do Vendedor, o menu
      // tem só Pedidos (Operação), Formas de pagamento e prazos e Transportadoras (Cadastros, D4/D11)
      const doVendedor = [...(await itensDoMenu(page)).keys()].filter((n) => n.startsWith('nav-vendedor-')).sort();
      expect(doVendedor, 'itens do Vendedor no menu').toEqual(['nav-vendedor-formas-pagamento', 'nav-vendedor-pedidos', 'nav-vendedor-transportadoras']);
      for (const n of ['nav-core-perfis', 'nav-core-motivos', 'nav-core-plano-rv']) await expect(page.getByTestId(n), n).toHaveCount(0);
      await abrirParametros(page, a, 'pedidos', 'parametros-vendedor-alcadas');
      // Acesso do BKO (R-20261114-144500): o admin gere o acesso por "Usuários" (Acesso) e "Perfis de acesso" (Parâmetros › Acesso)
      if (quem === 'admin') {
        await mostrarItem(page, 'nav-core-usuarios');
        await abrirParametros(page, a, 'acesso', 'parametros-core-perfis');
      }
    });

    // ---------------------------------------------------------------- funcionam
    for (const [id, nav, pagina] of [
      ['D-B02 Visitas', 'nav-core-visitas', 'pagina-core-visitas'],
      ['D-B03 Indicadores', 'nav-core-indicadores', 'pagina-core-indicadores'],
      ['D-B04 Recados', 'nav-core-recados', 'pagina-core-recados'],
      ['D-B07 Coordenadas sugeridas', 'nav-core-coordenadas-sugeridas', 'pagina-core-coordenadas-sugeridas'],
      ['D-B08 Aparelhos', 'nav-core-aparelhos', 'pagina-core-aparelhos'],
    ] as const) {
      test(`${id}: abre pelo menu e mostra os dados sem erro de rota`, async ({ page }) => {
        await abrirPeloMenu(page, a, nav, pagina);
        await semQuebra(page, a);
      });
    }

    test('D-B06 Motivos (ADR 0060): abre por Parâmetros › Visitas e mostra os dados sem erro de rota', async ({ page }) => {
      await abrirParametros(page, a, 'visitas', 'parametros-core-motivos');
      await expect(page.getByTestId('pagina-core-motivos')).toBeVisible();
      await semQuebra(page, a);
    });

    test('D-B05/D-B12: Carteira → escolher o Lucas → Cliente 360 com títulos e contatos', async ({ page }) => {
      await abrirPeloMenu(page, a, 'nav-core-carteira', 'pagina-core-carteira');
      await page.locator('select').first().selectOption({ label: 'Lucas Andrade' });
      const link = page.locator('a[href^="/cliente?id"]').first();
      await expect(link).toBeVisible({ timeout: 20_000 });
      expect(await page.locator('a[href^="/cliente?id"]').count()).toBe(18);
      await link.click();
      await expect(page.getByTestId('pagina-core-cliente')).toBeVisible();
      await expect(page.locator('main')).toContainText('Títulos', { timeout: 20_000 });
      await expect(page.locator('main')).toContainText('Contatos');
      await semQuebra(page, a);
    });

    if (quem === 'admin') {
      test('D-B09 Usuários e módulos (ADR 0060, D2): o endereço antigo leva a Parâmetros › Acesso; o admin vê as licenças do tenant', async ({ page }) => {
        // o link antigo `/usuarios-e-modulos` redireciona para `/parametros/acesso#core-usuarios-e-modulos`
        a.falhas.length = 0;
        a.chamadas.length = 0;
        await page.goto('/usuarios-e-modulos');
        await expect(page).toHaveURL(/\/parametros\/acesso#core-usuarios-e-modulos$/, { timeout: 30_000 });
        await expect(page.getByTestId('parametros-core-usuarios-e-modulos')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId('pagina-core-usuarios-e-modulos')).toBeVisible({ timeout: 30_000 });
        await page.waitForTimeout(3_000);
        await semQuebra(page, a);
        await expect(page.locator('main')).toContainText('Empresa');
      });
    }

    test('D-B10 Rotas: a semana carrega pela API nova (/v1/core/rotas) sem chamar /v1/me', async ({ page }) => {
      await abrirPeloMenu(page, a, 'nav-core-rotas', 'pagina-core-rotas');
      await semQuebra(page, a);
      expect(a.chamadas.filter((c) => FASE_M.test(c.split(' ')[1]!)), 'chamadas a rotas da Fase M').toEqual([]);
      expect(a.chamadas.some((c) => c.startsWith('GET /core/rotas')), 'chamou /v1/core/rotas').toBe(true);
    });

    // ---------------------------------------------------------------- T-0081: Farol de clientes (deixou de ser "em construção")
    test('D-B21 Clientes (farol, T-0081): abre pelo menu, chama GET /v1/core/farol, mostra o farol e não está "em construção"', async ({ page }) => {
      await abrirPeloMenu(page, a, 'nav-core-clientes', 'pagina-core-clientes');
      await expect(page.getByTestId('farol.tela')).toBeVisible({ timeout: 30_000 });
      await semQuebra(page, a);
      await expect(page.getByTestId('pagina-core-clientes')).not.toContainText('Esta tela está em construção');
      expect(a.chamadas.some((c) => c.startsWith('GET /core/farol')), 'chamou /v1/core/farol').toBe(true);
      expect(a.chamadas.filter((c) => FASE_M.test(c.split(' ')[1]!)), 'chamadas a rotas da Fase M').toEqual([]);
      await expect(page.locator('[data-testid^="farol.cliente."], [data-testid^="farol.vendedor."]').first()).toBeVisible({ timeout: 30_000 });
    });

    test('D-B23 Metas e RV: abre pelo menu a tela de metas (não mais "em construção"), sem rota da Fase M', async ({ page }) => {
      await abrirPeloMenu(page, a, 'nav-core-metas', 'pagina-core-metas');
      await expect(page.getByTestId('metas.tela')).toBeVisible({ timeout: 30_000 });
      await semQuebra(page, a);
      await expect(page.getByTestId('pagina-core-metas')).not.toContainText('Esta tela está em construção');
      // T-0082 (desenho §1): o aviso "O Plano de RV segue em breve" saiu da tela de Metas
      await expect(page.getByTestId('pagina-core-metas')).not.toContainText('segue em breve');
      expect(a.chamadas.filter((c) => FASE_M.test(c.split(' ')[1]!)), 'chamadas a rotas da Fase M').toEqual([]);
    });

    // ---------------------------------------------------------------- T-0082: Plano de RV (deixou de ser "em construção")
    // A tela real (modules/core/web/components/plano-rv/plano-rv-page.tsx, ação plano_rv.ver) mostra a lista de versões
    // (GET /v1/core/plano-rv; a demo semeia o plano do vendedor, R$ 2.000,00) e a RV por pessoa (GET /v1/core/rv, ação
    // rv.ver: analista e admin veem). "Novo plano" só para quem tem plano_rv.editar (analista e admin).
    test('D-B25 Plano de RV (T-0082; ADR 0060): abre por Parâmetros › Metas e RV a tela real, chama GET /v1/core/plano-rv e /v1/core/rv, lista o plano da demo e não está "em construção"', async ({ page }) => {
      await abrirParametros(page, a, 'metas-e-rv', 'parametros-core-plano-rv');
      await expect(page.getByTestId('pagina-core-plano-rv')).toBeVisible();
      await expect(page.getByTestId('plano-rv.tela')).toBeVisible({ timeout: 30_000 });
      await semQuebra(page, a);
      await expect(page.getByTestId('pagina-core-plano-rv')).not.toContainText('Esta tela está em construção');
      expect(a.chamadas.filter((c) => FASE_M.test(c.split(' ')[1]!)), 'chamadas a rotas da Fase M').toEqual([]);
      expect(a.chamadas.some((c) => c === 'GET /core/plano-rv'), 'chamou GET /v1/core/plano-rv').toBe(true);
      await expect(page.getByTestId('plano-rv.lista')).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('[data-testid^="plano-rv.plano."]').first()).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('plano-rv.rv')).toBeVisible({ timeout: 30_000 });
      expect(a.chamadas.some((c) => c === 'GET /core/rv'), 'chamou GET /v1/core/rv').toBe(true);
      await expect(page.getByTestId('plano-rv.novo').first()).toBeVisible();
    });

    // ---------------------------------------------------------------- T-0029: Pedidos e Alçadas pela API nova
    // (o fluxo completo de Pedidos — lista, filtro, detalhe e aprovar — está em pedidos-bko.spec.ts)
    // ADR 0060: Alçadas é painel de Parâmetros › Pedidos (D5: as decisões recentes ficam no fim de Operação › Pedidos)
    for (const [id, abrir] of [
      ['D-B26 Pedidos', (page: Page) => abrirPeloMenu(page, a, 'nav-vendedor-pedidos', 'pagina-vendedor-pedidos')],
      ['D-B28 Alçadas', (page: Page) => abrirParametros(page, a, 'pedidos', 'parametros-vendedor-alcadas')],
    ] as const) {
      test(`${id} (T-0029): abre pelo menu e mostra os dados pela API nova, sem rota da Fase M`, async ({ page }) => {
        await abrir(page);
        await semQuebra(page, a);
        expect(a.chamadas.filter((c) => FASE_M.test(c.split(' ')[1]!)), 'chamadas a rotas da Fase M').toEqual([]);
        expect(a.chamadas.some((c) => c.startsWith('GET /vendedor/')), 'chamou /v1/vendedor').toBe(true);
      });
    }

    test('D-B29 Auditoria (T-0030): a lista carrega pela rota nova GET /v1/auditoria, sem /v1/audit-log da Fase M', async ({ page }) => {
      a.falhas.length = 0;
      a.chamadas.length = 0;
      await page.goto('/auditoria');
      await page.waitForTimeout(6_000);
      await semQuebra(page, a);
      expect(a.chamadas.filter((c) => FASE_M.test(c.split(' ')[1]!)), 'chamadas a rotas da Fase M').toEqual([]);
      expect(a.chamadas.some((c) => c.startsWith('GET /auditoria')), 'chamou /v1/auditoria').toBe(true);
    });

    test('D-B30 (T-0030): abrir /pedidos direto (F5 ou link) com rede lenta monta a página do Vendedor (o shell espera /me/modulos: apps/web/lib/estado-shell.ts)', async ({ page }) => {
      // rede lenta (túnel, 4G): /me/modulos chega depois da 1ª renderização — torna a corrida determinística
      await page.route('**/api-proxy/me/modulos', async (r) => {
        await new Promise((ok) => setTimeout(ok, 1_500));
        await r.continue();
      });
      await page.goto('/pedidos');
      await expect(page.getByTestId('pagina-vendedor-pedidos')).toBeVisible({ timeout: 20_000 });
    });

    test('D-B31 (T-0081): nenhuma página do menu tem tabela dentro de tabela no DOM (table table)', async ({ page }) => {
      test.slow(); // percorre o menu inteiro
      // ADR 0060: na sanfona, cada grupo abre para mostrar os itens; entrada com cadeado (`data-bloqueado`) não navega
      const porItem = await itensDoMenu(page);
      const navs = [...porItem.keys()];
      expect(navs.length, 'itens de menu').toBeGreaterThan(8);
      const aninhadas: string[] = [];
      let comTabela = 0;
      for (const nav of navs) {
        // nem todo item tem `pagina-*` (Auditoria do shell, itens de extensão): clica e espera as consultas assentarem
        const grupo = porItem.get(nav);
        if (grupo && !(await page.getByTestId(nav).first().isVisible())) await page.getByTestId(grupo).click();
        await page.getByTestId(nav).first().click();
        await expect(page.locator('main')).toBeVisible({ timeout: 30_000 });
        await page.waitForTimeout(3_000);
        if ((await page.locator('main table').count()) > 0) comTabela += 1;
        const n = await page.locator('table table').count();
        if (n > 0) aninhadas.push(`${nav}: ${n}`);
      }
      expect(aninhadas, 'páginas com table table').toEqual([]);
      expect(comTabela, 'páginas com tabela (o caso não passa no vazio)').toBeGreaterThan(2);
    });
  });
}
