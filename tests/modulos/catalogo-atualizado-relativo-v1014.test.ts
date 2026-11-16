/**
 * Catálogo v2, v1.0.14 (#453, RD-1800) — valor × regra da data relativa do estoque ("Atualizado às …").
 * Regra: RN-CAT-07 ("atualizado às hh:mm", fuso do tenant) e a decisão 5 do R-20261115-100000, no desenho
 * docs/desenho/T-estoque-diario.md §3: hoje "Atualizado às 06:12"; ontem "Atualizado ontem às 06:12"; antes "Atualizado em 13/11
 * às 06:12"; sem carimbo "Sem hora de atualização". O carimbo e o "agora" chegam em UTC; o DIA e a HORA são os do fuso do tenant.
 * Montador único: `rotuloCargaEstoque` (modules/catalogo/domain/estoque-campo.ts), usado pela ficha (`rotuloEstoque`) e pela
 * folha "Estoque por filial" (`dadosDaFolha`).
 *  AR-1 hoje, ontem, mais antigo e sem carimbo (Manaus).
 *  AR-2 virada de dia: UTC já virou e Manaus não (continua "hoje"); Manaus virou à meia-noite local no mesmo dia UTC ("ontem").
 *  AR-3 virada de mês e de ano: "ontem" atravessa 30/11 → 01/12 e 31/12 → 01/01; o mais antigo leva o dd/mm do tenant.
 *  AR-4 oráculo: grade de carimbos × agoras em 4 fusos sem horário de verão; o esperado é calculado pela regra com o
 *       deslocamento fixo do fuso (sem Intl) e comparado com o texto.
 *  AR-5 rótulo × valor: a hora do texto é a do CARIMBO no fuso do tenant (não a de agora, nem a UTC); "ontem" só com um dia de
 *       diferença; a ficha e a folha mostram o mesmo texto; desatualizado = aviso + a mesma hora.
 */
import { describe, expect, it } from 'vitest';
import type { ItemVitrine } from '../../modules/catalogo/contracts';
import { rotuloEstoque } from '../../modules/catalogo/app/lib/apresentacao';
import { dadosDaFolha } from '../../modules/catalogo/app/lib/estoque-folha';
import { AVISO_ESTOQUE_DESATUALIZADO } from '../../modules/catalogo/domain/estoque';
import { rotuloCargaEstoque } from '../../modules/catalogo/domain/estoque-campo';

const MANAUS = 'America/Manaus';

/** Deslocamento fixo (h) dos fusos do teste; nenhum tem horário de verão desde 2019. */
const DESLOCAMENTO: Record<string, number> = { 'America/Manaus': -4, 'America/Sao_Paulo': -3, 'America/Rio_Branco': -5, 'America/Noronha': -2 };

/** Oráculo da regra, sem Intl: dia e hora locais pelo deslocamento fixo do fuso. */
function esperado(cargaEm: string, agora: string, fuso: string): string {
  const h = DESLOCAMENTO[fuso]!;
  const local = (iso: string) => new Date(Date.parse(iso) + h * 3_600_000);
  const t = local(cargaEm);
  const a = local(agora);
  const dia = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86_400_000;
  const dd = (n: number) => String(n).padStart(2, '0');
  const hora = `${dd(t.getUTCHours())}:${dd(t.getUTCMinutes())}`;
  const diff = dia(a) - dia(t);
  if (diff === 0) return `Atualizado às ${hora}`;
  if (diff === 1) return `Atualizado ontem às ${hora}`;
  return `Atualizado em ${dd(t.getUTCDate())}/${dd(t.getUTCMonth() + 1)} às ${hora}`;
}

