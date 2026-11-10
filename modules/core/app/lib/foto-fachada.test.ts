import { describe, expect, it } from 'vitest';

import { pedidoDaFachada } from './foto-fachada';

const ARQ = '11111111-1111-4111-8111-111111111111';

describe('RN-CORE-38: abrir a fachada do PDV', () => {
  it('RN-CORE-38: título é o cliente e o subtítulo "Fachada · data" no fuso do tenant', () => {
    const p = pedidoDaFachada('Atacadinho', { arquivo_id: ARQ, tirada_em: '2026-11-09T02:30:00Z' }, 'America/Manaus');
    expect(p).toEqual({ arquivo_id: ARQ, titulo: 'Atacadinho', subtitulo: 'Fachada · 08/11/2026' });
  });
  it('RN-CORE-38: sem fachada enviada não há pedido; sem data, só "Fachada"', () => {
    expect(pedidoDaFachada('X', null, 'America/Manaus')).toBeNull();
    expect(pedidoDaFachada('X', { arquivo_id: ARQ, tirada_em: null }, 'America/Manaus')?.subtitulo).toBe('Fachada');
  });
});
