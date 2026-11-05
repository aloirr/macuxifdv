/** T-0077: busca e período Dia | Mês | Ano da lista de Pedidos (RF-VEN-05). Funções puras; fuso do tenant. */
import { describe, expect, it } from 'vitest';
import {
  casaComBusca,
  contarPorSituacao,
  deslocarPeriodo,
  destacarTrecho,
  diasComPedido,
  filtrarLista,
  mesesDoPeriodo,
  normalizarTexto,
  numeroSemZeros,
  periodoDe,
  periodoForaDaJanela,
  periodoParcialNaJanela,
  resumoDaLista,
  resumoDaSituacao,
  situacaoEfetiva,
  chipsComAtivo,
  rotuloDoPeriodo,
  type ItemDaBusca,
  intervaloDoPeriodo,
} from './busca-periodo';

const TZ = 'America/Manaus';
const item = (o: Partial<ItemDaBusca>): ItemDaBusca => ({
  id: 'x',
  numero: '000011',
  nome_fantasia: 'Atacadinho Cachoeirinha',
  razao_social: 'Atacadinho Cachoeirinha Comércio Ltda',
  tipo: 'pedido',
  status: 'approved',
  local: false,
  total_cents: 1000,
  emitido_em: '2026-11-02T15:00:00Z',
  status_alterado_em: '2026-11-02T15:00:00Z',
  ...o,
});

describe('T-0077: texto da busca', () => {
  it('RF-VEN-05: normaliza sem acento e sem maiúscula', () => {
    expect(normalizarTexto('  Mercadão São JORGE ')).toBe('mercadao sao jorge');
  });
  it('RF-VEN-05: número sem zeros à esquerda ("11" = "000011")', () => {
    expect(numeroSemZeros('000011')).toBe('11');
    expect(numeroSemZeros('0000')).toBe('0');
    expect(numeroSemZeros('')).toBe('');
  });
  it('RF-VEN-05: acha por nome fantasia, razão social e número com e sem zeros', () => {
    const i = item({});
    expect(casaComBusca(i, 'cachoeir')).toBe(true);
    expect(casaComBusca(i, 'COMERCIO ltda')).toBe(true);
    expect(casaComBusca(i, '11')).toBe(true);
    expect(casaComBusca(i, '000011')).toBe(true);
    expect(casaComBusca(i, '0011')).toBe(true);
    expect(casaComBusca(i, '12')).toBe(false);
    expect(casaComBusca(i, 'zzz')).toBe(false);
  });
  it('RF-VEN-05: busca vazia casa tudo', () => {
    expect(casaComBusca(item({}), '   ')).toBe(true);
  });
  it('RF-VEN-05: destaca o trecho encontrado preservando acento e maiúscula do original', () => {
    expect(destacarTrecho('Atacadinho Cachoeirinha', 'cachoeir')).toEqual([
      { texto: 'Atacadinho ', destaque: false },
      { texto: 'Cachoeir', destaque: true },
      { texto: 'inha', destaque: false },
    ]);
    expect(destacarTrecho('Mercadão', 'mercadao')).toEqual([{ texto: 'Mercadão', destaque: true }]);
    expect(destacarTrecho('Mercado', '')).toEqual([{ texto: 'Mercado', destaque: false }]);
    expect(destacarTrecho('Mercado', 'xyz')).toEqual([{ texto: 'Mercado', destaque: false }]);
  });
});

describe('T-0077: período Dia | Mês | Ano no fuso do tenant', () => {
  it('RF-VEN-05: período do instante no fuso (31/10 23:30 em Manaus ainda é outubro)', () => {
    const agora = '2026-11-01T03:30:00Z';
    expect(periodoDe('dia', agora, TZ)).toEqual({ tipo: 'dia', valor: '2026-10-31' });
    expect(periodoDe('mes', agora, TZ)).toEqual({ tipo: 'mes', valor: '2026-10' });
    expect(periodoDe('ano', agora, TZ)).toEqual({ tipo: 'ano', valor: '2026' });
  });
  it('RF-VEN-05: ‹ › andam um dia, um mês, um ano (vira mês e ano)', () => {
    expect(deslocarPeriodo({ tipo: 'dia', valor: '2026-10-31' }, 1).valor).toBe('2026-11-01');
    expect(deslocarPeriodo({ tipo: 'dia', valor: '2026-01-01' }, -1).valor).toBe('2025-12-31');
    expect(deslocarPeriodo({ tipo: 'mes', valor: '2026-12' }, 1).valor).toBe('2027-01');
    expect(deslocarPeriodo({ tipo: 'mes', valor: '2026-01' }, -1).valor).toBe('2025-12');
    expect(deslocarPeriodo({ tipo: 'ano', valor: '2026' }, -1).valor).toBe('2025');
  });
  it('RF-VEN-05: rótulos "Seg, 02/11/2026", "Novembro 2026" e "2026"', () => {
    expect(rotuloDoPeriodo({ tipo: 'dia', valor: '2026-11-02' })).toBe('Seg, 02/11/2026');
    expect(rotuloDoPeriodo({ tipo: 'mes', valor: '2026-11' })).toBe('Novembro 2026');
    expect(rotuloDoPeriodo({ tipo: 'ano', valor: '2026' })).toBe('2026');
  });
  it('RF-VEN-05: meses de um ano (lista de meses) em ordem', () => {
    expect(mesesDoPeriodo('2026')).toHaveLength(12);
    expect(mesesDoPeriodo('2026')[0]).toBe('2026-01');
  });
});

