/**
 * Repositório do Catálogo na API (T-0052): o que as rotas leem e gravam, atrás de uma interface. Duas implementações:
 * - `criarRepositorioMemoria` (este arquivo): testes do módulo e base demo sem banco; isolada por tenant (RN-CAT-01).
 * - `criarRepositorioPostgres` (`repositorio-postgres.ts`): preço real (0008) e cadastro base pela consulta do Core
 *   (ADR 0012); estoque, conteúdo, sinônimos, cota de IA e registro de buscas pelas tabelas da 0013 (RLS do tenant).
 * Toda leitura/escrita acontece dentro de `ctx.comTenant` (RLS do tenant do token); a fábrica recebe o cliente e a
 * transação da requisição.
 */
import type { ClienteBanco, ContextoBase, TransacaoTenant } from '@macuxi/platform-sdk';
import type { ItemTabelaPreco, MidiaProduto, OfereceJunto, Promocao, SalvarCadastroCatalogo, SalvarConteudo, SalvarFaixa, SalvarSinonimo, Sinonimo, StockByBranch, TermoSemResultado } from '../contracts';
import type { NoCatalogo, VinculoProdutoNo } from '../domain/arvore';
import { agruparTermosSemResultado, type ConteudoGuardado, type RegistroBusca } from '../domain/conteudo';
import type { LinhaEscalonada } from '../domain/escalonada';
import type { UsoIa } from '../domain/limite-ia';
import type { ProdutoCatalogo } from '../domain/vitrine';

export interface PrecosDoCliente {
  /** Tabela ativa do cliente; nula = cliente sem tabela (ou sem cliente). */
  tabelaClienteId: string | null;
  /** Itens da tabela do cliente para os produtos pedidos (sem cliente: itens da tabela padrão, se o tenant tiver). */
  itens: ItemTabelaPreco[];
}

export interface RegistroBuscaNovo extends RegistroBusca {
  interpretado_por: 'llm' | 'regras' | 'nenhum';
}

export interface RepositorioCatalogo {
  /** Todos os produtos do tenant (ativos e inativos) com o enriquecimento do Catálogo. */
  produtos(): Promise<ProdutoCatalogo[]>;
  produto(id: string): Promise<ProdutoCatalogo | null>;
  sinonimos(): Promise<Sinonimo[]>;
  precos(clienteId: string | null, produtoIds: readonly string[]): Promise<PrecosDoCliente>;
  promocoes(produtoIds: readonly string[]): Promise<Promocao[]>;
  /** Saldos por produto em todas as filiais (o domínio filtra pelas do usuário). */
  saldos(produtoIds: readonly string[]): Promise<Map<string, StockByBranch[]>>;
  /** Filiais/depósitos do usuário da requisição; `null` = todas. */
  filiaisDoUsuario(): Promise<string[] | null>;
  conteudo(produtoId: string): Promise<{ conteudo: ConteudoGuardado | null; midias: MidiaProduto[] }>;
  /** RN-CAT-03: uso de IA do usuário no dia do tenant; `'indisponivel'` = sem onde guardar a cota (IA não é chamada). */
  usoIa(dia: string): Promise<UsoIa | null | 'indisponivel'>;
  /** RN-CAT-03: débito atômico condicional (`usadas < limite`); `false` = limite já atingido. */
  debitarIa(dia: string, limite: number): Promise<boolean>;
  /** RF-CAT-07: registro da busca (termo normalizado e nº de resultados; sem usuário). */
  registrarBusca(r: RegistroBuscaNovo): Promise<void>;
  termosSemResultado(desde: string, limite: number): Promise<TermoSemResultado[]>;
  /** Idempotente pelo `id` (cria ou substitui). */
  salvarSinonimo(id: string, s: SalvarSinonimo): Promise<{ criado: boolean }>;
  removerSinonimo(id: string): Promise<boolean>;
  marcarDestaque(produtoId: string, destaque: boolean): Promise<void>;
  salvarConteudo(produtoId: string, c: SalvarConteudo, em: string): Promise<{ criado: boolean }>;
  /** T-0085: "oferece junto" (até 5, relação complementar viva e ativa) e etiquetas do produto, para a ficha. */
  extrasFicha(produtoId: string): Promise<{ ofereceJunto: OfereceJunto[]; etiquetas: string[] }>;
  /**
   * RN-CAT-09: marcas concorrentes do tenant, do cadastro do Promotor (contrato do Promotor; sem ler a tabela dele).
   * Tenant sem a licença do Promotor: mapa vazio (a referência não é gravada nem aparece).
   */
  marcasConcorrentes(): Promise<Map<string, { nome: string; ativo: boolean }>>;
  /** T-0085 fatia C: árvore, vínculos e "oferece junto" de todos os produtos, para a exportação do catálogo (RF-CAT-09). */
  dadosExportacao(): Promise<{ nos: NoCatalogo[]; vinculos: VinculoProdutoNo[]; ofereceJunto: Map<string, string[]> }>;
  /**
   * T-0085 K9: substitui aplicação, referências, "oferece junto" e etiquetas do produto de uma vez (a rota já validou com
   * `validarCadastroCatalogo`). Grava `codigo_compacto` com `codigoCompacto` do domain.
   */
  salvarCadastroCatalogo(produtoId: string, c: SalvarCadastroCatalogo, em: string): Promise<{ criado: boolean }>;
  /** T-0089 (BKO Tabelas de preço): tabelas vivas com a contagem de itens da unidade base. */
  tabelasPreco(): Promise<TabelaPrecoBko[]>;
  /** Preço da UNIDADE BASE (item sem unidade) de cada produto da tabela (RN-VEN-15 nova). */
  precosUnidade(tabelaId: string): Promise<PrecoUnidadeGuardado[]>;
  /** RN-VEN-23: todas as faixas vivas (qualquer vigência, ativas ou não). */
  faixas(): Promise<FaixaGuardada[]>;
  salvarFaixa(id: string, f: SalvarFaixa): Promise<{ criado: boolean }>;
  /** Remove (soft delete); falso se não existia. */
  removerFaixa(id: string): Promise<boolean>;
}

