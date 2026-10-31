import { describe, expect, it } from 'vitest';
import { DecisaoAprovacao, ItemFilaAprovacao, type MembroEquipe } from '../contracts';
import { escopoDoUsuario } from './equipe';
import { filaDeAprovacoes, pedidoPendenteDeAprovacao, podeDecidir, resumirFila, situacaoDoPrazo, validarDecisao } from './aprovacoes';
import { CLIENTE_A, ev, statusAlterado, u } from './fixtures';
import { aplicarEventos, estadoInicial, type EventoRecebido } from './projecao';

const GER = u(1), SUP = u(2), V1 = u(11), V2 = u(12), OUTRO = u(13), SUP2 = u(3);
const m = (id: string, nome: string, perfil: MembroEquipe['perfil'], superior_id: string | null): MembroEquipe => ({ id, nome, perfil, superior_id, ativo: true });
const ROSTER = [m(GER, 'G', 'gerente', null), m(SUP, 'S', 'supervisor', GER), m(SUP2, 'S2', 'supervisor', GER), m(V1, 'V1', 'vendedor', SUP), m(V2, 'V2', 'vendedor', SUP), m(OUTRO, 'O', 'vendedor', SUP2)];

const solicita = (n: number, o: { vendedor?: string; nivel?: 'supervisor' | 'gerente' | 'analista'; em: string; credito?: boolean }): EventoRecebido =>
  ev('vendedor.pedido.aprovacao_solicitada@1', o.em, {
    pedido_id: u(1000 + n),
    vendedor_id: o.vendedor ?? V1,
    cliente_id: CLIENTE_A,
    solicitada_em: o.em,
    nivel: o.nivel ?? 'supervisor',
    motivos: ['desconto', 'credito'],
    desconto_efetivo_pct: 12.5,
    total_cents: 500_000,
    credito: o.credito === false ? null : { limite_cents: 1_000_000, saldo_aberto_cents: 700_000, disponivel_cents: 300_000 },
    historico: { ultima_compra_em: '2026-10-01T12:00:00Z', pedidos_90d: 4, ticket_medio_cents: 320_000 },
  });

const AGORA = '2026-10-31T12:00:00Z';
const montar = (eventos: EventoRecebido[]) => aplicarEventos(estadoInicial(), eventos).estado;
const MODULOS = new Set(['core', 'vendedor']);
const fila = (s: ReturnType<typeof montar>, viewer: { id: string; perfil: MembroEquipe['perfil'] }, modulos = MODULOS) =>
  filaDeAprovacoes({ estado: s, viewer, escopo: escopoDoUsuario(viewer, ROSTER), agora: AGORA, modulos });

describe('RF-GES-04: prazo da aprovação (fila com vencendo/vencido)', () => {
  it('prazo = solicitação + 24 h; no prazo, vencendo (≤ 4 h) e vencido (≤ 0 h)', () => {
    expect(situacaoDoPrazo('2026-10-31T00:00:00Z', '2026-10-31T12:00:00Z')).toEqual({ prazo_em: '2026-11-01T00:00:00.000Z', horas_restantes: 12, situacao: 'no_prazo' });
    expect(situacaoDoPrazo('2026-10-30T12:00:00Z', '2026-10-31T08:00:00Z')).toMatchObject({ horas_restantes: 4, situacao: 'vencendo' }); // limite do aviso inclusive
    expect(situacaoDoPrazo('2026-10-30T12:00:00Z', '2026-10-31T12:00:00Z')).toMatchObject({ horas_restantes: 0, situacao: 'vencido' }); // no instante do prazo já venceu
    expect(situacaoDoPrazo('2026-10-29T06:00:00Z', '2026-10-31T12:00:00Z')).toMatchObject({ horas_restantes: -30, situacao: 'vencido' });
  });

  it('prazo e aviso são parâmetros do tenant', () => {
    expect(situacaoDoPrazo('2026-10-31T00:00:00Z', '2026-10-31T12:00:00Z', { aprovacao_prazo_horas: 12 }).situacao).toBe('vencido');
    expect(situacaoDoPrazo('2026-10-31T00:00:00Z', '2026-10-31T12:00:00Z', { aprovacao_prazo_horas: 48, aprovacao_aviso_horas: 36 }).situacao).toBe('vencendo');
  });
});

