import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import { lerPedidoFaturado, type EventoFaturadoNoDesafio, type PedidoFaturadoLido } from '../contracts';
import { avaliarPedidoNoDesafio, candidatoDoDesafio, referenciaDoDesafio, type DesafioVendas } from './desafio';
import { resolverParametros } from './parametros';
import { processarLote, type LancamentoXp } from './xp';

const desafio: DesafioVendas = {
  id: 'D1',
  tenant_id: 'tenant-1',
  nome: 'Semana do Café',
  ativo: true,
  produto_ids: ['cafe-250', 'cafe-500'],
  vigencia_inicio: '2026-10-26',
  vigencia_fim: '2026-11-01',
  xp_por_unidade: 2,
  xp_max_por_pedido: 20,
};
const pedido = (extra: Partial<EventoFaturadoNoDesafio> = {}): EventoFaturadoNoDesafio => ({
  evento_id: 'E1',
  pedido_id: 'P1',
  tenant_id: 'tenant-1',
  vendedor_id: 'u1',
  faturado_em: '2026-10-28T14:00:00Z',
  itens: [{ produto_id: 'cafe-250', quantidade: 3 }, { produto_id: 'outro', quantidade: 10 }],
  parcial: false,
  ...extra,
});
/** Pedido fora do contrato (sem faturamento): `lerPedidoFaturado` já o recusa; o domínio se defende assim mesmo. */
const naoFaturado = (extra: Partial<EventoFaturadoNoDesafio> = {}): EventoFaturadoNoDesafio =>
  ({ ...pedido(extra), faturado_em: null }) as unknown as EventoFaturadoNoDesafio;