describe('T-0077: o que a lista mostra', () => {
  const o10 = item({ id: 'o10', numero: '000003', emitido_em: '2026-10-31T15:00:00Z', status_alterado_em: '2026-11-02T14:00:00Z' });
  const antigo = item({ id: 'antigo', numero: '000001', emitido_em: '2026-10-05T15:00:00Z', status_alterado_em: '2026-10-06T15:00:00Z' });
  const nov = item({ id: 'nov', numero: '000012', nome_fantasia: 'Mercadinho São Jorge', razao_social: 'São Jorge ME' });
  const lista = [o10, antigo, nov];

  it('RF-VEN-05: emitido 31/10 e aprovado 02/11 aparece em novembro (por status) e em outubro (por emissão)', () => {
    const emNov = filtrarLista(lista, { periodo: { tipo: 'mes', valor: '2026-11' }, busca: '', tz: TZ }).map((i) => i.id);
    const emOut = filtrarLista(lista, { periodo: { tipo: 'mes', valor: '2026-10' }, busca: '', tz: TZ }).map((i) => i.id);
    expect(emNov).toEqual(['o10', 'nov']);
    expect(emOut).toEqual(['o10', 'antigo']);
  });
  it('RF-VEN-05: o fuso do tenant decide o mês (31/10 23:30 em Manaus ainda é outubro)', () => {
    const virada = item({ id: 'v', emitido_em: '2026-11-01T03:30:00Z', status_alterado_em: '2026-11-01T03:30:00Z' });
    expect(filtrarLista([virada], { periodo: { tipo: 'mes', valor: '2026-11' }, busca: '', tz: TZ })).toHaveLength(0);
    expect(filtrarLista([virada], { periodo: { tipo: 'mes', valor: '2026-10' }, busca: '', tz: TZ })).toHaveLength(1);
  });
  it('RF-VEN-05: período Dia e Ano', () => {
    expect(filtrarLista(lista, { periodo: { tipo: 'dia', valor: '2026-11-02' }, busca: '', tz: TZ }).map((i) => i.id)).toEqual(['o10', 'nov']);
    expect(filtrarLista(lista, { periodo: { tipo: 'dia', valor: '2026-10-31' }, busca: '', tz: TZ }).map((i) => i.id)).toEqual(['o10']);
    expect(filtrarLista(lista, { periodo: { tipo: 'ano', valor: '2026' }, busca: '', tz: TZ })).toHaveLength(3);
    expect(filtrarLista(lista, { periodo: { tipo: 'ano', valor: '2025' }, busca: '', tz: TZ })).toHaveLength(0);
  });
  it('RF-VEN-05: com texto na busca ignora o período e procura em toda a janela', () => {
    const r = filtrarLista(lista, { periodo: { tipo: 'dia', valor: '2026-11-20' }, busca: 'sao jorge', tz: TZ });
    expect(r.map((i) => i.id)).toEqual(['nov']);
    expect(filtrarLista(lista, { periodo: { tipo: 'dia', valor: '2026-11-20' }, busca: '3', tz: TZ }).map((i) => i.id)).toEqual(['o10']);
  });
  it('RF-VEN-05: pedido na fila entra pela data de criação no aparelho', () => {
    const fila = item({ id: 'f', local: true, status: 'queued', emitido_em: '2026-11-04T10:00:00Z', status_alterado_em: null });
    expect(filtrarLista([fila], { periodo: { tipo: 'mes', valor: '2026-11' }, busca: '', tz: TZ })).toHaveLength(1);
    expect(filtrarLista([fila], { periodo: { tipo: 'mes', valor: '2026-10' }, busca: '', tz: TZ })).toHaveLength(0);
  });
  it('RF-VEN-05: dias com pedido do mês (marca no calendário), por emissão ou mudança de status', () => {
    expect(diasComPedido(lista, '2026-11', TZ)).toEqual(['2026-11-02']);
    expect(diasComPedido(lista, '2026-10', TZ)).toEqual(['2026-10-05', '2026-10-06', '2026-10-31']);
  });
});

