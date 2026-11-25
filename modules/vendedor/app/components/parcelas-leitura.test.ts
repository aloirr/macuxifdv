import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// a tela importa react-native e não roda no Node: confere no fonte
const fonte = readFileSync(join(__dirname, 'novo-pedido-abas.tsx'), 'utf8');

describe('RN-VEN-24: campo Parcelas só leitura (ADR 0072)', () => {
  it('RN-VEN-24: Parcelas usa CampoLeitura, só quando o prazo do rascunho está na lista', () => {
    expect(fonte).toMatch(/r\.prazo_pagamento_id && opcoesPrazo\.some\(.*\) \? \(\s*<CampoLeitura testID="parcelas" rotulo="Parcelas"/);
    expect(fonte).not.toContain('editable={false}');
  });
});
