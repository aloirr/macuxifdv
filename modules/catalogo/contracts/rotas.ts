/**
 * Contratos das rotas do Catálogo (`/v1/catalogo`, T-0052): busca (inteligente e textual), vitrine, ficha, filtros e o
 * BKO de conteúdo (sinônimos, destaques, conteúdo da ficha e termos sem resultado). RF-CAT-01..03, RF-CAT-07;
 * RN-CAT-01, RN-CAT-03..07. Convenções de `busca.ts`: centavos inteiros, instantes ISO UTC, campos em snake_case.
 * As rotas GET recebem tudo como texto na query: os schemas `*Query` convertem número e booleano.
 */
import { z } from 'zod';
import { Cents, Id } from '@macuxi/core/contracts';
import { ConsultaBusca, InstanteUtc, ItemVitrine, Referencia, ResultadoBusca, Sinonimo } from './busca';

/** Booleano vindo da query (`true`/`false`/`1`/`0`); qualquer outro texto é inválido. */
export const BooleanoQuery = z.preprocess((v) => {
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return v;
}, z.boolean());

/** Até onde a lista pagina (a busca corta em 500 candidatos; ver `LIMITE_RESULTADOS_BUSCA` no domain). */
export const OFFSET_MAXIMO = 450;

// ---------- busca (GET /v1/catalogo/busca) ----------
/** Query de `GET /v1/catalogo/busca`: `ConsultaBusca` + paginação por deslocamento. */
export const ConsultaBuscaQuery = ConsultaBusca.extend({
  /**
   * Sem `customer_id`: filial dos preços e do estoque (RN-VEN-01, RN-CORE-39); ausente = a filial padrão do tenant para o preço e a(s)
   * filial(is) do usuário para o estoque. `todas` = "Suas filiais" (`filiaisDoEstoque`, `domain/estoque-campo.ts`).
   */
  filial: z.union([Id, z.literal('todas')]).optional(),
  only_in_stock: BooleanoQuery.optional(),
  offset: z.coerce.number().int().min(0).max(OFFSET_MAXIMO).default(0),
});
export type ConsultaBuscaQuery = z.infer<typeof ConsultaBuscaQuery>;

/** Resposta da busca: `ResultadoBusca` + total de candidatos e o próximo deslocamento (nulo = acabou). */
export const RespostaBusca = ResultadoBusca.extend({
  total: z.number().int().min(0),
  next_offset: z.number().int().min(0).nullable(),
});
export type RespostaBusca = z.infer<typeof RespostaBusca>;

