/**
 * Ciclo de senha dos usuários do tenant (T-0094; ADR 0032; RN-CORE-33/34). Regras puras: relógio e aleatoriedade entram por
 * parâmetro. A API revalida e orquestra; nada aqui lê banco nem registra senha.
 * - Senha temporária (inicial do BKO/CSV, redefinida, ou a do "Esqueci a senha") vale 72 h e, usada, obriga a criar a senha.
 * - A master do admin inicial (P5) não vence (`senhaExpiraEm = null`) mas também precisa ser trocada no 1º uso.
 * - O "Esqueci a senha" grava uma temporária PARALELA (P6): a senha atual continua valendo.
 */
import type { Perfil } from '@macuxi/platform-sdk';
import { faltasNaSenha, type FaltaNaSenha } from './senha';
import { podeGerirUsuarios, validarSenhaInicial } from './usuarios';

/** RN-CORE-34: validade da senha temporária, em horas. */
export const SENHA_TEMPORARIA_HORAS = 72;

/** Instante em que a senha temporária emitida em `agora` vence (a partir dele já não vale: 72 h exatas = vencida). */
export const validadeDaSenhaTemporaria = (agora: Date): Date => new Date(agora.getTime() + SENHA_TEMPORARIA_HORAS * 3_600_000);

export type MotivoDaTroca = 'primeiro_acesso' | 'senha_temporaria';

export interface EntradaSenhaDoLogin {
  /** A senha digitada confere com `senha_hash`. */
  certaAtual: boolean;
  /** A senha digitada confere com `senha_temporaria_hash` (sem temporária = `false`). */
  certaTemporaria: boolean;
  trocarSenha: boolean;
  senhaExpiraEm: Date | null;
  temporariaExpiraEm: Date | null;
  ultimoLoginEm: Date | null;
  agora: Date;
}

export type SenhaDoLogin =
  | { tipo: 'ok' }
  | { tipo: 'trocar'; motivo: MotivoDaTroca; expiraEm: Date | null; usada: 'atual' | 'temporaria' }
  | { tipo: 'vencida' }
  | { tipo: 'errada' };

const vigente = (expira: Date | null, agora: Date): boolean => expira !== null && expira.getTime() > agora.getTime();

/** RN-CORE-34 (desenho §3.3): decide o que a senha digitada significa. Só quem acertou uma das senhas recebe algo além de `errada`. */
export function avaliarSenhaDoLogin(e: EntradaSenhaDoLogin): SenhaDoLogin {
  if (e.certaAtual) {
    if (!e.trocarSenha) return { tipo: 'ok' };
    if (e.senhaExpiraEm !== null && !vigente(e.senhaExpiraEm, e.agora)) return { tipo: 'vencida' };
    return { tipo: 'trocar', motivo: e.ultimoLoginEm === null ? 'primeiro_acesso' : 'senha_temporaria', expiraEm: e.senhaExpiraEm, usada: 'atual' };
  }
  if (e.certaTemporaria) {
    // sem validade registrada na temporária (dado inconsistente): falha fechada
    if (!vigente(e.temporariaExpiraEm, e.agora)) return { tipo: 'vencida' };
    return { tipo: 'trocar', motivo: 'senha_temporaria', expiraEm: e.temporariaExpiraEm, usada: 'temporaria' };
  }
  return { tipo: 'errada' };
}

export type RecusaSenhaNova = { codigo: 'RN-CORE-32'; mensagem: string; faltas: FaltaNaSenha[] } | { codigo: 'RN-CORE-34'; mensagem: string };

/** RN-CORE-32 + "≠ e-mail" + RN-CORE-34 (não repetir a senha usada para entrar). `null` = serve. */
export function validarSenhaNova(nova: string, email: string, igualAUsada: boolean): RecusaSenhaNova | null {
  const fraca = validarSenhaInicial(nova, email);
  if (fraca) return { codigo: 'RN-CORE-32', mensagem: fraca, faltas: faltasNaSenha(nova) };
  if (igualAUsada) return { codigo: 'RN-CORE-34', mensagem: 'A senha nova não pode ser igual à senha temporária.' };
  return null;
}

export type CodigoRedefinicaoRecusada = 'USUARIO_SEM_PERMISSAO' | 'SENHA_PROPRIA' | 'SENHA_DE_ADMIN' | 'USUARIO_INATIVO';

const MENSAGENS_REDEFINICAO: Record<CodigoRedefinicaoRecusada, string> = {
  USUARIO_SEM_PERMISSAO: 'Só o administrador redefine a senha de um usuário.',
  SENHA_PROPRIA: 'Você não redefine a sua própria senha por aqui. Use "Esqueci a senha" no login ou peça a outro administrador.',
  SENHA_DE_ADMIN: 'A senha de um administrador não é redefinida por aqui. Peça para ele usar "Esqueci a senha" no login.',
  USUARIO_INATIVO: 'Este usuário está desativado. Ative o usuário antes de redefinir a senha.',
};

/** P7: redefine qualquer perfil, menos admin e a própria conta; o alvo precisa estar ativo. */
export function podeRedefinirSenha(
  ator: { id: string; perfil: Perfil },
  alvo: { id: string; perfil: Perfil; ativo: boolean },
): { ok: true } | { ok: false; codigo: CodigoRedefinicaoRecusada; mensagem: string } {
  const recusa = (codigo: CodigoRedefinicaoRecusada) => ({ ok: false as const, codigo, mensagem: MENSAGENS_REDEFINICAO[codigo] });
  if (!podeGerirUsuarios(ator.perfil)) return recusa('USUARIO_SEM_PERMISSAO');
  if (ator.id === alvo.id) return recusa('SENHA_PROPRIA');
  if (alvo.perfil === 'admin') return recusa('SENHA_DE_ADMIN');
  if (!alvo.ativo) return recusa('USUARIO_INATIVO');
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
export function gerarSenhaTemporaria(aleatorio: (n: number) => Uint8Array): string {
  const sortear = (max: number): number => {
    const limite = 256 - (256 % max);
    for (;;) {
      for (const b of aleatorio(16)) if (b < limite) return b % max;
    }
  };
  const de = (alfabeto: string): string => alfabeto[sortear(alfabeto.length)]!;
  const c = [de(MAIUSCULAS), de(MINUSCULAS), de(DIGITOS), de(ESPECIAIS)];
  while (c.length < TAMANHO_SENHA_TEMPORARIA) c.push(de(TODOS));
  for (let i = c.length - 1; i > 0; i--) {
    const j = sortear(i + 1);
    [c[i], c[j]] = [c[j]!, c[i]!];
  }
  return c.join('');
}
