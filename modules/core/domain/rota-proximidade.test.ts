import { describe, expect, it } from 'vitest';
import { classificarDias, criarRotasPorProximidade, limiteVisitasPorDia, rotaProtegida, centroDosPontos, diaDeSemanaUtil, totaisDaPrevia, type ClienteParaRota, type EntradaCriarRota } from './rota-proximidade';

const SEG_A_SEX = [1, 2, 3, 4, 5];
const BASE = { lat: -3.1, lng: -60.0 };
const cli = (n: number, lat: number | null, lng: number | null, extra: Partial<ClienteParaRota> = {}): ClienteParaRota => ({ cliente_id: `c${String(n).padStart(3, '0')}`, lat, lng, ...extra });
const entrada = (e: Partial<EntradaCriarRota>): EntradaCriarRota => ({
  de: '2026-11-02',
  ate: '2026-11-06',
  hoje: '2026-11-01',
  base: BASE,
  clientes: [],
  dias_uteis_semana: SEG_A_SEX,
  feriados: [],
  limite: 11,
  existentes: [],
  modo: 'so_vazios',
  ...e,
});

describe('RN-CORE-76: calendário do período', () => {
  it('RN-CORE-76: domingo nunca entra, mesmo com domingo na semana útil', () => {
    const r = classificarDias(entrada({ de: '2026-11-01', ate: '2026-11-08', dias_uteis_semana: [0, 1, 2, 3, 4, 5, 6] }));
    expect(r.livres).not.toContain('2026-11-01');
    expect(r.livres).not.toContain('2026-11-08');
  });

  it('RN-CORE-76: só entram os dias da semana útil do tenant (seg a sex tira o sábado)', () => {
    const r = classificarDias(entrada({ de: '2026-11-09', ate: '2026-11-15', hoje: '2026-11-08' }));
    expect(r.livres).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']);
  });

  it('RN-CORE-76: feriado nacional e feriado do tenant saem dos dias e vão para a lista de feriados', () => {
    const r = classificarDias(entrada({ de: '2026-11-02', ate: '2026-11-06', feriados: ['2026-11-04'] }));
    expect(r.feriados).toEqual(['2026-11-02', '2026-11-04']); // 02/11 é Finados
    expect(r.livres).toEqual(['2026-11-03', '2026-11-05', '2026-11-06']);
  });

  it('RN-CORE-76: novembro de 2026 com seg a sex tem 19 dias livres (21 úteis menos Finados e Consciência Negra)', () => {
    const r = classificarDias(entrada({ de: '2026-11-01', ate: '2026-11-30', hoje: '2026-10-31' }));
    expect(r.livres).toHaveLength(19);
    expect(r.feriados).toEqual(['2026-11-02', '2026-11-20']);
  });

  it('RN-CORE-76: dia passado não entra e hoje entra', () => {
    const r = classificarDias(entrada({ hoje: '2026-11-04' }));
    expect(r.livres).toEqual(['2026-11-04', '2026-11-05', '2026-11-06']);
    expect(classificarDias(entrada({ hoje: '2026-12-01' })).livres).toEqual([]);
  });

  it('RN-CORE-76: com rota existente, so_vazios mantém o dia e substituir troca só a que não é protegida', () => {
    const existentes = [
      { data: '2026-11-03', visitas: 9, protegida: false },
      { data: '2026-11-04', visitas: 5, protegida: true },
    ];
    const manter = classificarDias(entrada({ existentes }));
    expect(manter.mantidas.map((m) => m.data)).toEqual(['2026-11-03', '2026-11-04']);
    expect(manter.livres).not.toContain('2026-11-03');
    expect(manter.substituidas).toBe(0);
    const trocar = classificarDias(entrada({ existentes, modo: 'substituir' }));
    expect(trocar.livres).toContain('2026-11-03');
    expect(trocar.mantidas).toEqual([{ data: '2026-11-04', visitas: 5, protegida: true }]);
    expect(trocar.substituidas).toBe(1);
  });

  it('RN-CORE-76: a rota existente em feriado nunca é substituída', () => {
    const r = classificarDias(entrada({ existentes: [{ data: '2026-11-02', visitas: 3, protegida: false }], modo: 'substituir' }));
    expect(r.mantidas.map((m) => m.data)).toEqual(['2026-11-02']);
    expect(r.feriados).not.toContain('2026-11-02');
  });
});

describe('RN-CORE-76: proteção e limite', () => {
  it('RN-CORE-76: rota do ERP ou com visita é protegida; a do BKO sem visita não', () => {
    expect(rotaProtegida({ origem: 'erp', com_visita: false })).toBe(true);
    expect(rotaProtegida({ origem: 'bko', com_visita: true })).toBe(true);
    expect(rotaProtegida({ origem: 'frequencia', com_visita: false })).toBe(false);
  });

  it('RN-CORE-76: o limite vem da meta visitas_dia em décimos (110 = 11) e nunca é menor que 1', () => {
    expect(limiteVisitasPorDia(110)).toBe(11);
    expect(limiteVisitasPorDia(85)).toBe(9);
    expect(limiteVisitasPorDia(1)).toBe(1);
  });
});

