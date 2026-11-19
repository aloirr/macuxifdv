import { describe, expect, it } from 'vitest';
import { schemaOficialDe } from '@macuxi/platform-sdk';
import { EVENTO_CLIENTE_ATUALIZADO, EVENTO_META_DEFINIDA, EVENTO_ROTA_DIA_PLANEJADO, EVENTO_VISITA_CHECKIN, EVENTO_VISITA_CHECKOUT, VisitaCheckoutSchema } from '@macuxi/core/contracts';
import { EVENTO_PEDIDO_APROVACAO_DECIDIDA, EVENTO_PEDIDO_APROVACAO_SOLICITADA, EVENTO_PEDIDO_APROVACAO_SOLICITADA_V2, EVENTO_PEDIDO_CRIADO, EVENTO_PEDIDO_FATURADO, EVENTO_PEDIDO_STATUS_ALTERADO } from '../../vendedor/contracts';
import { EVENTOS_PROMOTOR } from '../../promotor/contracts';
import { DEF_RESPOSTA_REGISTRADA } from '../../pesquisa/contracts';
import { DEFINICAO_LICAO_CONCLUIDA, DEFINICAO_MEDALHA_CONQUISTADA } from '../../treinamento/contracts';
import {
  Alerta,
  AvisoDecisaoAoSupervisor,
  ContextoPedidoEmNome,
  DECISOES_APROVACAO,
  DecisaoAprovacao,
  EVENTOS_CONSUMIDOS,
  LinhaRanking,
  MembroEquipe,
  PainelDia,
  ParametrosGestorSchema,
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
      calendario_metas: { dias_uteis_semana: [1, 2, 3, 4, 5, 6], feriados: [] },
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

describe('eventos consumidos: schemas do dono, leitura tolerante (T-0024)', () => {
  const C = EVENTOS_CONSUMIDOS;
  const pedidoCriado = { pedido_id: u(1), vendedor_id: u(2), autor_id: u(3), cliente_id: u(4), visita_id: null, tipo: 'pedido', total_cents: 10_000, total_tabela_cents: 10_000, criado_em: T0, itens: [{ produto_id: u(5), quantidade: 2, total_cents: 10_000 }], status: 'em_aprovacao' };

  it('registro por nome cobre os 19 eventos do manifesto + 1 proposto, todos no formato <modulo>.<entidade>.<fato>@vN', () => {
    const nomes = Object.keys(C);
    expect(nomes).toHaveLength(20);
    expect(nomes).toContain('vendedor.pedido.faturado@1');
    for (const n of nomes) expect(n).toMatch(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*@[1-9]\d*$/);
  });

  it('T-0024: cada evento consumido usa o schema OFICIAL do dono (nenhuma cópia de payload)', () => {
    const donos = {
      'core.cliente.atualizado@1': EVENTO_CLIENTE_ATUALIZADO.schema,
      'core.visita.checkin@1': EVENTO_VISITA_CHECKIN.schema,
      'core.visita.checkout@1': EVENTO_VISITA_CHECKOUT.schema,
      'core.rota.dia_planejado@1': EVENTO_ROTA_DIA_PLANEJADO.schema,
      'core.meta.definida@1': EVENTO_META_DEFINIDA.schema,
      'vendedor.pedido.criado@1': EVENTO_PEDIDO_CRIADO.schema,
      'vendedor.pedido.status_alterado@1': EVENTO_PEDIDO_STATUS_ALTERADO.schema,
      'vendedor.pedido.aprovacao_solicitada@1': EVENTO_PEDIDO_APROVACAO_SOLICITADA.schema,
      'vendedor.pedido.aprovacao_solicitada@2': EVENTO_PEDIDO_APROVACAO_SOLICITADA_V2.schema,
      'vendedor.pedido.aprovacao_decidida@1': EVENTO_PEDIDO_APROVACAO_DECIDIDA.schema,
      'vendedor.pedido.faturado@1': EVENTO_PEDIDO_FATURADO.schema,
      'promotor.visita_loja.concluida@1': EVENTOS_PROMOTOR['promotor.visita_loja.concluida@1'],
      'promotor.gondola.registrada@1': EVENTOS_PROMOTOR['promotor.gondola.registrada@1'],
      'promotor.share.medido@1': EVENTOS_PROMOTOR['promotor.share.medido@1'],
      'promotor.preco.coletado@1': EVENTOS_PROMOTOR['promotor.preco.coletado@1'],
      'promotor.ruptura.registrada@1': EVENTOS_PROMOTOR['promotor.ruptura.registrada@1'],
      'promotor.tarefa.concluida@1': EVENTOS_PROMOTOR['promotor.tarefa.concluida@1'],
      'pesquisa.resposta.registrada@1': DEF_RESPOSTA_REGISTRADA.schema,
      'treinamento.licao.concluida@1': DEFINICAO_LICAO_CONCLUIDA.schema,
      'treinamento.medalha.conquistada@1': DEFINICAO_MEDALHA_CONQUISTADA.schema,
    } as const;
    for (const [nome, oficial] of Object.entries(donos)) expect(schemaOficialDe(C[nome as keyof typeof C]), nome).toBe(oficial);
    expect(Object.keys(donos).sort()).toEqual(Object.keys(C).sort());
  });

  it('pedido criado: dinheiro em centavos inteiros; chave extra do publicador é ignorada (leitura tolerante)', () => {
    const s = C['vendedor.pedido.criado@1'];
    const ok = s.parse({ ...pedidoCriado, campo_novo_do_vendedor: 'x' });
    expect(ok.tipo).toBe('pedido');
    expect('campo_novo_do_vendedor' in ok).toBe(false);
    expect(s.safeParse({ ...pedidoCriado, total_cents: 99.9 }).success).toBe(false);
    expect(s.safeParse({ ...pedidoCriado, total_cents: -1 }).success).toBe(false);
  });

  it('status do vocabulário do Vendedor (id e instante inválidos são barrados na projeção, T-0024)', () => {
    const s = C['vendedor.pedido.status_alterado@1'];
    const base = { pedido_id: u(1), vendedor_id: u(2), de: null, para: 'aprovado', alterado_em: T0, autor_id: null, motivo: null };
    expect(s.safeParse(base).success).toBe(true);
    expect(s.safeParse({ ...base, para: 'inexistente' }).success).toBe(false);
  });

  it('T-0046: core.cliente.atualizado@1 é o oficial do Core, com a carteira opcional', () => {
    const s = C['core.cliente.atualizado@1'];
    const publicado = { cliente_id: u(1), campos: ['latitude', 'longitude'], origem: 'bko' };
    expect(s.parse(publicado)).toEqual(publicado);
    expect(s.safeParse({ cliente_id: u(1), vendedor_id: u(2) }).success).toBe(false); // sem campos/origem do Core
    const comCarteira = { ...publicado, campos: ['vendedor_id'], vendedor_id: u(2), ativo: true, frequencia_visita: 'quinzenal', na_carteira_desde: T0 };
    expect(s.parse(comCarteira)).toMatchObject({ vendedor_id: u(2), frequencia_visita: 'quinzenal', na_carteira_desde: T0 });
    expect(s.safeParse({ ...comCarteira, frequencia_visita: 'diaria' }).success).toBe(false);
    expect('nome' in s.parse({ ...comCarteira, nome: 'Loja' })).toBe(false); // o nome vem de core.cadastro_resumo@1
  });

  it('T-0046 / RN-CORE-11: core.visita.checkout@1 (fechada_por, permanencia_s) e chave a mais tolerada', () => {
    const s = C['core.visita.checkout@1'];
    const base = { visita_id: u(1), usuario_id: u(2), cliente_id: u(3), checkin_em: T0, checkout_em: T0, data_local: '2026-10-31', resultado: 'atendido', motivo_codigo: null, pedido_id: null, fechada_por: 'usuario', permanencia_s: 0 };
    expect(VisitaCheckoutSchema.safeParse(base).success).toBe(true);
    expect(s.safeParse({ ...base, campo_novo: 1 }).success).toBe(true);
    expect(s.safeParse({ ...base, fechada_por: 'servidor' }).success).toBe(false);
    const { fechada_por: _f, ...antigo } = base;
    expect(s.safeParse({ ...antigo, encerramento: 'automatico' }).success).toBe(false); // formato do espelho antigo
  });

  it('RN-GES-06: pedido criado sempre com itens (centavos) e faturamento pelos itens, igual ao publicado pelo Vendedor', () => {
    const s = C['vendedor.pedido.criado@1'];
    expect(s.parse(pedidoCriado).itens).toHaveLength(1);
    expect(s.safeParse({ ...pedidoCriado, itens: [{ produto_id: u(5), quantidade: 0, total_cents: 10_000 }] }).success).toBe(false);
    const f = C['vendedor.pedido.faturado@1'];
    const fat = { pedido_id: u(1), vendedor_id: u(2), faturado_em: T0, parcial: true, itens: [{ produto_id: u(5), quantidade: 1 }] };
    expect(f.safeParse(fat).success).toBe(true);
    expect(f.safeParse({ ...fat, itens: [] }).success).toBe(false);
  });

  it('aprovação solicitada: nível, motivos e desconto efetivo; crédito e histórico objeto ou null (RF-GES-04)', () => {
    const s = C['vendedor.pedido.aprovacao_solicitada@1'];
    const base = { pedido_id: u(1), vendedor_id: u(2), cliente_id: u(3), solicitada_em: T0, nivel: 'supervisor', motivos: ['desconto'], desconto_efetivo_pct: 12.5, total_cents: 100_000, credito: null, historico: null };
    expect(s.parse(base).credito).toBeNull();
    const comContexto = { ...base, credito: { limite_cents: 500_000, saldo_aberto_cents: 100_000, disponivel_cents: 400_000 }, historico: { ultima_compra_em: T0, pedidos_90d: 3, ticket_medio_cents: 90_000 } };
    expect(s.parse(comContexto).credito?.disponivel_cents).toBe(400_000);
    expect(s.safeParse({ ...base, motivos: [] }).success).toBe(false);
    expect(s.safeParse({ ...base, nivel: 'diretor' }).success).toBe(false);
  });

  it('meta (formato oficial do Core): período AAAA-MM, indicador e valor inteiro', () => {
    const s = C['core.meta.definida@1'];
    const base = { usuario_id: u(1), periodo: '2026-10', indicador: 'venda_cents', valor: 2_200_000, valor_anterior: null, definido_por: u(9) };
    expect(s.safeParse(base).success).toBe(true);
    expect(s.safeParse({ ...base, periodo: '10/2026' }).success).toBe(false);
    expect(s.safeParse({ ...base, valor: 10.5 }).success).toBe(false);
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
    const reg = { pedido_id: u(1), vendedor_id: u(2), decisao: 'aprovar', motivo: null, comentario: null, nivel_pedido: 'supervisor', decidido_por_id: u(3), decidido_por_perfil: 'gerente', acima_do_nivel: true, decidido_em: T0 };
    expect(RegistroDecisaoAprovacao.safeParse(reg).success).toBe(true);
    expect(RegistroDecisaoAprovacao.safeParse({ ...reg, decidido_por_perfil: 'analista' }).success).toBe(false);
    expect(RegistroDecisaoAprovacao.safeParse({ ...reg, decisao: 'rejeitar' }).success).toBe(false); // RN-GES-08 também no registro
    expect(RegistroDecisaoAprovacao.safeParse({ ...reg, decisao: 'devolver', motivo: 'inadimplencia' }).success).toBe(false);
    expect(RegistroDecisaoAprovacao.safeParse({ ...reg, decisao: 'devolver', motivo: 'inadimplencia', comentario: 'Pagar o vencido' }).success).toBe(true);
    const aviso = { tipo: 'aprovacao_decidida_pelo_gerente', destinatario_id: u(4), pedido_id: u(1), vendedor_id: u(2), decisao: 'aprovar', motivo: null, decidido_por_id: u(3), decidido_em: T0 };
    expect(AvisoDecisaoAoSupervisor.safeParse(aviso).success).toBe(true);
    expect(AvisoDecisaoAoSupervisor.safeParse({ ...aviso, destinatario_id: 'x' }).success).toBe(false);
  });

  it('RN-GES-08 (antes RF-GES-04): rejeitar exige comentário; aprovar não', () => {
    expect(DecisaoAprovacao.safeParse({ pedido_id: u(1), decisao: 'rejeitar' }).success).toBe(false);
    expect(DecisaoAprovacao.safeParse({ pedido_id: u(1), decisao: 'rejeitar', comentario: 'Margem baixa' }).success).toBe(true);
    expect(DecisaoAprovacao.safeParse({ pedido_id: u(1), decisao: 'aprovar' }).success).toBe(true);
  });

  it('RN-GES-08 (T-0184): devolver também exige comentário; a decisão aceita o motivo, inclusive inadimplencia', () => {
    expect(DECISOES_APROVACAO).toEqual(['aprovar', 'devolver', 'rejeitar']);
    expect(DecisaoAprovacao.safeParse({ pedido_id: u(1), decisao: 'devolver' }).success).toBe(false);
    expect(DecisaoAprovacao.safeParse({ pedido_id: u(1), decisao: 'devolver', motivo: 'inadimplencia', comentario: 'Pagar o vencido' }).success).toBe(true);
    expect(DecisaoAprovacao.safeParse({ pedido_id: u(1), decisao: 'aprovar', motivo: 'quitado' }).success).toBe(false);
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
