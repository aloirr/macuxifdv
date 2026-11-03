/**
 * Armazenamento das coletas do Promotor na API (T-0056), atrás de uma interface: as rotas e o push não sabem se é
 * Postgres (schema `promotor`, migração 0015 do banco-dados) ou memória (testes). Toda chamada recebe a `SessaoTenant`
 * da transação aberta por `ctx.comTenant` — o tenant vem do token, nunca do corpo; a implementação SQL usa o `db`
 * (RLS, papel macuxi_app) e a de memória separa por `tenant_id` (mesmo isolamento, para os testes multi-tenant).
 * Sem dado pessoal: as coletas guardam só ids, números, instantes e textos curtos da própria coleta.
 */
import { ErroHttpModulo, type ClienteBanco } from '@macuxi/platform-sdk';
import type { CadastroBko } from '../contracts';
import type { ColetaDaVisita, UsosCadastro, VisitaLojaGuardada } from '../domain';

export interface SessaoTenant {
  db: ClienteBanco;
  tenant_id: string;
}

/** Coleta já aceita (qualquer entidade de `COLETAS_DA_VISITA`), com o payload validado pelo contrato. */
export interface ColetaGuardada {
  entidade: ColetaDaVisita;
  id: string;
  visita_loja_id: string;
  promotor_id: string;
  cliente_id: string;
  payload: Readonly<Record<string, unknown>>;
  /** Instante do servidor em que a coleta foi aceita (UTC). */
  recebido_em: string;
}

export interface FiltroVisitas {
  /** Dias civis (inclusivos) no fuso do tenant, comparados com a data local do check-in. */
  de: string;
  ate: string;
  fuso: string;
  cliente_id?: string;
}

/** Linha de um cadastro de trade como o pull a entrega (campos do contrato `*Sync`; `deleted_at` preenchido = desativado). */
export type LinhaCadastro = Record<string, unknown> & { id: string; updated_at: string; deleted_at: string | null; external_id: string | null };

export interface RepositorioPromotor {
  /** Visita de loja pelo id (a implementação SQL trava a linha até o fim da transação: envios simultâneos viram um). */
  visita(s: SessaoTenant, id: string): Promise<VisitaLojaGuardada | null>;
  /** Insere ou atualiza (checkout) a visita de loja. */
  gravarVisita(s: SessaoTenant, v: VisitaLojaGuardada): Promise<void>;
  coleta(s: SessaoTenant, entidade: ColetaDaVisita, id: string): Promise<ColetaGuardada | null>;
  gravarColeta(s: SessaoTenant, c: ColetaGuardada): Promise<void>;
  /** Coletas de uma entidade nas visitas informadas (fotos da visita, respostas do checklist, relatórios). */
  coletasDasVisitas(s: SessaoTenant, entidade: ColetaDaVisita, visitaLojaIds: readonly string[]): Promise<ColetaGuardada[]>;
  /** Visitas de loja com check-in no período (data local do check-in no fuso do tenant). */
  visitasDoPeriodo(s: SessaoTenant, filtro: FiltroVisitas): Promise<VisitaLojaGuardada[]>;
  /** Nome das categorias de gôndola (cadastro de trade); id sem cadastro fica fora do mapa. */
  nomesDasCategorias(s: SessaoTenant, ids: readonly string[]): Promise<ReadonlyMap<string, string>>;

