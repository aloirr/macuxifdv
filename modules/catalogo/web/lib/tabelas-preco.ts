/**
 * BKO Tabelas de preço (T-0089): o preço da UNIDADE (RN-VEN-15 nova, sem preço de caixa) e a aba Escalonada (RN-VEN-23).
 * Funções puras da tela: filtros na URL, formulário da faixa, preço em reais e CSV. A regra de validade da faixa é do domain
 * (`validarFaixa`); a API revalida.
 */
import { BOM_CSV, protegerFormula } from '@macuxi/comum/csv';
import type { FaixaCadastrada, PrecoUnidadeLinha, SalvarFaixa } from '../../contracts';
import { validarFaixa } from '../../domain/escalonada';

export type AbaTabelas = 'precos' | 'escalonada';
export interface FiltrosTabelas {
  aba: AbaTabelas;
  /** Id da tabela de preço (na aba Preço da UN é obrigatória na prática; na Escalonada filtra). */
  tabela: string;
  /** Filial dos preços (RN-CORE-39); vazio = a padrão do tenant. */
  filial: string;
  q: string;
  /** Só as faixas vigentes hoje. */
  vigente: boolean;
}
const ABAS: readonly AbaTabelas[] = ['precos', 'escalonada'];

export function lerFiltrosTabelas(busca: string): FiltrosTabelas {
  const p = new URLSearchParams(busca);
  const aba = p.get('aba') as AbaTabelas | null;
  return { aba: aba && ABAS.includes(aba) ? aba : 'precos', tabela: p.get('tabela') ?? '', filial: p.get('filial') ?? '', q: p.get('q') ?? '', vigente: p.get('vigente') === '1' };
}

export function buscaDosFiltrosTabelas(f: FiltrosTabelas): string {
  const p = new URLSearchParams();
  if (f.aba !== 'precos') p.set('aba', f.aba);
  if (f.tabela) p.set('tabela', f.tabela);
  if (f.filial) p.set('filial', f.filial);
  if (f.q) p.set('q', f.q);
  if (f.vigente) p.set('vigente', '1');
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Reais digitados ("15,90", "1.234,5") para centavos inteiros, sem ponto flutuante; nulo se inválido ou com mais de 2 casas. */
export function centavosDoTexto(texto: string): number | null {
  const t = texto.trim().replace(/\s/g, '').replace(/\./g, '');
  const m = /^(\d+)(?:,(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const centavos = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
  return Number.isSafeInteger(centavos) ? centavos : null;
}

/** Centavos para o campo de texto ("15,90"), sem separador de milhar (campo editável). */
export function textoDosCentavos(centavos: number): string {
  return `${Math.floor(centavos / 100)},${String(centavos % 100).padStart(2, '0')}`;
}

export interface FormFaixa {
  produto_id: string;
  /** Texto livre; vazio = unidade base. */
  medida: string;
  quantidade_minima: string;
  preco: string;
  vigencia_inicio: string;
  vigencia_fim: string;
  /** Vazio = todas as tabelas. */
  tabela_preco_id: string;
  ativo: boolean;
}
export const FORM_FAIXA_VAZIO: FormFaixa = { produto_id: '', medida: '', quantidade_minima: '', preco: '', vigencia_inicio: '', vigencia_fim: '', tabela_preco_id: '', ativo: true };

export function formDaFaixa(f: FaixaCadastrada): FormFaixa {
  return {
    produto_id: f.produto_id,
    medida: f.medida ?? '',
    quantidade_minima: String(f.quantidade_minima),
    preco: textoDosCentavos(f.preco_unidade_cents),
    vigencia_inicio: f.vigencia_inicio,
    vigencia_fim: f.vigencia_fim ?? '',
    tabela_preco_id: f.tabela_preco_id ?? '',
    ativo: f.ativo,
  };
}

export type ResultadoForm<T> = { ok: true; valor: T } | { ok: false; erro: string };

/** Formulário -> corpo do `PUT /escalonada/:id`; o erro diz o campo e o que fazer (RN-VEN-23). */
export function faixaDoForm(f: FormFaixa): ResultadoForm<SalvarFaixa> {
  if (!f.produto_id) return { ok: false, erro: 'Escolha o produto da faixa.' };
  const preco = centavosDoTexto(f.preco);
  if (preco === null || preco < 1) return { ok: false, erro: 'Informe o preço da unidade na faixa em reais, com até 2 casas (ex.: 15,90).' };
  const qtd = /^\d+$/.test(f.quantidade_minima.trim()) ? Number(f.quantidade_minima.trim()) : NaN;
  if (!Number.isInteger(qtd)) return { ok: false, erro: 'Informe a quantidade mínima como número inteiro, sem casas decimais.' };
  const valor: SalvarFaixa = {
    produto_id: f.produto_id,
    medida: f.medida.trim() === '' ? null : f.medida.trim().toUpperCase(),
    quantidade_minima: qtd,
    preco_unidade_cents: preco,
    vigencia_inicio: f.vigencia_inicio.trim(),
    vigencia_fim: f.vigencia_fim.trim() === '' ? null : f.vigencia_fim.trim(),
    tabela_preco_id: f.tabela_preco_id === '' ? null : f.tabela_preco_id,
    ativo: f.ativo,
  };
  const v = validarFaixa(valor);
  if (!v.ok) return { ok: false, erro: v.mensagem };
  return { ok: true, valor };
}

const celula = (v: string | number | null | undefined) => {
  const s = typeof v === 'string' ? protegerFormula(v) : v === null || v === undefined ? '' : String(v);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (linhas: (string | number | null)[][]) => BOM_CSV + linhas.map((r) => r.map(celula).join(';')).join('\r\n') + '\r\n';

/** CSV da aba Escalonada (padrão do Excel brasileiro: `;`, CRLF e BOM). */
export function faixasParaCsv(faixas: readonly FaixaCadastrada[]): string {
  return csv([
    ['Código', 'Produto', 'Medida', 'Quantidade mínima', 'Preço da unidade (R$)', 'Tabela', 'Início', 'Fim', 'Situação', 'Origem'],
    ...faixas.map((f) => [f.sku, f.nome, f.medida ?? 'Unidade', f.quantidade_minima, textoDosCentavos(f.preco_unidade_cents), f.tabela_preco_nome ?? 'Todas', f.vigencia_inicio, f.vigencia_fim ?? '', f.ativo ? 'Ativa' : 'Inativa', f.origem === 'erp' ? 'ERP' : 'Cadastrada aqui']),
  ]);
}

/** CSV do preço da UN da tabela (instantes viram a data AAAA-MM-DD). */
export function precosParaCsv(linhas: readonly PrecoUnidadeLinha[]): string {
  const dia = (v: string | null) => (v ? v.slice(0, 10) : '');
  return csv([['Código', 'Produto', 'Preço da unidade (R$)', 'Início', 'Fim'], ...linhas.map((l) => [l.sku, l.nome, textoDosCentavos(l.preco_cents), dia(l.vigencia_inicio), dia(l.vigencia_fim)])]);
}
