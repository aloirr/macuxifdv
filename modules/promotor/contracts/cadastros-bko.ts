/**
 * API de cadastros de trade do BKO (T-0069, RF-PRO-11): `GET/POST /v1/promotor/cadastros/<cadastro>`,
 * `PUT/DELETE .../<cadastro>/:id` e `GET /v1/promotor/cadastros/parametros` (só leitura).
 * O corpo de escrita é a LINHA DO PULL sem os campos do servidor (`updated_at`, `deleted_at`, `external_id`), então o que o
 * BKO grava é exatamente o que o aparelho recebe (`contracts/cadastros.ts`). `id` = UUID gerado no cliente (escrita
 * idempotente). Meta de share em percentual (40 = 40%); datas em dia civil; instantes em UTC. A validação vem do domain
 * (RN-PRO-03, RN-PRO-06, RN-PRO-10) e a API sempre revalida.
 */
import { z } from 'zod';
import {
  validarAlvo,
  validarCategoria,
  validarChecklist,
  validarMetaShare,
  validarProdutoConcorrente,
  validarVigencia,
  type Problemas,
} from '../domain/cadastros';
import { PctNumero } from './base';
import {
  CategoriaGondolaSync,
  ChecklistLojaSync,
  MetaShareSync,
  MixObrigatorioSync,
  ProdutoConcorrenteSync,
} from './cadastros';

const SERVIDOR = { updated_at: true, deleted_at: true, external_id: true } as const;

/** Leva os problemas do domain para o Zod (mensagem em português, na raiz do corpo). */
function comDomain<T extends z.ZodTypeAny>(schema: T, validar: (v: z.output<T>) => Problemas) {
  return schema.superRefine((v, ctx) => {
    for (const message of validar(v)) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  });
}

/** Perfis que escrevem nos cadastros (manifesto) e que leem (gestores e BKO). */
export const PERFIS_ESCRITA_CADASTRO = ['analista', 'admin'] as const;

export const CategoriaEdicao = comDomain(CategoriaGondolaSync.omit(SERVIDOR), validarCategoria);
export type CategoriaEdicao = z.infer<typeof CategoriaEdicao>;

export const ChecklistEdicao = comDomain(ChecklistLojaSync.omit(SERVIDOR), (c) => [
  ...validarChecklist(c),
  ...validarAlvo(c),
  ...validarVigencia(c.vigencia_inicio, c.vigencia_fim),
]);
export type ChecklistEdicao = z.infer<typeof ChecklistEdicao>;

export const MixEdicao = comDomain(MixObrigatorioSync.omit(SERVIDOR), (m) => [...validarAlvo(m), ...validarVigencia(m.vigencia_inicio, m.vigencia_fim)]);
export type MixEdicao = z.infer<typeof MixEdicao>;

/** `meta_pct` sem o teto do Zod: o limite 0–100 (RN-PRO-03) vem do domain, com a mensagem em português. */
export const MetaShareEdicao = comDomain(MetaShareSync.omit(SERVIDOR).extend({ meta_pct: PctNumero }), (m) => [...validarMetaShare(m.meta_pct), ...validarAlvo(m), ...validarVigencia(m.vigencia_inicio, m.vigencia_fim)]);
export type MetaShareEdicao = z.infer<typeof MetaShareEdicao>;


export const ProdutoConcorrenteEdicao = comDomain(ProdutoConcorrenteSync.omit(SERVIDOR), validarProdutoConcorrente);
export type ProdutoConcorrenteEdicao = z.infer<typeof ProdutoConcorrenteEdicao>;

/** Linha da lista de marcas concorrentes no BKO (T-0113, ADR 0034): vem de `catalogo.marcas@1`, só leitura. */
export const MarcaConcorrenteListaSchema = z.object({ id: z.string().uuid(), nome: z.string(), ativo: z.boolean(), external_id: z.string().nullable() }).strict();
export type MarcaConcorrenteLista = z.infer<typeof MarcaConcorrenteListaSchema>;

export const CADASTROS_BKO = ['categoria_gondola', 'checklist_loja', 'meta_share', 'mix_obrigatorio', 'concorrente', 'produto_concorrente'] as const;
export type CadastroBko = (typeof CADASTROS_BKO)[number];

/**
 * T-0113 (ADR 0034): as marcas concorrentes são do Catálogo (`catalogo.marcas@1`); o cadastro `concorrente` do Promotor é só
 * leitura (seletor do BKO, pela consulta). Escrita, desativação e repositório valem só para estes.
 */
export const CADASTROS_GRAVAVEIS = CADASTROS_BKO.filter((c) => c !== 'concorrente') as readonly Exclude<CadastroBko, 'concorrente'>[];
export type CadastroGravavel = Exclude<CadastroBko, 'concorrente'>;

/** Caminho (relativo a `/v1/promotor`) de cada cadastro; compartilhado pela API e pela tela. */
export const CAMINHO_CADASTRO: Readonly<Record<CadastroBko, string>> = {
  categoria_gondola: 'cadastros/categorias',
  checklist_loja: 'cadastros/checklists',
  meta_share: 'cadastros/metas-share',
  mix_obrigatorio: 'cadastros/mix',
  concorrente: 'cadastros/concorrentes',
  produto_concorrente: 'cadastros/produtos-concorrente',
};

/** Ação do manifesto que autoriza escrever em cada cadastro (analista e admin). */
export const ACAO_CADASTRO: Readonly<Record<CadastroBko, string>> = {
  categoria_gondola: 'categoria_gondola.gerenciar',
  checklist_loja: 'checklist_modelo.gerenciar',
  meta_share: 'meta_share.gerenciar',
  mix_obrigatorio: 'mix_obrigatorio.gerenciar',
  concorrente: 'concorrente.gerenciar',
  produto_concorrente: 'concorrente.gerenciar',
};

export const CAMINHO_PARAMETROS_TRADE = 'cadastros/parametros';

/** Corpo de escrita e linha devolvida de cada cadastro. */
export const EDICAO_CADASTRO = {
  categoria_gondola: CategoriaEdicao,
  checklist_loja: ChecklistEdicao,
  meta_share: MetaShareEdicao,
  mix_obrigatorio: MixEdicao,
  produto_concorrente: ProdutoConcorrenteEdicao,
} as const;

export const LINHA_CADASTRO = {
  categoria_gondola: CategoriaGondolaSync,
  checklist_loja: ChecklistLojaSync,
  meta_share: MetaShareSync,
  mix_obrigatorio: MixObrigatorioSync,
  concorrente: MarcaConcorrenteListaSchema,
  produto_concorrente: ProdutoConcorrenteSync,
} as const;

/** Lista: por padrão só os cadastros vivos; `incluir_removidos=true` traz também os desativados (lápide). */
export const FiltroCadastro = z.object({ incluir_removidos: z.enum(['true', 'false']).default('false') }).strict();
export type FiltroCadastro = z.infer<typeof FiltroCadastro>;

export const IdCadastroParams = z.object({ id: z.string().uuid() }).strict();

/** Parâmetros do tenant que o Promotor usa (somente leitura no BKO nesta versão). */
export const ParametrosTradeApi = z.object({
  validade_critica_dias: z.number(),
  validade_proxima_dias: z.number(),
  peso_parcial_conformidade: z.number(),
  permanencia_min_min: z.number(),
  variacao_preco_max_pct: z.number(),
});
export type ParametrosTradeApi = z.infer<typeof ParametrosTradeApi>;
