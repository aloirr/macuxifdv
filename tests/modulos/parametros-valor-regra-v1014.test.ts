/**
 * v1.0.14 — Parâmetros do BKO (ADR 0060): valor × regra e rótulo × valor dos painéis só leitura de Trade, Pesquisa e
 * Treinamento (decisão do dono do produto de 08/11/2026, R-20261108-135639: o número da tela é o que a regra usa).
 * - O esperado sai do domain/contrato do módulo (o mesmo que a API e o app aplicam), nunca de uma cópia do número.
 * - "Padrão: X" só aparece quando o valor do tenant difere do padrão (spec docs/design/menu-parametros/spec.md, P4).
 * Convenção: `it` = vale hoje; `it.fails` = defeito aberto (o caso diz o que falta; quando corrigir, fica vermelho e vira `it`).
 * Sem banco. O e2e da tela (testids, cadeado, links antigos) está em tests/e2e/bko/menu-parametros.spec.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PARAMETROS_PADRAO as PADRAO_PRO, parametrosDosBrutos as brutosPromotor, type ParametrosPromotor } from '../../modules/promotor/domain/parametros';
import { PARAMETROS_PADRAO as PADRAO_PES } from '../../modules/pesquisa/domain/parametros';
import { parametrosDaRota as rotaPesquisa } from '../../modules/pesquisa/api/comum';
import { PARAMETROS_PADRAO as PADRAO_TRE, type ParametrosTreinamento } from '../../modules/treinamento/domain/parametros';
import { parametrosDoTenant as rotaTreinamento } from '../../modules/treinamento/api/comum';

const RAIZ = join(__dirname, '..', '..');
const FUSO = 'America/Manaus';
const ctxDe = (brutos: Record<string, unknown>) => ({ parametros: () => brutos, fuso: () => FUSO, log: { warn: () => undefined } }) as never;

// --------------------------------------------------------------------------------------------- Trade (Promotor)

const TRADE = 'modules/promotor/web/lib/parametros-trade.ts';
type PainelTrade = 'validade' | 'visita-coleta' | 'gondola';
interface LibTrade {
  camposDoPainel(painel: PainelTrade, atual: ParametrosPromotor): { chave: keyof ParametrosPromotor; rotulo: string; valor: string; padrao?: string }[];
}
/** Títulos dos painéis declarados em `modules/promotor/web/index.ts` (#415); o rótulo do campo tem de caber no título. */
const PAINEIS_TRADE: readonly [PainelTrade, string][] = [
  ['validade', 'Validade'],
  ['visita-coleta', 'Visita e coleta'],
  ['gondola', 'Gôndola'],
];

