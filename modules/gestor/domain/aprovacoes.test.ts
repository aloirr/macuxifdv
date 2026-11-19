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

describe('RF-GES-04 / RN-GES-03: prazo da aprovação em DIAS úteis (fila com vencendo/vencido)', () => {
  const SEXTA_17H = '2026-11-06T21:00:00Z'; // sexta 17:00 em Manaus

  it('sexta 17:00 vence segunda 17:00; no prazo, vencendo (≤ 4 h úteis restantes) e vencido só DEPOIS do prazo', () => {
    // sexta 17:00 + 1 dia útil = segunda 09/11 17:00 (21:00Z)
    expect(situacaoDoPrazo(SEXTA_17H, '2026-11-06T21:30:00Z')).toEqual({ prazo_em: '2026-11-09T21:00:00.000Z', horas_restantes: 9.5, situacao: 'no_prazo' });
    expect(situacaoDoPrazo(SEXTA_17H, '2026-11-09T16:00:00Z')).toMatchObject({ horas_restantes: 5, situacao: 'no_prazo' }); // segunda 12:00
    expect(situacaoDoPrazo(SEXTA_17H, '2026-11-09T17:00:00Z')).toMatchObject({ horas_restantes: 4, situacao: 'vencendo' }); // segunda 13:00: limite do aviso inclusive
    expect(situacaoDoPrazo(SEXTA_17H, '2026-11-09T21:00:00Z')).toMatchObject({ horas_restantes: 0, situacao: 'vencendo' }); // no instante do prazo ainda não passou
    expect(situacaoDoPrazo(SEXTA_17H, '2026-11-09T21:01:00Z')).toMatchObject({ situacao: 'vencido' });
    expect(situacaoDoPrazo(SEXTA_17H, '2026-11-10T21:00:00Z')).toMatchObject({ horas_restantes: -10, situacao: 'vencido' }); // terça 17:00
  });

  it('o fim de semana não corre: no sábado e no domingo a mesma solicitação segue no prazo, vencendo só na segunda', () => {
    expect(situacaoDoPrazo(SEXTA_17H, '2026-11-07T22:00:00Z')).toEqual({ prazo_em: '2026-11-09T21:00:00.000Z', horas_restantes: 9, situacao: 'no_prazo' });
    expect(situacaoDoPrazo(SEXTA_17H, '2026-11-08T23:00:00Z')).toMatchObject({ horas_restantes: 9, situacao: 'no_prazo' });
  });

  it('pedido de sábado 10:00 (fora do expediente) conta de segunda 08:00 e vence terça 08:00', () => {
    expect(situacaoDoPrazo('2026-11-07T14:00:00Z', '2026-11-07T15:00:00Z')).toEqual({ prazo_em: '2026-11-10T12:00:00.000Z', horas_restantes: 10, situacao: 'no_prazo' });
    expect(situacaoDoPrazo('2026-11-07T14:00:00Z', '2026-11-10T12:01:00Z').situacao).toBe('vencido');
  });

  it('pedido de sexta 19:00 também só começa a correr na segunda 08:00 (vence terça 08:00)', () => {
    expect(situacaoDoPrazo('2026-11-06T23:00:00Z', '2026-11-09T12:00:00Z')).toMatchObject({ prazo_em: '2026-11-10T12:00:00.000Z', horas_restantes: 10, situacao: 'no_prazo' });
  });

  it('feriado do tenant na segunda empurra o prazo para terça 17:00', () => {
    const p = { feriados: ['2026-11-09'] };
    expect(situacaoDoPrazo(SEXTA_17H, '2026-11-06T21:30:00Z', p)).toMatchObject({ prazo_em: '2026-11-10T21:00:00.000Z', horas_restantes: 9.5, situacao: 'no_prazo' });
    expect(situacaoDoPrazo(SEXTA_17H, '2026-11-09T21:01:00Z', p).situacao).not.toBe('vencido');
  });

  it('feriado nacional na segunda (Finados, 02/11) empurra o prazo para terça sem cadastro no tenant', () => {
    expect(situacaoDoPrazo('2026-10-30T21:00:00Z', '2026-11-02T21:01:00Z')).toMatchObject({ prazo_em: '2026-11-03T21:00:00.000Z', situacao: 'no_prazo' });
    expect(situacaoDoPrazo('2026-10-30T21:00:00Z', '2026-11-03T21:01:00Z').situacao).toBe('vencido');
  });

  it('fuso do tenant: a mesma solicitação (sexta 21:00Z) vence segunda 21:00Z em Manaus e terça 11:00Z em São Paulo', () => {
    expect(situacaoDoPrazo(SEXTA_17H, '2026-11-06T21:30:00Z').prazo_em).toBe('2026-11-09T21:00:00.000Z');
    expect(situacaoDoPrazo(SEXTA_17H, '2026-11-06T21:30:00Z', { fuso: 'America/Sao_Paulo' }).prazo_em).toBe('2026-11-10T11:00:00.000Z');
  });

  it('fuso com horário de verão (Nova York): sexta 17:00 local vence segunda 17:00 local; a hora UTC muda com o verão', () => {
    expect(situacaoDoPrazo('2027-03-12T22:00:00Z', '2027-03-12T22:30:00Z', { fuso: 'America/New_York' }).prazo_em).toBe('2027-03-15T21:00:00.000Z');
  });

  it('prazo de 2 dias úteis (parâmetro do tenant): sexta 17:00 vence terça 17:00; o aviso acompanha a jornada', () => {
    expect(situacaoDoPrazo(SEXTA_17H, '2026-11-06T21:30:00Z', { prazo_aprovacao_dias_uteis: 2 })).toMatchObject({ prazo_em: '2026-11-10T21:00:00.000Z', horas_restantes: 19.5, situacao: 'no_prazo' });
    expect(situacaoDoPrazo(SEXTA_17H, '2026-11-10T19:00:00Z', { prazo_aprovacao_dias_uteis: 2, aprovacao_aviso_horas: 2 })).toMatchObject({ horas_restantes: 2, situacao: 'vencendo' });
  });

  it('janela 24×7 (todos os dias, 00:00–24:00): 1 dia útil = 24 h corridas no mesmo horário', () => {
    const corrido = { horario_comercial: { dias_semana: [1, 2, 3, 4, 5, 6, 7], inicio: '00:00', fim: '24:00' }, aprovacao_aviso_horas: 4 };
    expect(situacaoDoPrazo('2026-10-29T06:00:00Z', '2026-10-31T12:00:00Z', corrido)).toMatchObject({ prazo_em: '2026-10-30T06:00:00.000Z', horas_restantes: -30, situacao: 'vencido' });
  });
});