describe('T-0077: chips de situação e resumo', () => {
  const l = [
    item({ id: '1', status: 'pending_approval', total_cents: 100 }),
    item({ id: '2', status: 'approved', total_cents: 200 }),
    item({ id: '3', status: 'sent_to_erp', total_cents: 300 }),
    item({ id: '4', status: 'rejected', total_cents: 400 }),
    item({ id: '5', status: 'queued', local: true, total_cents: 500 }),
    item({ id: '6', tipo: 'orcamento', status: 'received', total_cents: 600 }),
    item({ id: '7', status: 'cancelled', total_cents: 700 }),
  ];
  it('RF-VEN-05: contagem por situação; só as que têm itens aparecem', () => {
    const c = contarPorSituacao(l);
    expect(c.todos).toBe(7);
    expect(c.aguardando).toBe(1);
    expect(c.aprovados).toBe(2);
    expect(c.rejeitados).toBe(1);
    expect(c.orcamentos).toBe(1);
    expect(c.na_fila).toBe(1);
    expect(c.chips.map((x) => x.id)).toEqual(['todos', 'aguardando', 'aprovados', 'rejeitados', 'orcamentos', 'na_fila']);
    expect(contarPorSituacao([l[1]!]).chips.map((x) => x.id)).toEqual(['todos', 'aprovados']);
  });
  it('RF-VEN-05: resumo conta pedidos (sem orçamento, sem cancelado) e soma em centavos', () => {
    expect(resumoDaLista(l)).toEqual({ quantidade: 5, total_cents: 1500 });
  });
});

describe('T-0077: período fora da janela do aparelho (90 dias)', () => {
  const agora = '2026-11-04T20:00:00Z';
  it('RF-VEN-05: mês e ano inteiros além de 90 dias estão fora; o mês atual e o que cruza o limite não', () => {
    expect(periodoForaDaJanela({ tipo: 'mes', valor: '2026-05' }, agora, TZ)).toBe(true);
    expect(periodoForaDaJanela({ tipo: 'ano', valor: '2025' }, agora, TZ)).toBe(true);
    expect(periodoForaDaJanela({ tipo: 'mes', valor: '2026-11' }, agora, TZ)).toBe(false);
    expect(periodoForaDaJanela({ tipo: 'ano', valor: '2026' }, agora, TZ)).toBe(false);
    expect(periodoForaDaJanela({ tipo: 'mes', valor: '2026-08' }, agora, TZ)).toBe(false);
  });
  it('RF-VEN-05: dia anterior ao limite está fora; o limite em si não', () => {
    expect(periodoForaDaJanela({ tipo: 'dia', valor: '2026-08-04' }, agora, TZ)).toBe(true);
    expect(periodoForaDaJanela({ tipo: 'dia', valor: '2026-08-06' }, agora, TZ)).toBe(false);
  });
});

describe('T-0077 (R1): a busca ignora período e situação', () => {
  it('RF-VEN-05: com texto, a situação vira Todos (inclusive a_faturar vindo do Início); sem texto, volta a escolhida', () => {
    expect(situacaoEfetiva('aprovados', true)).toBe('todos');
    expect(situacaoEfetiva('a_faturar', true)).toBe('todos');
    expect(situacaoEfetiva('decide', true)).toBe('todos');
    expect(situacaoEfetiva('aprovados', false)).toBe('aprovados');
    expect(situacaoEfetiva('a_faturar', false)).toBe('a_faturar');
  });
  it('RF-VEN-05: com texto o período é ignorado e ao apagar o texto vale o período anterior', () => {
    const a = item({ id: 'a', emitido_em: '2026-09-02T15:00:00Z', status_alterado_em: null });
    const b = item({ id: 'b', emitido_em: '2026-11-02T15:00:00Z', status_alterado_em: null });
    const periodo = { tipo: 'mes' as const, valor: '2026-11' };
    expect(filtrarLista([a, b], { periodo, busca: 'atacadinho', tz: TZ }).map((x) => x.id)).toEqual(['a', 'b']);
    expect(filtrarLista([a, b], { periodo, busca: '', tz: TZ }).map((x) => x.id)).toEqual(['b']);
  });
});

describe('T-0077 (Y1, Y2): chip ativo com 0 e resumo de orçamentos', () => {
  it('RF-VEN-05: o chip ativo continua na linha mesmo com 0 itens', () => {
    const c = contarPorSituacao([item({ id: '1' })]);
    expect(c.chips.map((x) => x.id)).toEqual(['todos', 'aprovados']);
    expect(chipsComAtivo(c.chips, 'rejeitados').map((x) => `${x.id}:${x.quantidade}`)).toEqual(['todos:1', 'aprovados:1', 'rejeitados:0']);
    expect(chipsComAtivo(c.chips, 'aprovados')).toEqual(c.chips);
    expect(chipsComAtivo(c.chips, 'todos')).toEqual(c.chips);
  });
  it('RF-VEN-05: com Orçamentos ativo o resumo soma os orçamentos', () => {
    const l = [item({ id: '1', tipo: 'orcamento', total_cents: 600 }), item({ id: '2', tipo: 'orcamento', total_cents: 400 })];
    expect(resumoDaSituacao(l, 'orcamentos')).toEqual({ quantidade: 2, total_cents: 1000, orcamentos: true });
    expect(resumoDaSituacao(l, 'todos')).toEqual({ quantidade: 0, total_cents: 0, orcamentos: false });
  });
});

