import { describe, expect, it } from 'vitest';
import { ClienteAtualizadoSchema, VisitaCheckoutSchema } from '@macuxi/core/contracts';
import {
  Alerta,
  AprovacaoSolicitadaV1,
  AvisoDecisaoAoSupervisor,
  ClienteAtualizadoV1,
  ContextoPedidoEmNome,
  DecisaoAprovacao,
  EVENTOS_CONSUMIDOS,
  LinhaRanking,
  MembroEquipe,
  MetaDefinidaV1,
  PainelDia,
  ParametrosGestorSchema,
  PedidoCriadoV1,
  PedidoFaturadoV1,
  PedidoStatusAlteradoV1,
  RankingEquipe,
  RegraAlerta,
  RegistroDecisaoAprovacao,
} from './index';

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T0 = '2026-10-31T13:00:00Z';

describe('contratos do Gestor: parâmetros do tenant (doc 03)', () => {
  it('padrões: Manaus, base aprovado, permanência 10 min, peso do parcial 0, prazo de aprovação 1 dia útil', () => {
    expect(ParametrosGestorSchema.parse({})).toEqual({
      fuso: 'America/Manaus',
      base_apuracao: 'aprovado',
      feriados: [],
      permanencia_min_min: 10,
      peso_parcial_conformidade: 0,
      prazo_aprovacao_dias_uteis: 1,
      aprovacao_aviso_horas: 4,
      pct_tolerancia_frequencia: 50,
      dias_sem_visita_padrao: 30,
      dias_carencia_cliente_novo: 15,
      parado_min: 60,
      horario_comercial: { dias_semana: [1, 2, 3, 4, 5], inicio: '08:00', fim: '18:00' },
    });
  });

  it('RN-GES-03: prazo da aprovação em dias úteis inteiros e positivos; o parâmetro antigo em horas é chave desconhecida', () => {
    expect(ParametrosGestorSchema.safeParse({ prazo_aprovacao_dias_uteis: 2 }).success).toBe(true);
    expect(ParametrosGestorSchema.safeParse({ prazo_aprovacao_dias_uteis: 0 }).success).toBe(false);
    expect(ParametrosGestorSchema.safeParse({ prazo_aprovacao_dias_uteis: 1.5 }).success).toBe(false);
    expect(ParametrosGestorSchema.safeParse({ aprovacao_prazo_horas: 24 }).success).toBe(false);
  });

  it('chave desconhecida e base de apuração inválida são recusadas', () => {
    expect(ParametrosGestorSchema.safeParse({ outro: 1 }).success).toBe(false);
    expect(ParametrosGestorSchema.safeParse({ base_apuracao: 'criado' }).success).toBe(false);
  });
});

