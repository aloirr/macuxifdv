/**
 * ADR 0076 D6: o pull filtrado por versão entra na variação do escopo, para o app que sobe para a 1.0.35 baixar de novo
 * as linhas fracionárias que ficaram atrás do cursor.
 */
import { criarPortaVersaoAppMemoria, type ContextoBase } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { provedoresSyncVendedor, variacaoFracaoDoPull } from './sync';

const ctxCom = (versao: string | null): ContextoBase =>
  ({ versaoApp: criarPortaVersaoAppMemoria({}, versao ? { variante: 'campo', versao } : null) }) as unknown as ContextoBase;

describe('variação de escopo do pull de pedido (ADR 0076 D6)', () => {
  it.each([
    [null, 'fracao=0'],
    ['1.0.34', 'fracao=0'],
    ['1.0.35', 'fracao=1'],
    ['1.0.40', 'fracao=1'],
  ])('RN-VEN-02: app %s → %s', (versao, esperado) => {
    expect(variacaoFracaoDoPull(ctxCom(versao))).toBe(esperado);
  });

  it('RN-VEN-02: subir de 1.0.34 para 1.0.35 muda a variação (o aparelho rebaixa pedido, item e evento)', async () => {
    for (const nome of ['pedido', 'pedido_item', 'pedido_evento']) {
      const prov = provedoresSyncVendedor.find((p) => p.entidade.nome === nome)!;
      expect(prov.variacaoEscopo, nome).toBeDefined();
      expect(await prov.variacaoEscopo!(ctxCom('1.0.34'))).not.toBe(await prov.variacaoEscopo!(ctxCom('1.0.35')));
    }
  });
});