describe('RF-TRE-06: desafio de vendas ligado a campanha (paga no faturamento)', () => {
  it('RF-TRE-06: XP = unidades dos itens da campanha × XP por unidade (3 × 2 = 6); itens fora da campanha não contam', () => {
    expect(avaliarPedidoNoDesafio(desafio, pedido())).toEqual({ elegivel: true, unidades: 3, pontos_base: 6 });
  });

  it('RF-TRE-06: soma itens repetidos e produtos diferentes da campanha', () => {
    const p = pedido({ itens: [{ produto_id: 'cafe-250', quantidade: 2 }, { produto_id: 'cafe-500', quantidade: 1 }, { produto_id: 'cafe-250', quantidade: 1 }] });
    expect(avaliarPedidoNoDesafio(desafio, p)).toMatchObject({ unidades: 4, pontos_base: 8 });
  });

  it('RF-TRE-06: o XP por pedido é limitado ao máximo do desafio (50 unidades × 2 → 20)', () => {
    expect(avaliarPedidoNoDesafio(desafio, pedido({ itens: [{ produto_id: 'cafe-500', quantidade: 50 }] }))).toMatchObject({ unidades: 50, pontos_base: 20 });
  });

  it('RF-TRE-06: pedido sem item da campanha não pontua', () => {
    expect(avaliarPedidoNoDesafio(desafio, pedido({ itens: [{ produto_id: 'outro', quantidade: 5 }] }))).toEqual({ elegivel: false, motivo: 'SEM_ITENS_DA_CAMPANHA' });
  });

  it('RF-TRE-06: vigência inclusiva nas duas pontas, no fuso do tenant (26/10 00:00 Manaus = 04:00Z)', () => {
    expect(avaliarPedidoNoDesafio(desafio, pedido({ faturado_em: '2026-10-26T04:00:00Z' })).elegivel).toBe(true);
    expect(avaliarPedidoNoDesafio(desafio, pedido({ faturado_em: '2026-10-26T03:59:00Z' }))).toEqual({ elegivel: false, motivo: 'FORA_DA_VIGENCIA' });
    expect(avaliarPedidoNoDesafio(desafio, pedido({ faturado_em: '2026-11-02T03:59:00Z' })).elegivel).toBe(true); // ainda 01/11 em Manaus
    expect(avaliarPedidoNoDesafio(desafio, pedido({ faturado_em: '2026-11-02T04:00:00Z' }))).toEqual({ elegivel: false, motivo: 'FORA_DA_VIGENCIA' });
  });

  it('RF-TRE-06: desafio inativo ou de outro tenant não pontua', () => {
    expect(avaliarPedidoNoDesafio({ ...desafio, ativo: false }, pedido())).toEqual({ elegivel: false, motivo: 'DESAFIO_INATIVO' });
    expect(avaliarPedidoNoDesafio(desafio, pedido({ tenant_id: 'tenant-2' }))).toEqual({ elegivel: false, motivo: 'OUTRO_TENANT' });
  });

  it('RF-TRE-06: quantidade inválida (zero, negativa) é ignorada', () => {
    expect(avaliarPedidoNoDesafio(desafio, pedido({ itens: [{ produto_id: 'cafe-250', quantidade: 0 }, { produto_id: 'cafe-500', quantidade: -2 }] }))).toEqual({ elegivel: false, motivo: 'SEM_ITENS_DA_CAMPANHA' });
  });

  it('RF-TRE-06: unidades fracionadas (kg) arredondam o XP para baixo — XP é inteiro', () => {
    const r = avaliarPedidoNoDesafio({ ...desafio, xp_por_unidade: 3 }, pedido({ itens: [{ produto_id: 'cafe-250', quantidade: 1.5 }] }));
    expect(r).toMatchObject({ unidades: 1.5, pontos_base: 4 });
  });

  it('RF-TRE-06: vira candidato de XP para o vendedor, na hora do faturamento, com referência desafio:pedido:total', () => {
    expect(candidatoDoDesafio(desafio, pedido(), 'lanc-1')).toEqual({
      id: 'lanc-1',
      tenant_id: 'tenant-1',
      usuario_id: 'u1',
      origem: 'desafio_vendas',
      referencia_id: 'D1:P1:total',
      pontos_base: 6,
      ocorrido_em: '2026-10-28T14:00:00Z',
      teto_desafio: { desafio_id: 'D1', max: 500 },
    });
    expect(candidatoDoDesafio(desafio, pedido({ itens: [] }), 'lanc-2')).toBeNull();
  });

  it('RN-TRE-08: o mesmo pedido entregue duas vezes (evento repetido) pontua uma vez só', () => {
    const c1 = candidatoDoDesafio(desafio, pedido(), 'lanc-1')!;
    const c2 = candidatoDoDesafio(desafio, pedido(), 'lanc-2')!;
    const r1 = processarLote([], [c1]);
    expect(r1.lancamentos).toHaveLength(1);
    const r2 = processarLote(r1.lancamentos, [c2]);
    expect(r2.lancamentos).toEqual([]);
    expect(r2.duplicados).toEqual([{ id: 'lanc-2', motivo: 'EVENTO' }]);
  });

  it('RF-TRE-06: dois desafios diferentes podem pontuar o mesmo pedido', () => {
    const outro = { ...desafio, id: 'D2' };
    const r = processarLote([], [candidatoDoDesafio(desafio, pedido(), 'a')!, candidatoDoDesafio(outro, pedido(), 'b')!]);
    expect(r.lancamentos).toHaveLength(2);
  });
});

