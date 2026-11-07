/**
 * Modelos de arquivo da carga por CSV (RF-INT-03): `GET /v1/integracao/modelos/:entidade.csv` (CSV de exemplo) e
 * `GET /v1/integracao/modelos/:entidade/dicionario` (JSON abaixo). Tudo derivado de `SCHEMA_REGISTRO`: mudou o contrato, muda o modelo.
 */
import { z } from 'zod';
import { Entidade } from './entidades';

/** O segmento da URL (`cliente` em `cliente.csv`/`cliente/dicionario`): conferido no handler para devolver 404 `ENTIDADE_DESCONHECIDA` com a lista. */
export const ParamsModelo = z.object({ entidade: z.string().trim().min(1).max(60) });
export type ParamsModelo = z.infer<typeof ParamsModelo>;

export const TIPOS_CAMPO_DICIONARIO = ['texto', 'número', 'sim/não', 'data', 'data-hora', 'centavos', 'enum', 'lista de números', 'lista de textos'] as const;

export const CampoDicionario = z.object({
  /** Nome da coluna no cabeçalho (`external_id`, `endereco.cidade`…). */
  campo: z.string(),
  /** O arquivo precisa ter a coluna e a célula preenchida. */
  obrigatorio: z.boolean(),
  tipo: z.enum(TIPOS_CAMPO_DICIONARIO),
  /** Máximo de caracteres (texto); `null` = sem limite declarado. */
  tamanho_max: z.number().int().nullable(),
  /** Regra do valor em português ("AAAA-MM-DD", "8, 12, 13 ou 14 dígitos", opções do enum, "inteiro de 1 a 8"). */
  formato: z.string().nullable(),
  /** Exemplo exatamente como aparece no CSV. */
  exemplo: z.string(),
  /** Observação (valor assumido quando vazio, regra entre campos). */
  observacao: z.string().nullable(),
});
export type CampoDicionario = z.infer<typeof CampoDicionario>;

export const DicionarioModelo = z.object({
  entidade: Entidade,
  /** Nome do arquivo do modelo (`cliente.csv`). */
  arquivo: z.string(),
  /** Posição (1 = primeira) na ordem de carga do Hub. */
  ordem: z.number().int().positive(),
  /** Entidades que devem ser carregadas antes (dependências diretas, RN-INT-04). */
  depende_de: z.array(Entidade),
  /** Pode ficar para depois (título, nota): a operação do vendedor não depende dela. */
  opcional: z.boolean(),
  campos: z.array(CampoDicionario),
});
export type DicionarioModelo = z.infer<typeof DicionarioModelo>;
