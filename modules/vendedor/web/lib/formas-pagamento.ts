/**
 * Formas de pagamento e prazos no BKO, só consulta (RN-VEN-24, ADR 0072): tudo vem do ERP pelo Hub. Funções puras (testadas):
 * filtros na URL, tabela única de prazos (a forma é uma coluna) e CSV. A proteção real é na API
 * (`/v1/vendedor/formas-pagamento`, ação `forma_pagamento.ver`; a escrita é recusada com 403 `FORMAS_DO_ERP`).
 */
import { normalizarBusca } from '@macuxi/core/contracts';
import type { FormaPagamento, PrazoPagamento } from '../../contracts';
import { descricaoDoPrazo } from '../../domain/pagamento';
import { toCsv } from './csv';

/** Dias das parcelas na tabela: "30/60/90"; à vista (`[0]`) = "À vista". */
export function diasDasParcelas(p: readonly number[]): string {
  return p.length === 1 && p[0] === 0 ? 'À vista' : p.join('/');
}

/** Prazo médio digitado no ERP: "42 dias" (singular em 1). */
export function textoDoPrazoMedio(dias: number): string {
  return `${dias} ${dias === 1 ? 'dia' : 'dias'}`;
}

// ---------- busca e filtros na URL ----------
export interface FiltrosFormas {
  q: string;
  /** id da forma; vazio = todas */
  forma: string;
  /** '1' = só ativos */
  ativas: '' | '1';
}
export const FILTROS_FORMAS_VAZIOS: FiltrosFormas = { q: '', forma: '', ativas: '' };

export function lerFiltrosFormas(busca: string): FiltrosFormas {
  const p = new URLSearchParams(busca);
  return { q: (p.get('q') ?? '').slice(0, 60), forma: (p.get('forma') ?? '').slice(0, 36), ativas: p.get('ativas') === '1' ? '1' : '' };
}
export function buscaDosFiltrosFormas(f: FiltrosFormas): string {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.forma) p.set('forma', f.forma);
  if (f.ativas) p.set('ativas', f.ativas);
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Linha da tabela única de prazos: o prazo com a forma como coluna. */
export interface LinhaPrazo {
  prazo: PrazoPagamento;
  formaNome: string;
  formaCodigo: string;
  formaAtiva: boolean;
}

/** Prazo só vale se ele e a sua forma estão ativos. */
export function prazoEfetivamenteAtivo(l: Pick<LinhaPrazo, 'prazo' | 'formaAtiva'>): boolean {
  return l.formaAtiva && l.prazo.ativo;
}

/** Descrição na tabela: prazo inativo (ou de forma inativa) leva " · inativo" ao fim, para a situação não depender só da cor. */
export function descricaoNaTabela(l: Pick<LinhaPrazo, 'prazo' | 'formaAtiva'>): string {
  return prazoEfetivamenteAtivo(l) ? descricaoDoPrazo(l.prazo) : `${descricaoDoPrazo(l.prazo)} · inativo`;
}

/** Prazos que passam pela busca (código, descrição, nome e código da forma), pela forma escolhida e por "só ativos", na ordem das formas. */
export function linhasDePrazos(formas: readonly FormaPagamento[], prazos: readonly PrazoPagamento[], f: FiltrosFormas): LinhaPrazo[] {
  const q = normalizarBusca(f.q);
  const linhas: LinhaPrazo[] = [];
  for (const forma of formas) {
    if (f.forma && forma.id !== f.forma) continue;
    for (const prazo of prazos) {
      if (prazo.forma_pagamento_id !== forma.id) continue;
      if (f.ativas && !prazoEfetivamenteAtivo({ prazo, formaAtiva: forma.ativo })) continue;
      if (q && ![prazo.codigo, prazo.descricao, forma.nome, forma.codigo].some((x) => normalizarBusca(x).includes(q))) continue;
      linhas.push({ prazo, formaNome: forma.nome, formaCodigo: forma.codigo, formaAtiva: forma.ativo });
    }
  }
  return linhas;
}

// ---------- CSV (as colunas da tabela) ----------
export const PRAZOS_CSV_HEADER = ['Código', 'Descrição', 'Forma', 'Prazo (dias)', 'Prazo médio (dias)'];
export function prazosToCsv(linhas: readonly LinhaPrazo[]): string {
  const rows: Array<Array<string | number>> = [PRAZOS_CSV_HEADER];
  for (const l of linhas) rows.push([l.prazo.codigo, descricaoDoPrazo(l.prazo), l.formaNome, diasDasParcelas(l.prazo.parcelas_dias), l.prazo.prazo_medio_dias]);
  return toCsv(rows);
}
