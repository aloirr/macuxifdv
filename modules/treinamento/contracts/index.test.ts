import { describe, expect, it } from 'vitest';
import { conferirEventosPublicados, lerPayloadTolerante } from '@macuxi/platform-sdk';
import { EVENTO_PEDIDO_FATURADO } from '../../vendedor/contracts';
import * as contratos from './index';
import {
  AdesaoMes,
  DesafioVendasContrato,
  EventoFaturadoNoDesafio,
  lerPedidoFaturado,
  EVENTOS_TREINAMENTO,
  LancamentoXp,
  LicaoConcluidaV1,
  Medalha,
  MedalhaConquistadaV1,
  MedalhaUsuario,
  ParametrosTreinamentoSchema,
  PedidoFaturadoLido,
  ProgressoLicao,
  ProgressoLicaoEnvio,
  RankingPeriodo,
  TentativaQuiz,
} from './index';

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T0 = '2026-10-31T13:00:00Z';

describe('contratos do Treinamento: ids e datas', () => {
  const base = { id: u(1), tenant_id: u(2), usuario_id: u(3), trilha_id: u(4), licao_id: u(5), concluida_em: T0, tempo_gasto_seg: 45 };

  it('id precisa ser UUID gerado no aparelho', () => {
    expect(ProgressoLicao.safeParse({ ...base, id: '123' }).success).toBe(false);
    expect(ProgressoLicao.safeParse(base).success).toBe(true);
  });

  it('instante precisa ser ISO UTC (com Z)', () => {
    expect(ProgressoLicao.safeParse({ ...base, concluida_em: '31/10/2026 13:00' }).success).toBe(false);
    expect(ProgressoLicao.safeParse({ ...base, concluida_em: '2026-10-31T13:00:00-04:00' }).success).toBe(false);
  });

  it('RN-TRE-04: o envio do aparelho não carrega tenant nem usuário (vêm do token)', () => {
    const { tenant_id: _t, usuario_id: _u, ...envio } = base;
    expect(ProgressoLicaoEnvio.safeParse(envio).success).toBe(true);
    expect(ProgressoLicaoEnvio.safeParse(base).success).toBe(false);
  });
});

describe('RN-TRE-02: tentativa de quiz', () => {
  const t = {
    id: u(1),
    tenant_id: u(2),
    usuario_id: u(3),
    quiz_id: u(4),
    realizada_em: T0,
    respostas: [{ questao_id: u(10), alternativa_ids: [u(11)] }],
    acertos: 2,
    total_questoes: 3,
    nota_pct: 66.67,
    aprovada: false,
    primeira_tentativa: true,
  };
  it('RN-TRE-02: tentativa coerente é aceita', () => {
    expect(TentativaQuiz.safeParse(t).success).toBe(true);
  });
  it('RN-TRE-02: nota que não bate com acertos ÷ questões é recusada', () => {
    expect(TentativaQuiz.safeParse({ ...t, nota_pct: 70 }).success).toBe(false);
  });
  it('RN-TRE-02: acertos acima do total e nota fora de 0–100 são recusados', () => {
    expect(TentativaQuiz.safeParse({ ...t, acertos: 4 }).success).toBe(false);
    expect(TentativaQuiz.safeParse({ ...t, nota_pct: 101 }).success).toBe(false);
  });
  it('RN-TRE-02: tentativa sem respostas é recusada', () => {
    expect(TentativaQuiz.safeParse({ ...t, respostas: [] }).success).toBe(false);
  });
});

describe('RN-TRE-01: lançamento de XP', () => {
  const l = { id: u(1), tenant_id: u(2), usuario_id: u(3), origem: 'licao', referencia_id: u(5), pontos: 10, pontos_base: 10, limitado_pelo_teto: false, ocorrido_em: T0, dia: '2026-10-31' };
  it('lançamento válido', () => {
    expect(LancamentoXp.safeParse(l).success).toBe(true);
  });
  it('RN-TRE-08: a referência do desafio (desafio:pedido:evento, 3 UUIDs) cabe no lançamento', () => {
    const ref = `${u(1)}:${u(2)}:${u(3)}`;
    expect(LancamentoXp.safeParse({ ...l, origem: 'desafio_vendas', referencia_id: ref }).success).toBe(true);
    expect(LancamentoXp.safeParse({ ...l, origem: 'desafio_vendas', referencia_id: 'x'.repeat(129) }).success).toBe(false);
  });
  it('RN-TRE-04: lançamento só soma — pontos negativos ou fracionados são recusados', () => {
    expect(LancamentoXp.safeParse({ ...l, pontos: -1, pontos_base: -1 }).success).toBe(false);
    expect(LancamentoXp.safeParse({ ...l, pontos: 2.5, pontos_base: 2.5 }).success).toBe(false);
  });
  it('decisão 31/10: corte pelo teto precisa estar marcado e coerente', () => {
    expect(LancamentoXp.safeParse({ ...l, pontos: 5, limitado_pelo_teto: true }).success).toBe(true);
    expect(LancamentoXp.safeParse({ ...l, pontos: 5, limitado_pelo_teto: false }).success).toBe(false);
    expect(LancamentoXp.safeParse({ ...l, pontos: 12 }).success).toBe(false);
  });
  it('origem desconhecida é recusada', () => {
    expect(LancamentoXp.safeParse({ ...l, origem: 'bonus' }).success).toBe(false);
  });
});

