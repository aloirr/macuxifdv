/**
 * Estoque visível (RF-CAT-03, RN-CAT-07): saldo só das filiais/depósitos do usuário, em faixas (disponível, baixo
 * até [10], sem estoque), número exato visível por padrão, "desatualizado" depois de [24] h e sempre com o
 * instante da atualização para a tela mostrar "atualizado às hh:mm" (`rotuloAtualizacaoEstoque`).
 * O saldo é o do ERP; reservas de pedido são descontadas pelo Vendedor (RN-VEN-20), não aqui.
 */
import { cargaDeHoje } from '@macuxi/core/contracts';
import type { EstoqueVisivel, FaixaEstoque, StockByBranch } from '../contracts';
import { localDate } from '@macuxi/comum';
import type { ParametrosCatalogo } from './parametros';

/** RN-CAT-07: aviso discreto quando `stale` é true. */
export const AVISO_ESTOQUE_DESATUALIZADO = 'Estoque desatualizado';
export const ROTULO_SEM_HORA = 'Sem hora de atualização';

export interface OpcoesEstoque {
  /** Filiais/depósitos do usuário. `null` = todas (analista, assistente, admin: escopo do tenant, RN-CORE-04). */
  filiais: readonly string[] | null;
  /** Instante da consulta (ISO UTC). */
  agora: string;
  parametros: Pick<ParametrosCatalogo, 'estoque_baixo_ate' | 'estoque_mostrar_quantidade' | 'estoque_defasado_horas'>;
}

/** Texto da faixa para as telas (app e BKO usam o mesmo). */
export const ROTULO_FAIXA_ESTOQUE: Record<FaixaEstoque, string> = { disponivel: 'Disponível', baixo: 'Estoque baixo', sem_estoque: 'Sem estoque' };

/** 0 ou menos = sem estoque; de 1 até `baixoAte` = baixo; acima = disponível. */
export function faixaDeEstoque(quantidade: number, baixoAte: number): FaixaEstoque {
  if (quantidade <= 0) return 'sem_estoque';
  return quantidade <= baixoAte ? 'baixo' : 'disponivel';
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function estoqueVisivel(produtoId: string, saldos: readonly StockByBranch[], opcoes: OpcoesEstoque): EstoqueVisivel {
  const agora = Date.parse(opcoes.agora);
  if (Number.isNaN(agora)) throw new RangeError('Informe o instante da consulta em ISO 8601 UTC.');
  const { estoque_baixo_ate: baixoAte, estoque_mostrar_quantidade: mostrar, estoque_defasado_horas: horas } = opcoes.parametros;
  const permitidas = opcoes.filiais === null ? null : new Set(opcoes.filiais);

  const porFilial = new Map<string, { nome: string; quantidade: number; atualizado: number | null; semHora: boolean }>();
  for (const s of saldos) {
    if (permitidas && !permitidas.has(s.branch_id)) continue;
    const q = Number.isFinite(s.quantity) ? Math.max(0, Math.trunc(s.quantity)) : 0;
    const t = s.updated_at ? Date.parse(s.updated_at) : NaN;
    const atual = porFilial.get(s.branch_id) ?? { nome: s.branch_name, quantidade: 0, atualizado: null, semHora: false };
    atual.quantidade += q;
    if (Number.isNaN(t)) atual.semHora = true;
    else atual.atualizado = atual.atualizado === null ? t : Math.min(atual.atualizado, t);
    porFilial.set(s.branch_id, atual);
  }

  const filiais = [...porFilial.entries()].sort(([ia, a], [ib, b]) => cmp(a.nome, b.nome) || cmp(ia, ib));
  const total = filiais.reduce((acc, [, f]) => acc + f.quantidade, 0);
  const horas_conhecidas = filiais.map(([, f]) => f.atualizado).filter((t): t is number => t !== null);
  const maisAntiga = horas_conhecidas.length > 0 ? Math.min(...horas_conhecidas) : null;
  const algumSemHora = filiais.some(([, f]) => f.semHora);

  return {
    product_id: produtoId,
    band: faixaDeEstoque(total, baixoAte),
    quantity: mostrar ? total : null,
    by_branch: filiais.map(([id, f]) => ({
      branch_id: id,
      branch_name: f.nome,
      band: faixaDeEstoque(f.quantidade, baixoAte),
      quantity: mostrar ? f.quantidade : null,
    })),
    updated_at: maisAntiga === null ? null : new Date(maisAntiga).toISOString(),
    stale: filiais.length > 0 && (algumSemHora || (maisAntiga !== null && agora - maisAntiga > horas * 3_600_000)),
  };
}

/**
 * RN-CAT-07: "Atualizado às hh:mm" no fuso do tenant; se a atualização foi em outro dia (no fuso do tenant),
 * "Atualizado em dd/mm às hh:mm". Sem hora conhecida: "Sem hora de atualização".
 */
export function rotuloAtualizacaoEstoque(estoque: Pick<EstoqueVisivel, 'updated_at'>, agora: string, fuso: string): string {
  if (estoque.updated_at === null) return ROTULO_SEM_HORA;
  const t = new Date(estoque.updated_at);
  const a = new Date(agora);
  if (Number.isNaN(t.getTime()) || Number.isNaN(a.getTime())) throw new RangeError('Informe os instantes em ISO 8601 UTC.');
  const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t);
  if (localDate(t, fuso) === localDate(a, fuso)) return `Atualizado às ${hora}`;
  const dia = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, day: '2-digit', month: '2-digit' }).format(t);
  return `Atualizado em ${dia} às ${hora}`;
}

