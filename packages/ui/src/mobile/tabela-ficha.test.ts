import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  alinhamentoDaColuna,
  alinharDaColuna,
  estiloDaColuna,
  folgaDoBotaoCelula,
  fonteNumerica,
  larguraDoRotulo,
  leituraDoRotuloValor,
  TABELA_FICHA,
} from './tabela-ficha';
import * as puro from './puro';

const ler = (arq: string) => readFileSync(new URL(arq, import.meta.url), 'utf8');

describe('Tabelas da ficha (RD-2355, T-0186): parte pura', () => {
  it('medidas: raio 12, linha de 48 dp, cabeçalho 12, rótulo 14, valor 16, botão de 48', () => {
    expect(TABELA_FICHA.raio).toBe(12);
    expect(TABELA_FICHA.alturaLinha).toBe(48);
    expect(TABELA_FICHA.fonte).toMatchObject({ cabecalho: 12, rotulo: 14, valor: 16 });
    expect(TABELA_FICHA.botao.lado).toBeGreaterThanOrEqual(44);
    expect(folgaDoBotaoCelula()).toBe(0);
  });

  it('largura da coluna: fixa quando há largura; senão divide o resto por peso (padrão 1)', () => {
    expect(estiloDaColuna({ largura: 92 })).toEqual({ width: 92 });
    expect(estiloDaColuna({ peso: 54 })).toEqual({ flexGrow: 54, flexShrink: 1, flexBasis: 0, minWidth: 0 });
    expect(estiloDaColuna({})).toEqual({ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 });
    expect(estiloDaColuna({ largura: 0, peso: -3 })).toEqual({ flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 });
    expect(estiloDaColuna({ largura: 40, peso: 10 })).toEqual({ width: 40 });
  });

  it('alinhamento: numérica vai à direita por padrão; o explícito vence', () => {
    expect(alinharDaColuna({ numerica: true })).toBe('dir');
    expect(alinharDaColuna({})).toBe('esq');
    expect(alinharDaColuna({ numerica: true, alinhar: 'centro' })).toBe('centro');
    expect(alinhamentoDaColuna('dir')).toEqual({ alignItems: 'flex-end', textAlign: 'right' });
    expect(alinhamentoDaColuna('centro')).toEqual({ alignItems: 'center', textAlign: 'center' });
    expect(alinhamentoDaColuna('esq')).toEqual({ alignItems: 'flex-start', textAlign: 'left' });
  });

  it('algarismos tabulares só no número', () => {
    expect(fonteNumerica(true)).toEqual({ fontVariant: ['tabular-nums'] });
    expect(fonteNumerica(false)).toBeNull();
    expect(fonteNumerica(undefined)).toBeNull();
  });

  it('largura do rótulo: 136 por padrão (ficha), a pedida quando válida (pedido: 92)', () => {
    expect(larguraDoRotulo()).toBe(136);
    expect(larguraDoRotulo(92)).toBe(92);
    expect(larguraDoRotulo(0)).toBe(136);
    expect(larguraDoRotulo(Number.NaN)).toBe(136);
  });

  it('TalkBack do par: "rótulo: valor", "sem dado" no vazio e o complemento em texto depois', () => {
    expect(leituraDoRotuloValor('Prazo', '30 dias')).toBe('Prazo: 30 dias');
    expect(leituraDoRotuloValor('Entrega', '')).toBe('Entrega: sem dado');
    expect(leituraDoRotuloValor('Cliente', 'Mercado Sol', 'CNPJ 12.345.678/0001-90')).toBe('Cliente: Mercado Sol. CNPJ 12.345.678/0001-90');
    expect(leituraDoRotuloValor('Cliente', 'Mercado Sol', '  ')).toBe('Cliente: Mercado Sol');
  });

  it('a parte pura sai pelo `@macuxi/ui/mobile/puro`', () => {
    expect(puro.estiloDaColuna).toBe(estiloDaColuna);
    expect(puro.TABELA_FICHA).toBe(TABELA_FICHA);
  });
});

describe('Tabelas da ficha: desenho (tabela-ficha-rn.tsx)', () => {
  const src = ler('./tabela-ficha-rn.tsx');

  it('cartão surface, borda line, raio do kit; fio lineSoft entre linhas', () => {
    expect(src).toMatch(/cartao: \{ backgroundColor: colors\.surface, borderColor: colors\.line, borderWidth: 1, borderRadius: T\.raio/);
    expect(src).toMatch(/traco: \{ borderTopWidth: 1, borderTopColor: colors\.lineSoft \}/);
  });

  it('cabeçalho 12/600 ink2; rótulo 14 ink2; valor 16 tabular; complemento 12 ink2', () => {
    expect(src).toMatch(/cab: \{ \.\.\.fonte\.semibold, fontSize: T\.fonte\.cabecalho, [^}]*color: colors\.ink2 \}/);
    expect(src).toMatch(/rotulo: \{ \.\.\.fonte\.body, fontSize: T\.fonte\.rotulo, [^}]*color: colors\.ink2 \}/);
    expect(src).toMatch(/valor: \{ \.\.\.fonte\.body, fontSize: T\.fonte\.valor, [^}]*fontVariant: \['tabular-nums'\] \}/);
    expect(src).toMatch(/complemento: \{ \.\.\.fonte\.body, fontSize: T\.fonte\.segunda, [^}]*color: colors\.ink2 \}/);
  });

  it('linhas com no mínimo 48 dp; botão da célula com 48 x 48', () => {
    expect(src).toMatch(/linhaRV: \{[^}]*minHeight: T\.alturaLinha/);
    expect(src).toMatch(/linha: \{[^}]*minHeight: T\.alturaLinha/);
    expect(src).toMatch(/botao: \{ width: T\.botao\.lado, height: T\.botao\.lado/);
  });

  it('só tokens do kit: nenhuma cor escrita à mão', () => {
    expect(src).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
    expect(src).not.toMatch(/fontFamily/);
  });

  it('exporta os quatro pelo índice do mobile', () => {
    for (const nome of ['TabelaRotuloValor', 'TabelaDados', 'CelulaTexto', 'BotaoCelula']) expect(src).toMatch(new RegExp(`export function ${nome}\\(`));
    expect(ler('./index.ts')).toMatch(/export \* from '\.\/tabela-ficha-rn';/);
  });
});
