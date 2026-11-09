/**
 * RN-GES-03 × calendário único (achado 2 do corretor-redundancias, R-20261109-023754; relatório docs/qualidade/redundancias/
 * 2026-11-09-madrugada.md §8). A RN-GES-03 diz: prazo da aprovação em dias úteis "pelo calendário de `packages/comum`, com feriados
 * nacionais e os feriados cadastrados pelo tenant, no fuso do tenant". O Gestor ainda usa a lista PROVISÓRIA própria
 * (`modules/gestor/domain/feriados.ts`, escrita quando o `@macuxi/comum` não trazia os nacionais): sem Carnaval nem Corpus Christi
 * e com o 20/11 em todo ano (Lei 14.759/2023: nacional só desde 2024). O `@macuxi/comum` já traz os nacionais (`ehFeriadoNacional`).
 *
 * Confirmado no main (25 dias de semana divergentes de 2023 a 2030: Carnaval, Corpus Christi e 20/11/2023; sexta antes do
 * Carnaval de 2027 + 1 dia útil vencia na segunda de Carnaval). Corrigido pelo modulo-gestor na mesma rodada (RD-0034: o
 * Gestor passa a usar `feriadosNacionais` do `@macuxi/comum` e a lista própria sai). G1 e G2 travam a correção.
 *
 * Fora daqui: os dias úteis da meta do Core (RN-CORE-26) estão conformes. A regra é "sem feriados até existir o cadastro", e o
 * Core passa a lista do tenant (ainda vazia) ao `@macuxi/comum`: só a semana conta (tests/modulos/dias-uteis-entre-telas-t0124.test.ts).
 */
import { ehFeriadoNacional, feriadosNacionais } from '@macuxi/comum';
import { describe, expect, it } from 'vitest';
import { ehDiaUtil, somarDiasUteis, type CalendarioComercial } from '../../modules/gestor/domain/horario-comercial';

const CAL: CalendarioComercial = { fuso: 'America/Manaus', feriados: [], horario_comercial: { dias_semana: [1, 2, 3, 4, 5], inicio: '08:00', fim: '18:00' } };
/** Dia civil seguinte (AAAA-MM-DD), sem fuso: a conta é em UTC ao meio-dia. */
const diaSeguinte = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const ehDiaDeSemana = (d: string) => {
  const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
  return dow >= 1 && dow <= 5;
};

/** Dias de segunda a sexta em que o Gestor e o `@macuxi/comum` discordam (dia útil × feriado nacional), de 2023 a 2030. */
function divergencias(): string[] {
  const saida: string[] = [];
  for (let d = '2023-01-01'; d <= '2030-12-31'; d = diaSeguinte(d)) {
    if (!ehDiaDeSemana(d)) continue;
    if (ehDiaUtil(d, CAL) !== ehFeriadoNacional(d)) continue; // concordam: útil e não feriado, ou não útil e feriado
    saida.push(d);
  }
  return saida;
}

describe('RN-GES-03 — o prazo da aprovação usa os feriados nacionais do @macuxi/comum', () => {
  it('G1. de 2023 a 2030, nenhum dia de semana é útil num calendário e feriado no outro (Carnaval, Corpus Christi, 20/11 só desde 2024)', () => {
    const div = divergencias();
    expect(div).toEqual([]);
  });

  it('G2. pedido na sexta antes do Carnaval de 2027 (05/02 17:00): +1 dia útil vence na quarta de Cinzas (10/02), não na segunda de Carnaval', () => {
    // Páscoa 2027 = 28/03; Carnaval = segunda 08/02 e terça 09/02 (no @macuxi/comum)
    expect(feriadosNacionais(2027)).toEqual(expect.arrayContaining(['2027-02-08', '2027-02-09']));
    const vence = somarDiasUteis('2027-02-05T21:00:00.000Z', 1, CAL); // 17:00 em Manaus
    expect(vence.slice(0, 10)).toBe('2027-02-10');
  });

  it('G0. o laço de 2023 a 2030 percorre os dias de semana e acha os feriados nacionais (a conta do G1 não é vazia por engano)', () => {
    let feriadosEmDiaDeSemana = 0;
    for (let d = '2023-01-01'; d <= '2030-12-31'; d = diaSeguinte(d)) if (ehDiaDeSemana(d) && ehFeriadoNacional(d)) feriadosEmDiaDeSemana += 1;
    expect(feriadosEmDiaDeSemana).toBeGreaterThan(80);
  });

  it('G3. o que já é igual nos dois: Confraternização, Tiradentes, Sexta-feira Santa, Natal e o 20/11 desde 2024 não são dias úteis no Gestor', () => {
    for (const d of ['2027-01-01', '2027-04-21', '2027-03-26', '2027-12-24', '2024-11-20', '2025-11-20']) {
      if (!ehDiaDeSemana(d)) continue;
      expect(ehFeriadoNacional(d), `${d} no @macuxi/comum`).toBe(d !== '2027-12-24');
      expect(ehDiaUtil(d, CAL), `${d} no Gestor`).toBe(d === '2027-12-24');
    }
  });
});
