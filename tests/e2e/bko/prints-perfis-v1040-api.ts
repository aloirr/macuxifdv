/**
 * v1.0.40 · ADR 0073 (E5/E6): prints da edição de perfis em tabela (Vendedor e Admin) a 1366 px, deviceScaleFactor 2, com a API
 * REAL (apps/api sobre o Postgres local, base de demo com o tenant em `concessao`). Entra pelo login do BKO como o admin da demo,
 * captura as respostas V2 (`/core/permissoes/catalogo` e `/core/perfis/:codigo`) e confere valor × regra do "n de m ligadas" de
 * cada grupo contra elas (n = chaves concedidas da área, m = chaves da área no catálogo; o grupo só de escopo não tem contagem).
 *
 * Pré-requisitos: a API (`MACUXI_PG_BANCO=<base de demo> pnpm --filter api dev`, porta 8100) e o BKO (`pnpm --filter web dev`)
 * no ar. `MACUXI_BKO_URL` (padrão http://localhost:3000), `MACUXI_DEMO_SENHA` (padrão a da demo, docs/banco/README.md).
 * Rodar: `pnpm exec tsx tests/e2e/bko/prints-perfis-v1040-api.ts <pasta-de-saida>` (`MACUXI_PW_CHROMIUM` aponta o Chromium já instalado).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';

const BKO = process.env.MACUXI_BKO_URL ?? 'http://localhost:3000';
const SAIDA = process.argv[2] ?? 'prints-perfis-v1040';
const SENHA = process.env.MACUXI_DEMO_SENHA ?? 'demo-macuxi';

interface Area { area: string; chaves: Array<{ chave: string; nivel?: string | null }> }
interface Detalhe { permissoes: Array<{ chave: string; concedida: boolean }> }

/**
 * A base de demo tem o código de empresa "demo", que o formulário do login recusa (UF + 4 números). O login é o da API real
 * (`POST /auth/login`, pelo proxy do BKO, com a sessão web), e a sessão entra no navegador como o shell a guarda.
 */
async function entrar(page: Page) {
  const r = await page.request.post('/api-proxy/auth/login', { data: { codigo_empresa: 'demo', email: 'admin@exemplo.com.br', senha: SENHA } });
  if (!r.ok()) throw new Error(`login da API real: HTTP ${r.status()}`);
  const { access_token: token } = (await r.json()) as { access_token: string };
  const me = (await (await page.request.get('/api-proxy/me', { headers: { authorization: `Bearer ${token}` } })).json().catch(() => ({}))) as Record<string, unknown>;
  const usuario = { id: me.id ?? 'admin', name: me.nome ?? 'Admin', email: 'admin@exemplo.com.br', perfil: 'admin', empresa: me.empresa ?? 'Demo', fuso: 'America/Manaus' };
  await page.addInitScript(
    ([u, t]) => {
      const j = JSON.stringify(u);
      localStorage.setItem('macuxi.web.user', j);
      sessionStorage.setItem('macuxi.web.token', t as string);
      sessionStorage.setItem('macuxi.web.token.usuario', j);
    },
    [usuario, token] as const,
  );
}

/** Abre o perfil e devolve o catálogo e o detalhe que a tela recebeu da API real. */
async function abrir(page: Page, codigo: string): Promise<{ catalogo: { areas: Area[] }; detalhe: Detalhe }> {
  let catalogo: { areas: Area[] } | null = null;
  let detalhe: Detalhe | null = null;
  const ouvir = async (r: import('playwright').Response) => {
    const p = new URL(r.url()).pathname.replace(/^\/api-proxy(\/v1)?/, '');
    if (r.status() !== 200) return;
    if (p === '/core/permissoes/catalogo') catalogo = (await r.json()) as { areas: Area[] };
    if (p === `/core/perfis/${codigo}`) detalhe = (await r.json()) as Detalhe;
  };
  page.on('response', (r) => void ouvir(r).catch(() => undefined));
  await page.goto(`/parametros/acesso?editar_perfil=${codigo}`);
  await page.getByTestId('tabela-permissoes').waitFor({ timeout: 120_000 });
  await page.waitForTimeout(1000);
  if (!catalogo || !detalhe) throw new Error(`${codigo}: a tela não recebeu catálogo e detalhe da API real`);
  return { catalogo, detalhe };
}