describe('Ajuste C: o desafio paga no FATURAMENTO do pedido (status vindo do ERP), não na criação', () => {
  it('RF-TRE-06: pedido criado e ainda não faturado não gera XP (faturado_em ausente ou nulo)', () => {
    expect(avaliarPedidoNoDesafio(desafio, naoFaturado())).toEqual({ elegivel: false, motivo: 'PEDIDO_NAO_FATURADO' });
    expect(candidatoDoDesafio(desafio, naoFaturado(), 'lanc-1')).toBeNull();
    const semCampo: Partial<EventoFaturadoNoDesafio> = { ...pedido() };
    delete semCampo.faturado_em;
    expect(avaliarPedidoNoDesafio(desafio, semCampo as EventoFaturadoNoDesafio)).toEqual({ elegivel: false, motivo: 'PEDIDO_NAO_FATURADO' });
  });

  it('RF-TRE-06: a vigência e o dia do XP seguem o dia do faturamento, no fuso do tenant — não o da criação', () => {
    // faturado 01/11 em Manaus (02/11 03:59Z) ainda vale; o lançamento fica no dia do faturamento.
    const c = candidatoDoDesafio(desafio, pedido({ faturado_em: '2026-11-02T03:59:00Z' }), 'lanc-1')!;
    expect(c.ocorrido_em).toBe('2026-11-02T03:59:00Z');
    const r = processarLote([], [c]);
    expect(r.lancamentos[0]).toMatchObject({ dia: '2026-11-01', pontos: 6 });
  });

  it('RN-TRE-08: o mesmo retorno (mesmo evento_id) entregue duas vezes pontua uma vez só, mesmo sem histórico gravado', () => {
    const r1 = processarLote([], [candidatoDoDesafio(desafio, pedido(), 'a')!]);
    const r2 = processarLote(r1.lancamentos, [candidatoDoDesafio(desafio, pedido({ faturado_em: '2026-10-29T10:00:00Z' }), 'b')!]);
    expect(r2.lancamentos).toEqual([]);
    expect(r2.duplicados).toEqual([{ id: 'b', motivo: 'EVENTO' }]);
  });
});

