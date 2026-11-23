/**
 * Adaptador de API de um ERP (F4a; desenho `docs/desenho/integracao-modelos-erp.md` §3). Puro: monta a requisição, lê a resposta
 * e converte a linha do ERP para o contrato canônico. Quem chama a rede é a API (cliente HTTP de saída com SSRF).
 *
 * Fontes: tudo o que está marcado [P] vem de documentação pública do fabricante ou de uso amplo no mercado; [C] é o que o primeiro
 * cliente daquele ERP precisa confirmar (D9: modelo "beta"). A conversão não inventa dado: campo ausente vira linha com erro legível.
 */
import type { Entidade, ModeloErp, PedidoParaErp, SituacaoModelo } from '../../contracts';

/** Credencial já decifrada (só em memória, nunca em log). */
export interface CredencialErp {
  usuario: string | null;
  senha: string;
  token?: string;
  appkey?: string;
}

export interface ConfigAdaptador {
  parametros: Readonly<Record<string, string | number | boolean>>;
  /** Fuso em que o ERP grava as datas (parâmetro `fuso_erp`; padrão o do tenant). */
  fuso: string;
  /** Instante da leitura: vira `alterado_em` onde a API do ERP não traz data de alteração. */
  agora: string;
}

/** Requisição relativa à `url_base` (a API monta a URL e o cliente de saída confere destino e redirecionamento). */
export interface RequisicaoErp {
  metodo: 'GET' | 'POST';
  /** Caminho relativo, sem barra inicial e sem `://` (nunca troca de host). */
  caminho: string;
  /** Parâmetros de query; a API os codifica (`montarUrl`). */
  query?: Readonly<Record<string, string>>;
  cabecalhos?: Readonly<Record<string, string>>;
  corpo?: unknown;
}

export interface RespostaErp {
  status: number;
  cabecalhos: Readonly<Record<string, string | string[] | undefined>>;
  /** JSON já lido; `null` se o corpo não era JSON. */
  corpo: unknown;
}

/** Sessão do ERP, só em memória, com o prazo dela. */
export interface SessaoErp {
  cabecalhos: Readonly<Record<string, string>>;
  expiraEm: string | null;
}

export type ResultadoSessao = { ok: true; sessao: SessaoErp } | { ok: false; motivo: 'credencial_recusada' | 'formato_mudou'; status: number };

export interface PaginaErp {
  linhas: unknown[];
  /** Ficha opaca da próxima página (caminho relativo ou número); `null` = última. */
  proxima: string | null;
}

export type ResultadoPagina = { ok: true; pagina: PaginaErp } | { ok: false; status: number; motivo: 'formato_mudou'; mensagem: string };

export interface PedidoDeBusca {
  /** Janela do incremental (ISO UTC); `null` = sem filtro de data. */
  desde: string | null;
  tamanho: number;
  /** Ficha da página (`PaginaErp.proxima`) ou `null` na primeira. */
  ficha: string | null;
}

/** Uma linha do ERP já convertida: zero (ignorada de propósito), um ou mais registros canônicos (preço e estoque abrem em vários). */
export type ResultadoConversao =
  | { ok: true; registros: unknown[] }
  | { ok: false; external_id: string | null; campo: string; mensagem: string };

export interface AdaptadorPedido {
  /** Nome do parâmetro com o campo do UUID do Macuxi no ERP (RN-INT-19). */
  parametroCampoUuid: string;
  parametrosObrigatorios: readonly string[];
  requisicaoProcurar(uuid: string, cfg: ConfigAdaptador): RequisicaoErp;
  lerProcura(r: RespostaErp): { numero_erp: string } | null;
  requisicaoCriar(pedido: PedidoParaErp, cfg: ConfigAdaptador): RequisicaoErp;
  /** Número criado (2xx) e o motivo da recusa (4xx), sem nunca devolver a resposta inteira. */
  lerCriacao(r: RespostaErp): { numero_erp: string | null; motivo: string | null };
}

export interface ParametroModelo {
  chave: string;
  obrigatorio: boolean;
  descricao: string;
}

export interface AdaptadorErp {
  erp: ModeloErp;
  /** D9: "beta" até o primeiro cliente do ERP confirmar os itens [C]. */
  situacao: SituacaoModelo;
  /** O que ainda falta confirmar com o cliente (aparece no guia e no assistente). */
  confirmarComCliente: readonly string[];
  entidadesSuportadas: readonly Entidade[];
  /** A API filtra por data de alteração? Falso = leitura completa na frequência, sem inativar. */
  suportaDelta(entidade: Entidade): boolean;
  parametros: readonly ParametroModelo[];
  /** Campos que a linha PRECISA trazer; ausentes em todas as linhas = o ERP mudou o formato (§2.4). */
  camposObrigatorios(entidade: Entidade): readonly string[];
  requisicaoLogin(c: CredencialErp, cfg: ConfigAdaptador): RequisicaoErp;
  lerSessao(r: RespostaErp, agora: string): ResultadoSessao;
  requisicaoPagina(entidade: Entidade, p: PedidoDeBusca, cfg: ConfigAdaptador): RequisicaoErp;
  lerPagina(entidade: Entidade, r: RespostaErp): ResultadoPagina;
  converter(entidade: Entidade, linha: unknown, cfg: ConfigAdaptador): ResultadoConversao;
  pedido: AdaptadorPedido | null;
}
