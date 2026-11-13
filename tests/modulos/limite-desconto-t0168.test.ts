/**
 * T-0168 v2 — limite de desconto por item e por pedido (RN-VEN-11a com RN-VEN-10, RN-VEN-11, RN-VEN-02 e RN-VEN-03): testes de
 * critério da tabela do docs/desenho/T-0168.md §3.1 (alçada 5% vendedor, 10% supervisor, 15% gerente; acima = analista) e dos 6
 * casos do R-20261113-014959-engenheiro-software (trava pelo valor EXIBIDO, frase única). Roteiro do aparelho, do BKO e do Gestão:
 * docs/testes/T-0168.md.
 *
 * Sem banco (roda local e no CI). As constraints da 0063 estão em db/testes/usuario-limite-desconto.db.test.ts (banco-dados, CI).
 *
 * ORÁCULO (texto das RNs, sem chamar a função testada):
 *   RN-VEN-02: preço unitário arredondado em centavos, meia para cima;
 *   RN-VEN-03: desconto efetivo = (tabela − final) ÷ tabela, sem frete; ≤ 0 é acréscimo;
 *   RN-VEN-10: a ALÇADA olha o valor exato; até a alçada aprova; acima vai ao nível seguinte;
 *   RN-VEN-11a: a TRAVA olha o valor EXIBIDO na linha "Desconto (%)" dos Totais, 1 casa, meia para cima (8,04% → "8,0%" não
 *               trava num limite de 8,0%; 8,05% → "8,1%" trava); acréscimo e orçamento nunca travam; com trava não há linha de
 *               alçada; a frase é "Pedido acima do desconto máximo (X%)", X = limite de quem faz o pedido (em nome: o gestor).
 */
import { describe, expect, it } from 'vitest';

import { DESCONTO_PEDIDO_PERMIL_MAX, LIMITE_DESCONTO_PADRAO, LimiteDescontoSchema, limiteDescontoCompleto, type LimiteDesconto } from '../../modules/core/contracts/usuarios';
import { UsuarioSyncSchema } from '../../modules/core/contracts/sync';
import { limiteDoPedidoEmNome } from '../../modules/gestor/domain/pedido-em-nome';
import { calcularPedido, type EntradaCalculo, type UnidadeDaTela } from '../../modules/vendedor/app/lib/novo-pedido';
import { politicaApi } from '../../modules/vendedor/app/lib/pull';
import { CODIGOS_RECUSA_PEDIDO } from '../../modules/vendedor/contracts';
import { alertasDoPedido } from '../../modules/vendedor/domain/alertas-pedido';
import { linhasDosTotais } from '../../modules/vendedor/domain/apresentacao-totais';
import { politicaDosParametros, revalidarPedido, type RevalidarEntrada, type RevalidarResultado } from '../../modules/vendedor/domain/aprovacao';
import { botoesDoResumo } from '../../modules/vendedor/domain/botoes-resumo';
import {
  CODIGO_DESCONTO_PEDIDO_ACIMA_LIMITE,
  decisaoDoDesconto,
  limiteDoUsuario,
  mensagemPedidoAcimaDoLimite,
  minimoDoItem,
  pedidoAcimaDoLimite,
  permilDoDescontoExibido,
  type TravaDesconto,
} from '../../modules/vendedor/domain/limite-desconto';
import { bloqueadoPelaAlcada, precoDoItem } from '../../modules/vendedor/domain/preco-pedido';

