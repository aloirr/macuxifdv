import { describe, expect, it } from 'vitest';
import {
  META_PRODUTIVIDADE_PADRAO,
  ProdutividadeIndicadorSchema,
  type IndicadorProdutividade,
  type ProdutividadeIndicador,
} from '../../contracts/performance';
import { em, fechadaNaVirada, FUSO, visita } from './fixtures-teste';
import { metasPadrao } from './metas-produtividade';
import { produtividadeDoPeriodo, type EntradaProdutividade, type ParadaPlanejada } from './produtividade';

/*
 * Semana sintética de 09 a 15/11/2026 (Manaus), hoje = quinta 12/11:
 * - seg 09/11: nenhuma visita (falta), com 2 paradas planejadas e um resumo de km (que não conta: não é dia trabalhado);
 * - ter 10/11 (A): 6 visitas; almoço 11:40 → 13:00; extra sem GPS; cliente fechado; a última fechada na virada do dia;
 * - qua 11/11 (B): 5 visitas, duas no mesmo cliente; visita que atravessa o almoço; sem resumo de km;
 * - qui 12/11 (C, hoje): 1 visita fechada e 1 aberta (extra); 1 parada de hoje ainda não feita.
 */
const [SEG, TER, QUA, QUI] = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12'];
const parada = (
  cliente_id: string,
  data: string,
  rota_id = 'r1',
  deleted_at: string | null = null,
): ParadaPlanejada => ({ cliente_id, data, rota_id, deleted_at });

const VISITAS = [
  // A (terça)
  visita('c1', TER, '07:50', '08:20', { distancia_m: 40 }),
  visita('c2', TER, '08:40', '09:10', { distancia_m: 60, resultado: 'pedido' }),
  visita('c3', TER, '09:30', '11:40', { distancia_m: null, resultado: 'sem_pedido' }), // cliente sem coordenada
  visita('c4', TER, '13:00', '13:30', { sem_gps: true, distancia_m: 999, resultado: 'pedido' }), // extra, sem GPS
  visita('c5', TER, '13:50', '14:00', { distancia_m: 80, resultado: 'cliente_fechado' }),
  fechadaNaVirada('c6', TER, '17:10', { distancia_m: 20 }),
  visita('c9', TER, '15:00', '15:30', { distancia_m: 5000, deleted_at: em(TER, '18:00') }), // removida
  // B (quarta)
  visita('c1', QUA, '08:10', '08:40', { distancia_m: 100 }),
  visita('c1', QUA, '09:00', '09:20', { distancia_m: 100, resultado: 'pedido' }), // mesmo cliente e dia
  visita('c2', QUA, '11:40', '12:20', { distancia_m: 100 }), // atravessa o almoço
  visita('c3', QUA, '13:30', '15:10', { distancia_m: 100 }),
  visita('c4', QUA, '15:20', '16:00', { distancia_m: 100 }),
  // C (hoje)
  visita('c1', QUI, '07:30', '08:00', { distancia_m: 10 }),
  visita('c8', QUI, '08:20', null, { distancia_m: 30 }), // aberta agora, extra
];
const PARADAS = [
  parada('c1', SEG),
  parada('c2', SEG),
  ...['c1', 'c2', 'c3', 'c5', 'c6', 'c7'].map((c) => parada(c, TER)),
  parada('c10', TER, 'r-cancelada'),
  parada('c11', TER, 'r1', em(TER, '07:00')),
  ...['c1', 'c2', 'c3', 'c4'].map((c) => parada(c, QUA)),
  parada('c1', QUI),
  parada('c2', QUI), // ainda não feita: não é falta
];
const ROTAS = [
  { id: 'r1', situacao: 'publicada' },
  { id: 'r-cancelada', situacao: 'cancelada' },
];
const DESLOCAMENTOS = [
  { data: SEG, metros: 30_000 },
  { data: TER, metros: 80_000 },
  { data: QUI, metros: 5_000 },
];

const SEMANA: EntradaProdutividade = {
  de: SEG,
  ate: '2026-11-15',
  hoje: QUI,
  fuso: FUSO,
  visitas: VISITAS,
  paradas: PARADAS,
  rotas: ROTAS,
  deslocamentos: DESLOCAMENTOS,
  metas: metasPadrao(),
};

