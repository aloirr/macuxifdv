/**
 * BKO Marcas concorrentes (T-0113, RN-CAT-13, ADR 0034): funções puras da tela — filtros na URL, CSV e texto da confirmação.
 * A regra do nome e da confirmação é do domain; a API revalida.
 */
import { protegerFormula } from '@macuxi/comum/csv';
import type { MarcaListaSaida } from '../../contracts';

export type SituacaoMarcas = 'ativas' | 'inativas' | 'todas';
export interface FiltrosMarcas {
  situacao: SituacaoMarcas;
  q: string;
}
const SITUACOES: readonly SituacaoMarcas[] = ['ativas', 'inativas', 'todas'];

export function lerFiltrosMarcas(busca: string): FiltrosMarcas {
  const p = new URLSearchParams(busca);
  const s = p.get('situacao') as SituacaoMarcas | null;
  return { situacao: s && SITUACOES.includes(s) ? s : 'ativas', q: p.get('q') ?? '' };
}

export function buscaDosFiltrosMarcas(f: FiltrosMarcas): string {
  const p = new URLSearchParams();
  if (f.situacao !== 'ativas') p.set('situacao', f.situacao);
  if (f.q.trim()) p.set('q', f.q.trim());
  const t = p.toString();
  return t ? `?${t}` : '';
}

const BOM = '﻿';
const celula = (v: string | number) => {
  const s = typeof v === 'string' ? protegerFormula(v) : String(v);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV da lista (padrão do Excel brasileiro: `;`, CRLF e BOM). */
export function marcasParaCsv(marcas: MarcaListaSaida['marcas']): string {
  const linhas: (string | number)[][] = [['Marca', 'Situação', 'Referências', 'Código no ERP'], ...marcas.map((m) => [m.nome, m.ativo ? 'Ativa' : 'Inativa', m.referencias, m.external_id ?? ''])];
  return BOM + linhas.map((r) => r.map(celula).join(';')).join('\r\n') + '\r\n';
}
