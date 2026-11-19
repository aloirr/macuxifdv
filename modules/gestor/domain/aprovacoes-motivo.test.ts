import { describe, expect, it } from 'vitest';
import { ItemFilaAprovacao, type MembroEquipe, type MotivoAprovacao, type NivelAprovacao } from '../contracts';
import { escopoDoUsuario } from './equipe';
import { filaDeAprovacoes, motivosPendentes, pedidoPendenteDeAprovacao, registrarDecisao } from './aprovacoes';
import { CLIENTE_A, ev, statusAlterado, u } from './fixtures';
import { aplicarEvento, aplicarEventos, estadoInicial, type EventoRecebido } from './projecao';

const GER = u(1);
const SUP = u(2);
const V1 = u(11);
const m = (id: string, nome: string, perfil: MembroEquipe['perfil'], superior_id: string | null): MembroEquipe => ({ id, nome, perfil, superior_id, ativo: true });
const ROSTER = [m(GER, 'G', 'gerente', null), m(SUP, 'S', 'supervisor', GER), m(V1, 'V1', 'vendedor', SUP)];
const AGORA = '2026-10-30T20:00:00Z';
const SOLIC = '2026-10-30T19:00:00Z';
const MODULOS = new Set(['core', 'vendedor']);
const PEDIDO = u(1021);

type Aprovacao = { motivo: MotivoAprovacao; nivel: NivelAprovacao };
const PADRAO: Aprovacao[] = [
  { motivo: 'credito', nivel: 'gerente' },
  { motivo: 'inadimplencia', nivel: 'gerente' },
  { motivo: 'desconto', nivel: 'supervisor' },
];

/** `aprovacao_solicitada@2` do pedido 000021: crédito e inadimplência no gerente (padrão P5 B), desconto no supervisor. */
const solicita = (em = SOLIC, aprovacoes: Aprovacao[] = PADRAO): EventoRecebido =>
  ev('vendedor.pedido.aprovacao_solicitada@2', em, {
    pedido_id: PEDIDO,
    vendedor_id: V1,
    cliente_id: CLIENTE_A,
    solicitada_em: em,
    nivel: 'gerente',
    motivos: aprovacoes.map((a) => a.motivo),
    aprovacoes: aprovacoes.map((a) => ({ ...a, texto: '' })),
    desconto_efetivo_pct: 12,
    total_cents: 248_000,
    credito: { limite_cents: 1_000_000, saldo_aberto_cents: 812_000, disponivel_cents: 188_000 },
    inadimplencia: { maior_atraso_dias: 12, vencidos_cents: 40_000 },
    pedido_numero: '000021',
  });
const decidida = (motivo: MotivoAprovacao, decisao: 'aprovada' | 'rejeitada' | 'devolvida' | 'encerrada', em = '2026-10-30T19:30:00Z', ciclo = 1, id?: string): EventoRecebido =>
  ev('vendedor.pedido.aprovacao_decidida@1', em, { pedido_id: PEDIDO, vendedor_id: V1, ciclo, motivo, decisao, decidida_em: em }, id);

const montar = (eventos: EventoRecebido[]) => aplicarEventos(estadoInicial(), eventos).estado;
const fila = (s: ReturnType<typeof montar>, perfil: MembroEquipe['perfil'], id = perfil === 'gerente' ? GER : SUP) =>
  filaDeAprovacoes({ estado: s, viewer: { id, perfil }, escopo: escopoDoUsuario({ id, perfil }, ROSTER), agora: AGORA, modulos: MODULOS });

