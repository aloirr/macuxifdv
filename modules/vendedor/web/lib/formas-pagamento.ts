/**
 * Formas de pagamento e prazos no BKO (RN-VEN-24, T-0089): validação do formulário, parcelas digitadas ("28/56", "à vista"),
 * prévia do prazo médio (a mesma função do servidor) e CSV. Funções puras (testadas); a proteção real é na API
 * (`/v1/vendedor/formas-pagamento`, ações `forma_pagamento.ver|gerenciar`), a tela só reflete e avisa antes.
 */
import type { FormaPagamento, PrazoPagamento } from '../../contracts';
import { descricaoPrazo, prazoMedioDias } from '../../domain/pagamento';
import { toCsv } from './csv';

export interface FormForma {
  codigo: string;
  nome: string;
  ordem: string;
  ativo: boolean;
}
export const FORM_FORMA_VAZIO: FormForma = { codigo: '', nome: '', ordem: '0', ativo: true };

export interface FormPrazo {
  forma_pagamento_id: string;
  codigo: string;
  /** "28/56", "30 60 90", "à vista" */
  parcelas: string;
  ordem: string;
  ativo: boolean;
}
export const FORM_PRAZO_VAZIO: FormPrazo = { forma_pagamento_id: '', codigo: '', parcelas: '', ordem: '0', ativo: true };

/** Lê as parcelas digitadas: dias separados por barra, vírgula ou espaço; "à vista" vira [0]. `null` = texto inválido. */
export function parcelasDoTexto(texto: string): number[] | null {
  const t = texto.trim().toLowerCase();
  if (t === '') return null;
  if (/^(a|à)\s*vista$/.test(t)) return [0];
  const partes = t.split(/[\s/,;]+/).filter(Boolean);
  if (partes.length === 0 || partes.length > 24) return null;
  const dias = partes.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  if (dias.some((d) => !Number.isInteger(d) || d < 0 || d > 365)) return null;
  return dias;
}

/** "28/56" a partir das parcelas (volta para o campo na edição). */
export function textoDasParcelas(p: readonly number[]): string {
  return p.length === 1 && p[0] === 0 ? 'à vista' : p.join('/');
}

/** Prévia que a tela mostra enquanto digita: "28/56 dias · prazo médio 42 dias". `null` = ainda inválido. */
export function previaDoPrazo(texto: string): { descricao: string; prazoMedio: number } | null {
  const p = parcelasDoTexto(texto);
  if (!p || p.some((d, i) => i > 0 && d < p[i - 1]!)) return null;
  return { descricao: descricaoPrazo(p), prazoMedio: prazoMedioDias(p) };
}

type Erros<T> = Partial<Record<keyof T, string>>;

/** Erros por campo, em português com a ação seguinte. Vazio = pode salvar. */
export function validarForma(f: FormForma, existentes: readonly FormaPagamento[], idAtual: string | null): Erros<FormForma> {
  const e: Erros<FormForma> = {};
  const codigo = f.codigo.trim().toUpperCase();
  if (codigo.length < 1 || codigo.length > 20) e.codigo = 'Informe o código (até 20 caracteres), por exemplo PIX.';
  else if (existentes.some((x) => x.id !== idAtual && x.codigo.toUpperCase() === codigo)) e.codigo = 'Já existe uma forma com este código. Use outro.';
  if (f.nome.trim().length < 1 || f.nome.trim().length > 60) e.nome = 'Informe o nome da forma (até 60 caracteres).';
  if (!/^\d{1,4}$/.test(f.ordem.trim())) e.ordem = 'A ordem é um número de 0 a 9999.';
  return e;
}