describe('Ajuste A: teto próprio por desafio (xp_max_por_desafio), fora do teto diário', () => {
  // Pedido de 10 un. × 2 = 20 XP (igual ao máximo por pedido).
  const comTeto = { ...desafio, xp_max_por_desafio: 30 };
  const pedidoDe = (id: string, quando = '2026-10-28T14:00:00Z') => pedido({ pedido_id: id, faturado_em: quando, itens: [{ produto_id: 'cafe-250', quantidade: 10 }] });
  let n = 0;
  const lancar = (existentes: LancamentoXp[], d: DesafioVendas, ped: EventoFaturadoNoDesafio, params = resolverParametros()) =>
    processarLote(existentes, [candidatoDoDesafio(d, ped, `L${++n}`, { fuso: params.fuso, xp_max_por_desafio: params.xp_max_por_desafio })!], params).lancamentos;

  it('RF-TRE-06: teto do desafio atingido no meio de um pedido paga só o saldo (20 + 10 de 20)', () => {
    const l1 = lancar([], comTeto, pedidoDe('P1'));
    expect(l1[0]).toMatchObject({ pontos: 20, pontos_base: 20, limitado_pelo_teto: false });
    const l2 = lancar(l1, comTeto, pedidoDe('P2'));
    expect(l2[0]).toMatchObject({ pontos: 10, pontos_base: 20, limitado_pelo_teto: true });
  });

  it('RF-TRE-06: teto esgotado grava lançamento de 0 ponto (mantém idempotência e auditoria)', () => {
    const l1 = lancar([], comTeto, pedidoDe('P1'));
    const l2 = lancar(l1, comTeto, pedidoDe('P2'));
    const l3 = lancar([...l1, ...l2], comTeto, pedidoDe('P3'));
    expect(l3[0]).toMatchObject({ pontos: 0, pontos_base: 20, limitado_pelo_teto: true });
    const repetido = processarLote([...l1, ...l2, ...l3], [candidatoDoDesafio(comTeto, pedidoDe('P3'), 'outro-id')!]);
    expect(repetido.duplicados).toEqual([{ id: 'outro-id', motivo: 'EVENTO' }]);
    expect(l1.concat(l2, l3).reduce((s, l) => s + l.pontos, 0)).toBe(30);
  });

  it('RF-TRE-06: o teto acumula dentro do mesmo lote offline/ERP (pedidos faturados juntos)', () => {
    const lote = ['P1', 'P2', 'P3'].map((id, i) => candidatoDoDesafio(comTeto, pedidoDe(id, `2026-10-28T1${i}:00:00Z`), `X${i}`)!);
    const r = processarLote([], lote);
    expect(r.lancamentos.map((l) => l.pontos)).toEqual([20, 10, 0]);
  });

  it('RF-TRE-06: o teto vale por vendedor e por desafio — outro vendedor ou outro desafio têm o seu', () => {
    const l1 = lancar([], comTeto, pedidoDe('P1'));
    const outroVendedor = lancar(l1, comTeto, { ...pedidoDe('P2'), vendedor_id: 'u2' });
    expect(outroVendedor[0]!.pontos).toBe(20);
    const outroDesafio = lancar(l1, { ...comTeto, id: 'D2' }, pedidoDe('P1'));
    expect(outroDesafio[0]!.pontos).toBe(20);
  });

  it('RF-TRE-06: o desafio continua fora do teto diário — não consome nem sofre o de 200 XP', () => {
    const diario = resolverParametros({ xp_teto_diario: 5 });
    const l1 = lancar([], comTeto, pedidoDe('P1'), diario);
    expect(l1[0]).toMatchObject({ pontos: 20, limitado_pelo_teto: false });
  });

  it('RF-TRE-06: sem xp_max_por_desafio no cadastro vale o padrão do tenant (500); o do desafio tem prioridade', () => {
    expect(resolverParametros().xp_max_por_desafio).toBe(500);
    const grande = { ...desafio, xp_max_por_pedido: 400 };
    const c = (d: DesafioVendas, ped: EventoFaturadoNoDesafio, opcoes?: Parameters<typeof candidatoDoDesafio>[3]) => candidatoDoDesafio(d, ped, 'z', opcoes)!;
    const ped = pedido({ itens: [{ produto_id: 'cafe-250', quantidade: 300 }] });
    const a = processarLote([], [c(grande, ped)]).lancamentos[0]!;
    expect(a.pontos).toBe(400);
    const l1 = [a];
    const b = processarLote(l1, [candidatoDoDesafio(grande, pedido({ pedido_id: 'P9', itens: [{ produto_id: 'cafe-250', quantidade: 300 }] }), 'y')!]).lancamentos[0]!;
    expect(b).toMatchObject({ pontos: 100, pontos_base: 400 }); // 500 - 400
    const c2 = processarLote(l1, [candidatoDoDesafio({ ...grande, xp_max_por_desafio: 1000 }, pedido({ pedido_id: 'P9', itens: [{ produto_id: 'cafe-250', quantidade: 300 }] }), 'y')!]).lancamentos[0]!;
    expect(c2.pontos).toBe(400);
  });

  it('RF-TRE-06: xp_max_por_desafio 0 = sem teto no desafio', () => {
    const livre = { ...desafio, xp_max_por_desafio: 0 };
    const l1 = lancar([], livre, pedidoDe('P1'));
    const l2 = lancar(l1, livre, pedidoDe('P2'));
    expect(l2[0]!.pontos).toBe(20);
  });
});