describe('T-0184 P3 B: uma aprovação por motivo, cada aprovador vê só os que decide', () => {
  const s = montar([solicita()]);

  it('RN-VEN-12 e RN-VEN-13: o gerente vê crédito e inadimplência, um motivo cada, e o desconto que decide acima do nível', () => {
    const [item] = fila(s, 'gerente');
    expect(item!.aprovacoes.map((a) => [a.motivo, a.nivel, a.pode_decidir])).toEqual([
      ['credito', 'gerente', true],
      ['inadimplencia', 'gerente', true],
      ['desconto', 'supervisor', true],
    ]);
    expect(item).toMatchObject({ pedido_numero: '000021', inadimplencia: { maior_atraso_dias: 12, vencidos_cents: 40_000 }, nivel: 'gerente', acima_do_nivel: true });
    expect(ItemFilaAprovacao.parse(item)).toEqual(item);
  });

  it('o supervisor vê só o desconto: os motivos do nível gerente não aparecem para ele', () => {
    const [item] = fila(s, 'supervisor');
    expect(item!.aprovacoes.map((a) => a.motivo)).toEqual(['desconto']);
    expect(item!.motivos).toEqual(['desconto']);
    expect(item!.nivel).toBe('supervisor');
  });

  it('RN-GES-07: analista e admin leem todos os motivos do Gestor, sem decidir', () => {
    const [item] = fila(s, 'analista', u(50));
    expect(item!.aprovacoes).toHaveLength(3);
    expect(item!.pode_decidir).toBe(false);
  });

  it('motivo do nível analista fica fora da fila do Gestor (BKO do Vendedor); o pedido continua com os outros', () => {
    const misto = montar([
      solicita(SOLIC, [
        { motivo: 'credito', nivel: 'analista' },
        { motivo: 'desconto', nivel: 'supervisor' },
      ]),
    ]);
    expect(fila(misto, 'gerente')[0]!.aprovacoes.map((a) => a.motivo)).toEqual(['desconto']);
    expect(fila(montar([solicita(SOLIC, [{ motivo: 'credito', nivel: 'analista' }])]), 'gerente')).toEqual([]);
  });
});

describe('T-0184 P7 A e P8 A: decisões em paralelo; a rejeição encerra as outras', () => {
  it('aprovar um motivo tira só o cartão dele; o pedido segue na fila até todas serem aprovadas', () => {
    const s = montar([solicita(), decidida('inadimplencia', 'aprovada')]);
    expect(motivosPendentes(s, PEDIDO).map((x) => x.motivo)).toEqual(['credito', 'desconto']);
    expect(fila(s, 'gerente')[0]!.aprovacoes.map((a) => a.motivo)).toEqual(['credito', 'desconto']);
    const todas = montar([solicita(), decidida('credito', 'aprovada'), decidida('inadimplencia', 'aprovada'), decidida('desconto', 'aprovada')]);
    expect(pedidoPendenteDeAprovacao(todas, PEDIDO)).toBe(false);
    expect(fila(todas, 'gerente')).toEqual([]);
  });

  it('a rejeição de um motivo tira o pedido da fila: os outros chegam como `encerrada`', () => {
    const s = montar([solicita(), decidida('credito', 'rejeitada'), decidida('inadimplencia', 'encerrada'), decidida('desconto', 'encerrada')]);
    expect(fila(s, 'gerente')).toEqual([]);
    // mesmo antes do `encerrada` chegar, o status do pedido (cancelado ou rejeitado) já o tira da fila
    const soStatus = montar([solicita(), decidida('credito', 'devolvida'), statusAlterado({ pedido: PEDIDO, vendedor: V1, para: 'rejeitado', em: '2026-10-30T19:31:00Z' })]);
    expect(fila(soStatus, 'gerente')).toEqual([]);
  });

  it('fora de ordem: a decisão chega antes da solicitação e vale do mesmo jeito', () => {
    const s = montar([decidida('credito', 'aprovada'), solicita()]);
    expect(motivosPendentes(s, PEDIDO).map((x) => x.motivo)).toEqual(['inadimplencia', 'desconto']);
    expect(fila(montar([decidida('credito', 'aprovada')]), 'gerente')).toEqual([]);
  });

  it('idempotente: o mesmo evento é `duplicado` e a mesma decisão com outro evento_id não conta duas vezes', () => {
    const d = decidida('credito', 'aprovada', undefined, undefined, 'dec-1');
    const base = aplicarEvento(montar([solicita()]), d);
    expect(base.situacao).toBe('aplicado');
    expect(aplicarEvento(base.estado, d).situacao).toBe('duplicado');
    const outra = aplicarEvento(base.estado, decidida('credito', 'aprovada'));
    expect(Object.keys(outra.estado.aprovacoes[PEDIDO]!.decisoes)).toEqual(['1|credito']);
    expect(motivosPendentes(outra.estado, PEDIDO).map((x) => x.motivo)).toEqual(['inadimplencia', 'desconto']);
  });

  it('devolver e reenviar (ciclo 2): a nova solicitação traz os motivos de volta à fila', () => {
    const s = montar([solicita(), decidida('credito', 'devolvida'), decidida('inadimplencia', 'encerrada'), decidida('desconto', 'encerrada'), solicita('2026-10-30T19:45:00Z')]);
    expect(fila(s, 'gerente')[0]!.aprovacoes.map((a) => a.motivo)).toEqual(['credito', 'inadimplencia', 'desconto']);
  });

  it('o `@1` do histórico da outbox vira uma aprovação por motivo, no nível da raiz', () => {
    const antigo = ev('vendedor.pedido.aprovacao_solicitada@1', SOLIC, {
      pedido_id: PEDIDO,
      vendedor_id: V1,
      cliente_id: CLIENTE_A,
      solicitada_em: SOLIC,
      nivel: 'gerente',
      motivos: ['desconto', 'credito'],
      desconto_efetivo_pct: 12,
      total_cents: 248_000,
    });
    const [item] = fila(montar([antigo]), 'gerente');
    expect(item!.aprovacoes.map((a) => [a.motivo, a.nivel])).toEqual([
      ['desconto', 'gerente'],
      ['credito', 'gerente'],
    ]);
    expect(item!.inadimplencia).toBeNull();
  });
});