describe('T-0077 (Y8): mês só em parte dentro dos 90 dias', () => {
  const agora = '2026-11-04T20:00:00Z';
  it('RF-VEN-05: começa antes da janela e termina dentro = parcial', () => {
    expect(periodoParcialNaJanela({ tipo: 'mes', valor: '2026-08' }, agora, TZ)).toBe(true);
    expect(periodoParcialNaJanela({ tipo: 'ano', valor: '2026' }, agora, TZ)).toBe(true);
    expect(periodoParcialNaJanela({ tipo: 'mes', valor: '2026-11' }, agora, TZ)).toBe(false);
    expect(periodoParcialNaJanela({ tipo: 'mes', valor: '2026-05' }, agora, TZ)).toBe(false);
    expect(periodoParcialNaJanela({ tipo: 'dia', valor: '2026-08-06' }, agora, TZ)).toBe(false);
  });
});

describe('T-0077 D1: data da última mudança de status', async () => {
  const { ultimaMudancaDeStatus } = await import('./busca-periodo');
  const ev = (de: string | null, para: string, ocorrido_em: string) => ({ de, para, ocorrido_em });
  it('RF-VEN-05: vale o último evento com de diferente de nulo, não o updated_at regravado', () => {
    const eventos = [ev(null, 'received', '2026-10-15T15:00:00Z'), ev('received', 'approved', '2026-10-16T15:00:00Z')];
    expect(ultimaMudancaDeStatus(eventos, '2026-11-03T15:00:00Z')).toBe('2026-10-16T15:00:00Z');
  });
  it('RF-VEN-05: pega a mais recente mesmo fora de ordem', () => {
    const eventos = [ev('approved', 'sent_to_erp', '2026-10-20T10:00:00Z'), ev('received', 'approved', '2026-10-16T15:00:00Z')];
    expect(ultimaMudancaDeStatus(eventos, '2026-11-03T15:00:00Z')).toBe('2026-10-20T10:00:00Z');
  });
  it('RF-VEN-05: só o evento de criação = nunca mudou de status', () => {
    expect(ultimaMudancaDeStatus([ev(null, 'received', '2026-10-15T15:00:00Z')], '2026-11-03T15:00:00Z')).toBeNull();
  });
  it('RF-VEN-05: sem nenhum evento no aparelho cai no updated_at', () => {
    expect(ultimaMudancaDeStatus([], '2026-11-03T15:00:00Z')).toBe('2026-11-03T15:00:00Z');
    expect(ultimaMudancaDeStatus([], '')).toBeNull();
  });
});

describe('RF-VEN-05 / T-0077 item 6: intervalo do período para consultar o servidor', () => {
  it('dia, mês e ano viram from/to em data civil (fuso do tenant)', () => {
    expect(intervaloDoPeriodo({ tipo: 'dia', valor: '2026-02-03' })).toEqual({ from: '2026-02-03', to: '2026-02-03' });
    expect(intervaloDoPeriodo({ tipo: 'mes', valor: '2026-02' })).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(intervaloDoPeriodo({ tipo: 'mes', valor: '2024-02' })).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(intervaloDoPeriodo({ tipo: 'ano', valor: '2025' })).toEqual({ from: '2025-01-01', to: '2025-12-31' });
  });
});

describe('T-0077 (acabamento): chip ativo com 0 fica no lugar dele na ordem', () => {
  it('RF-VEN-05: Rejeitados 0 entra entre Aprovados e Na fila, não no fim', () => {
    const c = contarPorSituacao([item({ id: '1' }), item({ id: '2', local: true })]);
    expect(c.chips.map((x) => x.id)).toEqual(['todos', 'aprovados', 'na_fila']);
    expect(chipsComAtivo(c.chips, 'rejeitados').map((x) => `${x.id}:${x.quantidade}`)).toEqual(['todos:1', 'aprovados:1', 'rejeitados:0', 'na_fila:1'].map((x) => (x === 'todos:1' ? 'todos:2' : x)));
    expect(chipsComAtivo(c.chips, 'aguardando').map((x) => x.id)).toEqual(['todos', 'aguardando', 'aprovados', 'na_fila']);
  });
});