describe('espelhos dos eventos consumidos', () => {
  it('registro por nome cobre os 16 eventos do manifesto + 2 propostos, todos no formato <modulo>.<entidade>.<fato>@vN', () => {
    const nomes = Object.keys(EVENTOS_CONSUMIDOS);
    expect(nomes).toHaveLength(18);
    expect(nomes).toContain('vendedor.pedido.faturado@1');
    for (const n of nomes) expect(n).toMatch(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*@[1-9]\d*$/);
  });

  it('pedido criado: dinheiro em centavos inteiros; padrão é pedido (não orçamento); chave extra do publicador é ignorada (compatível)', () => {
    const base = { pedido_id: u(1), vendedor_id: u(2), autor_id: u(3), cliente_id: u(4), total_cents: 10_000, criado_em: T0, campo_novo_do_vendedor: 'x' };
    const ok = PedidoCriadoV1.parse(base);
    expect(ok.tipo).toBe('pedido');
    expect(ok.visita_id).toBeNull();
    expect(ok.total_tabela_cents).toBeNull();
    expect('campo_novo_do_vendedor' in ok).toBe(false);
    expect(PedidoCriadoV1.safeParse({ ...base, total_cents: 99.9 }).success).toBe(false);
    expect(PedidoCriadoV1.safeParse({ ...base, total_cents: -1 }).success).toBe(false);
  });

  it('instantes precisam ser ISO UTC e ids precisam ser UUID', () => {
    expect(PedidoStatusAlteradoV1.safeParse({ pedido_id: u(1), vendedor_id: u(2), para: 'aprovado', alterado_em: '30/10/2026' }).success).toBe(false);
    expect(PedidoStatusAlteradoV1.safeParse({ pedido_id: 'x', vendedor_id: u(2), para: 'aprovado', alterado_em: T0 }).success).toBe(false);
    expect(PedidoStatusAlteradoV1.safeParse({ pedido_id: u(1), vendedor_id: u(2), para: 'enviado', alterado_em: T0 }).success).toBe(false);
  });

  it('T-0046: core.cliente.atualizado@1 parte do schema oficial do Core; a carteira é opcional (o Core ainda não publica)', () => {
    const publicado = { cliente_id: u(1), campos: ['latitude', 'longitude'], origem: 'bko' };
    expect(ClienteAtualizadoSchema.safeParse(publicado).success).toBe(true);
    expect(ClienteAtualizadoV1.parse(publicado)).toEqual(publicado);
    expect(ClienteAtualizadoV1.safeParse({ cliente_id: u(1), vendedor_id: u(2) }).success).toBe(false); // sem campos/origem do Core
    const comCarteira = { ...publicado, campos: ['vendedor_id'], vendedor_id: u(2), ativo: true, frequencia_visita: 'quinzenal', na_carteira_desde: T0 };
    expect(ClienteAtualizadoV1.parse(comCarteira)).toMatchObject({ vendedor_id: u(2), frequencia_visita: 'quinzenal', na_carteira_desde: T0 });
    expect(ClienteAtualizadoV1.safeParse({ ...comCarteira, frequencia_visita: 'diaria' }).success).toBe(false);
  });

  it('T-0046 / RN-CORE-11: core.visita.checkout@1 é o schema oficial do Core (fechada_por, permanencia_s)', () => {
    expect(EVENTOS_CONSUMIDOS['core.visita.checkout@1']).toBe(VisitaCheckoutSchema);
    const base = { visita_id: u(1), usuario_id: u(2), cliente_id: u(3), checkin_em: T0, checkout_em: T0, data_local: '2026-10-31', resultado: 'atendido', motivo_codigo: null, pedido_id: null, fechada_por: 'usuario', permanencia_s: 0 };
    expect(VisitaCheckoutSchema.safeParse(base).success).toBe(true);
    expect(VisitaCheckoutSchema.safeParse({ ...base, fechada_por: 'servidor' }).success).toBe(false);
    const { fechada_por: _f, ...antigo } = base;
    expect(VisitaCheckoutSchema.safeParse({ ...antigo, encerramento: 'automatico' }).success).toBe(false); // formato do espelho antigo
  });

  it('RN-GES-06: pedido criado com itens opcionais (centavos) e faturamento pelos itens, igual ao publicado pelo Vendedor', () => {
    const base = { pedido_id: u(1), vendedor_id: u(2), autor_id: u(3), cliente_id: u(4), total_cents: 10_000, criado_em: T0 };
    expect(PedidoCriadoV1.parse(base).itens).toBeNull();
    expect(PedidoCriadoV1.parse({ ...base, itens: [{ produto_id: u(5), quantidade: 2, total_cents: 10_000 }] }).itens).toHaveLength(1);
    expect(PedidoCriadoV1.safeParse({ ...base, itens: [{ produto_id: u(5), quantidade: 0, total_cents: 10_000 }] }).success).toBe(false);
    const fat = { pedido_id: u(1), vendedor_id: u(2), faturado_em: T0, parcial: true, itens: [{ produto_id: u(5), quantidade: 1 }] };
    expect(PedidoFaturadoV1.safeParse(fat).success).toBe(true);
    expect(PedidoFaturadoV1.safeParse({ ...fat, itens: [] }).success).toBe(false);
  });

  it('aprovação solicitada: nível, motivos e desconto efetivo; crédito e histórico são opcionais', () => {
    const base = { pedido_id: u(1), vendedor_id: u(2), cliente_id: u(3), solicitada_em: T0, nivel: 'supervisor', motivos: ['desconto'], desconto_efetivo_pct: 12.5, total_cents: 100_000 };
    const ok = AprovacaoSolicitadaV1.parse(base);
    expect(ok.credito).toBeNull();
    expect(ok.historico).toBeNull();
    expect(AprovacaoSolicitadaV1.safeParse({ ...base, motivos: [] }).success).toBe(false);
    expect(AprovacaoSolicitadaV1.safeParse({ ...base, nivel: 'diretor' }).success).toBe(false);
  });

  it('meta: mês no formato AAAA-MM e valor em centavos', () => {
    expect(MetaDefinidaV1.safeParse({ usuario_id: u(1), mes: '2026-10', meta_cents: 2_200_000 }).success).toBe(true);
    expect(MetaDefinidaV1.safeParse({ usuario_id: u(1), mes: '10/2026', meta_cents: 1 }).success).toBe(false);
    expect(MetaDefinidaV1.safeParse({ usuario_id: u(1), mes: '2026-10', meta_cents: 10.5 }).success).toBe(false);
  });
});

