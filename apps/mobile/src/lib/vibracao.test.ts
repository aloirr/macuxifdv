/** T-0072: vibração leve do shell — reduzir movimento, Android com retorno tátil do sistema, iOS e web. */
import { describe, expect, it, vi } from 'vitest';

import { montarVibracao, type MotorTatil } from './vibracao';

function motor(androidFalhaNoConfirmar = false): MotorTatil & { android: ReturnType<typeof vi.fn>; impactoLeve: ReturnType<typeof vi.fn> } {
  return {
    android: vi.fn((tipo: 'confirmar' | 'tecla') =>
      androidFalhaNoConfirmar && tipo === 'confirmar' ? Promise.reject(new Error('sem CONFIRM')) : Promise.resolve(),
    ),
    impactoLeve: vi.fn(() => Promise.resolve()),
  };
}

describe('vibração leve do shell', () => {
  it('com "reduzir movimento" não registra vibração em nenhuma plataforma', () => {
    for (const p of ['android', 'ios', 'web']) expect(montarVibracao(p, true, motor())).toBeNull();
  });

  it('Android 11+ usa o retorno tátil do sistema (confirmar), sem o impacto do Vibrator', async () => {
    const m = motor();
    const fn = montarVibracao('android', false, m, 30);
    expect(fn).not.toBeNull();
    await fn!();
    expect(m.android).toHaveBeenCalledTimes(1);
    expect(m.android).toHaveBeenCalledWith('confirmar');
    expect(m.impactoLeve).not.toHaveBeenCalled();
  });

  it('Android 11+ cujo "confirmar" rejeita cai para o toque de tecla do sistema', async () => {
    const m = motor(true);
    await montarVibracao('android', false, m, 34)!();
    expect(m.android).toHaveBeenNthCalledWith(1, 'confirmar');
    expect(m.android).toHaveBeenNthCalledWith(2, 'tecla');
  });

  it('Android 10 (API 29) vai direto no toque de tecla: lá o "confirmar" devolve false sem erro e ficaria mudo (Y1)', async () => {
    const m = motor();
    await montarVibracao('android', false, m, 29)!();
    expect(m.android).toHaveBeenCalledTimes(1);
    expect(m.android).toHaveBeenCalledWith('tecla');
  });

  it('versão do Android desconhecida trata como antiga (toque de tecla vibra em todas)', async () => {
    for (const v of [undefined, null, 'x']) {
      const m = motor();
      await montarVibracao('android', false, m, v)!();
      expect(m.android).toHaveBeenCalledWith('tecla');
      expect(m.android).not.toHaveBeenCalledWith('confirmar');
    }
  });

  it('iOS usa o impacto leve', async () => {
    const m = motor();
    await montarVibracao('ios', false, m)!();
    expect(m.impactoLeve).toHaveBeenCalledTimes(1);
    expect(m.android).not.toHaveBeenCalled();
  });

  it('web (demonstração no navegador) não vibra', () => {
    expect(montarVibracao('web', false, motor())).toBeNull();
  });
});