// ---------- oráculo ----------
type Nivel = 'supervisor' | 'gerente' | 'analista' | null;
interface Decisao { travas: TravaDesconto[]; nivel: Nivel; pode_enviar: boolean }
const L = (item: boolean, pedido: boolean, permil: number | null = null): LimiteDesconto => ({ desconto_limita_item: item, desconto_limita_pedido: pedido, desconto_maximo_pedido_permil: permil });
const PADRAO = L(true, false, null);
const POLITICA = politicaDosParametros({});
const POLITICA_BLOQUEIA = politicaDosParametros({ 'alcada.acima_gerente': 'bloquear' });
const TABELA = 10_000;
/** RN-VEN-03: % efetivo exato (a alçada usa este). */
const efetivo = (tabela: number, total: number) => ((tabela - total) * 100) / tabela;
/** RN-VEN-11a: o ‰ que a linha "Desconto (%)" mostra, 1 casa, meia para cima, em inteiros (sem float). */
function permilOraculo(tabela: number, total: number): number {
  const d = tabela - total;
  const q = Math.abs(d) * 1_000;
  let r = Math.floor(q / tabela);
  if (2 * (q - r * tabela) >= tabela) r += 1;
  return d < 0 ? -r : r;
}
/** "8,0%" a partir de ‰. */
const pctDoPermil = (permil: number) => `${Math.floor(permil / 10)},${permil % 10}%`;
const frase = (permil: number) => `Pedido acima do desconto máximo (${pctDoPermil(permil)})`;
/** O número que a TELA mostra na linha "Desconto (%)" dos Totais, lido da string e convertido em ‰ (0 sem a linha). */
function permilDaTela(tabela: number, total: number): number {
  const linha = linhasDosTotais({ subtotal_cents: tabela, total_cents: total }).find((l) => l.id === 'pct');
  if (!linha) return 0;
  const m = /(\d+),(\d)\s*%/.exec(linha.valor);
  if (!m) throw new Error(`linha "Desconto (%)" fora do formato: ${linha.valor}`);
  const v = Number(m[1]) * 10 + Number(m[2]);
  return linha.rotulo.startsWith('Acréscimo') ? -v : v;
}
/** RN-VEN-10 + RN-VEN-11a: o resultado esperado de cada caso, escrito pela regra. */
function esperado(e: { tipo?: 'pedido' | 'orcamento'; limite: LimiteDesconto; skus?: string[]; pct: number; exibido_permil: number; policy?: typeof POLITICA }): Decisao {
  if ((e.tipo ?? 'pedido') === 'orcamento') return { travas: [], nivel: null, pode_enviar: true };
  const travas: TravaDesconto[] = [];
  if (e.limite.desconto_limita_item && (e.skus ?? []).length > 0) travas.push({ codigo: 'preco_abaixo_minimo', skus: e.skus! });
  const p = e.limite.desconto_maximo_pedido_permil;
  if (e.limite.desconto_limita_pedido && p !== null && e.exibido_permil > 0 && e.exibido_permil > p) travas.push({ codigo: 'desconto_pedido_acima_limite', limite_permil: p });
  if (travas.length > 0) return { travas, nivel: null, pode_enviar: false };
  const pol = e.policy ?? POLITICA;
  // acima do gerente com `alcada.acima_gerente = bloquear` não há nível: o bloqueio é o da RN-VEN-10 (bloqueadoPelaAlcada)
  const acimaDoGerente = pol.above_manager === 'block' ? null : 'analista';
  const nivel = e.pct <= pol.seller_pct ? null : e.pct <= pol.supervisor_pct ? 'supervisor' : e.pct <= pol.manager_pct ? 'gerente' : acimaDoGerente;
  return { travas: [], nivel, pode_enviar: true };
}

