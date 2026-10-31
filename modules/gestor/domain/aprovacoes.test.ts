import { describe, expect, it } from 'vitest';
import { AvisoDecisaoAoSupervisor, DecisaoAprovacao, ItemFilaAprovacao, RegistroDecisaoAprovacao, type MembroEquipe } from '../contracts';
import { escopoDoUsuario } from './equipe';
import { filaDeAprovacoes, pedidoPendenteDeAprovacao, podeDecidir, registrarDecisao, resumirFila, situacaoDoPrazo, supervisorDoVendedor, validarDecisao } from './aprovacoes';
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

// sexta 30/10/2026 16:00 em Manaus (horário comercial padrão seg–sex 08:00–18:00, RN-GES-03)
const AGORA = '2026-10-30T20:00:00Z';
const montar = (eventos: EventoRecebido[]) => aplicarEventos(estadoInicial(), eventos).estado;
const MODULOS = new Set(['core', 'vendedor']);
const fila = (s: ReturnType<typeof montar>, viewer: { id: string; perfil: MembroEquipe['perfil'] }, modulos = MODULOS) =>
  filaDeAprovacoes({ estado: s, viewer, escopo: escopoDoUsuario(viewer, ROSTER), agora: AGORA, modulos });

describe('RF-GES-04 / RN-GES-03: prazo da aprovação em horas úteis (fila com vencendo/vencido)', () => {
  const SEXTA_17H = '2026-10-30T21:00:00Z'; // sexta 17:00 em Manaus

  it('prazo = solicitação + 24 h úteis; no prazo, vencendo (≤ 4 h úteis) e vencido (no instante do prazo)', () => {
    // segunda 02/11 08:00 Manaus + 24 h úteis = quarta 04/11 12:00 (10 + 10 + 4)
    expect(situacaoDoPrazo('2026-11-02T12:00:00Z', '2026-11-03T18:00:00Z')).toEqual({ prazo_em: '2026-11-04T16:00:00.000Z', horas_restantes: 8, situacao: 'no_prazo' });
    expect(situacaoDoPrazo('2026-11-02T12:00:00Z', '2026-11-04T12:00:00Z')).toMatchObject({ horas_restantes: 4, situacao: 'vencendo' }); // limite do aviso inclusive
    expect(situacaoDoPrazo('2026-11-02T12:00:00Z', '2026-11-04T16:00:00Z')).toMatchObject({ horas_restantes: 0, situacao: 'vencido' });
    expect(situacaoDoPrazo('2026-11-02T12:00:00Z', '2026-11-05T16:00:00Z')).toMatchObject({ horas_restantes: -10, situacao: 'vencido' });
  });

  it('sexta 17:00 com 24 h úteis: não vence no fim de semana (24 h corridas venceriam sábado 17:00); prazo na quarta 11:00', () => {
    expect(situacaoDoPrazo(SEXTA_17H, '2026-10-31T22:00:00Z')).toEqual({ prazo_em: '2026-11-04T15:00:00.000Z', horas_restantes: 23, situacao: 'no_prazo' });
    expect(situacaoDoPrazo(SEXTA_17H, '2026-11-01T23:00:00Z')).toMatchObject({ horas_restantes: 23, situacao: 'no_prazo' }); // domingo: relógio parado
  });

  it('sexta 17:00 vencendo na segunda (prazo do tenant de 8 h úteis): 5 h às 10:00, vencendo às 11:00, vencido às 15:00', () => {
    const p = { aprovacao_prazo_horas: 8 };
    expect(situacaoDoPrazo(SEXTA_17H, '2026-11-02T14:00:00Z', p)).toEqual({ prazo_em: '2026-11-02T19:00:00.000Z', horas_restantes: 5, situacao: 'no_prazo' });
    expect(situacaoDoPrazo(SEXTA_17H, '2026-11-02T15:00:00Z', p)).toMatchObject({ horas_restantes: 4, situacao: 'vencendo' });
    expect(situacaoDoPrazo(SEXTA_17H, '2026-11-02T19:00:00Z', p)).toMatchObject({ horas_restantes: 0, situacao: 'vencido' });
    expect(situacaoDoPrazo(SEXTA_17H, '2026-11-03T13:00:00Z', p)).toMatchObject({ horas_restantes: -4, situacao: 'vencido' }); // seg 15–18 + ter 08–09
  });

  it('fuso do tenant: a mesma solicitação (sexta 21:30Z) vence em instantes diferentes em Manaus e em São Paulo', () => {
    const p = { aprovacao_prazo_horas: 8 };
    // Manaus: sexta 17:30 (0,5 h) + 7,5 h na segunda → 15:30 Manaus = 19:30Z
    expect(situacaoDoPrazo('2026-10-30T21:30:00Z', '2026-11-02T12:00:00Z', p).prazo_em).toBe('2026-11-02T19:30:00.000Z');
    // São Paulo: sexta 18:30 (fechado) → segunda 08:00 + 8 h = 16:00 SP = 19:00Z
    expect(situacaoDoPrazo('2026-10-30T21:30:00Z', '2026-11-02T12:00:00Z', { ...p, fuso: 'America/Sao_Paulo' }).prazo_em).toBe('2026-11-02T19:00:00.000Z');
  });

  it('prazo, aviso e janela são parâmetros do tenant (janela 24×7 = horas corridas)', () => {
    const corrido = { horario_comercial: { dias_semana: [1, 2, 3, 4, 5, 6, 7], inicio: '00:00', fim: '24:00' } };
    expect(situacaoDoPrazo('2026-10-29T06:00:00Z', '2026-10-31T12:00:00Z', corrido)).toMatchObject({ prazo_em: '2026-10-30T06:00:00.000Z', horas_restantes: -30, situacao: 'vencido' });
    expect(situacaoDoPrazo('2026-11-02T12:00:00Z', '2026-11-02T20:00:00Z', { aprovacao_prazo_horas: 8 }).situacao).toBe('vencido');
    expect(situacaoDoPrazo('2026-11-02T12:00:00Z', '2026-11-02T20:00:00Z', { aprovacao_prazo_horas: 48, aprovacao_aviso_horas: 41 }).situacao).toBe('vencendo');
  });
});

