/** Tipos do Conector que estendem o contrato com campos OPCIONAIS combinados no desenho (compatíveis com `/v1`, RN-INT-09). */
import { LoteResultado, type RetornoErp } from '@macuxi/integracao/contracts';
import type { z } from 'zod';

/**
 * Resultado do lote. A situação da inativação em massa (RN-INT-06) já está no contrato (`LoteResultado.inativacao`, T-0025): no
 * último lote da sessão completa o Hub devolve `aplicada`, `aguardando_confirmacao` (lote APLICADO, só as inativações esperam o
 * operador no BKO — P-2) ou `nao_aplicavel`. Ausente = sem informação (nada a fazer).
 */
export const ResultadoLote = LoteResultado;
export type ResultadoLoteHub = z.infer<typeof ResultadoLote>;

/** O retorno do pedido é o do contrato (inclui `itens_faturados`, T-0023); este alias mantém os imports do Conector. */
export type RetornoParaHub = RetornoErp;
