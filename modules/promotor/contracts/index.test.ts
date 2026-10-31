import { describe, expect, it } from 'vitest';
import {
  AcaoConcorrencia,
  ColetaPreco,
  FotoColeta,
  GondolaRegistro,
  IndicadorPromotorDia,
  MedicaoShare,
  ParametrosPromotorSchema,
  PontoExtra,
  PontoExtraNegociado,
  RupturaItem,
  TarefaExecucao,
  ValidadeItem,
  VisitaLoja,
} from './index';

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T0 = '2026-10-31T13:00:00Z';

describe('contratos do Promotor: ids, datas e dinheiro', () => {
  it('id precisa ser UUID gerado no aparelho', () => {
    const r = RupturaItem.safeParse({ id: '123', visita_loja_id: u(2), produto_id: u(3), mix_obrigatorio_id: u(4), status: 'presente', registrado_em: T0 });
    expect(r.success).toBe(false);
  });

  it('instante precisa ser ISO UTC (com Z)', () => {
    const base = { id: u(1), visita_loja_id: u(2), produto_id: u(3), mix_obrigatorio_id: u(4), status: 'presente' };
    expect(RupturaItem.safeParse({ ...base, registrado_em: '2026-10-31T13:00:00Z' }).success).toBe(true);
    expect(RupturaItem.safeParse({ ...base, registrado_em: '31/10/2026 13:00' }).success).toBe(false);
    expect(RupturaItem.safeParse({ ...base, registrado_em: '2026-10-31T13:00:00-04:00' }).success).toBe(false);
  });
});

describe('RN-PRO-02: foto da coleta', () => {
  const foto = { id: u(1), visita_loja_id: u(2), tipo: 'gondola_antes', origem: 'camera', tirada_em: T0, latitude: -3.1, longitude: -60.0 };
  it('aceita foto de câmera com data/hora e coordenada', () => {
    expect(FotoColeta.parse(foto)).toMatchObject({ arquivo_ref: null, enviada_em: null });
  });
  it('RN-PRO-02: foto da galeria é recusada', () => {
    expect(FotoColeta.safeParse({ ...foto, origem: 'galeria' }).success).toBe(false);
  });
  it('RN-PRO-02: sem coordenada é recusada', () => {
    const { latitude: _l, ...semLat } = foto;
    expect(FotoColeta.safeParse(semLat).success).toBe(false);
  });
});

describe('RN-PRO-06: visita de loja', () => {
  const v = { id: u(1), visita_id: u(2), cliente_id: u(3), checklist_modelo_id: null, checkin_em: T0, checkout_em: '2026-10-31T13:40:00Z', permanencia_min: 40, desfecho: 'realizada', foto_fachada_id: null };
  it('visita realizada válida', () => {
    expect(VisitaLoja.safeParse(v).success).toBe(true);
  });
  it('RN-PRO-06: loja fechada sem foto da fachada é recusada; com foto passa', () => {
    expect(VisitaLoja.safeParse({ ...v, desfecho: 'loja_fechada' }).success).toBe(false);
    expect(VisitaLoja.safeParse({ ...v, desfecho: 'acesso_negado' }).success).toBe(false);
    expect(VisitaLoja.safeParse({ ...v, desfecho: 'loja_fechada', foto_fachada_id: u(9) }).success).toBe(true);
  });
  it('checkout anterior ao check-in é recusado', () => {
    expect(VisitaLoja.safeParse({ ...v, checkout_em: '2026-10-31T12:00:00Z' }).success).toBe(false);
  });
  it('RN-PRO-07: permanência inflada vinda do aparelho é recusada; a recalculada passa', () => {
    expect(VisitaLoja.safeParse({ ...v, permanencia_min: 600 }).success).toBe(false);
    expect(VisitaLoja.safeParse({ ...v, permanencia_min: 40.4 }).success).toBe(true);
    expect(VisitaLoja.safeParse({ ...v, permanencia_min: null }).success).toBe(false);
  });
  it('visita aberta: sem checkout, desfecho nem permanência', () => {
    expect(VisitaLoja.safeParse({ ...v, checkout_em: null, desfecho: null, permanencia_min: null }).success).toBe(true);
    expect(VisitaLoja.safeParse({ ...v, checkout_em: null }).success).toBe(false);
  });
});

describe('RF-PRO-03: gôndola', () => {
  const g = { id: u(1), visita_loja_id: u(2), categoria_gondola_id: u(3), foto_antes_id: u(4), foto_depois_id: u(5), foto_referencia_id: null, conformidade: 'conforme', registrado_em: T0 };
  it('RF-PRO-03: conforme sem motivo é válido', () => {
    expect(GondolaRegistro.safeParse(g).success).toBe(true);
  });
  it('RF-PRO-03: não conforme exige motivo', () => {
    expect(GondolaRegistro.safeParse({ ...g, conformidade: 'nao_conforme' }).success).toBe(false);
    expect(GondolaRegistro.safeParse({ ...g, conformidade: 'nao_conforme', motivo: 'Ponta tomada por concorrente' }).success).toBe(true);
  });
  it('exige fotos antes e depois', () => {
    const { foto_depois_id: _d, ...sem } = g;
    expect(GondolaRegistro.safeParse(sem).success).toBe(false);
  });
});