function indicadores(e: EntradaProdutividade): Record<IndicadorProdutividade, ProdutividadeIndicador> {
  const l = produtividadeDoPeriodo(e);
  for (const i of l) expect(ProdutividadeIndicadorSchema.parse(i)).toEqual(i);
  return Object.fromEntries(l.map((i) => [i.indicador, i])) as Record<
    IndicadorProdutividade,
    ProdutividadeIndicador
  >;
}
const valores = (e: EntradaProdutividade) =>
  Object.fromEntries(produtividadeDoPeriodo(e).map((i) => [i.indicador, [i.valor, i.amostra]]));

describe('RN-CORE-43: os 12 indicadores na semana sintética', () => {
  const r = indicadores(SEMANA);
  it('RN-CORE-43: 1º check-in = média dos 3 dias trabalhados (07:50, 08:10, 07:30 → 07:50 = 470); a falta de segunda não entra', () => {
    expect([r.primeiro_checkin.valor, r.primeiro_checkin.amostra]).toEqual([470, 3]);
  });
  it('RN-CORE-43: último check-in = só dias encerrados (17:10 e 15:20 → 16:15 = 975); hoje fica fora', () => {
    expect([r.ultimo_checkin.valor, r.ultimo_checkin.amostra]).toEqual([975, 2]);
  });
  it('RN-CORE-43: TMA por visita com check-out real, sem cliente fechado nem fechamento automático (480 ÷ 10 = 48)', () => {
    expect([r.tma.valor, r.tma.amostra]).toEqual([48, 10]);
  });
  it('RN-CORE-43: TMD por intervalo, sem o almoço de cada dia (440 ÷ 8 = 55)', () => {
    expect([r.tmd.valor, r.tmd.amostra]).toEqual([55, 8]);
  });
  it('RN-CORE-44: almoço = média dos dias encerrados com almoço (80 e 70 → 75)', () => {
    expect([r.almoco.valor, r.almoco.amostra]).toEqual([75, 2]);
  });
  it('RN-CORE-44: jornada líquida = fim − 1º check-in − almoço (A: 17:10 − 07:50 − 80 = 480; B: 16:00 − 08:10 − 70 = 400 → 440)', () => {
    expect([r.jornada_liquida.valor, r.jornada_liquida.amostra]).toEqual([440, 2]);
  });
  it('RN-CORE-43: % fora de rota = visitas contadas sem parada do cliente no dia (2 de 12 = 16,67%)', () => {
    expect([r.fora_rota.valor, r.fora_rota.amostra]).toEqual([1667, 12]);
  });
  it('RN-CORE-43: visitas por dia = contadas nos dias encerrados ÷ dias trabalhados encerrados (10 ÷ 2 = 5,0)', () => {
    expect([r.visitas_dia.valor, r.visitas_dia.amostra]).toEqual([50, 2]);
  });
  it('RN-CORE-43: cobertura = planejadas visitadas ÷ consideradas (10 de 13), com a parada de hoje não feita fora da conta', () => {
    expect([r.cobertura_rota.valor, r.cobertura_rota.amostra]).toEqual([7692, 13]);
  });
  it('RN-CORE-43: raio = média das visitas com GPS e cliente com coordenada (740 ÷ 11 = 67 m)', () => {
    expect([r.raio_checkin.valor, r.raio_checkin.amostra]).toEqual([67, 11]);
  });
  it('RN-CORE-46: km por dia = só dias encerrados trabalhados com resumo (terça: 80 km)', () => {
    expect([r.km_dia.valor, r.km_dia.amostra]).toEqual([80_000, 1]);
  });
  it('RN-CORE-46: km por cliente = km dos dias com resumo ÷ clientes atendidos nesses dias (85 km ÷ 5 = 17 km)', () => {
    expect([r.km_cliente.valor, r.km_cliente.amostra]).toEqual([17_000, 5]);
  });
  it('RN-CORE-45: com o padrão do FDV: ponto verde onde está dentro e laranja onde está fora', () => {
    const s = Object.fromEntries(Object.values(r).map((i) => [i.indicador, i.situacao]));
    expect(s).toEqual({
      primeiro_checkin: 'dentro',
      ultimo_checkin: 'fora',
      tma: 'fora',
      tmd: 'fora',
      almoco: 'dentro',
      jornada_liquida: 'fora',
      fora_rota: 'fora',
      visitas_dia: 'fora',
      cobertura_rota: 'fora',
      raio_checkin: 'dentro',
      km_dia: 'dentro',
      km_cliente: 'fora',
    });
    expect(r.tma).toMatchObject({ meta: 30, meta_origem: 'padrao_fdv' });
  });
  it('RN-CORE-43: a lista sai na ordem de INDICADORES_PRODUTIVIDADE', () => {
    expect(produtividadeDoPeriodo(SEMANA).map((i) => i.indicador)).toEqual(
      Object.keys(META_PRODUTIVIDADE_PADRAO),
    );
  });
});

