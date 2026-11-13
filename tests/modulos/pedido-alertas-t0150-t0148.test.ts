/**
 * T-0150 / T-0148 — critérios das telas novas do pedido (RN-VEN-42, RN-VEN-20, RN-VEN-11, RN-VEN-12, RN-VEN-13, RN-CORE-36), sem banco.
 * Os números iguais no Resumo em tabela, no detalhe e no PDF ficam em tests/modulos/pedido-numeros-t0151.test.ts (bloco T-0150).
 *
 * Aqui:
 *   - área Alertas com os tipos da RN-VEN-42 (desconto acima do máximo, falta preencher, recusa, sem estoque, crédito/título vencido),
 *     cada um numa linha curta, sem alçada;
 *   - com alerta que bloqueia o envio, só "Salvar como orçamento" e "Apenas salvar" (premissa (e) da RN-VEN-42), também na folha de saída;
 *   - situação só no Histórico (sem selo no topo do detalhe; a lista de Pedidos mantém o selo);
 *   - aba Itens com popup: 30 itens sem recalcular a cada toque (só ao confirmar o popup).
 * O ORÁCULO é o texto das RNs; as funções testadas são as que as telas chamam.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tagsDoHistorico } from '@macuxi/ui/mobile/puro';
import { describe, expect, it } from 'vitest';

import { alertasDoPedido, impedeEnviarPorAlertas, soOrcamentoPorAlertas, textoDoMaximo, vencidosComEfeito, type AlertaDoPedido } from '../../modules/vendedor/domain/alertas-pedido';
import { TITULO_VENCIDO_DIAS_PADRAO, tituloVencidoDias } from '../../modules/vendedor/domain/pagamento';
import { botoesDoResumo, ROTULOS_DO_SALVAR, type BotoesDoResumo, type EntradaDosBotoes } from '../../modules/vendedor/domain/botoes-resumo';
import { eventosDoPedido } from '../../modules/vendedor/domain/historico-pedido';
import { opcoesDaSaida } from '../../modules/vendedor/domain/sair-do-pedido';
import { entradaDasPendencias, itensSemEstoque, textoDaFalta } from '../../modules/vendedor/app/lib/alertas-novo-pedido';
import { acoesDoDetalhe, alertasDoDetalhe, type EntradaAcoesDoDetalhe } from '../../modules/vendedor/app/lib/detalhe-pedido';
import * as itemPopup from '../../modules/vendedor/app/lib/item-popup';
import { aplicarItemNoRascunho, alertasDoItemNoPopup, estadoInicialDoItem } from '../../modules/vendedor/app/lib/item-popup';
import { chaveDaLinha, type UnidadeDaTela } from '../../modules/vendedor/app/lib/novo-pedido';
import { prepararPedido, rascunhoVazio } from '../../modules/vendedor/app/lib/pedidos';
import { politicaApi } from '../../modules/vendedor/app/lib/pull';

const ler = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');
const LIBERADO = { ativo: true, bloqueado: false, cadastro_incompleto: false, campos_faltantes: [] as string[] };
const BASE: EntradaDosBotoes = { cliente: LIBERADO, pre_venda_ligada: true, editando: null, pendencias: 0, preco_data: '2026-11-10' };

/** O que o Resumo DESENHA (modules/vendedor/app/components/novo-pedido-abas.tsx, BotoesDoResumoView): o principal e os secundários visíveis. */
function botoesNaTela(b: BotoesDoResumo): Array<{ rotulo: string; habilitado: boolean }> {
  const principal = b.principal === 'enviar' ? b.enviar : b.principal === 'orcamento' ? b.orcamento : b.salvarOrcamento;
  const sec = [b.apenasSalvar.visivel ? b.apenasSalvar : null, b.principal !== 'orcamento' && b.orcamento.visivel ? b.orcamento : null, b.transformar.visivel ? b.transformar : null].filter((x): x is NonNullable<typeof x> => x !== null);
  return [principal, ...sec].map((x) => ({ rotulo: x.rotulo, habilitado: x.habilitado }));
}