describe('RF-GES-04: fila de aprovações do gestor', () => {
  const s = montar([
    solicita(1, { em: '2026-10-27T12:00:00Z' }), // ter 08:00 → prazo qui 12:00; vencido há 14 h úteis (qui 6 + sex 8)
    solicita(2, { em: '2026-10-28T13:00:00Z', vendedor: V2 }), // qua 09:00 → prazo sex 13:00; vencido há 3 h úteis
    solicita(3, { em: '2026-10-28T20:00:00Z' }), // qua 16:00 → prazo seg 10:00; vencendo (sex 2 + seg 2 = 4 h úteis)
    solicita(4, { em: '2026-10-30T13:00:00Z', nivel: 'gerente' }), // sex 09:00 → no prazo, nível gerente
    solicita(5, { em: '2026-10-30T13:00:00Z', vendedor: OUTRO }), // equipe do outro supervisor
    solicita(6, { em: '2026-10-30T13:00:00Z', nivel: 'analista' }), // alçada do analista: fica na fila do BKO do Vendedor
    solicita(7, { em: '2026-10-27T14:00:00Z' }), // já decidida abaixo
    statusAlterado({ pedido: u(1007), vendedor: V1, para: 'aprovado', em: '2026-10-28T13:00:00Z' }),
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
      horas_restantes: -14,
    });
  });

  it('RN-CORE-04: supervisor só vê a própria equipe; gerente vê as duas', () => {
    expect(fila(s, { id: SUP, perfil: 'supervisor' }).some((i) => i.vendedor_id === OUTRO)).toBe(false);
    expect(fila(s, { id: GER, perfil: 'gerente' }).map((i) => i.pedido_id)).toContain(u(1005));
  });

  it('a alçada é do Vendedor: supervisor decide o nível supervisor; nível gerente é acompanhamento para ele', () => {
    const doSup = fila(s, { id: SUP, perfil: 'supervisor' });
    expect(doSup.find((i) => i.pedido_id === u(1001))).toMatchObject({ pode_decidir: true, acima_do_nivel: false });
    expect(doSup.find((i) => i.pedido_id === u(1004))).toMatchObject({ pode_decidir: false, acima_do_nivel: false }); // nível gerente
    expect(podeDecidir('supervisor', 'supervisor')).toBe(true);
    expect(podeDecidir('supervisor', 'gerente')).toBe(false);
  });

  it('RN-GES-04: o gerente decide o nível gerente e também o nível supervisor (marcado como acima do nível)', () => {
    const doGer = fila(s, { id: GER, perfil: 'gerente' });
    expect(doGer.find((i) => i.pedido_id === u(1004))).toMatchObject({ pode_decidir: true, acima_do_nivel: false });
    expect(doGer.find((i) => i.pedido_id === u(1001))).toMatchObject({ pode_decidir: true, acima_do_nivel: true });
    expect(podeDecidir('gerente', 'supervisor')).toBe(true);
    expect(podeDecidir('gerente', 'gerente')).toBe(true);
    expect(podeDecidir('gerente', 'analista')).toBe(false);
    expect(resumirFila(doGer).para_mim).toBe(doGer.length);
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
      solicita(1, { em: '2026-10-27T12:00:00Z' }),
      statusAlterado({ pedido: u(1001), para: 'aprovado', em: '2026-10-27T13:00:00Z' }),
      solicita(1, { em: '2026-10-30T14:00:00Z' }),
    ]);
    const [item] = fila(rev, { id: SUP, perfil: 'supervisor' });
    expect(item!.solicitada_em).toBe('2026-10-30T14:00:00Z');
    expect(item!.situacao).toBe('no_prazo');
  });

  it('sem crédito/histórico no evento a linha mostra null (tela: "indisponível"), não quebra', () => {
    const sem = montar([solicita(1, { em: '2026-10-30T13:00:00Z', credito: false })]);
    expect(fila(sem, { id: SUP, perfil: 'supervisor' })[0]!.credito).toBeNull();
  });

  it('perfis sem fila (vendedor, promotor, assistente) recebem lista vazia; Vendedor desativado também (RN-CORE-03)', () => {
    expect(fila(s, { id: V1, perfil: 'vendedor' })).toEqual([]);
    expect(fila(s, { id: u(51), perfil: 'promotor' })).toEqual([]);
    expect(fila(s, { id: u(52), perfil: 'assistente' })).toEqual([]);
    expect(fila(s, { id: SUP, perfil: 'supervisor' }, new Set(['core']))).toEqual([]);
  });

  it('RN-GES-07: analista e admin veem a fila do tenant em modo leitura (nunca decidem)', () => {
    for (const perfil of ['analista', 'admin'] as const) {
      const itens = fila(s, { id: u(50), perfil });
      expect(itens.map((i) => i.pedido_id)).toEqual([u(1001), u(1002), u(1003), u(1004), u(1005)]);
      expect(itens.every((i) => !i.pode_decidir)).toBe(true);
      expect(resumirFila(itens).para_mim).toBe(0);
    }
  });

  it('resumo: total, vencidos, vencendo e "para mim"', () => {
    expect(resumirFila(fila(s, { id: SUP, perfil: 'supervisor' }))).toEqual({ total: 4, vencidos: 2, vencendo: 1, para_mim: 3 });
  });
});

