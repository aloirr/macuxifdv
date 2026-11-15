/**
 * R-20261115-071000 (dono do produto, 15/11/2026: "Padrão da senha é o olho para mostrar e ocultar"): parte PURA do
 * `CampoSenha`, o campo de senha único do app (login, "Crie sua senha", troca de senha). Sem react-native: roda em Node.
 * Spec: docs/design/campo-senha/spec.md.
 *
 * - O botão de mostrar e ocultar é só o ícone: olho aberto com a senha oculta, olho riscado com a senha visível. Sem texto na
 *   tela; o TalkBack lê "Mostrar senha" / "Ocultar senha".
 * - Teclado de senha: sem autocorreção, sem maiúscula automática, sem corretor; `password` no login e `new-password` na
 *   criação (o gerenciador de senhas oferece guardar). Visível no Android = teclado `visible-password` (sem sugestões nem
 *   espaço automático, R-20261115-064000).
 */
import { ALVO_TOQUE } from './componentes';

/** Medidas (dp): campo de 52 (mesma altura do botão principal) e o olho com alvo de 48 na ponta direita. */
export const CAMPO_SENHA = {
  altura: 52,
  /** Alvo do olho (largura e altura), dentro do campo, colado à direita. */
  olho: ALVO_TOQUE,
  /** Tamanho do ícone do olho. */
  icone: 22,
  /** Espaço à direita do texto, para não passar por baixo do olho. */
  recuoDoTexto: ALVO_TOQUE + 4,
} as const;

/** `login` = senha que já existe; `criacao` = senha nova ("Crie sua senha", troca). */
export type FinalidadeSenha = 'login' | 'criacao';

export type IconeDoOlho = 'olho' | 'olhoRiscado';

/** Ícone do botão: mostra o que o toque faz (olho = mostrar; riscado = ocultar). */
export function iconeDoOlhoDaSenha(visivel: boolean): IconeDoOlho {
  return visivel ? 'olhoRiscado' : 'olho';
}

export interface PropsTecladoSenha {
  secureTextEntry: boolean;
  autoCorrect: false;
  autoCapitalize: 'none';
  spellCheck: false;
  autoComplete: 'password' | 'new-password';
  textContentType: 'password' | 'newPassword';
  keyboardType: 'default' | 'visible-password';
}

/**
 * Props de teclado do `TextInput` de senha. `plataforma` = `Platform.OS`: `visible-password` só existe no Android; no iOS e na
 * web fica `default`.
 */
export function propsDeTecladoDaSenha(visivel: boolean, finalidade: FinalidadeSenha = 'login', plataforma: string = 'android'): PropsTecladoSenha {
  const criacao = finalidade === 'criacao';
  return {
    secureTextEntry: !visivel,
    autoCorrect: false,
    autoCapitalize: 'none',
    spellCheck: false,
    autoComplete: criacao ? 'new-password' : 'password',
    textContentType: criacao ? 'newPassword' : 'password',
    keyboardType: visivel && plataforma === 'android' ? 'visible-password' : 'default',
  };
}