describe('Catálogo v2 — "Atualizado às …" do estoque no fuso do tenant (RN-CAT-07, decisão 5 do R-20261115-100000)', () => {
  it('AR-1 hoje, ontem, mais antigo e sem carimbo (Manaus, agora 16/11 11:00)', () => {
    const agora = '2026-11-16T15:00:00Z';
    expect(rotuloCargaEstoque('2026-11-16T10:12:00Z', agora, MANAUS)).toBe('Atualizado às 06:12');
    expect(rotuloCargaEstoque('2026-11-15T10:12:00Z', agora, MANAUS)).toBe('Atualizado ontem às 06:12');
    expect(rotuloCargaEstoque('2026-11-14T10:12:00Z', agora, MANAUS)).toBe('Atualizado em 14/11 às 06:12');
    expect(rotuloCargaEstoque('2026-11-02T10:12:00Z', agora, MANAUS)).toBe('Atualizado em 02/11 às 06:12');
    expect(rotuloCargaEstoque(null, agora, MANAUS)).toBe('Sem hora de atualização');
    expect(rotuloCargaEstoque('não é data', agora, MANAUS)).toBe('Sem hora de atualização');
  });

  it('AR-2 virada de dia: UTC já virou e Manaus não ("hoje"); Manaus virou à meia-noite local no mesmo dia UTC ("ontem")', () => {
    // agora 17/11 02:30 UTC = 16/11 22:30 em Manaus; carga 16/11 08:00 local: dia UTC diferente, mesmo dia do tenant
    expect(rotuloCargaEstoque('2026-11-16T12:00:00Z', '2026-11-17T02:30:00Z', MANAUS)).toBe('Atualizado às 08:00');
    // carga 17/11 00:10 UTC = 16/11 20:10 em Manaus: o dia UTC é o de agora, mas no tenant também é hoje (às 20:10, não 00:10)
    expect(rotuloCargaEstoque('2026-11-17T00:10:00Z', '2026-11-17T02:30:00Z', MANAUS)).toBe('Atualizado às 20:10');
    // agora 16/11 04:30 UTC = 16/11 00:30 em Manaus; carga 16/11 03:50 UTC = 15/11 23:50: mesmo dia UTC, "ontem" no tenant
    expect(rotuloCargaEstoque('2026-11-16T03:50:00Z', '2026-11-16T04:30:00Z', MANAUS)).toBe('Atualizado ontem às 23:50');
    // limite exato da meia-noite de Manaus (04:00 UTC): 03:59 é ontem, 04:00 é hoje
    expect(rotuloCargaEstoque('2026-11-16T03:59:00Z', '2026-11-16T04:00:00Z', MANAUS)).toBe('Atualizado ontem às 23:59');
    expect(rotuloCargaEstoque('2026-11-16T04:00:00Z', '2026-11-16T04:00:00Z', MANAUS)).toBe('Atualizado às 00:00');
  });

  it('AR-3 virada de mês e de ano', () => {
    // agora 01/12 09:00 em Manaus
    const agora = '2026-12-01T13:00:00Z';
    expect(rotuloCargaEstoque('2026-11-30T10:12:00Z', agora, MANAUS)).toBe('Atualizado ontem às 06:12');
    expect(rotuloCargaEstoque('2026-11-29T10:12:00Z', agora, MANAUS)).toBe('Atualizado em 29/11 às 06:12');
    // UTC já em dezembro, Manaus ainda em 30/11: carga do mesmo dia local é "hoje"
    expect(rotuloCargaEstoque('2026-11-30T10:00:00Z', '2026-12-01T02:00:00Z', MANAUS)).toBe('Atualizado às 06:00');
    // carga 01/12 01:00 UTC = 30/11 21:00 em Manaus: com agora 01/12 09:00 local é "ontem", não "hoje" (dia UTC igual)
    expect(rotuloCargaEstoque('2026-12-01T01:00:00Z', agora, MANAUS)).toBe('Atualizado ontem às 21:00');
    // ano: 31/12 19:00 em Manaus visto em 01/01 08:00
    expect(rotuloCargaEstoque('2026-12-31T23:00:00Z', '2027-01-01T12:00:00Z', MANAUS)).toBe('Atualizado ontem às 19:00');
    expect(rotuloCargaEstoque('2026-12-30T23:00:00Z', '2027-01-01T12:00:00Z', MANAUS)).toBe('Atualizado em 30/12 às 19:00');
  });

  it('AR-4 oráculo pela regra: 4 fusos × carimbos a cada 37 min por 3 dias × 6 agoras ao redor da meia-noite local', () => {
    let casos = 0;
    for (const fuso of Object.keys(DESLOCAMENTO)) {
      const meiaNoite = Date.parse('2026-12-01T00:00:00Z') - DESLOCAMENTO[fuso]! * 3_600_000; // 01/12 00:00 no fuso
      for (const deltaAgora of [-61, -1, 0, 1, 61, 12 * 60]) {
        const agora = new Date(meiaNoite + deltaAgora * 60_000).toISOString();
        for (let m = 0; m <= 3 * 24 * 60; m += 37) {
          const carga = new Date(Date.parse(agora) - m * 60_000).toISOString();
          expect(rotuloCargaEstoque(carga, agora, fuso), `${fuso} carga ${carga} agora ${agora}`).toBe(esperado(carga, agora, fuso));
          casos++;
        }
      }
    }
    expect(casos).toBeGreaterThan(2_800);
  });

  it('AR-5 rótulo × valor: hora do carimbo no fuso do tenant; ficha e folha com o mesmo texto; desatualizado = aviso + a mesma hora', () => {
    const agora = '2026-11-16T15:00:00Z'; // 11:00 em Manaus
    const carga = '2026-11-16T10:12:00Z'; // 06:12 em Manaus
    const texto = rotuloCargaEstoque(carga, agora, MANAUS);
    expect(texto, 'não é a hora de agora').not.toContain('11:00');
    expect(texto, 'não é a hora UTC').not.toContain('10:12');
    expect(texto, 'hoje não leva "hoje" nem a data').toBe('Atualizado às 06:12');
    // o mesmo carimbo em outro fuso muda a hora, não o rótulo
    expect(rotuloCargaEstoque(carga, agora, 'America/Sao_Paulo')).toBe('Atualizado às 07:12');

    const item = (updated_at: string, stale: boolean): ItemVitrine =>
      ({
        id: '00000000-0000-4000-8000-000000000001',
        price_stock_visible: true,
        unit: 'UN',
        availability: { band: 'disponivel', quantity: 80, stale, updated_at, by_branch: [{ branch_id: 'f1', branch_name: 'CD Manaus', quantity: 80, band: 'disponivel', updated_at }] },
      }) as unknown as ItemVitrine;
    const ficha = rotuloEstoque(item(carga, false), agora, MANAUS)!;
    expect(ficha.detalhe, 'ficha').toBe('Atualizado às 06:12');
    expect(ficha.texto, 'o número do texto é o da availability').toContain('80');
    const folha = dadosDaFolha({ availability: item(carga, false).availability!, cargaEm: carga, filialCadastro: 'f1', agora, fuso: MANAUS });
    expect(folha.apoio, 'folha = ficha').toBe(ficha.detalhe);
    const velho = '2026-11-14T10:12:00Z';
    const desatualizado = rotuloEstoque(item(velho, true), agora, MANAUS)!;
    expect(desatualizado.desatualizado).toBe(true);
    expect(desatualizado.detalhe).toBe(`${AVISO_ESTOQUE_DESATUALIZADO} · Atualizado em 14/11 às 06:12`);
  });
});