export function validarPrazo(f: FormPrazo, existentes: readonly PrazoPagamento[], idAtual: string | null): Erros<FormPrazo> {
  const e: Erros<FormPrazo> = {};
  if (!f.forma_pagamento_id) e.forma_pagamento_id = 'Escolha a forma deste prazo.';
  const codigo = f.codigo.trim().toUpperCase();
  if (codigo.length < 1 || codigo.length > 20) e.codigo = 'Informe o código (até 20 caracteres), por exemplo BOL-28-56.';
  else if (existentes.some((x) => x.id !== idAtual && x.codigo.toUpperCase() === codigo)) e.codigo = 'Já existe um prazo com este código. Use outro.';
  const p = parcelasDoTexto(f.parcelas);
  if (!p) e.parcelas = 'Informe os dias das parcelas, por exemplo 28/56 ou à vista.';
  else if (p.some((d, i) => i > 0 && d < p[i - 1]!)) e.parcelas = 'Os dias das parcelas não podem diminuir (por exemplo 30/60/90).';
  if (!/^\d{1,4}$/.test(f.ordem.trim())) e.ordem = 'A ordem é um número de 0 a 9999.';
  return e;
}

export function formDaForma(f: FormaPagamento): FormForma {
  return { codigo: f.codigo, nome: f.nome, ordem: String(f.ordem), ativo: f.ativo };
}
export function formDoPrazo(p: PrazoPagamento): FormPrazo {
  return { forma_pagamento_id: p.forma_pagamento_id, codigo: p.codigo, parcelas: textoDasParcelas(p.parcelas_dias), ordem: String(p.ordem), ativo: p.ativo };
}

export function corpoDaForma(id: string, f: FormForma) {
  return { id, codigo: f.codigo.trim().toUpperCase(), nome: f.nome.trim(), ativo: f.ativo, ordem: Number(f.ordem.trim()) };
}
export function corpoDoPrazo(id: string, f: FormPrazo) {
  return { id, forma_pagamento_id: f.forma_pagamento_id, codigo: f.codigo.trim().toUpperCase(), parcelas_dias: parcelasDoTexto(f.parcelas) ?? [], ativo: f.ativo, ordem: Number(f.ordem.trim()) };
}

// ---------- filtros na URL ----------
export interface FiltrosFormas {
  q: string;
  /** '1' = só ativos */
  ativas: '' | '1';
}
export const FILTROS_FORMAS_VAZIOS: FiltrosFormas = { q: '', ativas: '' };

export function lerFiltrosFormas(busca: string): FiltrosFormas {
  const p = new URLSearchParams(busca);
  return { q: (p.get('q') ?? '').slice(0, 60), ativas: p.get('ativas') === '1' ? '1' : '' };
}
export function buscaDosFiltrosFormas(f: FiltrosFormas): string {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.ativas) p.set('ativas', f.ativas);
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Formas (e os prazos de cada uma) que passam pelos filtros: a busca olha código e nome da forma e o código do prazo. */
export function filtrarFormas(formas: readonly FormaPagamento[], prazos: readonly PrazoPagamento[], f: FiltrosFormas): { forma: FormaPagamento; prazos: PrazoPagamento[] }[] {
  const q = f.q.trim().toLowerCase();
  return formas
    .map((forma) => ({ forma, prazos: prazos.filter((p) => p.forma_pagamento_id === forma.id && (!f.ativas || p.ativo)) }))
    .filter(({ forma, prazos: ps }) => (!f.ativas || forma.ativo) && (!q || forma.codigo.toLowerCase().includes(q) || forma.nome.toLowerCase().includes(q) || ps.some((p) => p.codigo.toLowerCase().includes(q))));
}

// ---------- CSV ----------
export const FORMAS_CSV_HEADER = ['Forma', 'Código da forma', 'Prazo', 'Código do prazo', 'Prazo médio (dias)', 'Situação', 'Origem'];
export function formasToCsv(linhas: readonly { forma: FormaPagamento; prazos: readonly PrazoPagamento[] }[]): string {
  const rows: Array<Array<string | number>> = [FORMAS_CSV_HEADER];
  for (const { forma, prazos } of linhas) {
    if (prazos.length === 0) rows.push([forma.nome, forma.codigo, '', '', '', forma.ativo ? 'Ativa' : 'Inativa', forma.external_id ? 'ERP' : 'BKO']);
    for (const p of prazos) rows.push([forma.nome, forma.codigo, p.descricao, p.codigo, p.prazo_medio_dias, forma.ativo && p.ativo ? 'Ativo' : 'Inativo', p.external_id ? 'ERP' : 'BKO']);
  }
  return toCsv(rows);
}
