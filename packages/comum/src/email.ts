/**
 * RD-0020 (T-0094): formato de e-mail ÚNICO dos formulários (login, Esqueci, Equipe, CLI do super-admin). Só o formato
 * mínimo (`algo@dominio.tld`, sem espaço e com um `@`): quem diz se o e-mail existe é o envio. Puro.
 */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** `true` se `texto` (já sem espaços nas pontas) tem formato de e-mail. Até 254 caracteres (RFC 5321). */
export function ehEmail(texto: unknown): boolean {
  return typeof texto === 'string' && texto.length <= 254 && EMAIL_RE.test(texto);
}