// ---------- área Alertas (RN-VEN-42) ----------
describe('T-0150 / T-0148 — área Alertas: os tipos da RN-VEN-42, uma linha curta cada', () => {
  const todos = alertasDoPedido({
    cliente: LIBERADO,
    recusas: ['Forma de pagamento inativa. Escolha outra na aba Venda.'],
    faltantes: [{ texto: 'Falta transportadora do frete FOB', aba: 'Entrega' }],
    itens_acima_do_maximo: [{ item: 'p-agu', codigo: 'AGU-1500', maximo_pct: 10 }],
    itens_sem_estoque: [{ item: 'p-bis', codigo: 'BIS-400' }],
    vencidos: { titulos: 2, valor_cents: 50_000, dias: 12 },
    disponivel_cents: 10_000,
    total_cents: 20_000,
  });

  it('todos os tipos aparecem, na ordem da spec (recusa, falta, máximo, estoque, crédito, título), com o problema e o item', () => {
    expect(todos.map((a) => [a.tipo, a.texto])).toEqual([
      ['recusa', 'Forma de pagamento inativa. Escolha outra na aba Venda'],
      ['faltante', 'Falta transportadora do frete FOB'],
      ['maximo', 'AGU-1500 acima do desconto máximo'],
      ['estoque', 'BIS-400 sem estoque'],
      ['credito', 'Limite de crédito excedido'],
      ['titulo', 'Título vencido'],
    ]);
    // a falta diz em que aba corrigir (premissa (b): sem bolinha nas abas)
    expect(todos.find((a) => a.tipo === 'faltante')).toMatchObject({ aba: 'Entrega', vai_para: { aba: 'Entrega' } });
    // máximo e estoque levam ao item (popup)
    expect(todos.find((a) => a.tipo === 'maximo')!.vai_para).toEqual({ item: 'p-agu' });
    expect(todos.find((a) => a.tipo === 'estoque')!.vai_para).toEqual({ item: 'p-bis' });
  });

  it('forma: linha curta, sem ponto final, sem código técnico e sem alçada (RN-VEN-10: a alçada só aparece na pergunta ao salvar)', () => {
    for (const a of todos) {
      expect(a.texto, a.id).not.toMatch(/\.$/);
      expect(a.texto, a.id).not.toMatch(/al[cç]ada|preco_abaixo_minimo|422|RN-/i);
      expect(a.texto.length, a.id).toBeLessThanOrEqual(80);
    }
    // a pendência "acima da alçada máxima" do cálculo vira recusa SEM a palavra alçada
    const { faltantes, recusas } = entradaDasPendencias([{ texto: 'Desconto acima da alçada máxima (15%)', aba: 'resumo' } as never, { texto: 'Transportadora do frete FOB', aba: 'entrega' } as never]);
    expect(recusas).toEqual(['Desconto do pedido acima do máximo']);
    expect(faltantes).toEqual([{ texto: 'Falta transportadora do frete FOB', aba: 'Entrega' }]);
  });

  it('sem alerta, a área não aparece (lista vazia)', () => {
    expect(alertasDoPedido({ cliente: LIBERADO, disponivel_cents: 10_000, total_cents: 10_000 })).toEqual([]);
  });

  it('RN-VEN-12 (limite): total igual ao crédito disponível não alerta; 1 centavo acima alerta; disponível negativo conta como zero', () => {
    const tipos = (disp: number | null, total: number) => alertasDoPedido({ cliente: LIBERADO, disponivel_cents: disp, total_cents: total }).map((a) => a.tipo);
    expect(tipos(10_000, 10_000)).toEqual([]);
    expect(tipos(10_000, 10_001)).toEqual(['credito']);
    expect(tipos(-500, 1)).toEqual(['credito']);
    expect(tipos(null, 99_999_999)).toEqual([]); // sem dado de crédito no aparelho: não inventa alerta
  });

  it('efeitos: máximo, estoque e cliente bloqueado = só orçamento; falta = impede enviar; crédito e título não mudam os botões', () => {
    const por = (t: AlertaDoPedido['tipo']) => todos.find((a) => a.tipo === t)!;
    expect(['maximo', 'estoque'].map((t) => por(t as never).so_orcamento)).toEqual([true, true]);
    expect([por('faltante').impede_enviar, por('faltante').so_orcamento]).toEqual([true, false]);
    expect(['credito', 'titulo', 'recusa'].map((t) => por(t as never).so_orcamento || por(t as never).impede_enviar)).toEqual([false, false, false]);
    const bloqueado = alertasDoPedido({ cliente: { ...LIBERADO, bloqueado: true } });
    expect(bloqueado.map((a) => [a.tipo, a.texto, a.so_orcamento])).toEqual([['cliente', 'Cliente bloqueado', true]]);
    expect(soOrcamentoPorAlertas(todos)).toBe(true);
    expect(impedeEnviarPorAlertas(todos)).toBe(true);
  });
});