describe('RF-GES-04: fila de aprovações do gestor', () => {
  const s = montar([
    solicita(1, { em: '2026-10-27T12:00:00Z' }), // ter 08:00 → prazo qua 08:00; vencido há 28 h úteis (qua 10 + qui 10 + sex 8)
    solicita(2, { em: '2026-10-28T13:00:00Z', vendedor: V2 }), // qua 09:00 → prazo qui 09:00; vencido há 17 h úteis (qui 9 + sex 8)
    solicita(3, { em: '2026-10-29T20:00:00Z' }), // qui 16:00 → prazo sex 16:00 = agora; ainda não passou: vencendo (0 h restantes)
    solicita(4, { em: '2026-10-30T20:00:00Z', nivel: 'gerente' }), // sex 16:00 → prazo terça 16:00 (segunda 02/11 é Finados): 10 h úteis, no prazo, nível gerente
    solicita(5, { em: '2026-10-30T13:00:00Z', vendedor: OUTRO }), // sex 09:00 → prazo ter 09:00 (3 h úteis, vencendo); equipe do outro supervisor
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
    ]); // o item 1004 é do nível gerente: o supervisor não o vê (P3 B)
    itens.forEach((i) => expect(ItemFilaAprovacao.parse(i)).toEqual(i));
  });

  it('mostra crédito, histórico e desconto efetivo na mesma linha (RF-GES-04)', () => {
    const [primeiro] = fila(s, { id: SUP, perfil: 'supervisor' });
    expect(primeiro).toMatchObject({
      desconto_efetivo_pct: 12.5,
      total_cents: 500_000,
      credito: { limite_cents: 1_000_000, saldo_aberto_cents: 700_000, disponivel_cents: 300_000 },
      historico: { pedidos_90d: 4, ticket_medio_cents: 320_000 },
      horas_restantes: -28,
    });
  });

  it('RN-CORE-04: supervisor só vê a própria equipe; gerente vê as duas', () => {
    expect(fila(s, { id: SUP, perfil: 'supervisor' }).some((i) => i.vendedor_id === OUTRO)).toBe(false);
    expect(fila(s, { id: GER, perfil: 'gerente' }).map((i) => i.pedido_id)).toContain(u(1005));
  });

  it('a alçada é do Vendedor: supervisor decide o nível supervisor e não vê os motivos do nível gerente (P3 B)', () => {
    const doSup = fila(s, { id: SUP, perfil: 'supervisor' });
    expect(doSup.find((i) => i.pedido_id === u(1001))).toMatchObject({ pode_decidir: true, acima_do_nivel: false });
    expect(doSup.find((i) => i.pedido_id === u(1004))).toBeUndefined(); // nível gerente
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
      solicita(1, { em: '2026-10-30T20:00:00Z' }),
    ]);
    const [item] = fila(rev, { id: SUP, perfil: 'supervisor' });
    expect(item!.solicitada_em).toBe('2026-10-30T20:00:00Z');
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
      expect(itens.map((i) => i.pedido_id)).toEqual([u(1001), u(1002), u(1003), u(1005), u(1004)]); // ordem do prazo: 1005 vence antes de 1004
      expect(itens.every((i) => !i.pode_decidir)).toBe(true);
      expect(resumirFila(itens).para_mim).toBe(0);
    }
  });

  it('resumo: total, vencidos, vencendo e "para mim"', () => {
    expect(resumirFila(fila(s, { id: SUP, perfil: 'supervisor' }))).toEqual({ total: 3, vencidos: 2, vencendo: 1, para_mim: 3 });
  });
});

describe('RN-GES-08: comentário obrigatório na devolução e na rejeição', () => {
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
        motivo: null,
        comentario: null,
        nivel_pedido: 'supervisor',
        decidido_por_id: GER,
        decidido_por_perfil: 'gerente',
        acima_do_nivel: true,
        decidido_em: AGORA,
      },
      avisos: [{ tipo: 'aprovacao_decidida_pelo_gerente', destinatario_id: SUP, pedido_id: u(1001), vendedor_id: V1, decisao: 'aprovar', motivo: null, decidido_por_id: GER, decidido_em: AGORA }],
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
