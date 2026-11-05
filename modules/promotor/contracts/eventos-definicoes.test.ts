import { describe, expect, it } from 'vitest';
import { conferirEventosPublicados } from '@macuxi/platform-sdk';
import { manifest } from '../manifest';
import * as contracts from './index';
import { EVENTOS_PROMOTOR, VisitaLojaConcluidaV1Objeto } from './index';

describe('T-0024: definições dos eventos promotor.* no contracts', () => {
  it('RN-PRO-01: todo evento publicado no manifest tem definição exportada e nenhuma é de evento alheio (nenhum evento de pedido)', () => {
    expect(conferirEventosPublicados(manifest, contracts)).toEqual([]);
    expect(manifest.publica.some((n) => n.includes('pedido'))).toBe(false);
  });

  it('RN-PRO-02: o schema de cada definição é o do contracts e a visita concluída carrega as contagens de fotos com/sem GPS', () => {
    expect(Object.keys(EVENTOS_PROMOTOR).sort()).toEqual([...manifest.publica].sort());
    const chaves = Object.keys(VisitaLojaConcluidaV1Objeto.shape);
    expect(chaves).toEqual(expect.arrayContaining(['fotos_total', 'fotos_sem_gps']));
  });
});
