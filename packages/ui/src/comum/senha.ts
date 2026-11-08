/**
 * T-0093 (RN-CORE-32): textos e montagem da lista "A senha precisa ter", comuns ao kit web (portal e BKO) e ao kit mobile
 * (Campo e Gestão, "Crie sua senha" da T-0094). Puro (roda em Node nos testes). Spec: docs/design/portal-entrar.md §5.
 *
 * A REGRA (o que falta na senha) é do domain do Core (`faltasNaSenha`): a tela chama o Core a cada tecla e entrega aqui só as
 * faltas. O kit nunca confere a senha nem a recebe. `resumoDaSenha` monta a mesma frase de `mensagemDaSenha` do Core (texto
 * aprovado na spec); a tela pode passar a do Core em `resumo` para não haver duas fontes.
 */

/** Cada regra da RN-CORE-32, na ordem em que aparece na tela. Mesmos nomes de `faltasNaSenha` do Core. */
export type RegraSenha = 'caracteres' | 'letra' | 'numero' | 'especial';

export const REGRAS_DA_SENHA: readonly RegraSenha[] = ['caracteres', 'letra', 'numero', 'especial'];

export const TITULO_REGRAS_DA_SENHA = 'A senha precisa ter';

/** Rótulo visível de cada regra. */
export const ROTULO_REGRA_SENHA: Record<RegraSenha, string> = {
  caracteres: '8 caracteres ou mais',
  letra: 'Uma letra',
  numero: 'Um número',
  especial: 'Um caractere especial',
};

/** Exemplo ao lado do rótulo (só na tela; o leitor de tela não lê os símbolos). */
export const EXEMPLO_REGRA_SENHA: Partial<Record<RegraSenha, string>> = { especial: '! @ # $' };

/** Estado falado de cada regra pelo leitor de tela. */
export const ESTADO_FALADO_REGRA = { ok: 'ok', falta: 'falta' } as const;

/** Mensagem quando nada falta (região viva do leitor de tela). */
export const SENHA_ATENDE_AS_REGRAS = 'A senha atende às regras.';

/** Botão do olho no campo de senha. */
export const MOSTRAR_SENHA = 'Mostrar senha';
export const ESCONDER_SENHA = 'Esconder senha';

/** Como cada falta entra na frase ("Falta um número."). */
const FALTA_NA_FRASE: Record<Exclude<RegraSenha, 'caracteres'>, string> = {
  letra: 'uma letra',
  numero: 'um número',
  especial: 'um caractere especial',
};

/** "a", "a e b", "a, b e c". */
function emLista(partes: readonly string[]): string {
  if (partes.length <= 1) return partes[0] ?? '';
  return `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`;
}

/** Faltas conhecidas, sem repetição, na ordem da tela (valores estranhos são ignorados). */
export function faltasEmOrdem(faltas: readonly string[]): RegraSenha[] {
  const tem = new Set(faltas);
  return REGRAS_DA_SENHA.filter((r) => tem.has(r));
}

/**
 * Frase do que falta (texto aprovado; igual ao `mensagemDaSenha` do Core):
 * - nada: "A senha atende às regras."
 * - só o tamanho: "A senha precisa ter pelo menos 8 caracteres."
 * - tamanho e mais: "A senha precisa ter pelo menos 8 caracteres. Falta um número."
 * - sem o tamanho: "Falta um número." / "Faltam um número e um caractere especial."
 */
export function resumoDaSenha(faltas: readonly string[]): string {
  const f = faltasEmOrdem(faltas);
  if (f.length === 0) return SENHA_ATENDE_AS_REGRAS;
  const outras = f.filter((r): r is Exclude<RegraSenha, 'caracteres'> => r !== 'caracteres').map((r) => FALTA_NA_FRASE[r]);
  const partes: string[] = [];
  if (f.includes('caracteres')) partes.push('A senha precisa ter pelo menos 8 caracteres.');
  if (outras.length > 0) partes.push(`${outras.length === 1 ? 'Falta' : 'Faltam'} ${emLista(outras)}.`);
  return partes.join(' ');
}

/** `ok` = cumprida; `falta` = ainda não (neutra, enquanto digita); `erro` = falta depois de tentar salvar (`destacar`). */
export type EstadoRegraSenha = 'ok' | 'falta' | 'erro';

export interface ItemRegraSenha {
  regra: RegraSenha;
  rotulo: string;
  exemplo: string | null;
  estado: EstadoRegraSenha;
  /** "Um número: falta" (leitor de tela). */
  rotuloAcessivel: string;
}

/** Itens da lista, na ordem da tela. `destacar` (depois de tentar salvar) pinta as faltas como erro. */
export function itensDasRegras(faltas: readonly string[], destacar = false): ItemRegraSenha[] {
  const f = new Set(faltasEmOrdem(faltas));
  return REGRAS_DA_SENHA.map((regra) => {
    const cumprida = !f.has(regra);
    const estado: EstadoRegraSenha = cumprida ? 'ok' : destacar ? 'erro' : 'falta';
    const rotulo = ROTULO_REGRA_SENHA[regra];
    return { regra, rotulo, exemplo: EXEMPLO_REGRA_SENHA[regra] ?? null, estado, rotuloAcessivel: `${rotulo}: ${cumprida ? ESTADO_FALADO_REGRA.ok : ESTADO_FALADO_REGRA.falta}` };
  });
}

/**
 * T-0094 (RN-CORE-34): campo "Repita a senha" das telas "Crie sua senha" (app e BKO). A TELA compara as duas senhas e entrega só
 * o resultado (o kit continua sem receber senha nenhuma):
 * `repetida === '' ? 'vazia' : repetida === senhaNova ? 'igual' : 'diferente'`. Spec: docs/design/ciclo-de-senha.md §4.
 */
export type RepeticaoSenha = 'vazia' | 'igual' | 'diferente';

/** Rótulos dos dois campos da "Crie sua senha". */
export const CAMPO_SENHA_NOVA = 'Senha nova';
export const CAMPO_REPITA_A_SENHA = 'Repita a senha';

/** Textos da linha de conferência (aprovados). */
export const TEXTO_REPETICAO_SENHA = {
  igual: 'As senhas conferem.',
  diferente: 'As senhas não conferem.',
  vazia: 'Repita a senha nova.',
} as const;

export interface ItemRepeticaoSenha {
  estado: EstadoRegraSenha;
  texto: string;
}

/**
 * Linha abaixo da lista: `null` = não aparece (campo vazio enquanto digita). Igual = ok (✓). Diferente = neutra enquanto digita
 * (a pessoa ainda pode estar no meio da senha) e erro depois de tentar salvar. Vazia depois de tentar salvar = erro.
 */
export function itemDaRepeticao(repeticao: RepeticaoSenha | undefined, destacar = false): ItemRepeticaoSenha | null {
  if (!repeticao) return null;
  if (repeticao === 'igual') return { estado: 'ok', texto: TEXTO_REPETICAO_SENHA.igual };
  if (repeticao === 'diferente') return { estado: destacar ? 'erro' : 'falta', texto: TEXTO_REPETICAO_SENHA.diferente };
  return destacar ? { estado: 'erro', texto: TEXTO_REPETICAO_SENHA.vazia } : null;
}

/** Frase da região viva com a conferência no fim: "Falta um número. As senhas não conferem." */
export function resumoComRepeticao(resumo: string, repeticao: RepeticaoSenha | undefined, destacar = false): string {
  const r = itemDaRepeticao(repeticao, destacar);
  return r ? `${resumo} ${r.texto}` : resumo;
}