// ---------- a tabela §3.1 (v2): pedido de 1 UN de R$ 100,00, final `total` ----------
interface Caso { n: string; titulo: string; tipo?: 'pedido' | 'orcamento'; limite: LimiteDesconto | null; skus?: string[]; total: number; policy?: typeof POLITICA; frase?: string }
const ITEM_ACIMA = ['BIS-400'];
const CASOS: Caso[] = [
  { n: '1', titulo: 'por item, efetivo 4% → envia sem aprovação', limite: L(true, false), total: 9_600 },
  { n: '2', titulo: 'por item, efetivo 6% → supervisor', limite: L(true, false), total: 9_400 },
  { n: '3', titulo: 'limite 8,0%, efetivo 5,00% → envia (exemplo da RN)', limite: L(true, true, 80), total: 9_500 },
  { n: '4', titulo: 'limite 8,0%, efetivo 5,01% → supervisor (exemplo)', limite: L(true, true, 80), total: 9_499 },
  { n: '5', titulo: 'limite 8,0%, efetivo 8,00% → supervisor (igual ao limite não trava)', limite: L(true, true, 80), total: 9_200 },
  { n: '5b', titulo: 'limite 8,0%, R$ 91,96 (8,04%, exibe 8,0%) → não trava, supervisor', limite: L(true, true, 80), total: 9_196 },
  { n: '6', titulo: 'limite 8,0%, R$ 91,95 (8,05%, exibe 8,1%) → trava "(8,0%)", sem alçada', limite: L(true, true, 80), total: 9_195, frase: 'Pedido acima do desconto máximo (8,0%)' },
  { n: '6b', titulo: 'limite 8,0%, R$ 91,99 (8,01%, exibe 8,0%) → não trava (v2), supervisor', limite: L(true, true, 80), total: 9_199 },
  { n: '7', titulo: 'limite 8,0%, efetivo 12% → trava (o supervisor não chega a ver)', limite: L(true, true, 80), total: 8_800 },
  { n: '8', titulo: 'limite 0,0%, acréscimo (efetivo −3%) → envia', limite: L(true, true, 0), total: 10_300 },
  { n: '9a', titulo: 'limite 0,0%, R$ 99,95 (0,05%, exibe 0,1%) → trava "(0,0%)"', limite: L(true, true, 0), total: 9_995, frase: 'Pedido acima do desconto máximo (0,0%)' },
  { n: '9b', titulo: 'limite 0,0%, R$ 99,96 (0,04%, exibe 0,0%) → envia', limite: L(true, true, 0), total: 9_996 },
  { n: '9c', titulo: 'limite 0,0%, sem desconto → envia', limite: L(true, true, 0), total: 10_000 },
  { n: '10', titulo: 'limite 3,0% abaixo da alçada, efetivo 4% → trava', limite: L(true, true, 30), total: 9_600 },
  { n: '11a', titulo: 'limite 7,5%, efetivo 7,50% → supervisor', limite: L(true, true, 75), total: 9_250 },
  { n: '11b', titulo: 'limite 7,5%, R$ 92,49 (7,51%, exibe 7,5%) → não trava (v2), supervisor', limite: L(true, true, 75), total: 9_249 },
  { n: '11c', titulo: 'limite 7,5%, R$ 92,45 (7,55%, exibe 7,6%) → trava "(7,5%)"', limite: L(true, true, 75), total: 9_245, frase: 'Pedido acima do desconto máximo (7,5%)' },
  { n: '12', titulo: 'por item, item a 30% com máximo 20%, efetivo 4% → trava preco_abaixo_minimo', limite: L(true, false), skus: ITEM_ACIMA, total: 9_600 },
  { n: '13a', titulo: 'sem as duas, o mesmo item, efetivo 4% → envia', limite: L(false, false), skus: ITEM_ACIMA, total: 9_600 },
  { n: '13b', titulo: 'sem as duas, o mesmo item, efetivo 6% → supervisor', limite: L(false, false), skus: ITEM_ACIMA, total: 9_400 },
  { n: '14', titulo: 'as duas (8,0%), item acima e efetivo 9% → duas travas, item e pedido', limite: L(true, true, 80), skus: ITEM_ACIMA, total: 9_100 },
  { n: '15', titulo: 'sem as duas, item a 30%, efetivo 12% → gerente (só a alçada)', limite: L(false, false), skus: ITEM_ACIMA, total: 8_800 },
  { n: '16', titulo: 'orçamento com item acima e efetivo 20% → salva (sem trava e sem alçada)', tipo: 'orcamento', limite: L(true, true, 80), skus: ITEM_ACIMA, total: 8_000 },
  { n: '17a', titulo: 'linha ausente (antes do 1º sync, servidor antigo), efetivo 4% → como o caso 1', limite: null, total: 9_600 },
  { n: '17b', titulo: 'linha ausente, item acima → como o caso 12', limite: null, skus: ITEM_ACIMA, total: 9_600 },
  { n: '18', titulo: 'limite 20,0%, efetivo 16% com acima_gerente = bloquear → sem trava do limite; o bloqueio é o da RN-VEN-10', limite: L(true, true, 200), total: 8_400, policy: POLITICA_BLOQUEIA },
];

describe('T-0168 — o oráculo (sem a implementação)', () => {
  it('o exemplo da RN (alçada 5%, limite 8%): até 5% aprova; acima de 5% e até "8,0%" exibido vai para aprovação; "8,1%" trava', () => {
    const r = [9_500, 9_499, 9_200, 9_196, 9_195].map((total) => {
      const d = esperado({ limite: L(true, true, 80), pct: efetivo(TABELA, total), exibido_permil: permilOraculo(TABELA, total) });
      return d.travas.length > 0 ? 'trava' : (d.nivel ?? 'aprova');
    });
    expect(r).toEqual(['aprova', 'supervisor', 'supervisor', 'supervisor', 'trava']);
  });

  it('RN-VEN-03 × exibido: R$ 91,96 = 8,04% → 80 ‰ ("8,0%"); R$ 91,95 = 8,05% → 81 ‰ ("8,1%"); R$ 103,00 → −30 ‰', () => {
    expect(efetivo(TABELA, 9_196)).toBeCloseTo(8.04, 10);
    expect([9_196, 9_195, 9_199, 9_996, 9_995, 10_300].map((t) => permilOraculo(TABELA, t))).toEqual([80, 81, 80, 0, 1, -30]);
  });

  it('a frase mostra o limite com 1 casa: 80 ‰ = "8,0%", 75 = "7,5%", 0 = "0,0%", 1000 = "100,0%"', () => {
    expect([80, 75, 0, 1_000].map(pctDoPermil)).toEqual(['8,0%', '7,5%', '0,0%', '100,0%']);
  });
});