  // --- cadastros de trade editados no BKO (T-0069, RF-PRO-11). Mesmas tabelas que o pull lê (`sync-cadastros.ts`):
  // toda escrita atualiza `updated_at` (e `deleted_at` na desativação), então o pull incremental leva a mudança. ---
  /** Cadastros do tenant; sem `incluirRemovidos` só os vivos (`deleted_at` nulo). Ordem estável (nome/ordem, depois id). */
  listarCadastro(s: SessaoTenant, cadastro: CadastroBko, incluirRemovidos: boolean): Promise<LinhaCadastro[]>;
  /** Uma linha pelo id, inclusive desativada; `null` se não existe neste tenant. A implementação SQL trava a linha. */
  cadastro(s: SessaoTenant, cadastro: CadastroBko, id: string): Promise<LinhaCadastro | null>;
  /** Insere (campos editáveis do contrato `*Edicao`, com `id` do cliente). Duplicidade de nome/versão = 409. */
  inserirCadastro(s: SessaoTenant, cadastro: CadastroBko, dados: Readonly<Record<string, unknown>>, agora: string): Promise<LinhaCadastro>;
  /** Atualiza os campos editáveis de uma linha viva e renova `updated_at`. */
  atualizarCadastro(s: SessaoTenant, cadastro: CadastroBko, id: string, dados: Readonly<Record<string, unknown>>, agora: string): Promise<LinhaCadastro>;
  /** Desativação lógica: `deleted_at` (e `ativo = false` onde existe) + `updated_at`. Nunca apaga a linha. */
  desativarCadastro(s: SessaoTenant, cadastro: CadastroBko, id: string, agora: string): Promise<LinhaCadastro>;
  /** Dependentes VIVOS (`deleted_at` nulo) da categoria ou do concorrente, no tenant (RN-PRO-12); zeros para os demais cadastros. */
  usosDoCadastro(s: SessaoTenant, cadastro: CadastroBko, id: string): Promise<UsosCadastro>;
}

/**
 * Implementação em memória (testes e desenvolvimento). NÃO usar em produção: some ao reiniciar o processo.
 * A API de produção usa `criarRepositorioSql()` (`api/repositorio-sql.ts`, schema `promotor`, migração 0015).
 */
