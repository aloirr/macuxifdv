/**
 * Ciclo de senha no login do BKO (T-0094; RN-CORE-32/33/34; ADR 0032; spec docs/design/ciclo-de-senha.md §1 a §3; desenho
 * docs/desenho/T-0094.md §3 a §5 e §8). Puro, para teste.
 * RD-0019/RD-0020: textos, `detalhesDaTroca`, `subtituloDaTroca`, `repeticaoDaSenha`, `trocaProntaParaEnviar`, `validarEsqueci`,
 * `validarLogin` e o texto de espera vêm da fonte única do Core (`@macuxi/core/contracts`, ciclo-senha.ts). Aqui fica só o que é
 * do BKO: as rotas, o mapa erro → ação da tela (sobre o `ApiRequestError` do SDK web), a memória da aba e o ouvinte do
 * `PERFIL_SEM_BKO`.
 * - 403 `SENHA_A_TROCAR` no login → "Crie sua senha" (sem texto). A senha usada no login fica só na memória da tela de login (estado
 *   do React), nunca em `localStorage`/`sessionStorage`/URL/log, e some ao voltar ao login ou ao entrar.
 * - "Crie sua senha" chama `POST /v1/auth/senha/trocar`; a resposta é a sessão (como no login). Os erros seguem a tabela do §2.
 * - "Esqueci a senha" chama `POST /v1/auth/senha/esqueci`; a confirmação é sempre a mesma, exista ou não o cadastro (§3).
 * - 403 `PERFIL_SEM_BKO` durante o uso (perfil rebaixado): encerra a sessão e volta ao Entrar com o aviso (§1).
 * Quem pode entrar no BKO é decidido pela API (o login manda `app: 'web'`) e pela fonte única do SDK; nada de lista de perfis aqui.
 */
import { CODIGOS_AUTH, mensagemDaSenha, TEXTOS_CRIE_SENHA, TEXTOS_ESQUECI, TEXTOS_LOGIN_SENHA, textoDeMuitosPedidos, type FaltaNaSenha } from '@macuxi/core/contracts';
import { CODIGO_PERFIL_FORA_DO_APP, CODIGO_PERFIL_SEM_BKO, mensagemPerfilForaDoApp, type Perfil } from '@macuxi/platform-sdk';

import { mensagemDoLogin } from './login';

/** Rotas públicas do Core (sem `/v1`: o cliente do SDK já põe a base). */
export const CAMINHO_TROCAR_SENHA = '/auth/senha/trocar';
export const CAMINHO_ESQUECI_SENHA = '/auth/senha/esqueci';

/** Link de convite antigo (`/convite`, T-0087): o convite saiu (T-0094, P3). Proposta para o designer-ux; sem "convite" na tela. */
export const TEXTOS_LINK_ANTIGO = Object.freeze({
  titulo: 'Este link não vale mais',
  texto: 'Agora o acesso chega por e-mail, com uma senha temporária. Se ela não chegou, use "Esqueci a senha" na tela de entrada ou fale com o administrador da sua empresa.',
  irParaEntrada: 'Ir para o login',
});

interface ErroDaApi {
  status?: unknown;
  code?: unknown;
  message?: unknown;
  details?: unknown;
}
const comoErro = (e: unknown): ErroDaApi => (e && typeof e === 'object' ? (e as ErroDaApi) : {});

/**
 * O que a "Crie sua senha" faz com o erro da API (tabela do §2):
 * - `destacar`: 422 RN-CORE-32 (aviso no topo, lista em vermelho, campos ficam);
 * - `limpar`: 422 RN-CORE-34 (limpa os dois campos, foco no primeiro);
 * - `login`: 401/410/423/429/403 `PERFIL_FORA_DO_APP` (volta ao login com o texto lá; a senha some da memória);
 * - `fica`: sem internet e o resto (o botão continua ativo e tenta de novo).
 */
export type ResultadoDaTroca = { acao: 'destacar' | 'limpar' | 'login' | 'fica'; mensagem: string };

const FALTAS: readonly FaltaNaSenha[] = ['caracteres', 'letra', 'numero', 'especial'];

