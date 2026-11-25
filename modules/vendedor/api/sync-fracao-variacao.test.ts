/**
 * ADR 0076 D6: o pull filtrado por versão entra na variação do escopo, para o app que sobe para a 1.0.36 baixar de novo
 * as linhas fracionárias que ficaram atrás do cursor.
 */
import { criarPortaVersaoAppMemoria, type ContextoBase } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { FILTRO_SEM_FRACAO, provedoresSyncVendedor } from './sync';

const ctxCom = (versao: string | null): ContextoBase =>
  ({ versaoApp: criarPortaVersaoAppMemoria({}, versao ? { variante: 'campo', versao } : null) }) as unknown as ContextoBase;

describe('variação de escopo do pull de pedido (ADR 0076 D6)', () => {
  it('RN-VEN-02: subir de 1.0.35 para 1.0.36 muda a variação (o aparelho rebaixa pedido, item e evento)', async () => {
    for (const nome of ['pedido', 'pedido_item', 'pedido_evento']) {
      const prov = provedoresSyncVendedor.find((p) => p.entidade.nome === nome)!;
      expect(prov.variacaoEscopo, nome).toBeDefined();
      expect(await prov.variacaoEscopo!(ctxCom('1.0.35'))).not.toBe(await prov.variacaoEscopo!(ctxCom('1.0.36')));
    }
  });
  it('RN-VEN-02 v3: o filtro do app antigo olha toda coluna decimal do item (inclusive quantidade_faturada)', () => {
    for (const c of ['quantidade', 'fator', 'quantidade_base', 'quantidade_faturada', 'quantidade_embalagem', 'quantidade_unidades'])
      expect(FILTRO_SEM_FRACAO, c).toContain(`fi.${c} <> trunc(fi.${c})`);
  });
});
