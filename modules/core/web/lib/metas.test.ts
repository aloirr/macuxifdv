import { describe, expect, it } from 'vitest';
import type { LinhaMetaBko } from '../../contracts';
import { avisoDaCopia, avisoDoLote, mesAnterior, celulasDaLinha, corpoDaMeta, csvDeMetas, filtrarPorIndicador, textoDeEdicao, totalEditavel } from './metas';

const ID = '0e500000-0000-4000-8000-000000000001';
const linha = (o: Partial<LinhaMetaBko>): LinhaMetaBko => ({ usuario_id: ID, usuario_nome: 'Ana "A"', equipe_id: null, indicador: 'venda_cents', tipo: 'pedido', meta: 2500000, realizado: 1000000, atingimento_pct: 4000, editavel: true, ...o });

describe('RN-CORE-20: valor digitado vira o inteiro do contrato', () => {
  it('RN-CORE-20: venda em reais vira centavos e leva o tipo (RN-CORE-21)', () => {
    expect(corpoDaMeta('venda_cents', '25.000,50', 'faturamento')).toEqual({ ok: true, corpo: { indicador: 'venda_cents', valor: 2500050, tipo: 'faturamento' } });
    expect(corpoDaMeta('venda_cents', 'abc')).toMatchObject({ ok: false });
  });
  it('RN-CORE-20: cobertura em % vira pontos-base e passa de 100 é recusada', () => {
    expect(corpoDaMeta('cobertura_pct', '85,5')).toEqual({ ok: true, corpo: { indicador: 'cobertura_pct', valor: 8550 } });
    expect(corpoDaMeta('cobertura_pct', '100')).toMatchObject({ ok: true });
    expect(corpoDaMeta('cobertura_pct', '100,01')).toMatchObject({ ok: false });
    expect(corpoDaMeta('cobertura_pct', '101')).toMatchObject({ ok: false });
  });
  it('RN-CORE-20: visitas e positivação só aceitam inteiro', () => {
    expect(corpoDaMeta('visitas', ' 40 ')).toEqual({ ok: true, corpo: { indicador: 'visitas', valor: 40 } });
    expect(corpoDaMeta('positivacao', '4,5')).toMatchObject({ ok: false });
    expect(corpoDaMeta('visitas', '-1')).toMatchObject({ ok: false });
  });
  it('RN-CORE-20: o texto de edição é o inverso do corpo', () => {
    expect(textoDeEdicao('venda_cents', 2500050)).toBe('25000,50');
    expect(textoDeEdicao('cobertura_pct', 8550)).toBe('85,5');
    expect(textoDeEdicao('visitas', 40)).toBe('40');
    expect(textoDeEdicao('visitas', 0)).toBe('');
    const v = corpoDaMeta('venda_cents', textoDeEdicao('venda_cents', 2500050));
    expect(v).toMatchObject({ ok: true, corpo: { valor: 2500050 } });
  });
});

describe('RN-CORE-21: tabela e CSV do painel de metas', () => {
  it('RN-CORE-21: linha sem meta mostra traço e linha com meta mostra o atingimento', () => {
    expect(celulasDaLinha(linha({ meta: 0, atingimento_pct: null }))[3]).toBe('—');
    const c = celulasDaLinha(linha({}));
    expect(c[2]).toBe('Pedido aprovado');
    expect(c[5]).toBe('40,00%');
  });
  it('RN-CORE-21: CSV tem BOM, cabeçalho e aspas escapadas', () => {
    const csv = csvDeMetas([linha({})]);
    expect(csv.startsWith(String.fromCharCode(0xfeff))).toBe(true);
    expect(csv).toContain('"Ana ""A"""');
    expect(csv.split('\r\n')[0]).toContain('"Indicador"');
  });
  it('filtra por indicador, conta linhas editáveis e redige o aviso do lote', () => {
    const ls = [linha({}), linha({ indicador: 'visitas', editavel: false })];
    expect(filtrarPorIndicador(ls, 'visitas')).toHaveLength(1);
    expect(filtrarPorIndicador(ls, '')).toHaveLength(2);
    expect(totalEditavel(ls)).toBe(1);
    expect(avisoDoLote(0, 3)).toContain('Nada mudou');
    expect(avisoDoLote(1, 1)).toContain('1 pessoa da equipe (1 alterada)');
  });
});

describe('RN-CORE-20: copiar do mês anterior', () => {
  it('RN-CORE-20: mês anterior vira o ano em janeiro', () => {
    expect(mesAnterior('2026-03')).toBe('2026-02');
    expect(mesAnterior('2026-01')).toBe('2025-12');
    expect(mesAnterior('2026-13')).toBe('');
  });
  it('RN-CORE-20: aviso da cópia diz o que entrou e o que foi preservado', () => {
    expect(avisoDaCopia(0, 2)).toContain('Nada a copiar');
    expect(avisoDaCopia(3, 1)).toBe('3 metas copiadas; 1 já existia e ficou como estava.');
  });
});