// ---------- botões com alerta de bloqueio (premissa (e) da RN-VEN-42) ----------
describe('T-0150 — com alerta que bloqueia o envio, ficam só "Salvar como orçamento" e "Apenas salvar"', () => {
  const SO_DOIS = [
    { rotulo: ROTULOS_DO_SALVAR.orcamento, habilitado: true },
    { rotulo: ROTULOS_DO_SALVAR.apenasSalvar, habilitado: true },
  ];
  const casos: Array<[string, Partial<EntradaDosBotoes>, Parameters<typeof alertasDoPedido>[0]]> = [
    ['RN-VEN-11 desconto acima do máximo', { itens_acima_do_maximo: ['AGU-1500'] }, { cliente: LIBERADO, itens_acima_do_maximo: [{ item: 'x', codigo: 'AGU-1500' }] }],
    ['RN-VEN-20 sem estoque', { itens_sem_estoque: ['BIS-400'] }, { cliente: LIBERADO, itens_sem_estoque: [{ item: 'y', codigo: 'BIS-400' }] }],
    ['RN-VEN-13 cliente bloqueado', { cliente: { ...LIBERADO, bloqueado: true } }, { cliente: { ...LIBERADO, bloqueado: true } }],
  ];
  for (const [nome, entrada, alertas] of casos) {
    it(`${nome}: o Resumo desenha só os dois, e "Salvar e enviar pedido" sai`, () => {
      const b = botoesDoResumo({ ...BASE, ...entrada });
      expect(botoesNaTela(b)).toEqual(SO_DOIS);
      expect(botoesNaTela(b).map((x) => x.rotulo)).not.toContain(ROTULOS_DO_SALVAR.enviar);
      // a mesma decisão nos Alertas e nos botões (uma fonte)
      expect(soOrcamentoPorAlertas(alertasDoPedido(alertas))).toBe(true);
    });
  }

  it('controle: sem alerta, "Salvar e enviar pedido" é o principal; com falta de preenchimento ele fica desligado e "Apenas salvar" continua', () => {
    expect(botoesNaTela(botoesDoResumo(BASE))[0]).toEqual({ rotulo: ROTULOS_DO_SALVAR.enviar, habilitado: true });
    const comFalta = botoesNaTela(botoesDoResumo({ ...BASE, pendencias: 1 }));
    expect(comFalta[0]).toEqual({ rotulo: ROTULOS_DO_SALVAR.enviar, habilitado: false });
    expect(comFalta).toContainEqual({ rotulo: ROTULOS_DO_SALVAR.apenasSalvar, habilitado: true });
  });

  it('a tela do Resumo só desenha o "Salvar e enviar" como principal (não há outro caminho para ele no BotoesDoResumoView)', () => {
    const tela = ler('modules/vendedor/app/components/novo-pedido-abas.tsx');
    const view = tela.slice(tela.indexOf('function BotoesDoResumoView'));
    expect(view.match(/b\.enviar\b/g)).toHaveLength(1);
    expect(view).toContain("b.principal === 'enviar'");
  });

  it('a tela passa ao domain os itens acima do máximo e os sem estoque calculados no aparelho', () => {
    const tela = ler('modules/vendedor/app/screens/new-order-screen.tsx');
    // os campos valem em qualquer ordem e com outros entre eles (a T-0168 pôs acima_do_limite, RN-VEN-11a)
    const chamada = /botoesDoResumo\(\{[^}]*\}\)/.exec(tela)?.[0] ?? '';
    expect(chamada).toContain('itens_acima_do_maximo: calculo.acima_do_maximo');
    expect(chamada).toContain('itens_sem_estoque: semEstoque.map((x) => x.codigo)');
  });

  // D-T0150-3 (folha de saída, RN-VEN-38 × RN-VEN-42 (e)): o domain ganhou `alertas_impedem_enviar` (sair-do-pedido.ts) — a parte do domain vale.
  it('D-T0150-3 (domain): com alerta de bloqueio a folha tira "Salvar e enviar pedido" e mantém "Salvar como orçamento" e "Apenas salvar"', () => {
    const o = opcoesDaSaida({ cliente: LIBERADO, pre_venda_ligada: true, preco_data: '2026-11-10', alertas_impedem_enviar: true });
    expect(o).toMatchObject({ salvar: false, orcamento: true, apenasSalvar: true });
    expect(opcoesDaSaida({ cliente: LIBERADO, pre_venda_ligada: true, preco_data: '2026-11-10', alertas_impedem_enviar: false }).salvar).toBe(true);
  });

  // D-T0150-3b corrigido pelo modulo-vendedor: a tela passa `soOrcamentoPorAlertas(alertasDoTopo) || impedeEnviarPorAlertas(alertasDoTopo)`. Antes usava `.some((a) => a.impede_enviar)`, e os
  // alertas de máximo e de estoque têm `impede_enviar: false` (só `so_orcamento: true`). Com só um item sem estoque/acima do máximo (sem pendência),
  // a folha seguia oferecendo "Salvar e enviar pedido". O teste avalia a expressão REAL da tela sobre os alertas reais (era it.fails).
  it('D-T0150-3b corrigido — tela: item sem estoque ou acima do máximo tira "Salvar e enviar pedido" da folha de saída (RN-VEN-42 (e), RN-VEN-20, RN-VEN-11)', () => {
    const tela = ler('modules/vendedor/app/screens/new-order-screen.tsx');
    const m = /opcoesDaSaida\(\{[^]*?alertas_impedem_enviar: (.+?) \}\)/.exec(tela);
    expect(m, 'a tela passa alertas_impedem_enviar a opcoesDaSaida').not.toBeNull();
    const flag = new Function('alertasDoTopo', 'soOrcamentoPorAlertas', 'impedeEnviarPorAlertas', `return (${m![1]});`) as (a: AlertaDoPedido[], s: typeof soOrcamentoPorAlertas, i: typeof impedeEnviarPorAlertas) => boolean;
    const saida = (alertas: AlertaDoPedido[]) => opcoesDaSaida({ cliente: LIBERADO, pre_venda_ligada: true, preco_data: '2026-11-10', alertas_impedem_enviar: flag(alertas, soOrcamentoPorAlertas, impedeEnviarPorAlertas) });
    expect(saida(alertasDoPedido({ cliente: LIBERADO, itens_sem_estoque: [{ item: 'p-bis', codigo: 'BIS-400', estoque: { quantidade: 0, unidade: 'UN' } }] })).salvar).toBe(false);
    expect(saida(alertasDoPedido({ cliente: LIBERADO, itens_sem_estoque: [{ item: 'p-bis', codigo: 'BIS-400', estoque: { quantidade: 5, unidade: 'UN' } }] })).salvar).toBe(false);
    expect(saida(alertasDoPedido({ cliente: LIBERADO, itens_acima_do_maximo: [{ item: 'p-agu', codigo: 'AGU-1500', maximo_pct: 10 }] })).salvar).toBe(false);
  });

  it('controle D-T0150-3b: sem alerta (ou só crédito/título) a folha mantém "Salvar e enviar pedido"; com falta de preenchimento ela tira', () => {
    const tela = ler('modules/vendedor/app/screens/new-order-screen.tsx');
    const m = /opcoesDaSaida\(\{[^]*?alertas_impedem_enviar: (.+?) \}\)/.exec(tela)!;
    const flag = new Function('alertasDoTopo', 'soOrcamentoPorAlertas', 'impedeEnviarPorAlertas', `return (${m[1]});`) as (a: AlertaDoPedido[], s: typeof soOrcamentoPorAlertas, i: typeof impedeEnviarPorAlertas) => boolean;
    expect(flag([], soOrcamentoPorAlertas, impedeEnviarPorAlertas)).toBe(false);
    expect(flag(alertasDoPedido({ cliente: LIBERADO, disponivel_cents: 100, total_cents: 200 }), soOrcamentoPorAlertas, impedeEnviarPorAlertas)).toBe(false);
    expect(flag(alertasDoPedido({ cliente: LIBERADO, faltantes: [{ texto: 'Falta transportadora do frete FOB', aba: 'Entrega' }] }), soOrcamentoPorAlertas, impedeEnviarPorAlertas)).toBe(true);
  });

  it.todo('pergunta ao gerente/vendedor: tenant SEM pré-venda e item sem estoque/acima do máximo — hoje fica "Salvar e enviar" desligado + "Apenas salvar" (sem orçamento); a premissa (e) pede orçamento (como o cliente da RN-VEN-13, que ganha o orçamento mesmo sem pré-venda)');
});