export function resultadoDoErroDaTroca(e: unknown, senhaNova: string): ResultadoDaTroca {
  const x = comoErro(e);
  if (x.status === 0) return { acao: 'fica', mensagem: TEXTOS_CRIE_SENHA.semInternet };
  if (x.status === 422 && x.code === 'RN-CORE-34') return { acao: 'limpar', mensagem: TEXTOS_CRIE_SENHA.repetiuATemporaria };
  if (x.status === 422 && x.code === 'RN-CORE-32') {
    const lista = (x.details as { faltas?: unknown } | undefined)?.faltas;
    const faltas = Array.isArray(lista) ? lista.filter((f): f is FaltaNaSenha => (FALTAS as readonly unknown[]).includes(f)) : [];
    return { acao: 'destacar', mensagem: (faltas.length > 0 ? mensagemDaSenha(faltas, senhaNova) : null) ?? TEXTOS_CRIE_SENHA.igualAoEmail };
  }
  if (x.status === 401) return { acao: 'login', mensagem: TEXTOS_CRIE_SENHA.naoValeMais };
  if (x.status === 410 || x.code === CODIGOS_AUTH.senhaVencida) return { acao: 'login', mensagem: TEXTOS_LOGIN_SENHA.senhaVencida };
  if (x.status === 423 || x.status === 429 || x.code === CODIGO_PERFIL_FORA_DO_APP) return { acao: 'login', mensagem: mensagemDoLogin(e) };
  return { acao: 'fica', mensagem: mensagemDoLogin(e) };
}

/**
 * Erro do `POST /auth/senha/esqueci` → texto embaixo do botão, ou `null` = mostrar a confirmação de sempre. Erro de formato do
 * pedido (400, código da empresa fora do padrão) também vira a confirmação: a resposta nunca revela se o cadastro existe.
 */
export function mensagemDoEsqueci(e: unknown): string | null {
  const x = comoErro(e);
  if (x.status === 0) return TEXTOS_ESQUECI.semInternet;
  if (x.status === 429) return textoDeMuitosPedidos((x.details as { retry_after_s?: unknown } | undefined)?.retry_after_s);
  if (x.status === 400) return null;
  return TEXTOS_ESQUECI.outro;
}

/** 403 `PERFIL_SEM_BKO` (RN-CORE-33) numa chamada do BKO em uso. */
export function ehPerfilSemBko(e: unknown): boolean {
  const x = comoErro(e);
  return x.status === 403 && x.code === CODIGO_PERFIL_SEM_BKO;
}

/** Aviso do Entrar depois do `PERFIL_SEM_BKO`: o texto do SDK pelo perfil da sessão; sem ele, a frase da API (§1). */
export function mensagemSemBko(perfil: Perfil | null | undefined): string {
  return (perfil ? mensagemPerfilForaDoApp(perfil, 'web') : null) ?? TEXTOS_LOGIN_SENHA.semBko;
}

// ---------------------------------------------------------------- aviso que o login mostra ao abrir

/** Só na memória da aba (navegação do cliente): o motivo de ter voltado ao Entrar. Nunca senha. */
let avisoDoLogin: string | null = null;

export function guardarAvisoDoLogin(texto: string) {
  avisoDoLogin = texto;
}

/** Lê e apaga (o aviso aparece uma vez). */
export function consumirAvisoDoLogin(): string | null {
  const a = avisoDoLogin;
  avisoDoLogin = null;
  return a;
}

// ---------------------------------------------------------------- 403 PERFIL_SEM_BKO em qualquer chamada

type OuvintePerfilSemBko = () => void;
let ouvinte: OuvintePerfilSemBko | null = null;

/** O shell (com sessão) registra o que fazer: encerrar a sessão e voltar ao Entrar com o aviso. Devolve o cancelamento. */
export function aoPerfilSemBko(f: OuvintePerfilSemBko): () => void {
  ouvinte = f;
  return () => {
    if (ouvinte === f) ouvinte = null;
  };
}

/** Chamado pelo cache do React Query a cada erro: só age no 403 `PERFIL_SEM_BKO`. */
export function avisarSePerfilSemBko(e: unknown): boolean {
  if (!ehPerfilSemBko(e)) return false;
  ouvinte?.();
  return true;
}
