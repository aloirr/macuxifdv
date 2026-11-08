import { describe, expect, it } from 'vitest';
import { trechosDoNumero } from './destaque-numero';

const marcado = (t: ReturnType<typeof trechosDoNumero>) => t.filter((p) => p.destaque).map((p) => p.texto);

describe('Y11: destaque do número buscado', () => {
  it('RF-VEN-05: busca igual ao trecho do número destaca esse trecho', () => {
    expect(marcado(trechosDoNumero('10042', '004'))).toEqual(['004']);
  });
  it('RF-VEN-05: busca com zeros à esquerda destaca o número sem zeros ("0042" em "10042")', () => {
    expect(marcado(trechosDoNumero('10042', '0042'))).toEqual(['0042']);
    expect(marcado(trechosDoNumero('13420', '0042'))).toEqual(['42']);
    expect(marcado(trechosDoNumero('1342', '0342'))).toEqual(['342']);
    expect(marcado(trechosDoNumero('42', '0042'))).toEqual(['42']);
  });
  it('RF-VEN-05: busca não numérica não destaca o número', () => {
    expect(marcado(trechosDoNumero('10042', 'padaria'))).toEqual([]);
    expect(trechosDoNumero('10042', 'padaria')).toEqual([{ texto: '10042', destaque: false }]);
  });
  it('RF-VEN-05: busca vazia ou número que não casa não destaca', () => {
    expect(marcado(trechosDoNumero('10042', ''))).toEqual([]);
    expect(marcado(trechosDoNumero('10042', '999'))).toEqual([]);
  });
  it('RF-VEN-05: o texto original é preservado nos trechos', () => {
    expect(trechosDoNumero('000042', '0042').map((p) => p.texto).join('')).toBe('000042');
  });
});
