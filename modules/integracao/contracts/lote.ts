/**
 * Envelope de lote, respostas e erros por linha do Hub (RF-INT-01, RN-INT-01/03/05/06).
 * O envelope valida só o cabeçalho; cada registro é validado depois, linha a linha, com
 * `SCHEMA_REGISTRO[entidade]` — por isso `registros` é `unknown[]` aqui.
 */
import { z } from 'zod';
import { DataCivil, DataHoraUtc, ExternalId, Uuid } from './base';
import { Entidade } from './entidades';

export const ModoCarga = z.enum(['completo', 'delta']);
export type ModoCarga = z.infer<typeof ModoCarga>;

/** Cursor de delta: maior par (`alterado_em`, `external_id`) das linhas aceitas (RN-INT-05). */
export const Cursor = z.object({
  alterado_em: DataHoraUtc,
  external_id: ExternalId,
});
export type Cursor = z.infer<typeof Cursor>;

/** Sessão de carga completa (RN-INT-06): vários lotes; `ultimo` = true fecha a sessão. */
export const SessaoCarga = z.object({
  id: Uuid,
  parte: z.number().int().positive(),
  ultimo: z.boolean(),
});
export type SessaoCarga = z.infer<typeof SessaoCarga>;

export const LoteEnvelope = z.object({
  versao_contrato: z.string().min(1, 'versao_contrato é obrigatória'),
  entidade: z.string().min(1, 'entidade é obrigatória'),
  modo: ModoCarga,
  /** Obrigatória no modo completo; não se aplica ao delta. */
  sessao: SessaoCarga.nullish(),
  /** Cursor declarado pelo Conector (maior par do lote). Informativo; o Hub recalcula (RN-INT-05). */
  cursor: Cursor.nullish(),
  /** Instante em que o Conector montou o lote. */
  enviado_em: DataHoraUtc.nullish(),
  registros: z.array(z.unknown(), { required_error: 'registros é obrigatório', invalid_type_error: 'registros deve ser uma lista' }),
});
export type LoteEnvelope = z.infer<typeof LoteEnvelope>;

/** Envelope já validado: entidade conhecida e versão suportada. */
export type LoteEnvelopeValido = Omit<LoteEnvelope, 'entidade'> & { entidade: Entidade };

export const ESTADOS_LOTE = ['recebido', 'processando', 'concluido', 'concluido_com_erros', 'falhou'] as const;
export const EstadoLote = z.enum(ESTADOS_LOTE);
export type EstadoLote = z.infer<typeof EstadoLote>;

/** Resposta 202 de `POST /integracao/v1/lotes` (processamento assíncrono). */
export const LoteAceito = z.object({
  lote_id: Uuid,
  status: z.literal('recebido'),
  entidade: Entidade,
  modo: ModoCarga,
  recebidos: z.number().int().positive(),
  /** Onde consultar o resultado: `GET /integracao/v1/lotes/{lote_id}`. */
  consulta: z.string(),
});
export type LoteAceito = z.infer<typeof LoteAceito>;

/** Recusa do envelope inteiro (HTTP 400/413/422), sem lote criado (RN-INT-01). */
export const CODIGOS_ERRO_ENVELOPE = [
  'envelope_invalido',
  'versao_nao_suportada',
  'entidade_desconhecida',
  'lote_vazio',
  'acima_do_limite',
  'sessao_ausente',
  'sessao_nao_se_aplica',
] as const;
export const CodigoErroEnvelope = z.enum(CODIGOS_ERRO_ENVELOPE);
export type CodigoErroEnvelope = z.infer<typeof CodigoErroEnvelope>;

export const ErroEnvelope = z.object({
  codigo: CodigoErroEnvelope,
  campo: z.string().nullable(),
  mensagem: z.string(),
});
export type ErroEnvelope = z.infer<typeof ErroEnvelope>;