describe('RF-TRE-03: medalhas', () => {
  it('catálogo aceita as três regras e recusa regra desconhecida', () => {
    const m = { id: u(1), tenant_id: u(2), codigo: 'sequencia_7_dias', nome: 'Sete dias seguidos' };
    expect(Medalha.safeParse({ ...m, regra: { tipo: 'sequencia_dias', dias: 7 } }).success).toBe(true);
    expect(Medalha.safeParse({ ...m, regra: { tipo: 'nota_maxima' } }).success).toBe(true);
    expect(Medalha.safeParse({ ...m, regra: { tipo: 'trilhas_concluidas', quantidade: 1 } }).success).toBe(true);
    expect(Medalha.safeParse({ ...m, regra: { tipo: 'magica' } }).success).toBe(false);
  });
  it('conquista do usuário', () => {
    expect(MedalhaUsuario.safeParse({ id: u(1), tenant_id: u(2), usuario_id: u(3), medalha_codigo: 'nota_maxima', conquistada_em: T0 }).success).toBe(true);
  });
});

describe('RN-TRE-03: ranking do período', () => {
  const r = { id: u(1), tenant_id: u(2), periodo: 'mensal', periodo_inicio: '2026-10-01', periodo_fim: '2026-10-31', escopo: { tipo: 'geral' }, usuario_id: u(3), nome: 'Ana', posicao: 1, pontos: 120, trilhas_concluidas: 1, atingiu_em: T0, calculado_em: T0 };
  it('linha de ranking mensal válida', () => {
    expect(RankingPeriodo.safeParse(r).success).toBe(true);
  });
  it('acumulado não tem limites; mensal exige', () => {
    expect(RankingPeriodo.safeParse({ ...r, periodo: 'acumulado', periodo_inicio: null, periodo_fim: null }).success).toBe(true);
    expect(RankingPeriodo.safeParse({ ...r, periodo: 'acumulado' }).success).toBe(false);
    expect(RankingPeriodo.safeParse({ ...r, periodo_inicio: null, periodo_fim: null }).success).toBe(false);
  });
  it('escopo por equipe exige o id; posição começa em 1', () => {
    expect(RankingPeriodo.safeParse({ ...r, escopo: { tipo: 'equipe' } }).success).toBe(false);
    expect(RankingPeriodo.safeParse({ ...r, escopo: { tipo: 'equipe', equipe_id: u(9) } }).success).toBe(true);
    expect(RankingPeriodo.safeParse({ ...r, posicao: 0 }).success).toBe(false);
  });
});

describe('RF-TRE-05: adesão do mês', () => {
  const a = { tenant_id: u(2), mes: '2026-10', equipe_id: null, publico: 4, ativos_no_mes: 1, adesao_pct: 25, calculado_em: T0 };
  it('indicador válido; público vazio exige percentual nulo', () => {
    expect(AdesaoMes.safeParse(a).success).toBe(true);
    expect(AdesaoMes.safeParse({ ...a, publico: 0, ativos_no_mes: 0, adesao_pct: null }).success).toBe(true);
    expect(AdesaoMes.safeParse({ ...a, publico: 0, ativos_no_mes: 0, adesao_pct: 0 }).success).toBe(false);
  });
  it('ativos acima do público e mês inválido são recusados', () => {
    expect(AdesaoMes.safeParse({ ...a, ativos_no_mes: 5 }).success).toBe(false);
    expect(AdesaoMes.safeParse({ ...a, mes: '2026-13' }).success).toBe(false);
  });
});

