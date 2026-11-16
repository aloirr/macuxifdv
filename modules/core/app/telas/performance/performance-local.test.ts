import type { ItemSobreposicao } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';

import type { MetaSync, ParametroSync, VisitaSync } from '../../../contracts';
import type { Performance } from '../../../contracts/performance';
import { almocoDoAparelho, calendarioDoAparelho, caminhoDaPerformance, montarPerformance, textoDaBase, visaoDoServidor, type LinhasPerformance } from './performance-local';

const U = '0c000000-0000-4000-8000-000000000001';
const OUTRO = '0c000000-0000-4000-8000-000000000002';
const id = (n: number) => `0c000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const FUSO = 'America/Manaus';
const AGORA = new Date('2026-11-13T15:00:00Z'); // sexta, 11h em Manaus
const NOV = { de: '2026-11-01', ate: '2026-11-30' };
const em = (data: string, hhmm: string) => new Date(`${data}T${hhmm}:00-04:00`).toISOString();

const visita = (n: number, data: string, ini: string, fim: string | null, p: Partial<VisitaSync> = {}): VisitaSync => ({
  id: id(n),
  updated_at: em(data, ini),
  deleted_at: null,
  external_id: null,
  usuario_id: U,
  cliente_id: id(100 + n),
  data_local: data,
  checkin_em: em(data, ini),
  sem_gps: false,
  distancia_m: 40,
  fora_do_raio: false,
  sugere_coordenada: false,
  extra: false,
  checkout_em: fim ? em(data, fim) : null,
  resultado: fim ? 'atendido' : null,
  fechada_por: fim ? 'usuario' : null,
  ...p,
});
const meta = (indicador: MetaSync['indicador'], valor: number, p: Partial<MetaSync> = {}): MetaSync => ({
  id: id(500 + valor),
  updated_at: '2026-11-01T00:00:00Z',
  deleted_at: null,
  external_id: null,
  usuario_id: U,
  periodo: '2026-11',
  indicador,
  valor,
  ...p,
});
const vazio: LinhasPerformance = { visitas: [], rotas: [], paradas: [], metas: [], parametros: [], metasProdutividade: [], deslocamentos: [] };
const OPCOES = { usuarioId: U, perfil: 'vendedor' as const, fuso: FUSO, agora: AGORA, intervalo: NOV };

const copia = (p: Partial<Performance> = {}): Performance => ({
  usuario_id: U,
  de: NOV.de,
  ate: NOV.ate,
  hoje: '2026-11-12',
  base_em: '2026-11-13T00:22:00Z',
  calendario: { du_total: 19, du_decorridos: 8, du_restantes: 12, du_hoje: 8 },
  realizado_servidor: {
    tipo_meta_venda: 'faturamento',
    venda_cents: 8_460_000,
    positivacao: 38,
    positivacao_ate_ontem: 36,
    venda_ate_ontem_cents: 8_000_000,
    pedidos: 50,
    itens_distintos: 320,
    por_mes: [],
  },
  resultados: [],
  produtividade: [],
  ...p,
});

describe('T-0170 §7.1: Performance calculada no aparelho, offline', () => {
  it('Visitas anda com o check-in ainda na fila (RN-CORE-20), só do próprio usuário', () => {
    const fila: ItemSobreposicao[] = [
      { id: id(900), entidade: 'visita', situacao: 'pendente', payload: { id: id(9), cliente_id: id(209), checkin_em: em('2026-11-13', '10:00') } } as ItemSobreposicao,
    ];
    const v = montarPerformance(
      { ...vazio, visitas: [visita(1, '2026-11-12', '08:00', '08:30'), visita(2, '2026-11-12', '09:00', '09:20', { usuario_id: OUTRO })], metas: [meta('visitas', 220)] },
      null,
      fila,
      OPCOES,
    );
    const visitas = v.resultados.find((r) => r.indicador === 'visitas')!;
    expect(visitas.realizado).toBe(2);
    expect(visitas.meta).toBe(220);
    expect(v.hoje).toBe('2026-11-13');
  });

  it('sem cópia do servidor: venda, positivação e itens "sem dado"; nunca zero', () => {
    const v = montarPerformance({ ...vazio, metas: [meta('venda_cents', 18_000_000)] }, null, [], OPCOES);
    expect(v.resultados.filter((r) => r.situacao === 'sem_dado').map((r) => r.indicador)).toEqual(['venda_cents', 'positivacao', 'itens_por_pedido']);
    expect(v.baseEm).toBeNull();
    expect(v.tipoMetaVenda).toBe('pedido'); // a meta sem tipo é de pedido (D6)
  });

  it('com a cópia do MESMO período: os números de venda saem dela; a de outro período é ignorada', () => {
    const linhas = { ...vazio, metas: [meta('venda_cents', 18_000_000)] };
    const com = montarPerformance(linhas, copia(), [], OPCOES);
    expect(com.resultados[0]).toMatchObject({ indicador: 'venda_cents', realizado: 8_460_000, gap: 9_540_000 });
    expect(com.tipoMetaVenda).toBe('faturamento');
    expect(com.baseEm).toBe('2026-11-13T00:22:00Z');
    const outra = montarPerformance(linhas, copia({ de: '2026-10-01', ate: '2026-10-31' }), [], OPCOES);
    expect(outra.resultados[0]!.situacao).toBe('sem_dado');
  });

  it('Produtividade: 12 indicadores com o padrão do FDV (D5); km sem resumo = sem dado', () => {
    const v = montarPerformance({ ...vazio, visitas: [visita(1, '2026-11-12', '07:50', '08:20'), visita(2, '2026-11-12', '08:40', '09:05')] }, null, [], OPCOES);
    expect(v.produtividade).toHaveLength(12);
    expect(v.produtividade.find((p) => p.indicador === 'primeiro_checkin')).toMatchObject({ valor: 470, meta: 480, situacao: 'dentro' });
    expect(v.produtividade.find((p) => p.indicador === 'km_dia')).toMatchObject({ situacao: 'sem_dado', meta: 120_000 });
  });

  it('a meta de produtividade do usuário vence o padrão (RN-CORE-45)', () => {
    const v = montarPerformance(
      {
        ...vazio,
        visitas: [visita(1, '2026-11-12', '07:50', '08:20')],
        metasProdutividade: [{ escopo: 'usuario', equipe_id: null, usuario_id: U, indicador: 'primeiro_checkin', valor: 450, vigencia_inicio: '2026-11' }],
      },
      null,
      [],
      OPCOES,
    );
    expect(v.produtividade.find((p) => p.indicador === 'primeiro_checkin')).toMatchObject({ meta: 450, meta_origem: 'usuario', situacao: 'fora' });
  });

  it('o calendário do período vem do domain (RN-CORE-41): feriados do tenant somam aos nacionais', () => {
    const sem = montarPerformance(vazio, null, [], OPCOES);
    const params: ParametroSync[] = [{ id: id(700), updated_at: '2026-11-01T00:00:00Z', deleted_at: null, external_id: null, modulo: 'core', chave: 'metas.feriados', valor: ['2026-11-24'] }];
    const com = montarPerformance({ ...vazio, parametros: params }, null, [], OPCOES);
    expect(com.calendario.du_total).toBe(sem.calendario.du_total - 1);
    expect(calendarioDoAparelho(params).feriados).toEqual(['2026-11-24']);
  });
});

describe('T-0170: parâmetros, servidor e base', () => {
  const p = (chave: string, valor: unknown): ParametroSync => ({ id: id(800), updated_at: '2026-11-01T00:00:00Z', deleted_at: null, external_id: null, modulo: 'core', chave, valor });

  it('RN-CORE-44: almoço sem horário do usuário nem padrão cadastrado = 12:00 às 13:00; corte e janela antigos não valem mais', () => {
    expect(almocoDoAparelho([p('produtividade.almoco_corte', '12:30'), p('produtividade.almoco_janela', { inicio: '11:30', fim: '14:00' })])).toEqual({ inicio_min: 720, fim_min: 780 });
    expect(almocoDoAparelho([])).toEqual({ inicio_min: 720, fim_min: 780 });
  });

  it('RN-CORE-44 (D5): o horário cadastrado manda: o do usuário, senão o padrão da empresa (parâmetro jornada.almoco_padrao), senão 12:00 às 13:00', () => {
    const padrao = p('jornada.almoco_padrao', { inicio_min: 690, fim_min: 750 });
    expect(almocoDoAparelho([padrao])).toEqual({ inicio_min: 690, fim_min: 750 });
    expect(almocoDoAparelho([padrao], { almoco_inicio_min: 780, almoco_fim_min: 840 })).toEqual({ inicio_min: 780, fim_min: 840 });
    expect(almocoDoAparelho([padrao], { almoco_inicio_min: null, almoco_fim_min: null })).toEqual({ inicio_min: 690, fim_min: 750 });
    expect(almocoDoAparelho([], null)).toEqual({ inicio_min: 720, fim_min: 780 });
  });

  it('fora da janela, a visão é a do servidor; a consulta segue o contrato', () => {
    const r = copia({ resultados: [{ indicador: 'visitas', situacao: 'sem_meta', meta: null, realizado: 3, atingimento_pb: null, gap: null, meta_dia: null, real_dia: 1 }] });
    expect(visaoDoServidor(r)).toMatchObject({ hoje: '2026-11-12', tipoMetaVenda: 'faturamento', resultados: r.resultados });
    expect(caminhoDaPerformance({ de: '2026-01-01', ate: '2026-12-31' })).toBe('/v1/core/performance?de=2026-01-01&ate=2026-12-31');
  });

  it('"base de 12/11, 20:22" só quando a base é de um dia anterior (RN-CORE-26)', () => {
    const hora = (iso: string) => (iso === '2026-11-13T00:22:00Z' ? '20:22' : '??');
    expect(textoDaBase('2026-11-13T00:22:00Z', '2026-11-13', FUSO, hora)).toBe('base de 12/11, 20:22');
    expect(textoDaBase('2026-11-13T00:22:00Z', '2026-11-12', FUSO, hora)).toBeNull();
    expect(textoDaBase(null, '2026-11-13', FUSO, hora)).toBeNull();
  });
});