describe('Parâmetros › Trade (RN-PRO-04/07/08/11): valor × regra', () => {
  const carregar = async () => (await import(join(RAIZ, TRADE))) as LibTrade;
  const campos = async (p: ParametrosPromotor) => {
    const lib = await carregar();
    return PAINEIS_TRADE.flatMap(([id, titulo]) => lib.camposDoPainel(id, p).map((c) => ({ painel: titulo, ...c })));
  };

  it('os títulos dos painéis são os declarados no shell do Promotor', () => {
    const web = readFileSync(join(RAIZ, 'modules/promotor/web/index.ts'), 'utf8');
    for (const [id, titulo] of PAINEIS_TRADE) expect(web, id).toMatch(new RegExp(`id: '${id}', secao: 'trade', titulo: '${titulo}'`));
  });

  it('padrão do tenant: os 5 valores do domain, nos 3 painéis, sem "Padrão: X"', async () => {
    const lista = await campos(PADRAO_PRO);
    expect(lista.map((c) => [c.painel, c.rotulo, c.valor])).toEqual([
      ['Validade', 'Crítica até', `${PADRAO_PRO.validade_critica_dias} dias`],
      ['Validade', 'Em atenção até', `${PADRAO_PRO.validade_proxima_dias} dias`],
      ['Visita e coleta', 'Permanência mínima', `${PADRAO_PRO.permanencia_min_min} min`],
      ['Visita e coleta', 'Variação de preço sem confirmar', `${PADRAO_PRO.variacao_preco_max_pct}%`],
      ['Gôndola', 'Peso do parcial na conformidade', `${PADRAO_PRO.peso_parcial_conformidade * 100}%`],
    ]);
    expect(lista.filter((c) => c.padrao)).toEqual([]);
  });

  it('tenant mudou: mostra o valor que a API aplica (parametrosDosBrutos) e "Padrão: X" só no que mudou', async () => {
    const brutos = { validade_proxima_dias: '45', peso_parcial_conformidade: 0.5, permanencia_min_min: 1 };
    const aplicado = brutosPromotor(brutos);
    const lista = await campos(aplicado);
    const por = Object.fromEntries(lista.map((c) => [c.chave, c]));
    expect(por.validade_proxima_dias).toMatchObject({ valor: '45 dias', padrao: 'Padrão: 30 dias' });
    // RN-PRO-11: o peso vai de 0 a 1; 0,5 = metade do parcial vale conforme
    expect(por.peso_parcial_conformidade).toMatchObject({ valor: '50%', padrao: 'Padrão: 0%' });
    // singular/plural e unidade no valor (rótulo × valor: "1 min", não "1")
    expect(por.permanencia_min_min).toMatchObject({ valor: '1 min', padrao: 'Padrão: 10 min' });
    expect(por.validade_critica_dias?.padrao).toBeUndefined();
  });

  it('conjunto inválido no tenant (crítico > atenção, RN-PRO-08): a tela mostra o padrão que a API aplica', async () => {
    const aplicado = brutosPromotor({ validade_critica_dias: 40, validade_proxima_dias: 30 });
    expect(aplicado).toEqual(PADRAO_PRO);
    expect((await campos(aplicado)).filter((c) => c.padrao)).toEqual([]);
  });
});

// --------------------------------------------------------------------------------------------- Pesquisa

const PESQUISA = 'modules/pesquisa/web/lib/parametros-valor.ts';
interface LibPesquisa {
  parametrosEmUso(brutos: Readonly<Record<string, unknown>>): typeof PADRAO_PES;
  valorDoParametro(brutos: Readonly<Record<string, unknown>>, chave: keyof typeof PADRAO_PES, formatar?: (v: number) => string): { valor: string; padrao: string | null };
}
const NUMERICOS_PES = ['tolerancia_vigencia_h', 'max_perguntas', 'max_opcoes_por_pergunta', 'max_fotos_por_pergunta', 'texto_max_caracteres', 'foto_max_lado_px', 'foto_jpeg_qualidade', 'escala_amplitude_max'] as const;

describe('Parâmetros › Pesquisa (RN-PES-04/06/07): valor × regra', () => {
  const carregar = async () => (await import(join(RAIZ, PESQUISA))) as LibPesquisa;

  it('padrão: o valor do contrato, sem "Padrão: X"; milhar pt-BR (2.000 caracteres)', async () => {
    const { valorDoParametro } = await carregar();
    for (const k of NUMERICOS_PES) expect(valorDoParametro({}, k), k).toMatchObject({ padrao: null });
    expect(valorDoParametro({}, 'texto_max_caracteres').valor).toBe('2.000');
    expect(valorDoParametro({}, 'tolerancia_vigencia_h').valor).toBe(String(PADRAO_PES.tolerancia_vigencia_h));
  });

  it('tenant mudou (válido): a tela mostra o mesmo valor que a rota da API usa (parametrosDaRota)', async () => {
    const { valorDoParametro } = await carregar();
    const brutos = { max_perguntas: 30, tolerancia_vigencia_h: 48, sync_auto_min: 15 };
    const api = rotaPesquisa(ctxDe(brutos));
    for (const k of NUMERICOS_PES) expect(valorDoParametro(brutos, k, String).valor, k).toBe(String(api[k]));
    expect(valorDoParametro(brutos, 'max_perguntas')).toEqual({ valor: '30', padrao: 'Padrão: 50' });
  });

  it('tenant com valor inválido: a tela e a API caem no padrão juntas', async () => {
    const { valorDoParametro } = await carregar();
    const brutos = { max_perguntas: 0, foto_jpeg_qualidade: 90 };
    const api = rotaPesquisa(ctxDe(brutos));
    for (const k of NUMERICOS_PES) expect(valorDoParametro(brutos, k, String).valor, k).toBe(String(api[k]));
  });

  // D-PAR-03 (modulo-pesquisa, baixa): a API troca o `fuso` do parâmetro pelo do tenant (RN-CORE-11) antes de validar; a
  // tela valida o `fuso` bruto. Fuso inválido no cadastro faz a tela mostrar o padrão de TODOS os limites, enquanto a API
  // aplica os limites do tenant. Corrige quando `parametrosEmUso` ignorar o `fuso` (não é exibido) ao validar.
  it.fails('D-PAR-03: fuso inválido no cadastro não muda os limites exibidos (a API usa max_perguntas 30)', async () => {
    const { valorDoParametro } = await carregar();
    const brutos = { max_perguntas: 30, fuso: 'Fuso/Inexistente' };
    expect(rotaPesquisa(ctxDe(brutos)).max_perguntas).toBe(30);
    expect(valorDoParametro(brutos, 'max_perguntas').valor).toBe('30');
  });
});