describe('eventos publicados treinamento.*@1', () => {
  it('licao.concluida@1', () => {
    const p = { progresso_id: u(1), tenant_id: u(2), usuario_id: u(3), trilha_id: u(4), licao_id: u(5), concluida_em: T0, tempo_gasto_seg: 60, nota_quiz_pct: null, xp_ganho: 12, trilha_concluida: false };
    expect(LicaoConcluidaV1.safeParse(p).success).toBe(true);
    expect(LicaoConcluidaV1.safeParse({ ...p, nota_quiz_pct: 80 }).success).toBe(true);
    expect(LicaoConcluidaV1.safeParse({ ...p, nota_quiz_pct: 180 }).success).toBe(false);
  });
  it('medalha.conquistada@1', () => {
    const p = { medalha_usuario_id: u(1), tenant_id: u(2), usuario_id: u(3), medalha_codigo: 'nota_maxima', nome: 'Nota máxima no quiz', conquistada_em: T0 };
    expect(MedalhaConquistadaV1.safeParse(p).success).toBe(true);
    expect(MedalhaConquistadaV1.safeParse({ ...p, medalha_codigo: 'Nota Máxima' }).success).toBe(false);
  });
  it('os nomes dos eventos publicados batem com o manifesto', async () => {
    const { default: manifest } = await import('../manifest');
    expect(Object.keys(EVENTOS_TREINAMENTO).sort()).toEqual([...manifest.publica].sort());
  });
});

describe('RF-TRE-06: leitura tolerante do pedido FATURADO (`vendedor.pedido.faturado@1`)', () => {
  const p = { pedido_id: u(1), vendedor_id: u(2), faturado_em: T0, itens: [{ produto_id: u(3), quantidade: 2 }], parcial: false };
  it('lê o que precisa e ignora campos a mais do Vendedor', () => {
    const r = PedidoFaturadoLido.parse({ ...p, total_cents: 12345, cliente_id: u(9), itens: [{ produto_id: u(3), quantidade: 2, preco_cents: 500 }] });
    expect(r).toEqual(p);
  });
  it('Ajuste C: pedido apenas criado (sem faturado_em) é recusado e não pontua; o antigo criado_em não vale', () => {
    const { faturado_em: _f, ...criado } = p;
    expect(PedidoFaturadoLido.safeParse(criado).success).toBe(false);
    expect(PedidoFaturadoLido.safeParse({ ...criado, criado_em: T0 }).success).toBe(false);
    expect(PedidoFaturadoLido.safeParse({ ...p, faturado_em: null }).success).toBe(false);
  });
  it('payload sem o necessário (ids, faturado_em) ou com quantidade inválida é recusado e não pontua', () => {
    const { vendedor_id: _v, ...semVendedor } = p;
    expect(PedidoFaturadoLido.safeParse(semVendedor).success).toBe(false);
    expect(PedidoFaturadoLido.safeParse({ ...p, itens: [{ produto_id: u(3), quantidade: 0 }] }).success).toBe(false);
  });
  it('T-0024: contrato oficial do Vendedor — `parcial` obrigatório, `itens` com ao menos 1 e quantidade inteira > 0', () => {
    expect(PedidoFaturadoLido.parse({ ...p, parcial: true }).parcial).toBe(true);
    expect(PedidoFaturadoLido.safeParse({ ...p, parcial: 'sim' }).success).toBe(false);
    const { parcial: _p, ...semParcial } = p;
    expect(PedidoFaturadoLido.safeParse(semParcial).success).toBe(false);
    const { itens: _i, ...semItens } = p;
    expect(PedidoFaturadoLido.safeParse(semItens).success).toBe(false);
    expect(PedidoFaturadoLido.safeParse({ ...p, itens: [] }).success).toBe(false);
    expect(PedidoFaturadoLido.safeParse({ ...p, itens: [{ produto_id: u(3), quantidade: 1.5 }] }).success).toBe(false);
  });
  it('T-0024: a leitura tolerante do evento oficial descarta chaves a mais (lerPayloadTolerante)', () => {
    expect(lerPayloadTolerante(EVENTO_PEDIDO_FATURADO, { ...p, novo: 1 })).toEqual(p);
    expect(lerPayloadTolerante(EVENTO_PEDIDO_FATURADO, { ...p, itens: [] })).toBeNull();
  });
  it('T-0036: `lerPedidoFaturado` junta o payload ao evento_id e ao tenant_id do envelope (tipo único `EventoFaturadoNoDesafio`)', () => {
    const env = { evento_id: u(7), tenant_id: u(8) };
    expect(lerPedidoFaturado(p, env)).toEqual({ ...p, ...env });
    expect(EventoFaturadoNoDesafio.parse({ ...p, ...env })).toEqual({ ...p, ...env });
    // o envelope prevalece sobre campos homônimos do payload
    expect(lerPedidoFaturado({ ...p, evento_id: u(90), tenant_id: u(91) }, env)).toMatchObject(env);
  });
  it('T-0036: payload fora do contrato, não objeto ou envelope sem UUID → null (não pontua)', () => {
    const env = { evento_id: u(7), tenant_id: u(8) };
    const { faturado_em: _f, ...criado } = p;
    expect(lerPedidoFaturado(criado, env)).toBeNull();
    expect(lerPedidoFaturado(null, env)).toBeNull();
    expect(lerPedidoFaturado([p], env)).toBeNull();
    expect(lerPedidoFaturado('pedido', env)).toBeNull();
    expect(lerPedidoFaturado(p, { ...env, evento_id: 'E1' })).toBeNull();
    expect(lerPedidoFaturado(p, { ...env, tenant_id: '' })).toBeNull();
  });
  it('T-0036: o evento lido é o que o manifesto consome', async () => {
    const { default: manifest } = await import('../manifest');
    expect(manifest.consome).toContain(EVENTO_PEDIDO_FATURADO.nome);
  });
  it('desafio: vigência com fim antes do início é recusada', () => {
    const d = { id: u(1), tenant_id: u(2), nome: 'Semana do Café', ativo: true, produto_ids: [u(3)], vigencia_inicio: '2026-10-26', vigencia_fim: '2026-11-01', xp_por_unidade: 2, xp_max_por_pedido: 20 };
    expect(DesafioVendasContrato.safeParse(d).success).toBe(true);
    expect(DesafioVendasContrato.safeParse({ ...d, vigencia_fim: '2026-10-01' }).success).toBe(false);
  });
  it('Ajuste A: xp_max_por_desafio é opcional (vale o padrão do tenant), aceita 0 (= sem teto) e recusa negativo/fracionado', () => {
    const d = { id: u(1), tenant_id: u(2), nome: 'Semana do Café', ativo: true, produto_ids: [u(3)], vigencia_inicio: '2026-10-26', vigencia_fim: '2026-11-01', xp_por_unidade: 2, xp_max_por_pedido: 20 };
    expect(DesafioVendasContrato.parse({ ...d, xp_max_por_desafio: 300 }).xp_max_por_desafio).toBe(300);
    expect(DesafioVendasContrato.safeParse({ ...d, xp_max_por_desafio: 0 }).success).toBe(true);
    expect(DesafioVendasContrato.safeParse({ ...d, xp_max_por_desafio: -1 }).success).toBe(false);
    expect(DesafioVendasContrato.safeParse({ ...d, xp_max_por_desafio: 1.5 }).success).toBe(false);
  });
});