describe('T-0184: registrar a decisão por motivo (RN-GES-04, RN-GES-08)', () => {
  const s = montar([solicita()]);
  const decidir = (perfil: MembroEquipe['perfil'], entrada: unknown, estado = s) =>
    registrarDecisao({ estado, viewer: { id: perfil === 'gerente' ? GER : SUP, perfil }, membros: ROSTER, agora: AGORA, entrada });

  it('com motivo, vale só para ele: o registro leva o motivo e o nível dele', () => {
    expect(decidir('gerente', { pedido_id: PEDIDO, decisao: 'aprovar', motivo: 'inadimplencia' })).toMatchObject({
      ok: true,
      registro: { motivo: 'inadimplencia', nivel_pedido: 'gerente', acima_do_nivel: false },
      avisos: [],
    });
  });

  it('supervisor num motivo do nível gerente: FORA_DA_ALCADA; num motivo que já saiu da fila: NAO_PENDENTE', () => {
    expect(decidir('supervisor', { pedido_id: PEDIDO, decisao: 'aprovar', motivo: 'credito' })).toMatchObject({ ok: false, codigo: 'FORA_DA_ALCADA' });
    const sem = montar([solicita(), decidida('credito', 'aprovada')]);
    expect(decidir('gerente', { pedido_id: PEDIDO, decisao: 'aprovar', motivo: 'credito' }, sem)).toMatchObject({ ok: false, codigo: 'NAO_PENDENTE' });
  });

  it('sem motivo, o supervisor decide o que alcança (o desconto) e o gerente decide tudo, avisando o supervisor pelo que está acima do nível', () => {
    expect(decidir('supervisor', { pedido_id: PEDIDO, decisao: 'aprovar' })).toMatchObject({ ok: true, registro: { motivo: null, nivel_pedido: 'supervisor' } });
    expect(decidir('gerente', { pedido_id: PEDIDO, decisao: 'aprovar' })).toMatchObject({
      ok: true,
      registro: { nivel_pedido: 'gerente', acima_do_nivel: true },
      avisos: [{ destinatario_id: SUP, motivo: null }],
    });
  });

  it('RN-GES-08: devolver e rejeitar exigem o motivo escrito; aprovar não', () => {
    for (const decisao of ['devolver', 'rejeitar']) {
      expect(decidir('gerente', { pedido_id: PEDIDO, decisao, motivo: 'credito' })).toMatchObject({ ok: false, codigo: 'DECISAO_INVALIDA' });
      expect(decidir('gerente', { pedido_id: PEDIDO, decisao, motivo: 'credito', comentario: 'Cliente com título vencido' })).toMatchObject({ ok: true, registro: { decisao, motivo: 'credito' } });
    }
  });
});
