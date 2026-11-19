import { describe, expect, it } from 'vitest';

import { SQL_PEDIDO_EXISTENTE } from './receber';

describe('RN-VEN-33: reenvio simultâneo do mesmo pedido', () => {
  it('RN-VEN-33: a leitura do pedido existente trava a linha (for update), para o segundo envio esperar e cair na idempotência', () => {
    expect(SQL_PEDIDO_EXISTENTE).toMatch(/from vendedor\.pedido where id = \$1 for update$/);
  });
});
