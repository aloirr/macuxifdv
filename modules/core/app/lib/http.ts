/**
 * Cliente HTTP que o shell entrega às etapas de sync e às telas (pedido R-20261031-022136-modulo-core ao
 * engenheiro-software). Só leitura (GET) basta ao Core: as escritas vão pela fila do motor (`enfileirar`).
 * Enquanto o shell não fornece `http`, lemos com segurança e as cargas falham com mensagem em português.
 */
export type ConsultaHttp = Record<string, string | number | undefined>;

export interface ClienteHttp {
  get<T>(caminho: string, query?: ConsultaHttp): Promise<T>;
}

/** Procura `http` no contexto da etapa ou no motor de sync. */
export function httpDe(fonte: unknown): ClienteHttp | null {
  const h = (fonte as { http?: ClienteHttp } | null | undefined)?.http;
  return h && typeof h.get === 'function' ? h : null;
}

export function exigirHttp(fonte: unknown): ClienteHttp {
  const h = httpDe(fonte);
  if (!h) throw new Error('O aplicativo ainda não liberou a conexão com o servidor para esta carga. Atualize o aplicativo e tente de novo.');
  return h;
}

/** Erro 4xx do servidor (ex.: sem rota hoje, sem metas): a carga segue com "vazio". */
export function erroDeCliente(e: unknown): boolean {
  const s = (e as { status?: unknown } | null)?.status;
  return typeof s === 'number' && s >= 400 && s < 500;
}