describe('RN-TRE-08: vários retornos do mesmo pedido — o consumidor soma os itens e é idempotente por evento_id (docs/desenho/T-0011.md §2)', () => {
  let n = 0;
  const id = () => `Q${++n}`;
  const parcial = (evento_id: string, itens: EventoFaturadoNoDesafio['itens'], extra: Partial<EventoFaturadoNoDesafio> = {}) => pedido({ evento_id, parcial: true, itens, ...extra });
  const total = (evento_id: string, itens: EventoFaturadoNoDesafio['itens'], extra: Partial<EventoFaturadoNoDesafio> = {}) => pedido({ evento_id, parcial: false, itens, ...extra });
  /** Processa um evento como a API faz: gera o candidato vendo os lançamentos já gravados e grava o aceito. */
  const processar = (existentes: LancamentoXp[], ped: EventoFaturadoNoDesafio, d: DesafioVendas = desafio) => {
    const c = candidatoDoDesafio(d, ped, id(), { lancamentos: existentes });
    const r = processarLote(existentes, c ? [c] : []);
    return { cand: c, novos: r.lancamentos, todos: [...existentes, ...r.lancamentos] };
  };
  const cafe = (quantidade: number, produto_id = 'cafe-250') => ({ produto_id, quantidade });

  it('RN-TRE-08: pedido sem faturamento (apenas criado) não gera XP nem candidato', () => {
    expect(candidatoDoDesafio(desafio, naoFaturado(), id())).toBeNull();
    expect(candidatoDoDesafio(desafio, naoFaturado({ parcial: true }), id())).toBeNull();
    expect(processar([], naoFaturado()).novos).toEqual([]);
  });

  it('RN-TRE-08: parcial sem itens (vazio) é ignorada — PARCIAL_SEM_ITENS, sem XP nem lançamento', () => {
    const p = parcial('E1', []);
    expect(avaliarPedidoNoDesafio(desafio, p)).toEqual({ elegivel: false, motivo: 'PARCIAL_SEM_ITENS' });
    expect(candidatoDoDesafio(desafio, p, id())).toBeNull();
    expect(processar([], p).novos).toEqual([]);
  });

  it('RN-TRE-08: total (parcial ausente ou false) com itens vazios segue como SEM_ITENS_DA_CAMPANHA', () => {
    expect(avaliarPedidoNoDesafio(desafio, pedido({ itens: [] }))).toEqual({ elegivel: false, motivo: 'SEM_ITENS_DA_CAMPANHA' });
    expect(avaliarPedidoNoDesafio(desafio, pedido({ itens: [], parcial: false }))).toEqual({ elegivel: false, motivo: 'SEM_ITENS_DA_CAMPANHA' });
  });

  it('RN-TRE-08: a chave natural é desafio:pedido:evento_id (parcial) ou desafio:pedido:total (total)', () => {
    expect(referenciaDoDesafio('D1', parcial('E7', [cafe(1)]))).toBe('D1:P1:E7');
    expect(referenciaDoDesafio('D1', total('E8', [cafe(1)]))).toBe('D1:P1:total');
    const { cand, novos } = processar([], parcial('E7', [cafe(2), cafe(1, 'cafe-500'), cafe(9, 'outro')]));
    expect(cand).toMatchObject({ referencia_id: 'D1:P1:E7', pontos_base: 6 });
    expect(novos[0]).toMatchObject({ origem: 'desafio_vendas', usuario_id: 'u1', pontos: 6, ocorrido_em: '2026-10-28T14:00:00Z' });
  });

  it('RN-TRE-08: o mesmo evento entregue duas vezes não paga duas vezes (com histórico, sem histórico e no mesmo lote)', () => {
    const ev = parcial('E1', [cafe(2)]);
    const a = processar([], ev);
    expect(a.novos).toHaveLength(1);
    expect(processar(a.todos, ev).cand).toBeNull(); // histórico gravado
    // sem histórico: a chave natural de proporLancamento barra
    const r = processarLote(a.todos, [candidatoDoDesafio(desafio, ev, 'outro-id')!]);
    expect(r.lancamentos).toEqual([]);
    expect(r.duplicados).toEqual([{ id: 'outro-id', motivo: 'EVENTO' }]);
    const lote = processarLote([], [candidatoDoDesafio(desafio, ev, 'x1')!, candidatoDoDesafio(desafio, ev, 'x2')!]);
    expect(lote.lancamentos).toHaveLength(1);
  });

  it('RN-TRE-08: duas parciais do mesmo produto pagam as duas quantidades', () => {
    const a = processar([], parcial('E1', [cafe(2)]));
    const b = processar(a.todos, parcial('E2', [cafe(3)], { faturado_em: '2026-10-29T10:00:00Z' }));
    expect(a.novos.map((l) => l.pontos)).toEqual([4]);
    expect(b.novos.map((l) => [l.referencia_id, l.pontos, l.dia])).toEqual([['D1:P1:E2', 6, '2026-10-29']]);
  });

  it('RN-TRE-08: parcial + total (saldo) paga a soma das quantidades dos dois eventos', () => {
    const a = processar([], parcial('E1', [cafe(2)])); // 4
    const b = processar(a.todos, total('E2', [cafe(1), cafe(4, 'cafe-500')], { faturado_em: '2026-10-30T10:00:00Z' })); // saldo: 5 un. = 10
    expect(b.cand).toMatchObject({ referencia_id: 'D1:P1:total', pontos_base: 10 });
    expect(b.novos[0]).toMatchObject({ pontos: 10, dia: '2026-10-30' });
    expect(b.todos.reduce((s, l) => s + l.pontos, 0)).toBe(14); // (2 + 5) unidades × 2
  });

  it('RN-TRE-08: o total depois de parciais paga as quantidades que vierem nele — não desconta item "já pago"', () => {
    const a = processar([], parcial('E1', [cafe(2)])); // 4
    const b = processar(a.todos, total('E2', [cafe(2)])); // o saldo de cafe-250 também é 2: paga 4
    expect(b.novos.map((l) => l.pontos)).toEqual([4]);
  });

  it('RN-TRE-08: um segundo total do mesmo pedido não paga, nem com outro evento_id', () => {
    const a = processar([], total('E1', [cafe(3)]));
    expect(a.novos).toHaveLength(1);
    expect(processar(a.todos, total('E2', [cafe(3)], { faturado_em: '2026-10-29T10:00:00Z' })).cand).toBeNull();
    // sem histórico, a chave desafio:pedido:total também barra
    const r = processarLote(a.todos, [candidatoDoDesafio(desafio, total('E2', [cafe(3)]), 'b')!]);
    expect(r.lancamentos).toEqual([]);
    expect(r.duplicados).toEqual([{ id: 'b', motivo: 'EVENTO' }]);
  });

  it('RN-TRE-08: o máximo por pedido soma os eventos — o evento que o atinge paga só o saldo (cap 20)', () => {
    const a = processar([], parcial('E1', [cafe(6)])); // 12
    const b = processar(a.todos, total('E2', [cafe(50, 'cafe-500')])); // 100 → resta 8
    expect(b.novos[0]).toMatchObject({ pontos: 8, pontos_base: 8 });
    expect(processar(b.todos, parcial('E3', [cafe(5)])).cand).toBeNull(); // pedido no teto: nada mais
  });

  it('RN-TRE-08: o teto do desafio atingido no meio de um evento paga só o saldo e depois 0 (30: 20 + 10 + 0)', () => {
    const comTeto = { ...desafio, xp_max_por_pedido: 100, xp_max_por_desafio: 30 };
    const a = processar([], parcial('E1', [cafe(10)]), comTeto); // 20
    const b = processar(a.todos, parcial('E2', [cafe(10, 'cafe-500')]), comTeto); // 20 → 10
    const c = processar(b.todos, parcial('E3', [cafe(1)]), comTeto); // 0
    expect(a.novos[0]).toMatchObject({ pontos: 20, limitado_pelo_teto: false });
    expect(b.novos[0]).toMatchObject({ pontos: 10, pontos_base: 20, limitado_pelo_teto: true });
    expect(c.novos[0]).toMatchObject({ pontos: 0, limitado_pelo_teto: true });
  });

  it('RN-TRE-08: o histórico é do vendedor e do desafio — outro vendedor ou outro desafio pagam o mesmo evento', () => {
    const a = processar([], total('E1', [cafe(3)]));
    expect(processar(a.todos, total('E1', [cafe(3)], { vendedor_id: 'u2' })).novos).toHaveLength(1);
    expect(processar(a.todos, total('E1', [cafe(3)]), { ...desafio, id: 'D2' }).novos).toHaveLength(1);
  });

  it('RN-TRE-08: evento de outro tenant ou fora da vigência não paga', () => {
    expect(candidatoDoDesafio(desafio, parcial('E1', [cafe(1)], { tenant_id: 'tenant-2' }), id())).toBeNull();
    expect(candidatoDoDesafio(desafio, parcial('E1', [cafe(1)], { faturado_em: '2026-11-02T04:00:00Z' }), id())).toBeNull();
  });
});