// --------------------------------------------------------------------------------------------- Treinamento

const TREINAMENTO = 'modules/treinamento/web/lib/parametros-valor.ts';
interface LibTreinamento {
  valorParametro<K extends keyof ParametrosTreinamento>(p: Readonly<Record<string, unknown>>, chave: K): ParametrosTreinamento[K];
}
const CHAVES_TRE = (Object.keys(PADRAO_TRE) as (keyof ParametrosTreinamento)[]).filter((k) => k !== 'fuso');

describe('Parâmetros › Treinamento (RN-TRE): valor × regra', () => {
  const carregar = async () => (await import(join(RAIZ, TREINAMENTO))) as LibTreinamento;
  const exibido = async (brutos: Record<string, unknown>) => {
    const { valorParametro } = await carregar();
    return Object.fromEntries(CHAVES_TRE.map((k) => [k, valorParametro(brutos, k)]));
  };
  const aplicado = (brutos: Record<string, unknown>) => {
    const api = rotaTreinamento(ctxDe(brutos));
    return Object.fromEntries(CHAVES_TRE.map((k) => [k, api[k]]));
  };

  it('padrão e tenant válido: a tela mostra o mesmo valor que a rota da API usa (parametrosDoTenant)', async () => {
    expect(await exibido({})).toEqual(aplicado({}));
    const valido = { nota_minima_pct: 80, xp_licao: 15, nota_que_vale: 'ultima', streak_medalha_dias: 5 };
    expect(await exibido(valido)).toEqual(aplicado(valido));
  });

  // D-PAR-02 (modulo-treinamento, média): a API (parametrosDoTenant) e o app (parametrosDoAparelho) validam o conjunto e,
  // com UM valor inválido, aplicam o padrão em TODOS; o painel do BKO confere só o tipo, chave a chave. Com nota mínima
  // 80% e um XP negativo no cadastro, o BKO mostra "Nota mínima 80% (Padrão: 70%)", mas a regra usa 70%.
  // Corrige quando o painel usar a mesma resolução da API (ParametrosTreinamentoSchema.safeParse + resolverParametros).
  it.fails('D-PAR-02: tenant com um valor inválido — a tela mostra o que a regra aplica (nota mínima 70%, não 80%)', async () => {
    const invalido = { nota_minima_pct: 80, xp_licao: -1 };
    expect(aplicado(invalido).nota_minima_pct).toBe(PADRAO_TRE.nota_minima_pct);
    expect(await exibido(invalido)).toEqual(aplicado(invalido));
  });

  it.fails('D-PAR-02: valor fora da faixa (nota mínima 150%) não aparece como valor em uso', async () => {
    const invalido = { nota_minima_pct: 150 };
    expect((await exibido(invalido)).nota_minima_pct).toBe(aplicado(invalido).nota_minima_pct);
  });
});
