/**
 * Endereço fixo do build (T-0038, R-20261101-164531-alexandre; doc 04, "Domínio e endereços"). Puro, para teste.
 *
 * Cada perfil EAS (`apps/mobile/eas.json`) leva `EXPO_PUBLIC_API_URL` e `EXPO_PUBLIC_PERFIL_BUILD`:
 *  - `desenvolvimento` (perfis `campo` e `gestao`, com expo-dev-client): o login tem o campo Servidor, escondido em
 *    "Avançado", para apontar para a API na rede local; o endereço salvo no aparelho vale.
 *  - `preview` e `producao`: SEM campo Servidor. O app usa sempre o endereço do build; o endereço salvo por uma versão
 *    antiga do app é ignorado. Se o `/v1/saude` falhar, a mensagem é só "Servidor indisponível — tente mais tarde".
 * Sem a variável (ex.: `expo start` local sem o perfil): bundle de desenvolvimento (`__DEV__`) = `desenvolvimento`;
 * bundle de release = endereço fixo (o lado seguro). A decisão é pela flag do build, nunca pelo endereço.
 */
import { ErroHttp, ErroSemConexao } from '@macuxi/platform-sdk';

export type PerfilBuild = 'desenvolvimento' | 'preview' | 'producao';

export const MENSAGEM_SERVIDOR_INDISPONIVEL = 'Servidor indisponível — tente mais tarde';

/** Código do erro do shell quando o servidor do build não passou na verificação (só nos builds de endereço fixo). */
export const CODIGO_SERVIDOR_INDISPONIVEL = 'SERVIDOR_INDISPONIVEL';

export function lerPerfilBuild(env: { EXPO_PUBLIC_PERFIL_BUILD?: string | undefined }, bundleDeDesenvolvimento: boolean): PerfilBuild {
  const v = env.EXPO_PUBLIC_PERFIL_BUILD?.trim().toLowerCase();
  if (v === 'desenvolvimento' || v === 'preview' || v === 'producao') return v;
  return bundleDeDesenvolvimento ? 'desenvolvimento' : 'producao';
}

/** O usuário pode trocar o endereço do servidor? Só no build de desenvolvimento. */
export function servidorEditavel(perfil: PerfilBuild): boolean {
  return perfil === 'desenvolvimento';
}

/** Como o cartão Servidor aparece no login: em "Avançado" (fechado) no desenvolvimento; ausente nos demais. */
export function cartaoServidorNoLogin(perfil: PerfilBuild): 'avancado' | 'oculto' {
  return servidorEditavel(perfil) ? 'avancado' : 'oculto';
}

/** Endereço salvo no aparelho que vale neste build (o de versão antiga é ignorado quando o endereço é fixo). */
export function enderecoSalvoValido(perfil: PerfilBuild, salvo: string | null | undefined): string | null {
  if (!servidorEditavel(perfil)) return null;
  const s = salvo?.trim();
  return s ? s : null;
}

/** Endereço em uso: o salvo (se valer neste build) ou o do build. */
export function enderecoEmUso(perfil: PerfilBuild, salvo: string | null | undefined, doBuild: string): string {
  return enderecoSalvoValido(perfil, salvo) ?? doBuild;
}

/**
 * Mensagem quando o servidor não passou na verificação de `/saude` antes do login. Endereço fixo: sempre
 * "Servidor indisponível — tente mais tarde" (o usuário não tem o que corrigir). Desenvolvimento: `null` (a tela do
 * Core mostra a mensagem detalhada, que manda conferir o endereço).
 */
export function mensagemServidorFalhou(perfil: PerfilBuild): string | null {
  return servidorEditavel(perfil) ? null : MENSAGEM_SERVIDOR_INDISPONIVEL;
}

/**
 * Erro da verificação do servidor (`/saude`) no build de endereço fixo: troca qualquer falha (sem resposta, tempo
 * esgotado, 404, 5xx, não é Macuxi) por `SERVIDOR_INDISPONIVEL`, sem endereço nem dica de "/v1". No desenvolvimento
 * devolve o erro original (a mensagem detalhada ajuda a acertar o endereço da rede local).
 */
export function erroDaVerificacao(perfil: PerfilBuild, erro: unknown): unknown {
  return servidorEditavel(perfil) ? erro : new ErroHttp(503, CODIGO_SERVIDOR_INDISPONIVEL, MENSAGEM_SERVIDOR_INDISPONIVEL);
}

/**
 * Mensagem que o shell mostra no lugar da do Core, no build de endereço fixo, quando o login falhou por servidor
 * (verificação reprovada ou sem conexão no meio do login). `null` = deixa a tela do Core tratar (credencial etc.).
 */
export function avisoDeServidorNoLogin(perfil: PerfilBuild, erro: unknown): string | null {
  if (servidorEditavel(perfil)) return null;
  if (erro instanceof ErroSemConexao) return MENSAGEM_SERVIDOR_INDISPONIVEL;
  if (erro instanceof ErroHttp && erro.codigo === CODIGO_SERVIDOR_INDISPONIVEL) return MENSAGEM_SERVIDOR_INDISPONIVEL;
  return null;
}