describe('RN-PRO-03: medição de share', () => {
  const m = { id: u(1), visita_loja_id: u(2), categoria_gondola_id: u(3), frentes_nossas: 12, frentes_total: 40, share_pct: 30, meta_share_id: u(4), meta_pct: 40, atingimento_pct: 75, medido_em: T0 };
  it('aceita share conferido com as frentes', () => {
    expect(MedicaoShare.safeParse(m).success).toBe(true);
  });
  it('RN-PRO-03: recusa share que não confere (a API recalcula)', () => {
    expect(MedicaoShare.safeParse({ ...m, share_pct: 35 }).success).toBe(false);
  });
  it('RN-PRO-03: atingimento inflado vindo do aparelho é recusado', () => {
    expect(MedicaoShare.safeParse({ ...m, atingimento_pct: 150 }).success).toBe(false);
    expect(MedicaoShare.safeParse({ ...m, atingimento_pct: null }).success).toBe(false);
  });
  it('RN-PRO-03: sem meta, o atingimento tem de ser nulo', () => {
    const sem = { ...m, meta_share_id: null, meta_pct: null };
    expect(MedicaoShare.safeParse({ ...sem, atingimento_pct: null }).success).toBe(true);
    expect(MedicaoShare.safeParse({ ...sem, atingimento_pct: 100 }).success).toBe(false);
  });
  it('RN-PRO-10: meta informada exige o id da meta vigente', () => {
    expect(MedicaoShare.safeParse({ ...m, meta_share_id: null }).success).toBe(false);
  });
  it('RN-PRO-03: recusa nossas > total', () => {
    expect(MedicaoShare.safeParse({ ...m, frentes_nossas: 41, share_pct: null }).success).toBe(false);
  });
  it('RN-PRO-03: usa cm quando informado', () => {
    expect(MedicaoShare.safeParse({ ...m, cm_nossos: 150, cm_total: 300, share_pct: 50, atingimento_pct: 125 }).success).toBe(true);
    expect(MedicaoShare.safeParse({ ...m, cm_nossos: 150, cm_total: 300 }).success).toBe(false);
  });
});

describe('RN-PRO-04: coleta de preço', () => {
  const nosso = { id: u(1), visita_loja_id: u(2), produto_id: u(3), concorrente_id: null, produto_concorrente_id: null, preco_cents: 1090, coletado_em: T0 };
  const conc = { ...nosso, id: u(5), concorrente_id: u(6), produto_concorrente_id: u(7), preco_cents: 1000, preco_nosso_ref_cents: 1090, indice_preco: 109 };
  it('nosso preço em centavos inteiros', () => {
    expect(ColetaPreco.safeParse(nosso).success).toBe(true);
    expect(ColetaPreco.safeParse({ ...nosso, preco_cents: 10.9 }).success).toBe(false);
    expect(ColetaPreco.safeParse({ ...nosso, preco_cents: 0 }).success).toBe(false);
  });
  it('RN-PRO-04: índice de preço do concorrente precisa conferir', () => {
    expect(ColetaPreco.safeParse(conc).success).toBe(true);
    expect(ColetaPreco.safeParse({ ...conc, indice_preco: 95 }).success).toBe(false);
  });
  it('RN-PRO-04: concorrente em promoção usa o preço promocional no índice', () => {
    const promo = { ...conc, em_promocao: true, preco_promocional_cents: 800, indice_preco: 136.25 };
    expect(ColetaPreco.safeParse(promo).success).toBe(true);
  });
  it('RN-PRO-04: promoção sem preço promocional é recusada', () => {
    expect(ColetaPreco.safeParse({ ...nosso, em_encarte: true }).success).toBe(false);
  });
  it('linha de concorrente exige o concorrente; linha nossa não tem índice', () => {
    expect(ColetaPreco.safeParse({ ...conc, concorrente_id: null }).success).toBe(false);
    expect(ColetaPreco.safeParse({ ...nosso, indice_preco: 100 }).success).toBe(false);
  });
});

describe('RN-PRO-05: ruptura', () => {
  const r = { id: u(1), visita_loja_id: u(2), produto_id: u(3), mix_obrigatorio_id: u(4), status: 'ruptura_gondola', quantidade_reposta: 12, registrado_em: T0 };
  it('ruptura na gôndola aceita quantidade reposta', () => {
    expect(RupturaItem.safeParse(r).success).toBe(true);
  });
  it('ruptura total não tem quantidade reposta', () => {
    expect(RupturaItem.safeParse({ ...r, status: 'ruptura_total' }).success).toBe(false);
    expect(RupturaItem.safeParse({ ...r, status: 'ruptura_total', quantidade_reposta: 0 }).success).toBe(true);
  });
  it('status desconhecido é recusado', () => {
    expect(RupturaItem.safeParse({ ...r, status: 'faltando' }).success).toBe(false);
  });
});