/** Faixa guardada: a linha do domain + id e `external_id` (nulo = cadastrada à mão no BKO). */
export type FaixaGuardada = LinhaEscalonada & { id: string; external_id: string | null };
export interface TabelaPrecoBko {
  id: string;
  codigo: string;
  nome: string;
  ativo: boolean;
  itens: number;
}
export interface PrecoUnidadeGuardado {
  produto_id: string;
  preco_cents: number;
  vigencia_inicio: string | null;
  vigencia_fim: string | null;
}

/** Fábrica por requisição (dentro de `ctx.comTenant`). */
export type FabricaRepositorio = (ctx: ContextoBase, db: ClienteBanco, tx: TransacaoTenant) => RepositorioCatalogo;

// ---------------------------------------------------------------------------------------------------------------
// Implementação em memória (testes e demo sem banco)

export interface DadosTenantMemoria {
  produtos: ProdutoCatalogo[];
  /** Marcas concorrentes do Promotor (id → nome e ativo); ausente = tenant sem o Promotor. */
  marcas?: Map<string, { nome: string; ativo: boolean }>;
  /** "Oferece junto" por produto (ids na ordem) e etiquetas por produto. */
  ofereceJunto?: Map<string, string[]>;
  etiquetas?: Map<string, string[]>;
  sinonimos?: Sinonimo[];
  /** T-0089: tabelas de preço (BKO) e tabela escalonada. */
  tabelas?: { id: string; codigo: string; nome: string; ativo: boolean }[];
  faixas?: FaixaGuardada[];
  /** Árvore do catálogo e vínculos produto → nó (exportação). */
  nos?: NoCatalogo[];
  vinculos?: VinculoProdutoNo[];
  itensPreco?: ItemTabelaPreco[];
  promocoes?: Promocao[];
  /** cliente_id → tabela_preco_id. */
  tabelaDoCliente?: Record<string, string>;
  saldos?: Map<string, StockByBranch[]>;
  /** usuario_id → filiais (ausente = todas). */
  filiaisDoUsuario?: Record<string, string[]>;
  conteudos?: Map<string, ConteudoGuardado>;
  midias?: Map<string, MidiaProduto[]>;
  /** Sem onde guardar a cota (simula banco sem a 0013). */
  semCotaIa?: boolean;
}

