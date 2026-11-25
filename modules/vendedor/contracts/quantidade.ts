/**
 * Quantidade e fator nos contratos do Vendedor (ADR 0076, RN-VEN-02 v3): número JSON com até 4 casas. A fração só vale em KG e M;
 * isso é regra do domain (`exigirQuantidade`) e a API revalida. `QuantidadeNaoNeg` é a mesma quantidade, aceitando 0 (ex.: faturada).
 */
import { QUANTIDADE_DECIMAL_MAX, QuantidadeDecimalSchema } from '@macuxi/platform-sdk';
import { z } from 'zod';

export const QuantidadeNaoNeg = z.union([z.literal(0), QuantidadeDecimalSchema]);

/**
 * Quantidade do item no ENVIO (push e PUT do orçamento): positiva e até o teto, sem conferir as casas. Mais de 4 casas é
 * regra da API (RN-VEN-02 v3, ADR 0076 D4): 422 `quantidade_fracionaria_invalida`, não `PAYLOAD_INVALIDO` nem 400.
 */
export const QuantidadeEnvio = z
  .number()
  .finite()
  .positive()
  .max(QUANTIDADE_DECIMAL_MAX, `quantidade deve ser no máximo ${QUANTIDADE_DECIMAL_MAX}`);