describe('RN-CORE-43: casos de borda da §3.4', () => {
  it('RN-CORE-43: dia sem check-in fica fora das médias por dia, e as paradas dele contam como não visitadas', () => {
    const sem = indicadores({ ...SEMANA, paradas: PARADAS.filter((p) => p.data !== SEG) });
    expect(sem.cobertura_rota.amostra).toBe(11);
    expect(sem.cobertura_rota.valor).toBe(9091); // 10 ÷ 11
    expect(indicadores(SEMANA).primeiro_checkin.amostra).toBe(3);
  });
  it('RN-CORE-43: período sem nenhuma visita: tudo sem_dado; cobertura 0% com parada planejada', () => {
    const r = indicadores({ ...SEMANA, visitas: [] });
    for (const i of Object.values(r))
      if (i.indicador !== 'cobertura_rota') expect(i.situacao, i.indicador).toBe('sem_dado');
    expect(r.cobertura_rota).toMatchObject({ valor: 0, situacao: 'fora' });
  });
  it('RN-CORE-43: período sem visita e sem parada: cobertura sem_dado, com a meta visível', () => {
    const r = indicadores({ ...SEMANA, visitas: [], paradas: [] });
    expect(r.cobertura_rota).toMatchObject({
      valor: null,
      situacao: 'sem_dado',
      meta: 9000,
      meta_origem: 'padrao_fdv',
      amostra: 0,
    });
  });
  it('RN-CORE-43: check-in sem check-out conta em visitas, fora de rota, raio e check-ins, e fica fora do TMA e do TMD', () => {
    const base = { ...SEMANA, de: QUI, ate: QUI };
    const com = valores(base);
    const sem = valores({
      ...base,
      visitas: VISITAS.filter((v) => v.cliente_id !== 'c8' || v.data_local !== QUI),
    });
    expect(com.visitas_dia).toEqual([20, 1]);
    expect(sem.visitas_dia).toEqual([10, 1]);
    expect(com.fora_rota).toEqual([5000, 2]);
    expect(com.raio_checkin).toEqual([20, 2]);
    expect(com.ultimo_checkin).toEqual([500, 1]); // 08:20
    expect(com.tma).toEqual(sem.tma);
    expect(com.tmd).toEqual([20, 1]); // 08:00 → 08:20: o intervalo vem do check-out real anterior
  });
  it('RN-CORE-43 (RN-CORE-11): fechada na virada do dia conta como visita, fica fora de TMA, TMD e almoço; a jornada vai até o último check-in', () => {
    const dia = [
      visita('a', TER, '08:00', '11:50'),
      visita('b', TER, '13:00', '13:30'),
      fechadaNaVirada('c', TER, '16:00'),
    ];
    const r = valores({ ...SEMANA, visitas: dia, paradas: [] });
    expect(r.visitas_dia).toEqual([30, 1]);
    expect(r.tma).toEqual([130, 2]); // (230 + 30) ÷ 2: a fechada na virada não entra
    expect(r.almoco).toEqual([70, 1]); // 11:50 → 13:00
    expect(r.tmd).toEqual([150, 1]); // 13:30 → 16:00; o check-out automático das 23:59 não abre intervalo
    expect(r.jornada_liquida).toEqual([410, 1]); // 16:00 (último check-in) − 08:00 − 70
  });
  it('RN-CORE-43: cliente fechado conta em visitas, no TMD e no fora de rota; fica fora do TMA e não é cliente atendido', () => {
    const dia = [
      visita('a', TER, '08:00', '08:30'),
      visita('b', TER, '08:50', '09:00', { resultado: 'cliente_fechado' }),
      visita('c', TER, '09:20', '09:50'),
    ];
    const r = valores({
      ...SEMANA,
      visitas: dia,
      paradas: [],
      deslocamentos: [{ data: TER, metros: 9_000 }],
    });
    expect(r.tma).toEqual([30, 2]);
    expect(r.tmd).toEqual([20, 2]);
    expect(r.fora_rota).toEqual([10_000, 3]);
    expect(r.visitas_dia).toEqual([30, 1]);
    expect(r.km_cliente).toEqual([4_500, 2]);
  });
  it('RN-CORE-43: cliente sem coordenada e check-in sem GPS ficam fora do raio; sem nenhuma visita com distância, sem_dado', () => {
    const dia = [
      visita('a', TER, '08:00', '08:30', { distancia_m: null }),
      visita('b', TER, '09:00', '09:30', { sem_gps: true, distancia_m: 12 }),
    ];
    const r = indicadores({ ...SEMANA, visitas: dia });
    expect(r.raio_checkin).toMatchObject({ valor: null, situacao: 'sem_dado', amostra: 0, meta: 100 });
    expect(
      valores({ ...SEMANA, visitas: [...dia, visita('c', TER, '10:00', '10:30', { distancia_m: 25 })] })
        .raio_checkin,
    ).toEqual([25, 1]);
  });
  it('RN-CORE-43: visita extra conta no numerador do fora de rota e não muda a cobertura', () => {
    const planejada = [visita('a', TER, '08:00', '08:30')];
    const comExtra = [...planejada, visita('x', TER, '09:00', '09:30')];
    const p = [parada('a', TER)];
    expect(valores({ ...SEMANA, visitas: planejada, paradas: p }).fora_rota).toEqual([0, 1]);
    expect(valores({ ...SEMANA, visitas: comExtra, paradas: p }).fora_rota).toEqual([5000, 2]);
    expect(valores({ ...SEMANA, visitas: comExtra, paradas: p }).cobertura_rota).toEqual(
      valores({ ...SEMANA, visitas: planejada, paradas: p }).cobertura_rota,
    );
  });
  it('RN-CORE-43 (RN-CORE-20): duas visitas no mesmo cliente e dia = 1 visita contada; TMA e TMD usam as duas linhas', () => {
    const dia = [visita('a', TER, '08:00', '08:30'), visita('a', TER, '08:40', '09:00')];
    const r = valores({ ...SEMANA, visitas: dia, paradas: [parada('a', TER)] });
    expect(r.visitas_dia).toEqual([10, 1]);
    expect(r.tma).toEqual([25, 2]);
    expect(r.tmd).toEqual([10, 1]);
    expect(r.cobertura_rota).toEqual([10_000, 1]);
  });
  it('RN-CORE-46: dia trabalhado sem resumo de km fica fora (numerador e denominador); sem nenhum resumo, km sem_dado com a meta visível', () => {
    const r = indicadores({ ...SEMANA, deslocamentos: [] });
    expect(r.km_dia).toMatchObject({ valor: null, situacao: 'sem_dado', meta: 120_000, amostra: 0 });
    expect(r.km_cliente).toMatchObject({ valor: null, situacao: 'sem_dado', meta: 12_000, amostra: 0 });
    // Os outros 10 seguem normais (critério 6 do §10).
    expect(
      Object.values(r)
        .filter((i) => i.situacao === 'sem_dado')
        .map((i) => i.indicador),
    ).toEqual(['km_dia', 'km_cliente']);
  });
  it('RN-CORE-46: sem estimativa por linha reta: com visitas distantes e sem resumo, o km continua sem_dado', () => {
    const longe = [
      visita('a', TER, '08:00', '08:30', { distancia_m: 10 }),
      visita('b', TER, '12:00', '12:30', { distancia_m: 10 }),
    ];
    const r = valores({ ...SEMANA, visitas: longe, deslocamentos: [] });
    expect(r.km_dia).toEqual([null, 0]);
    expect(r.km_cliente).toEqual([null, 0]);
  });
  it('RN-CORE-46: resumo removido não conta', () => {
    expect(
      valores({ ...SEMANA, deslocamentos: [{ data: TER, metros: 80_000, deleted_at: em(TER, '20:00') }] })
        .km_dia,
    ).toEqual([null, 0]);
  });
  it('RN-CORE-43: relógio do aparelho: a Performance confia no checkin_em aceito pelo servidor, sem ajuste', () => {
    expect(valores({ ...SEMANA, visitas: [visita('a', TER, '05:01', '05:30')] }).primeiro_checkin).toEqual([
      301, 1,
    ]);
  });
  it('RN-CORE-43: visita removida fica fora de tudo', () => {
    const r = valores({
      ...SEMANA,
      visitas: [visita('a', TER, '08:00', '08:30', { deleted_at: em(TER, '09:00') })],
      paradas: [],
    });
    expect(Object.values(r).every(([v]) => v === null)).toBe(true);
  });
  it('RN-CORE-43: parada de rota cancelada ou removida não é planejada', () => {
    const dia = [visita('c10', TER, '08:00', '08:30'), visita('c11', TER, '09:00', '09:30')];
    expect(valores({ ...SEMANA, visitas: dia }).fora_rota).toEqual([10_000, 2]);
  });
});

