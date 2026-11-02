/**
 * CNPJ e CPF (RN-CORE-16, RN-INT-14): validação do dígito verificador, tipo do documento e formatação. Funções puras,
 * usadas pelo domain do Core (cadastro mínimo), pelo Hub (documento inválido = ausente) e pelas telas. Documento é dado
 * pessoal quando CPF: nunca vai para log nem para mensagem de erro (só o nome do campo).
 * `completarCnpj`/`completarCpf` geram documento FICTÍCIO válido a partir de uma base (seeds e testes; T-0060).
 */

export type TipoDocumento = 'cnpj' | 'cpf';

export function somenteDigitos(valor: string | null | undefined): string {
  return (valor ?? '').replace(/\D/g, '');
}

const repetido = (d: string): boolean => /^(\d)\1*$/.test(d);

function dvCnpj(base: string): string {
  const calc = (s: string): number => {
    const pesos = s.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = pesos.reduce((acc, p, i) => acc + p * Number(s[i]), 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(base);
  const d2 = calc(base + String(d1));
  return `${d1}${d2}`;
}

function dvCpf(base: string): string {
  const calc = (s: string): number => {
    const peso0 = s.length + 1;
    const soma = [...s].reduce((acc, c, i) => acc + Number(c) * (peso0 - i), 0);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = calc(base);
  const d2 = calc(base + String(d1));
  return `${d1}${d2}`;
}

export function cnpjValido(valor: string | null | undefined): boolean {
  const d = somenteDigitos(valor);
  if (d.length !== 14 || repetido(d)) return false;
  return dvCnpj(d.slice(0, 12)) === d.slice(12);
}

export function cpfValido(valor: string | null | undefined): boolean {
  const d = somenteDigitos(valor);
  if (d.length !== 11 || repetido(d)) return false;
  return dvCpf(d.slice(0, 9)) === d.slice(9);
}

/** `cnpj`, `cpf` ou `null` (vazio ou dígito verificador inválido — RN-INT-14: inválido conta como ausente). */
export function tipoDocumento(valor: string | null | undefined): TipoDocumento | null {
  if (cnpjValido(valor)) return 'cnpj';
  if (cpfValido(valor)) return 'cpf';
  return null;
}

/** Base de 12 dígitos → CNPJ de 14 com os dígitos verificadores (fictício; seeds e testes). */
export function completarCnpj(base12: string): string {
  if (!/^\d{12}$/.test(base12)) throw new Error('A base do CNPJ precisa de 12 dígitos.');
  return base12 + dvCnpj(base12);
}

/** Base de 9 dígitos → CPF de 11 com os dígitos verificadores (fictício; seeds e testes). */
export function completarCpf(base9: string): string {
  if (!/^\d{9}$/.test(base9)) throw new Error('A base do CPF precisa de 9 dígitos.');
  return base9 + dvCpf(base9);
}

/** 00.000.000/0000-00 ou 000.000.000-00; outro tamanho volta como veio (só dígitos não é forçado). */
export function formatarDocumento(valor: string | null | undefined): string {
  const d = somenteDigitos(valor);
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return valor ?? '';
}
