/**
 * v1.0.19 — os parâmetros do tenant chegam às telas do BKO (matriz docs/testes/v1018-parametros.md, V3, V4, V6 e V8).
 * Caminho real do shell web, sem navegador e sem banco: a resposta de `GET /v1/me/modulos` (API simulada no
 * `@macuxi/platform-sdk/web`) → `consultaMeusModulos` (a consulta `qk.modulos` do menu, `apps/web/lib/queries.ts`) →
 * `criarAmbienteWeb(usuario, lerLogo, parametros)` (`apps/web/lib/ambiente.ts`) → `ShellProvider` → `useParametros` das telas.
 * - RN-PES-07 (limites do construtor) e RN-TRE-02 (nota mínima): os painéis REAIS de Parâmetros, renderizados com
 *   react-dom/server, mostram o valor do tenant (30 perguntas, 80%) com "Padrão: X", e o esperado sai da rota da API.
 * - RN-CAT-11 (limite da Aplicação): o limite que a tela do Catálogo usa é o do tenant (300), não o padrão (2.000).
 * - T-0182 (nome da empresa no PDF do pedido): o PDF do BKO sai com o `empresa_nome` do tenant.
 * - RN-CORE-02: módulo fora de `/v1/me/modulos` não tem parâmetros (padrão nas telas).
 * O e2e da tela, com a mesma resposta simulada, está em tests/e2e/bko/menu-parametros.spec.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient } from '@tanstack/react-query';
import { ShellProvider, useParametros } from '@macuxi/platform-sdk/react';
import type { ModuloId, VisaoShell } from '@macuxi/platform-sdk';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parametrosDaRota as rotaPesquisa } from '../../modules/pesquisa/api/comum';
import { PARAMETROS_PADRAO as PADRAO_PES } from '../../modules/pesquisa/domain/parametros';
import { ParametrosConstrutor } from '../../modules/pesquisa/web/pages/parametros-painel';
import { parametrosDoTenant as rotaTreinamento } from '../../modules/treinamento/api/comum';
import { PARAMETROS_PADRAO as PADRAO_TRE } from '../../modules/treinamento/domain/parametros';
import { PainelQuizLicao } from '../../modules/treinamento/web/pages/parametros-paineis';
import { PARAMETROS_PADRAO as PADRAO_CAT, parametrosDoTenant as parametrosCatalogo } from '../../modules/catalogo/domain/parametros';
import { contadorAplicacao } from '../../modules/catalogo/web/lib/formularios';
import type { OrderDetail } from '../../modules/vendedor/contracts';
import { exportarPdfDoPedido } from '../../modules/vendedor/web/components/orders/exportar-pdf';

const RAIZ = join(__dirname, '..', '..');
const FUSO = 'America/Manaus';

/** Cadastro do tenant em `/v1/me/modulos` (o mesmo do e2e). */
const TENANT = {
  core: { empresa_nome: 'Mercado Bom Fictício' },
  pesquisa: { max_perguntas: 30 },
  treinamento: { nota_minima_pct: 80 },
  catalogo: { aplicacao_max_cadastro: 300 },
} as const;

const api = vi.hoisted(() => ({ modulos: [] as { id: string; versao: string; parametros?: Record<string, unknown> }[], impresso: [] as string[] }));

vi.mock('@macuxi/platform-sdk/web', async (original) => {
  const real = await original<typeof import('@macuxi/platform-sdk/web')>();
  return {
    ...real,
    api: async (caminho: string) => {
      if (caminho !== '/me/modulos') throw new Error(`não simulado: ${caminho}`);
      return { modulos: api.modulos, versao_licencas: 'v1019', calculado_em: '2026-11-21T12:00:00.000Z' };
    },
    imprimirHtml: async (html: string) => {
      api.impresso.push(html);
    },
  };
});

const { consultaMeusModulos } = await import('../../apps/web/lib/queries');
const { criarAmbienteWeb } = await import('../../apps/web/lib/ambiente');

afterEach(() => {
  api.impresso.length = 0;
});

/** O que o app-shell faz: lê `qk.modulos` e passa os `parametros` ao `criarAmbienteWeb` (sem logo: o PDF usa a padrão). */
async function ambienteDoShell(modulos: Partial<Record<ModuloId, Record<string, unknown>>>) {
  api.modulos = Object.entries(modulos).map(([id, parametros]) => ({ id, versao: '1.0.0', parametros }));
  const dados = await new QueryClient().fetchQuery(consultaMeusModulos('admin'));
  return criarAmbienteWeb(() => null, async () => null, dados.parametros);
}

const visao = { pode: () => true, extensoes: () => [] } as unknown as VisaoShell<unknown>;
const render = (ambiente: Awaited<ReturnType<typeof ambienteDoShell>>, tela: ReactElement) =>
  renderToStaticMarkup(createElement(ShellProvider, { visao, ambiente, children: tela }));

/** Pares rótulo → valor (e "Padrão: X", se houver) da `ListaParametros` do kit. */
function linhas(html: string): Record<string, string> {
  const texto = (s: string) => s.replace(/<span[^>]*>/g, ' | ').replace(/<[^>]*>/g, '').trim();
  return Object.fromEntries([...html.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt><dd[^>]*>([\s\S]*?)<\/dd>/g)].map((m) => [texto(m[1]!), texto(m[2]!)]));
}

const ctxApi = (brutos: Record<string, unknown>) => ({ parametros: () => brutos, fuso: () => FUSO, log: { warn: () => undefined } }) as never;

