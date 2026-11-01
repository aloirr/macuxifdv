/**
 * Superfície HTTP do Hub `/integracao/v1` voltada ao Conector (T-0025): cabeçalhos, erro padrão, parâmetros e a tabela de rotas.
 * Fonte da verdade para a API (`modules/integracao/api`), o Conector e o OpenAPI publicado.
 *
 * Autenticação: chave de API por Conector (`Authorization: Bearer <chave>`) + `X-Macuxi-Conector-Id`. O `tenant_id` deriva da
 * chave, NUNCA do corpo, da query ou de cabeçalho. Tudo aqui é adição compatível com `v1` (RN-INT-09).
 */
import { z } from 'zod';
import { CABECALHO_CONECTOR_ID, CABECALHO_CONECTOR_VERSAO, RespostaSinal, SinalConector } from './conector';
import { Uuid } from './base';
import { Entidade } from './entidades';
import { CursorEntidade, LoteAceito, LoteEnvelope, LoteResultado, ReconciliacaoEnvio } from './lote';
import { PedidosPendentes, RetornoAceito, RetornoErp } from './pedido';

export const CABECALHO_IDEMPOTENCIA = 'Idempotency-Key';
/** Resposta de repetição: o Hub devolve o lote que já existia para a chave (`Idempotent-Replay: true`). */
export const CABECALHO_REPLAY = 'Idempotent-Replay';

/** Identificador do Conector (o mesmo de `hub.conectorId` no arquivo do Conector): letras, números, `.`, `-` e `_`. */
export const ConectorIdentificador = z
  .string()
  .min(1, 'informe o identificador do Conector')
  .max(100)
  .regex(/^[A-Za-z0-9._-]+$/, 'o identificador aceita letras, números, ponto, hífen e sublinhado');
export type ConectorIdentificador = z.infer<typeof ConectorIdentificador>;

/** Chave de idempotência do lote: o Conector envia o SHA-256 hex (64); o Hub aceita 16 a 128 caracteres seguros. */
export const ChaveIdempotencia = z
  .string()
  .regex(/^[A-Za-z0-9._:-]{16,128}$/, 'Idempotency-Key deve ter de 16 a 128 caracteres (letras, números, ponto, hífen, sublinhado e dois-pontos)');
export type ChaveIdempotencia = z.infer<typeof ChaveIdempotencia>;

/** Limites de tamanho do cabeçalho `Authorization: Bearer <chave>` (a chave tem de 16 a 512 caracteres, sem espaço). */
export const REGEX_BEARER = /^Bearer \S{16,512}$/;

/** Cabeçalhos de toda chamada do Conector (nomes em minúsculas, como o Fastify entrega). */
export const CabecalhosConector = z.object({
  authorization: z.string({ required_error: 'Authorization é obrigatório' }).regex(REGEX_BEARER, 'Authorization deve ser "Bearer <chave de API>"'),
  [CABECALHO_CONECTOR_ID.toLowerCase()]: ConectorIdentificador,
  /** Versão do Conector (semver). Ausente ou ilegível NÃO bloqueia (só a versão legível abaixo da mínima bloqueia). */
  [CABECALHO_CONECTOR_VERSAO.toLowerCase()]: z.string().max(40).optional(),
});
export type CabecalhosConector = z.infer<typeof CabecalhosConector>;

export const CabecalhosEnvioLote = CabecalhosConector.extend({
  [CABECALHO_IDEMPOTENCIA.toLowerCase()]: ChaveIdempotencia,
});
export type CabecalhosEnvioLote = z.infer<typeof CabecalhosEnvioLote>;

/** Códigos de erro do Hub com o HTTP de cada um. Os de envelope/retorno ficam em `lote.ts` / abaixo. */
export const STATUS_HTTP_ERRO_HUB = {
  requisicao_invalida: 400,
  credencial_invalida: 401,
  acesso_negado: 403,
  modulo_inativo: 403,
  lote_nao_encontrado: 404,
  entidade_desconhecida: 404,
  conflito: 409,
  corpo_grande: 413,
  recusa_de_retorno: 422,
  versao_conector_nao_suportada: 426,
  limite_de_taxa: 429,
  servico_indisponivel: 503,
} as const;
export type CodigoErroHub = keyof typeof STATUS_HTTP_ERRO_HUB;