// =====================================================================================================================
describe('T-0168 D — decisaoDoDesconto: os casos da §3.1 v2 (RN-VEN-11a × RN-VEN-10 × RN-VEN-11)', () => {
  for (const c of CASOS) {
    it(`caso ${c.n}: ${c.titulo}`, () => {
      const limite = limiteDoUsuario(c.limite);
      const pct = efetivo(TABELA, c.total);
      const exibido = permilDoDescontoExibido({ total_tabela_cents: TABELA, total_cents: c.total });
      // valor × regra: o ‰ da trava é o número da linha "Desconto (%)" dos Totais e o do oráculo
      expect(exibido).toBe(permilOraculo(TABELA, c.total));
      expect(exibido).toBe(permilDaTela(TABELA, c.total));
      const r = decisaoDoDesconto({ tipo: c.tipo ?? 'pedido', limite, skus_acima_do_maximo: c.skus ?? [], desconto_efetivo_alcada_pct: pct, desconto_exibido_permil: exibido, policy: c.policy ?? POLITICA, vendedor_id: 'v' });
      const e = esperado({ tipo: c.tipo ?? 'pedido', limite: c.limite ?? PADRAO, skus: c.skus ?? [], pct, exibido_permil: permilOraculo(TABELA, c.total), ...(c.policy ? { policy: c.policy } : {}) });
      // caso 18: o "pode enviar" do bloqueio fica com o validateOrder de hoje; aqui só travas e nível
      if (c.n === '18') expect({ travas: r.travas, nivel: r.nivel }).toEqual({ travas: e.travas, nivel: e.nivel });
      else expect(r).toEqual(e);
      if (c.frase) expect(mensagemPedidoAcimaDoLimite(c.limite!.desconto_maximo_pedido_permil!)).toBe(c.frase);
    });
  }

  it('caso 18: o limite não afrouxa a alçada — 16% passa do gerente (15%) e o bloqueio da RN-VEN-10 continua', () => {
    expect(bloqueadoPelaAlcada(16, POLITICA_BLOQUEIA, 'v')).toBe(true);
    expect(pedidoAcimaDoLimite(160, L(true, true, 200))).toBe(false);
  });

  it('caso 14: a ordem das travas é item e depois pedido', () => {
    const r = decisaoDoDesconto({ tipo: 'pedido', limite: L(true, true, 80), skus_acima_do_maximo: ITEM_ACIMA, desconto_efetivo_alcada_pct: 9, desconto_exibido_permil: 90, policy: POLITICA, vendedor_id: 'v' });
    expect(r.travas.map((t) => t.codigo)).toEqual(['preco_abaixo_minimo', 'desconto_pedido_acima_limite']);
  });

  it('caso 17: limiteDoUsuario completa o que falta com o padrão; "por pedido" sem número fica desligada', () => {
    for (const u of [null, undefined, {}]) expect(limiteDoUsuario(u)).toEqual(PADRAO);
    expect(limiteDoUsuario({ desconto_limita_item: false })).toEqual(L(false, false, null));
    expect(limiteDoUsuario({ desconto_limita_pedido: true, desconto_maximo_pedido_permil: null }).desconto_limita_pedido).toBe(false);
    expect(limiteDoUsuario({ desconto_limita_pedido: true, desconto_maximo_pedido_permil: 80 })).toEqual(L(true, true, 80));
    // desligar "por pedido" mantém o número (religar devolve), e o número sozinho não trava
    expect(pedidoAcimaDoLimite(500, limiteDoUsuario({ desconto_limita_pedido: false, desconto_maximo_pedido_permil: 80 }))).toBe(false);
  });

  it('RN-VEN-11 desligada ("por item" = não): o item não tem mínimo; ligada: o mínimo do produto de hoje', () => {
    expect(minimoDoItem(800, L(true, false))).toBe(800);
    expect(minimoDoItem(800, L(false, false))).toBeNull();
    expect(minimoDoItem(null, L(true, false))).toBeNull();
  });

  it('a trava compara ‰ inteiros: 80 não trava num limite de 80, 81 trava; ≤ 0 (acréscimo) nunca trava, nem com limite 0', () => {
    expect(pedidoAcimaDoLimite(80, L(true, true, 80))).toBe(false);
    expect(pedidoAcimaDoLimite(81, L(true, true, 80))).toBe(true);
    expect(pedidoAcimaDoLimite(0, L(true, true, 0))).toBe(false);
    expect(pedidoAcimaDoLimite(-30, L(true, true, 0))).toBe(false);
  });

  it('código da recusa: desconto_pedido_acima_limite, no contrato do Vendedor', () => {
    expect(CODIGO_DESCONTO_PEDIDO_ACIMA_LIMITE).toBe('desconto_pedido_acima_limite');
    expect(CODIGOS_RECUSA_PEDIDO).toContain('desconto_pedido_acima_limite');
  });
});

