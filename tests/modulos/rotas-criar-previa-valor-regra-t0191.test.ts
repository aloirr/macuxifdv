/**
 * T-0191 — valor × regra da prévia da rota criada por proximidade (RN-CORE-76; spec docs/design/rotas-criar/spec.md §4), sem banco.
 * O quadro "Prévia" (modules/core/web/components/routes/previa-panel.tsx) mostra no cabeçalho `resumoDaPrevia(totaisDaPreviaAberta(...))`
 * ("N rotas · N visitas · N km": os totais da API, refeitos pelo `totaisDaPrevia` do domain depois do editor) e, em cada dia,
 * "N visitas · N km" (`formatKm(dia.total_km, 0)`, o km do dia que a API devolve, via `diaDaPreviaParaRouteDay`). Aqui a conta esperada
 * sai da regra, não do código da tela: rotas = dias com parada; visitas = soma das paradas; km = soma do km inteiro de cada linha, a partir
 * da base (ou do 1º cliente sem base), sem volta. Os textos dos alertas e a ordem das linhas são do `rotas-criar.test.ts` do módulo (RD-2538).
 * Matriz: docs/testes/T-0191.md.
 *
 * Convenção: `it` = vale hoje; `it.fails` = defeito aberto (fica vermelho quando corrigir e vira `it`). D2, D3 e o subtítulo do km corrigidos em 21/11/2026.
 */
import type { DiaDaPrevia, RouteDay } from '@macuxi/core/contracts';
import { describe, expect, it } from 'vitest';
import { routeDistanceKm, totaisDaPrevia } from '../../modules/core/domain';
import { diaDaPreviaParaRouteDay, SEM_BASE } from '../../modules/core/web/lib/rotas-api';
import { resumoDaPrevia, totaisDaPreviaAberta } from '../../modules/core/web/lib/rotas-criar';
import { diasDoCalendario, formatKm, periodLabel, periodRange, routeKpis, subtituloDoKm } from '../../modules/core/web/lib/routes';

const id = (n: number) => `0f191300-0000-4000-8000-${String(n).padStart(12, '0')}`;
const BASE = { lat: -3.1, lng: -60.0 };
const parada = (n: number, lat: number, lng: number): DiaDaPrevia['paradas'][number] => ({ cliente_id: id(n), nome: `Cliente ${n}`, cidade: 'Manaus', bairro: 'Centro', lat, lng });
/** Três dias da prévia como a API devolve (paradas em ordem). */
const DIAS: Array<Pick<DiaDaPrevia, 'data' | 'paradas'>> = [
  { data: '2027-12-06', paradas: [parada(1, -3.11, -60.01), parada(2, -3.12, -60.02), parada(3, -3.13, -60.0)] },
  { data: '2027-12-07', paradas: [parada(4, -3.2, -60.1), parada(5, -3.21, -60.12)] },
  { data: '2027-12-08', paradas: [parada(6, -3.05, -59.95)] },
];
const HOJE = '2027-12-01';

/** Conta da regra (RN-CORE-75/76), feita aqui: haversine × 1,3 por trecho, 1 casa, a partir da base, sem volta. */
function kmDaRegra(inicio: { lat: number; lng: number } | null, pontos: Array<{ lat: number; lng: number }>): number {
  const rad = (g: number) => (g * Math.PI) / 180;
  let total = 0;
  let ant = inicio ?? pontos[0]!;
  for (const p of pontos) {
    const dLat = rad(p.lat - ant.lat);
    const dLng = rad(p.lng - ant.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(ant.lat)) * Math.cos(rad(p.lat)) * Math.sin(dLng / 2) ** 2;
    total += Math.round(2 * 6371 * Math.asin(Math.sqrt(h)) * 1.3 * 10) / 10;
    ant = p;
  }
  return Math.round(total * 10) / 10;
}

