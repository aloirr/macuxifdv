/**
 * T-0029 (onda 3) — Pedidos no BKO pelo navegador (Playwright), contra a demo local com a API real.
 *
 * Fluxo: o vendedor tira um pedido de 8% pela API (push do sync, como o app) → o analista vê a lista, filtra por status
 * e pela busca, abre o detalhe com os itens e os botões de PDF → a supervisora (BKO) aprova pelo painel "Aguardando
 * aprovação" → a lista e a API mostram "Aprovado". No fim o pedido do teste é cancelado (a base da demo fica como estava,
 * a menos desse pedido cancelado com a observação "e2e testes").
 *
 * Pré-requisito (não sobe nada sozinho): demo no ar (`scripts\demo\subir-demo.ps1 -SemTunel`, API em 8100) e o BKO
 * (`pnpm --filter web dev`, porta 3000). Rodar na raiz: `pnpm test:e2e`. `MACUXI_BKO_URL` muda o BKO; `MACUXI_API_URL`
 * (padrão http://localhost:8100/v1) é a API direta usada para o push do vendedor e as conferências.
 * testIDs: modules/vendedor/web (R-20261101-073236-modulo-vendedor). Matriz: tests/plano/demo-matriz.md (D-B26..D-B28).
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const SENHA = 'demo-macuxi';
const API = process.env.MACUXI_API_URL ?? 'http://localhost:8100/v1';
/** Rotas da Fase M que a página nova não pode chamar. */
const FASE_M = /^\/(me$|(teams|sellers|branches|dashboards|orders|discount-policy|audit-log)(\/|$))/;

let ipSeq = Math.floor(Math.random() * 200);
const ip = () => `10.29.${(ipSeq = (ipSeq + 1) % 250)}.${Math.floor(Math.random() * 250) + 1}`;

async function sessaoApi(request: APIRequestContext, email: string): Promise<string> {
  const r = await request.post(`${API}/auth/login`, { data: { codigo_empresa: 'demo', email, senha: SENHA }, headers: { 'x-forwarded-for': ip() } });
  expect(r.status(), await r.text()).toBe(200);
  return ((await r.json()) as { access_token: string }).access_token;
}

async function puxar<T>(request: APIRequestContext, token: string, entidade: string): Promise<T[]> {
  const todos: T[] = [];
  let cursor: string | null = null;
  do {
    const r = await request.get(`${API}/sync/pull`, { params: { entidade, ...(cursor ? { cursor } : {}) }, headers: { authorization: `Bearer ${token}` } });
    expect(r.status(), await r.text()).toBe(200);
    const p = (await r.json()) as { itens: T[]; proximo_cursor: string | null };
    todos.push(...p.itens);
    cursor = p.proximo_cursor;
  } while (cursor);
  return todos;
}

