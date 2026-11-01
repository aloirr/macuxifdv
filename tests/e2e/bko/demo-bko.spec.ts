/**
 * T-0028 — BKO na demo (Playwright): login do analista e do admin na base `demo` e cada página do menu, com a API real.
 *
 * Pré-requisito (não sobe nada sozinho): demo no ar (`scripts\demo\subir-demo.ps1 -SemTunel`, API em 8100) e o BKO
 * (`pnpm --filter web dev`, porta 3000). Rodar na raiz: `pnpm test:e2e`. `MACUXI_BKO_URL` muda o endereço do BKO.
 *
 * Convenção: `test` = funciona hoje; `test.fail` = quebrado (a página trava em "Carregando…" ou mostra "Rota não
 * encontrada" porque chama rota da Fase M que a API nova não tem). Quando a correção chega, o `test.fail` fica
 * vermelho e vira `test`. T-0030: D-B10 (Rotas) funciona; D-B21/23/25 esperam a página "em construção"
 * (EmBrevePage). Matriz e causas: tests/plano/demo-matriz.md (IDs D-Bnn).
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
async function entrar(page: Page, email: string, espera = 'nav-core-clientes') {
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

/** Abre a página pelo MENU (navegação do cliente) e espera as consultas assentarem. */
async function abrirPeloMenu(page: Page, a: Aberta, nav: string, pagina: string) {
  a.falhas.length = 0;
  a.chamadas.length = 0;
  await page.getByTestId(nav).first().click();
  await expect(page.getByTestId(pagina)).toBeVisible({ timeout: 30_000 });
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
      await expect(page.getByTestId('nav-core-clientes').first()).toBeVisible({ timeout: 60_000 });
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
      await expect(page.getByTestId('nav-core-clientes').first()).toBeVisible({ timeout: 60_000 });
    });

    test('D-B00: o menu tem as páginas dos módulos licenciados (Core e Vendedor)', async ({ page }) => {
      for (const n of ['nav-core-clientes', 'nav-core-rotas', 'nav-core-visitas', 'nav-core-recados', 'nav-core-carteira', 'nav-core-metas', 'nav-core-indicadores', 'nav-core-aparelhos', 'nav-vendedor-pedidos', 'nav-vendedor-alcadas']) {
        await expect(page.getByTestId(n).first(), n).toBeVisible();
      }
      await expect(page.getByTestId('nav-core-usuarios-e-modulos')).toHaveCount(quem === 'admin' ? 2 : 0, { timeout: 5_000 }).catch(async () => {
        // o menu compacto pode não existir neste tamanho de tela: basta aparecer (admin) ou não (analista)
        expect(await page.getByTestId('nav-core-usuarios-e-modulos').count() > 0).toBe(quem === 'admin');
      });
    });

    // ---------------------------------------------------------------- funcionam
    for (const [id, nav, pagina] of [
      ['D-B02 Visitas', 'nav-core-visitas', 'pagina-core-visitas'],
      ['D-B03 Indicadores', 'nav-core-indicadores', 'pagina-core-indicadores'],
      ['D-B04 Recados', 'nav-core-recados', 'pagina-core-recados'],
      ['D-B06 Motivos', 'nav-core-motivos', 'pagina-core-motivos'],
      ['D-B07 Coordenadas sugeridas', 'nav-core-coordenadas-sugeridas', 'pagina-core-coordenadas-sugeridas'],
      ['D-B08 Aparelhos', 'nav-core-aparelhos', 'pagina-core-aparelhos'],
    ] as const) {
      test(`${id}: abre pelo menu e mostra os dados sem erro de rota`, async ({ page }) => {
        await abrirPeloMenu(page, a, nav, pagina);
        await semQuebra(page, a);
      });
    }

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
      test('D-B09 Usuários e módulos: o admin vê as licenças do tenant (core, catálogo, vendedor, promotor)', async ({ page }) => {
        await abrirPeloMenu(page, a, 'nav-core-usuarios-e-modulos', 'pagina-core-usuarios-e-modulos');
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

    // ---------------------------------------------------------------- "em construção" (T-0030: sem rota v1; Sprint 2)
    for (const [id, nav, pagina] of [
      ['D-B21 Clientes (farol)', 'nav-core-clientes', 'pagina-core-clientes'],
      ['D-B23 Metas e RV', 'nav-core-metas', 'pagina-core-metas'],
      ['D-B25 Plano de RV', 'nav-core-plano-rv', 'pagina-core-plano-rv'],
    ] as const) {
      test(`${id} EM BREVE: abre pelo menu, mostra "em construção" sem travar e sem chamar rota da Fase M`, async ({ page }) => {
        await abrirPeloMenu(page, a, nav, pagina);
        await expect(page.getByTestId(pagina)).toContainText('Esta tela está em construção');
        await semQuebra(page, a);
        expect(a.chamadas.filter((c) => FASE_M.test(c.split(' ')[1]!)), 'chamadas a rotas da Fase M').toEqual([]);
      });
    }

    // ---------------------------------------------------------------- T-0029: Pedidos e Alçadas pela API nova
    // (o fluxo completo de Pedidos — lista, filtro, detalhe e aprovar — está em pedidos-bko.spec.ts)
    for (const [id, nav, pagina] of [
      ['D-B26 Pedidos', 'nav-vendedor-pedidos', 'pagina-vendedor-pedidos'],
      ['D-B28 Alçadas', 'nav-vendedor-alcadas', 'pagina-vendedor-alcadas'],
    ] as const) {
      test(`${id} (T-0029): abre pelo menu e mostra os dados pela API nova, sem rota da Fase M`, async ({ page }) => {
        await abrirPeloMenu(page, a, nav, pagina);
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
  });
}