// =====================================================================================================================
describe('T-0168 C — contratos do Core (§2.1 a §2.3): padrão, faixa e "por pedido" com número', () => {
  it('critério 3: o padrão é "por item" ligada e "por pedido" desligada, sem número', () => {
    expect(LIMITE_DESCONTO_PADRAO).toEqual(PADRAO);
    expect(DESCONTO_PEDIDO_PERMIL_MAX).toBe(1_000);
  });

  it('faixa de 0 a 1000 ‰ (0,0% a 100,0%), inteiro; "por pedido" ligada exige o número', () => {
    const ok = (permil: unknown) => LimiteDescontoSchema.safeParse({ ...L(true, true, 0), desconto_maximo_pedido_permil: permil }).success;
    expect([0, 80, 1_000, null].map(ok)).toEqual([true, true, true, true]);
    expect([-1, 1_001, 7.5, '80'].map(ok)).toEqual([false, false, false, false]);
    expect(limiteDescontoCompleto(L(true, true, null))).toBe(false);
    expect(limiteDescontoCompleto(L(true, true, 80))).toBe(true);
    expect(limiteDescontoCompleto(L(true, false, null))).toBe(true);
  });

  it('critério 6 / caso 17: a linha do sync sem os campos (servidor antigo) vira o padrão', () => {
    const base = { id: '11111111-1111-4111-8111-111111111111', tenant_id: '22222222-2222-4222-8222-222222222222', created_at: '2026-11-12T12:00:00.000Z', updated_at: '2026-11-12T12:00:00.000Z', deleted_at: null, external_id: null };
    const r = UsuarioSyncSchema.safeParse(base);
    if (r.success) expect(r.data).toMatchObject(PADRAO);
    else expect.fail('UsuarioSyncSchema recusou a linha sem os campos (o padrão do desenho §2.3 é .default)');
  });
});

// =====================================================================================================================
// Pedido de distribuidora: a API (revalidarPedido) e o app offline (calcularPedido → Alertas → botões) com a mesma entrada.
type Ajuste = { desconto_pct: number } | { em: 'valor'; desconto_cents: number } | { acrescimo_pct: number };
interface Pedido { itens: Array<{ id: string; preco: number; qtd: number; ajuste?: Ajuste }>; desconto_pct?: number }
const umItem = (preco: number, ajuste?: Ajuste): Pedido => ({ itens: [{ id: 'a', preco, qtd: 1, ...(ajuste ? { ajuste } : {}) }] });
const emReais = (cents: number): Ajuste => ({ em: 'valor', desconto_cents: cents });

type Recusa = Extract<RevalidarResultado, { ok: false }>;
function api(p: Pedido, extra: Partial<RevalidarEntrada> & { limite?: Partial<LimiteDesconto> | null }): RevalidarResultado {
  return revalidarPedido({
    perfil: 'vendedor', vendedor_id: 'v', cliente_id: 'c1', carteira: ['c1'], desconto_pct: p.desconto_pct ?? 0, tipo: 'pedido',
    itens: p.itens.map((i) => {
      const a = i.ajuste;
      return {
        product_id: i.id, sku: i.id.toUpperCase(), quantity: i.qtd, unidade: null, fator: 1,
        ...(a && 'em' in a ? { desconto_unitario_cents: a.desconto_cents } : {}),
        ...(a && 'desconto_pct' in a ? { desconto_pct: a.desconto_pct } : {}),
        ...(a && 'acrescimo_pct' in a ? { acrescimo_pct: a.acrescimo_pct } : {}),
      };
    }),
    precos: Object.fromEntries(p.itens.map((i) => [i.id, i.preco])),
    policy: POLITICA,
    ...extra,
  });
}
const PRODUTO = (id: string, preco: number) =>
  ({ id, erp_code: id.toUpperCase(), description: `Produto ${id}`, unit: 'UN', price_cents: preco, stock_total: 1_000_000, stock: [], brand: '', line: '', ean: null, active: true, external_id: null, applications: '', is_campaign: false }) as EntradaCalculo['catalogo'][number];
