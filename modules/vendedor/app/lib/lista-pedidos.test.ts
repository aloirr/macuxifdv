import { describe, expect, it } from 'vitest';

import { mesesDoSeletor, pedidosDaLista, porTipo, rotuloDaAba, subtituloDaLista } from './lista-pedidos';

const base = { local: false, local_error: '' };
const ped = (id: string, received_at: string, extra: object = {}) => ({ id, received_at, status: 'approved', total_cents: 100, ...base, ...extra }) as never;

describe('lista de pedidos', () => {
  it('Gestão não mostra Na fila nem Integrados', () => {
    expect(rotuloDaAba('queued', true)).toBe(false);
    expect(rotuloDaAba('queued', false)).toBe(true);
  });
  it('Campo: só o mês corrente no fuso do tenant, mais fila e pendentes; Gestão: toda a janela', () => {
    const lista = [
      ped('a', '2026-11-01T03:30:00Z'), // 31/10 23:30 em Manaus: mês anterior
      ped('b', '2026-11-01T04:30:00Z'), // 01/11 00:30 em Manaus
      ped('c', '2026-09-10T12:00:00Z', { status: 'pending_approval' }),
      ped('d', '2026-09-10T12:00:00Z', { local: true }),
      ped('e', '2026-09-10T12:00:00Z'),
    ];
    const campo = pedidosDaLista(lista, { gestao: false, mes: '2026-11', tz: 'America/Manaus' }).map((o) => o.id);
    expect(campo).toEqual(['b', 'c', 'd']);
    expect(pedidosDaLista(lista, { gestao: true, mes: '2026-11', tz: 'America/Manaus' })).toHaveLength(5);
  });
  it('RF-VEN-05: pedido de outubro aprovado em novembro aparece em novembro com o status novo (virada do mês no fuso do tenant)', () => {
    const lista = [
      ped('o10', '2026-10-31T15:00:00Z', { updated_at: '2026-11-02T14:00:00Z', status: 'approved' }),
      ped('antigo', '2026-10-05T15:00:00Z', { updated_at: '2026-10-06T15:00:00Z' }),
      ped('virada', '2026-10-31T10:00:00Z', { updated_at: '2026-11-01T03:30:00Z' }), // 31/10 23:30 em Manaus: ainda outubro
    ];
    const nov = pedidosDaLista(lista, { gestao: false, mes: '2026-11', mesAtual: '2026-11', tz: 'America/Manaus' }).map((o) => o.id);
    expect(nov).toEqual(['o10']);
    const out = pedidosDaLista(lista, { gestao: false, mes: '2026-10', mesAtual: '2026-11', tz: 'America/Manaus' }).map((o) => o.id);
    expect(out).toEqual(['o10', 'antigo', 'virada']);
  });
  it('RF-VEN-05: fila e aguardando aprovação só entram no mês atual', () => {
    const lista = [ped('c', '2026-10-10T12:00:00Z', { status: 'pending_approval', updated_at: '2026-10-10T12:00:00Z' }), ped('d', '2026-10-10T12:00:00Z', { local: true })];
    expect(pedidosDaLista(lista, { gestao: false, mes: '2026-11', mesAtual: '2026-11', tz: 'America/Manaus' })).toHaveLength(2);
    expect(pedidosDaLista(lista, { gestao: false, mes: '2026-10', mesAtual: '2026-11', tz: 'America/Manaus' }).map((o) => o.id)).toEqual(['c']);
  });
  it('RF-VEN-05: o seletor oferece só meses com pedido dentro da janela de 90 dias, do mais novo ao mais antigo', () => {
    const lista = [ped('a', '2026-10-31T15:00:00Z', { updated_at: '2026-11-02T14:00:00Z' }), ped('b', '2026-07-20T15:00:00Z', { updated_at: '2026-07-20T15:00:00Z' }), ped('c', '2026-09-10T15:00:00Z', { updated_at: '2026-09-10T15:00:00Z' })];
    expect(mesesDoSeletor(lista, { mesAtual: '2026-11', tz: 'America/Manaus', agora: new Date('2026-11-02T15:00:00Z') })).toEqual(['2026-11', '2026-10', '2026-09']);
    expect(mesesDoSeletor([], { mesAtual: '2026-11', tz: 'America/Manaus', agora: new Date('2026-11-02T15:00:00Z') })).toEqual(['2026-11']);
  });
  it('subtítulo: o Campo mostra o mês; a Gestão mostra "Equipe" (a lista não é filtrada por mês)', () => {
    expect(subtituloDaLista({ gestao: false, mesNome: 'Novembro', quantidade: 2, totalTexto: 'R$ 1' })).toBe('Novembro · 2 pedidos · R$ 1');
    expect(subtituloDaLista({ gestao: true, mesNome: 'Novembro', quantidade: 1, totalTexto: 'R$ 1' })).toBe('Equipe · 1 pedido · R$ 1');
  });
});

describe('filtro Pedidos | Orçamentos (RN-VEN-18)', () => {
  const agora = new Date('2026-11-05T12:00:00Z');
  const orc = (id: string, validade_ate: string, extra: object = {}) => ped(id, '2026-11-01T12:00:00Z', { tipo: 'orcamento', status: 'received', validade_ate, ...extra });
  const lista = [
    ped('p1', '2026-11-02T12:00:00Z'),
    orc('longe', '2026-11-20T03:00:00Z'),
    orc('perto', '2026-11-08T03:00:00Z'),
    orc('vencido', '2026-11-03T03:00:00Z'),
    orc('virou', '2026-11-20T03:00:00Z', { convertido_pedido_id: 'p9' }),
  ];
  it('RN-VEN-18: "Pedidos" não traz orçamento', () => {
    expect(porTipo(lista, 'pedido', agora).map((o) => o.id)).toEqual(['p1']);
  });
  it('RN-VEN-18: "Orçamentos" põe os abertos primeiro, por validade (o mais perto de vencer no topo), depois os outros', () => {
    expect(porTipo(lista, 'orcamento', agora).map((o) => o.id)).toEqual(['perto', 'longe', 'vencido', 'virou']);
  });
});
