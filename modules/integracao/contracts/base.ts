/**
 * Primitivas do contrato canônico do Hub `/integracao/v1` (RN-INT-09).
 *
 * - dinheiro em centavos inteiros, sufixo `_cents` (igual ao Core);
 * - datas-hora ISO 8601 em UTC, sempre com `Z` (`2026-10-31T14:00:00Z`); datas civis `AAAA-MM-DD`;
 * - `external_id` obrigatório em todo registro (chave do registro no ERP);
 * - campo novo **opcional** é compatível; qualquer outra mudança vira `/v2` com ADR.
 * Os objetos NÃO são `strict`: campo desconhecido é ignorado (compatibilidade para frente).
 */
import { z } from 'zod';

export const VERSAO_CONTRATO = 'v1' as const;
export const API_PREFIX_INTEGRACAO = '/integracao/v1';

/** Limite padrão de registros por lote (RN-INT-01); o tenant pode parametrizar. */
export const LIMITE_REGISTROS_LOTE = 5000;
/** Tamanho máximo do `external_id` (aceita chaves compostas como `TAB01:SKU123:DEP2`). */
export const EXTERNAL_ID_MAX = 100;
/** Paradas por rota (cabe no registro sem estourar o corpo do lote). */
export const PARADAS_MAX = 500;
/** Contatos por cliente. */
export const CONTATOS_MAX = 20;

export const ExternalId = z
  .string({ required_error: 'external_id é obrigatório' })
  .trim()
  .min(1, 'external_id é obrigatório')
  .max(EXTERNAL_ID_MAX, `external_id aceita até ${EXTERNAL_ID_MAX} caracteres`);
export type ExternalId = z.infer<typeof ExternalId>;

/** Centavos inteiros (nunca float). */
export const Centavos = z.number().int('valor em centavos deve ser inteiro');
export const CentavosNaoNegativos = Centavos.nonnegative('valor em centavos não pode ser negativo');

/** Instante ISO 8601 em UTC com `Z`. */
export const DataHoraUtc = z.string().datetime({ message: 'data-hora deve ser ISO 8601 em UTC (terminando em Z)' });
export type DataHoraUtc = z.infer<typeof DataHoraUtc>;

/** Data civil `AAAA-MM-DD` (existente no calendário). */
export const DataCivil = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'data deve estar no formato AAAA-MM-DD')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'data inexistente no calendário');

export const Texto = (max = 200) => z.string().trim().min(1, 'texto não pode ser vazio').max(max, `texto aceita até ${max} caracteres`);
export const TextoOpcional = (max = 200) => z.string().trim().max(max, `texto aceita até ${max} caracteres`).nullish();

/** Quantidade (unidades do ERP). Pode ser fracionária; o ERP define a precisão. */
export const Quantidade = z.number().finite('quantidade deve ser um número finito');

export const Uuid = z.string().uuid('UUID inválido');

/** Campos comuns a todo registro vindo do ERP (RN-INT-02, RN-INT-05, RN-INT-09). */
export const RegistroBase = z.object({
  external_id: ExternalId,
  /** Instante da última alteração no ERP; alimenta o cursor de delta (RN-INT-05). */
  alterado_em: DataHoraUtc,
  /** `false` inativa o registro no Macuxi (nunca apaga). Ausente = ativo. */
  ativo: z.boolean().default(true),
});
