/**
 * "Verificar atualização" (item 19 do teste de campo do Campo v1.0.16; desenho `docs/desenho/v1017-campo-versao-e-marca.md` §2).
 * Parte pura do `BotaoVerificarAtualizacao` (`components/verificar-atualizacao.tsx`): pergunta à API a última versão publicada
 * da variante (`GET /v1/app/versao?variante=&contrato=2`, pública) e compara com a do app pelo `haVersaoNova` do SDK.
 * Desde a T-0190 (ADR 0065, RN-CORE-67) a API responde `AppVersaoPublicadaV2`, sem `apk_url`: o APK só se baixa pelo link
 * temporário que o administrador gera no portal. Com versão nova e sem `apk_url`, a linha de baixo pede o link ao administrador
 * (sem botão de baixar); "Atualizar para X.Y.Z" só aparece se um servidor antigo ainda mandar o `apk_url` (https).
 */
import {
  AppVersaoPublicadaV2Schema,
  ErroSemConexao,
  haVersaoNova,
  rotaAppVersao,
  type ClienteHttp,
  type VarianteApp,
} from '@macuxi/platform-sdk';

import { versaoValida } from './nome-build';

export type ResultadoVerificacao =
  /** `apkUrl` nulo (a API desde a T-0190): pedir o link ao administrador. */
  | { tipo: 'nova'; versao: string; apkUrl: string | null }
  | { tipo: 'atual' }
  /** Sem rede ou modo sem sinal: dá para tentar de novo com internet. */
  | { tipo: 'sem_sinal' }
  /** 404 `SEM_VERSAO`, erro do servidor, resposta fora do contrato ou versão do app ilegível. */
  | { tipo: 'indisponivel' };

/** Textos do botão (só o que a pessoa usa para agir). */
export const TEXTOS_ATUALIZACAO = {
  verificar: 'Verificar atualização',
  verificando: 'Verificando…',
  atualizar: (versao: string) => `Atualizar para ${versao}`,
  pecaOLink: (versao: string) => `Versão ${versao} disponível: peça o link ao administrador.`,
  atual: 'Você está na versão mais recente.',
  semSinal: 'Sem sinal. Tente de novo com internet.',
  indisponivel: 'Não deu para verificar agora. Tente mais tarde.',
  naoAbriu: 'Não deu para abrir o download. Tente de novo.',
} as const;

/** A rota relativa ao `/v1`, como o `ClienteHttp` do shell chama (`/app/versao` + `{ variante, contrato: '2' }`). */
function caminhoDaRota(variante: VarianteApp): { caminho: string; query: Record<string, string> } {
  const [caminho = '', qs = ''] = rotaAppVersao(variante).replace(/^\/v1(?=\/)/, '').split('?');
  return { caminho, query: Object.fromEntries(new URLSearchParams(qs)) };
}

/** Consulta a versão publicada e decide o que o botão mostra. Nunca lança. */
export async function verificarAtualizacao(
  http: Pick<ClienteHttp, 'get'>,
  variante: VarianteApp,
  versaoAtual: string | null | undefined,
): Promise<ResultadoVerificacao> {
  if (!versaoValida(versaoAtual)) return { tipo: 'indisponivel' };
  const { caminho, query } = caminhoDaRota(variante);
  let corpo: unknown;
  try {
    corpo = await http.get<unknown>(caminho, query);
  } catch (e) {
    return e instanceof ErroSemConexao ? { tipo: 'sem_sinal' } : { tipo: 'indisponivel' };
  }
  const r = AppVersaoPublicadaV2Schema.safeParse(corpo);
  if (!r.success || r.data.variante !== variante) return { tipo: 'indisponivel' };
  return haVersaoNova(versaoAtual, r.data.versao) ? { tipo: 'nova', versao: r.data.versao, apkUrl: r.data.apk_url ?? null } : { tipo: 'atual' };
}

/** A linha de baixo do botão para cada resultado (`nova` com `apkUrl` não tem: o próprio botão diz a versão). */
export function mensagemDaVerificacao(r: ResultadoVerificacao | null): string | null {
  if (!r) return null;
  if (r.tipo === 'atual') return TEXTOS_ATUALIZACAO.atual;
  if (r.tipo === 'sem_sinal') return TEXTOS_ATUALIZACAO.semSinal;
  if (r.tipo === 'indisponivel') return TEXTOS_ATUALIZACAO.indisponivel;
  return r.apkUrl ? null : TEXTOS_ATUALIZACAO.pecaOLink(r.versao);
}