describe('Parâmetros do tenant no BKO: /v1/me/modulos → ambiente do shell → telas', () => {
  it('RN-PES-07: Parâmetros › Pesquisa › Construtor mostra 30 perguntas (o que a API aplica), com "Padrão: 50"', async () => {
    const aplicado = rotaPesquisa(ctxApi(TENANT.pesquisa)).max_perguntas;
    expect(aplicado).toBe(30);
    const html = render(await ambienteDoShell(TENANT), createElement(ParametrosConstrutor));
    expect(html).toContain('data-testid="parametros-pesquisa-construtor-valores"');
    expect(linhas(html)['Perguntas por questionário']).toBe(`${aplicado} | Padrão: ${PADRAO_PES.max_perguntas}`);
    // o que o tenant não mudou fica no padrão, sem "Padrão: X"
    expect(linhas(html)['Opções por pergunta']).toBe(String(PADRAO_PES.max_opcoes_por_pergunta));
  });

  it('RN-TRE-02: Parâmetros › Treinamento › Quiz e lição mostra nota mínima 80% (o que a API aplica), com "Padrão: 70%"', async () => {
    const aplicado = rotaTreinamento(ctxApi(TENANT.treinamento)).nota_minima_pct;
    expect(aplicado).toBe(80);
    const html = render(await ambienteDoShell(TENANT), createElement(PainelQuizLicao));
    expect(html).toContain('data-testid="treinamento-quiz-licao"');
    expect(linhas(html)['Nota mínima']).toBe(`${aplicado}% | Padrão: ${PADRAO_TRE.nota_minima_pct}%`);
    expect(linhas(html)['Tentativas por dia']).toBe(String(PADRAO_TRE.tentativas_max_dia));
  });

  it('RN-CORE-02: com Pesquisa e Treinamento fora de /v1/me/modulos, os painéis mostram o padrão, sem "Padrão: X"', async () => {
    const ambiente = await ambienteDoShell({ core: TENANT.core });
    expect(linhas(render(ambiente, createElement(ParametrosConstrutor)))['Perguntas por questionário']).toBe(String(PADRAO_PES.max_perguntas));
    expect(linhas(render(ambiente, createElement(PainelQuizLicao)))['Nota mínima']).toBe(`${PADRAO_TRE.nota_minima_pct}%`);
  });

  it('RN-CAT-11: o limite da Aplicação no Catálogo é o do tenant (300), não o padrão (2.000)', async () => {
    let contador = '';
    const Sonda = () => {
      // a mesma leitura do editor do Catálogo (modules/catalogo/web/pages/catalogo-page.tsx, conferida abaixo)
      contador = contadorAplicacao(0, parametrosCatalogo(useParametros('catalogo')).aplicacao_max_cadastro).texto;
      return null;
    };
    render(await ambienteDoShell(TENANT), createElement(Sonda));
    expect(PADRAO_CAT.aplicacao_max_cadastro).toBe(2000);
    expect(contador).toBe('0 / 300');
    const pagina = readFileSync(join(RAIZ, 'modules/catalogo/web/pages/catalogo-page.tsx'), 'utf8');
    expect(pagina).toMatch(/const parametros = useParametros\('catalogo'\);\s*const limite = parametrosDoTenant\(parametros\)\.aplicacao_max_cadastro;/);
    expect(pagina).toMatch(/contadorAplicacao\([^)]*, limite\)/);
    expect(pagina).toMatch(/aplicacaoMax: limite/);
  });

  it('T-0182: o PDF do pedido no BKO sai com o nome da empresa do tenant (empresa_nome do Core)', async () => {
    const ambiente = await ambienteDoShell(TENANT);
    await exportarPdfDoPedido(PEDIDO, 'customer', { ambiente, tz: FUSO });
    expect(api.impresso).toHaveLength(1);
    expect(api.impresso[0]).toContain(TENANT.core.empresa_nome);
  });

  it('o app-shell passa os parâmetros de qk.modulos ao criarAmbienteWeb e o ambiente ao ShellProvider', () => {
    const shell = readFileSync(join(RAIZ, 'apps/web/components/app-shell.tsx'), 'utf8');
    expect(shell).toMatch(/const parametros = useParametrosDosModulos\(perfil\);/);
    expect(shell).toMatch(/criarAmbienteWeb\([\s\S]*?,\s*parametros,\s*\)/);
    expect(shell).toMatch(/<ShellProvider visao=\{[^}]*\} ambiente=\{ambiente\}>/);
  });
});

/** Pedido mínimo (o do roteiro do T-0159, um item), para o PDF. */
const PEDIDO = {
  id: '0f890000-0000-4000-8000-000000001901',
  number: '000019',
  status: 'approved',
  received_at: '2026-11-21T13:00:00.000Z',
  created_at: '2026-11-21T13:00:00.000Z',
  seller_name: 'Lucas Fictício',
  customer_name: 'Padaria Trigo Fino',
  payment_terms: '28 dias',
  discount_pct: 0,
  subtotal_cents: 25_900,
  total_cents: 25_900,
  price_table_id: null,
  price_table_name: 'Varejo',
  effective_discount_pct: 0,
  freight: { modality: 'CIF' },
  cliente: { razao_social: 'Trigo Fino Panificadora Ltda', nome_fantasia: 'Padaria Trigo Fino', documento: '23456789000195', codigo_erp: 'C5007' },
  items: [{ erp_code: 'CAF-500', description: 'Café torrado e moído 500 g', brand: 'Serra Alta', unit_label: 'FD c/ 10', quantity: 1, unit_price_cents: 25_900, discount_pct: 0, total_cents: 25_900 }],
  history: [],
} as unknown as OrderDetail;
