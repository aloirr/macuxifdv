/**
 * Leitura TOLERANTE do evento `vendedor.pedido.criado@1`, só com o que o desafio de vendas (RF-TRE-06) precisa.
 * O Treinamento não importa nada do módulo Vendedor (nem seus contracts): este schema é a "visão" que o consumidor
 * tem do payload. Campos a mais são ignorados (objeto não estrito) e o Treinamento segue funcionando sem o Vendedor.
 * Se o Vendedor mudar nomes ou tipos, o evento é recusado aqui (não pontua) até alinharmos o contrato.
 */
import { z } from 'zod';
import { InstanteUtc, Uuid } from './base';

export const PedidoItemLido = z.object({
  produto_id: Uuid,
  /** Unidades vendidas (aceita fração, p.ex. kg). */
  quantidade: z.number().positive(),
});
export type PedidoItemLido = z.infer<typeof PedidoItemLido>;

export const PedidoCriadoLido = z.object({
  pedido_id: Uuid,
  /** Vendedor dono do pedido (quem recebe o XP); em pedido "em nome", é o vendedor, não o gestor. */
  vendedor_id: Uuid,
  criado_em: InstanteUtc,
  itens: z.array(PedidoItemLido).max(500),
});
export type PedidoCriadoLido = z.infer<typeof PedidoCriadoLido>;

/** Desafio de vendas (campanha com XP) cadastrado no BKO (RF-TRE-06). */
export const DesafioVendasContrato = z
  .object({
    id: Uuid,
    tenant_id: Uuid,
    nome: z.string().trim().min(1).max(200),
    ativo: z.boolean(),
    produto_ids: z.array(Uuid).min(1),
    vigencia_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    vigencia_fim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    xp_por_unidade: z.number().int().positive(),
    xp_max_por_pedido: z.number().int().positive(),
  })
  .strict()
  .refine((d) => d.vigencia_fim >= d.vigencia_inicio, { path: ['vigencia_fim'], message: 'O fim da vigência não pode ser anterior ao início.' });
export type DesafioVendasContrato = z.infer<typeof DesafioVendasContrato>;