/**
 * Erro padrão do Hub (igual ao `ErroApi` da plataforma: `{ codigo, mensagem, detalhes? }`). `detalhes` nunca leva dado pessoal,
 * valor de linha nem segredo. Em recusas de lote/retorno o corpo também leva `erros[]` (ver `RecusaLote` e `RecusaRetorno`).
 */
export const ErroHub = z.object({
  codigo: z.string().min(1),
  mensagem: z.string().min(1),
  detalhes: z.record(z.unknown()).nullish(),
  /** `requisicao_id` do rastreio nos logs do Hub (para o suporte). */
  requisicao_id: z.string().nullish(),
});
export type ErroHub = z.infer<typeof ErroHub>;

/**
 * Recusa de `POST /lotes` (400/409/413/422/426): `RecusaEnvelope` (`erros[]`, o que o Conector v1.1 lê) mais `codigo`/`mensagem`
 * no topo, para o erro padrão. Sem lote criado, exceto na repetição de chave (que não é recusa).
 */
export const RecusaLote = z.object({
  codigo: z.string().min(1),
  mensagem: z.string().min(1),
  erros: z.array(z.object({ codigo: z.string().min(1), campo: z.string().nullable(), mensagem: z.string().min(1) })).min(1),
  requisicao_id: z.string().nullish(),
});
export type RecusaLote = z.infer<typeof RecusaLote>;

/**
 * Códigos de recusa do retorno do pedido (HTTP 422, definitivo para o Conector: não é reenviado). RN-INT-08.
 * `itens_faturados_invalidos`: **não é mais emitido** desde a T-0031 (P-4: o retorno é aceito sem os itens inválidos, que voltam
 * em `RetornoAceito.itens_descartados`). Fica no enum só por compatibilidade com quem já o conhece (RN-INT-09); sai na `/v2`.
 */
export const CODIGOS_RECUSA_RETORNO = [
  'pedido_desconhecido',
  'pedido_nao_entregue',
  'transicao_invalida',
  'numero_erp_divergente',
  'itens_faturados_invalidos',
] as const;
export const CodigoRecusaRetorno = z.enum(CODIGOS_RECUSA_RETORNO);
export type CodigoRecusaRetorno = z.infer<typeof CodigoRecusaRetorno>;

export const RecusaRetorno = z.object({
  codigo: CodigoRecusaRetorno,
  mensagem: z.string().min(1),
  erros: z.array(z.object({ codigo: z.string().min(1), campo: z.string().nullable(), mensagem: z.string().min(1) })).min(1),
  requisicao_id: z.string().nullish(),
});
export type RecusaRetorno = z.infer<typeof RecusaRetorno>;

/** Parâmetros de rota e query. */
export const ParamsLote = z.object({ id: Uuid });
export const ParamsEntidade = z.object({ entidade: Entidade });
export const ParamsPedido = z.object({ pedido_uuid: Uuid });

/** `GET /lotes/{id}?limite_erros=`: quantos erros devolver (as linhas com `falha_processamento` vêm primeiro). */
export const LIMITE_ERROS_RESPOSTA_PADRAO = 1000;
export const LIMITE_ERROS_RESPOSTA_MAX = 5500;
export const QueryConsultaLote = z.object({
  limite_erros: z.coerce.number().int().min(0).max(LIMITE_ERROS_RESPOSTA_MAX).default(LIMITE_ERROS_RESPOSTA_PADRAO),
});

/** `GET /pedidos/pendentes?limite=`. */
export const LIMITE_PEDIDOS_POLL_PADRAO = 50;
export const QueryPedidosPendentes = z.object({
  limite: z.coerce.number().int().min(1).max(100).default(LIMITE_PEDIDOS_POLL_PADRAO),
});

/** Resposta de `POST /reconciliacoes` (200; reenviar o mesmo dia substitui o anterior). O Conector não lê o corpo, só o status. */
export const RespostaReconciliacao = z.object({
  /** `pendente` = ainda há lote da entidade em aberto; a comparação definitiva sai quando eles terminam (resultado provisório aqui). */
  situacao: z.enum(['comparada', 'pendente']).default('comparada'),
  entidade: Entidade,
  data_referencia: z.string(),
  divergente: z.boolean(),
  motivos: z.array(z.enum(['contagem_divergente', 'soma_divergente', 'soma_ausente'])),
  contagem: z.object({ erp: z.number(), macuxi: z.number(), diferenca: z.number(), dentro: z.boolean() }),
  soma: z
    .object({
      erp: z.number().nullable(),
      macuxi: z.number().nullable(),
      diferenca: z.number(),
      diferenca_pct: z.number().nullable(),
      dentro: z.boolean(),
    })
    .nullable(),
});
export type RespostaReconciliacao = z.infer<typeof RespostaReconciliacao>;

