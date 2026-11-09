/**
 * Endereço brasileiro (RN-VEN-17, T-0141): as 27 UFs, CEP com 8 dígitos e a formatação 00000-000. Funções puras, usadas
 * pelo contrato do endereço do pedido (Vendedor), pelo domain que o valida e pelas telas (lista de UFs e máscara do CEP).
 * Endereço é dado pessoal quando é de pessoa física: nunca vai para log nem para mensagem de erro (só o nome do campo).
 */
import { somenteDigitos } from './documento';

export const UFS_BRASIL = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;
export type Uf = (typeof UFS_BRASIL)[number];

const UFS = new Set<string>(UFS_BRASIL);

/** Sigla de UF válida (aceita minúscula e espaço em volta). */
export function ehUf(valor: string | null | undefined): valor is Uf {
  return UFS.has((valor ?? '').trim().toUpperCase());
}

/** CEP só com os dígitos ("69053-000" → "69053000"). Não completa nem corta. */
export function normalizarCep(valor: string | null | undefined): string {
  return somenteDigitos(valor);
}

/** CEP com exatamente 8 dígitos, formatado ou não. "00000000" é inválido (não existe). */
export function cepValido(valor: string | null | undefined): boolean {
  const d = normalizarCep(valor);
  return d.length === 8 && d !== '00000000';
}

/** "69053000" → "69053-000"; o que não tem 8 dígitos volta como veio. */
export function formatarCep(valor: string | null | undefined): string {
  const d = normalizarCep(valor);
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : (valor ?? '');
}
