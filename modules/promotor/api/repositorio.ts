/**
 * Armazenamento das coletas do Promotor na API (T-0056), atrás de uma interface: as rotas e o push não sabem se é
 * Postgres (schema `promotor`, migração 0015 do banco-dados) ou memória (testes). Toda chamada recebe a `SessaoTenant`
 * da transação aberta por `ctx.comTenant` — o tenant vem do token, nunca do corpo; a implementação SQL usa o `db`
 * (RLS, papel macuxi_app) e a de memória separa por `tenant_id` (mesmo isolamento, para os testes multi-tenant).
 * Sem dado pessoal: as coletas guardam só ids, números, instantes e textos curtos da própria coleta.
 */
import type { ClienteBanco } from '@macuxi/platform-sdk';
import type { ColetaDaVisita, VisitaLojaGuardada } from '../domain';

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
      return new Map(ids.filter((id) => doT.has(id)).map((id) => [id, doT.get(id)!] as const));
    },
    definirCategoria(tenant_id, id, nome) {
      doTenant(categorias, tenant_id).set(id, nome);
    },
    limpar() {
      visitas.clear();
      coletas.clear();
      categorias.clear();
    },
  };
}
