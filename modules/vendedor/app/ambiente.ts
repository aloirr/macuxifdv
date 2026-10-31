/**
 * Ambiente do aparelho que o shell entrega ao Vendedor: chamadas REST da Fase M (alçadas, carteira, tabela de
 * preços, pedidos do mês, editar/cancelar pedido já enviado), estado de sinal e gerador de UUID.
 *
 * Por quê: `ContextoEtapaSync` e o `@macuxi/platform-sdk/react` ainda não expõem cliente HTTP nem "sem sinal".
 * Até o platform-sdk oferecer isso (pedido ao engenheiro-software), o shell chama `definirAmbienteVendedor`
 * no login e `limparAmbienteVendedor` no logout. O módulo nunca importa `apps/*` (fronteira).
 */
export interface OpcoesRequisicao {
  query?: Record<string, string | number | undefined | null>;
  body?: unknown;
  headers?: Record<string, string>;
}

export class ErroSemConexao extends Error {
  constructor(mensagem = 'Sem conexão com o servidor.') {
    super(mensagem);
    this.name = 'ErroSemConexao';
  }
}

export interface AmbienteVendedor {
  /** REST com token da sessão. Lança `ErroSemConexao` quando não há rede e `Error` com a mensagem da API nos demais erros. */
  requisitar<T>(metodo: 'GET' | 'POST' | 'PUT', caminho: string, opcoes?: OpcoesRequisicao): Promise<T>;
  /** `false` = modo sem sinal ligado no Perfil (nada sai do aparelho). */
  online(): boolean;
  /** UUID v4 gerado no aparelho (idempotência, RN-VEN-33). */
  novoId(): string;
  /** Nome do usuário logado (histórico do PDF); vazio se desconhecido. */
  nomeDoUsuario(): string;
}

let atual: AmbienteVendedor | null = null;

export function definirAmbienteVendedor(ambiente: AmbienteVendedor): void {
  atual = ambiente;
}

export function limparAmbienteVendedor(): void {
  atual = null;
}

/** Ambiente ou `null` (antes do login). As telas leem do armazenamento local mesmo sem ambiente. */
export function ambienteVendedor(): AmbienteVendedor | null {
  return atual;
}

export function exigirAmbiente(): AmbienteVendedor {
  if (!atual) throw new Error('O aplicativo ainda não está pronto para falar com o servidor. Entre de novo e tente outra vez.');
  return atual;
}
