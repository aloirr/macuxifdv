/**
 * Cadastros de trade como chegam ao aparelho pelo pull do sync (servidor vence; BKO de trade, RF-PRO-11). T-0056.
 * Formato da LINHA (com `updated_at`, `deleted_at`, `external_id`), igual ao padrão das linhas do Core. A tabela é do
 * banco-dados (schema `promotor`, migração 0015); estes schemas são o contrato que ela precisa servir.
 *
 * Alvo (RN-PRO-10): `cliente_id` = só aquela loja; `segmento` = lojas do segmento/canal (`ClienteSync.segmento` do Core);
 * os dois nulos = todas as lojas do tenant. Vigência por data civil no fuso do tenant (`vigencia_fim` nulo = sem prazo).
 * A coleta grava o id da versão vigente no momento (`*_id` em `coletas.ts`).
 */
import { z } from 'zod';
import { TIPOS_PONTO_EXTRA } from '../domain/pontos-extras';
import { IsoDate, PctNumero, ProdutoId, Uuid } from './base';

const Base = {
  id: Uuid,
  updated_at: z.string(),
  deleted_at: z.string().nullable(),
  external_id: z.string().nullable(),
};

const Alvo = {
  cliente_id: Uuid.nullable(),
  segmento: z.string().max(120).nullable(),
};

const Vigencia = {
  vigencia_inicio: IsoDate,
  vigencia_fim: IsoDate.nullable(),
};

export const CategoriaGondolaSync = z.object({ ...Base, nome: z.string().trim().min(1).max(120), ordem: z.number().int(), ativo: z.boolean() }).strict();
export type CategoriaGondolaSync = z.infer<typeof CategoriaGondolaSync>;

/** O que a etapa do checklist pede ao promotor (a tela abre a coleta correspondente). */
export const TIPOS_ETAPA_CHECKLIST = ['marcar', 'texto', 'foto', 'gondola', 'share', 'preco', 'ruptura', 'validade', 'ponto_extra', 'concorrencia'] as const;
export const TipoEtapaChecklist = z.enum(TIPOS_ETAPA_CHECKLIST);

export const ChecklistItem = z
  .object({
    id: Uuid,
    rotulo: z.string().min(1).max(200),
    tipo: TipoEtapaChecklist,
    /** RN-PRO-06: obrigatória = bloqueia o checkout de visita realizada enquanto pendente. */
    obrigatoria: z.boolean(),
    ordem: z.number().int(),
    categoria_gondola_id: Uuid.nullable(),
  })
  .strict();
export type ChecklistItem = z.infer<typeof ChecklistItem>;

/** `checklist_loja`: modelo de checklist com os itens embutidos (uma linha por versão; RN-PRO-10). */
export const ChecklistLojaSync = z.object({ ...Base, ...Alvo, ...Vigencia, nome: z.string().trim().min(1).max(120), itens: z.array(ChecklistItem) }).strict();
export type ChecklistLojaSync = z.infer<typeof ChecklistLojaSync>;

/** `mix_obrigatorio`: um produto (cadastro base do Core) que precisa estar na gôndola das lojas do alvo. */
export const MixObrigatorioSync = z.object({ ...Base, ...Alvo, ...Vigencia, produto_id: ProdutoId, categoria_gondola_id: Uuid.nullable() }).strict();
export type MixObrigatorioSync = z.infer<typeof MixObrigatorioSync>;

/** `meta_share`: meta de share (%) da categoria nas lojas do alvo (RN-PRO-03). */
export const MetaShareSync = z.object({ ...Base, ...Alvo, ...Vigencia, categoria_gondola_id: Uuid, meta_pct: PctNumero.min(0).max(100) }).strict();
export type MetaShareSync = z.infer<typeof MetaShareSync>;

export const ConcorrenteSync = z.object({ ...Base, nome: z.string().trim().min(1).max(120), ativo: z.boolean() }).strict();
export type ConcorrenteSync = z.infer<typeof ConcorrenteSync>;

/** Produto do concorrente comparado a um produto nosso (`produto_id`, índice de preço RN-PRO-04). */
export const ProdutoConcorrenteSync = z
  .object({ ...Base, concorrente_id: Uuid, nome: z.string().trim().min(1).max(200), produto_id: ProdutoId.nullable(), categoria_gondola_id: Uuid.nullable(), ativo: z.boolean() })
  .strict();
export type ProdutoConcorrenteSync = z.infer<typeof ProdutoConcorrenteSync>;

/** Foto/planograma de referência da categoria (arquivo da plataforma, ADR 0010). */
export const FotoReferenciaSync = z.object({ ...Base, ...Alvo, ...Vigencia, categoria_gondola_id: Uuid, arquivo_id: Uuid, descricao: z.string().max(300).nullable() }).strict();
export type FotoReferenciaSync = z.infer<typeof FotoReferenciaSync>;

/** Tarefa pontual de campanha (RF-PRO-10): comprovação por foto, prazo opcional. */
export const TarefaTradeSync = z
  .object({ ...Base, ...Alvo, ...Vigencia, titulo: z.string().min(1).max(160), instrucao: z.string().max(1000).nullable(), prazo: IsoDate.nullable() })
  .strict();
export type TarefaTradeSync = z.infer<typeof TarefaTradeSync>;

/** Ponto extra negociado com a loja (RF-PRO-08), na forma de linha do pull. */
export const PontoExtraNegociadoSync = z
  .object({ ...Base, ...Vigencia, cliente_id: Uuid, tipo: z.enum(TIPOS_PONTO_EXTRA), local_combinado: z.string().min(1).max(500), produto_id: ProdutoId.nullable() })
  .strict();
export type PontoExtraNegociadoSync = z.infer<typeof PontoExtraNegociadoSync>;