describe('RN-GES-08: comentário obrigatório só na rejeição', () => {
  it('aprovar sem comentário é aceito (1 toque); com comentário também', () => {
    expect(validarDecisao({ pedido_id: u(1), decisao: 'aprovar' })).toEqual({ ok: true, decisao: { pedido_id: u(1), decisao: 'aprovar', comentario: null } });
    expect(validarDecisao({ pedido_id: u(1), decisao: 'aprovar', comentario: 'ok' }).ok).toBe(true);
  });

  it('rejeitar sem comentário (ausente, vazio ou só espaços) é recusado com mensagem em português', () => {
    const erro = { ok: false, erros: ['RN-GES-08: informe o motivo da rejeição (mínimo 3 caracteres).'] };
    expect(validarDecisao({ pedido_id: u(1), decisao: 'rejeitar' })).toEqual(erro);
    expect(validarDecisao({ pedido_id: u(1), decisao: 'rejeitar', comentario: null })).toEqual(erro);
    expect(validarDecisao({ pedido_id: u(1), decisao: 'rejeitar', comentario: '   ' })).toEqual(erro);
    expect(validarDecisao({ pedido_id: u(1), decisao: 'rejeitar', comentario: 'Margem abaixo do mínimo' }).ok).toBe(true);
  });
});

