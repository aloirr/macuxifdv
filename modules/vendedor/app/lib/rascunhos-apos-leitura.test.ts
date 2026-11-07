import { describe, expect, it } from 'vitest';

import { rascunhosAposLeitura } from './rascunhos-apos-leitura';

const lidos = { a: 'antigo' };
const memoria = { a: 'novo' };

describe('leitura do repositório x toque no +/− (T-0089, R1)', () => {
  it('RN-VEN-02: leitura que começou antes do toque, com a gravação já terminada, não sobrescreve o rascunho', () => {
    expect(rascunhosAposLeitura({ lidos, memoria, geracaoAntes: 3, geracaoAgora: 4, emAndamento: 0 })).toBe(memoria);
  });
  it('RN-VEN-02: gravação em andamento: vale o rascunho da memória', () => {
    expect(rascunhosAposLeitura({ lidos, memoria, geracaoAntes: 3, geracaoAgora: 3, emAndamento: 1 })).toBe(memoria);
  });
  it('RN-VEN-02: nada mudou durante a leitura: valem os rascunhos lidos', () => {
    expect(rascunhosAposLeitura({ lidos, memoria, geracaoAntes: 3, geracaoAgora: 3, emAndamento: 0 })).toBe(lidos);
  });
});
