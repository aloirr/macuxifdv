/**
 * v1.0.30 (BKO › Clientes › Pré-cadastros recusados, docs/design/telas/bko-pre-cadastros-recusados.md §4): máscaras do campo
 * de texto do BKO ao digitar, iguais às do Campo (`CampoTexto mascara`). A regra de encaixe é a mesma do kit mobile
 * (`aplicarMascara`, parte pura em `src/comum`); aqui só entram as props do `<input>` da web. O módulo guarda e envia só os
 * dígitos (`somenteDigitos` de `@macuxi/comum`); se o valor vale é do domain.
 *
 * Sem `maxLength`: o navegador cortaria o texto colado antes da máscara agir ("+55 (92) 99123-4567" perderia os últimos
 * dígitos). Quem limita é a própria `aplicarMascara`, que corta o excesso de dígitos no `onChange`.
 */
import { aplicarMascara, type MascaraCampo } from '../comum/campo-mascara';

export { aplicarMascara, type MascaraCampo };

/** Props do `<input>` de cada máscara: teclado numérico/telefone e o preenchimento do navegador. */
export function propsDoInputComMascara(mascara: MascaraCampo): {
  inputMode: 'numeric' | 'tel';
  autoComplete: 'off' | 'postal-code' | 'tel';
} {
  if (mascara === 'cep') return { inputMode: 'numeric', autoComplete: 'postal-code' };
  if (mascara === 'telefone') return { inputMode: 'tel', autoComplete: 'tel' };
  return { inputMode: 'numeric', autoComplete: 'off' };
}
