/**
 * Máscara de dado pessoal em texto livre (CLAUDE.md regra 8: sem dado pessoal em log). Fonte única para o registro de erro
 * do shell (`limparDadoPessoal`, T-0088) e o log do Conector (`mascararTexto`), que tinham regras e marcadores diferentes
 * (observação `manter?` do corretor no RD-0032, R-20261109-023557).
 *
 * Só dado pessoal: e-mail, CNPJ, CPF, telefone (com e sem DDD), sequência longa de dígitos com separadores e valor em reais
 * com `R$` (T-0158: o diagnóstico nunca leva valor). Segredo
 * (senha, token, string de conexão) é assunto de quem loga e fica no chamador (o Conector aplica as regras dele ANTES
 * desta). O que NÃO pode sumir, para o suporte achar a causa: UUID, pilha (`index.bundle:1234:56789`), data e hora ISO
 * (`2026-11-08T21:11:00.000Z`) ou com espaço (`2026-11-09 02:50:00`) e número curto (pedido `000010`).
 */

/** Marcadores estáveis (testes e suporte procuram por eles). */
export const MARCADOR_DADO_PESSOAL = {
  email: '[e-mail]',
  cnpj: '[cnpj]',
  cpf: '[cpf]',
  telefone: '[telefone]',
  numero: '[número]',
  valor: '[valor]',
} as const;

const M = MARCADOR_DADO_PESSOAL;

/** Em ordem: e-mail primeiro (o usuário do e-mail pode ter dígitos), depois do mais longo ao mais curto. */
const REGRAS: readonly (readonly [RegExp, string])[] = [
  // letras acentuadas no usuário e no domínio; o `***@` da string de conexão já mascarada não casa (`*` antes do `@`)
  [/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*/gu, M.email],
  // valor em reais (T-0158, D-T0158-1: o diagnóstico nunca leva valor): `R$ 1.234,56`, `R$530,83`, `-R$ 10`, `R$ 1234.5`;
  // só com o `R$` na frente (número solto, data e hora ficam), antes das regras de número para sair inteiro
  [/-?R\$\s*-?\d(?:[\d.]*\d)?(?:,\d+)?/g, M.valor],
  [/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, M.cnpj],
  [/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, M.cpf],
  // com DDD: (92) 99123-4567, 92 3234-5678, 92991234567
  // (ponto final de frase vale como borda; `.` seguido de dígito, não)
  [/(?<![\w:.\-[])\(?\d{2}\)?[\s-]?9?\d{4}-?\d{4}(?![\w\-\]:]|\.\d)/g, M.telefone],
  // sem DDD: 99123-4567, 3234-5678, 991234567 (o segmento de 8 dígitos do UUID e o `:linha` da pilha ficam)
  [/(?<![\w:.\-[])\d{4,5}-?\d{4}(?![\w\-\]:]|\.\d)/g, M.telefone],
  // qualquer outra sequência longa com separadores (documento com máscara fora do padrão, conta, cartão);
  // `:` fora das bordas preserva a hora (`2026-11-09 02:50`) e a pilha
  [/(?<![\p{L}\p{N}:-])\d[\d.\-/() ]{9,}\d(?![\p{L}\p{N}:-])/gu, M.numero],
];

/** UUID inteiro (até o só de dígitos) é id técnico, nunca dado pessoal: passa fora das regras. */
const UUID = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

function mascararTrecho(trecho: string): string {
  let t = trecho;
  for (const [re, troca] of REGRAS) t = t.replace(re, troca);
  return t;
}

/** Troca o dado pessoal do texto por marcadores (`[e-mail]`, `[cnpj]`, `[cpf]`, `[telefone]`, `[número]`). Pura. */
export function mascararDadoPessoal(texto: string): string {
  // split com grupo de captura: os índices ímpares são os UUIDs, que passam inteiros
  return texto
    .split(UUID)
    .map((parte, i) => (i % 2 === 1 ? parte : mascararTrecho(parte)))
    .join('');
}