// ---------- detalhe: Alertas, ações e situação só no Histórico ----------
describe('T-0150 — detalhe do pedido/orçamento: Alertas no topo, situação só no Histórico', () => {
  const acoes = (o: Partial<EntradaAcoesDoDetalhe>) =>
    acoesDoDetalhe({ tipo: 'orcamento', status: 'received', situacao: 'aberto' as never, naFila: false, recusado: false, somenteLeitura: false, podeEditar: true, podeCancelar: true, podeDuplicar: true, podePdf: true, podeConverter: true, pedidoGeradoId: null, ...o });

  it('orçamento com item sem estoque (reconferência): alerta "BIS-400 sem estoque"; a principal é Editar e o Transformar não aparece (premissa (c))', () => {
    const al = alertasDoDetalhe({ mudancas: [{ tipo: 'estoque', produto_id: 'p-bis', pedido_base: 10, disponivel_base: 3 }], codigoDoProduto: () => 'BIS-400' });
    expect(al.map((a) => a.texto)).toEqual(['BIS-400 sem estoque']);
    const a = acoes({ alertaImpedeTransformar: soOrcamentoPorAlertas(al) });
    expect(a.principal?.id).toBe('editar');
    expect([a.principal, ...a.icones, ...a.menu].map((x) => x?.id)).not.toContain('transformar');
    // controle: sem alerta, o Transformar volta a ser a principal
    expect(acoes({ alertaImpedeTransformar: false }).principal?.id).toBe('transformar');
  });

  it('orçamento com desconto abaixo do mínimo de hoje: alerta do máximo pelo código do item; cliente bloqueado vira "Cliente bloqueado"', () => {
    const al = alertasDoDetalhe({ mudancas: [{ tipo: 'abaixo_minimo', produto_id: 'p-agu', unidade: 'UN' }, { tipo: 'cliente', motivo: 'bloqueado', campos: [] }], codigoDoProduto: () => 'AGU-1500' });
    expect(al.map((a) => a.texto)).toEqual(['Cliente bloqueado', 'AGU-1500 acima do desconto máximo']);
  });

  it('recusa do supervisor e recusa do servidor viram linhas dos Alertas; a etapa "Rejeitado" do Histórico leva só o nome (uma informação, um lugar)', () => {
    const al = alertasDoDetalhe({ recusaDoSupervisor: 'Desconto alto para este cliente.', recusaDoServidor: null });
    expect(al.map((a) => [a.tipo, a.texto])).toEqual([['recusa', 'Desconto alto para este cliente']]);
    const tela = ler('modules/vendedor/app/screens/order-detail-screen.tsx');
    expect(tela).toContain("const eventosSemMotivo = eventosDoHistorico.map((e) => (['rejected', 'cancelled'].includes(e.status) ? { ...e, motivo: null } : e));");
    expect(tela).toContain('tagsDoHistorico(eventosSemMotivo,');
  });

  it('situação só no Histórico: o topo do detalhe não tem selo de situação (só pode haver o "Editado neste pedido" do endereço)', () => {
    const tela = ler('modules/vendedor/app/screens/order-detail-screen.tsx');
    const corpo = tela.slice(tela.indexOf('<BackLink label="Pedidos"'));
    expect(corpo.length).toBeGreaterThan(1_000);
    // nenhum Selo, a não ser o "Editado neste pedido" do endereço (que não é situação)
    const selos = corpo.match(/<Selo\b[^>]*>/g) ?? [];
    for (const s of selos) expect(s).toContain('TEXTOS_ENDERECO.editadoNestePedido');
    expect(corpo).not.toMatch(/<Badge\b|statusLabel|rotuloDoStatus|seloDaSituacao/);
    // a lista de Pedidos mantém o selo por linha (única forma de ver a situação de vários pedidos)
    expect(ler('modules/vendedor/app/screens/orders-screen.tsx')).toMatch(/<Selo texto=\{seloOrc\.texto\}|<Badge label=\{b\.label\}/);
  });

  it('a última etapa do Histórico é a situação atual (pedido enviado → em aprovação → aprovado) e o vendedor não aparece como autor', () => {
    const ev = eventosDoPedido(
      [
        { at: '2026-11-10T13:00:00.000Z', status: 'received', by: 'Lucas', note: '' },
        { at: '2026-11-10T13:00:05.000Z', status: 'pending_approval', by: 'Lucas', note: '' },
        { at: '2026-11-10T15:20:00.000Z', status: 'approved', by: 'Carla Souza', note: '' },
      ] as never,
      { vendedorNome: 'Lucas' },
    );
    const tags = tagsDoHistorico(ev, { tipo: 'pedido', tz: 'America/Manaus', agora: '2026-11-10T16:00:00.000Z' });
    // fuso do tenant: 15:20 UTC = 11:20 em Manaus
    expect(tags.map((t) => t.texto)).toEqual(['Enviado · 10/11 09:00', 'Em aprovação · 10/11 09:00', 'Aprovado · 10/11 11:20 · Carla Souza']);
  });
});

