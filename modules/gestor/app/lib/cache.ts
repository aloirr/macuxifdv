/**
 * Cache do Gestor no aparelho (offline-first, ADR 0003): visão da equipe, fila de aprovação, alertas e o último ranking
 * ficam no armazenamento do MÓDULO (`motor.armazenamentoDoModulo('gestor')`, prefixo `mod:gestor:`), apagado junto
 * se o Gestor for desativado (RN-CORE-02). As telas leem daqui; a rede só atualiza. Cada resposta é validada no
 * contrato antes de gravar: resposta fora do contrato nunca sobrescreve o que já está no aparelho.
 */
import { ErroSemConexao, type ArmazenamentoSync, type ClienteHttp } from '@macuxi/platform-sdk';
import { FilaAprovacao, ListaAlertas, RankingEquipe, ROTAS_GESTOR, VisaoEquipe, type IndicadorRanking, type PeriodoRanking } from '../../contracts';

export interface DadosGestor {
  visao: VisaoEquipe | null;
  fila: FilaAprovacao | null;
  alertas: ListaAlertas | null;
  /** `<indicador>|<periodo>` → último ranking recebido. */
  rankings: Record<string, RankingEquipe>;
  sincronizado_em: string | null;
}

export const DADOS_VAZIOS: DadosGestor = { visao: null, fila: null, alertas: null, rankings: {}, sincronizado_em: null };

type Chave = keyof DadosGestor;

export function criarCache(arm: ArmazenamentoSync) {
  const ler = async <K extends Chave>(k: K): Promise<DadosGestor[K]> => (await arm.ler<DadosGestor[K]>(k)) ?? DADOS_VAZIOS[k];
  const gravar = async <K extends Chave>(k: K, v: DadosGestor[K]) => arm.gravar(k, v);
  return {
    ler,
    gravar,
    async carregar(): Promise<DadosGestor> {
      const [visao, fila, alertas, rankings, sincronizado_em] = await Promise.all([ler('visao'), ler('fila'), ler('alertas'), ler('rankings'), ler('sincronizado_em')]);
      return { visao, fila, alertas, rankings, sincronizado_em };
    },
  };
}
export type CacheGestor = ReturnType<typeof criarCache>;

export const chaveRanking = (indicador: IndicadorRanking, periodo: PeriodoRanking) => `${indicador}|${periodo}`;

export interface ResultadoAtualizacao {
  /** Recursos gravados no aparelho nesta rodada. */
  atualizados: ('visao' | 'fila' | 'alertas')[];
  /** `true` = sem conexão (nada mudou no aparelho). */
  semConexao: boolean;
  /** Mensagem em português para a tela (primeiro erro que não é falta de sinal), ou `null`. */
  erro: string | null;
}

const RECURSOS = [
  { chave: 'visao', caminho: ROTAS_GESTOR.equipe, schema: VisaoEquipe },
  { chave: 'fila', caminho: ROTAS_GESTOR.aprovacoes, schema: FilaAprovacao },
  { chave: 'alertas', caminho: ROTAS_GESTOR.alertasComProdutividade, schema: ListaAlertas },
] as const;

/**
 * Busca visão, fila e alertas e grava o que vier válido. Sem sinal: devolve `semConexao` e mantém o cache.
 * Erro da API (403 sem licença, 5xx) ou resposta fora do contrato: mantém o cache e devolve a mensagem.
 */
export async function atualizarCache(http: ClienteHttp, cache: CacheGestor, agora: () => Date): Promise<ResultadoAtualizacao> {
  const r: ResultadoAtualizacao = { atualizados: [], semConexao: false, erro: null };
  for (const x of RECURSOS) {
    try {
      const corpo = await http.get<unknown>(x.caminho);
      const v = x.schema.safeParse(corpo);
      if (!v.success) {
        r.erro ??= 'Resposta do servidor em formato inesperado: mostrando os dados guardados no aparelho.';
        continue;
      }
      await cache.gravar(x.chave, v.data as never);
      r.atualizados.push(x.chave);
    } catch (e) {
      if (e instanceof ErroSemConexao) {
        r.semConexao = true;
        break;
      }
      r.erro ??= mensagemDeErro(e);
    }
  }
  if (r.atualizados.length > 0) await cache.gravar('sincronizado_em', agora().toISOString());
  return r;
}

/** Mensagem curta em português com a ação seguinte (nunca o corpo cru da API). */
export function mensagemDeErro(e: unknown): string {
  const x = e as { status?: number; codigo?: string; message?: string } | null;
  if (x?.codigo === 'MODULO_INATIVO') return 'O módulo Gestor não está ativo para você. Fale com o administrador da empresa.';
  if (x?.status === 403) return 'Seu perfil não tem acesso a esta informação.';
  if (x?.status === 401) return 'Sua sessão expirou. Entre de novo para atualizar.';
  if (typeof x?.status === 'number' && x.status >= 500) return 'O servidor não respondeu agora. Mostrando os dados guardados; puxe para tentar de novo.';
  return x?.message || 'Não foi possível atualizar. Puxe para tentar de novo.';
}
