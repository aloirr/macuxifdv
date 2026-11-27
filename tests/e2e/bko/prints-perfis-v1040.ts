/**
 * v1.0.40 · ADR 0073 (E5): prints da edição de perfis em tabela (Vendedor e Admin) a 1366 px, deviceScaleFactor 2, com a API
 * SIMULADA por `page.route` no formato V2 (`rotasDePerfisV2`, modules/core/api/perfis-v2.ts). As respostas saem das funções reais
 * do domain (`montarCatalogoPorArea`, `montarDetalheV2`) sobre o catálogo dos manifestos e os modelos do SDK. Como na simulação
 * aprovada (docs/design/simulacoes/2026-11-24/perfis-tabela.md), o Treinamento fica sem licença para mostrar o grupo desabilitado.
 * Também confere valor × regra do "n de m ligadas" de cada grupo contra a resposta simulada.
 *
 * Pré-requisito: o BKO no ar (`pnpm --filter web dev`; `MACUXI_BKO_URL`, padrão http://localhost:3000).
 * Rodar: `pnpm exec tsx tests/e2e/bko/prints-perfis-v1040.ts <pasta-de-saida>` (`MACUXI_PW_CHROMIUM` aponta o Chromium já instalado).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { manifest as catalogoM } from '@macuxi/catalogo/manifest';
import { manifest as coreM } from '@macuxi/core/manifest';
import { manifest as gestorM } from '@macuxi/gestor/manifest';
import { manifest as integracaoM } from '@macuxi/integracao/manifest';
import { manifest as pesquisaM } from '@macuxi/pesquisa/manifest';
import { manifest as promotorM } from '@macuxi/promotor/manifest';
import { manifest as treinamentoM } from '@macuxi/treinamento/manifest';
import { manifest as vendedorM } from '@macuxi/vendedor/manifest';
import { CATALOGO_PERMISSOES_VERSAO, catalogoDePermissoes, MODELOS_PERFIL, modelosDePerfil, type ModuloId } from '@macuxi/platform-sdk';
import { montarCatalogoPorArea, montarDetalheV2, ondeEntraPeloCargo } from '../../../modules/core/domain/perfis-cargo';

const BKO = process.env.MACUXI_BKO_URL ?? 'http://localhost:3000';
const SAIDA = process.argv[2] ?? 'prints-perfis-v1040';
const manifestos = [coreM, catalogoM, vendedorM, promotorM, gestorM, pesquisaM, treinamentoM, integracaoM];
/** Igual ao `FORA_DA_TELA` de modules/core/api/perfis-v2.ts (não exportado). */
const FORA_DA_TELA = new Set(['notificacao.ler', 'dispositivo.registrar_push', 'app.atualizar', 'parametro.promotor_ve_pedidos']);
const catalogo = catalogoDePermissoes(manifestos).filter((d) => !FORA_DA_TELA.has(d.chave));
const CONTRATADOS: ModuloId[] = ['core', 'catalogo', 'vendedor', 'promotor', 'gestor', 'pesquisa', 'integracao'];
const licencas = new Set<ModuloId>(CONTRATADOS);
const modelos = modelosDePerfil(manifestos);
const NOMES: Record<string, string> = { vendedor: 'Vendedor', promotor: 'Promotor', supervisor: 'Supervisor', gerente: 'Gerente', analista: 'Analista', assistente: 'Assistente', admin: 'Admin' };
const USUARIOS: Record<string, number> = { vendedor: 2, promotor: 1, supervisor: 1, gerente: 1, analista: 0, assistente: 0, admin: 1 };
const ATUALIZADO = '2026-11-27T12:00:00.000Z';

const resposta = {
  catalogo: montarCatalogoPorArea(catalogo, licencas, CATALOGO_PERMISSOES_VERSAO),
  lista: {
    itens: MODELOS_PERFIL.map((m) => ({ codigo: m, nome: NOMES[m]!, descricao: null, cargo: modelos[m].cargo, ativo: true, usuarios: USUARIOS[m]!, onde_entra: ondeEntraPeloCargo(modelos[m].cargo, modelos[m].permissoes) })),
  },
  detalhe: (codigo: (typeof MODELOS_PERFIL)[number]) =>
    montarDetalheV2({
      codigo,
      nome: NOMES[codigo]!,
      descricao: null,
      cargo: modelos[codigo].cargo,
      ativo: true,
      usuarios: USUARIOS[codigo]!,
      atualizado_em: ATUALIZADO,
      permissoes: modelos[codigo].permissoes,
      catalogo,
      licencas,
      perfisAtivos: MODELOS_PERFIL.map((m) => ({ codigo: m, nome: NOMES[m]!, cargo: modelos[m].cargo, permissoes: modelos[m].permissoes })),
      modulos: CONTRATADOS,
    }),
};

