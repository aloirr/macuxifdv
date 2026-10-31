/**
 * Eventos publicados pelo Core (nome `<modulo>.<entidade>.<fato>@vN`; payload validado na outbox).
 * - `core.usuario.modulos_alterados@1`: uma licença mudou (tenant, perfil ou exceção de usuário). Quem guarda
 *   estado por módulo (ex.: filas, caches) reage; o aparelho descobre pelo `versao_licencas` do `/v1/me/modulos`.
 * - Sprint 1 (desenho T-0016; formatos em `.coord/contratos/eventos.md`): visita.checkin, visita.checkout,
 *   cliente.atualizado e notificacao.criada. Sem consumidor até existir o despachante da outbox (ADR 0007).
 */
import { z } from 'zod';
import { definirEvento } from '@macuxi/platform-sdk';
import { ModulosAlteradosSchema } from './licencas';
import { RESULTADOS_VISITA, TIPOS_NOTIFICACAO } from './sync';

export const EVENTO_MODULOS_ALTERADOS = definirEvento('core.usuario.modulos_alterados@1', ModulosAlteradosSchema);

const Uuid = z.string().uuid();
const DATA_CIVIL = /^\d{4}-\d{2}-\d{2}$/;

export const VisitaCheckinSchema = z.object({
  visita_id: Uuid,
  usuario_id: Uuid,
  cliente_id: Uuid,
  rota_parada_id: Uuid.nullable(),
  checkin_em: z.string().datetime(),
  data_local: z.string().regex(DATA_CIVIL),
  fora_do_raio: z.boolean(),
  distancia_m: z.number().nullable(),
  sem_gps: z.boolean(),
  extra: z.boolean(),
});
export const EVENTO_VISITA_CHECKIN = definirEvento('core.visita.checkin@1', VisitaCheckinSchema);

export const VisitaCheckoutSchema = z.object({
  visita_id: Uuid,
  usuario_id: Uuid,
  cliente_id: Uuid,
  checkin_em: z.string().datetime(),
  checkout_em: z.string().datetime(),
  data_local: z.string().regex(DATA_CIVIL),
  resultado: z.enum([...RESULTADOS_VISITA, 'nao_finalizado']),
  motivo_codigo: z.string().nullable(),
  pedido_id: Uuid.nullable(),
  fechada_por: z.enum(['usuario', 'auto']),
  permanencia_s: z.number().int().min(0),
});
export const EVENTO_VISITA_CHECKOUT = definirEvento('core.visita.checkout@1', VisitaCheckoutSchema);

export const ClienteAtualizadoSchema = z.object({
  cliente_id: Uuid,
  campos: z.array(z.string()),
  origem: z.enum(['erp', 'bko', 'campo']),
});
export const EVENTO_CLIENTE_ATUALIZADO = definirEvento('core.cliente.atualizado@1', ClienteAtualizadoSchema);

export const NotificacaoCriadaSchema = z.object({
  notificacao_id: Uuid,
  usuario_id: Uuid,
  tipo: z.enum(TIPOS_NOTIFICACAO),
  prioridade: z.enum(['normal', 'alta']),
});
export const EVENTO_NOTIFICACAO_CRIADA = definirEvento('core.notificacao.criada@1', NotificacaoCriadaSchema);