describe('RN-CORE-43: período Hoje (§3.3)', () => {
  const HOJE = { ...SEMANA, de: QUI, ate: QUI };
  it('RN-CORE-43: todos os indicadores usam só hoje, até agora, inclusive os de fim de dia', () => {
    const r = valores(HOJE);
    expect(r.primeiro_checkin).toEqual([450, 1]);
    expect(r.ultimo_checkin).toEqual([500, 1]);
    expect(r.almoco).toEqual([null, 0]); // o dia ainda não passou do corte
    expect(r.jornada_liquida).toEqual([50, 1]); // 08:20 (último check-in) − 07:30
    expect(r.visitas_dia).toEqual([20, 1]);
    expect(r.km_dia).toEqual([5_000, 1]);
    expect(r.km_cliente).toEqual([5_000, 1]);
    // A-2 (§3.1 linha 9): em Hoje entram todas as paradas do dia; c2 ainda não feita = andamento 1 de 2.
    expect(r.cobertura_rota).toEqual([5_000, 2]);
  });
  it('RN-CORE-43: hoje entra nos indicadores por visita de um período maior (1º check-in, TMA, TMD, raio, fora de rota)', () => {
    const r = valores(SEMANA);
    expect(r.primeiro_checkin![1]).toBe(3);
    expect(r.ultimo_checkin![1]).toBe(2);
  });
  it('RN-CORE-43: dias depois de hoje não entram (visita futura no aparelho é ignorada)', () => {
    expect(
      valores({ ...SEMANA, visitas: [...VISITAS, visita('z', '2026-11-13', '06:00', '06:30')] })
        .primeiro_checkin,
    ).toEqual([470, 3]);
  });
});