async function entrar(page: Page) {
  const usuario = { id: '00000000-0000-4000-8000-000000000001', name: 'Usuário Teste', email: 'admin@exemplo.invalid', perfil: 'admin', empresa: 'Empresa Fictícia', fuso: 'America/Manaus' };
  await page.addInitScript((u) => {
    const j = JSON.stringify(u);
    localStorage.setItem('macuxi.web.user', j);
    sessionStorage.setItem('macuxi.web.token', 'token-ficticio');
    sessionStorage.setItem('macuxi.web.token.usuario', j);
  }, usuario);
  await page.route('**/api-proxy/**', async (r) => {
    const caminho = new URL(r.request().url()).pathname.replace(/^\/api-proxy(\/v1)?/, '');
    const json = (status: number, corpo: unknown) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corpo) });
    if (caminho === '/auth/refresh') return json(200, { access_token: 'token-ficticio', token_type: 'Bearer', expires_in: 900 });
    if (caminho === '/me/modulos')
      return json(200, { modulos: CONTRATADOS.map((m) => ({ id: m, versao: '1.0.0', parametros: {} })), versao_licencas: 'e2e', calculado_em: ATUALIZADO, modulos_contratados: CONTRATADOS });
    if (caminho === '/core/permissoes/catalogo') return json(200, resposta.catalogo);
    if (caminho === '/core/perfis') return json(200, resposta.lista);
    const m = /^\/core\/perfis\/([a-z_]+)$/.exec(caminho);
    if (m && (MODELOS_PERFIL as readonly string[]).includes(m[1]!)) return json(200, resposta.detalhe(m[1] as (typeof MODELOS_PERFIL)[number]));
    if (caminho === '/core/usuarios') return json(200, { itens: [] });
    if (caminho === '/core/parametros/promotor-ve-pedidos') return json(200, { ligado: true });
    if (caminho === '/core/licencas')
      return json(200, {
        modulos: [...CONTRATADOS, 'treinamento'],
        dependencias: { vendedor: ['catalogo'] },
        tenant: Object.fromEntries([...CONTRATADOS, 'treinamento'].map((x) => [x, x !== 'treinamento'])),
        perfis: Object.fromEntries(MODELOS_PERFIL.map((x) => [x, CONTRATADOS])),
        usuarios: [],
      });
    return json(404, { codigo: 'NAO_SIMULADO', mensagem: 'Não simulado.' });
  });
}

/** Valor × regra: o "n de m ligadas" de cada grupo = concedidas / chaves da área na resposta simulada. */
async function conferirContagens(page: Page, codigo: (typeof MODELOS_PERFIL)[number]): Promise<string[]> {
  const d = resposta.detalhe(codigo);
  const concedida = new Map(d.permissoes.map((p) => [p.chave, p.concedida]));
  const erros: string[] = [];
  for (const a of resposta.catalogo.areas) {
    if (a.chaves.every((c) => c.nivel === 'escopo')) continue;
    const esperado = `${a.chaves.filter((c) => concedida.get(c.chave)).length} de ${a.chaves.length} ligadas`;
    const visto = (await page.getByTestId(`tabela-permissoes.${a.area}.contagem`).textContent())?.trim();
    if (visto !== esperado) erros.push(`${codigo}/${a.area}: tela "${visto}" × regra "${esperado}"`);
  }
  return erros;
}

