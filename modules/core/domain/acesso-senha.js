/**
 * Ciclo de senha dos usuários do tenant (T-0094; ADR 0032; RN-CORE-33/34). Regras puras: relógio e aleatoriedade entram por
 * parâmetro. A API revalida e orquestra; nada aqui lê banco nem registra senha.
 * - Senha temporária (inicial do BKO/CSV, redefinida, ou a do "Esqueci a senha") vale 72 h e, usada, obriga a criar a senha.
 * - A master do admin inicial (P5) não vence (`senhaExpiraEm = null`) mas também precisa ser trocada no 1º uso.
 * - O "Esqueci a senha" grava uma temporária PARALELA (P6): a senha atual continua valendo.
 */
import { pode } from '@macuxi/platform-sdk';
import { TEXTOS_TROCAR_SENHA } from '../contracts/ciclo-senha';
import { SENHA_TEMPORARIA_HORAS } from '../contracts/senha';
import { faltasNaSenha } from './senha';
import { validarSenhaInicial } from './usuarios';
/** RN-CORE-34: validade da senha temporária, em horas. */
export { SENHA_TEMPORARIA_HORAS };
/** Instante em que a senha temporária emitida em `agora` vence (a partir dele já não vale: 72 h exatas = vencida). */
export const validadeDaSenhaTemporaria = (agora) => new Date(agora.getTime() + SENHA_TEMPORARIA_HORAS * 3_600_000);
const vigente = (expira, agora) => expira !== null && expira.getTime() > agora.getTime();
/** RN-CORE-34 (desenho §3.3): decide o que a senha digitada significa. Só quem acertou uma das senhas recebe algo além de `errada`. */
export function avaliarSenhaDoLogin(e) {
    if (e.certaAtual) {
        if (!e.trocarSenha)
            return { tipo: 'ok' };
        if (e.senhaExpiraEm !== null && !vigente(e.senhaExpiraEm, e.agora))
            return { tipo: 'vencida' };
        return { tipo: 'trocar', motivo: e.ultimoLoginEm === null ? 'primeiro_acesso' : 'senha_temporaria', expiraEm: e.senhaExpiraEm, usada: 'atual' };
    }
    if (e.certaTemporaria) {
        // sem validade registrada na temporária (dado inconsistente): falha fechada
        if (!vigente(e.temporariaExpiraEm, e.agora))
            return { tipo: 'vencida' };
        return { tipo: 'trocar', motivo: 'senha_temporaria', expiraEm: e.temporariaExpiraEm, usada: 'temporaria' };
    }
    return { tipo: 'errada' };
}
/** RN-CORE-32 + "≠ e-mail" + RN-CORE-34 (não repetir a senha usada para entrar). `null` = serve. */
export function validarSenhaNova(nova, email, igualAUsada) {
    const fraca = validarSenhaInicial(nova, email);
    if (fraca)
        return { codigo: 'RN-CORE-32', mensagem: fraca, faltas: faltasNaSenha(nova) };
    if (igualAUsada)
        return { codigo: 'RN-CORE-34', mensagem: TEXTOS_TROCAR_SENHA.igualAAtual };
    return null;
}
const MENSAGENS_REDEFINICAO = {
    USUARIO_SEM_PERMISSAO: 'Seu perfil não redefine a senha deste usuário. Peça a quem administra a sua empresa.',
    SENHA_PROPRIA: 'Você não redefine a sua própria senha por aqui. Use "Esqueci a senha" no login ou peça a outro administrador.',
    SENHA_DE_ADMIN: 'A senha de um administrador não é redefinida por aqui. Peça para ele usar "Esqueci a senha" no login.',
    USUARIO_INATIVO: 'Este usuário está desativado. Ative o usuário antes de redefinir a senha.',
};
/**
 * P7 + ADR 0033: quem redefine a senha de quem é a chave `senha.redefinir` do motor (com os perfis-alvo); nunca a própria conta nem
 * um usuário de perfil de base admin (mesmo que o perfil-alvo esteja na lista); o alvo precisa estar ativo.
 */
export function podeRedefinirSenha(ator, alvo) {
    const recusa = (codigo) => ({ ok: false, codigo, mensagem: MENSAGENS_REDEFINICAO[codigo] });
    if (!pode(ator.perfis, 'senha.redefinir'))
        return recusa('USUARIO_SEM_PERMISSAO');
    const proprio = ator.id === alvo.id;
    if (proprio)
        return recusa('SENHA_PROPRIA');
    if (alvo.perfis.some((p) => p.base === 'admin'))
        return recusa('SENHA_DE_ADMIN');
    if (!pode(ator.perfis, 'senha.redefinir', { proprio, perfis: alvo.perfis }))
        return recusa('USUARIO_SEM_PERMISSAO');
    if (!alvo.ativo)
        return recusa('USUARIO_INATIVO');
    return { ok: true };
}
const MAIUSCULAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MINUSCULAS = 'abcdefghijkmnopqrstuvwxyz';
const DIGITOS = '23456789';
const ESPECIAIS = '!@#$%&*?';
const TODOS = MAIUSCULAS + MINUSCULAS + DIGITOS + ESPECIAIS;
export const TAMANHO_SENHA_TEMPORARIA = 12;
/**
 * Senha temporária de 12 caracteres sem ambíguos (sem 0/O, 1/l/I), sempre com letra, número e um especial de `!@#$%&*?`
 * (passa na RN-CORE-32). A aleatoriedade entra por `aleatorio(n)` (bytes seguros: `crypto.randomBytes` na API,
 * `crypto.getRandomValues` no navegador). Sorteio sem viés (rejeição) e embaralhamento de Fisher-Yates.
 */
export function gerarSenhaTemporaria(aleatorio) {
    const sortear = (max) => {
        const limite = 256 - (256 % max);
        for (;;) {
            for (const b of aleatorio(16))
                if (b < limite)
                    return b % max;
        }
    };
    const de = (alfabeto) => alfabeto[sortear(alfabeto.length)];
    const c = [de(MAIUSCULAS), de(MINUSCULAS), de(DIGITOS), de(ESPECIAIS)];
    while (c.length < TAMANHO_SENHA_TEMPORARIA)
        c.push(de(TODOS));
    for (let i = c.length - 1; i > 0; i--) {
        const j = sortear(i + 1);
        [c[i], c[j]] = [c[j], c[i]];
    }
    return c.join('');
}
