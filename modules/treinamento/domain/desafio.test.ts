import { describe, expect, it } from 'vitest';
import { avaliarPedidoNoDesafio, candidatoDoDesafio, candidatosDoDesafio, type DesafioVendas, type PedidoFaturadoLido } from './desafio';
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
const pedido = (extra: Partial<PedidoFaturadoLido> = {}): PedidoFaturadoLido => ({
  pedido_id: 'P1',
  tenant_id: 'tenant-1',
  vendedor_id: 'u1',
  faturado_em: '2026-10-28T14:00:00Z',
  itens: [{ produto_id: 'cafe-250', quantidade: 3 }, { produto_id: 'outro', quantidade: 10 }],
  ...extra,
});

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

  it('RF-TRE-06: vira candidato de XP para o vendedor, na hora do faturamento, com referência desafio:pedido', () => {
    expect(candidatoDoDesafio(desafio, pedido(), 'lanc-1')).toEqual({
      id: 'lanc-1',
      tenant_id: 'tenant-1',
      usuario_id: 'u1',
      origem: 'desafio_vendas',
      referencia_id: 'D1:P1',
      pontos_base: 6,
      ocorrido_em: '2026-10-28T14:00:00Z',
      teto_desafio: { desafio_id: 'D1', max: 500 },
    });
    expect(candidatoDoDesafio(desafio, pedido({ itens: [] }), 'lanc-2')).toBeNull();
  });

  it('RF-TRE-06: o mesmo pedido entregue duas vezes (evento repetido) pontua uma vez só', () => {
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
    expect(avaliarPedidoNoDesafio(desafio, pedido({ faturado_em: null }))).toEqual({ elegivel: false, motivo: 'PEDIDO_NAO_FATURADO' });
    expect(candidatoDoDesafio(desafio, pedido({ faturado_em: null }), 'lanc-1')).toBeNull();
    const semCampo = { ...pedido() } as Partial<PedidoFaturadoLido>;
    delete semCampo.faturado_em;
    expect(avaliarPedidoNoDesafio(desafio, semCampo as PedidoFaturadoLido)).toEqual({ elegivel: false, motivo: 'PEDIDO_NAO_FATURADO' });
  });

  it('RF-TRE-06: a vigência e o dia do XP seguem o dia do faturamento, no fuso do tenant — não o da criação', () => {
    // faturado 01/11 em Manaus (02/11 03:59Z) ainda vale; o lançamento fica no dia do faturamento.
    const c = candidatoDoDesafio(desafio, pedido({ faturado_em: '2026-11-02T03:59:00Z' }), 'lanc-1')!;
    expect(c.ocorrido_em).toBe('2026-11-02T03:59:00Z');
    const r = processarLote([], [c]);
    expect(r.lancamentos[0]).toMatchObject({ dia: '2026-11-01', pontos: 6 });
  });

  it('RF-TRE-06: o mesmo pedido faturado entregue duas vezes pontua uma vez (idempotência por pedido_id)', () => {
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
  const lancar = (existentes: LancamentoXp[], d: DesafioVendas, ped: PedidoFaturadoLido, params = resolverParametros()) =>
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
    const c = (d: DesafioVendas, ped: PedidoFaturadoLido, opcoes?: Parameters<typeof candidatoDoDesafio>[3]) => candidatoDoDesafio(d, ped, 'z', opcoes)!;
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

describe('Ajuste C (v2): faturamento parcial — idempotência por item (premissa registrada em regras.md §8)', () => {
  // Premissa (desenho docs/desenho/T-0011.md não encontrado): total → chave por pedido_id (`D:P`); parcial → chave por
  // (pedido_id, produto_id) (`D:P:produto`); item já pago não paga de novo; sem estorno.
  let n = 0;
  const id = () => `Q${++n}`;
  const parcial = (itens: PedidoFaturadoLido['itens'], extra: Partial<PedidoFaturadoLido> = {}) => pedido({ parcial: true, itens, ...extra });
  /** Processa um evento como a API faz: gera candidatos vendo os lançamentos já gravados e grava os aceitos. */
  const processar = (existentes: LancamentoXp[], ped: PedidoFaturadoLido, d: DesafioVendas = desafio) => {
    const cands = candidatosDoDesafio(d, ped, id, { lancamentos: existentes });
    const r = processarLote(existentes, cands);
    return { cands, novos: r.lancamentos, todos: [...existentes, ...r.lancamentos] };
  };

  it('RF-TRE-06: pedido sem faturamento (apenas criado) não gera XP nem candidato', () => {
    expect(candidatosDoDesafio(desafio, pedido({ faturado_em: null }), id)).toEqual([]);
    expect(candidatosDoDesafio(desafio, pedido({ faturado_em: null, parcial: true }), id)).toEqual([]);
  });

  it('RF-TRE-06: faturamento parcial sem itens (vazio) é ignorado — PARCIAL_SEM_ITENS, sem XP nem lançamento', () => {
    const p = parcial([]);
    expect(avaliarPedidoNoDesafio(desafio, p)).toEqual({ elegivel: false, motivo: 'PARCIAL_SEM_ITENS' });
    expect(candidatosDoDesafio(desafio, p, id)).toEqual([]);
    expect(processar([], p).novos).toEqual([]);
  });

  it('RF-TRE-06: faturamento total (parcial ausente ou false) com itens vazios segue como SEM_ITENS_DA_CAMPANHA', () => {
    expect(avaliarPedidoNoDesafio(desafio, pedido({ itens: [] }))).toEqual({ elegivel: false, motivo: 'SEM_ITENS_DA_CAMPANHA' });
    expect(avaliarPedidoNoDesafio(desafio, pedido({ itens: [], parcial: false }))).toEqual({ elegivel: false, motivo: 'SEM_ITENS_DA_CAMPANHA' });
  });

  it('RF-TRE-06: parcial paga por item, com a chave desafio:pedido:produto e o dia do faturamento', () => {
    const { cands, novos } = processar([], parcial([{ produto_id: 'cafe-250', quantidade: 2 }, { produto_id: 'cafe-500', quantidade: 1 }, { produto_id: 'outro', quantidade: 9 }]));
    expect(cands.map((c) => [c.referencia_id, c.pontos_base])).toEqual([['D1:P1:cafe-250', 4], ['D1:P1:cafe-500', 2]]);
    expect(novos.map((l) => l.pontos)).toEqual([4, 2]);
    expect(novos[0]).toMatchObject({ origem: 'desafio_vendas', usuario_id: 'u1', ocorrido_em: '2026-10-28T14:00:00Z' });
  });

  it('RF-TRE-06: o mesmo pedido faturado duas vezes não paga duas vezes (total e parcial)', () => {
    const t1 = processar([], pedido());
    expect(t1.novos).toHaveLength(1);
    expect(processar(t1.todos, pedido({ faturado_em: '2026-10-29T10:00:00Z' })).novos).toEqual([]);
    const itens = [{ produto_id: 'cafe-250', quantidade: 2 }];
    const p1 = processar([], parcial(itens));
    expect(p1.novos).toHaveLength(1);
    expect(processar(p1.todos, parcial(itens, { faturado_em: '2026-10-29T10:00:00Z' })).cands).toEqual([]);
  });

  it('RF-TRE-06: parcial seguido de total paga só o restante (itens ainda não pagos)', () => {
    const a = processar([], parcial([{ produto_id: 'cafe-250', quantidade: 2 }]));
    expect(a.novos.map((l) => l.pontos)).toEqual([4]);
    // O total traz o pedido inteiro (3 de cafe-250 e 4 de cafe-500); cafe-250 já foi pago na parcial.
    const b = processar(a.todos, pedido({ faturado_em: '2026-10-30T10:00:00Z', itens: [{ produto_id: 'cafe-250', quantidade: 3 }, { produto_id: 'cafe-500', quantidade: 4 }] }));
    expect(b.cands.map((c) => [c.referencia_id, c.pontos_base])).toEqual([['D1:P1', 8]]);
    expect(b.novos[0]).toMatchObject({ pontos: 8, dia: '2026-10-30' });
  });

  it('RF-TRE-06: o máximo por pedido vale para o pedido todo — o que a parcial já pagou desconta do total (cap 20)', () => {
    const a = processar([], parcial([{ produto_id: 'cafe-250', quantidade: 6 }])); // 12 XP
    const b = processar(a.todos, pedido({ itens: [{ produto_id: 'cafe-500', quantidade: 50 }] })); // 100 → resta 8
    expect(b.novos[0]).toMatchObject({ pontos: 8, pontos_base: 8 });
  });

  it('RF-TRE-06: total já pago, depois uma parcial do mesmo pedido, não paga nada', () => {
    const a = processar([], pedido());
    expect(processar(a.todos, parcial([{ produto_id: 'cafe-250', quantidade: 3 }, { produto_id: 'cafe-500', quantidade: 5 }])).cands).toEqual([]);
  });

  it('RF-TRE-06: total depois de parciais que já pagaram todos os itens da campanha não paga nada', () => {
    const a = processar([], parcial([{ produto_id: 'cafe-250', quantidade: 3 }]));
    expect(processar(a.todos, pedido({ itens: [{ produto_id: 'cafe-250', quantidade: 3 }] })).cands).toEqual([]);
  });

  it('RF-TRE-06: item já pago não paga de novo numa 2ª parcial, mas item novo paga; a quantidade é a faturada no evento', () => {
    const a = processar([], parcial([{ produto_id: 'cafe-250', quantidade: 1 }]));
    const b = processar(a.todos, parcial([{ produto_id: 'cafe-250', quantidade: 5 }, { produto_id: 'cafe-500', quantidade: 2 }], { faturado_em: '2026-10-29T10:00:00Z' }));
    expect(b.cands.map((c) => [c.referencia_id, c.pontos_base])).toEqual([['D1:P1:cafe-500', 4]]);
  });

  it('RF-TRE-06: o histórico é do vendedor e do desafio — outro vendedor ou outro desafio pagam o mesmo pedido', () => {
    const a = processar([], pedido());
    expect(processar(a.todos, pedido({ vendedor_id: 'u2' })).novos).toHaveLength(1);
    expect(processar(a.todos, pedido(), { ...desafio, id: 'D2' }).novos).toHaveLength(1);
  });

  it('RF-TRE-06: teto do desafio atingido no meio de um pedido parcial paga só o saldo e depois 0 (30 de 20 + 20)', () => {
    const comTeto = { ...desafio, xp_max_por_pedido: 100, xp_max_por_desafio: 30 };
    const { novos } = processar([], parcial([{ produto_id: 'cafe-250', quantidade: 10 }, { produto_id: 'cafe-500', quantidade: 10 }]), comTeto);
    expect(novos.map((l) => [l.pontos, l.pontos_base, l.limitado_pelo_teto])).toEqual([[20, 20, false], [10, 20, true]]);
  });

  it('RF-TRE-06: candidatoDoDesafio (atalho do faturamento total) recusa o evento parcial — use candidatosDoDesafio', () => {
    expect(() => candidatoDoDesafio(desafio, parcial([{ produto_id: 'cafe-250', quantidade: 1 }]), 'x')).toThrow(RangeError);
  });
});