const UNIDADES: UnidadeDaTela[] = [];
function app(p: Pedido, limite: Partial<LimiteDesconto> | null) {
  const c = calcularPedido({
    lines: Object.fromEntries(p.itens.map((i) => [i.id, i.qtd])),
    ajustes: Object.fromEntries(p.itens.filter((i) => i.ajuste).map((i) => [i.id, i.ajuste!])) as EntradaCalculo['ajustes'],
    desconto_pct: p.desconto_pct ?? 0, acrescimo_pct: 0,
    catalogo: p.itens.map((i) => PRODUTO(i.id, i.preco)), unidades: UNIDADES, politica: politicaApi({}), vendedor_id: 'v', limite,
  });
  const LIBERADO = { ativo: true, bloqueado: false, cadastro_incompleto: false, campos_faltantes: [] as string[] };
  const acimaDaAlcada = c.nivel !== null && !c.bloqueado;
  const alertas = alertasDoPedido({ cliente: LIBERADO, acima_do_limite: c.acima_do_limite, acima_da_alcada: acimaDaAlcada });
  const botoes = botoesDoResumo({ cliente: LIBERADO, pre_venda_ligada: true, editando: null, pendencias: 0, acima_do_limite: c.acima_do_limite !== null, preco_data: '2026-11-13' });
  const transformar = botoesDoResumo({ cliente: LIBERADO, pre_venda_ligada: true, editando: 'orcamento', pendencias: 0, acima_do_limite: c.acima_do_limite !== null, preco_data: '2026-11-13' });
  return { c, alertas, botoes, transformar, tela_permil: permilDaTela(c.total_tabela_cents, c.total_cents) };
}
const LIM80 = L(true, true, 80);

