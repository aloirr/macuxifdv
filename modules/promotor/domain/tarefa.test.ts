import { describe, expect, it } from 'vitest';
import { situacaoTarefa, validarConclusaoTarefa } from './tarefa';

describe('RF-PRO-10: tarefas pontuais com prazo e comprovação por foto', () => {
  it('situação: pendente dentro do prazo, atrasada depois do prazo', () => {
    expect(situacaoTarefa({ prazo: '2026-11-06', concluida_em: null, hoje: '2026-11-06' })).toBe('pendente');
    expect(situacaoTarefa({ prazo: '2026-11-06', concluida_em: null, hoje: '2026-11-07' })).toBe('atrasada');
  });

  it('situação: concluída no prazo ou com atraso', () => {
    expect(situacaoTarefa({ prazo: '2026-11-06', concluida_em: '2026-11-05', hoje: '2026-11-10' })).toBe('concluida');
    expect(situacaoTarefa({ prazo: '2026-11-06', concluida_em: '2026-11-08', hoje: '2026-11-10' })).toBe('concluida_com_atraso');
  });

  it('sem prazo nunca atrasa', () => {
    expect(situacaoTarefa({ prazo: null, concluida_em: null, hoje: '2030-01-01' })).toBe('pendente');
  });

  it('conclusão exige ao menos uma foto de comprovação', () => {
    expect(validarConclusaoTarefa({ qtd_fotos: 0 })[0]).toMatch(/foto/i);
    expect(validarConclusaoTarefa({ qtd_fotos: 1 })).toEqual([]);
  });
});
