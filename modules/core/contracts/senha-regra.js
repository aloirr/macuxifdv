/**
 * RN-CORE-32 (T-0093; ADR 0031): política única de senha, na criação e na troca (usuário do BKO, convite, redefinição, admin
 * inicial da empresa, super-admin). Regra pura, sem dependência: a API revalida sempre.
 * - de 8 a 200 caracteres, contados em pontos de código (um emoji conta como 1);
 * - pelo menos uma letra (`\p{L}`, acentuada vale), um número (`\p{Nd}`) e um caractere especial (`[^\p{L}\p{N}\s]`);
 * - espaço no meio é permitido e não conta como especial; espaço no começo ou no fim invalida a senha (só quando há algum caractere que não é espaço; vazia ou só de espaços cai nas faltas comuns); ela nunca passa por `trim`.
 * No login, só o espaço nas pontas é recusado antes de enviar (a conferência da senha gravada é do servidor).
 */
export const SENHA_MIN_CARACTERES = 8;
export const SENHA_MAX_CARACTERES = 200;
/** Única frase do espaço no começo ou no fim da senha (criação, troca e aviso do login). */
export const MENSAGEM_SENHA_ESPACO_NAS_PONTAS = 'A senha não pode ter espaço no começo nem no fim. Apague o espaço e tente de novo.';
/** Regra única do espaço no começo ou no fim da senha (criação, troca e login). */
export const temEspacoNasPontas = (s) => s !== s.trim();
/** Texto aprovado para a ajuda do campo (telas do BKO, do portal e do convite). */
export const REGRA_DA_SENHA = 'Pelo menos 8 caracteres, com letra, número e caractere especial.';
/** Tamanho em pontos de código. */
const tamanho = (s) => [...s].length;
/** O que falta para a senha servir, na ordem caracteres, letra, número, especial. Lista vazia = serve. */
export function faltasNaSenha(senha) {
    const n = tamanho(senha);
    const faltas = [];
    if (senha.trim() !== '' && temEspacoNasPontas(senha))
        faltas.push('espaco');
    if (n < SENHA_MIN_CARACTERES || n > SENHA_MAX_CARACTERES)
        faltas.push('caracteres');
    if (!/\p{L}/u.test(senha))
        faltas.push('letra');
    if (!/\p{Nd}/u.test(senha))
        faltas.push('numero');
    if (!/[^\p{L}\p{N}\s]/u.test(senha))
        faltas.push('especial');
    return faltas;
}
export const senhaServe = (senha) => faltasNaSenha(senha).length === 0;
const ITEM = {
    letra: 'uma letra',
    numero: 'um número',
    especial: 'um caractere especial',
};
/** Mensagem em português que diz o que falta; `null` se não falta nada. Passe a `senha` para distinguir "curta" de "longa demais". */
export function mensagemDaSenha(faltas, senha) {
    if (faltas.length === 0)
        return null;
    if (faltas.includes('espaco'))
        return MENSAGEM_SENHA_ESPACO_NAS_PONTAS;
    if (faltas.includes('caracteres') && senha !== undefined && tamanho(senha) > SENHA_MAX_CARACTERES) {
        return `A senha pode ter até ${SENHA_MAX_CARACTERES} caracteres.`;
    }
    const partes = [];
    if (faltas.includes('caracteres'))
        partes.push(`A senha precisa ter pelo menos ${SENHA_MIN_CARACTERES} caracteres.`);
    const itens = faltas.filter((f) => f !== 'caracteres' && f !== 'espaco').map((f) => ITEM[f]);
    if (itens.length === 1)
        partes.push(`Falta ${itens[0]}.`);
    else if (itens.length > 1)
        partes.push(`Faltam ${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}.`);
    return partes.join(' ');
}