describe('T-0036: leitura do evento `vendedor.pedido.faturado@1` com o tipo único do contrato', () => {
  const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const TENANT = u(100);
  const dUuid: DesafioVendas = { ...desafio, id: u(50), tenant_id: TENANT, produto_ids: [u(3)] };
  const envelope = { evento_id: u(70), tenant_id: TENANT };
  const payload = { pedido_id: u(1), vendedor_id: u(2), faturado_em: '2026-10-28T14:00:00Z', itens: [{ produto_id: u(3), quantidade: 4 }], parcial: false, total_cents: 999 };

  it('RN-TRE-08: a entrada do domínio é o tipo do contrato — payload lido + evento_id e tenant_id do envelope (muda o contrato, quebra o typecheck)', () => {
    type Entrada = Parameters<typeof candidatoDoDesafio>[1];
    expectTypeOf<Entrada>().toEqualTypeOf<EventoFaturadoNoDesafio>();
    expectTypeOf<z.infer<typeof PedidoFaturadoLido> & { evento_id: string; tenant_id: string }>().toMatchTypeOf<Entrada>();
    expectTypeOf<NonNullable<ReturnType<typeof lerPedidoFaturado>>>().toEqualTypeOf<Entrada>();
  });

  it('RN-TRE-08: evento lido do envelope vira XP no vendedor do pedido; reentregue (mesmo evento_id), não paga de novo', () => {
    const ev = lerPedidoFaturado(payload, envelope)!;
    expect(ev).toEqual({ pedido_id: u(1), vendedor_id: u(2), faturado_em: '2026-10-28T14:00:00Z', itens: [{ produto_id: u(3), quantidade: 4 }], parcial: false, evento_id: u(70), tenant_id: TENANT });
    const r1 = processarLote([], [candidatoDoDesafio(dUuid, ev, u(80))!]);
    expect(r1.lancamentos[0]).toMatchObject({ tenant_id: TENANT, usuario_id: u(2), origem: 'desafio_vendas', referencia_id: `${u(50)}:${u(1)}:total`, pontos: 8 });
    const deNovo = lerPedidoFaturado(payload, envelope)!;
    expect(candidatoDoDesafio(dUuid, deNovo, u(81), { lancamentos: r1.lancamentos })).toBeNull();
  });

  it('RN-TRE-08: o tenant do envelope prevalece — payload que traz outro tenant_id não pontua no desafio do tenant errado', () => {
    const ev = lerPedidoFaturado({ ...payload, tenant_id: u(999), evento_id: u(998) }, envelope)!;
    expect(ev).toMatchObject({ tenant_id: TENANT, evento_id: u(70) });
    const outroTenant = lerPedidoFaturado(payload, { ...envelope, tenant_id: u(101) })!;
    expect(avaliarPedidoNoDesafio(dUuid, outroTenant)).toEqual({ elegivel: false, motivo: 'OUTRO_TENANT' });
  });

  it('RF-TRE-06: o mesmo `params` do tenant vai ao candidato e ao lote — vigência e dia do XP no mesmo fuso', () => {
    const sp = resolverParametros({ fuso: 'America/Sao_Paulo' });
    const manaus = resolverParametros({ fuso: 'America/Manaus' });
    // 26/10 03:30Z = 00:30 de 26/10 em São Paulo (dentro da vigência) e 23:30 de 25/10 em Manaus (fora).
    const ev = lerPedidoFaturado({ ...payload, faturado_em: '2026-10-26T03:30:00Z' }, envelope)!;
    const c = candidatoDoDesafio(dUuid, ev, u(82), { ...sp, lancamentos: [] })!;
    expect(processarLote([], [c], sp).lancamentos[0]).toMatchObject({ dia: '2026-10-26', pontos: 8 });
    expect(candidatoDoDesafio(dUuid, ev, u(83), { ...manaus, lancamentos: [] })).toBeNull();
  });
});
