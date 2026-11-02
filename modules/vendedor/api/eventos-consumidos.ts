/**
 * Nota do ERP consumida pelo Vendedor (T-0054). ESPELHO do schema oficial do dono (`modules/integracao/contracts`:
 * `eventoEntidadeAtualizado('nota')`/`NotaPayload`), só com o que o Vendedor lê. O retorno do ERP usa o
 * `RetornoErpConsumido` dos contracts do Vendedor (T-0053), também um espelho. Campo novo opcional no publicador continua `@1` e é ignorado aqui (o Zod descarta chave
 * desconhecida). Espelho e não import: o import relativo de outro pacote exige os inputs do turbo (regra R2 do
 * `scripts/ci/grafo-turbo.mjs`), pedidos ao engenheiro-software; quando existirem, trocar pelo import oficial.
 * Divergência com o dono = recado ao modulo-integracao. Ficam na API: o app não consome eventos.
 *  - `integracao.nota.atualizado@1` (RN-INT-02): nota do ERP; o Vendedor usa só a de `devolucao` com `pedido_uuid`.
 */
import { definirEvento } from '@macuxi/platform-sdk';
import { z } from 'zod';

const Uuid = z.string().uuid();
const DataHoraUtc = z.string().min(1);

/** Espelho de `NotaPayload` (só os campos lidos). */
export const NotaLida = z.object({
  external_id: z.string().min(1),
  tipo: z.enum(['faturamento', 'devolucao']),
  numero: z.string().min(1),
  serie: z.string().nullish(),
  emitida_em: DataHoraUtc,
  total_cents: z.number().int(),
  pedido_uuid: Uuid.nullish(),
  cancelada: z.boolean().default(false),
});

/** Espelho de `integracao.nota.atualizado@1` (`registro` omitido em `inativado`). */
export const NotaAtualizadaLida = z.object({
  lote_id: Uuid,
  entidade: z.literal('nota'),
  external_id: z.string().min(1),
  acao: z.enum(['criado', 'atualizado', 'inativado']),
  hash: z.string().min(1),
  registro: NotaLida.optional(),
  ocorrido_em: DataHoraUtc,
});
export type NotaAtualizadaLida = z.infer<typeof NotaAtualizadaLida>;

export const EVENTO_NOTA_ATUALIZADA = definirEvento('integracao.nota.atualizado@1', NotaAtualizadaLida);