describe('RF-PRO-07: validade e avarias', () => {
  const v = { id: u(1), visita_loja_id: u(2), produto_id: u(3), tipo: 'validade', validade: '2026-11-15', quantidade: 12, registrado_em: T0 };
  it('validade exige data civil válida', () => {
    expect(ValidadeItem.safeParse(v).success).toBe(true);
    expect(ValidadeItem.safeParse({ ...v, validade: null }).success).toBe(false);
    expect(ValidadeItem.safeParse({ ...v, validade: '2026-02-30' }).success).toBe(false);
  });
  it('avaria exige motivo e foto', () => {
    const a = { ...v, tipo: 'avaria', validade: null };
    expect(ValidadeItem.safeParse(a).success).toBe(false);
    expect(ValidadeItem.safeParse({ ...a, motivo_avaria: 'Embalagem rasgada' }).success).toBe(false);
    expect(ValidadeItem.safeParse({ ...a, motivo_avaria: 'Embalagem rasgada', foto_id: u(9) }).success).toBe(true);
  });
  it('quantidade inteira positiva', () => {
    expect(ValidadeItem.safeParse({ ...v, quantidade: 0 }).success).toBe(false);
  });
});

describe('RF-PRO-08: pontos extras', () => {
  const p = { id: u(1), visita_loja_id: u(2), ponto_extra_negociado_id: u(3), tipo: 'ponta_gondola', existe: true, no_lugar: true, abastecido: true, foto_id: u(4), registrado_em: T0 };
  it('conferência completa com foto', () => {
    expect(PontoExtra.safeParse(p).success).toBe(true);
  });
  it('ponto que existe exige foto', () => {
    expect(PontoExtra.safeParse({ ...p, foto_id: null }).success).toBe(false);
  });
  it('ponto que não existe não pode estar no lugar nem abastecido', () => {
    expect(PontoExtra.safeParse({ ...p, existe: false, foto_id: null }).success).toBe(false);
    expect(PontoExtra.safeParse({ ...p, existe: false, no_lugar: false, abastecido: false, foto_id: null }).success).toBe(true);
  });
  it('RN-PRO-10: negociado tem vigência coerente', () => {
    const n = { id: u(1), cliente_id: u(2), tipo: 'ilha', local_combinado: 'Corredor central', vigencia_inicio: '2026-10-01' };
    expect(PontoExtraNegociado.safeParse(n).success).toBe(true);
    expect(PontoExtraNegociado.safeParse({ ...n, vigencia_fim: '2026-09-30' }).success).toBe(false);
  });
});

describe('RF-PRO-09/10: concorrência e tarefa', () => {
  it('ação da concorrência exige descrição', () => {
    const a = { id: u(1), visita_loja_id: u(2), concorrente_id: u(3), tipo: 'promocao', descricao: 'Leve 3 pague 2', registrado_em: T0 };
    expect(AcaoConcorrencia.safeParse(a).success).toBe(true);
    expect(AcaoConcorrencia.safeParse({ ...a, descricao: ' ' }).success).toBe(false);
  });
  it('RF-PRO-10: tarefa exige ao menos uma foto de comprovação', () => {
    const t = { id: u(1), tarefa_trade_id: u(2), visita_loja_id: u(3), cliente_id: u(4), foto_ids: [u(5)], concluida_em: T0 };
    expect(TarefaExecucao.safeParse(t).success).toBe(true);
    expect(TarefaExecucao.safeParse({ ...t, foto_ids: [] }).success).toBe(false);
  });
});

describe('RF-PRO-12: indicador do dia e parâmetros', () => {
  const i = {
    id: u(1), promotor_id: u(2), data: '2026-10-31', lojas_planejadas: 5, lojas_visitadas: 2, visitas_curtas: 1, visitas_abertas: 1,
    cobertura_pct: 40, tempo_medio_min: 30, conformidade_pct: 50, share_medio_pct: 25, meta_share_media_pct: 30, atingimento_share_pct: 83.33,
    ruptura_pct: 50, falha_reposicao_pct: 25, indice_preco_medio: 100, calculado_em: T0,
  };
  it('indicador completo e indicador vazio (tudo nulo)', () => {
    expect(IndicadorPromotorDia.safeParse(i).success).toBe(true);
    expect(IndicadorPromotorDia.safeParse({ ...i, tempo_medio_min: null, conformidade_pct: null, share_medio_pct: null, ruptura_pct: null, indice_preco_medio: null }).success).toBe(true);
  });
  it('parâmetros têm os padrões do doc 03 ([50%], [10 min], [30] dias)', () => {
    expect(ParametrosPromotorSchema.parse({})).toEqual({ variacao_preco_max_pct: 50, permanencia_min_min: 10, validade_proxima_dias: 30, validade_critica_dias: 7 });
    expect(ParametrosPromotorSchema.safeParse({ validade_critica_dias: 40 }).success).toBe(false);
  });
});
