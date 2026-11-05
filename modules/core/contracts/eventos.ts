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
import { INDICADORES_META, RESULTADOS_VISITA, TIPOS_NOTIFICACAO } from './sync';

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
  /** Carteira (RN-CORE-04; T-0014): OPCIONAIS e compatíveis com @1. Ausente = o evento não informou; `null` = sem valor. */
  vendedor_id: Uuid.nullable().optional(),
  ativo: z.boolean().optional(),
  /** Mapeado de `core.carteira.frequencia_semanas` (1 semanal, 2 quinzenal, 4 mensal). */
  frequencia_visita: z.enum(['semanal', 'quinzenal', 'mensal']).nullable().optional(),
  /** Quando o cliente entrou na carteira do vendedor atual (UTC). */
  na_carteira_desde: z.string().datetime().nullable().optional(),
  /** Cadastro mínimo (RN-CORE-16; T-0060): aditivo em @1. Só nomes de campo, nunca o valor. */
  cadastro_incompleto: z.boolean().optional(),
  cadastro_campos_faltantes: z.array(z.string()).optional(),
});
export const EVENTO_CLIENTE_ATUALIZADO = definirEvento('core.cliente.atualizado@1', ClienteAtualizadoSchema);

export const NotificacaoCriadaSchema = z.object({
  notificacao_id: Uuid,
  usuario_id: Uuid,
  tipo: z.enum(TIPOS_NOTIFICACAO),
  prioridade: z.enum(['normal', 'alta']),
});
export const EVENTO_NOTIFICACAO_CRIADA = definirEvento('core.notificacao.criada@1', NotificacaoCriadaSchema);

/** Meta definida ou alterada no BKO (`PUT metas/:usuarioId/:periodo`). O Gestor consome para meta × realizado. */
export const MetaDefinidaSchema = z.object({
  usuario_id: Uuid,
  periodo: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  indicador: z.enum(INDICADORES_META),
  /** Inteiro: centavos (`venda_cents`), contagem ou pontos-base (`cobertura_pct`). */
  valor: z.number().int().min(0),
  valor_anterior: z.number().int().min(0).nullable(),
  definido_por: Uuid,
});
export const EVENTO_META_DEFINIDA = definirEvento('core.meta.definida@1', MetaDefinidaSchema);

/**
 * Rota do dia planejada (RN-CORE-03; T-0024). PLANEJADO: definição publicada para o Gestor (cobertura de rota, RN-GES), mas
 * o evento fica FORA do `publica` do manifest até o Core publicá-lo de fato (quando o BKO gerar/alterar a rota do dia).
 * Só ids e dia civil; sem nome nem dado pessoal (o nome vem da consulta `core.cadastro_resumo@1`).
 */
export const RotaDiaPlanejadoSchema = z
  .object({
    usuario_id: Uuid,
    /** Dia civil no fuso do tenant. */
    data: z.string().regex(DATA_CIVIL),
    /** Clientes da rota do dia, na ordem planejada. */
    cliente_ids: z.array(Uuid),
    rota_id: Uuid.optional(),
  })
  .strict();
export const EVENTO_ROTA_DIA_PLANEJADO = definirEvento('core.rota.dia_planejado@1', RotaDiaPlanejadoSchema);
