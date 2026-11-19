import { describe, expect, it } from 'vitest';
import {
  AceiteTermoRastreamentoSchema,
  AusenciaUsuarioEntradaSchema,
  AusenciaUsuarioSchema,
  CONSULTA_TRAJETO_DO_DIA,
  ParametrosRastreamentoSchema,
  PARAMETROS_RASTREAMENTO_PADRAO,
  PausaTrajetoSchema,
  PontoTrajetoSchema,
  TermoRastreamentoPublicarSchema,
  TermoRastreamentoSchema,
  TrajetoDoDiaEntradaSchema,
  TrajetoDoDiaSaidaSchema,
} from './trajeto';

const ID = '0b000000-0000-4000-8000-000000000001';
const ID2 = '0b000000-0000-4000-8000-000000000002';
const ponto = { id: ID, capturado_em: '2026-11-19T13:00:00.000Z', latitude: -3.119028, longitude: -60.021731, precisao_m: 12, velocidade_ms: null };

describe('RN-CORE-13: contratos do rastreamento (T-0156, desenho tracking §3.1 e §5)', () => {
  it('RN-CORE-13: o ponto leva só id, instante, coordenada (6 casas), precisão e velocidade; campo a mais é recusado', () => {
    expect(PontoTrajetoSchema.parse(ponto)).toEqual(ponto);
    expect(PontoTrajetoSchema.safeParse({ ...ponto, endereco: 'Rua X' }).success).toBe(false);
    expect(PontoTrajetoSchema.safeParse({ ...ponto, altitude: 30 }).success).toBe(false);
    expect(PontoTrajetoSchema.safeParse({ ...ponto, latitude: 91 }).success).toBe(false);
    expect(PontoTrajetoSchema.safeParse({ ...ponto, longitude: -181 }).success).toBe(false);
    expect(PontoTrajetoSchema.safeParse({ ...ponto, latitude: -3.1190281 }).success).toBe(false);
    expect(PontoTrajetoSchema.safeParse({ ...ponto, precisao_m: -1 }).success).toBe(false);
  });

  it('RN-CORE-13: a pausa registra só o início e o fim (fim nulo = em curso), sem motivo; o fim não vem antes do início', () => {
    expect(PausaTrajetoSchema.safeParse({ id: ID, inicio: '2026-11-19T13:00:00Z', fim: null }).success).toBe(true);
    expect(PausaTrajetoSchema.safeParse({ id: ID, inicio: '2026-11-19T13:00:00Z', fim: '2026-11-19T13:30:00Z' }).success).toBe(true);
    expect(PausaTrajetoSchema.safeParse({ id: ID, inicio: '2026-11-19T13:00:00Z', fim: '2026-11-19T12:59:00Z' }).success).toBe(false);
    expect(PausaTrajetoSchema.safeParse({ id: ID, inicio: '2026-11-19T13:00:00Z', fim: null, motivo: 'almoço' }).success).toBe(false);
  });

  it('RN-CORE-13: aceite do termo pela versão (inteiro ≥ 1) e pela hora do aparelho', () => {
    expect(AceiteTermoRastreamentoSchema.safeParse({ id: ID, termo_versao: 1, aceito_em: '2026-11-19T12:00:00Z' }).success).toBe(true);
    expect(AceiteTermoRastreamentoSchema.safeParse({ id: ID, termo_versao: 0, aceito_em: '2026-11-19T12:00:00Z' }).success).toBe(false);
  });

  it('RN-CORE-13: termo publicado tem versão e texto; a publicação no BKO manda só o texto', () => {
    expect(TermoRastreamentoSchema.safeParse({ id: ID, versao: 2, texto: 'Termo', publicado_em: '2026-11-19T12:00:00Z', updated_at: '2026-11-19T12:00:00Z', deleted_at: null }).success).toBe(true);
    expect(TermoRastreamentoPublicarSchema.safeParse({ texto: '   ' }).success).toBe(false);
    expect(TermoRastreamentoPublicarSchema.safeParse({ texto: 'Termo da empresa', versao: 3 }).success).toBe(false);
  });

  it('RN-CORE-13: ausência é por usuário, de ≤ até, em datas civis e sem motivo (minimização)', () => {
    expect(AusenciaUsuarioEntradaSchema.safeParse({ usuario_id: ID, de: '2026-12-01', ate: '2026-12-15' }).success).toBe(true);
    expect(AusenciaUsuarioEntradaSchema.safeParse({ usuario_id: ID, de: '2026-12-15', ate: '2026-12-01' }).success).toBe(false);
    expect(AusenciaUsuarioEntradaSchema.safeParse({ usuario_id: ID, de: '2026-02-30', ate: '2026-03-01' }).success).toBe(false);
    expect(AusenciaUsuarioEntradaSchema.safeParse({ usuario_id: ID, de: '2026-12-01', ate: '2026-12-01', motivo: 'férias' }).success).toBe(false);
    expect(AusenciaUsuarioSchema.safeParse({ id: ID2, usuario_id: ID, de: '2026-12-01', ate: '2026-12-01', updated_at: '2026-11-19T12:00:00Z', deleted_at: null }).success).toBe(true);
  });

  it('RN-CORE-13: o rastreamento vem desligado de fábrica, com o expediente proposto (seg–sex 8h–18h, sáb 8h–12h)', () => {
    const p = PARAMETROS_RASTREAMENTO_PADRAO;
    expect(p.ativo).toBe(false);
    expect(ParametrosRastreamentoSchema.parse(p)).toEqual(p);
    expect(p.expediente['0']).toEqual([]);
    expect(p.expediente['1']).toEqual([{ inicio_min: 480, fim_min: 1080 }]);
    expect(p.expediente['6']).toEqual([{ inicio_min: 480, fim_min: 720 }]);
  });

  it('RN-CORE-13: expediente tem de 0 a 2 faixas por dia, com início antes do fim e sem sobreposição', () => {
    const com = (faixas: unknown) => ParametrosRastreamentoSchema.safeParse({ ...PARAMETROS_RASTREAMENTO_PADRAO, expediente: { ...PARAMETROS_RASTREAMENTO_PADRAO.expediente, '1': faixas } }).success;
    expect(com([{ inicio_min: 480, fim_min: 720 }, { inicio_min: 780, fim_min: 1080 }])).toBe(true);
    expect(com([{ inicio_min: 720, fim_min: 480 }])).toBe(false);
    expect(com([{ inicio_min: 480, fim_min: 800 }, { inicio_min: 780, fim_min: 1080 }])).toBe(false);
    expect(com([{ inicio_min: 0, fim_min: 60 }, { inicio_min: 120, fim_min: 180 }, { inicio_min: 240, fim_min: 300 }])).toBe(false);
  });

  it('RN-CORE-13: core.trajeto_do_dia@1 pede usuários e um dia; devolve pontos sem velocidade nem id do aparelho', () => {
    expect(CONSULTA_TRAJETO_DO_DIA.nome).toBe('core.trajeto_do_dia@1');
    expect(TrajetoDoDiaEntradaSchema.safeParse({ usuario_ids: [], data: '2026-11-19' }).success).toBe(false);
    expect(TrajetoDoDiaEntradaSchema.safeParse({ usuario_ids: [ID], data: '2026-11-19' }).success).toBe(true);
    const saida = { data: '2026-11-19', usuarios: [{ id: ID, metros: 1200, pontos: [{ capturado_em: ponto.capturado_em, latitude: ponto.latitude, longitude: ponto.longitude, precisao_m: 12 }], pausas: [] }] };
    expect(TrajetoDoDiaSaidaSchema.parse(saida)).toEqual(saida);
    const comVelocidade = { ...saida, usuarios: [{ ...saida.usuarios[0], pontos: [{ ...saida.usuarios[0]!.pontos[0], velocidade_ms: 3 }] }] };
    expect(TrajetoDoDiaSaidaSchema.safeParse(comVelocidade).success).toBe(false);
  });
});