describe('RN-CORE-76: distribuição da carteira', () => {
  it('RN-CORE-76: cliente sem coordenada fica fora, no alerta, e não entra em nenhum dia', () => {
    const r = criarRotasPorProximidade(entrada({ clientes: [cli(1, -3.1, -60.01), cli(2, null, null), cli(3, -3.1, null)] }));
    expect(r.fora_sem_coordenada).toEqual(['c002', 'c003']);
    expect(r.dias.flatMap((d) => d.cliente_ids)).toEqual(['c001']);
  });

  it('RN-CORE-76: cliente sem frequência entra como semanal (uma visita por semana do período)', () => {
    const r = criarRotasPorProximidade(entrada({ de: '2026-11-02', ate: '2026-11-13', clientes: [cli(1, -3.1, -60.01)] }));
    expect(r.dias).toHaveLength(2);
    expect(r.dias.every((d) => d.cliente_ids.length === 1)).toBe(true);
  });

  it('RN-CORE-76: frequência 2 e 4 visitam a cada 2 e 4 semanas, na cadência do início da vigência', () => {
    const base = { de: '2026-11-02', ate: '2026-11-27', hoje: '2026-11-01' };
    const quinzenal = criarRotasPorProximidade(entrada({ ...base, clientes: [cli(1, -3.1, -60.01, { frequencia_semanas: 2, dia_semana: 3, inicio: '2026-11-02' })] }));
    expect(quinzenal.dias.map((d) => d.data)).toEqual(['2026-11-04', '2026-11-18']);
    const mensal = criarRotasPorProximidade(entrada({ ...base, clientes: [cli(1, -3.1, -60.01, { frequencia_semanas: 4, dia_semana: 3, inicio: '2026-11-02' })] }));
    expect(mensal.dias.map((d) => d.data)).toEqual(['2026-11-04']);
  });

  it('RN-CORE-76: o cliente com dia_semana fica nesse dia, mesmo longe dos demais', () => {
    const r = criarRotasPorProximidade(entrada({ clientes: [cli(1, -3.1, -60.01, { dia_semana: 5 }), cli(2, -3.1, -60.02), cli(3, -3.1, -60.03)] }));
    expect(r.dias.find((d) => d.cliente_ids.includes('c001'))!.data).toBe('2026-11-06');
  });

  it('RN-CORE-76: dia fixo que caiu em feriado vai para o dia que a proximidade escolher', () => {
    const r = criarRotasPorProximidade(entrada({ clientes: [cli(1, -3.1, -60.01, { dia_semana: 1 })] })); // 02/11 é Finados
    expect(r.dias).toHaveLength(1);
    expect(r.dias[0]!.data).not.toBe('2026-11-02');
  });

  it('RN-CORE-76: a proximidade agrupa: dois pontos distantes não dividem o mesmo dia quando há dias de sobra', () => {
    const norte = [cli(1, -2.9, -60.0), cli(2, -2.91, -60.0), cli(3, -2.92, -60.0)];
    const sul = [cli(4, -3.5, -60.0), cli(5, -3.51, -60.0), cli(6, -3.52, -60.0)];
    const r = criarRotasPorProximidade(entrada({ clientes: [...norte, ...sul], dias_uteis_semana: [2, 3], de: '2026-11-03', ate: '2026-11-04' }));
    const dia = (id: string) => r.dias.find((d) => d.cliente_ids.includes(id))!.data;
    expect(new Set(['c001', 'c002', 'c003'].map(dia)).size).toBe(1);
    expect(new Set(['c004', 'c005', 'c006'].map(dia)).size).toBe(1);
    expect(dia('c001')).not.toBe(dia('c004'));
  });

  it('RN-CORE-76: o limite visitas_dia corta o dia e o excedente vai para fora_limite', () => {
    const clientes = Array.from({ length: 8 }, (_, i) => cli(i + 1, -3.1 - i * 0.001, -60.0));
    const r = criarRotasPorProximidade(entrada({ clientes, limite: 2, de: '2026-11-03', ate: '2026-11-04' }));
    expect(r.dias.every((d) => d.cliente_ids.length <= 2)).toBe(true);
    expect(r.dias.flatMap((d) => d.cliente_ids)).toHaveLength(4);
    expect(r.fora_limite).toHaveLength(4);
    expect(new Set([...r.fora_limite, ...r.dias.flatMap((d) => d.cliente_ids)]).size).toBe(8);
  });

  it('RN-CORE-76: o excedente do dia fixo (mais clientes que o limite) também vai para fora_limite', () => {
    const clientes = [cli(1, -3.1, -60.01, { dia_semana: 3 }), cli(2, -3.1, -60.02, { dia_semana: 3 }), cli(3, -3.1, -60.03, { dia_semana: 3 })];
    const r = criarRotasPorProximidade(entrada({ clientes, limite: 2 }));
    expect(r.dias.find((d) => d.data === '2026-11-04')!.cliente_ids).toEqual(['c001', 'c002']);
    expect(r.fora_limite).toEqual(['c003']);
  });

  it('RN-CORE-76: cada dia sai ordenado a partir da base e o km conta da base', () => {
    const clientes = [cli(1, -3.1, -60.3), cli(2, -3.1, -60.1), cli(3, -3.1, -60.2)];
    const r = criarRotasPorProximidade(entrada({ clientes, dias_uteis_semana: [3], de: '2026-11-04', ate: '2026-11-04' }));
    expect(r.dias[0]!.cliente_ids).toEqual(['c002', 'c003', 'c001']);
    expect(r.dias[0]!.km).toBeGreaterThan(30);
    expect(r.dias[0]!.km).toBeLessThan(45);
  });

  it('RN-CORE-76: sem base o km conta do 1º cliente (não do ponto fixo de Manaus)', () => {
    const clientes = [cli(1, -3.1, -60.1), cli(2, -3.1, -60.1)];
    const r = criarRotasPorProximidade(entrada({ clientes, base: null, dias_uteis_semana: [3], de: '2026-11-04', ate: '2026-11-04' }));
    expect(r.dias[0]!.km).toBe(0);
  });

  it('RN-CORE-76: carteira distribuída é determinística e cada cliente semanal aparece uma vez por semana', () => {
    const clientes = Array.from({ length: 30 }, (_, i) => cli(i + 1, -3.0 - (i % 6) * 0.05, -60.0 - Math.floor(i / 6) * 0.05));
    const a = criarRotasPorProximidade(entrada({ clientes, de: '2026-11-02', ate: '2026-11-13', limite: 11 }));
    const b = criarRotasPorProximidade(entrada({ clientes: [...clientes].reverse(), de: '2026-11-02', ate: '2026-11-13', limite: 11 }));
    expect(a).toEqual(b);
    expect(a.dias.flatMap((d) => d.cliente_ids)).toHaveLength(60);
    expect(a.fora_limite).toEqual([]);
    expect(a.dias.every((d) => d.cliente_ids.length <= 11)).toBe(true);
    expect(totaisDaPrevia(a.dias.map((d) => ({ visitas: d.cliente_ids.length, km: d.km }))).km).toBeGreaterThan(0);
  });

  it('RN-CORE-76: o vínculo fora da vigência não gera visita', () => {
    const r = criarRotasPorProximidade(entrada({ clientes: [cli(1, -3.1, -60.01, { inicio: '2026-10-01', fim: '2026-11-03', dia_semana: 4 })] }));
    expect(r.dias).toEqual([]);
  });

  it('RN-CORE-76: os dias mantidos e os feriados voltam na saída para a lista de dias da prévia', () => {
    const r = criarRotasPorProximidade(entrada({ clientes: [cli(1, -3.1, -60.01)], existentes: [{ data: '2026-11-03', visitas: 9, protegida: false }] }));
    expect(r.mantidas).toEqual([{ data: '2026-11-03', visitas: 9, protegida: false }]);
    expect(r.feriados).toEqual(['2026-11-02']);
    expect(r.dias[0]!.data).not.toBe('2026-11-03');
  });
});

