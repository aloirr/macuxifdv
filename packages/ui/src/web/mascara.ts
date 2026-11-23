/**
 * v1.0.30 (BKO › Clientes › Pré-cadastros recusados, docs/design/telas/bko-pre-cadastros-recusados.md §4): máscaras do campo
 * de texto do BKO ao digitar, iguais às do Campo (`CampoTexto mascara`). A regra de encaixe é a mesma do kit mobile
 * (`aplicarMascara`, parte pura, sem react-native); aqui só entram as props do `<input>` da web. O módulo guarda e envia só os
 * dígitos (`somenteDigitos` de `@macuxi/comum`); se o valor vale é do domain.
 */
import { aplicarMascara, type MascaraCampo } from '../mobile/campo-mascara';

export { aplicarMascara, type MascaraCampo };

/** Tamanho do texto já formatado: CNPJ "00.000.000/0000-00", CEP "00000-000", celular "(00) 00000-0000". */
const MAX_FORMATADO: Record<MascaraCampo, number> = { documento: 18, cep: 9, telefone: 15 };

/** Props do `<input>` de cada máscara: teclado numérico/telefone, tamanho máximo do texto formatado e o preenchimento do navegador. */
export function propsDoInputComMascara(mascara: MascaraCampo): {
  inputMode: 'numeric' | 'tel';
  maxLength: number;
  autoComplete: 'off' | 'postal-code' | 'tel';
} {
  if (mascara === 'cep') return { inputMode: 'numeric', maxLength: MAX_FORMATADO.cep, autoComplete: 'postal-code' };
  if (mascara === 'telefone') return { inputMode: 'tel', maxLength: MAX_FORMATADO.telefone, autoComplete: 'tel' };
  return { inputMode: 'numeric', maxLength: MAX_FORMATADO.documento, autoComplete: 'off' };
}