export interface EntradaFiliaisDoEstoque {
  /** Filial efetiva do cliente do contexto (Novo pedido, ficha do cliente); nula = sem cliente no contexto. */
  filialDoCliente: string | null;
  /** Vendedor/supervisor veem a carteira; analista, assistente e admin veem o tenant (RN-CORE-04). */
  escopo: 'carteira' | 'tenant';
  /** Filiais dos clientes da carteira + a padrão (`core.filiais@1 { escopo: 'carteira' }.da_carteira`); nulo = todas. */
  filiaisDaCarteira: readonly string[] | null;
}

/**
 * RN-CORE-39 + RN-CAT-07: filiais cujo saldo o usuário vê (o argumento `filiais` de `estoqueVisivel`). Com cliente no
 * contexto vale só a filial dele (sem saldo nela = 0, nunca o da padrão); sem cliente, a carteira ou o tenant todo (`null`).
 */
export function filiaisDoEstoque(e: EntradaFiliaisDoEstoque): readonly string[] | null {
  if (e.filialDoCliente !== null) return [e.filialDoCliente];
  return e.escopo === 'tenant' ? null : e.filiaisDaCarteira;
}

// ---------- carga diária do estoque no aparelho (ADR 0057, RN-CORE-61, RN-CAT-07) ----------
export interface EntradaCargaEstoque {
  /** Instante (ISO UTC) da última carga diária (`carga_diaria_em` do motor). */
  carga_diaria_em: string;
  agora: string;
  fuso: string;
  /** `estoque_carga_hora` do tenant (HH:MM). */
  hora: string;
}

export interface RotuloCargaEstoque {
  /** "às 06:12", "ontem às 06:12", "em 13/11 às 06:12" (outro ano: "em 13/11/2025 às 06:12"). */
  quando: string;
  /** RN-CAT-07: a carga de hoje (a partir de `estoque_carga_hora`) ainda não veio. */
  desatualizado: boolean;
}

/** RN-CAT-07: hora da carga diária no fuso do tenant; "hoje" e "ontem" são dias do calendário do tenant. */
export function rotuloCargaEstoque(e: EntradaCargaEstoque): RotuloCargaEstoque {
  const t = new Date(e.carga_diaria_em);
  const a = new Date(e.agora);
  if (Number.isNaN(t.getTime()) || Number.isNaN(a.getTime())) throw new RangeError('Informe os instantes em ISO 8601 UTC.');
  const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: e.fuso, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t);
  const diaT = localDate(t, e.fuso);
  const diaA = localDate(a, e.fuso);
  const ontem = localDate(new Date(a.getTime() - 86_400_000), e.fuso);
  const desatualizado = !cargaDeHoje({ ultima: e.carga_diaria_em, agora: a, fuso: e.fuso, hora: e.hora });
  if (diaT === diaA) return { quando: `às ${hora}`, desatualizado };
  if (diaT === ontem) return { quando: `ontem às ${hora}`, desatualizado };
  const mesmoAno = diaT.slice(0, 4) === diaA.slice(0, 4);
  const dia = new Intl.DateTimeFormat('pt-BR', { timeZone: e.fuso, day: '2-digit', month: '2-digit', ...(mesmoAno ? {} : { year: 'numeric' as const }) }).format(t);
  return { quando: `em ${dia} às ${hora}`, desatualizado };
}

/**
 * RN-CAT-07: na busca online, com a carga diária feita a disponibilidade exibida é a do aparelho (a mesma de todas as
 * telas); só com o catálogo pendente da 1ª carga (`carga_diaria_em` nulo) vale a da API.
 */
export function disponibilidadeDaBuscaOnline<T extends { id: string; availability: EstoqueVisivel | null }>(
  itensApi: readonly T[],
  locais: ReadonlyMap<string, EstoqueVisivel | null>,
  cargaDiariaEm: string | null | undefined,
): T[] {
  if (!cargaDiariaEm) return [...itensApi];
  return itensApi.map((i) => (locais.has(i.id) ? { ...i, availability: locais.get(i.id) ?? null } : i));
}
