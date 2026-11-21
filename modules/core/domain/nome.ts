/** Nome para saudação (Campo e BKO). */

/** R-20261114-145000: a primeira palavra do cadastro inteira, com a primeira letra (de cada parte do hífen) maiúscula e o resto minúsculo. */
export function primeiroNome(nomeCompleto: string): string {
  const primeira = nomeCompleto.trim().split(/\s+/)[0] ?? '';
  return primeira
    .split('-')
    .map((parte) => (parte ? parte.charAt(0).toLocaleUpperCase('pt-BR') + parte.slice(1).toLocaleLowerCase('pt-BR') : parte))
    .join('-');
}

/** "Boa tarde" + "LUCAS ANDRADE" → "Boa tarde, Lucas."; sem o nome, "Boa tarde." (sempre com ponto final). */
export function saudacaoComNome(saudacao: string, nomeCompleto: string): string {
  const primeiro = primeiroNome(nomeCompleto);
  return primeiro ? `${saudacao}, ${primeiro}.` : `${saudacao}.`;
}