describe('RN-GES-04: registro da decisão (quem decidiu, em que nível) e aviso ao supervisor', () => {
  const s = montar([
    solicita(1, { em: '2026-10-30T13:00:00Z' }), // nível supervisor, vendedor V1 (supervisor SUP)
    solicita(2, { em: '2026-10-30T13:00:00Z', nivel: 'gerente' }),
    solicita(3, { em: '2026-10-30T13:00:00Z', vendedor: OUTRO }), // equipe de SUP2
    solicita(4, { em: '2026-10-27T13:00:00Z' }),
    statusAlterado({ pedido: u(1004), para: 'aprovado', em: '2026-10-28T13:00:00Z' }),
  ]);
  const decidir = (viewer: { id: string; perfil: MembroEquipe['perfil'] }, entrada: unknown) => registrarDecisao({ estado: s, viewer, membros: ROSTER, agora: AGORA, entrada });

  it('gerente decide item do nível supervisor: registra decidido_por, perfil, nível do pedido e "acima do nível"; avisa o supervisor do vendedor', () => {
    const r = decidir({ id: GER, perfil: 'gerente' }, { pedido_id: u(1001), decisao: 'aprovar' });
    expect(r).toEqual({
      ok: true,
      registro: {
        pedido_id: u(1001),
        vendedor_id: V1,
        decisao: 'aprovar',
        comentario: null,
        nivel_pedido: 'supervisor',
        decidido_por_id: GER,
        decidido_por_perfil: 'gerente',
        acima_do_nivel: true,
        decidido_em: AGORA,
      },
      avisos: [{ tipo: 'aprovacao_decidida_pelo_gerente', destinatario_id: SUP, pedido_id: u(1001), vendedor_id: V1, decisao: 'aprovar', decidido_por_id: GER, decidido_em: AGORA }],
    });
    if (!r.ok) throw new Error('esperado ok');
    expect(RegistroDecisaoAprovacao.parse(r.registro)).toEqual(r.registro);
    for (const a of r.avisos) expect(AvisoDecisaoAoSupervisor.parse(a)).toEqual(a);
  });

  it('gerente rejeitando item do supervisor: comentário obrigatório, e o aviso leva a decisão', () => {
    expect(decidir({ id: GER, perfil: 'gerente' }, { pedido_id: u(1001), decisao: 'rejeitar' })).toMatchObject({ ok: false, codigo: 'DECISAO_INVALIDA' });
    const r = decidir({ id: GER, perfil: 'gerente' }, { pedido_id: u(1001), decisao: 'rejeitar', comentario: 'Crédito estourado' });
    expect(r).toMatchObject({ ok: true, registro: { comentario: 'Crédito estourado', acima_do_nivel: true }, avisos: [{ decisao: 'rejeitar', destinatario_id: SUP }] });
  });

  it('decisão no próprio nível não gera aviso (supervisor no nível supervisor; gerente no nível gerente)', () => {
    expect(decidir({ id: SUP, perfil: 'supervisor' }, { pedido_id: u(1001), decisao: 'aprovar' })).toMatchObject({ ok: true, registro: { decidido_por_perfil: 'supervisor', acima_do_nivel: false }, avisos: [] });
    expect(decidir({ id: GER, perfil: 'gerente' }, { pedido_id: u(1002), decisao: 'aprovar' })).toMatchObject({ ok: true, registro: { nivel_pedido: 'gerente', acima_do_nivel: false }, avisos: [] });
  });

  it('recusas: supervisor no nível gerente (FORA_DA_ALCADA), outra equipe (FORA_DO_ESCOPO), já decidido (NAO_PENDENTE), analista/admin (SOMENTE_LEITURA)', () => {
    expect(decidir({ id: SUP, perfil: 'supervisor' }, { pedido_id: u(1002), decisao: 'aprovar' })).toMatchObject({ ok: false, codigo: 'FORA_DA_ALCADA' });
    expect(decidir({ id: SUP, perfil: 'supervisor' }, { pedido_id: u(1003), decisao: 'aprovar' })).toMatchObject({ ok: false, codigo: 'FORA_DO_ESCOPO' });
    expect(decidir({ id: SUP, perfil: 'supervisor' }, { pedido_id: u(1004), decisao: 'aprovar' })).toMatchObject({ ok: false, codigo: 'NAO_PENDENTE' });
    expect(decidir({ id: SUP, perfil: 'supervisor' }, { pedido_id: u(1999), decisao: 'aprovar' })).toMatchObject({ ok: false, codigo: 'NAO_PENDENTE' });
    expect(decidir({ id: u(50), perfil: 'analista' }, { pedido_id: u(1001), decisao: 'aprovar' })).toMatchObject({ ok: false, codigo: 'SOMENTE_LEITURA' });
    expect(decidir({ id: u(50), perfil: 'admin' }, { pedido_id: u(1001), decisao: 'aprovar' })).toMatchObject({ ok: false, codigo: 'SOMENTE_LEITURA' });
    expect(decidir({ id: V1, perfil: 'vendedor' }, { pedido_id: u(1001), decisao: 'aprovar' })).toMatchObject({ ok: false, codigo: 'SOMENTE_LEITURA' });
  });

  it('supervisor do vendedor: sobe pela hierarquia até o primeiro supervisor; sem supervisor, não há aviso', () => {
    expect(supervisorDoVendedor(ROSTER, V1)).toBe(SUP);
    expect(supervisorDoVendedor(ROSTER, OUTRO)).toBe(SUP2);
    const direto = [...ROSTER, m(u(14), 'Direto', 'vendedor', GER)];
    expect(supervisorDoVendedor(direto, u(14))).toBeNull();
  });
});

describe('RF-GES-04: decisão com comentário', () => {
  it('rejeitar exige o motivo (mínimo 3 caracteres); aprovar aceita sem comentário', () => {
    expect(validarDecisao({ pedido_id: u(1), decisao: 'rejeitar', comentario: '  ' })).toEqual({ ok: false, erros: ['RN-GES-08: informe o motivo da rejeição (mínimo 3 caracteres).'] });
    expect(validarDecisao({ pedido_id: u(1), decisao: 'rejeitar', comentario: 'Desconto alto' }).ok).toBe(true);
    const aprovar = validarDecisao({ pedido_id: u(1), decisao: 'aprovar' });
    expect(aprovar.ok).toBe(true);
    expect(DecisaoAprovacao.parse({ pedido_id: u(1), decisao: 'aprovar' }).comentario).toBeNull();
  });

  it('decisão com pedido sem UUID é recusada', () => {
    expect(validarDecisao({ pedido_id: 'abc', decisao: 'aprovar' }).ok).toBe(false);
  });
});