describe('RF-GES-04: fila de aprovações do gestor', () => {
  const s = montar([
    solicita(1, { em: '2026-10-29T06:00:00Z' }), // prazo 30/10 06:00: vencido há 30 h
    solicita(2, { em: '2026-10-30T10:00:00Z', vendedor: V2 }), // prazo 31/10 10:00 → vencido há 2 h
    solicita(3, { em: '2026-10-30T14:00:00Z' }), // prazo 31/10 14:00 → vencendo (2 h)
    solicita(4, { em: '2026-10-31T09:00:00Z', nivel: 'gerente' }), // no prazo, nível gerente
    solicita(5, { em: '2026-10-31T09:00:00Z', vendedor: OUTRO }), // equipe do outro supervisor
    solicita(6, { em: '2026-10-31T09:00:00Z', nivel: 'analista' }), // alçada do analista: fica na fila do BKO do Vendedor
    solicita(7, { em: '2026-10-29T10:00:00Z' }), // já decidida abaixo
    statusAlterado({ pedido: u(1007), vendedor: V1, para: 'aprovado', em: '2026-10-30T09:00:00Z' }),
  ]);

  it('ordena do mais urgente: vencidos primeiro (mais atrasado antes), depois vencendo, depois no prazo', () => {
    const itens = fila(s, { id: SUP, perfil: 'supervisor' });
    expect(itens.map((i) => [i.pedido_id, i.situacao])).toEqual([
      [u(1001), 'vencido'],
      [u(1002), 'vencido'],
      [u(1003), 'vencendo'],
      [u(1004), 'no_prazo'],
    ]);
    itens.forEach((i) => expect(ItemFilaAprovacao.parse(i)).toEqual(i));
  });

  it('mostra crédito, histórico e desconto efetivo na mesma linha (RF-GES-04)', () => {
    const [primeiro] = fila(s, { id: SUP, perfil: 'supervisor' });
    expect(primeiro).toMatchObject({
      desconto_efetivo_pct: 12.5,
      total_cents: 500_000,
      credito: { limite_cents: 1_000_000, saldo_aberto_cents: 700_000, disponivel_cents: 300_000 },
      historico: { pedidos_90d: 4, ticket_medio_cents: 320_000 },
      horas_restantes: -30,
    });
  });

  it('RN-CORE-04: supervisor só vê a própria equipe; gerente vê as duas', () => {
    expect(fila(s, { id: SUP, perfil: 'supervisor' }).some((i) => i.vendedor_id === OUTRO)).toBe(false);
    expect(fila(s, { id: GER, perfil: 'gerente' }).map((i) => i.pedido_id)).toContain(u(1005));
  });

  it('a alçada é do Vendedor: só decide quem tem o perfil do nível pedido; o resto é acompanhamento', () => {
    const doSup = fila(s, { id: SUP, perfil: 'supervisor' });
    expect(doSup.find((i) => i.pedido_id === u(1001))!.pode_decidir).toBe(true);
    expect(doSup.find((i) => i.pedido_id === u(1004))!.pode_decidir).toBe(false); // nível gerente
    const doGer = fila(s, { id: GER, perfil: 'gerente' });
    expect(doGer.find((i) => i.pedido_id === u(1004))!.pode_decidir).toBe(true);
    expect(doGer.find((i) => i.pedido_id === u(1001))!.pode_decidir).toBe(false);
    expect(podeDecidir('supervisor', 'supervisor')).toBe(true);
    expect(podeDecidir('gerente', 'supervisor')).toBe(false);
  });

  it('pedidos de nível analista não entram na fila do Gestor (BKO do Vendedor)', () => {
    expect(fila(s, { id: GER, perfil: 'gerente' }).some((i) => i.pedido_id === u(1006))).toBe(false);
  });

  it('pedido já decidido (aprovado/rejeitado/cancelado depois da solicitação) sai da fila, mesmo se o status chegou antes', () => {
    expect(fila(s, { id: SUP, perfil: 'supervisor' }).some((i) => i.pedido_id === u(1007))).toBe(false);
    expect(pedidoPendenteDeAprovacao(s, u(1007))).toBe(false);
    expect(pedidoPendenteDeAprovacao(s, u(1001))).toBe(true);
    // fora de ordem: status 'rejeitado' chega antes da solicitação
    const fora = montar([statusAlterado({ pedido: u(1001), para: 'rejeitado', em: '2026-10-29T08:00:00Z' }), solicita(1, { em: '2026-10-29T06:00:00Z' })]);
    expect(pedidoPendenteDeAprovacao(fora, u(1001))).toBe(false);
  });

  it('edição depois da aprovação gera nova solicitação: volta para a fila (RN-VEN-31)', () => {
    const rev = montar([
      solicita(1, { em: '2026-10-29T06:00:00Z' }),
      statusAlterado({ pedido: u(1001), para: 'aprovado', em: '2026-10-29T07:00:00Z' }),
      solicita(1, { em: '2026-10-30T20:00:00Z' }),
    ]);
    const [item] = fila(rev, { id: SUP, perfil: 'supervisor' });
    expect(item!.solicitada_em).toBe('2026-10-30T20:00:00Z');
    expect(item!.situacao).toBe('no_prazo');
  });

  it('sem crédito/histórico no evento a linha mostra null (tela: "indisponível"), não quebra', () => {
    const sem = montar([solicita(1, { em: '2026-10-31T09:00:00Z', credito: false })]);
    expect(fila(sem, { id: SUP, perfil: 'supervisor' })[0]!.credito).toBeNull();
  });

  it('perfis sem fila (vendedor, promotor, analista) recebem lista vazia; Vendedor desativado também (RN-CORE-03)', () => {
    expect(fila(s, { id: V1, perfil: 'vendedor' })).toEqual([]);
    expect(fila(s, { id: u(50), perfil: 'analista' })).toEqual([]);
    expect(fila(s, { id: SUP, perfil: 'supervisor' }, new Set(['core']))).toEqual([]);
  });

  it('resumo: total, vencidos, vencendo e "para mim"', () => {
    expect(resumirFila(fila(s, { id: SUP, perfil: 'supervisor' }))).toEqual({ total: 4, vencidos: 2, vencendo: 1, para_mim: 3 });
  });
});

describe('RF-GES-04: decisão com comentário', () => {
  it('rejeitar exige o motivo (mínimo 3 caracteres); aprovar aceita sem comentário', () => {
    expect(validarDecisao({ pedido_id: u(1), decisao: 'rejeitar', comentario: '  ' })).toEqual({ ok: false, erros: ['RF-GES-04: informe o motivo da rejeição (mínimo 3 caracteres).'] });
    expect(validarDecisao({ pedido_id: u(1), decisao: 'rejeitar', comentario: 'Desconto alto' }).ok).toBe(true);
    const aprovar = validarDecisao({ pedido_id: u(1), decisao: 'aprovar' });
    expect(aprovar.ok).toBe(true);
    expect(DecisaoAprovacao.parse({ pedido_id: u(1), decisao: 'aprovar' }).comentario).toBeNull();
  });

  it('decisão com pedido sem UUID é recusada', () => {
    expect(validarDecisao({ pedido_id: 'abc', decisao: 'aprovar' }).ok).toBe(false);
  });
});
