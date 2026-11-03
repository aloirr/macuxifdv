/**
 * Cadastro de transportadoras no BKO (RN-VEN-16, T-0061): validação do formulário, filtros na URL e CSV. Funções puras
 * (testadas); a proteção real é na API (`/v1/vendedor/transportadoras`), a tela só reflete e avisa antes.
 */
import { cnpjValido, formatarDocumento, somenteDigitos } from '@macuxi/comum';
import type { Transportadora } from '../../contracts';
import { toCsv } from './csv';

export interface FormTransportadora {
  nome: string;
  documento: string;
  inscricao_estadual: string;
  telefone: string;
}
export const FORM_VAZIO: FormTransportadora = { nome: '', documento: '', inscricao_estadual: '', telefone: '' };

export function formDaTransportadora(t: Transportadora): FormTransportadora {
  return { nome: t.nome, documento: t.documento ?? '', inscricao_estadual: t.inscricao_estadual ?? '', telefone: t.telefone ?? '' };
}

/** Erros por campo, em português com a ação seguinte. Vazio = pode salvar. */
export function validarForm(f: FormTransportadora): Partial<Record<keyof FormTransportadora, string>> {
  const e: Partial<Record<keyof FormTransportadora, string>> = {};
  if (f.nome.trim().length < 2) e.nome = 'Informe o nome da transportadora (mínimo 2 letras).';
  if (somenteDigitos(f.documento).length !== 14) e.documento = 'Informe o CNPJ com 14 dígitos.';
  else if (!cnpjValido(f.documento)) e.documento = 'CNPJ inválido: confira os dígitos.';
  if (f.telefone.trim().length > 30) e.telefone = 'Telefone muito longo (máximo 30 caracteres).';
  if (f.inscricao_estadual.trim().length > 20) e.inscricao_estadual = 'Inscrição estadual muito longa (máximo 20 caracteres).';
  return e;
}

export function corpoDoForm(f: FormTransportadora) {
  return {
    nome: f.nome.trim(),
    documento: somenteDigitos(f.documento),
    inscricao_estadual: f.inscricao_estadual.trim() || null,
    telefone: f.telefone.trim() || null,
  };
}

// ---------- filtros na URL ----------
export interface FiltrosTransportadoras {
  q: string;
  /** '1' = só ativas */
  ativas: '' | '1';
}
export const FILTROS_TRANSP_VAZIOS: FiltrosTransportadoras = { q: '', ativas: '' };

export function lerFiltrosTransportadoras(busca: string): FiltrosTransportadoras {
  const p = new URLSearchParams(busca);
  return { q: (p.get('q') ?? '').slice(0, 100), ativas: p.get('ativas') === '1' ? '1' : '' };
}
export function buscaDosFiltrosTransportadoras(f: FiltrosTransportadoras): string {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.ativas) p.set('ativas', f.ativas);
  const s = p.toString();
  return s ? `?${s}` : '';
}
export function queryDosFiltrosTransportadoras(f: FiltrosTransportadoras): Record<string, string> {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ''));
}

// ---------- CSV ----------
export const TRANSPORTADORAS_CSV_HEADER = ['Nome', 'CNPJ', 'Inscrição estadual', 'Telefone', 'Situação', 'Origem'];
export function transportadorasToCsv(l: readonly Transportadora[]): string {
  return toCsv([
    TRANSPORTADORAS_CSV_HEADER,
    ...l.map((t) => [t.nome, t.documento ? formatarDocumento(t.documento) : '', t.inscricao_estadual ?? '', t.telefone ?? '', t.ativo ? 'Ativa' : 'Inativa', t.external_id ? 'ERP' : 'BKO']),
  ]);
}