function vigiar(page: Page) {
  const a = { falhas: [] as string[], chamadas: [] as string[] };
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

async function entrar(page: Page, email: string) {
  await page.goto('/login');
  const campos: Array<[string, string]> = [['login.codigo-empresa', 'demo'], ['login.email', email], ['login.senha', SENHA]];
  // no `next dev`, a hidratação ou um recarregamento do HMR pode limpar os campos entre o preencher e o clicar
  // (o formulário volta com "Informe..."): preenche, confere, clica e espera o menu; se não veio, repete
  await expect(async () => {
    if (await page.getByTestId('nav-vendedor-pedidos').first().isVisible()) return;
    for (const [id, valor] of campos) await page.getByTestId(id).fill(valor);
    for (const [id, valor] of campos) await expect(page.getByTestId(id)).toHaveValue(valor, { timeout: 1_000 });
    await page.getByTestId('login.entrar').click();
    await expect(page.getByTestId('nav-vendedor-pedidos').first()).toBeVisible({ timeout: 20_000 });
  }).toPass({ timeout: 90_000 });
}

async function abrirPedidos(page: Page) {
  await page.getByTestId('nav-vendedor-pedidos').first().click();
  await expect(page.getByTestId('pagina-vendedor-pedidos')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('pedidos.tabela')).toBeVisible({ timeout: 30_000 });
}

test.describe.serial('T-0029 — Pedidos no BKO (lista, filtro, detalhe, aprovar)', () => {
  let pedidoId = '';
  let numero = '';
  let tokenVendedor = '';

  test.beforeAll(async ({ request }) => {
    // o vendedor (Lucas) tira um pedido de 8% como o app: cliente do Varejo da carteira e 2 produtos com preço
    tokenVendedor = await sessaoApi(request, 'vendedor@exemplo.com.br');
    const vinculos = await puxar<{ cliente_id: string; tabela_preco_id: string }>(request, tokenVendedor, 'cliente_tabela_preco');
    const itens = await puxar<{ tabela_preco_id: string; produto_id: string }>(request, tokenVendedor, 'tabela_preco_item');
    const porTabela = new Map<string, string[]>();
    for (const i of itens) porTabela.set(i.tabela_preco_id, [...(porTabela.get(i.tabela_preco_id) ?? []), i.produto_id]);
    const v = vinculos.sort((a, b) => (porTabela.get(b.tabela_preco_id)?.length ?? 0) - (porTabela.get(a.tabela_preco_id)?.length ?? 0))[0]!;
    const produtos = [...new Set(porTabela.get(v.tabela_preco_id) ?? [])].slice(0, 2);
    expect(produtos).toHaveLength(2);
    pedidoId = randomUUID();
    const payload = {
      id: pedidoId,
      customer_id: v.cliente_id,
      discount_pct: 8,
      payment_terms: 'À vista',
      created_offline_at: null,
      observacao: 'e2e testes (pode ignorar)',
      items: produtos.map((product_id, i) => ({ product_id, quantity: i + 2 })),
    };
    const r = await request.post(`${API}/sync/push`, { data: { itens: [{ id: pedidoId, entidade: 'pedido', operacao: 'upsert', payload }] }, headers: { authorization: `Bearer ${tokenVendedor}` } });
    expect(r.status(), await r.text()).toBe(200);
    expect(((await r.json()) as { resultados: Array<{ status: string }> }).resultados[0]!.status).toBe('aceito');
    const d = await request.get(`${API}/vendedor/pedidos/${pedidoId}`, { headers: { authorization: `Bearer ${tokenVendedor}` } });
    const det = (await d.json()) as { number: string; status: string };
    expect(det.status).toBe('pending_approval');
    numero = det.number;
  });

  test.afterAll(async ({ request }) => {
    // deixa a base da demo como estava (o pedido do teste fica cancelado)
    if (pedidoId && tokenVendedor) await request.post(`${API}/vendedor/pedidos/${pedidoId}/cancelar`, { data: { motivo: 'e2e testes' }, headers: { authorization: `Bearer ${tokenVendedor}` } });
  });

  test('D-B26: o analista abre Pedidos pelo menu; a lista carrega pela API nova, sem rota da Fase M e sem erro', async ({ page }) => {
    test.slow();
    const a = vigiar(page);
    await entrar(page, 'analista@exemplo.com.br');
    await abrirPedidos(page);
    await expect(page.getByTestId(`pedido.linha.${numero}`)).toBeVisible({ timeout: 30_000 });
    expect(await page.locator('[data-testid^="pedido.linha."]').count()).toBeGreaterThanOrEqual(10);
    await expect(page.getByTestId('pedidos.pendentes')).toContainText(numero);
    expect([...new Set(a.falhas)], 'rotas que responderam erro').toEqual([]);
    expect(a.chamadas.filter((c) => FASE_M.test(c.split(' ')[1]!)), 'chamadas a rotas da Fase M').toEqual([]);
    expect(a.chamadas.some((c) => c.startsWith('GET /vendedor/pedidos'))).toBe(true);
    // o analista decide só o nível analista (P-3): o pedido de 8% (nível supervisor) não tem botão para ele
    await expect(page.getByTestId(`pedido.aprovar.${numero}`)).toHaveCount(0);
  });

  test('D-B26: filtros na URL — status "Aguardando aprovação" e busca pelo número; limpar volta a lista inteira', async ({ page }) => {
    await entrar(page, 'analista@exemplo.com.br');
    await abrirPedidos(page);
    await page.getByTestId('pedidos.filtro-status').selectOption('pending_approval');
    await expect(page).toHaveURL(/status=pending_approval/);
    await expect(page.getByTestId(`pedido.linha.${numero}`)).toBeVisible({ timeout: 20_000 });
    const linhas = page.locator('[data-testid^="pedido.linha."]');
    await expect(async () => {
      const n = await linhas.count();
      expect(n).toBeGreaterThan(0);
      for (let i = 0; i < n; i++) await expect(linhas.nth(i)).toContainText('Aguardando aprovação');
    }).toPass({ timeout: 20_000 });
    await page.getByTestId('pedidos.filtro-busca').fill(numero);
    await expect(page).toHaveURL(new RegExp(`q=${numero}`));
    await expect(async () => expect(await linhas.count()).toBe(1)).toPass({ timeout: 20_000 });
    await page.getByTestId('pedidos.limpar-filtros').click();
    await expect(page).not.toHaveURL(/status=|q=/);
    await expect(async () => expect(await linhas.count()).toBeGreaterThanOrEqual(10)).toPass({ timeout: 20_000 });
  });

  test('D-B27: detalhe — clicar na linha abre a gaveta com os itens e os botões de PDF (cliente e interno)', async ({ page }) => {
    await entrar(page, 'analista@exemplo.com.br');
    await abrirPedidos(page);
    await page.getByTestId(`pedido.linha.${numero}`).click();
    await expect(page.getByTestId('pedido.detalhe')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('pedido.itens').locator('tbody tr')).toHaveCount(2, { timeout: 20_000 });
    await expect(page.getByTestId('pedido.pdf.cliente')).toBeEnabled();
    await expect(page.getByTestId('pedido.pdf.interno')).toBeEnabled();
    // o número fica no título da gaveta (fora do corpo pedido.detalhe)
    await expect(page.getByRole('dialog')).toContainText(`Pedido ${numero}`);
  });

  test('D-B26/RN-GES-08: a supervisora aprova pelo painel "Aguardando aprovação" (1 clique); a lista e a API mostram Aprovado', async ({ page, request }) => {
    const a = vigiar(page);
    await entrar(page, 'supervisor@exemplo.com.br');
    await abrirPedidos(page);
    const aprovar = page.getByTestId(`pedido.aprovar.${numero}`);
    await expect(aprovar).toBeVisible({ timeout: 30_000 });
    await aprovar.click();
    await expect(page.getByTestId('pedidos.pendentes')).not.toContainText(numero, { timeout: 30_000 });
    await expect(page.getByTestId(`pedido.linha.${numero}`)).toContainText('Aprovado', { timeout: 30_000 });
    expect(a.chamadas).toContain(`POST /vendedor/pedidos/${pedidoId}/aprovar`);
    expect([...new Set(a.falhas)], 'rotas que responderam erro').toEqual([]);
    const d = await request.get(`${API}/vendedor/pedidos/${pedidoId}`, { headers: { authorization: `Bearer ${tokenVendedor}` } });
    expect(((await d.json()) as { status: string }).status).toBe('approved');
  });

  test('D-B28: Alçadas abre pelo menu com a política vigente (5/10/15%) pela API nova', async ({ page }) => {
    const a = vigiar(page);
    await entrar(page, 'analista@exemplo.com.br');
    await page.getByTestId('nav-vendedor-alcadas').first().click();
    await expect(page.getByTestId('alcadas.tela')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('alcadas.tabela')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('alcadas.tabela')).toContainText('5');
    await page.waitForTimeout(2_000);
    expect([...new Set(a.falhas)], 'rotas que responderam erro').toEqual([]);
    expect(a.chamadas.filter((c) => FASE_M.test(c.split(' ')[1]!)), 'chamadas a rotas da Fase M').toEqual([]);
  });
});
