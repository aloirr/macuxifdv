/**
 * T-0150 / T-0148 — critérios das telas novas do pedido (RN-VEN-42, RN-VEN-20, RN-VEN-11, RN-VEN-12, RN-VEN-13, RN-CORE-36), sem banco.
 * Os números iguais no Resumo em tabela, no detalhe e no PDF ficam em tests/modulos/pedido-numeros-t0151.test.ts (bloco T-0150).
 *
 * Aqui:
 *   - área Alertas com os tipos da RN-VEN-42 (desconto acima do máximo, falta preencher, recusa, sem estoque, crédito/título vencido),
 *     cada um numa linha curta, sem alçada;
 *   - com alerta que bloqueia o envio: o Novo pedido só tem "Salvar" (Orçamento ou Pedido; o Pedido fica salvo, sem enviar, R-20261124-114951);
 *     o que trava é o Enviar da aba Pedidos (`motivoDeNaoEnviarOSalvo`, RN-VEN-48) e, na edição, o salvar/transformar (`botoesDaEdicao`);
 *   - situação só no Histórico (sem selo no topo do detalhe; a lista de Pedidos mantém o selo);
 *   - aba Itens com popup: 30 itens sem recalcular a cada toque (só ao confirmar o popup).
 * O ORÁCULO é o texto das RNs; as funções testadas são as que as telas chamam.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tagsDoHistorico } from '@macuxi/ui/mobile/puro';
import { describe, expect, it } from 'vitest';

import { alertasDoPedido, soOrcamentoPorAlertas, textoDoMaximo, vencidosComEfeito, type AlertaDoPedido } from '../../modules/vendedor/domain/alertas-pedido';
import { TITULO_VENCIDO_DIAS_PADRAO, tituloVencidoDias } from '../../modules/vendedor/domain/pagamento';
import { botoesDaEdicao, botoesDoSalvarNovo, motivoDeNaoEnviarOSalvo, ROTULOS_DA_EDICAO, type BotoesDaEdicao, type EntradaDaEdicao } from '../../modules/vendedor/domain/botoes-resumo';
import { eventosDoPedido } from '../../modules/vendedor/domain/historico-pedido';
import { opcoesDaSaida } from '../../modules/vendedor/domain/sair-do-pedido';
import { pendenciasDePreenchimento } from '../../modules/vendedor/domain/pendencias-preenchimento';
import { entradaDasPendencias, itensSemEstoque, primeiraAbaComFalta, textoDaFalta } from '../../modules/vendedor/app/lib/alertas-novo-pedido';
import { acoesDoDetalhe, alertasDoDetalhe, type EntradaAcoesDoDetalhe } from '../../modules/vendedor/app/lib/detalhe-pedido';
import * as itemPopup from '../../modules/vendedor/app/lib/item-popup';
import { aplicarItemNoRascunho, alertasDoItemNoPopup, estadoInicialDoItem } from '../../modules/vendedor/app/lib/item-popup';
import { chaveDaLinha, type UnidadeDaTela } from '../../modules/vendedor/app/lib/novo-pedido';
import { prepararPedido, rascunhoVazio } from '../../modules/vendedor/app/lib/pedidos';
import { politicaApi } from '../../modules/vendedor/app/lib/pull';

const ler = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');
const LIBERADO = { ativo: true, bloqueado: false, cadastro_incompleto: false, campos_faltantes: [] as string[] };
const EDITANDO_PEDIDO: EntradaDaEdicao = { cliente: LIBERADO, editando: 'pedido' };
const EDITANDO_ORCAMENTO: EntradaDaEdicao = { cliente: LIBERADO, editando: 'orcamento' };

/** O que o Resumo da EDIÇÃO desenha (modules/vendedor/app/components/novo-pedido-abas.tsx, BotoesDoResumoView): o principal e o Converter, se visível. */
function botoesDaEdicaoNaTela(b: BotoesDaEdicao): Array<{ rotulo: string; habilitado: boolean }> {
  const principal = b.principal === 'salvar_orcamento' ? b.salvarOrcamento : b.salvarAlteracoes;
  return [principal, ...(b.transformar.visivel ? [b.transformar] : [])].map((x) => ({ rotulo: x.rotulo, habilitado: x.habilitado }));
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
    expect(todos.some((a) => a.impede_enviar)).toBe(true);
  });
});