describe('T-0191 — valor × regra da prévia ("N rotas · N visitas · N km" e as linhas dos dias)', () => {
  /** O km de cada dia como a API devolve: a conta do domain (`routeDistanceKm`, a mesma do `criarRotasPorProximidade`) a partir da base. */
  const daApi = (inicio: { lat: number; lng: number } | typeof SEM_BASE) => DIAS.map((d) => ({ ...d, km: routeDistanceKm(inicio, d.paradas) }));
  const dias: RouteDay[] = daApi(BASE).map((d) => diaDaPreviaParaRouteDay(d, id(99), HOJE));
  const totaisDaApi = (ds: ReadonlyArray<{ paradas: unknown[]; km: number }>) => totaisDaPrevia(ds.map((d) => ({ visitas: d.paradas.length, km: d.km })));

  it('RN-CORE-75: o km de cada dia da tela = a conta da regra a partir da base (e do 1º cliente quando não há base)', () => {
    for (const [i, d] of dias.entries()) expect(d.total_km, d.date).toBe(kmDaRegra(BASE, DIAS[i]!.paradas));
    const semBase = daApi(SEM_BASE).map((d) => diaDaPreviaParaRouteDay(d, id(99), HOJE));
    for (const [i, d] of semBase.entries()) expect(d.total_km, d.date).toBe(kmDaRegra(null, DIAS[i]!.paradas));
    // o dia de um cliente só, sem base, tem 0 km (nenhum ponto fixo de Manaus entra na conta)
    expect(semBase[2]!.total_km).toBe(0);
  });

  it('RN-CORE-76: o cabeçalho conta rotas = dias com parada, visitas = soma das paradas e km = soma do km inteiro das linhas', () => {
    const rotas = DIAS.length;
    const visitas = DIAS.reduce((s, d) => s + d.paradas.length, 0);
    const km = DIAS.reduce((s, d) => s + Math.round(kmDaRegra(BASE, d.paradas)), 0);
    const api = totaisDaApi(daApi(BASE));
    expect(api).toEqual({ rotas, visitas, km });
    // sem edição, a tela mostra os totais da API; depois do editor, a mesma conta refeita sobre as linhas
    expect(totaisDaPreviaAberta(api, dias, false)).toEqual({ rotas, visitas, km });
    expect(totaisDaPreviaAberta(api, dias, true)).toEqual({ rotas, visitas, km });
    expect(resumoDaPrevia(totaisDaPreviaAberta(api, dias, false))).toBe(`${rotas} rotas · ${visitas} visitas · ${km.toLocaleString('pt-BR')} km`);
  });

  // D2 (corrigido; modulo-core, `totaisDaPrevia` do domain soma o km inteiro de cada dia): com três dias de 1,4 km o cabeçalho dizia "4 km" e as
  // linhas "1 km" cada. Agora o km do cabeçalho = a soma dos km que as linhas mostram, com e sem edição.
  it('D2 — valor × regra: o km do cabeçalho = a soma dos km mostrados nas linhas dos dias', () => {
    for (const kmDia of [1.4, 2.5]) {
      const linhas: RouteDay[] = [0, 1, 2].map((i) => ({ ...dias[0]!, date: `2027-12-1${i}`, total_km: kmDia }));
      const kmLinhas = linhas.reduce((s, d) => s + Number(formatKm(d.total_km, 0).replace(/\D/g, '')), 0);
      const api = totaisDaPrevia(linhas.map((d) => ({ visitas: d.stops.length, km: d.total_km })));
      for (const editado of [false, true]) {
        const kmCabecalho = Number(/· ([\d.]+) km$/.exec(resumoDaPrevia(totaisDaPreviaAberta(api, linhas, editado)))![1]!.replace('.', ''));
        expect(kmCabecalho, `${kmDia} km/dia, editado=${editado}`).toBe(kmLinhas);
      }
    }
  });

  // Defeito a (corrigido; modulo-core, `subtituloDoKm` em modules/core/web/lib/routes.ts): o KPI "Km total" dizia "a partir da base, sem volta"
  // também quando o vendedor não tinha base e o km contava do 1º cliente. Rótulo × valor: o subtítulo diz de onde o número conta.
  it('defeito a — RN-CORE-75: o subtítulo do "Km total" diz de onde o km conta (base, 1º cliente) e some na mistura', () => {
    const semBase = daApi(SEM_BASE).map((d) => diaDaPreviaParaRouteDay(d, id(98), HOJE));
    // valor: com base o KPI soma o km da base; sem base, o do 1º cliente (a conta da regra)
    expect(routeKpis(dias).km).toBe(Math.round(DIAS.reduce((s, d) => s + kmDaRegra(BASE, d.paradas), 0)));
    expect(routeKpis(semBase).km).toBe(Math.round(DIAS.reduce((s, d) => s + kmDaRegra(null, d.paradas), 0)));
    // rótulo × valor
    expect(subtituloDoKm(dias, { [id(99)]: BASE })).toBe('a partir da base, sem volta');
    expect(subtituloDoKm(semBase, { [id(98)]: null })).toBe('a partir do 1º cliente, sem volta');
    expect(subtituloDoKm([...dias, ...semBase], { [id(99)]: BASE, [id(98)]: null })).toBeUndefined();
  });

  // D3 e defeito b (corrigidos; modulo-core, `periodRange`/`periodLabel` com o calendário do tenant em routes-page.tsx:165 e
  // criar-rota-dialog.tsx:32): a semana da tela, o rótulo e o diálogo são o mesmo intervalo — segunda até o último dia útil do tenant.
  it('D3 / defeito b — RN-CORE-76 (D3): o rótulo, a lista e o diálogo cobrem os mesmos dias (padrão seg–sáb e tenant seg–sex)', () => {
    const ancora = '2026-11-23';
    // padrão (sem calendário e com seg–sáb): até o sábado 28/11
    for (const cal of [undefined, { dias_uteis_semana: [1, 2, 3, 4, 5, 6], feriados: [] }]) {
      expect(periodRange('week', ancora, cal)).toEqual({ from: '2026-11-23', to: '2026-11-28' });
      expect(diasDoCalendario(periodRange('week', ancora, cal), cal).map((d) => d.date)).toContain('2026-11-28');
      expect(periodLabel('week', ancora, cal)).toBe('23 a 28 de nov');
    }
    // tenant com semana útil seg–sex: rótulo, lista e diálogo param na sexta, e o sábado não aparece
    const segSex = { dias_uteis_semana: [1, 2, 3, 4, 5], feriados: ['2026-11-25'] };
    expect(periodRange('week', ancora, segSex)).toEqual({ from: '2026-11-23', to: '2026-11-27' });
    expect(periodLabel('week', ancora, segSex)).toBe('23 a 27 de nov');
    const lista = diasDoCalendario(periodRange('week', ancora, segSex), segSex);
    expect(lista.map((d) => d.date)).toEqual(['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27']);
    expect(lista.find((d) => d.date === '2026-11-25')!.feriado).toBe(true);
    // domingo nunca, nem se o tenant puser 0 na semana útil; virada de mês no rótulo
    const todos = { dias_uteis_semana: [0, 1, 2, 3, 4, 5, 6], feriados: [] };
    expect(diasDoCalendario(periodRange('week', '2026-11-30', todos), todos).map((d) => d.date)).not.toContain('2026-12-06');
    expect(periodLabel('week', '2026-12-01')).toBe('30 de nov a 5 de dez');
  });
});
