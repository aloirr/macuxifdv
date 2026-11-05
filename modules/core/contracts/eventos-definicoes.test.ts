import { describe, expect, it } from 'vitest';
import { conferirEventosPublicados } from '@macuxi/platform-sdk';
import { manifest } from '../manifest';
import * as contracts from './index';
import { EVENTO_ROTA_DIA_PLANEJADO, RotaDiaPlanejadoSchema } from './index';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

describe('T-0024: definições dos eventos core.* no contracts', () => {
  it('RN-CORE-10: todo evento publicado no manifest tem definição exportada e nenhuma é de evento alheio', () => {
    expect(conferirEventosPublicados(manifest, contracts)).toEqual([]);
  });

  it('RN-CORE-03: core.rota.dia_planejado@1 (planejado) aceita usuário, dia civil e clientes; rota_id é opcional', () => {
    expect(EVENTO_ROTA_DIA_PLANEJADO.nome).toBe('core.rota.dia_planejado@1');
    expect(EVENTO_ROTA_DIA_PLANEJADO.schema.safeParse({ usuario_id: U1, data: '2026-11-05', cliente_ids: [U2] }).success).toBe(true);
    expect(RotaDiaPlanejadoSchema.safeParse({ usuario_id: U1, data: '2026-11-05', cliente_ids: [], rota_id: U2 }).success).toBe(true);
  });

  it('RN-CORE-03: core.rota.dia_planejado@1 rejeita data fora do dia civil, id inválido e chave a mais (saída strict)', () => {
    expect(RotaDiaPlanejadoSchema.safeParse({ usuario_id: U1, data: '05/11/2026', cliente_ids: [] }).success).toBe(false);
    expect(RotaDiaPlanejadoSchema.safeParse({ usuario_id: 'x', data: '2026-11-05', cliente_ids: [] }).success).toBe(false);
    expect(RotaDiaPlanejadoSchema.safeParse({ usuario_id: U1, data: '2026-11-05', cliente_ids: [], nome: 'x' }).success).toBe(false);
  });
});
