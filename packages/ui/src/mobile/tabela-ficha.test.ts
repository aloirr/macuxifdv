import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { ehSemDado, leituraDaLinhaDeValor, VALOR_SEM_DADO } from './componentes';
import {
  alinhamentoDaColuna,
  aparenciaDoValor,
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

  it('RD-2370 (ex-TabelaValores, T-0141): sem dado é travessão (nunca "R$ 0,00" falso) e vazio também conta', () => {
    expect(VALOR_SEM_DADO).toBe('—');
    expect(ehSemDado('—')).toBe(true);
    expect(ehSemDado('  ')).toBe(true);
    expect(ehSemDado(null)).toBe(true);
    expect(ehSemDado('R$ 0,00')).toBe(false);
    expect(leituraDaLinhaDeValor('Limite', 'R$ 20.000,00')).toBe('Limite: R$ 20.000,00');
    expect(leituraDoRotuloValor('Disponível', '—')).toBe('Disponível: sem dado');
  });

  it('RD-2370: cor do valor pelo tom (erro, sucesso); sem tom, "—" e vazio em semDado', () => {
    expect(aparenciaDoValor('−R$ 1.200,00', 'erro')).toBe('erro');
    expect(aparenciaDoValor('−R$ 4,20', 'sucesso')).toBe('sucesso');
    expect(aparenciaDoValor('R$ 10,00', 'erro')).toBe('erro');
    expect(aparenciaDoValor('—')).toBe('semDado');
    expect(aparenciaDoValor('')).toBe('semDado');
    expect(aparenciaDoValor('R$ 10,00')).toBe('normal');
    expect(aparenciaDoValor('—', 'erro')).toBe('erro');
    expect(TABELA_FICHA.esqueleto).toEqual({ largura: 72, altura: 12 });
  });

  it('a parte pura sai pelo `@macuxi/ui/mobile/puro`', () => {
    expect(puro.aparenciaDoValor).toBe(aparenciaDoValor);
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

  it('RD-2370: tons do valor (danger, success, ink3), carregando com barra lineSoft e ocupado, rodapé 12 ink2', () => {
    expect(src).toMatch(/COR_DO_VALOR = \{ erro: colors\.danger, sucesso: colors\.success, semDado: colors\.ink3, normal: colors\.ink \}/);
    expect(src).toMatch(/aparenciaDoValor\(l\.valor, l\.tom\)/);
    expect(src).toMatch(/ehSemDado\(l\.valor\) \? VALOR_SEM_DADO : l\.valor/);
    expect(src).toMatch(/esqueleto: \{ width: T\.esqueleto\.largura, height: T\.esqueleto\.altura, [^}]*backgroundColor: colors\.lineSoft \}/);
    expect(src).toMatch(/accessibilityLabel=\{ocupado \? l\.rotulo :/);
    expect(src).toMatch(/accessibilityState=\{ocupado \? \{ busy: true \} : undefined\}/);
    expect(src).toMatch(/rodapeTexto: \{ \.\.\.fonte\.body, fontSize: T\.fonte\.segunda, color: colors\.ink2 \}/);
    expect(src).toMatch(/testID=\{testID \? `\$\{testID\}-rodape` : undefined\}/);
  });

  it('RD-2370: a TabelaValores saiu do kit', () => {
    expect(ler('./valores.tsx')).not.toMatch(/TabelaValores/);
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