describe('painel do dia', () => {
  const visitas = { planejadas: 4, realizadas: 2, planejadas_realizadas: 2, visitas_extras: 0, em_andamento: 0, cobertura_pct: 50, tempo_total_min: 30, tempo_medio_min: 15, curtas: 0, conversao_pedido_pct: null };
  const linha = { usuario_id: u(1), perfil: 'vendedor', data: '2026-10-30', status_dia: 'em_rota', visitas, vendas: null, faturamento: null, mes: null, trade: null, pesquisa: null, treinamento: null, calculado_em: T0 };

  it('módulos opcionais desativados = seções null, e a linha continua válida', () => {
    expect(PainelDia.safeParse(linha).success).toBe(true);
  });

  it('data civil AAAA-MM-DD; status do dia fechado; chave extra recusada', () => {
    expect(PainelDia.safeParse({ ...linha, data: '30/10/2026' }).success).toBe(false);
    expect(PainelDia.safeParse({ ...linha, status_dia: 'parado' }).success).toBe(false);
    expect(PainelDia.safeParse({ ...linha, extra: 1 }).success).toBe(false);
  });

  it('vendas em centavos inteiros e não negativas', () => {
    const vendas = { vendas_cents: 1000.5, pedidos: 1, clientes_positivados: 1, ticket_medio_cents: 1000, desconto_medio_pct: null };
    expect(PainelDia.safeParse({ ...linha, vendas }).success).toBe(false);
    expect(PainelDia.safeParse({ ...linha, vendas: { ...vendas, vendas_cents: 1000 } }).success).toBe(true);
  });

  it('RN-GES-05: cobertura até 100% (visitas extras à parte, null sem rota)', () => {
    expect(PainelDia.safeParse({ ...linha, visitas: { ...visitas, cobertura_pct: 120 } }).success).toBe(false);
    expect(PainelDia.safeParse({ ...linha, visitas: { ...visitas, cobertura_pct: null, visitas_extras: null } }).success).toBe(true);
  });

  it('RN-GES-06: a faturar = vendido − faturado (coerência validada)', () => {
    expect(PainelDia.safeParse({ ...linha, faturamento: { vendido_cents: 10_000, faturado_cents: 3_000, a_faturar_cents: 7_000 } }).success).toBe(true);
    expect(PainelDia.safeParse({ ...linha, faturamento: { vendido_cents: 10_000, faturado_cents: 3_000, a_faturar_cents: 6_000 } }).success).toBe(false);
  });
});