export const RecusaEnvelope = z.object({ erros: z.array(ErroEnvelope).min(1) });
export type RecusaEnvelope = z.infer<typeof RecusaEnvelope>;

/** Códigos de erro por linha (RN-INT-03). Os dois últimos são reprocessáveis sem reenvio corrigido. */
export const CODIGOS_ERRO_LINHA = [
  'registro_invalido',
  'external_id_invalido',
  'campo_obrigatorio',
  'tipo_invalido',
  'formato_invalido',
  'valor_fora_da_faixa',
  'valor_nao_permitido',
  'campo_desconhecido',
  'regra_invalida',
  'referencia_ausente',
  'falha_processamento',
] as const;
export const CodigoErroLinha = z.enum(CODIGOS_ERRO_LINHA);
export type CodigoErroLinha = z.infer<typeof CodigoErroLinha>;

/** Linha com erro (`lote_linha_erro`): mensagem legível no BKO, sem valor de dado pessoal. */
export const LinhaErro = z.object({
  /** Posição da linha no lote, base 0. */
  indice: z.number().int().nonnegative(),
  external_id: z.string().nullable(),
  codigo: CodigoErroLinha,
  campo: z.string().nullable(),
  mensagem: z.string(),
  reprocessavel: z.boolean(),
});
export type LinhaErro = z.infer<typeof LinhaErro>;

export const CODIGOS_AVISO_LINHA = ['duplicado_no_lote'] as const;
export const AvisoLinha = z.object({
  indice: z.number().int().nonnegative(),
  external_id: z.string(),
  codigo: z.enum(CODIGOS_AVISO_LINHA),
  mensagem: z.string(),
});
export type AvisoLinha = z.infer<typeof AvisoLinha>;

export const ContagensLote = z.object({
  recebidas: z.number().int().nonnegative(),
  duplicadas_no_lote: z.number().int().nonnegative(),
  com_erro: z.number().int().nonnegative(),
  novas: z.number().int().nonnegative(),
  atualizadas: z.number().int().nonnegative(),
  inalteradas: z.number().int().nonnegative(),
});
export type ContagensLote = z.infer<typeof ContagensLote>;

/** Resultado de `GET /integracao/v1/lotes/{id}` (RF-INT-04: monitor no BKO). */
export const LoteResultado = z.object({
  lote_id: Uuid,
  entidade: Entidade,
  modo: ModoCarga,
  status: EstadoLote,
  contagens: ContagensLote,
  erros: z.array(LinhaErro),
  avisos: z.array(AvisoLinha),
  /** Cursor da entidade depois do lote (só avança em `concluido`/`concluido_com_erros`). */
  cursor: Cursor.nullable(),
  /** Registros inativados ao fechar a sessão de carga completa (RN-INT-06). */
  inativadas: z.number().int().nonnegative().default(0),
  recebido_em: DataHoraUtc,
  concluido_em: DataHoraUtc.nullable(),
});
export type LoteResultado = z.infer<typeof LoteResultado>;

/** `GET /integracao/v1/cursores/{entidade}`: de onde o Conector deve continuar o delta. */
export const CursorEntidade = z.object({
  entidade: Entidade,
  cursor: Cursor.nullable(),
  atualizado_em: DataHoraUtc.nullable(),
});
export type CursorEntidade = z.infer<typeof CursorEntidade>;

/** Reconciliação diária (RF-INT-06, RN-INT-07): o Conector informa contagem e soma por entidade. */
export const ReconciliacaoEnvio = z.object({
  versao_contrato: z.string().min(1),
  entidade: Entidade,
  data_referencia: DataCivil,
  /** Registros ativos no ERP. */
  contagem: z.number().int().nonnegative(),
  /** Soma de controle (centavos ou quantidade); `null` onde a entidade só tem contagem. */
  soma: z.number().finite().nullable(),
});
export type ReconciliacaoEnvio = z.infer<typeof ReconciliacaoEnvio>;