describe('T-0168 v2 — os 6 casos do R-20261113-014959 (app offline × API, valor exibido × trava)', () => {
  it('1. tabela R$ 100,00, total R$ 91,96 (Totais "8,0%"): não trava e vai ao supervisor, no app e na API', () => {
    const p = umItem(10_000, emReais(804));
    const a = app(p, LIM80);
    expect(a.c.total_cents).toBe(9_196);
    expect(a.tela_permil).toBe(80);
    expect(a.c.acima_do_limite).toBeNull();
    expect(a.c.nivel).toBe('supervisor');
    expect(a.alertas.map((x) => x.texto)).toEqual(['Desconto acima da sua alçada']);
    expect(a.botoes.enviar).toMatchObject({ visivel: true, habilitado: true });
    expect(api(p, { limite: LIM80 })).toMatchObject({ ok: true, status: 'pending_approval', total_cents: 9_196 });
  });

  it('2. total R$ 91,95 (Totais "8,1%"): trava, só "Salvar como orçamento", uma linha nos Alertas e nenhuma de alçada', () => {
    const p = umItem(10_000, emReais(805));
    const a = app(p, LIM80);
    expect(a.c.total_cents).toBe(9_195);
    expect(a.tela_permil).toBe(81);
    expect(a.c.acima_do_limite).toBe(80);
    expect(a.c.nivel).toBeNull();
    expect(a.alertas.map((x) => x.texto)).toEqual([frase(80)]);
    expect(a.alertas[0]).toMatchObject({ tipo: 'limite_pedido', so_orcamento: true });
    expect(a.botoes.enviar.habilitado).toBe(false);
    expect(a.botoes.principal).toBe('orcamento');
    expect(a.botoes.orcamento).toMatchObject({ visivel: true, habilitado: true });
    expect(api(p, { limite: LIM80 })).toMatchObject({ ok: false, codigo: 'desconto_pedido_acima_limite', http: 422, mensagem: frase(80) });
  });

  it('3. 1 item de R$ 10,00 com 8,05% no item: a linha fecha em R$ 9,20 (RN-VEN-02, meia para cima), a tela mostra "8,0%" e não trava', () => {
    // oráculo RN-VEN-02: 1000 × (1 − 0,0805) = 919,5 → meia para cima = 920
    expect(precoDoItem({ preco_tabela_unidade_cents: 1_000, quantidade: 1, fator: 1, desconto_pct: 8.05, acrescimo_pct: 0 }).preco_unitario_cents).toBe(920);
    const p = umItem(1_000, { desconto_pct: 8.05 });
    const a = app(p, LIM80);
    expect(a.c.total_cents).toBe(920);
    expect(a.tela_permil).toBe(80);
    // a tela e a trava nunca discordam
    expect(a.c.acima_do_limite !== null).toBe(a.tela_permil > 80);
    expect(a.c.acima_do_limite).toBeNull();
    expect(a.c.nivel).toBe('supervisor'); // a alçada segue o valor exato (8,05% > 5%)
    expect(api(p, { limite: LIM80 })).toMatchObject({ ok: true, status: 'pending_approval', total_cents: 920 });
    // o vizinho: R$ 9,19 (8,1%) trava nos dois
    const q = umItem(1_000, emReais(81));
    expect(app(q, LIM80).c.acima_do_limite).toBe(80);
    expect(api(q, { limite: LIM80 })).toMatchObject({ ok: false, codigo: 'desconto_pedido_acima_limite' });
  });

  it('4. limite 0,0% com desconto que exibe "0,0%" (R$ 99,96, 0,04%): envia sem alçada; "0,1%" (R$ 99,95) trava', () => {
    const p = umItem(10_000, emReais(4));
    const a = app(p, L(true, true, 0));
    expect(a.tela_permil).toBe(0);
    expect(a.c.acima_do_limite).toBeNull();
    expect(a.c.nivel).toBeNull();
    expect(a.botoes.enviar.habilitado).toBe(true);
    expect(api(p, { limite: L(true, true, 0) })).toMatchObject({ ok: true, status: 'approved' });
    const q = umItem(10_000, emReais(5));
    expect(app(q, L(true, true, 0)).c.acima_do_limite).toBe(0);
    expect(api(q, { limite: L(true, true, 0) })).toMatchObject({ ok: false, codigo: 'desconto_pedido_acima_limite', mensagem: frase(0) });
  });

  describe('5. a mesma decisão no app offline e na API (envio, correção e Transformar)', () => {
    const decideIgual = (p: Pedido, limite: LimiteDesconto) => {
      const a = app(p, limite);
      const r = api(p, { limite });
      const travaApp = a.c.acima_do_limite !== null;
      const travaApi = !r.ok && (r as Recusa).codigo === 'desconto_pedido_acima_limite';
      const p0 = limite.desconto_maximo_pedido_permil ?? Infinity;
      const travaTela = limite.desconto_limita_pedido && a.tela_permil > 0 && a.tela_permil > p0;
      return { travaApp, travaApi, travaTela, tela: a.tela_permil, total_app: a.c.total_cents, total_api: r.ok ? r.total_cents : null };
    };

    it('R$ de desconto no item de R$ 100,00, de R$ 0,00 a R$ 12,00 centavo a centavo: app = API = tela', () => {
      const divergentes: string[] = [];
      for (let d = 0; d <= 1_200; d += 1) {
        const x = decideIgual(umItem(10_000, emReais(d)), LIM80);
        if (!(x.travaApp === x.travaApi && x.travaApp === x.travaTela)) divergentes.push(`R$ ${d}c: app ${x.travaApp} api ${x.travaApi} tela ${x.tela}`);
      }
      expect(divergentes).toEqual([]);
    });

    it('% no item (R$ 10,00 e 3 × R$ 33,33) e % no pedido (rateio pelo maior resto), de 7,90% a 8,20%: app = API = tela', () => {
      const divergentes: string[] = [];
      for (let k = 790; k <= 820; k += 1) {
        const pct = k / 100;
        const pedidos: Array<[string, Pedido]> = [
          [`item R$ 10,00 a ${pct}%`, umItem(1_000, { desconto_pct: pct })],
          [`item 3 × R$ 33,33 a ${pct}%`, { itens: [{ id: 'a', preco: 3_333, qtd: 3, ajuste: { desconto_pct: pct } }] }],
          [`pedido ${pct}% sobre R$ 10,00 + 3 × R$ 33,33`, { itens: [{ id: 'a', preco: 1_000, qtd: 1 }, { id: 'b', preco: 3_333, qtd: 3 }], desconto_pct: pct }],
        ];
        for (const [nome, p] of pedidos) {
          const x = decideIgual(p, LIM80);
          if (!(x.travaApp === x.travaApi && x.travaApp === x.travaTela) || (x.total_api !== null && x.total_api !== x.total_app)) divergentes.push(`${nome}: app ${x.travaApp} api ${x.travaApi} tela ${x.tela} total ${x.total_app}/${x.total_api}`);
        }
      }
      expect(divergentes).toEqual([]);
    });

    it('correção (reenvio do pedido recusado com o mesmo conteúdo) recusa igual; corrigido para "8,0%", passa', () => {
      const p = umItem(10_000, emReais(805));
      expect(api(p, { limite: LIM80 })).toEqual(api(p, { limite: LIM80 }));
      expect(api(umItem(10_000, emReais(804)), { limite: LIM80 })).toMatchObject({ ok: true, status: 'pending_approval' });
    });

    it('Transformar orçamento de 9%: o orçamento salva; o pedido que nasce dele trava no app (botão desligado) e na API (422)', () => {
      const p = umItem(10_000, { desconto_pct: 9 });
      expect(api(p, { limite: LIM80, tipo: 'orcamento' }).ok).toBe(true);
      const a = app(p, LIM80);
      expect(a.transformar).toMatchObject({ visivel: true, habilitado: false });
      expect(a.transformar.habilitado).toBe(false);
      expect(api(p, { limite: LIM80, tipo: 'pedido' })).toMatchObject({ ok: false, codigo: 'desconto_pedido_acima_limite', http: 422, mensagem: frase(80) });
    });

    it('caso 17: sem `limite` (servidor/APK antigo) vale o padrão nos dois — 9% vai ao supervisor, sem trava', () => {
      const p = umItem(10_000, { desconto_pct: 9 });
      expect(app(p, null).c).toMatchObject({ acima_do_limite: null, nivel: 'supervisor' });
      expect(api(p, {})).toMatchObject({ ok: true, status: 'pending_approval' });
    });

    it('caso 8: acréscimo nunca trava, nem com limite 0,0%, nos dois', () => {
      const p = umItem(10_000, { acrescimo_pct: 3 });
      expect(app(p, L(true, true, 0)).c.acima_do_limite).toBeNull();
      expect(api(p, { limite: L(true, true, 0) }).ok).toBe(true);
    });
  });

  describe('6. valor × regra: o "(X%)" da frase é o limite do autor; em nome, o do gestor', () => {
    const GESTOR = '44444444-4444-4444-8444-444444444444';
    const VENDEDOR = '55555555-5555-4555-8555-555555555555';
    const ctx = { autor_id: GESTOR, vendedor_id: VENDEDOR };

    it('a frase única do domain, dos Alertas do app e da API é a mesma, com o limite do autor (sem "do vendedor"/"do gestor")', () => {
      for (const permil of [0, 30, 75, 80, 1_000]) {
        expect(mensagemPedidoAcimaDoLimite(permil)).toBe(frase(permil));
        expect(alertasDoPedido({ cliente: { ativo: true, bloqueado: false, cadastro_incompleto: false, campos_faltantes: [] }, acima_do_limite: permil }).map((x) => x.texto)).toEqual([frase(permil)]);
      }
      const p = umItem(10_000, { desconto_pct: 9 });
      expect(api(p, { limite: L(true, true, 75) })).toMatchObject({ mensagem: 'Pedido acima do desconto máximo (7,5%)' });
    });

    it('caso 19: gestor com 8,0%, vendedor com 3,0%, em nome a 9%: o limite é o do gestor e a frase diz "(8,0%)"', () => {
      const limites = new Map<string, Partial<LimiteDesconto>>([[GESTOR, L(true, true, 80)], [VENDEDOR, L(true, true, 30)]]);
      const l = limiteDoPedidoEmNome(ctx, limites);
      expect(l).toEqual(L(true, true, 80));
      const r = api(umItem(10_000, { desconto_pct: 9 }), { perfil: 'supervisor', em_nome: true, limite: l });
      expect(r).toMatchObject({ ok: false, codigo: 'desconto_pedido_acima_limite', http: 422, mensagem: frase(80) });
      expect(app(umItem(10_000, { desconto_pct: 9 }), l).alertas.map((x) => x.texto)).toEqual([frase(80)]);
    });

    it('caso 19b: gestor com 8,0% e em nome a "8,0%" exibido (R$ 91,96): não trava, mesmo com o vendedor em 3,0%', () => {
      const l = limiteDoPedidoEmNome(ctx, new Map([[GESTOR, L(true, true, 80)], [VENDEDOR, L(true, true, 30)]]));
      expect(api(umItem(10_000, emReais(804)), { perfil: 'supervisor', em_nome: true, limite: l }).ok).toBe(true);
    });

    it('caso 20: gestor sem "por pedido", vendedor com 3,0%, em nome a 6%: o do vendedor não vale, envia', () => {
      const l = limiteDoPedidoEmNome(ctx, new Map([[GESTOR, L(true, false, null)], [VENDEDOR, L(true, true, 30)]]));
      expect(l).toEqual(L(true, false, null));
      expect(api(umItem(10_000, { desconto_pct: 6 }), { perfil: 'supervisor', em_nome: true, limite: l }).ok).toBe(true);
    });

    it('gestor sem linha (antes do 1º sync): vale o padrão, nunca o limite do vendedor', () => {
      expect(limiteDoPedidoEmNome(ctx, new Map([[VENDEDOR, L(true, true, 30)]]))).toEqual(LIMITE_DESCONTO_PADRAO);
    });
  });
});
