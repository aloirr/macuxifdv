import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { contraste } from '../comum/contraste';
import { ALTURA_CABECALHO, alturaMinimaCabecalho, CABECALHO, estiloBarraDeStatus, layoutCabecalho, LINHAS_FRASE_INICIO, respiroTopoDoConteudo } from './cabecalho';
import { colors } from './tokens';

const ler = (arq: string) => readFileSync(new URL(arq, import.meta.url), 'utf8');

describe('cabeçalho na faixa Azul noite (T-0172, manual §4)', () => {
  it('faixa Azul noite, título branco e subtítulo #C9CED5, com contraste de texto', () => {
    expect(CABECALHO.cores).toEqual({ fundo: '#1E3350', titulo: '#FFFFFF', subtitulo: '#C9CED5', voltar: '#C9CED5' });
    expect(contraste(CABECALHO.cores.titulo, CABECALHO.cores.fundo)).toBeGreaterThanOrEqual(4.5);
    expect(contraste(CABECALHO.cores.subtitulo, CABECALHO.cores.fundo)).toBeGreaterThanOrEqual(4.5);
    expect(colors.faixa).toBe(CABECALHO.cores.fundo);
  });

  it('a faixa começa na barra de status: o respiro de cima soma a área segura', () => {
    expect(layoutCabecalho(24)).toEqual({ paddingTop: 36, paddingBottom: 16, paddingHorizontal: 20, backgroundColor: '#1E3350' });
    expect(layoutCabecalho(0).paddingTop).toBe(12);
    expect(layoutCabecalho(Number.NaN).paddingTop).toBe(12);
    expect(layoutCabecalho(-5).paddingTop).toBe(12);
  });

  it('corpo: sem faixa, o respiro de hoje; com a faixa, 16 abaixo dela', () => {
    expect(respiroTopoDoConteudo(false, 28, 24)).toBe(40);
    expect(respiroTopoDoConteudo(false, 28, 0)).toBe(28);
    expect(respiroTopoDoConteudo(true, 28, 24)).toBe(16);
  });

  it('barra de status: ícones claros na faixa, escuros no Pérola', () => {
    expect(estiloBarraDeStatus(true)).toBe('light');
    expect(estiloBarraDeStatus(false)).toBe('dark');
  });

  it('Screen monta o CabecalhoTela com a prop cabecalho; título é header para o leitor de tela', () => {
    const ui = ler('./ui.tsx');
    expect(ui).toContain('export function CabecalhoTela(');
    expect(ui).toContain('<CabecalhoTela {...cabecalho} />');
    expect(ui).toMatch(/<Text style=\{styles\.cabecalhoTitulo\} accessibilityRole="header"/);
    expect(ui).toContain('<BackLink {...voltar} sobreFaixa />');
  });
});

describe('cabeçalho com a altura do Início (v1.0.17 item 5) e sem selo de sincronização (item 6)', () => {
  it('altura única de 100 dp (12 + foto 72 + 16), somando a área segura', () => {
    expect(ALTURA_CABECALHO).toBe(100);
    expect(alturaMinimaCabecalho(24)).toBe(124);
    expect(alturaMinimaCabecalho(Number.NaN)).toBe(100);
  });

  it('o CabecalhoTela usa a altura mínima única e não monta selo de sincronização', () => {
    const ui = ler('./ui.tsx');
    const corpo = ui.slice(ui.indexOf('export function CabecalhoTela('), ui.indexOf('export function Screen('));
    expect(corpo).toContain('minHeight: alturaMinimaCabecalho(insets.top)');
    expect(corpo).not.toContain('<SeloAtualizacao');
    expect(corpo).not.toContain('<SyncStamp');
  });
});

describe('frase do Início (v1.0.17 item 1): valor de hoje até a aprovação', () => {
  it('faixaFrase segue o #C9CED5 em 400, itálico 14, até 2 linhas', () => {
    expect(colors.faixaFrase).toBe(colors.faixaSub);
    expect(ler('./theme.ts')).toContain("fraseInicio: { ...fonte.body, fontSize: 14, fontStyle: 'italic', color: colors.faixaFrase }");
    expect(contraste(colors.faixaFrase, colors.faixa)).toBeGreaterThanOrEqual(4.5);
    expect(LINHAS_FRASE_INICIO).toBe(2);
  });
});