describe('RN-CORE-45: situação de cada indicador', () => {
  const dia = [visita('a', TER, '08:00', '08:30')];
  it('RN-CORE-45: igual à meta é dentro, nos dois sentidos', () => {
    const metas = {
      ...metasPadrao(),
      primeiro_checkin: { valor: 480, origem: 'tenant' as const },
      tma: { valor: 30, origem: 'usuario' as const },
      visitas_dia: { valor: 10, origem: 'equipe' as const },
    };
    const r = indicadores({ ...SEMANA, visitas: dia, metas });
    expect(r.primeiro_checkin).toMatchObject({
      valor: 480,
      meta: 480,
      situacao: 'dentro',
      meta_origem: 'tenant',
    });
    expect(r.tma).toMatchObject({ valor: 30, situacao: 'dentro', meta_origem: 'usuario' });
    expect(r.visitas_dia).toMatchObject({ valor: 10, situacao: 'dentro', meta_origem: 'equipe' });
  });
  it('RN-CORE-45: um minuto acima de "até" é fora; um abaixo de "a partir de" é fora', () => {
    const metas = {
      ...metasPadrao(),
      primeiro_checkin: { valor: 479, origem: 'tenant' as const },
      visitas_dia: { valor: 11, origem: 'tenant' as const },
    };
    const r = indicadores({ ...SEMANA, visitas: dia, metas });
    expect(r.primeiro_checkin.situacao).toBe('fora');
    expect(r.visitas_dia.situacao).toBe('fora');
  });
  it('RN-CORE-45: sem meta (D5 recusada): sem_meta, sem ponto e sem a linha "meta …"', () => {
    const r = indicadores({ ...SEMANA, visitas: dia, metas: {} });
    expect(r.tma).toMatchObject({ situacao: 'sem_meta', meta: null, meta_origem: null, valor: 30 });
  });
});
