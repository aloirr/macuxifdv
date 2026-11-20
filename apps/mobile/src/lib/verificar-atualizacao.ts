/**
 * "Verificar atualização" (item 19 do teste de campo do Campo v1.0.16; desenho `docs/desenho/v1017-campo-versao-e-marca.md` §2).
 * Parte pura do `BotaoVerificarAtualizacao` (`components/verificar-atualizacao.tsx`): pergunta à API a última versão publicada
 * da variante (`GET /v1/app/versao?variante=`, pública) e compara com a do app pelo `haVersaoNova` do SDK.
 * O APK sai do `android-build.yml` (sem loja): "Atualizar para X.Y.Z" abre o `apk_url` no navegador do aparelho.
 */
import {
  AppVersaoPublicadaSchema,
  ErroSemConexao,
  haVersaoNova,
  rotaAppVersao,
  type ClienteHttp,
  type VarianteApp,
} from '@macuxi/platform-sdk';

import { versaoValida } from './nome-build';

export type ResultadoVerificacao =
  | { tipo: 'nova'; versao: string; apkUrl: string }
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
  atual: 'Você está na versão mais recente.',
  semSinal: 'Sem sinal. Tente de novo com internet.',
  indisponivel: 'Não deu para verificar agora. Tente mais tarde.',
  naoAbriu: 'Não deu para abrir o download. Tente de novo.',
} as const;

/** A rota relativa ao `/v1`, como o `ClienteHttp` do shell chama (`/app/versao?variante=campo`). */
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
  const r = AppVersaoPublicadaSchema.safeParse(corpo);
  if (!r.success || r.data.variante !== variante) return { tipo: 'indisponivel' };
  return haVersaoNova(versaoAtual, r.data.versao) ? { tipo: 'nova', versao: r.data.versao, apkUrl: r.data.apk_url } : { tipo: 'atual' };
}

/** A linha de baixo do botão para cada resultado (`nova` não tem: o próprio botão diz a versão). */
export function mensagemDaVerificacao(r: ResultadoVerificacao | null): string | null {
  if (!r) return null;
  if (r.tipo === 'atual') return TEXTOS_ATUALIZACAO.atual;
  if (r.tipo === 'sem_sinal') return TEXTOS_ATUALIZACAO.semSinal;
  if (r.tipo === 'indisponivel') return TEXTOS_ATUALIZACAO.indisponivel;
  return null;
}
