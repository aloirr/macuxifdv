/**
 * Leitura TOLERANTE do evento `vendedor.pedido.faturado@1` ("pedido faturado"), RF-TRE-06. O XP é pago no FATURAMENTO
 * (status vindo do ERP pelo Hub), não na criação do pedido. T-0024: o schema é o OFICIAL do Vendedor
 * (`modules/vendedor/contracts`, importado por caminho relativo; sem cópia do payload), lido com `tolerante`: chave
 * desconhecida some em qualquer nível; tipos, `quantidade` inteira > 0, `itens` com pelo menos 1 e `parcial` obrigatório
 * seguem o contrato do dono. Payload fora do contrato = recusado (não pontua). Campo que falta = recado ao Vendedor.
 * `itens` = o que foi faturado NESTE retorno (o consumidor soma). O consumidor é idempotente por `evento_id`, que vem
 * do ENVELOPE (não do payload): quem consome o junta ao payload com `lerPedidoFaturado` (T-0036).
 *
 * A definição do evento (`EVENTO_PEDIDO_FATURADO`) NÃO é reexportada aqui (a catraca `conferirEventosPublicados`
 * reprova definição alheia no contracts); o consumidor da API a importa do Vendedor e usa `eventoTolerante`.
 *
 * Tipo ÚNICO (T-0036): `PedidoFaturadoLido` é o payload; `EventoFaturadoNoDesafio` é o mesmo schema estendido com
 * `evento_id` e `tenant_id` do envelope. O domínio e o consumidor da API recebem só `EventoFaturadoNoDesafio`.
 */
import { z } from 'zod';
import { tolerante } from '@macuxi/platform-sdk';
import { PedidoFaturadoEvento } from '../../vendedor/contracts';
import { Uuid } from './base';

export const PedidoFaturadoLido = tolerante(PedidoFaturadoEvento);
export type PedidoFaturadoLido = z.infer<typeof PedidoFaturadoLido>;

/**
 * O pedido faturado como o Treinamento o processa (RF-TRE-06, RN-TRE-08): payload lido + `evento_id` (chave de
 * idempotência do retorno) e `tenant_id` do ENVELOPE. É a entrada de `avaliarPedidoNoDesafio`/`candidatoDoDesafio`.
 */
export const EventoFaturadoNoDesafio = tolerante(PedidoFaturadoEvento).extend({
  /** `evento_id` do envelope (não vem no payload). */
  evento_id: Uuid,
  /** Tenant do envelope (o despachante abre a transação com ele; RLS). */
  tenant_id: Uuid,
});
export type EventoFaturadoNoDesafio = z.infer<typeof EventoFaturadoNoDesafio>;

/** O que o consumidor usa do envelope do evento (`EnvelopeEvento` do platform-sdk). */
export interface EnvelopeLido {
  evento_id: string;
  tenant_id: string;
}

/**
 * Lê `vendedor.pedido.faturado@1` para o desafio: junta o payload aos campos do envelope e valida tudo com
 * `EventoFaturadoNoDesafio`. O `evento_id` e o `tenant_id` do ENVELOPE prevalecem sobre qualquer campo homônimo do
 * payload (o payload não escolhe o tenant). Payload fora do contrato → `null` (não pontua; o consumidor registra e segue).
 */
export function lerPedidoFaturado(payload: unknown, envelope: EnvelopeLido): EventoFaturadoNoDesafio | null {
  const corpo = payload !== null && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const r = EventoFaturadoNoDesafio.safeParse({ ...corpo, evento_id: envelope.evento_id, tenant_id: envelope.tenant_id });
  return r.success ? r.data : null;
}

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
