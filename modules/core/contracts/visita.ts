/**
 * Push de visita (desenho T-0016 §4): check-in (`visita`, id = id da visita, UUID do aparelho) e checkout
 * (`visita_checkout`, id = UUID do comando). Escrita idempotente; a API revalida RN-CORE-10/12/14.
 */
import { ehDataCivil } from '@macuxi/comum/calendar';
import { z } from 'zod';
import { RESULTADOS_VISITA } from './sync';

export const CheckinVisitaSchema = z
  .object({
    id: z.string().uuid(),
    cliente_id: z.string().uuid(),
    rota_parada_id: z.string().uuid().nullable().optional(),
    checkin_em: z.string().datetime(),
    lat: z.number().min(-90).max(90).nullable().optional(),
    lng: z.number().min(-180).max(180).nullable().optional(),
    precisao_m: z.number().min(0).nullable().optional(),
    /** RN-CORE-10: obrigatória quando fora do raio (o domínio decide; a API revalida). */
    justificativa_fora_raio: z.string().trim().min(3).max(500).nullable().optional(),
    extra: z.boolean().default(false),
  })
  .strict();
export type CheckinVisita = z.infer<typeof CheckinVisitaSchema>;

/** RN-CORE-52: ação do catálogo que libera o check-in em cliente fora da rota do dia (ligável por perfil de acesso). */
export const ACAO_CHECKIN_FORA_DE_ROTA = 'visita.checkin_fora_de_rota';
/** RN-CORE-13 (T-0187): ação que libera Rota, check-in e checkout no app Gestão para supervisor e gerente (a API recusa o push de visita deles sem ela). */
export const ACAO_VISITA_REGISTRAR_GESTAO = 'visita.registrar_gestao';
/** RN-CORE-52: código de erro do push de check-in (`rejeitado`) quando o cliente não está na rota do dia e o perfil não tem a ação. */
export const CODIGO_CHECKIN_FORA_DE_ROTA = 'CHECKIN_FORA_DE_ROTA';
export const MENSAGEM_CHECKIN_FORA_DE_ROTA = 'Cliente fora da sua rota de hoje. Peça a liberação ao administrador.';

export const EtapaCheckoutPayloadSchema = z
  .object({
    modulo: z.string().regex(/^[a-z][a-z0-9-]*$/),
    etapa: z.string().regex(/^[a-z][a-z0-9_.-]*$/),
    situacao: z.enum(['concluida', 'dispensada']),
    referencia_id: z.string().nullable().optional(),
  })
  .strict();

export const CheckoutVisitaSchema = z
  .object({
    id: z.string().uuid(),
    visita_id: z.string().uuid(),
    checkout_em: z.string().datetime(),
    lat: z.number().min(-90).max(90).nullable().optional(),
    lng: z.number().min(-180).max(180).nullable().optional(),
    resultado: z.enum(RESULTADOS_VISITA),
    motivo_id: z.string().uuid().nullable().optional(),
    motivo_texto: z.string().max(500).nullable().optional(),
    pedido_id: z.string().uuid().nullable().optional(),
    foto_fachada_id: z.string().uuid().nullable().optional(),
    etapas: z.array(EtapaCheckoutPayloadSchema).max(20).default([]),
  })
  .strict()
  .superRefine((v, ctx) => {
    const falta = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    const temMotivo = Boolean(v.motivo_id) || Boolean(v.motivo_texto?.trim());
    if (v.resultado === 'cliente_fechado') {
      if (!v.motivo_id) falta('motivo_id', 'Cliente fechado exige o motivo (loja fechada ou acesso negado).');
      if (!v.foto_fachada_id) falta('foto_fachada_id', 'Cliente fechado exige a foto da fachada. Tire a foto e conclua o checkout de novo.');
    }
    if (v.resultado === 'pedido' && !v.pedido_id) falta('pedido_id', 'Resultado com pedido exige o pedido feito na visita.');
    if (v.resultado === 'sem_pedido' && !temMotivo) falta('motivo_id', 'Informe o motivo de não venda.');
  });
export type CheckoutVisita = z.infer<typeof CheckoutVisitaSchema>;

const Data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(ehDataCivil, 'Data inexistente no calendário. Informe uma data válida (AAAA-MM-DD).');

/** `GET visitas` (BKO): sem datas, os últimos 7 dias. */
export const VisitasQuerySchema = z
  .object({
    usuario_id: z.string().uuid().optional(),
    cliente_id: z.string().uuid().optional(),
    de: Data.optional(),
    ate: Data.optional(),
    fora_do_raio: z.enum(['true', 'false']).optional(),
    limite: z.coerce.number().int().min(1).max(1000).optional(),
  })
  .strict();
export type VisitasQuery = z.infer<typeof VisitasQuerySchema>;