export function criarRepositorioMemoria(
  fusoParaData: (instante: string, fuso: string) => string,
): RepositorioPromotor & { limpar(): void; definirCategoria(tenant_id: string, id: string, nome: string): void } {
  const visitas = new Map<string, Map<string, VisitaLojaGuardada>>();
  const categorias = new Map<string, Map<string, string>>();
  const coletas = new Map<string, Map<string, ColetaGuardada>>();
  const doTenant = <T>(m: Map<string, Map<string, T>>, t: string) => {
    let x = m.get(t);
    if (!x) m.set(t, (x = new Map()));
    return x;
  };
  const copia = <T>(v: T): T => structuredClone(v);
  const cadastros = new Map<string, Map<string, LinhaCadastro>>();
  const doCadastro = (t: string, c: CadastroBko) => doTenant(cadastros, `${t}|${c}`);
  /** Duplicidade que o banco recusa por índice único entre os vivos (nome sem diferenciar maiúsculas). */
  const duplicado = (t: string, c: CadastroBko, dados: Readonly<Record<string, unknown>>, ignorar: string | null): boolean => {
    if (c !== 'categoria_gondola' && c !== 'concorrente' && c !== 'produto_concorrente') return false;
    const nome = String(dados.nome).trim().toLowerCase();
    return [...doCadastro(t, c).values()].some(
      (l) => l.id !== ignorar && !l.deleted_at && String(l.nome).trim().toLowerCase() === nome && (c !== 'produto_concorrente' || l.concorrente_id === dados.concorrente_id),
    );
  };
  const MSG_DUP: Partial<Record<CadastroBko, string>> = {
    categoria_gondola: 'Já existe uma categoria com esse nome.',
    concorrente: 'Já existe um concorrente com esse nome.',
    produto_concorrente: 'Esse concorrente já tem um produto com esse nome.',
  };
  const ordenar = (c: CadastroBko, a: LinhaCadastro, b: LinhaCadastro) =>
    c === 'categoria_gondola' ? Number(a.ordem) - Number(b.ordem) || String(a.nome).localeCompare(String(b.nome)) || a.id.localeCompare(b.id) : String(a.nome ?? '').localeCompare(String(b.nome ?? '')) || a.id.localeCompare(b.id);

  return {
    async visita(s, id) {
      const v = doTenant(visitas, s.tenant_id).get(id);
      return v ? copia(v) : null;
    },
    async gravarVisita(s, v) {
      doTenant(visitas, s.tenant_id).set(v.id, copia(v));
    },
    async coleta(s, entidade, id) {
      const c = doTenant(coletas, s.tenant_id).get(`${entidade}:${id}`);
      return c ? copia(c) : null;
    },
    async gravarColeta(s, c) {
      doTenant(coletas, s.tenant_id).set(`${c.entidade}:${c.id}`, copia(c));
    },
    async coletasDasVisitas(s, entidade, ids) {
      const alvo = new Set(ids);
      return [...doTenant(coletas, s.tenant_id).values()].filter((c) => c.entidade === entidade && alvo.has(c.visita_loja_id)).map(copia);
    },
    async visitasDoPeriodo(s, f) {
      return [...doTenant(visitas, s.tenant_id).values()]
        .filter((v) => {
          const d = fusoParaData(v.checkin_em, f.fuso);
          return d >= f.de && d <= f.ate && (!f.cliente_id || v.cliente_id === f.cliente_id);
        })
        .map(copia);
    },
    async nomesDasCategorias(s, ids) {
      const doT = doTenant(categorias, s.tenant_id);
      const cad = doCadastro(s.tenant_id, 'categoria_gondola');
      const nome = (id: string) => doT.get(id) ?? (cad.has(id) ? String(cad.get(id)!.nome) : undefined);
      return new Map(ids.filter((id) => nome(id) !== undefined).map((id) => [id, nome(id)!] as const));
    },
    async listarCadastro(s, c, incluirRemovidos) {
      return [...doCadastro(s.tenant_id, c).values()].filter((l) => incluirRemovidos || !l.deleted_at).sort((a, b) => ordenar(c, a, b)).map(copia);
    },
    async cadastro(s, c, id) {
      const l = doCadastro(s.tenant_id, c).get(id);
      return l ? copia(l) : null;
    },
    async inserirCadastro(s, c, dados, agora) {
      if (duplicado(s.tenant_id, c, dados, null)) throw new ErroHttpModulo(409, 'CADASTRO_DUPLICADO', MSG_DUP[c]!);
      const linha = { ...copia(dados), id: String(dados.id), updated_at: agora, deleted_at: null, external_id: null } as LinhaCadastro;
      doCadastro(s.tenant_id, c).set(linha.id, linha);
      return copia(linha);
    },
    async atualizarCadastro(s, c, id, dados, agora) {
      const atual = doCadastro(s.tenant_id, c).get(id);
      if (!atual || atual.deleted_at) throw new ErroHttpModulo(404, 'CADASTRO_NAO_ENCONTRADO', 'Cadastro não encontrado.');
      if (duplicado(s.tenant_id, c, dados, id)) throw new ErroHttpModulo(409, 'CADASTRO_DUPLICADO', MSG_DUP[c]!);
      const linha = { ...atual, ...copia(dados), id, updated_at: agora } as LinhaCadastro;
      doCadastro(s.tenant_id, c).set(id, linha);
      return copia(linha);
    },
    async desativarCadastro(s, c, id, agora) {
      const atual = doCadastro(s.tenant_id, c).get(id);
      if (!atual) throw new ErroHttpModulo(404, 'CADASTRO_NAO_ENCONTRADO', 'Cadastro não encontrado.');
      const linha: LinhaCadastro = { ...atual, deleted_at: agora, updated_at: agora, ...('ativo' in atual ? { ativo: false } : {}) };
      doCadastro(s.tenant_id, c).set(id, linha);
      return copia(linha);
    },
    async usosDoCadastro(s, c, id) {
      const vivos = (outro: CadastroBko, campo: string) => [...doCadastro(s.tenant_id, outro).values()].filter((l) => !l.deleted_at && l[campo] === id).length;
      return {
        metas_share: c === 'categoria_gondola' ? vivos('meta_share', 'categoria_gondola_id') : 0,
        mix_obrigatorio: c === 'categoria_gondola' ? vivos('mix_obrigatorio', 'categoria_gondola_id') : 0,
        produtos_concorrente: c === 'categoria_gondola' ? vivos('produto_concorrente', 'categoria_gondola_id') : c === 'concorrente' ? vivos('produto_concorrente', 'concorrente_id') : 0,
      };
    },
    definirCategoria(tenant_id, id, nome) {
      doTenant(categorias, tenant_id).set(id, nome);
    },
    limpar() {
      visitas.clear();
      coletas.clear();
      categorias.clear();
      cadastros.clear();
    },
  };
}