export interface EstadoMemoria {
  dados: DadosTenantMemoria;
  /** `${usuario}:${dia}` → consultas usadas. */
  usoIa: Map<string, number>;
  buscas: RegistroBuscaNovo[];
}

/** Repositório em memória por tenant: um tenant nunca enxerga o outro (RN-CAT-01). Devolve a fábrica e o estado (para os testes). */
export function criarRepositorioMemoria(porTenant: Record<string, DadosTenantMemoria>): { fabrica: FabricaRepositorio; estado: (tenant: string) => EstadoMemoria } {
  const estados = new Map<string, EstadoMemoria>();
  const estado = (tenant: string): EstadoMemoria => {
    let e = estados.get(tenant);
    if (!e) {
      e = { dados: porTenant[tenant] ?? { produtos: [] }, usoIa: new Map(), buscas: [] };
      estados.set(tenant, e);
    }
    return e;
  };

  const fabrica: FabricaRepositorio = (ctx) => {
    const e = estado(ctx.usuario.tenant_id);
    const d = e.dados;
    const usuario = ctx.usuario.id;
    const copia = <T>(v: T): T => structuredClone(v);
    return {
      async produtos() {
        return copia(d.produtos);
      },
      async produto(id) {
        return copia(d.produtos.find((p) => p.id === id) ?? null);
      },
      async sinonimos() {
        return copia(d.sinonimos ?? []);
      },
      async precos(clienteId, produtoIds) {
        const ids = new Set(produtoIds);
        const tabela = clienteId === null ? null : (d.tabelaDoCliente?.[clienteId] ?? null);
        const itens = (d.itensPreco ?? []).filter((i) => ids.has(i.product_id) && i.price_table_id === tabela);
        return { tabelaClienteId: tabela, itens: copia(itens) };
      },
      async promocoes(produtoIds) {
        const ids = new Set(produtoIds);
        return copia((d.promocoes ?? []).filter((p) => ids.has(p.product_id)));
      },
      async saldos(produtoIds) {
        const ids = new Set(produtoIds);
        return new Map([...(d.saldos ?? new Map<string, StockByBranch[]>()).entries()].filter(([k]) => ids.has(k)).map(([k, v]) => [k, copia(v)]));
      },
      async filiaisDoUsuario() {
        return d.filiaisDoUsuario?.[usuario] ? [...d.filiaisDoUsuario[usuario]] : null;
      },
      async conteudo(produtoId) {
        return { conteudo: copia(d.conteudos?.get(produtoId) ?? null), midias: copia(d.midias?.get(produtoId) ?? []) };
      },
      async usoIa(dia) {
        if (d.semCotaIa) return 'indisponivel';
        const n = e.usoIa.get(`${usuario}:${dia}`);
        return n === undefined ? null : { dia, consultas: n };
      },
      async debitarIa(dia, limite) {
        // atômico no event loop: lê e grava sem await no meio (como o UPDATE ... WHERE usadas < limite do banco)
        const k = `${usuario}:${dia}`;
        const n = e.usoIa.get(k) ?? 0;
        if (n >= limite) return false;
        e.usoIa.set(k, n + 1);
        return true;
      },
      async registrarBusca(r) {
        e.buscas.push({ ...r });
      },
      async termosSemResultado(desde, limite) {
        return agruparTermosSemResultado(e.buscas, desde, limite);
      },
      async salvarSinonimo(id, s) {
        const lista = (d.sinonimos ??= []);
        const i = lista.findIndex((x) => x.id === id);
        const novo: Sinonimo = { id, term: s.term, synonyms: [...s.synonyms], active: s.active };
        if (i >= 0) lista[i] = { ...lista[i], ...novo };
        else lista.push(novo);
        return { criado: i < 0 };
      },
      async removerSinonimo(id) {
        const lista = d.sinonimos ?? [];
        const i = lista.findIndex((x) => x.id === id);
        if (i < 0) return false;
        lista.splice(i, 1);
        return true;
      },
      async marcarDestaque(produtoId, destaque) {
        const p = d.produtos.find((x) => x.id === produtoId);
        if (p) p.campanha = destaque;
      },
      async extrasFicha(produtoId) {
        const ids = d.ofereceJunto?.get(produtoId) ?? [];
        const ofereceJunto = ids.flatMap((id) => {
          const p = d.produtos.find((x) => x.id === id);
          return p ? [{ produto_id: p.id, erp_code: p.sku, description: p.nome }] : [];
        });
        return { ofereceJunto, etiquetas: [...(d.etiquetas?.get(produtoId) ?? [])] };
      },
      async marcasConcorrentes() {
        return new Map(d.marcas ?? []);
      },
      async dadosExportacao() {
        return { nos: copia(d.nos ?? []), vinculos: copia(d.vinculos ?? []), ofereceJunto: new Map([...(d.ofereceJunto ?? new Map<string, string[]>()).entries()].map(([k, v]) => [k, [...v]])) };
      },
      async tabelasPreco() {
        return (d.tabelas ?? []).map((t) => ({ ...t, itens: (d.itensPreco ?? []).filter((i) => i.price_table_id === t.id && i.unit == null).length }));
      },
      async precosUnidade(tabelaId) {
        return (d.itensPreco ?? [])
          .filter((i) => i.price_table_id === tabelaId && i.unit == null)
          .map((i) => ({ produto_id: i.product_id, preco_cents: i.price_cents, vigencia_inicio: i.valid_from ?? null, vigencia_fim: i.valid_to ?? null }));
      },
      async faixas() {
        return copia(d.faixas ?? []);
      },
      async salvarFaixa(id, f) {
        const lista = (d.faixas ??= []);
        const i = lista.findIndex((x) => x.id === id);
        const nova: FaixaGuardada = { id, external_id: i >= 0 ? lista[i]!.external_id : null, produto_id: f.produto_id, medida: f.medida, quantidade_minima: f.quantidade_minima, preco_unidade_cents: f.preco_unidade_cents, vigencia_inicio: f.vigencia_inicio, vigencia_fim: f.vigencia_fim, tabela_preco_id: f.tabela_preco_id, ativo: f.ativo };
        if (i >= 0) lista[i] = nova;
        else lista.push(nova);
        return { criado: i < 0 };
      },
      async removerFaixa(id) {
        const lista = d.faixas ?? [];
        const i = lista.findIndex((x) => x.id === id);
        if (i >= 0) lista.splice(i, 1);
        return i >= 0;
      },
      async salvarCadastroCatalogo(produtoId, c) {
        const p = d.produtos.find((x) => x.id === produtoId);
        const criado = !!p && !p.aplicacao && (p.referencias ?? []).length === 0;
        const marcas = d.marcas ?? new Map();
        if (p) {
          p.aplicacao = c.aplicacao?.trim() ?? '';
          if (c.referencias !== undefined) {
            p.referencias = c.referencias.flatMap((r) => {
              const m = marcas.get(r.marca_id);
              return m ? [{ marca_id: r.marca_id, marca_nome: m.nome, codigo: r.codigo.trim() }] : [];
            });
          }
        }
        (d.ofereceJunto ??= new Map()).set(produtoId, [...c.oferece_junto]);
        (d.etiquetas ??= new Map()).set(produtoId, c.etiquetas.map((e) => e.trim()));
        return { criado };
      },
      async salvarConteudo(produtoId, c, em) {
        const conteudos = (d.conteudos ??= new Map());
        const criado = !conteudos.has(produtoId);
        conteudos.set(produtoId, { description: c.description, selling_points: [...c.selling_points], faq: c.faq.map((f) => ({ ...f })), updated_at: em });
        const p = d.produtos.find((x) => x.id === produtoId);
        if (p && c.aplicacao !== undefined) p.aplicacao = c.aplicacao?.trim() ?? '';
        if (p) p.atributos = c.attributes.map((a) => ({ ...a }));
        return { criado };
      },
    };
  };
  return { fabrica, estado };
}