export type MetodoHub = 'GET' | 'POST';

export interface RotaHub {
  id: string;
  metodo: MetodoHub;
  /** Relativo a `/integracao/v1`. */
  caminho: string;
  resumo: string;
  cabecalhos: z.ZodTypeAny;
  params?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  corpo?: z.ZodTypeAny;
  /** Status e schema do sucesso (para o OpenAPI). */
  sucesso: { status: number; schema: z.ZodTypeAny };
  /** Outros status que a rota pode devolver (os de autenticação 401/403, 429 e 5xx valem para todas). */
  erros: readonly number[];
  /** `true`: a rota continua liberada quando o Conector está abaixo da versão mínima (só o sinal de vida). */
  liberadaAbaixoDaMinima?: boolean;
}

/** As rotas do Conector. Mudou aqui = mudou o contrato (RN-INT-09); `docs/modulos/integracao/hub-api.md` lista as mesmas. */
export const ROTAS_HUB: readonly RotaHub[] = [
  {
    id: 'enviar_lote',
    metodo: 'POST',
    caminho: '/lotes',
    resumo: 'Envia um lote de uma entidade (completo ou delta); processamento assíncrono. Idempotente pela Idempotency-Key.',
    cabecalhos: CabecalhosEnvioLote,
    corpo: LoteEnvelope,
    sucesso: { status: 202, schema: LoteAceito },
    erros: [400, 409, 413, 422, 426],
  },
  {
    id: 'consultar_lote',
    metodo: 'GET',
    caminho: '/lotes/{id}',
    resumo: 'Resultado do lote com os erros por linha.',
    cabecalhos: CabecalhosConector,
    params: ParamsLote,
    query: QueryConsultaLote,
    sucesso: { status: 200, schema: LoteResultado },
    erros: [404, 426],
  },
  {
    id: 'consultar_cursor',
    metodo: 'GET',
    caminho: '/cursores/{entidade}',
    resumo: 'De onde o Conector continua o delta (cursor nulo = carga inicial completa).',
    cabecalhos: CabecalhosConector,
    params: ParamsEntidade,
    sucesso: { status: 200, schema: CursorEntidade },
    erros: [404, 426],
  },
  {
    id: 'enviar_reconciliacao',
    metodo: 'POST',
    caminho: '/reconciliacoes',
    resumo: 'Contagem e soma de controle do dia, por entidade (RN-INT-07).',
    cabecalhos: CabecalhosConector,
    corpo: ReconciliacaoEnvio,
    sucesso: { status: 200, schema: RespostaReconciliacao },
    erros: [400, 422, 426],
  },
  {
    id: 'pedidos_pendentes',
    metodo: 'GET',
    caminho: '/pedidos/pendentes',
    resumo: 'Pedidos aprovados para gravar no ERP; o Hub marca como enviado o que entrega (RN-INT-08).',
    cabecalhos: CabecalhosConector,
    query: QueryPedidosPendentes,
    sucesso: { status: 200, schema: PedidosPendentes },
    erros: [426],
  },
  {
    id: 'retorno_pedido',
    metodo: 'POST',
    caminho: '/pedidos/{pedido_uuid}/retorno',
    resumo: 'Retorno do ERP: número, rejeição, faturamento (com itens) ou cancelamento. Idempotente (RN-INT-08).',
    cabecalhos: CabecalhosConector,
    params: ParamsPedido,
    corpo: RetornoErp,
    sucesso: { status: 200, schema: RetornoAceito },
    erros: [400, 422, 426],
  },
  {
    id: 'sinal',
    metodo: 'POST',
    caminho: '/sinal',
    resumo: 'Sinal de vida (1 min); responde com a política de versão do tenant.',
    cabecalhos: CabecalhosConector,
    corpo: SinalConector,
    sucesso: { status: 200, schema: RespostaSinal },
    erros: [400],
    liberadaAbaixoDaMinima: true,
  },
] as const;

export const IDS_ROTAS_HUB = ROTAS_HUB.map((r) => r.id);