describe('parâmetros do tenant', () => {
  it('RN-TRE-01/02/04: vazio assume os padrões do doc 03', () => {
    expect(ParametrosTreinamentoSchema.parse({})).toMatchObject({ nota_minima_pct: 70, tentativas_max_dia: 3, segundos_minimos_licao: 30, pct_minimo_duracao_licao: 50, xp_max_por_desafio: 500, xp_licao: 10, xp_acerto_questao: 5, xp_trilha: 50, xp_streak_por_dia: 2, xp_streak_teto: 20, fuso: 'America/Manaus' });
  });
  it('Ajustes A e D: recusa negativos e percentual fora de 0–100', () => {
    expect(ParametrosTreinamentoSchema.safeParse({ xp_max_por_desafio: -1 }).success).toBe(false);
    expect(ParametrosTreinamentoSchema.safeParse({ segundos_minimos_licao: -5 }).success).toBe(false);
    expect(ParametrosTreinamentoSchema.safeParse({ pct_minimo_duracao_licao: 101 }).success).toBe(false);
    expect(ParametrosTreinamentoSchema.safeParse({ pct_minimo_duracao_licao: -0.1 }).success).toBe(false);
    expect(ParametrosTreinamentoSchema.safeParse({ pct_minimo_duracao_licao: 100, xp_max_por_desafio: 0 }).success).toBe(true);
  });
  it('faixas de nível que não crescem são recusadas', () => {
    expect(ParametrosTreinamentoSchema.safeParse({ niveis_xp_min: [0, 100, 100] }).success).toBe(false);
    expect(ParametrosTreinamentoSchema.safeParse({ niveis_xp_min: [10, 100] }).success).toBe(false);
  });
});

describe('T-0024: eventos publicados pelo Treinamento', () => {
  it('todo `publica` do manifesto tem DefinicaoEvento exportada e nenhuma é de evento alheio', async () => {
    const { default: manifest } = await import('../manifest');
    expect(conferirEventosPublicados(manifest, contratos)).toEqual([]);
  });
});
