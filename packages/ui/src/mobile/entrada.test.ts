import { describe, expect, it } from 'vitest';

import { atingeContraste, contraste, MINIMO_CONTRASTE } from '../comum/contraste';
import { CORES_BARRA_DIALOGO, paresDaEntrada, TEMAS_ENTRADA, temaDaEntrada } from './entrada';

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

  it('barra do diálogo da sincronização completa: sempre o Pérola (MC-0320)', () => {
    const { texto, trilho, preenchimento } = TEMAS_ENTRADA.perola;
    expect(CORES_BARRA_DIALOGO).toEqual({ texto, trilho, preenchimento });
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
});
