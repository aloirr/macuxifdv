/**
 * "Verificar atualização" (item 19 do teste de campo do Campo v1.0.16; desenho `docs/desenho/v1017-campo-versao-e-marca.md` §2).
 * Parte pura do `BotaoVerificarAtualizacao` (`components/verificar-atualizacao.tsx`): pergunta à API a última versão publicada
 * da variante (`GET /v1/app/versao?variante=&contrato=3`, pública; o V3
 * traz também o `fracao_liberada`, ADR 0076 D6) e compara com a do app pelo `haVersaoNova` do SDK.
 * T-0195 (ADR 0070): com versão nova, o botão "Versão X.Y.Z disponível" abre a mesma folha do aviso do sininho
 * (`ROTA_TELA_ATUALIZAR_APP`), onde o portão de nada se perde oferece o download; a resposta vai para a guardada do app.
 */
import {
  AppVersaoPublicadaV3Schema,
  CONTRATO_APP_VERSAO_V3,
  ErroSemConexao,
  haVersaoNova,
  rotaAppVersao,
  type ClienteHttp,
  type VarianteApp,
} from '@macuxi/platform-sdk';

import { semPrefixoV1 } from './modo-api';
import { versaoValida } from './nome-build';

export type ResultadoVerificacao =
  | { tipo: 'nova'; versao: string }
  | { tipo: 'atual' }
  /** Sem rede ou modo sem sinal: dá para tentar de novo com internet. */
  | { tipo: 'sem_sinal' }
  /** 404 `SEM_VERSAO`, erro do servidor, resposta fora do contrato ou versão do app ilegível. */
  | { tipo: 'indisponivel' };

/** Textos do botão (só o que a pessoa usa para agir). */
export const TEXTOS_ATUALIZACAO = {
  verificar: 'Verificar atualização',
  verificando: 'Verificando…',
  atual: 'Você está na versão mais recente.',
  semSinal: 'Sem sinal. Tente de novo com internet.',
  indisponivel: 'Não deu para verificar agora. Tente mais tarde.',
} as const;

/** A rota relativa ao `/v1`, como o `ClienteHttp` do shell chama (`/app/versao` + `{ variante, contrato: '3' }`). */
export function caminhoDaRota(variante: VarianteApp): { caminho: string; query: Record<string, string> } {
  const [caminho = '', qs = ''] = semPrefixoV1(rotaAppVersao(variante, CONTRATO_APP_VERSAO_V3)).split('?');
  return { caminho, query: Object.fromEntries(new URLSearchParams(qs)) };
}

/** Consulta a versão publicada e decide o que o botão mostra; a resposta válida vai a `aoReceber` (a guardada do app). Nunca lança. */
export async function verificarAtualizacao(
  http: Pick<ClienteHttp, 'get'>,
  variante: VarianteApp,
  versaoAtual: string | null | undefined,
  aoReceber: (corpo: unknown) => void = () => undefined,
): Promise<ResultadoVerificacao> {
  if (!versaoValida(versaoAtual)) return { tipo: 'indisponivel' };
  const { caminho, query } = caminhoDaRota(variante);
  let corpo: unknown;
  try {
    corpo = await http.get<unknown>(caminho, query);
  } catch (e) {
    return e instanceof ErroSemConexao ? { tipo: 'sem_sinal' } : { tipo: 'indisponivel' };
  }
  const r = AppVersaoPublicadaV3Schema.safeParse(corpo);
  if (!r.success || r.data.variante !== variante) return { tipo: 'indisponivel' };
  aoReceber(corpo);
  return haVersaoNova(versaoAtual, r.data.versao) ? { tipo: 'nova', versao: r.data.versao } : { tipo: 'atual' };
}

/** A linha de baixo do botão para cada resultado (`nova` não tem: o próprio botão diz a versão e abre a folha). */
export function mensagemDaVerificacao(r: ResultadoVerificacao | null): string | null {
  if (!r) return null;
  if (r.tipo === 'atual') return TEXTOS_ATUALIZACAO.atual;
  if (r.tipo === 'sem_sinal') return TEXTOS_ATUALIZACAO.semSinal;
  if (r.tipo === 'indisponivel') return TEXTOS_ATUALIZACAO.indisponivel;
  return null;
}