export const VisitaBkoSchema = z.object({
  id: z.string().uuid(),
  usuario_id: z.string().uuid(),
  usuario_nome: z.string(),
  cliente_id: z.string().uuid(),
  cliente_nome: z.string(),
  data_local: Data,
  checkin_em: z.string(),
  checkout_em: z.string().nullable(),
  fora_do_raio: z.boolean(),
  distancia_m: z.number().nullable(),
  justificativa_fora_raio: z.string().nullable(),
  sem_gps: z.boolean(),
  sugere_coordenada: z.boolean(),
  extra: z.boolean(),
  resultado: z.string().nullable(),
  fechada_por: z.string().nullable(),
  motivo_codigo: z.string().nullable(),
  motivo_descricao: z.string().nullable(),
  motivo_texto: z.string().nullable(),
  foto_fachada_id: z.string().uuid().nullable(),
  etapas: z.array(z.object({ modulo: z.string(), etapa: z.string(), situacao: z.string() })),
});
export type VisitaBko = z.infer<typeof VisitaBkoSchema>;
export const VisitasListaSchema = z.object({ itens: z.array(VisitaBkoSchema) });
export type VisitasLista = z.infer<typeof VisitasListaSchema>;

/** `PUT motivos/:id` (cadastro de motivos). Motivo de sistema não muda (RN-CORE-14). */
export const MotivoPutSchema = z
  .object({
    tipo: z.enum(['nao_venda', 'cliente_fechado', 'fora_do_raio']),
    codigo: z.string().regex(/^[a-z][a-z0-9_]*$/, 'Use só letras minúsculas, números e _ (começando por letra).').max(60),
    descricao: z.string().trim().min(2).max(120),
    exige_foto: z.boolean().default(false),
    ativo: z.boolean().default(true),
    ordem: z.number().int().min(0).max(9999).default(0),
  })
  .strict();
export type MotivoPut = z.infer<typeof MotivoPutSchema>;

/** `GET coordenadas-sugeridas`: clientes sem coordenada com check-ins que a sugeriram (RN-CORE-10). */
export const CoordenadaSugeridaSchema = z.object({
  cliente_id: z.string().uuid(),
  cliente_nome: z.string(),
  cidade: z.string().nullable(),
  /** T-0191: o cliente já tem coordenada gerada pelo endereço (o check-in aprovado a substitui); o botão "Gerar coordenada" não se aplica. */
  geocodificada: z.boolean().optional(),
  /** T-0191 D7: o cadastro tem rua ou CEP (`enderecoPermiteGerar`, calculado na API); sem isso a tela mostra o aviso no lugar do botão. */
  pode_gerar: z.boolean().optional(),
  /** T-0191 D8: o endereço atual é o da última tentativa (`geocodificacao_chave`); sem botão, só o texto vermelho. */
  ja_tentado: z.boolean().optional(),
  visitas: z.array(z.object({ visita_id: z.string().uuid(), usuario_nome: z.string(), checkin_em: z.string(), lat: z.number(), lng: z.number(), precisao_m: z.number().nullable() })),
});
export const CoordenadasSugeridasSchema = z.object({ itens: z.array(CoordenadaSugeridaSchema) });
export type CoordenadasSugeridas = z.infer<typeof CoordenadasSugeridasSchema>;

export const AprovarCoordenadaSchema = z.object({ visita_id: z.string().uuid() }).strict();
export type AprovarCoordenada = z.infer<typeof AprovarCoordenadaSchema>;

/**
 * T-0191 / RN-CORE-77: `POST /v1/core/clientes/:id/coordenada/gerar` (ação `cliente.aprovar_coordenada`), um clique por cliente sem
 * coordenada. 200 com a coordenada gravada (`coordenada_origem = 'geocodificacao'`); 422 `NAO_LOCALIZADO` (só cidade ou nada; a
 * tentativa fica registrada), `JA_TENTADO` (o endereço e o CEP não mudaram desde a última tentativa) e `JA_TEM_COORDENADA` (nunca
 * sobrescreve); 503 `GEOCODIFICADOR_INDISPONIVEL` (a tentativa não é gravada).
 */
export const PRECISOES_COORDENADA = ['numero', 'rua', 'cep'] as const;
export const GerarCoordenadaRespostaSchema = z.object({
  cliente_id: z.string().uuid(),
  lat: z.number(),
  lng: z.number(),
  precisao: z.enum(PRECISOES_COORDENADA),
});
export type GerarCoordenadaResposta = z.infer<typeof GerarCoordenadaRespostaSchema>;
export const CODIGOS_GERAR_COORDENADA = ['NAO_LOCALIZADO', 'JA_TENTADO', 'JA_TEM_COORDENADA'] as const;
