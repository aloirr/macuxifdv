/**
 * Carga por arquivo (RF-INT-03): `POST /v1/integracao/cargas-arquivo` (BKO, JWT, ação `carga.arquivo`: admin e analista).
 * O CSV vai como TEXTO no corpo JSON (`conteudo`) — a plataforma só lê JSON nas rotas de módulo. O arquivo vira o envelope canônico
 * de um lote do Conector do tipo `arquivo` e segue o pipeline do Hub (staging → aplicação → eventos). Colunas = campos de
 * `SCHEMA_REGISTRO[entidade]` (ver `docs/modulos/integracao/carga-arquivo.md`).
 */
import { z } from 'zod';
import { LoteAceito } from './lote';

export const CargaArquivoEntrada = z.object({
  /** Entidade do contrato canônico (`cliente`, `produto`…). Conferida no módulo (422 `entidade_desconhecida` lista as válidas). */
  entidade: z.string({ required_error: 'entidade é obrigatória' }).trim().min(1, 'entidade é obrigatória').max(40),
  /** `delta` (padrão) ou `completo`. Conferido no módulo (422 `modo_invalido`). */
  modo: z.string().trim().max(20).optional(),
  /** Texto do CSV (UTF-8, com ou sem BOM). Limite de linhas e de bytes iguais aos do lote. */
  conteudo: z.string({ required_error: 'conteudo é obrigatório' }).min(1, 'O arquivo está vazio.'),
  /**
   * RN-INT-12: a `Idempotency-Key` desta carga (16 a 128 caracteres seguros). Obrigatória — conferida no módulo (422
   * `chave_idempotencia_invalida`) com a mesma regra do `POST /lotes`; vai no corpo porque a rota de usuário não expõe cabeçalhos.
   */
  chave_idempotencia: z.string().max(200).optional(),
  /** Identificador do Conector do tipo arquivo; omitido = o único Conector arquivo ativo que recebe a entidade. */
  conector_id: z.string().trim().min(1).max(100).optional(),
});
export type CargaArquivoEntrada = z.infer<typeof CargaArquivoEntrada>;

/** 202: o lote foi recebido e será aplicado em segundo plano; acompanhe em `consulta` (resultado e erros por linha do arquivo). */
export const CargaArquivoAceita = LoteAceito.extend({
  /** Identificador do Conector arquivo dono do lote. */
  conector_id: z.string(),
  /** Linhas de dados lidas do arquivo (válidas + com erro de leitura). */
  linhas_lidas: z.number().int().positive(),
  /** Linhas que já nasceram inválidas na leitura (valor que não converte etc.): aparecem como erro, com a linha do arquivo, quando o lote é aplicado. */
  linhas_invalidas_leitura: z.number().int().nonnegative(),
});
export type CargaArquivoAceita = z.infer<typeof CargaArquivoAceita>;
