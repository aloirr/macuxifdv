/** Tipos do Conector que estendem o contrato com campos OPCIONAIS combinados no desenho (compatíveis com `/v1`, RN-INT-09). */
import { LoteResultado, type RetornoErp } from '@macuxi/integracao/contracts';
import { z } from 'zod';

/**
 * Resultado do lote + situação da inativação em massa (RN-INT-06). O campo `inativacao` é uma PREMISSA do Conector:
 * quando a carga completa fecha e a inativação passaria de 30% dos ativos, o Hub não inativa e devolve
 * `aguardando_confirmacao` (o operador confirma no BKO). Ausente = sem informação (nada a fazer).
 */
export const ResultadoLote = LoteResultado.extend({
  inativacao: z
    .object({
      situacao: z.enum(['aplicada', 'aguardando_confirmacao', 'nao_aplicavel']),
      motivo: z.string().nullish(),
      candidatos: z.number().int().nonnegative().nullish(),
    })
    .nullish(),
});
export type ResultadoLoteHub = z.infer<typeof ResultadoLote>;

/** O retorno do pedido é o do contrato (inclui `itens_faturados`, T-0023); este alias mantém os imports do Conector. */
export type RetornoParaHub = RetornoErp;
