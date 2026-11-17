import { describe, expect, it, vi } from 'vitest';
import { criarApiJornada, rotuloSalvarAlmoco } from './almoco-padrao';

describe('RN-CORE-44 (D5): horário de almoço padrão no Calendário', () => {
  it('RN-CORE-44: lê e grava em /core/parametros/jornada com o contrato', async () => {
    const chamar = vi.fn(async () => ({ almoco_padrao: { inicio_min: 720, fim_min: 780 } }));
    const c = criarApiJornada(chamar as never);
    expect(await c.ler()).toEqual({ almoco_padrao: { inicio_min: 720, fim_min: 780 } });
    await c.gravar({ almoco_padrao: { inicio_min: 690, fim_min: 750 } });
    expect(chamar).toHaveBeenLastCalledWith('/core/parametros/jornada', { method: 'PUT', body: { almoco_padrao: { inicio_min: 690, fim_min: 750 } } });
  });

  it('D-PAR-05: o botão diz a ação concreta, "Salvar almoço", e "Salvando…" enquanto grava', () => {
    expect(rotuloSalvarAlmoco(false)).toBe('Salvar almoço');
    expect(rotuloSalvarAlmoco(true)).toBe('Salvando…');
  });
});
