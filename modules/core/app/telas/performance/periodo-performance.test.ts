import { describe, expect, it } from 'vitest';

import {
  AJUDA_FORA_DA_JANELA,
  chaveDaCopia,
  contarFiltros,
  foraDaJanela,
  inicioDaJanela,
  intervaloDaSelecao,
  mensagemDoServidor,
  rotuloDoPeriodo,
  SELECAO_PADRAO,
  type SelecaoPeriodo,
} from './periodo-performance';

const HOJE = '2026-11-13'; // sexta
const atalho = (id: Extract<SelecaoPeriodo, { tipo: 'atalho' }>['id']): SelecaoPeriodo => ({ tipo: 'atalho', id });

describe('T-0170 §1.1: o período da Performance vira [de, ate]', () => {
  it('atalhos: hoje, ontem, semana de segunda a domingo (RN-TRE-03), mês, mês passado e ano', () => {
    expect(intervaloDaSelecao(atalho('hoje'), HOJE)).toEqual({ de: HOJE, ate: HOJE });
    expect(intervaloDaSelecao(atalho('ontem'), HOJE)).toEqual({ de: '2026-11-12', ate: '2026-11-12' });
    expect(intervaloDaSelecao(atalho('esta_semana'), HOJE)).toEqual({ de: '2026-11-09', ate: '2026-11-15' });
    expect(intervaloDaSelecao(atalho('esta_semana'), '2026-11-15')).toEqual({ de: '2026-11-09', ate: '2026-11-15' }); // domingo
    expect(intervaloDaSelecao(SELECAO_PADRAO, HOJE)).toEqual({ de: '2026-11-01', ate: '2026-11-30' });
    expect(intervaloDaSelecao(atalho('mes_passado'), HOJE)).toEqual({ de: '2026-10-01', ate: '2026-10-31' });
    expect(intervaloDaSelecao(atalho('mes_passado'), '2026-01-10')).toEqual({ de: '2025-12-01', ate: '2025-12-31' });
    expect(intervaloDaSelecao(atalho('este_ano'), HOJE)).toEqual({ de: '2026-01-01', ate: '2026-12-31' });
  });

  it('dia, mês ou ano escolhido na folha', () => {
    expect(intervaloDaSelecao({ tipo: 'escolha', escolha: { tipo: 'dia', valor: '2026-11-02' } }, HOJE)).toEqual({ de: '2026-11-02', ate: '2026-11-02' });
    expect(intervaloDaSelecao({ tipo: 'escolha', escolha: { tipo: 'mes', valor: '2026-02' } }, HOJE)).toEqual({ de: '2026-02-01', ate: '2026-02-28' });
    expect(intervaloDaSelecao({ tipo: 'escolha', escolha: { tipo: 'ano', valor: '2025' } }, HOJE)).toEqual({ de: '2025-01-01', ate: '2025-12-31' });
  });

  it('o selo conta 1 fora do padrão (Este mês)', () => {
    expect(contarFiltros(SELECAO_PADRAO)).toBe(0);
    expect(contarFiltros(atalho('hoje'))).toBe(1);
    expect(contarFiltros({ tipo: 'escolha', escolha: { tipo: 'mes', valor: '2026-11' } })).toBe(1);
  });

  it('o nome do período, um lugar só: "Novembro de 2026", "Setembro de 2025", "Hoje", "2026", "Seg, 02/11/2026"', () => {
    expect(rotuloDoPeriodo(SELECAO_PADRAO, HOJE)).toBe('Novembro de 2026');
    expect(rotuloDoPeriodo(atalho('mes_passado'), HOJE)).toBe('Outubro de 2026');
    expect(rotuloDoPeriodo({ tipo: 'escolha', escolha: { tipo: 'mes', valor: '2025-09' } }, HOJE)).toBe('Setembro de 2025');
    expect(rotuloDoPeriodo(atalho('hoje'), HOJE)).toBe('Hoje');
    expect(rotuloDoPeriodo(atalho('esta_semana'), HOJE)).toBe('Esta semana');
    expect(rotuloDoPeriodo(atalho('este_ano'), HOJE)).toBe('2026');
    expect(rotuloDoPeriodo({ tipo: 'escolha', escolha: { tipo: 'dia', valor: '2026-11-02' } }, HOJE)).toBe('Seg, 02/11/2026');
    expect(rotuloDoPeriodo({ tipo: 'escolha', escolha: { tipo: 'ano', valor: '2024' } }, HOJE)).toBe('2024');
  });
});

describe('T-0170 §7.2: janela do aparelho e o período que precisa de internet', () => {
  it('a janela começa no mais antigo entre hoje − 40 e o dia 1 do mês anterior', () => {
    expect(inicioDaJanela('2026-11-13')).toBe('2026-10-01');
    expect(inicioDaJanela('2026-11-30')).toBe('2026-10-01');
    expect(inicioDaJanela('2026-03-05')).toBe('2026-01-24'); // hoje − 40 vem antes de 01/02
  });

  it('Este mês e Mês passado ficam no aparelho; Este ano e um mês antigo vão ao servidor', () => {
    expect(foraDaJanela(intervaloDaSelecao(SELECAO_PADRAO, HOJE), HOJE)).toBe(false);
    expect(foraDaJanela(intervaloDaSelecao(atalho('mes_passado'), HOJE), HOJE)).toBe(false);
    expect(foraDaJanela(intervaloDaSelecao(atalho('este_ano'), HOJE), HOJE)).toBe(true);
    expect(foraDaJanela(intervaloDaSelecao({ tipo: 'escolha', escolha: { tipo: 'mes', valor: '2026-09' } }, HOJE), HOJE)).toBe(true);
    expect(AJUDA_FORA_DA_JANELA).toMatch(/internet/);
  });

  it('fora da janela, o cartão diz o estado da consulta: sem sinal, buscando ou erro', () => {
    expect(mensagemDoServidor('sem_sinal')).toBe('Sem sinal: este período precisa de internet.');
    expect(mensagemDoServidor('carregando')).toBe('Buscando no servidor…');
    expect(mensagemDoServidor('erro')).toMatch(/Puxe para baixo/);
  });

  it('a cópia do servidor só é guardada para Este mês e Mês passado (§7.1)', () => {
    expect(chaveDaCopia(intervaloDaSelecao(SELECAO_PADRAO, HOJE), HOJE)).toBe('este_mes');
    expect(chaveDaCopia(intervaloDaSelecao(atalho('mes_passado'), HOJE), HOJE)).toBe('mes_passado');
    expect(chaveDaCopia(intervaloDaSelecao(atalho('hoje'), HOJE), HOJE)).toBeNull();
    expect(chaveDaCopia(intervaloDaSelecao({ tipo: 'escolha', escolha: { tipo: 'mes', valor: '2026-11' } }, HOJE), HOJE)).toBe('este_mes');
  });
});
