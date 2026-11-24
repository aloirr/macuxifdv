import { describe, expect, it, vi } from 'vitest';
import { AVISO_CHAVE_COPIADA } from '../../domain/retorno-erp';
import { AVISO_CHAVE_NAO_COPIADA, copiarChaveNf } from './copiar-chave';

const CHAVE = '35261112345678000195550010000090011000090019';

describe('copiar a chave da NF (RF-VEN-05)', () => {
  it('RF-VEN-05: copia os 44 dígitos sem espaços, mesmo com a chave agrupada, e avisa "Chave copiada"', async () => {
    const copiar = vi.fn();
    const agrupada = CHAVE.match(/\d{4}/g)!.join(' ');
    expect(await copiarChaveNf(agrupada, copiar)).toEqual({ ok: true, aviso: AVISO_CHAVE_COPIADA });
    expect(copiar).toHaveBeenCalledWith(CHAVE);
    expect(AVISO_CHAVE_COPIADA).toBe('Chave copiada');
  });
  it('RF-VEN-05: chave fora do padrão ou falha na área de transferência não copia e orienta tentar de novo', async () => {
    const copiar = vi.fn();
    expect(await copiarChaveNf('123', copiar)).toEqual({ ok: false, aviso: AVISO_CHAVE_NAO_COPIADA });
    expect(copiar).not.toHaveBeenCalled();
    expect((await copiarChaveNf(CHAVE, () => { throw new Error('x'); })).ok).toBe(false);
  });
});