describe('RN-CORE-76: totais da prévia e predicado do dia de rota', () => {
  it('RN-CORE-76: o km total soma o km inteiro de cada dia com visita (cabeçalho = soma das linhas)', () => {
    expect(totaisDaPrevia([{ visitas: 2, km: 12.34 }, { visitas: 0, km: 5 }, { visitas: 1, km: 7.4 }])).toEqual({ rotas: 2, visitas: 3, km: 19 });
    expect(totaisDaPrevia([{ visitas: 1, km: 1.4 }, { visitas: 1, km: 1.4 }, { visitas: 1, km: 1.4 }]).km).toBe(3);
  });

  it('RN-CORE-76: dia de rota é dia da semana útil do tenant e nunca domingo', () => {
    expect(diaDeSemanaUtil('2026-11-21', [1, 2, 3, 4, 5, 6])).toBe(true);
    expect(diaDeSemanaUtil('2026-11-21', [1, 2, 3, 4, 5])).toBe(false);
    expect(diaDeSemanaUtil('2026-11-22', [0, 1, 2, 3, 4, 5, 6])).toBe(false);
  });

  it('o centro é a média dos pontos com coordenada, ou nulo sem nenhum', () => {
    expect(centroDosPontos([{ lat: -3, lng: -60 }, { lat: -4, lng: -62 }, { lat: null, lng: null }])).toEqual({ lat: -3.5, lng: -61 });
    expect(centroDosPontos([])).toBeNull();
  });
});