// ---------- botões com alerta de bloqueio (premissa (e) da RN-VEN-42 × R-20261124-114951) ----------
describe('T-0150 × R-20261124-114951 — alerta de bloqueio: o Novo pedido salva; o que trava é o Enviar da lista e a edição', () => {
  const casos: Array<[string, { itens_acima_do_maximo?: string[]; itens_sem_estoque?: string[] }, Parameters<typeof alertasDoPedido>[0], string]> = [
    ['RN-VEN-11 desconto acima do máximo', { itens_acima_do_maximo: ['AGU-1500'] }, { cliente: LIBERADO, itens_acima_do_maximo: [{ item: 'x', codigo: 'AGU-1500' }] }, 'AGU-1500 acima do desconto máximo. Edite o item ou salve como orçamento.'],
    ['RN-VEN-20 sem estoque', { itens_sem_estoque: ['BIS-400'] }, { cliente: LIBERADO, itens_sem_estoque: [{ item: 'y', codigo: 'BIS-400' }] }, 'BIS-400 sem estoque. Edite o item ou salve como orçamento.'],
  ];
  for (const [nome, itens, alertas, motivo] of casos) {
    it(`${nome}: o Enviar da lista recusa com uma linha; a edição desliga o salvar do pedido e o Converter`, () => {
      // RN-VEN-48: o salvo não entra na fila; o motivo numa linha
      expect(motivoDeNaoEnviarOSalvo({ cliente: LIBERADO, pre_venda_ligada: true, ...itens })).toBe(motivo);
      expect(botoesDaEdicaoNaTela(botoesDaEdicao({ ...EDITANDO_PEDIDO, ...itens }))).toEqual([{ rotulo: ROTULOS_DA_EDICAO.alteracoes, habilitado: false }]);
      expect(botoesDaEdicaoNaTela(botoesDaEdicao({ ...EDITANDO_ORCAMENTO, ...itens }))).toEqual([
        { rotulo: ROTULOS_DA_EDICAO.salvarOrcamento, habilitado: true },
        { rotulo: ROTULOS_DA_EDICAO.transformar, habilitado: false },
      ]);
      // a mesma decisão nos Alertas e no Enviar (uma fonte)
      expect(soOrcamentoPorAlertas(alertasDoPedido(alertas))).toBe(true);
    });
  }

  it('RN-VEN-13 cliente bloqueado: o Enviar recusa; o Converter não aparece', () => {
    const cliente = { ...LIBERADO, bloqueado: true };
    expect(motivoDeNaoEnviarOSalvo({ cliente, pre_venda_ligada: true })).toBe('Cliente bloqueado. Só orçamento.');
    expect(motivoDeNaoEnviarOSalvo({ cliente, pre_venda_ligada: false })).toBe('Cliente bloqueado.');
    expect(botoesDaEdicaoNaTela(botoesDaEdicao({ ...EDITANDO_ORCAMENTO, cliente }))).toEqual([{ rotulo: ROTULOS_DA_EDICAO.salvarOrcamento, habilitado: true }]);
    expect(soOrcamentoPorAlertas(alertasDoPedido({ cliente }))).toBe(true);
  });

  it('controle: sem alerta, o Enviar da lista passa (null) e a edição fica toda tocável; a falta de preenchimento é barrada na tentativa', () => {
    for (const pre_venda_ligada of [true, false]) expect(motivoDeNaoEnviarOSalvo({ cliente: LIBERADO, pre_venda_ligada })).toBeNull();
    expect(botoesDaEdicaoNaTela(botoesDaEdicao(EDITANDO_PEDIDO))).toEqual([{ rotulo: ROTULOS_DA_EDICAO.alteracoes, habilitado: true }]);
    expect(botoesDaEdicaoNaTela(botoesDaEdicao({ ...EDITANDO_PEDIDO, editando_no_servidor: false }))[0]!.rotulo).toBe(ROTULOS_DA_EDICAO.alteracoesNoAparelho);
    expect(botoesDaEdicaoNaTela(botoesDaEdicao(EDITANDO_ORCAMENTO)).every((x) => x.habilitado)).toBe(true);
    // RN-CORE-36 (T-0166): a falta não desliga o botão; o toque em Salvar leva à 1ª aba com falta (a forma de pagamento fica em Venda)
    const falta = pendenciasDePreenchimento({ itens: 1, quantidade_invalida: false, pagamento: { tipo: 'forma' }, frete: 'ok', erros_calculo: [] });
    expect(primeiraAbaComFalta(falta)).toBe('venda');
    expect(primeiraAbaComFalta(pendenciasDePreenchimento({ itens: 1, quantidade_invalida: false, pagamento: { tipo: 'ok' }, frete: 'ok', erros_calculo: [] }))).toBeNull();
  });

  it('a tela do Resumo não tem botão de envio: o principal é o Salvar do Novo pedido ou o salvar da edição (BotoesDoResumoView)', () => {
    const tela = ler('modules/vendedor/app/components/novo-pedido-abas.tsx');
    const ini = tela.indexOf('function BotoesDoResumoView');
    expect(ini).toBeGreaterThan(-1);
    const view = tela.slice(ini, tela.indexOf('\nconst s = StyleSheet', ini));
    expect(view).toContain('botoesNovo.salvar');
    expect(view).not.toMatch(/\.enviar\b|apenasSalvar/);
  });

  it('a tela passa ao domain da edição os itens acima do máximo, o limite do pedido e os sem estoque calculados no aparelho', () => {
    const tela = ler('modules/vendedor/app/screens/new-order-screen.tsx');
    // os campos valem em qualquer ordem e com outros entre eles (a T-0168 pôs acima_do_limite, RN-VEN-11a)
    const chamada = /botoesDaEdicao\(\{[^}]*\}\)/.exec(tela)?.[0] ?? '';
    expect(chamada).toContain('itens_acima_do_maximo: calculo.acima_do_maximo');
    expect(chamada).toContain('acima_do_limite: calculo.acima_do_limite !== null');
    expect(chamada).toContain('itens_sem_estoque: semEstoque.map((x) => x.codigo)');
  });

  // RN-VEN-38 (R-20261124-114951): a folha de saída oferece o mesmo Salvar do Resumo (Pedido e Orçamento), mais Descartar.
  it('folha de saída (domain): as opções são as da escolha do Salvar, em todas as situações do cliente e da pré-venda', () => {
    const clientes = [LIBERADO, { ...LIBERADO, bloqueado: true }, { ...LIBERADO, ativo: false }, { ...LIBERADO, cadastro_incompleto: true, campos_faltantes: ['CEP'] }];
    for (const cliente of clientes) {
      for (const pre_venda_ligada of [true, false]) {
        const e = { cliente, pre_venda_ligada };
        const esc = botoesDoSalvarNovo(e).escolha;
        expect(opcoesDaSaida(e), JSON.stringify(e)).toEqual({ pedido: esc.pedido.visivel, orcamento: esc.orcamento.visivel });
      }
    }
  });

  it('folha de saída (tela): sem os alertas', () => {
    const tela = ler('modules/vendedor/app/screens/new-order-screen.tsx');
    expect(tela).not.toContain('alertas_impedem_enviar');
  });

  it('RN-VEN-48 (tela): o Enviar da aba Pedidos passa a pré-venda do tenant ao motivo (enviarPedidoSalvo)', () => {
    const estado = ler('modules/vendedor/app/state/use-vendedor.ts');
    const i = estado.indexOf('motivoDeNaoEnviarOSalvo({');
    expect(i).toBeGreaterThan(0);
    expect(estado.slice(i, estado.indexOf('});', i))).toMatch(/pre_venda_ligada: /);
  });
});