describe('ranking, alerta, aprovação e pedido em nome', () => {
  it('ranking: posição única positiva ou null (sem dado); sentido maior|menor', () => {
    const l = { posicao: 1, usuario_id: u(1), nome: 'Ana', perfil: 'vendedor', valor: 10, vendas_cents: 10, pedidos: 1 };
    expect(LinhaRanking.safeParse(l).success).toBe(true);
    expect(LinhaRanking.safeParse({ ...l, posicao: null, valor: null }).success).toBe(true);
    expect(LinhaRanking.safeParse({ ...l, posicao: 0 }).success).toBe(false);
    const r = { indicador: 'vendas_cents', periodo: 'semanal', inicio: '2026-10-26', fim: '2026-11-01', sentido: 'maior', linhas: [l], calculado_em: T0 };
    expect(RankingEquipe.safeParse(r).success).toBe(true);
    expect(RankingEquipe.safeParse({ ...r, periodo: 'anual' }).success).toBe(false);
  });

  it('regra de alerta: limiar não negativo e janela positiva', () => {
    const r = { tipo: 'fotos_sem_gps', ativa: true, limiar: 20, janela_dias: 7, amostra_min: 10, severidade: 'atencao' };
    expect(RegraAlerta.safeParse(r).success).toBe(true);
    expect(RegraAlerta.safeParse({ ...r, limiar: -5 }).success).toBe(false);
    expect(RegraAlerta.safeParse({ ...r, janela_dias: 0 }).success).toBe(false);
    expect(RegraAlerta.safeParse({ ...r, tipo: 'sem_check_in_ate_10h' }).success).toBe(false);
  });

  it('alerta: status aberto/dispensado/encerrado e motivo de encerramento', () => {
    const a = { id: u(1), chave: `cliente_sem_visita:${u(2)}`, tipo: 'cliente_sem_visita', alvo_tipo: 'cliente', alvo_id: u(2), responsavel_id: u(3), valor: 31, limiar: 30, severidade: 'atencao', mensagem: 'x', status: 'aberto', aberto_em: T0, encerrado_em: null, motivo_encerramento: null };
    expect(Alerta.safeParse(a).success).toBe(true);
    expect(Alerta.safeParse({ ...a, status: 'resolvido' }).success).toBe(false);
    expect(Alerta.safeParse({ ...a, motivo_encerramento: 'cansei' }).success).toBe(false);
  });

  it('RN-GES-04: registro da decisão e aviso ao supervisor', () => {
    const reg = { pedido_id: u(1), vendedor_id: u(2), decisao: 'aprovar', comentario: null, nivel_pedido: 'supervisor', decidido_por_id: u(3), decidido_por_perfil: 'gerente', acima_do_nivel: true, decidido_em: T0 };
    expect(RegistroDecisaoAprovacao.safeParse(reg).success).toBe(true);
    expect(RegistroDecisaoAprovacao.safeParse({ ...reg, decidido_por_perfil: 'analista' }).success).toBe(false);
    expect(RegistroDecisaoAprovacao.safeParse({ ...reg, decisao: 'rejeitar' }).success).toBe(false); // RN-GES-08 também no registro
    const aviso = { tipo: 'aprovacao_decidida_pelo_gerente', destinatario_id: u(4), pedido_id: u(1), vendedor_id: u(2), decisao: 'aprovar', decidido_por_id: u(3), decidido_em: T0 };
    expect(AvisoDecisaoAoSupervisor.safeParse(aviso).success).toBe(true);
    expect(AvisoDecisaoAoSupervisor.safeParse({ ...aviso, destinatario_id: 'x' }).success).toBe(false);
  });

  it('RN-GES-08 (antes RF-GES-04): rejeitar exige comentário; aprovar não', () => {
    expect(DecisaoAprovacao.safeParse({ pedido_id: u(1), decisao: 'rejeitar' }).success).toBe(false);
    expect(DecisaoAprovacao.safeParse({ pedido_id: u(1), decisao: 'rejeitar', comentario: 'Margem baixa' }).success).toBe(true);
    expect(DecisaoAprovacao.safeParse({ pedido_id: u(1), decisao: 'aprovar' }).success).toBe(true);
  });

  it('RN-VEN-35: contexto do pedido em nome leva vendedor_id e autor_id (gestor)', () => {
    const c = ContextoPedidoEmNome.parse({ vendedor_id: u(1), autor_id: u(2), cliente_id: u(3) });
    expect(c).toEqual({ vendedor_id: u(1), autor_id: u(2), cliente_id: u(3), visita_id: null });
    expect(ContextoPedidoEmNome.safeParse({ vendedor_id: u(1), cliente_id: u(3) }).success).toBe(false);
  });

  it('membro da equipe: perfil do SDK e superior opcional', () => {
    expect(MembroEquipe.safeParse({ id: u(1), nome: 'Ana', perfil: 'vendedor', superior_id: null, ativo: true }).success).toBe(true);
    expect(MembroEquipe.safeParse({ id: u(1), nome: 'Ana', perfil: 'diretor', superior_id: null, ativo: true }).success).toBe(false);
  });
});