// ---------- aba Itens com popup: 30 itens sem recalcular a cada toque (T-0148 critério 2) ----------
describe('T-0148 — aba Itens com popup: 30 itens, recálculo só ao confirmar', () => {
  const N = 30;
  const ids = Array.from({ length: N }, (_, k) => `p${String(k + 1).padStart(2, '0')}`);
  const produto = (id: string, k: number) => ({ id, erp_code: `SKU-${k + 1}`, description: `Produto ${k + 1}`, unit: 'UN', price_cents: 1_000 + k * 37, stock_total: 1_000, stock: [], brand: '', line: '', ean: null, active: true, external_id: null, applications: '', is_campaign: false }) as never;
  const catalogo = ids.map(produto);
  const CX: UnidadeDaTela[] = [{ produto_id: 'p05', unidade: 'CX', fator: 12, padrao: false }];
  const medidasP05: UnidadeDaTela[] = [{ produto_id: 'p05', unidade: 'UN', fator: 1, padrao: true }, ...CX];
  const lines = Object.fromEntries(ids.map((id, k) => [id, (k % 4) + 1]));
  const ajustes = { p03: { desconto_pct: 3 }, p07: { acrescimo_pct: 2 } };
  const eu = { id: 'v', name: 'Lucas', short_name: 'Lucas', team_id: '', team_name: '', branch_id: '', max_discount_pct: 5 };
  const calcular = (l: Record<string, number>, a: Record<string, object>) =>
    prepararPedido({ cliente: { id: 'c1', trade_name: 'Mercado Boto' } as never, politica: politicaApi({}), eu, filaDoClienteCents: 0, unidades: CX, catalogo, rascunho: { ...rascunhoVazio('c1'), lines: l, ajustes: a as never } });

  it('confirmar o popup grava só aquele produto: as outras 29 linhas e os ajustes delas ficam iguais', () => {
    const r = aplicarItemNoRascunho(lines, ajustes, 'p05', medidasP05, { idx: 1, qtd: 2, ajuste: { desconto_pct: 4 } });
    const { p05: _antes, ...outras } = lines;
    const { [chaveDaLinha('p05', 'CX')]: novo, ...resto } = r.lines;
    expect(novo).toBe(2);
    expect(resto).toEqual(outras);
    expect(r.ajustes).toEqual({ ...ajustes, [chaveDaLinha('p05', 'CX')]: { desconto_pct: 4 } });
    // remover tira só o produto
    const sem = aplicarItemNoRascunho(r.lines, r.ajustes, 'p05', medidasP05, null);
    expect(Object.keys(sem.lines)).toHaveLength(N - 1);
    expect(sem.ajustes).toEqual(ajustes);
  });

  it('reabrir o item no pedido traz a embalagem, a quantidade e o ajuste que já estão lá ("Salvar alteração"/"Remover item", R-20261112-155448)', () => {
    expect(itemPopup.ROTULOS_DO_POPUP).toEqual({ adicionar: 'Adicionar ao pedido', salvar: 'Salvar alteração', remover: 'Remover item' });
    const r = aplicarItemNoRascunho(lines, ajustes, 'p05', medidasP05, { idx: 1, qtd: 2, ajuste: { desconto_pct: 4 } });
    expect(estadoInicialDoItem('p05', medidasP05, r.lines, r.ajustes)).toEqual({ idx: 1, qtd: 2, ajuste: { desconto_pct: 4 }, reabrindo: true });
    expect(estadoInicialDoItem('p99', [{ produto_id: 'p99', unidade: 'UN', fator: 1, padrao: true }], r.lines, r.ajustes)).toEqual({ idx: 0, qtd: 1, ajuste: {}, reabrindo: false });
  });

  it('o popup trabalha num estado local: a prévia calcula UMA linha e o rascunho só muda no confirmar/remover (sem recalcular o pedido a cada toque)', () => {
    const folha = ler('modules/vendedor/app/components/folha-do-item.tsx');
    expect(folha).toContain('previa({ [chave]: qtd }, { [chave]: ajuste })');
    expect(folha).not.toMatch(/setLinhas|updateDraft|onRascunho|calcularPedido/);
    expect(folha).toContain('onPress={() => onConfirmar({ idx, qtd, ajuste })}');
    const tela = ler('modules/vendedor/app/screens/new-order-screen.tsx');
    // o cálculo do pedido inteiro depende só do rascunho (useMemo), que o popup não toca até confirmar
    expect(tela).toMatch(/const calculoAtual = useMemo\(\s*\(\) =>\s*politica\s*\? calcularPedido\(\{ lines: draft\.lines/);
    const popup = tela.slice(tela.indexOf('<FolhaDoItem'), tela.indexOf('/>', tela.indexOf('onFechar={() => setPopupId(null)}')));
    // onConfirmar, onRemover e o Desfazer do "Item removido" (R-20261112-155448), que devolve a cópia de antes da remoção
    expect(popup.match(/setLinhas\(/g)).toHaveLength(3);
    expect(popup).toMatch(/onRemover=\{\(\) => \{\s*const antes = \{ lines: draft\.lines, ajustes: draft\.ajustes \?\? \{\} \};/);
    expect(popup).toContain('onPress: () => setLinhas(antes.lines, antes.ajustes)');
  });

  it('30 itens: o recálculo do pedido inteiro (feito uma vez por confirmação) cabe com folga num toque', () => {
    calcular(lines, ajustes); // aquecimento
    const vezes = 20;
    const t0 = performance.now();
    for (let i = 0; i < vezes; i++) calcular({ ...lines, p01: i + 1 }, ajustes);
    const media = (performance.now() - t0) / vezes;
    expect(calcular(lines, ajustes).v.calculo.linhas).toHaveLength(N);
    expect(media, `média ${media.toFixed(1)} ms por recálculo`).toBeLessThan(100);
  });

  it('RN-VEN-20 (limite): estoque igual à quantidade não alerta; 1 acima alerta (popup e Alertas); estoque zero = "Sem estoque"; embalagem conta pela unidade base', () => {
    expect(alertasDoItemNoPopup({ erp_code: 'BIS-400', estoque_base: 12, quantidade_base: 12, acima_do_maximo: false })).toEqual([]);
    expect(alertasDoItemNoPopup({ erp_code: 'BIS-400', estoque_base: 12, quantidade_base: 13, acima_do_maximo: false })).toHaveLength(1);
    expect(alertasDoItemNoPopup({ erp_code: 'BIS-400', estoque_base: 0, quantidade_base: 1, acima_do_maximo: false })).toEqual(['Sem estoque']);
    expect(alertasDoItemNoPopup({ erp_code: 'AGU-1500', estoque_base: 0, quantidade_base: 1, acima_do_maximo: true, maximo_pct: 10 })).toEqual(['Acima do desconto máximo de 10,0%', 'Sem estoque']);
    const linha = (product_id: string, quantidade_base: number) => ({ product_id, quantidade_base }) as never;
    const prod = (id: string) => ({ p1: { erp_code: 'BIS-400', stock_total: 12 }, p2: { erp_code: 'CAF-500', stock_total: 23 } })[id as 'p1' | 'p2'];
    // 1 CX c/12 = 12 na base: cabe; 2 CX = 24 > 23: falta
    expect(itensSemEstoque([linha('p1', 12), linha('p2', 24)], prod)).toEqual([{ item: 'p2', codigo: 'CAF-500' }]);
  });

  // T-0165 (pedido-v4 §5.3 e §5.8): sai o painel "No pedido" (com "Ver itens" e "Recolher"); os itens do pedido ficam na lista com o lápis.
  it('T-0165: o painel "No pedido" saiu da aba Itens (painelNoPedido não existe mais)', () => {
    expect((itemPopup as Record<string, unknown>)['painelNoPedido']).toBeUndefined();
    expect(N).toBeGreaterThan(3);
  });

  it('D-T0148-4 corrigido (R-20261110-142835 item 1): quantidade acima de um estoque positivo diz "acima do estoque", não "Sem estoque" (rótulo × valor)', () => {
    const a = alertasDoItemNoPopup({ erp_code: 'BIS-400', estoque_base: 12, quantidade_base: 13, acima_do_maximo: false });
    expect(a).toHaveLength(1);
    expect(a[0]).not.toBe('Sem estoque');
    expect(a[0]).toMatch(/acima do estoque/i);
  });

  it('RD-0087: no popup o alerta de estoque sai SEM código ("Acima do estoque" / "Sem estoque"); a área Alertas do Novo pedido mantém o código e o estoque', () => {
    expect(alertasDoItemNoPopup({ erp_code: 'BIS-400', estoque_base: 5, quantidade_base: 6, acima_do_maximo: false, unidade_base: 'UN' })).toEqual(['Acima do estoque']);
    expect(alertasDoItemNoPopup({ erp_code: 'BIS-400', estoque_base: 0, quantidade_base: 1, acima_do_maximo: false, unidade_base: 'UN' })).toEqual(['Sem estoque']);
    const area = (quantidade: number) => alertasDoPedido({ cliente: LIBERADO, itens_sem_estoque: [{ item: 'p-bis', codigo: 'BIS-400', estoque: { quantidade, unidade: 'UN' } }] }).map((x) => x.texto);
    expect(area(5)).toEqual(['BIS-400 acima do estoque (5 UN)']);
    expect(area(0)).toEqual(['BIS-400 sem estoque']);
    // a tela do popup desenha com o texto sem código (folha-do-item.tsx); o máximo não repete na área do item (RD-0177): fica "Máx. 10,0%" embaixo do campo
    const folha = ler('modules/vendedor/app/components/folha-do-item.tsx');
    expect(folha).toContain("<AreaAlertas alertas={alertas.filter((a) => a.tipo !== 'maximo')} texto={textoDoAlertaNoItem}");
    expect(folha).toContain('{textoDoMaximo(maximoPct)}');
    expect(textoDoMaximo(10)).toBe('Máx. 10,0%');
  });
});

describe('T-0150 — textos da falta de preenchimento nos Alertas (R-20261110-142835 item 2)', () => {
  it('controle: "Transportadora do frete FOB" vira "Falta transportadora do frete FOB", com a aba Entrega', () => {
    expect(entradaDasPendencias([{ id: 'frete', texto: 'Transportadora do frete FOB', aba: 'entrega' } as never]).faltantes).toEqual([{ texto: 'Falta transportadora do frete FOB', aba: 'Entrega' }]);
  });

  // D-T0150-5 corrigido pelo modulo-vendedor (R-20261110-153007): a sigla mantém a maiúscula.
  it('D-T0150-5 corrigido — sigla no início não vira minúscula: "Falta CNPJ …", nunca "Falta cNPJ …"', () => {
    expect(textoDaFalta('CNPJ da transportadora')).toBe('Falta CNPJ da transportadora');
    expect(textoDaFalta('CPF do recebedor')).toBe('Falta CPF do recebedor');
    expect(textoDaFalta('Transportadora do frete FOB')).toBe('Falta transportadora do frete FOB');
  });

  it('D-T0150-6 corrigido (R-20261110-142835 item 2): CNPJ da transportadora inválido aparece como problema, não como "Falta"', () => {
    const { faltantes } = entradaDasPendencias([{ id: 'frete', texto: 'CNPJ da transportadora', aba: 'entrega' } as never]);
    expect(faltantes[0]!.texto).not.toMatch(/^Falta/);
    expect(faltantes[0]!.texto).toMatch(/CNPJ da transportadora inválido/);
  });
});

describe('T-0150 — pedido recusado na fila: a nota "Aguardando envio" (R-20261110-142835 item 3)', () => {
  it('a etapa "Na fila" do Histórico não mostra nota (só Rejeitado e Cancelado têm linha de motivo): "Aguardando envio" não aparece na tela', () => {
    const ev = eventosDoPedido([{ at: '2026-11-10T13:00:00.000Z', status: 'queued', by: 'aparelho', note: 'Aguardando envio' }] as never, { vendedorNome: 'Lucas' });
    const [tag] = tagsDoHistorico(ev, { tipo: 'pedido', tz: 'America/Manaus', agora: '2026-11-10T16:00:00.000Z' });
    expect(tag!.motivo).toBeNull();
    expect(`${tag!.texto} ${tag!.leitura}`).not.toContain('Aguardando envio');
  });
});

// ---------- T-0166 (RD-0176 e RD-0172) ----------
describe('T-0166 — botões e folha de saída sem "aviso" (RD-0176); "Título vencido" só acima do limite da RN-VEN-13 e a prazo (RD-0172)', () => {
  const ENTRADAS: Array<[string, EntradaDosBotoes]> = [
    ['liberado', BASE],
    ['com pendência', { ...BASE, pendencias: 2 }],
    ['cliente bloqueado', { ...BASE, cliente: { ...LIBERADO, bloqueado: true } }],
    ['cliente inativo', { ...BASE, cliente: { ...LIBERADO, ativo: false } }],
    ['cadastro incompleto', { ...BASE, cliente: { ...LIBERADO, cadastro_incompleto: true, campos_faltantes: ['CEP'] } }],
    ['sem pré-venda', { ...BASE, pre_venda_ligada: false }],
    ['item acima do máximo', { ...BASE, itens_acima_do_maximo: ['AGU-1500'] }],
    ['item sem estoque', { ...BASE, itens_sem_estoque: ['BIS-400'] }],
  ];

  it('RD-0176: botoesDoResumo não devolve o campo "aviso" em nenhuma situação (o motivo fica só na área Alertas)', () => {
    for (const [nome, e] of ENTRADAS) {
      const b = botoesDoResumo(e) as unknown as Record<string, unknown>;
      expect(Object.keys(b), nome).not.toContain('aviso');
      for (const v of Object.values(b)) if (v && typeof v === 'object') expect(Object.keys(v), nome).not.toContain('aviso');
    }
  });

  // T-0166: o subtituloOrcamento (sempre null desde a T-0141) também saiu do retorno
  it('RD-0176: opcoesDaSaida devolve só salvar, apenasSalvar e orcamento (sem "aviso" nem linha de motivo)', () => {
    for (const [nome, e] of ENTRADAS) {
      for (const impede of [false, true]) {
        const o = opcoesDaSaida({ cliente: e.cliente, pre_venda_ligada: e.pre_venda_ligada, preco_data: e.preco_data, alertas_impedem_enviar: impede });
        expect(Object.keys(o).sort(), `${nome}, impede=${impede}`).toEqual(['apenasSalvar', 'orcamento', 'salvar']);
      }
    }
  });

  // RN-VEN-13: "Título vencido há mais de [5] dias → só à vista ou com aprovação". O alerta só aparece quando muda o resultado (RD-0172).
  const V = (dias: number) => ({ titulos: 2, valor_cents: 50_000, dias });
  const tituloNosAlertas = (dias: number, prazo: number | undefined, limite = TITULO_VENCIDO_DIAS_PADRAO) =>
    alertasDoPedido({ cliente: LIBERADO, vencidos: vencidosComEfeito(V(dias), prazo, limite) }).filter((a) => a.tipo === 'titulo').map((a) => a.texto);

  it('RN-VEN-13 (limite): padrão 5 dias; atraso de 5 dias a prazo não alerta (igual ao limite não passa); 6 dias alerta "Título vencido"', () => {
    expect(TITULO_VENCIDO_DIAS_PADRAO).toBe(5);
    expect(tituloVencidoDias({})).toBe(5);
    expect(tituloNosAlertas(5, 30)).toEqual([]);
    expect(tituloNosAlertas(6, 30)).toEqual(['Título vencido']);
    expect(tituloNosAlertas(120, 45)).toEqual(['Título vencido']);
  });

  it('RN-VEN-13: pagamento à vista (prazo médio 0) ou sem prazo escolhido não alerta, mesmo com atraso grande', () => {
    expect(tituloNosAlertas(30, 0)).toEqual([]);
    expect(tituloNosAlertas(30, undefined)).toEqual([]);
    expect(vencidosComEfeito(null, 30, 5)).toBeNull();
  });

  it('RN-VEN-13: o limite vem do parâmetro titulo_vencido_dias do tenant (10 dias: 10 não alerta, 11 alerta); parâmetro inválido volta ao padrão', () => {
    const limite = tituloVencidoDias({ titulo_vencido_dias: 10 });
    expect(limite).toBe(10);
    expect(tituloNosAlertas(10, 30, limite)).toEqual([]);
    expect(tituloNosAlertas(11, 30, limite)).toEqual(['Título vencido']);
    expect(tituloVencidoDias({ titulo_vencido_dias: '7' })).toBe(7);
    expect([tituloVencidoDias({ titulo_vencido_dias: -1 }), tituloVencidoDias({ titulo_vencido_dias: 2.5 }), tituloVencidoDias({ titulo_vencido_dias: '' })]).toEqual([5, 5, 5]);
  });

  it('RN-VEN-13: o título vencido não muda os botões (não é "só orçamento" nem impede enviar); o efeito é a aprovação', () => {
    const a = alertasDoPedido({ cliente: LIBERADO, vencidos: vencidosComEfeito(V(12), 30, 5) });
    expect(a.map((x) => [x.tipo, x.texto, x.so_orcamento, x.impede_enviar])).toEqual([['titulo', 'Título vencido', false, false]]);
  });

  it('tela: o Novo pedido passa à área Alertas os vencidos filtrados por vencidosComEfeito, com o prazo escolhido e o limite do tenant', () => {
    const tela = ler('modules/vendedor/app/screens/new-order-screen.tsx');
    expect(tela).toMatch(/vencidos: vencidosComEfeito\([^\n]*dias: credito\.alerta\.dias \} : null, prazoEscolhido\?\.prazo_medio_dias, tituloVencidoDias\(parametrosVendedor\)\)/);
    // a área Alertas não recebe os vencidos crus por outro caminho
    expect(tela.match(/vencidos:/g)).toHaveLength(1);
  });
});
