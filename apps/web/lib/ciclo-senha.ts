/**
 * Ciclo de senha no login do BKO (T-0094; RN-CORE-32/33/34; ADR 0032; spec docs/design/ciclo-de-senha.md §1 a §3; desenho
 * docs/desenho/T-0094.md §3 a §5 e §8). Puro, para teste.
 * - 403 `SENHA_A_TROCAR` no login → "Crie sua senha" (sem texto). A senha usada no login fica só na memória da tela de login (estado
 *   do React), nunca em `localStorage`/`sessionStorage`/URL/log, e some ao voltar ao login ou ao entrar.
 * - "Crie sua senha" chama `POST /v1/auth/senha/trocar`; a resposta é a sessão (como no login). Os erros seguem a tabela do §2.
 * - "Esqueci a senha" chama `POST /v1/auth/senha/esqueci`; a confirmação é sempre a mesma, exista ou não o cadastro (§3).
 * - 403 `PERFIL_SEM_BKO` durante o uso (perfil rebaixado): encerra a sessão e volta ao Entrar com o aviso (§1).
 * Quem pode entrar no BKO é decidido pela API (o login manda `app: 'web'`) e pela fonte única do SDK; nada de lista de perfis aqui.
 */
import { CODIGOS_AUTH, DetalhesSenhaATrocarSchema, faltasNaSenha, mensagemDaSenha, type DetalhesSenhaATrocar, type FaltaNaSenha } from '@macuxi/core/contracts';
import { CODIGO_PERFIL_FORA_DO_APP, CODIGO_PERFIL_SEM_BKO, mensagemPerfilForaDoApp, type Perfil } from '@macuxi/platform-sdk';

import { mensagemDoLogin } from './login';

/** Rotas públicas do Core (sem `/v1`: o cliente do SDK já põe a base). */
export const CAMINHO_TROCAR_SENHA = '/auth/senha/trocar';
export const CAMINHO_ESQUECI_SENHA = '/auth/senha/esqueci';

/** Textos novos do login (spec §1). */
export const TEXTOS_LOGIN_SENHA = Object.freeze({
  esqueci: 'Esqueci a senha',
  senhaVencida: 'Esta senha temporária venceu. Peça outra em "Esqueci a senha" ou fale com o administrador da sua empresa.',
  semBko: 'Seu perfil não tem acesso ao backoffice.',
});

/** "Crie sua senha" (spec §2), sem variação. */
export const TEXTOS_CRIE_SENHA = Object.freeze({
  titulo: 'Crie sua senha',
  primeiroAcesso: 'É o seu primeiro acesso. Crie uma senha só sua para continuar.',
  senhaTemporaria: 'Você entrou com uma senha temporária. Crie uma senha nova para continuar.',
  salvar: 'Salvar e entrar',
  salvando: 'Salvando…',
  voltar: 'Voltar ao login',
  igualAoEmail: 'A senha não pode ser igual ao e-mail.',
  repetiuATemporaria: 'A senha nova precisa ser diferente da senha que você recebeu.',
  naoValeMais: 'Esta senha não vale mais. Entre de novo.',
  semInternet: 'Conecte-se à internet para criar a sua senha.',
  criada: 'Senha criada.',
});

/** "Esqueci a senha" (spec §3), sem variação. */
export const TEXTOS_ESQUECI = Object.freeze({
  titulo: 'Esqueci a senha',
  instrucao: 'Informe o código da empresa e o seu e-mail. Vamos mandar uma senha temporária para o seu e-mail.',
  enviar: 'Enviar senha temporária',
  enviando: 'Enviando…',
  voltar: 'Voltar ao login',
  confirmacao: 'Se o e-mail estiver cadastrado nesta empresa, você vai receber uma senha temporária em alguns minutos. Ela vale por 72 horas.',
  naoChegou: 'Não chegou? Confira o spam ou fale com o administrador da sua empresa.',
  vazio: 'Informe o código da empresa e o e-mail.',
  emailInvalido: 'Informe um e-mail válido, como nome@empresa.com.br.',
  semInternet: 'Conecte-se à internet para pedir uma senha temporária.',
  outro: 'Não foi possível pedir agora. Tente de novo em alguns minutos.',
});

/** Link de convite antigo (`/convite`, T-0087): o convite saiu (T-0094, P3). Proposta para o designer-ux; sem "convite" na tela. */
export const TEXTOS_LINK_ANTIGO = Object.freeze({
  titulo: 'Este link não vale mais',
  texto: 'Agora o acesso chega por e-mail, com uma senha temporária. Se ela não chegou, use "Esqueci a senha" na tela de entrada ou fale com o administrador da sua empresa.',
  irParaEntrada: 'Ir para a entrada',
});

interface ErroDaApi {
  status?: unknown;
  code?: unknown;
  message?: unknown;
  details?: unknown;
}
const comoErro = (e: unknown): ErroDaApi => (e && typeof e === 'object' ? (e as ErroDaApi) : {});

/** 403 `SENHA_A_TROCAR` do login → os detalhes (motivo e validade); `null` para qualquer outro erro. Detalhe estranho = senha temporária. */
export function detalhesDaTroca(e: unknown): DetalhesSenhaATrocar | null {
  const x = comoErro(e);
  if (x.code !== CODIGOS_AUTH.senhaATrocar) return null;
  const d = DetalhesSenhaATrocarSchema.safeParse(x.details);
  return d.success ? d.data : { motivo: 'senha_temporaria', expira_em: null };
}

export function subtituloDaTroca(motivo: DetalhesSenhaATrocar['motivo']): string {
  return motivo === 'primeiro_acesso' ? TEXTOS_CRIE_SENHA.primeiroAcesso : TEXTOS_CRIE_SENHA.senhaTemporaria;
}

/** A tela compara as duas senhas; o kit (`RegrasDaSenha`) recebe só o resultado (spec §4). */
export function repeticaoDaSenha(nova: string, repetida: string): 'vazia' | 'igual' | 'diferente' {
  return repetida === '' ? 'vazia' : repetida === nova ? 'igual' : 'diferente';
}

/** Pode chamar a API? Só com a RN-CORE-32 cumprida e as duas iguais (senão liga o `destacar` e não envia). */
export function trocaProntaParaEnviar(nova: string, repetida: string): boolean {
  return faltasNaSenha(nova).length === 0 && repeticaoDaSenha(nova, repetida) === 'igual';
}

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

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Conferência do "Esqueci a senha" antes de chamar a API (§3). `null` = pode enviar. */
export function validarEsqueci(c: { codigo_empresa: string; email: string }): string | null {
  if (!c.codigo_empresa.trim() || !c.email.trim()) return TEXTOS_ESQUECI.vazio;
  if (!EMAIL_RE.test(c.email.trim())) return TEXTOS_ESQUECI.emailInvalido;
  return null;
}

/** "Muitos pedidos seguidos. Tente de novo em <n> minutos." com `n = ceil(retry_after_s / 60)`, mínimo 1. */
export function textoDeMuitosPedidos(retryAfterS: unknown): string {
  const s = typeof retryAfterS === 'number' && Number.isFinite(retryAfterS) ? retryAfterS : 60;
  const n = Math.max(1, Math.ceil(s / 60));
  return `Muitos pedidos seguidos. Tente de novo em ${n === 1 ? '1 minuto' : `${n} minutos`}.`;
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
