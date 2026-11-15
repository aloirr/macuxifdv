import { describe, expect, it } from 'vitest';

import { atingeContraste, contraste, MINIMO_CONTRASTE } from '../comum/contraste';
import { MEDIDAS_FRASE_CARGA, paresDaEntrada, TEMAS_ENTRADA, temaDaEntrada } from './entrada';

describe('tela de entrada (T-0172, docs/design/entrada-sync.md §4)', () => {
  it('Campo na faixa Azul noite com as cores da proposta entrada-sync §2', () => {
    expect(TEMAS_ENTRADA.faixa).toEqual({
      fundo: '#1E3350',
      logo: 'negativo',
      barraDeStatus: 'light',
      texto: '#FFFFFF',
      textoClaro: '#C9CED5',
      trilho: '#3A4D68',
      preenchimento: '#F59A52',
      feita: '#7FD1A8',
      erro: '#F7A59C',
      botaoFundo: '#FFFFFF',
      botaoTexto: '#1E3350',
      contorno: '#C9CED5',
      contornoTexto: '#FFFFFF',
    });
    expect(temaDaEntrada('campo')).toBe(TEMAS_ENTRADA.faixa);
  });

  it('Gestão no Pérola da splash dele, só com cores da paleta (laranja só na barra)', () => {
    const t = temaDaEntrada('gestao');
    expect(t).toBe(TEMAS_ENTRADA.perola);
    expect([t.fundo, t.logo, t.barraDeStatus, t.texto, t.textoClaro, t.trilho, t.preenchimento]).toEqual([
      '#F8F6F1',
      'positivo',
      'dark',
      '#1E3350',
      '#4A5562',
      '#DFE2E6',
      '#C2540A',
    ]);
    expect([t.feita, t.erro, t.botaoFundo, t.botaoTexto]).toEqual(['#1D6B4F', '#A8261B', '#1E3350', '#FFFFFF']);
  });

  it('todo par dos dois temas atinge o mínimo do seu tipo', () => {
    for (const [nome, tema] of Object.entries(TEMAS_ENTRADA)) {
      for (const par of paresDaEntrada(tema)) {
        expect(contraste(par.fg, par.bg), `${nome}: ${par.uso}`).toBeGreaterThanOrEqual(MINIMO_CONTRASTE[par.tipo]);
        expect(atingeContraste(par), `${nome}: ${par.uso}`).toBe(true);
      }
    }
  });

  it('título "Você sabia?", frase e aviso da carga: medidas da spec carga-aviso-frases §1 e §1.1 (T-0181, R-20261115-080500)', () => {
    expect(MEDIDAS_FRASE_CARGA).toEqual({
      titulo: { abaixoDoOla: 20, lampada: 16, lampadaAoTexto: 6, fonte: 'semibold', tamanho: 13, linha: 18, ateFrase: 6 },
      frase: { larguraMax: 280, linhasMax: 2, livreAteAviso: 24, fonte: 'body', tamanho: 14, linha: 20 },
      aviso: { fonte: 'body', tamanho: 13, linha: 18, acimaDaBarra: 10, linhas: 1 },
    });
  });

  it('o bloco "Você sabia?" ocupa 84 dp com a frase em 2 linhas e 64 dp com 1 linha (spec §1.1)', () => {
    const { titulo, frase } = MEDIDAS_FRASE_CARGA;
    const bloco = (linhas: number) => titulo.abaixoDoOla + titulo.linha + titulo.ateFrase + linhas * frase.linha;
    expect(bloco(2)).toBe(84);
    expect(bloco(1)).toBe(64);
  });

  it('o aviso tem 1 linha na escala 1,0 e nenhum limite de corte (com fonte grande quebra no shell)', () => {
    expect(MEDIDAS_FRASE_CARGA.aviso.linhas).toBe(1);
    expect(MEDIDAS_FRASE_CARGA.aviso).not.toHaveProperty('linhasMax');
  });

  it('o aviso não tem destaque: sem tokens de caixa, borda ou fundo (MC-0078 caiu)', () => {
    for (const tema of Object.values(TEMAS_ENTRADA)) {
      expect(Object.keys(tema).some((k) => /^aviso/.test(k))).toBe(false);
    }
    expect(Object.keys(MEDIDAS_FRASE_CARGA.aviso).sort()).toEqual(['acimaDaBarra', 'fonte', 'linha', 'linhas', 'tamanho']);
  });

  it('título em texto, frase e aviso em textoClaro, lâmpada em preenchimento, com contraste nos dois temas (spec §1)', () => {
    for (const tema of Object.values(TEMAS_ENTRADA)) {
      const pares = paresDaEntrada(tema);
      const achar = (uso: string) => pares.find((p) => p.uso === uso);
      expect(achar('Você sabia?')).toMatchObject({ fg: tema.texto, bg: tema.fundo, tipo: 'texto' });
      expect(achar('frase da carga')).toMatchObject({ fg: tema.textoClaro, bg: tema.fundo, tipo: 'texto' });
      expect(achar('aviso da carga')).toMatchObject({ fg: tema.textoClaro, bg: tema.fundo, tipo: 'texto' });
      expect(achar('lâmpada do Você sabia?')).toMatchObject({ fg: tema.preenchimento, bg: tema.fundo, tipo: 'grafico' });
    }
  });
});
