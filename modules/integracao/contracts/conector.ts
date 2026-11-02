/**
 * Contratos do Conector on-premise com o Hub (T-0023): sinal de vida, política de versão e credencial por Conector.
 *
 * - Uma chave de API por Conector (`Authorization: Bearer <chave>`) + identificador do Conector (`X-Macuxi-Conector-Id`),
 *   escopo só `/integracao/v1`, rotacionável sem reinstalar.
 * - O Conector informa a própria versão em todo lote, sinal e chamada (`X-Macuxi-Conector-Versao`). O Hub responde ao sinal
 *   (`POST /integracao/v1/sinal`, a cada minuto) com a política de versão: mínima (abaixo dela o Conector PARA de enviar) e
 *   recomendada (abaixo dela só avisa "desatualizado"). Atualização automática fica para a v2.
 * - Tudo aqui é adição de campos/rota opcionais: compatível com `v1` (RN-INT-09).
 */
import { z } from 'zod';
import { DataHoraUtc, Uuid } from './base';

/** Cabeçalhos que o Conector envia em toda chamada ao Hub. */
export const CABECALHO_CONECTOR_ID = 'X-Macuxi-Conector-Id';
export const CABECALHO_CONECTOR_VERSAO = 'X-Macuxi-Conector-Versao';

/** Semver estrito `MAIOR.MENOR.PATCH` (pré-lançamento opcional: `1.2.0-rc.1`). Metadado de build (`+x`) não é aceito. */
export const REGEX_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
export const VersaoSemver = z.string().regex(REGEX_SEMVER, 'versão deve seguir o formato MAIOR.MENOR.PATCH (ex.: 1.1.0)');
export type VersaoSemver = z.infer<typeof VersaoSemver>;

/** Onde baixar o pacote e como conferi-lo (SHA-256 e assinatura); o Conector só informa, não baixa (v2). */
export const PacoteConector = z.object({
  versao: VersaoSemver,
  url: z.string().url().nullish(),
  /** SHA-256 do arquivo do pacote, 64 hexadecimais minúsculos. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'sha256 deve ter 64 hexadecimais minúsculos'),
  /** Assinatura destacada do pacote (base64) e o id da chave pública que a verifica. */
  assinatura: z.string().min(1).nullish(),
  chave_publica_id: z.string().min(1).max(100).nullish(),
});
export type PacoteConector = z.infer<typeof PacoteConector>;

/**
 * Política de versão do Conector, por tenant (o Hub decide). Invariante: `versao_minima <= versao_recomendada`
 * (a função pura de comparação fica no próprio Conector, em `src/versao.ts`).
 */
export const PoliticaVersaoConector = z.object({
  /** Abaixo dela o Conector para de enviar dados ao Hub e mostra o motivo no `status` e no log. */
  versao_minima: VersaoSemver,
  /** Abaixo dela o Conector segue funcionando e apenas avisa que está desatualizado. */
  versao_recomendada: VersaoSemver,
  /** Texto curto para o operador do cliente (ex.: motivo da mínima ou onde obter o pacote). */
  mensagem: z.string().max(300).nullish(),
  pacote: PacoteConector.nullish(),
});
export type PoliticaVersaoConector = z.infer<typeof PoliticaVersaoConector>;

/** Corpo do `POST /integracao/v1/sinal` (sem dado pessoal). */
export const SinalConector = z.object({
  conector_id: z.string().min(1).max(100),
  versao_conector: VersaoSemver,
  versao_contrato: z.string().min(1),
  em: DataHoraUtc,
  fila: z.array(
    z.object({
      estado: z.string(),
      lotes: z.number().int().nonnegative(),
      linhas: z.number().int().nonnegative(),
      maisAntigo: DataHoraUtc.nullable(),
    }),
  ),
  entidades: z.array(
    z.object({
      entidade: z.string(),
      fase: z.string(),
      ultimo_sucesso: DataHoraUtc.nullable(),
      bloqueada: z.boolean(),
      lotes_na_fila: z.number().int().nonnegative(),
    }),
  ),
  /** O Conector parou de enviar por estar abaixo da versão mínima (o Hub destaca no monitor). */
  parado_por_versao: z.boolean().nullish(),
});
export type SinalConector = z.infer<typeof SinalConector>;

/** Resposta (200) do sinal de vida: a política de versão vigente para este Conector. */
export const RespostaSinal = z.object({
  /** Ausente = sem política cadastrada (nenhuma restrição). */
  politica_versao: PoliticaVersaoConector.nullish(),
  /** Cadastro do Conector no Hub, para conferência (campo informativo). */
  conector_id: z.string().min(1).max(100).nullish(),
  recebido_em: DataHoraUtc.nullish(),
});
export type RespostaSinal = z.infer<typeof RespostaSinal>;

/**
 * Cadastro/rotação de chave por Conector (lado do Hub, BKO). A chave em claro só aparece na criação/rotação, nunca mais.
 * Escopo fixo `integracao.v1`: a chave não abre nenhuma outra rota da API.
 */
export const ESCOPO_CHAVE_CONECTOR = 'integracao.v1' as const;
export const ChaveConectorCriada = z.object({
  conector_id: z.string().min(1).max(100),
  tenant_id: Uuid,
  escopo: z.literal(ESCOPO_CHAVE_CONECTOR),
  /** Mostrada uma única vez. */
  chave: z.string().min(32),
  /** Prefixo não secreto para identificar a chave no BKO e nos logs do Hub. */
  prefixo: z.string().min(4).max(12),
  criada_em: DataHoraUtc,
  /** A chave anterior segue válida até aqui, para o Conector trocar sem interrupção (janela de rotação). */
  anterior_valida_ate: DataHoraUtc.nullish(),
});
export type ChaveConectorCriada = z.infer<typeof ChaveConectorCriada>;

/** RN-INT-11: Conector que recebe pedidos exige 1.2.1 ou mais novo (o 1.2.0 reenvia itens no fechamento sem nota nova). */
export const VERSAO_PISO_PEDIDOS = '1.2.1';

/** Política que vale quando a empresa não gravou nenhuma e o Conector recebe pedidos (RN-INT-11). A linha do tenant sempre manda. */
export const POLITICA_VERSAO_PADRAO_PEDIDOS = {
  versao_minima: VERSAO_PISO_PEDIDOS,
  versao_recomendada: VERSAO_PISO_PEDIDOS,
  mensagem: 'O Conector 1.2.0 ou anterior reenvia itens no fechamento sem nota nova.',
  pacote: null,
} as const satisfies PoliticaVersaoConector;