// ---------- detalhe: Alertas, ações e situação só no Histórico ----------
describe('T-0150 — detalhe do pedido/orçamento: Alertas no topo, situação só no Histórico', () => {
  const acoes = (o: Partial<EntradaAcoesDoDetalhe>) =>
    acoesDoDetalhe({ tipo: 'orcamento', status: 'received', situacao: 'aberto' as never, naFila: false, recusado: false, somenteLeitura: false, podeEditar: true, podeCancelar: true, podeDuplicar: true, podePdf: true, podeConverter: true, pedidoGeradoId: null, ...o });

  it('orçamento com item sem estoque (reconferência): alerta "BIS-400 sem estoque"; a principal é Editar e o Converter não aparece (premissa (c))', () => {
    const al = alertasDoDetalhe({ mudancas: [{ tipo: 'estoque', produto_id: 'p-bis', pedido_base: 10, disponivel_base: 3 }], codigoDoProduto: () => 'BIS-400' });
    expect(al.map((a) => a.texto)).toEqual(['BIS-400 sem estoque']);
    const a = acoes({ alertaImpedeTransformar: soOrcamentoPorAlertas(al) });
    expect(a.principal?.id).toBe('editar');
    expect([a.principal, ...a.icones, ...a.menu].map((x) => x?.id)).not.toContain('transformar');
    // controle: sem alerta, o Converter volta a ser a principal
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
    // âncora estável antes e depois do cabeçalho Azul noite do kit: o testID do cabeçalho do detalhe (o BackLink saiu do corpo)
    const inicio = tela.indexOf('testID="detalhe-cabecalho"');
    expect(inicio).toBeGreaterThan(0);
    const corpo = tela.slice(inicio);
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
    expect(tela).toMatch(/const calculoAtual = useMemo\(\s*\(\) =>\s*politica\s*\? calcularPedido\(\{ \.\.\.baseDoCalculo\(draft\), lines: draft\.lines/);
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
describe('T-0166 — botões e folha de saída sem "aviso" (RD-0176); "Título vencido" só acima do limite da RN-VEN-13 (RD-0172; à vista também desde a T-0184)', () => {
  const CLIENTES: Array<[string, typeof LIBERADO]> = [
    ['liberado', LIBERADO],
    ['cliente bloqueado', { ...LIBERADO, bloqueado: true }],
    ['cliente inativo', { ...LIBERADO, ativo: false }],
    ['cadastro incompleto', { ...LIBERADO, cadastro_incompleto: true, campos_faltantes: ['CEP'] }],
  ];
  const ITENS = [{}, { itens_acima_do_maximo: ['AGU-1500'] }, { itens_sem_estoque: ['BIS-400'] }];
  const semAviso = (b: object, nome: string) => {
    expect(Object.keys(b), nome).not.toContain('aviso');
    for (const v of Object.values(b)) if (v && typeof v === 'object') expect(Object.keys(v), nome).not.toContain('aviso');
  };

  it('RD-0176: botoesDaEdicao não devolve o campo "aviso" em nenhuma situação (o motivo fica só na área Alertas)', () => {
    for (const [nome, cliente] of CLIENTES) {
      for (const itens of ITENS) for (const editando of ['pedido', 'orcamento'] as const) semAviso(botoesDaEdicao({ cliente, editando, ...itens }), `${nome}, ${editando}, ${JSON.stringify(itens)}`);
    }
  });

  // T-0166: o subtituloOrcamento (sempre null desde a T-0141) também saiu do retorno
  it('RD-0176: opcoesDaSaida devolve só pedido e orcamento (sem "aviso" nem linha de motivo)', () => {
    for (const [nome, cliente] of CLIENTES) {
      for (const pre_venda_ligada of [true, false]) {
        expect(Object.keys(opcoesDaSaida({ cliente, pre_venda_ligada })).sort(), `${nome}, pré-venda ${pre_venda_ligada}`).toEqual(['orcamento', 'pedido']);
      }
    }
  });

  // RN-VEN-13: título vencido há mais de [5] dias → aprovação por inadimplência com qualquer forma de pagamento (T-0184, P1 A).
  // O alerta só aparece quando muda o resultado (RD-0172): acima do limite, a prazo ou à vista.
  const V = (dias: number) => ({ titulos: 2, valor_cents: 50_000, dias });
  const tituloNosAlertas = (dias: number, limite = TITULO_VENCIDO_DIAS_PADRAO) =>
    alertasDoPedido({ cliente: LIBERADO, vencidos: vencidosComEfeito(V(dias), limite) }).filter((a) => a.tipo === 'titulo').map((a) => a.texto);

  it('RN-VEN-13 (limite): padrão 5 dias; atraso de 5 dias a prazo não alerta (igual ao limite não passa); 6 dias alerta "Título vencido"', () => {
    expect(TITULO_VENCIDO_DIAS_PADRAO).toBe(5);
    expect(tituloVencidoDias({})).toBe(5);
    expect(tituloNosAlertas(5)).toEqual([]);
    expect(tituloNosAlertas(6)).toEqual(['Título vencido']);
    expect(tituloNosAlertas(120)).toEqual(['Título vencido']);
  });

  it('RN-VEN-13 (T-0184, P1 A): o alerta não depende do prazo escolhido (à vista, a prazo ou sem prazo): só do atraso e do limite; sem vencidos, nada', () => {
    expect(vencidosComEfeito).toHaveLength(2);
    expect(tituloNosAlertas(30)).toEqual(['Título vencido']);
    expect(vencidosComEfeito(null, 5)).toBeNull();
  });

  it('RN-VEN-13: o limite vem do parâmetro titulo_vencido_dias do tenant (10 dias: 10 não alerta, 11 alerta); parâmetro inválido volta ao padrão', () => {
    const limite = tituloVencidoDias({ titulo_vencido_dias: 10 });
    expect(limite).toBe(10);
    expect(tituloNosAlertas(10, limite)).toEqual([]);
    expect(tituloNosAlertas(11, limite)).toEqual(['Título vencido']);
    expect(tituloVencidoDias({ titulo_vencido_dias: '7' })).toBe(7);
    expect([tituloVencidoDias({ titulo_vencido_dias: -1 }), tituloVencidoDias({ titulo_vencido_dias: 2.5 }), tituloVencidoDias({ titulo_vencido_dias: '' })]).toEqual([5, 5, 5]);
  });

  it('RN-VEN-13: o título vencido não muda os botões (não é "só orçamento" nem impede enviar); o efeito é a aprovação', () => {
    const a = alertasDoPedido({ cliente: LIBERADO, vencidos: vencidosComEfeito(V(12), 5) });
    expect(a.map((x) => [x.tipo, x.texto, x.so_orcamento, x.impede_enviar])).toEqual([['titulo', 'Título vencido', false, false]]);
  });

  it('tela: o Novo pedido passa à área Alertas os vencidos filtrados por vencidosComEfeito, com o limite do tenant', () => {
    const tela = ler('modules/vendedor/app/screens/new-order-screen.tsx');
    expect(tela).toMatch(/vencidos: vencidosComEfeito\([^\n]*dias: credito\.alerta\.dias \} : null, tituloVencidoDias\(parametrosVendedor\)\)/);
    // a área Alertas não recebe os vencidos crus por outro caminho
    expect(tela.match(/vencidos:/g)).toHaveLength(1);
  });
});
