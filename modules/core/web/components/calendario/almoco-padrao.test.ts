import { describe, expect, it, vi } from 'vitest';
import { criarApiJornada, lerHorarioAlmoco } from './almoco-padrao';

describe('RN-CORE-44 (D5): horário de almoço padrão no Calendário', () => {
  it('RN-CORE-44: 12:00 às 13:00 vira 720 e 780', () => {
    expect(lerHorarioAlmoco('12:00', '13:00')).toEqual({ ok: true, inicio_min: 720, fim_min: 780 });
  });
  it('RN-CORE-44: o erro vem só ao salvar, no campo certo e em português', () => {
    expect(lerHorarioAlmoco('abc', '13:00')).toEqual({ ok: false, erros: { inicio: 'Use o horário em hh:mm.' } });
    const fimAntes = lerHorarioAlmoco('13:00', '12:00');
    expect(fimAntes.ok).toBe(false);
    if (!fimAntes.ok) expect(fimAntes.erros.fim).toBe('O fim do almoço deve ser depois do início.');
    const curto = lerHorarioAlmoco('12:00', '12:10');
    if (!curto.ok) expect(curto.erros.fim).toContain('15 minutos a 3 horas');
    expect(lerHorarioAlmoco('12:00', '15:30').ok).toBe(false);
  });
  it('RN-CORE-44: lê e grava em /core/parametros/jornada com o contrato', async () => {
    const chamar = vi.fn(async () => ({ almoco_padrao: { inicio_min: 720, fim_min: 780 } }));
    const c = criarApiJornada(chamar as never);
    expect(await c.ler()).toEqual({ almoco_padrao: { inicio_min: 720, fim_min: 780 } });
    await c.gravar({ almoco_padrao: { inicio_min: 690, fim_min: 750 } });
    expect(chamar).toHaveBeenLastCalledWith('/core/parametros/jornada', { method: 'PUT', body: { almoco_padrao: { inicio_min: 690, fim_min: 750 } } });
  });
});
