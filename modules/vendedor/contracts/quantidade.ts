/**
 * Quantidade e fator nos contratos do Vendedor (ADR 0076, RN-VEN-02 v3): número JSON com até 4 casas. A fração só vale em KG e M;
 * isso é regra do domain (`exigirQuantidade`) e a API revalida. `QuantidadeNaoNeg` é a mesma quantidade, aceitando 0 (ex.: faturada).
 */
import { QuantidadeDecimalSchema } from '@macuxi/platform-sdk';
import { z } from 'zod';

export const QuantidadeNaoNeg = z.union([z.literal(0), QuantidadeDecimalSchema]);