/** Id de nível da hierarquia, validado por formato: uuid, `outros:<uuid>` (43 caracteres) ou `sem-linha`. */
export const NoHierarquia = z
  .string()
  .trim()
  .regex(/^(sem-linha|(outros:)?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/, 'Nível do catálogo inválido.');

// ---------- vitrine (GET /v1/catalogo/produtos) ----------
export const ConsultaVitrineQuery = z.object({
  /** Cliente em contexto: define a tabela de preço (RN-CAT-06) e passa pelo escopo de carteira (RN-CORE-04). */
  customer_id: Id.optional(),
  line: z.string().trim().min(1).max(80).optional(),
  brand: z.string().trim().min(1).max(80).optional(),
  only_in_stock: BooleanoQuery.optional(),
  /** Só produtos de campanha/destaque. */
  campaign: BooleanoQuery.optional(),
  /** Só os produtos deste nível da hierarquia e dos abaixo dele (id do nível ou `sem-linha`; RF-CAT-09). */
  no: NoHierarquia.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(OFFSET_MAXIMO).default(0),
});
export type ConsultaVitrineQuery = z.infer<typeof ConsultaVitrineQuery>;

export const PaginaVitrine = z.object({
  items: z.array(ItemVitrine),
  total: z.number().int().min(0),
  next_offset: z.number().int().min(0).nullable(),
});
export type PaginaVitrine = z.infer<typeof PaginaVitrine>;

// ---------- hierarquia (GET /v1/catalogo/hierarquia; RF-CAT-09, T-0142) ----------
/** Nível atual da hierarquia do catálogo: o mesmo `navegarHierarquia` do domain que o app usa offline. */
export const ConsultaHierarquiaQuery = z.object({ no: NoHierarquia.optional() });
export type ConsultaHierarquiaQuery = z.infer<typeof ConsultaHierarquiaQuery>;

export const NivelHierarquia = z.object({ id: z.string(), codigo: z.string(), nome: z.string(), total: z.number().int().min(0) });
export type NivelHierarquia = z.infer<typeof NivelHierarquia>;

export const RespostaHierarquia = z.object({
  /** `niveis`: escolher o próximo nível; `produtos`: chegou nos produtos (ou o tenant não tem hierarquia). */
  tipo: z.enum(['niveis', 'produtos']),
  sem_hierarquia: z.boolean(),
  /** Do sistema até o lugar atual; `tocavel` falso no atual e no nível pulado (item único), que cairia na mesma tela. */
  trilha: z.array(z.object({ id: z.string(), codigo: z.string(), nome: z.string(), tocavel: z.boolean() })),
  /** "Catálogo" (a raiz) leva a uma tela diferente da atual. */
  raiz_tocavel: z.boolean(),
  /** Cabeçalho da lista: "Sistemas", "Grupos", "Linhas" ou "Categorias". */
  rotulo_plural: z.string(),
  /** Itens do nível aberto, inclusive "Outros produtos" e "Sem classificação" (id `outros:<nível>` e `sem-linha`). */
  niveis: z.array(NivelHierarquia),
  /** Nível dono da lista de produtos (`GET produtos?no=`) quando `tipo = produtos`; `null` no meio da hierarquia ou sem ela. */
  no: z.string().nullable(),
  /** Produtos ativos do nível aberto (no `produtos`, os da lista). */
  total_produtos: z.number().int().min(0),
});
export type RespostaHierarquia = z.infer<typeof RespostaHierarquia>;

// ---------- filtros (GET /v1/catalogo/filtros) ----------
/** Vocabulário do tenant para os chips da tela (marcas e categorias/linhas cadastradas). */
export const FiltrosCatalogo = z.object({ brands: z.array(z.string()), lines: z.array(z.string()) });
export type FiltrosCatalogo = z.infer<typeof FiltrosCatalogo>;

// ---------- ficha (GET /v1/catalogo/produtos/:id) ----------
export const ParamsProduto = z.object({ id: Id });
export type ParamsProduto = z.infer<typeof ParamsProduto>;

export const ConsultaFichaQuery = z.object({ customer_id: Id.optional() });
export type ConsultaFichaQuery = z.infer<typeof ConsultaFichaQuery>;

/** Atributo técnico da ficha (ex.: "Volume" = "5 L"). */
export const AtributoProduto = z.object({ name: z.string().trim().min(1).max(60), value: z.string().trim().min(1).max(200) });
export type AtributoProduto = z.infer<typeof AtributoProduto>;

export const TipoMidia = z.enum(['foto', 'video', 'pdf']);
export type TipoMidia = z.infer<typeof TipoMidia>;

export const MidiaProduto = z.object({
  id: Id,
  type: TipoMidia,
  url: z.string().min(1),
  title: z.string().nullable(),
  order: z.number().int().min(0),
});
export type MidiaProduto = z.infer<typeof MidiaProduto>;

export const PerguntaFrequente = z.object({ question: z.string().trim().min(3).max(200), answer: z.string().trim().min(1).max(2000) });
export type PerguntaFrequente = z.infer<typeof PerguntaFrequente>;

/** Conteúdo comercial da ficha cadastrado no BKO (RF-CAT-07): texto, argumentos de venda e FAQ. */
export const ConteudoProduto = z.object({
  description: z.string().trim().max(4000).nullable().default(null),
  selling_points: z.array(z.string().trim().min(1).max(200).regex(/^[^\r\n]+$/, 'Cada argumento de venda deve ficar em uma linha só.')).max(10).default([]),
  faq: z.array(PerguntaFrequente).max(20).default([]),
  /**
   * RN-CAT-11: Aplicação (descrição 2), até 2.000 (a API recusa acima de `aplicacao_max_cadastro`: 422 `RN-CAT-11`).
   * Ausente no corpo do `PUT conteudo` = não altera; `null` = limpa.
   */
  aplicacao: z.string().trim().max(2000).nullable().optional(),
});
export type ConteudoProduto = z.infer<typeof ConteudoProduto>;

/** Produto que a ficha oferece junto (RN-CAT-09: até 5; relação `complementar`). */
export const OfereceJunto = z.object({ produto_id: Id, erp_code: z.string(), description: z.string() });
export type OfereceJunto = z.infer<typeof OfereceJunto>;

/** Seção Catálogo da ficha (T-0085 K8): promotor vê tudo, só leitura (RN-CAT-05 só esconde preço e estoque). */
export const CatalogoDaFicha = z.object({
  aplicacao: z.string().nullable(),
  referencias: z.array(Referencia).max(3),
  oferece_junto: z.array(OfereceJunto).max(5),
  etiquetas: z.array(z.string().max(20)).max(4),
});
export type CatalogoDaFicha = z.infer<typeof CatalogoDaFicha>;

/** Ficha rica (RF-CAT-03): o cartão da vitrine + atributos, mídias e conteúdo. Preço/estoque seguem o RN-CAT-05. */
export const FichaProduto = z.object({
  product: ItemVitrine,
  attributes: z.array(AtributoProduto),
  media: z.array(MidiaProduto),
  content: ConteudoProduto,
  /** Instante da última alteração do conteúdo (nulo = nunca enriquecido). */
  content_updated_at: InstanteUtc.nullable(),
  /** T-0084/T-0085: aplicação, referências, oferece junto e etiquetas (aditivo; ausente = servidor antigo). */
  catalogo: CatalogoDaFicha.optional(),
});
export type FichaProduto = z.infer<typeof FichaProduto>;

// ---------- BKO: sinônimos (GET/PUT/DELETE /v1/catalogo/sinonimos) ----------
export const ParamsSinonimo = z.object({ id: Id });
export type ParamsSinonimo = z.infer<typeof ParamsSinonimo>;

/** Corpo do `PUT /v1/catalogo/sinonimos/:id` (idempotente pelo `id`: cria ou substitui). */
export const SalvarSinonimo = z.object({
  term: z.string().trim().min(1, 'Informe o termo.').max(60, 'Use até 60 caracteres.'),
  synonyms: z.array(z.string().trim().min(1).max(60)).min(1, 'Informe ao menos um sinônimo.').max(20, 'Use até 20 sinônimos.'),
  active: z.boolean().default(true),
});
export type SalvarSinonimo = z.infer<typeof SalvarSinonimo>;

export const ListaSinonimos = z.object({ items: z.array(Sinonimo) });
export type ListaSinonimos = z.infer<typeof ListaSinonimos>;

// ---------- BKO: destaque e conteúdo ----------
/** Corpo do `PUT /v1/catalogo/produtos/:id/destaque` (RF-CAT-01: boost de campanha/destaque). */
export const SalvarDestaque = z.object({ is_campaign: z.boolean() });
export type SalvarDestaque = z.infer<typeof SalvarDestaque>;

/**
 * Corpo do `PUT /v1/catalogo/produtos/:id/foto-principal` (T-0097, RF-CAT-03): o aparelho/BKO gera o UUID da foto, chama esta rota
 * (que registra o arquivo e define a principal) e depois envia os bytes JPEG por `PUT /v1/arquivos/:id` (ADR 0010).
 */
export const SalvarFotoPrincipal = z.object({ arquivo_id: z.string().uuid(), titulo: z.string().trim().min(1).max(120).optional() });
export type SalvarFotoPrincipal = z.infer<typeof SalvarFotoPrincipal>;

/** Corpo do `PUT /v1/catalogo/produtos/:id/conteudo` (RF-CAT-07): substitui conteúdo e atributos do produto. */
export const SalvarConteudo = ConteudoProduto.extend({ attributes: z.array(AtributoProduto).max(30).default([]) });
export type SalvarConteudo = z.infer<typeof SalvarConteudo>;

/**
 * Corpo do `PUT /v1/catalogo/produtos/:id/cadastro-catalogo` (T-0085 K9; ação `produto.enriquecer`): substitui o conjunto
 * inteiro. Limites (RN-CAT-09: 3 referências, código até 30, oferece junto até 5) conferidos por `validarCadastroCatalogo`;
 * a forma aqui é larga de propósito para a API devolver 422 com a regra, não 400.
 */
export const SalvarCadastroCatalogo = z.object({
  aplicacao: z.string().nullable(),
  oferece_junto: z.array(Id).max(50),
  /** Códigos ERP de "Oferece junto" que o BKO não tem na página carregada: o servidor resolve (sem diferenciar maiúsculas) e soma aos ids (RN-CAT-09). */
  oferece_junto_codigos: z.array(z.string()).max(50).optional(),
  /** Ausente = não mexe nas referências (o BKO omite quando não carregou as marcas); lista vazia explícita = apaga todas. */
  referencias: z.array(z.object({ marca_id: Id, codigo: z.string() })).max(20).optional(),
  etiquetas: z.array(z.string()).max(20),
});
export type SalvarCadastroCatalogo = z.infer<typeof SalvarCadastroCatalogo>;

/** Marcas concorrentes ativas (cadastro do Catálogo, ADR 0034) para o seletor da referência cruzada no BKO. */
export const ListaMarcasConcorrentes = z.object({ items: z.array(z.object({ id: Id, nome: z.string() })) });
export type ListaMarcasConcorrentes = z.infer<typeof ListaMarcasConcorrentes>;

/** Linha da exportação do catálogo (T-0085 K10): preço fora. */
export const LinhaExportacao = z.object({
  sistema: z.string(),
  grupo: z.string(),
  linha: z.string(),
  codigo: z.string(),
  descricao: z.string(),
  medida_embalagem: z.string(),
  aplicacao: z.string(),
  oferece_junto: z.array(z.string()),
  equivale_a: z.array(z.string()),
});
export type LinhaExportacao = z.infer<typeof LinhaExportacao>;

export const ConsultaExportacaoQuery = z.object({ no_id: Id.optional(), cursor: z.string().max(200).optional() });
export type ConsultaExportacaoQuery = z.infer<typeof ConsultaExportacaoQuery>;

export const PaginaExportacao = z.object({ itens: z.array(LinhaExportacao).max(1000), proximo_cursor: z.string().nullable() });
export type PaginaExportacao = z.infer<typeof PaginaExportacao>;

/**
 * Exportação do catálogo em PDF e Excel (RF-CAT-09, T-0085 fatia C): `GET /v1/catalogo/exportacao`, página única
 * (teto de 20 mil produtos; acima disso `truncado = true`). Formato casado com o BKO (`web/exportacao/formato.ts`).
 */
export const ProdutoExportacao = z.object({
  id: Id,
  codigo: z.string().min(1),
  descricao: z.string(),
  aplicacao: z.string().nullable(),
  hierarquia: z.object({ sistema: z.string().nullable(), grupo: z.string().nullable(), linha: z.string().nullable() }),
  /** `marca_nome` é aditivo (RN-CAT-09): nulo quando não há cadastro de marcas do Catálogo nem retrato gravado. */
  referencias: z.array(z.object({ marca_id: Id, marca_nome: z.string().nullable(), codigo: z.string().min(1).max(30) })).max(3),
  oferece_junto: z.array(Id).max(5),
});
export type ProdutoExportacao = z.infer<typeof ProdutoExportacao>;

export const RespostaExportacao = z.object({
  produtos: z.array(ProdutoExportacao).max(20_000),
  marcas: z.array(z.object({ id: Id, nome: z.string() })),
  /** Havia mais produtos que o teto: a lista saiu cortada (o BKO avisa). */
  truncado: z.boolean().default(false),
});
export type RespostaExportacao = z.infer<typeof RespostaExportacao>;

// ---------- BKO: termos buscados sem resultado (GET /v1/catalogo/termos-sem-resultado) ----------
export const ConsultaTermosQuery = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ConsultaTermosQuery = z.infer<typeof ConsultaTermosQuery>;

export const TermoSemResultado = z.object({
  /** Termo normalizado (sem acento, caixa ou plural): o mesmo termo digitado de jeitos diferentes soma. */
  term: z.string(),
  count: z.number().int().min(1),
  last_searched_at: InstanteUtc,
});
export type TermoSemResultado = z.infer<typeof TermoSemResultado>;

export const ListaTermosSemResultado = z.object({ items: z.array(TermoSemResultado) });
export type ListaTermosSemResultado = z.infer<typeof ListaTermosSemResultado>;

/** Resposta das escritas do BKO (idempotentes): `criado` diz se a linha nasceu agora. */
export const RespostaEscrita = z.object({ id: Id, criado: z.boolean() });
export type RespostaEscrita = z.infer<typeof RespostaEscrita>;

/** Caminhos das rotas (relativos a `/v1/catalogo`), para a API, o app e o BKO usarem o mesmo texto. */
export const ROTAS_CATALOGO = {
  busca: 'busca',
  produtos: 'produtos',
  produto: 'produtos/:id',
  filtros: 'filtros',
  sinonimos: 'sinonimos',
  sinonimo: 'sinonimos/:id',
  destaque: 'produtos/:id/destaque',
  conteudo: 'produtos/:id/conteudo',
  fotoPrincipal: 'produtos/:id/foto-principal',
  termosSemResultado: 'termos-sem-resultado',
  cadastroCatalogo: 'produtos/:id/cadastro-catalogo',
  marcasConcorrentes: 'marcas-concorrentes',
  marcas: 'marcas',
  marca: 'marcas/:id',
  exportacao: 'exportacao',
  parametros: 'parametros',
  hierarquia: 'hierarquia',
  tabelasPreco: 'tabelas-preco',
  precosTabela: 'tabelas-preco/:id/precos',
  escalonada: 'escalonada',
  faixa: 'escalonada/:id',
  fotosLote: 'fotos-lote',
  fotoLoteLimites: 'fotos-lote/limites',
  fotoLote: 'fotos-lote/:id',
  fotoLoteEnfileirar: 'fotos-lote/:id/enfileirar',
  fotoLoteItens: 'fotos-lote/:id/itens',
  fotoLoteRelatorio: 'fotos-lote/:id/relatorio.csv',
} as const;

/** Caminho HTTP completo de uma rota do Catálogo (`/v1/catalogo/...`) com os parâmetros trocados. */
export function caminhoCatalogo(rota: keyof typeof ROTAS_CATALOGO, params: Record<string, string> = {}): string {
  const rel = ROTAS_CATALOGO[rota].replace(/:([a-z_]+)/g, (_m, k: string) => encodeURIComponent(params[k] ?? ''));
  return `/v1/catalogo/${rel}`;
}

// ---------- BKO: tabelas de preço (preço da UN) e tabela escalonada (RN-VEN-23; T-0089) ----------
export const TabelaPrecoResumo = z.object({ id: Id, codigo: z.string(), nome: z.string(), ativo: z.boolean(), itens: z.number().int().min(0) });
export type TabelaPrecoResumo = z.infer<typeof TabelaPrecoResumo>;
/** Filial para escolher na tela (RN-CORE-39); `padrao` marca a filial padrão do tenant. */
export const FilialDaTela = z.object({ id: Id, nome: z.string(), padrao: z.boolean() });
export type FilialDaTela = z.infer<typeof FilialDaTela>;
/** `filial_id`: a filial cujos itens foram contados (a pedida ou, por omissão, a padrão). */
export const ListaTabelasPreco = z.object({ items: z.array(TabelaPrecoResumo), filial_id: Id, filiais: z.array(FilialDaTela) });
export type ListaTabelasPreco = z.infer<typeof ListaTabelasPreco>;

export const ConsultaTabelasPrecoQuery = z.object({ filial: Id.optional() });
export type ConsultaTabelasPrecoQuery = z.infer<typeof ConsultaTabelasPrecoQuery>;

export const ParamsTabelaPreco = z.object({ id: Id });
export type ParamsTabelaPreco = z.infer<typeof ParamsTabelaPreco>;

/** Preço da UNIDADE BASE do produto numa tabela (RN-VEN-15 nova: não há preço de caixa; a embalagem é UN × quantidade). */
export const PrecoUnidadeLinha = z.object({
  produto_id: Id,
  sku: z.string(),
  nome: z.string(),
  preco_cents: Cents,
  vigencia_inicio: InstanteUtc.nullable(),
  vigencia_fim: InstanteUtc.nullable(),
});
export type PrecoUnidadeLinha = z.infer<typeof PrecoUnidadeLinha>;

export const ConsultaPrecosTabelaQuery = z.object({
  q: z.string().trim().max(80).optional(),
  /** Filial dos itens (RN-CORE-39); ausente = a padrão do tenant. */
  filial: Id.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ConsultaPrecosTabelaQuery = z.infer<typeof ConsultaPrecosTabelaQuery>;

export const PaginaPrecosTabela = z.object({ filial_id: Id, items: z.array(PrecoUnidadeLinha), total: z.number().int().min(0), next_offset: z.number().int().min(0).nullable() });
export type PaginaPrecosTabela = z.infer<typeof PaginaPrecosTabela>;

/** Faixa cadastrada. `origem`: 'erp' (veio do Hub; só leitura no BKO) ou 'manual' (cadastrada aqui). */
export const FaixaCadastrada = z.object({
  id: Id,
  produto_id: Id,
  sku: z.string(),
  nome: z.string(),
  medida: z.string().nullable(),
  quantidade_minima: z.number().int().positive(),
  preco_unidade_cents: Cents,
  vigencia_inicio: z.string(),
  vigencia_fim: z.string().nullable(),
  tabela_preco_id: Id.nullable(),
  tabela_preco_nome: z.string().nullable(),
  ativo: z.boolean(),
  origem: z.enum(['erp', 'manual']),
  /** Verdadeiro quando a faixa é mais cara que o preço da UN na tabela (P4: não sobe o preço no pedido). */
  mais_cara_que_a_tabela: z.boolean(),
  /** Vigente hoje (data civil no fuso do tenant). */
  vigente: z.boolean(),
});
export type FaixaCadastrada = z.infer<typeof FaixaCadastrada>;

export const ConsultaEscalonadaQuery = z.object({
  q: z.string().trim().max(80).optional(),
  tabela_preco_id: Id.optional(),
  vigente: BooleanoQuery.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ConsultaEscalonadaQuery = z.infer<typeof ConsultaEscalonadaQuery>;

export const PaginaEscalonada = z.object({ items: z.array(FaixaCadastrada), total: z.number().int().min(0), next_offset: z.number().int().min(0).nullable() });
export type PaginaEscalonada = z.infer<typeof PaginaEscalonada>;

export const ParamsMarca = z.object({ id: Id });
export type ParamsMarca = z.infer<typeof ParamsMarca>;
export const ParamsFaixa = z.object({ id: Id });
export type ParamsFaixa = z.infer<typeof ParamsFaixa>;

/** Corpo do `PUT /v1/catalogo/escalonada/:id` (idempotente pelo id). A API revalida com `validarFaixa` do domain. */
export const SalvarFaixa = z.object({
  produto_id: Id,
  medida: z.string().trim().min(1).nullable().default(null),
  quantidade_minima: z.number().int(),
  preco_unidade_cents: z.number().int(),
  vigencia_inicio: z.string(),
  vigencia_fim: z.string().nullable().default(null),
  tabela_preco_id: Id.nullable().default(null),
  ativo: z.boolean().default(true),
});
export type SalvarFaixa = z.infer<typeof SalvarFaixa>;
