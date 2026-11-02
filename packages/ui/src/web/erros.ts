/**
 * T-0059 (R-20261102-091519 item 2): padrão de erro do BKO — o usuário nunca vê JSON de validação, pilha nem
 * mensagem de programador. A mensagem técnica vai só para o console; a tela mostra uma frase em português.
 * Puro (roda em Node nos testes). Usado pelo `ErrorBlock` e por quem montar mensagem de erro na web.
 */

/** Mensagem padrão quando o erro não é apresentável. */
export const MENSAGEM_ERRO_PADRAO = 'Não foi possível carregar estes dados. Tente de novo; se continuar, avise o suporte.';

const TECNICO: readonly RegExp[] = [
  /^\s*[[{]/, // JSON (ex.: issues do Zod: [{"code":"invalid_type",...}])
  /"code"\s*:\s*"/,
  /\binvalid_type\b|\binvalid_union\b|\binvalid_enum_value\b/,
  /Expected [\w ]+, received \w+/,
  /\bZodError\b/,
  /\b(TypeError|ReferenceError|SyntaxError|RangeError)\b/,
  /Cannot read propert(y|ies) of (undefined|null)/,
  /\bis not a function\b|\bis not defined\b|\bundefined is not\b/,
  /Unexpected token .* in JSON|JSON\.parse|Unexpected end of JSON/,
  /\bat \S+ \(.*:\d+:\d+\)/, // linha de pilha
];

/** A mensagem é técnica (não deve ir para a tela)? */
export function ehMensagemTecnica(mensagem: string | null | undefined): boolean {
  if (!mensagem || !mensagem.trim()) return true;
  return TECNICO.some((r) => r.test(mensagem));
}

/**
 * Mensagem apresentável: a original quando já é uma frase para o usuário (as da API vêm em português no envelope de
 * erro); senão, `padrao`, e a técnica vai para o console (sem dado pessoal: só a mensagem do erro).
 */
export function mensagemParaTela(mensagem: string | null | undefined, padrao: string = MENSAGEM_ERRO_PADRAO, log: (m: string) => void = (m) => console.error('[erro na tela]', m)): string {
  if (!ehMensagemTecnica(mensagem)) return mensagem!.trim();
  if (mensagem) log(mensagem);
  return padrao;
}