async function main() {
  mkdirSync(SAIDA, { recursive: true });
  const nav = await chromium.launch(process.env.MACUXI_PW_CHROMIUM ? { executablePath: process.env.MACUXI_PW_CHROMIUM } : {});
  const ctx = await nav.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 2, baseURL: BKO, locale: 'pt-BR', timezoneId: 'America/Manaus' });
  const erros: string[] = [];
  for (const codigo of ['vendedor', 'admin'] as const) {
    const page = await ctx.newPage();
    await entrar(page);
    await page.goto(`/parametros/acesso?editar_perfil=${codigo}`);
    await page.getByTestId('tabela-permissoes').waitFor({ timeout: 120_000 });
    // o selo do modo dev do Next não é da tela
    await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
    await page.waitForTimeout(800);
    erros.push(...(await conferirContagens(page, codigo)));
    // página inteira numa janela da altura dela: a barra fixa do Salvar fica no rodapé, como o usuário a vê
    const altura = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ width: 1366, height: altura + 80 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(SAIDA, `perfis-${codigo}-1366.png`) });
    const textos = await page.locator('body').innerText();
    for (const proibido of ['Perfil base', 'Restaurar', 'Promotor vê pedidos', 'RN-']) if (textos.includes(proibido)) erros.push(`${codigo}: texto "${proibido}" na página`);
    const principais = await page.locator('button').evaluateAll((bs) => bs.filter((b) => /bg-accent/.test(b.className) && !b.getAttribute('role')).map((b) => (b.textContent ?? '').trim()));
    console.log(`${codigo}: botões principais = ${JSON.stringify(principais)}`);
    if (codigo === 'vendedor') {
      // caixa do grupo: Clientes (parte) → liga só as livres
      const t = (id: string) => page.getByTestId(`tabela-permissoes.${id}`);
      console.log('clientes antes:', await t('clientes.caixa').getAttribute('aria-checked'), await t('clientes.contagem').textContent());
      await t('clientes.caixa').click();
      console.log('clientes depois:', await t('clientes.caixa').getAttribute('aria-checked'), await t('clientes.contagem').textContent(), '|', await page.getByTestId('perfil.contagem').textContent());
      console.log('acesso (travadas) antes:', await t('acesso.caixa').getAttribute('aria-checked'), await t('acesso.contagem').textContent());
      await t('acesso.caixa').click();
      console.log('acesso depois:', await t('acesso.caixa').getAttribute('aria-checked'), await t('acesso.contagem').textContent());
      console.log('treinamento caixa:', await t('treinamento.caixa').getAttribute('aria-disabled'), await t('treinamento.contagem').textContent());
      await page.getByTestId('tabela-permissoes.busca').locator('input').first().fill('transportadora').catch(async () => page.getByTestId('tabela-permissoes.busca').fill('transportadora'));
      await page.waitForTimeout(300);
      const linhas = await page.locator('[data-testid^="tabela-permissoes."][role="listitem"]').evaluateAll((ls) => ls.map((l) => l.getAttribute('data-testid')));
      console.log('busca "transportadora":', JSON.stringify(linhas));
      await page.getByTestId('tabela-permissoes.busca').locator('input').first().fill('zzz').catch(async () => page.getByTestId('tabela-permissoes.busca').fill('zzz'));
      console.log('busca sem resultado:', await page.getByTestId('tabela-permissoes.vazio').textContent());
    }
    await page.close();
  }
  // RN-PRO-01: no perfil Promotor, as escritas de pedido ficam com cadeado e o motivo escrito; "Ver pedidos" fica livre
  {
    const page = await ctx.newPage();
    await entrar(page);
    await page.goto('/parametros/acesso?editar_perfil=promotor');
    await page.getByTestId('tabela-permissoes').waitFor({ timeout: 120_000 });
    await page.getByTestId('tabela-permissoes.pedidos.seta').click();
    const linhas = await page.locator('[data-testid^="tabela-permissoes.pedidos."][role="listitem"]').evaluateAll((ls) =>
      ls.map((l) => `${l.getAttribute('data-testid')?.replace('tabela-permissoes.pedidos.', '')} trava=${l.getAttribute('data-travada') ?? 'nao'} motivo=${l.querySelector('[data-testid$=".motivo"]')?.textContent ?? ''}`),
    );
    console.log('promotor/pedidos:\n  ' + linhas.join('\n  '));
    await page.close();
  }
  await nav.close();
  console.log(erros.length ? `DIVERGÊNCIAS:\n${erros.join('\n')}` : 'Sem divergências.');
}

void main();
