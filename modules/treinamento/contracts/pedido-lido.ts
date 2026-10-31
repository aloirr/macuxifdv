/**
 * Leitura TOLERANTE do evento `vendedor.pedido.faturado@1` ("pedido faturado"), só com o que o desafio de vendas
 * (RF-TRE-06) precisa. O XP é pago no FATURAMENTO (status vindo do ERP pelo Hub), não na criação do pedido.
 * O publicador e o registro do evento em .coord/contratos/eventos.md são do engenheiro-software.
 * O Treinamento não importa nada do módulo Vendedor (nem seus contracts): este schema é a "visão" que o consumidor
 * tem do payload. Campos a mais são ignorados (objeto não estrito) e o Treinamento segue funcionando sem o Vendedor.
 * Se o Vendedor mudar nomes ou tipos, o evento é recusado aqui (não pontua) até alinharmos o contrato.
 * Contrato oficial (docs/desenho/T-0011.md §2; .coord/contratos/eventos.md): um evento por retorno aceito do ERP;
 * `itens` = o que foi faturado NESTE retorno (o consumidor soma; o total depois de parciais traz só o saldo);
 * `parcial` (padrão false) marca faturamento parcial; parcial sem itens (vazio ou ausente) é lido, mas ignorado pelo
 * domínio (`PARCIAL_SEM_ITENS`). O consumidor é idempotente por `evento_id`, que vem do ENVELOPE (não do payload):
 * quem consome o repassa ao domínio (`PedidoFaturadoLido.evento_id` em domain/desafio.ts).
 */
import { z } from 'zod';
import { InstanteUtc, Uuid } from './base';

export const PedidoItemLido = z.object({
  produto_id: Uuid,
  /** Unidades vendidas (aceita fração, p.ex. kg). */
  quantidade: z.number().positive(),
});
export type PedidoItemLido = z.infer<typeof PedidoItemLido>;

export const PedidoFaturadoLido = z.object({
  pedido_id: Uuid,
  /** Vendedor dono do pedido (quem recebe o XP); em pedido "em nome", é o vendedor, não o gestor. */
  vendedor_id: Uuid,
  /** Instante UTC do faturamento (define o dia da vigência e do XP). Pedido sem este campo (só criado) é recusado. */
  faturado_em: InstanteUtc,
  /** Itens faturados NESTE evento, a somar com os dos outros eventos do pedido (ausente = vazio). */
  itens: z.array(PedidoItemLido).max(500).default([]),
  /** Faturamento parcial (padrão false = total). Em qualquer caso, `quantidade` é a faturada neste evento. */
  parcial: z.boolean().default(false),
});
export type PedidoFaturadoLido = z.infer<typeof PedidoFaturadoLido>;

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
    /** Teto de XP por vendedor neste desafio; ausente = padrão do tenant (`xp_max_por_desafio`, 500); 0 = sem teto. */
    xp_max_por_desafio: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine((d) => d.vigencia_fim >= d.vigencia_inicio, { path: ['vigencia_fim'], message: 'O fim da vigência não pode ser anterior ao início.' });
export type DesafioVendasContrato = z.infer<typeof DesafioVendasContrato>;
