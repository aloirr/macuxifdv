/** T-0072: vibração leve do shell — reduzir movimento, Android com retorno tátil do sistema, iOS e web. */
import { describe, expect, it, vi } from 'vitest';

import { montarVibracao, type MotorTatil } from './vibracao';

function motor(androidFalhaNoConfirmar = false): MotorTatil & { android: ReturnType<typeof vi.fn>; impactoLeve: ReturnType<typeof vi.fn> } {
  return {
    android: vi.fn((tipo: 'confirmar' | 'tecla') =>
      androidFalhaNoConfirmar && tipo === 'confirmar' ? Promise.reject(new Error('Android 10: sem CONFIRM')) : Promise.resolve(),
    ),
    impactoLeve: vi.fn(() => Promise.resolve()),
  };
}

describe('vibração leve do shell', () => {
  it('com "reduzir movimento" não registra vibração em nenhuma plataforma', () => {
    for (const p of ['android', 'ios', 'web']) expect(montarVibracao(p, true, motor())).toBeNull();
  });

  it('Android usa o retorno tátil do sistema (confirmar), sem o impacto do Vibrator', async () => {
    const m = motor();
    const fn = montarVibracao('android', false, m);
    expect(fn).not.toBeNull();
    await fn!();
    expect(m.android).toHaveBeenCalledTimes(1);
    expect(m.android).toHaveBeenCalledWith('confirmar');
    expect(m.impactoLeve).not.toHaveBeenCalled();
  });

  it('Android antigo sem "confirmar" cai para o toque de tecla do sistema', async () => {
    const m = motor(true);
    await montarVibracao('android', false, m)!();
    expect(m.android).toHaveBeenNthCalledWith(1, 'confirmar');
    expect(m.android).toHaveBeenNthCalledWith(2, 'tecla');
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