async function conferirContagens(page: Page, codigo: string, catalogo: { areas: Area[] }, detalhe: Detalhe): Promise<string[]> {
  const concedida = new Map(detalhe.permissoes.map((p) => [p.chave, p.concedida]));
  const erros: string[] = [];
  const vistos: string[] = [];
  for (const a of catalogo.areas) {
    if (a.chaves.every((c) => c.nivel === 'escopo')) continue;
    const esperado = `${a.chaves.filter((c) => concedida.get(c.chave)).length} de ${a.chaves.length} ligadas`;
    const visto = (await page.getByTestId(`tabela-permissoes.${a.area}.contagem`).textContent())?.trim();
    vistos.push(`${a.area} ${visto}`);
    if (visto !== esperado) erros.push(`${codigo}/${a.area}: tela "${visto}" × regra "${esperado}"`);
  }
  console.log(`${codigo}: ${vistos.join(' | ')}`);
  return erros;
}

async function main() {
  mkdirSync(SAIDA, { recursive: true });
  const nav = await chromium.launch(process.env.MACUXI_PW_CHROMIUM ? { executablePath: process.env.MACUXI_PW_CHROMIUM } : {});
  const ctx = await nav.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 2, baseURL: BKO, locale: 'pt-BR', timezoneId: 'America/Manaus' });
  const erros: string[] = [];
  const page = await ctx.newPage();
  await entrar(page);
  for (const codigo of ['vendedor', 'admin'] as const) {
    await page.setViewportSize({ width: 1366, height: 768 });
    const { catalogo, detalhe } = await abrir(page, codigo);
    await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' }); // o selo do modo dev do Next não é da tela
    erros.push(...(await conferirContagens(page, codigo, catalogo, detalhe)));
    const altura = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ width: 1366, height: altura + 80 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(SAIDA, `perfis-${codigo}-1366.png`) });
    const textos = await page.locator('body').innerText();
    for (const proibido of ['Perfil base', 'Restaurar', 'Promotor vê pedidos', 'RN-']) if (textos.includes(proibido)) erros.push(`${codigo}: texto "${proibido}" na página`);
    const principais = await page.locator('button').evaluateAll((bs) => bs.filter((b) => /bg-accent/.test(b.className) && !b.getAttribute('role')).map((b) => (b.textContent ?? '').trim()));
    console.log(`${codigo}: botões principais = ${JSON.stringify(principais)}; avisos de autogestão = ${(textos.match(/Você usa este perfil/g) ?? []).length}`);
  }
  // RN-PRO-01 pelo cargo, com a API real: escritas de pedido travadas com o motivo; "Ver pedidos" (pedido.ver) livre
  {
    await page.setViewportSize({ width: 1366, height: 768 });
    await abrir(page, 'promotor');
    await page.getByTestId('tabela-permissoes.pedidos.seta').click();
    const linhas = await page.locator('[data-testid^="tabela-permissoes.pedidos."][role="listitem"]').evaluateAll((ls) =>
      ls.map((l) => `${l.getAttribute('data-testid')?.replace('tabela-permissoes.pedidos.', '')} trava=${l.getAttribute('data-travada') ?? 'nao'} motivo=${l.querySelector('[data-testid$=".motivo"]')?.textContent ?? ''}`),
    );
    console.log('promotor/pedidos:\n  ' + linhas.join('\n  '));
  }
  await nav.close();
  console.log(erros.length ? `DIVERGÊNCIAS:\n${erros.join('\n')}` : 'Sem divergências.');
  if (erros.length) process.exitCode = 1;
}

void main();
