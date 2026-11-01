/**
 * Envelope de lote, respostas e erros por linha do Hub (RF-INT-01, RN-INT-01/03/05/06).
 * O envelope valida só o cabeçalho; cada registro é validado depois, linha a linha, com
 * `SCHEMA_REGISTRO[entidade]` — por isso `registros` é `unknown[]` aqui.
 */
import { z } from 'zod';
import { DataCivil, DataHoraUtc, ExternalId, LIMITE_REGISTROS_LOTE, Uuid } from './base';
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

/** Padrão de linhas inválidas informadas por lote (decisão do Alexandre, T-0023); o Conector parametriza até `LIMITE_REGISTROS_LOTE`. */
export const LIMITE_LINHAS_INVALIDAS_PADRAO = 500;

/**
 * Linha que o Conector não conseguiu mapear ou que não passou na validação local (RN-INT-03). Vai ao Hub com o motivo, SEM o
 * valor da linha (nem dado pessoal): o BKO mostra `external_id`, campo e mensagem. Códigos iguais aos de `LinhaErro`.
 */
export const LinhaInvalidaConector = z.object({
  external_id: z.string().max(200).nullish(),
  codigo: z.enum([
    'registro_invalido',
    'campo_obrigatorio',
    'tipo_invalido',
    'formato_invalido',
    'valor_fora_da_faixa',
    'valor_nao_permitido',
    'regra_invalida',
  ]),
  campo: z.string().max(100).nullish(),
  mensagem: z.string().min(1).max(300),
});
export type LinhaInvalidaConector = z.infer<typeof LinhaInvalidaConector>;

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
  /** Identificador do Conector (o mesmo do cabeçalho `X-Macuxi-Conector-Id`). Informativo; o Hub confia na credencial. */
  conector_id: z.string().min(1).max(100).nullish(),
  /** Versão do Conector que montou o lote (semver, ex.: `1.1.0`); ver `conector.ts` (política de versão). */
  versao_conector: z.string().min(1).max(40).nullish(),
  /**
   * Linhas que o Conector recusou localmente, com o motivo (no máximo [500] por lote, parametrizável). Campo opcional novo:
   * compatível com `v1` (RN-INT-09). Não substitui `registros`: o lote continua precisando de pelo menos 1 registro.
   */
  linhas_invalidas: z.array(LinhaInvalidaConector).max(LIMITE_REGISTROS_LOTE).nullish(),
  /** Quantas linhas inválidas passaram do limite e foram contadas sem detalhe (só a contagem). */
  linhas_invalidas_omitidas: z.number().int().nonnegative().nullish(),
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
  /** Linhas lidas pelo Conector neste lote: `registros` + `linhas_invalidas` + `linhas_invalidas_omitidas` (sempre >= 1). */
  recebidos: z.number().int().positive(),
  /** `true` quando a `Idempotency-Key` já tinha um lote: é a MESMA resposta de antes, sem reprocessar (T-0025). */
  repetido: z.boolean().nullish(),
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
  // T-0025 (valores novos de enum: compatíveis com `v1`, RN-INT-09). O Conector v1.1 que não os conhece cai em `http_<status>`.
  'chave_idempotencia_invalida',
  'chave_idempotencia_reutilizada',
  'corpo_grande',
  'versao_conector_nao_suportada',
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
  /** `conector` = linha informada pelo Conector em `linhas_invalidas`; ausente = validada pelo Hub. */
  origem: z.enum(['hub', 'conector']).nullish(),
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
  /** RN-INT-06: versão mais antiga que o registro atual (reenvio antigo/reprocessamento); não grava nem publica. Campo novo, compatível com `v1`. */
  obsoletas: z.number().int().nonnegative().default(0),
});
export type ContagensLote = z.infer<typeof ContagensLote>;

/**
 * Situação da inativação da carga completa no resultado do último lote da sessão (RN-INT-06). Campo opcional novo
 * (compatível com `v1`); é o formato que o Conector v1.1 já espera (`apps/conector/src/hub/tipos.ts`).
 */
export const InativacaoLote = z.object({
  situacao: z.enum(['aplicada', 'aguardando_confirmacao', 'nao_aplicavel']),
  /** Texto curto para o operador (ex.: `excede_limite_inativacao`). */
  motivo: z.string().nullish(),
  /** Quantos registros seriam (ou foram) inativados. */
  candidatos: z.number().int().nonnegative().nullish(),
  /** `candidatos` em % dos ativos (informativo, para o aviso do operador). */
  percentual: z.number().nonnegative().nullish(),
});
export type InativacaoLote = z.infer<typeof InativacaoLote>;

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
  /** Linhas inválidas do Conector que passaram do limite do lote e só foram contadas (campo opcional novo). */
  invalidas_omitidas: z.number().int().nonnegative().nullish(),
  /** Total de linhas com erro do lote e quantas ficaram de fora de `erros` pelo limite da resposta (campos opcionais novos). */
  erros_total: z.number().int().nonnegative().nullish(),
  erros_omitidos: z.number().int().nonnegative().nullish(),
  /** Trava de inativação em massa (RN-INT-06); presente no resultado do último lote da sessão completa. */
  inativacao: InativacaoLote.nullish(),
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
