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

/** T-0089: registro vindo do ERP (tem `external_id`) tem código e parcelas fixos; a tela mostra os campos só para leitura ("Vem do ERP"). */
export const TEXTO_VEM_DO_ERP = 'Vem do ERP';
export function registroDoErp(r: { external_id?: string | null } | null | undefined): boolean {
  return Boolean(r?.external_id);
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

// ---------- abas, busca e filtros na URL ----------
export type AbaFormas = 'prazos' | 'formas';
export interface FiltrosFormas {
  /** Aba aberta; "prazos" é o padrão e não vai para a URL. */
  aba: AbaFormas;
  q: string;
  /** '1' = só ativos */
  ativas: '' | '1';
}
export const FILTROS_FORMAS_VAZIOS: FiltrosFormas = { aba: 'prazos', q: '', ativas: '' };

export function lerFiltrosFormas(busca: string): FiltrosFormas {
  const p = new URLSearchParams(busca);
  return { aba: p.get('aba') === 'formas' ? 'formas' : 'prazos', q: (p.get('q') ?? '').slice(0, 60), ativas: p.get('ativas') === '1' ? '1' : '' };
}
export function buscaDosFiltrosFormas(f: FiltrosFormas): string {
  const p = new URLSearchParams();
  if (f.aba === 'formas') p.set('aba', 'formas');
  if (f.q) p.set('q', f.q);
  if (f.ativas) p.set('ativas', f.ativas);
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Texto da busca sem diferenciar maiúsculas nem acentos. */
export function normalizarBusca(t: string): string {
  return t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
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

/** Prazos que passam pela busca (código, descrição, nome e código da forma) e por "só ativas", na ordem das formas. */
export function linhasDePrazos(formas: readonly FormaPagamento[], prazos: readonly PrazoPagamento[], f: FiltrosFormas): LinhaPrazo[] {
  const q = normalizarBusca(f.q);
  const linhas: LinhaPrazo[] = [];
  for (const forma of formas) {
    for (const prazo of prazos) {
      if (prazo.forma_pagamento_id !== forma.id) continue;
      if (f.ativas && !(prazo.ativo && forma.ativo)) continue;
      if (q && ![prazo.codigo, prazo.descricao, forma.nome, forma.codigo].some((x) => normalizarBusca(x).includes(q))) continue;
      linhas.push({ prazo, formaNome: forma.nome, formaCodigo: forma.codigo, formaAtiva: forma.ativo });
    }
  }
  return linhas;
}

/** Formas que passam pela busca (código e nome) e por "só ativas". */
export function linhasDeFormas(formas: readonly FormaPagamento[], f: FiltrosFormas): FormaPagamento[] {
  const q = normalizarBusca(f.q);
  return formas.filter((x) => (!f.ativas || x.ativo) && (!q || normalizarBusca(x.codigo).includes(q) || normalizarBusca(x.nome).includes(q)));
}

// ---------- Desc./Acrésc. (%) do prazo ----------
const MENOS = '\u2212';
const TRACO = '\u2014';
const PERCENTUAL = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "−1,71%", "+2,50%", "0,00%"; "—" quando o valor não veio. */
export function formatarPercentualPrazo(valor: number | null | undefined): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return TRACO;
  const abs = PERCENTUAL.format(Math.abs(valor));
  if (valor > 0) return `+${abs}%`;
  if (valor < 0 && abs !== '0,00') return `${MENOS}${abs}%`;
  return `${abs}%`;
}

/**
 * % de desconto/acréscimo do prazo (vem do ERP, só leitura). TODO(sessão nuvem/prazo-ajuste-modulo-vendedor): o campo
 * `percentual_ajuste` ainda não existe em `PrazoPagamento`; quando o contrato o trouxer, esta leitura passa a devolver o número.
 */
export function percentualDoPrazo(prazo: PrazoPagamento): number | null {
  if ('percentual_ajuste' in prazo) {
    const v = (prazo as PrazoPagamento & { percentual_ajuste?: unknown }).percentual_ajuste;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

// ---------- CSV ----------
export const PRAZOS_CSV_HEADER = ['Forma', 'Código da forma', 'Prazo', 'Código do prazo', 'Prazo médio (dias)', 'Situação', 'Origem'];
export function prazosToCsv(linhas: readonly LinhaPrazo[]): string {
  const rows: Array<Array<string | number>> = [PRAZOS_CSV_HEADER];
  for (const l of linhas) rows.push([l.formaNome, l.formaCodigo, l.prazo.descricao, l.prazo.codigo, l.prazo.prazo_medio_dias, prazoEfetivamenteAtivo(l) ? 'Ativo' : 'Inativo', l.prazo.external_id ? 'ERP' : 'BKO']);
  return toCsv(rows);
}
export const FORMAS_CSV_HEADER = ['Código', 'Forma', 'Ordem', 'Situação', 'Origem'];
export function formasToCsv(formas: readonly FormaPagamento[]): string {
  const rows: Array<Array<string | number>> = [FORMAS_CSV_HEADER];
  for (const f of formas) rows.push([f.codigo, f.nome, f.ordem, f.ativo ? 'Ativa' : 'Inativa', f.external_id ? 'ERP' : 'BKO']);
  return toCsv(rows);
}
