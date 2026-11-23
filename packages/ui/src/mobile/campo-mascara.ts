/**
 * v1.0.28 (pré-cadastro de cliente no Campo; docs/design/telas/campo-cliente-pre-cadastro.md §3): parte PURA das máscaras do
 * `CampoTexto` (prop `mascara`). A máscara é progressiva: põe a pontuação conforme o vendedor digita, nunca deixa separador
 * pendurado no fim (o apagar não "trava") e corta o excesso de dígitos. Sem regra de negócio: se o CNPJ/CPF ou o CEP valem é
 * do domain (`cnpjValido`, `cpfValido`, `cepValido` de `@macuxi/comum`). O módulo guarda só os dígitos (`somenteDigitos`).
 * Sem react-native: roda em Node (Vitest).
 */

/** `documento`: CPF até 11 dígitos, CNPJ de 12 a 14 · `cep`: 00000-000 · `telefone`: (00) 0000-0000 ou (00) 00000-0000. */
export type MascaraCampo = 'documento' | 'cep' | 'telefone';

function digitos(texto: string): string {
  return texto.replace(/\D/g, '');
}

/** Encaixa os dígitos no padrão (`0` = dígito); o literal só entra quando ainda há dígito depois dele. */
function encaixar(d: string, padrao: string): string {
  let saida = '';
  let i = 0;
  let literal = '';
  for (const c of padrao) {
    if (i >= d.length) break;
    if (c === '0') {
      saida += literal + d.charAt(i);
      literal = '';
      i += 1;
    } else {
      literal += c;
    }
  }
  return saida;
}

const PADRAO = {
  cpf: '000.000.000-00',
  cnpj: '00.000.000/0000-00',
  cep: '00000-000',
  fixo: '(00) 0000-0000',
  celular: '(00) 00000-0000',
} as const;

/** Máximo de dígitos de cada máscara. */
export const DIGITOS_DA_MASCARA: Record<MascaraCampo, number> = { documento: 14, cep: 8, telefone: 11 };

/** "11222333000181" → "11.222.333/0001-81"; "6905" → "6905"; "929" → "(92) 9". Aceita texto já formatado. */
export function aplicarMascara(mascara: MascaraCampo, texto: string | null | undefined): string {
  const d = digitos(texto ?? '').slice(0, DIGITOS_DA_MASCARA[mascara]);
  if (mascara === 'cep') return encaixar(d, PADRAO.cep);
  if (mascara === 'telefone') return encaixar(d, d.length > 10 ? PADRAO.celular : PADRAO.fixo);
  return encaixar(d, d.length > 11 ? PADRAO.cnpj : PADRAO.cpf);
}

/** Props de teclado de cada máscara: teclado numérico, tamanho máximo do texto formatado e o preenchimento do sistema. */
export function propsDeTecladoDaMascara(mascara: MascaraCampo): {
  keyboardType: 'number-pad' | 'phone-pad';
  maxLength: number;
  autoComplete: 'off' | 'postal-code' | 'tel';
} {
  if (mascara === 'cep') return { keyboardType: 'number-pad', maxLength: PADRAO.cep.length, autoComplete: 'postal-code' };
  if (mascara === 'telefone') return { keyboardType: 'phone-pad', maxLength: PADRAO.celular.length, autoComplete: 'tel' };
  return { keyboardType: 'number-pad', maxLength: PADRAO.cnpj.length, autoComplete: 'off' };
}

/** Sufixo do rótulo do campo que a empresa deixou opcional (os obrigatórios não levam marca). */
export const SUFIXO_OPCIONAL = '(opcional)';

/** TalkBack do rótulo: "Complemento, opcional" · obrigatório: só o rótulo. */
export function leituraDoRotulo(rotulo: string, opcional?: boolean): string {
  return opcional ? `${rotulo.trim()}, opcional` : rotulo.trim();
}
