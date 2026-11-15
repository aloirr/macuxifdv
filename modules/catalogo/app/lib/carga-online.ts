/**
 * Busca online enquanto o catálogo carrega (ADR 0054, solução 5; desenho T-catalogo-pacote §2.2). Puro (sem react-native).
 * Com o catálogo pendente na carga inicial (`estado.pendentes` do motor), a tela do catálogo, a ficha e as consultas
 * `catalogo.busca_produtos@1`, `catalogo.precos_cliente@1` e `catalogo.textos_produto@1` vão à API, que já traz o preço do
 * cliente e revalida perfil e RN-CAT-05. Depois da carga, tudo volta ao aparelho. As consultas não têm HTTP no contexto:
 * o shell injeta a porta com `definirCargaOnline` (sem ela, nada muda: tudo local).
 */
import { ENTIDADES_CORE_CATALOGO_PRECOS } from '@macuxi/core/contracts';
import { ConsultaIndisponivel } from '@macuxi/platform-sdk';
import { TEXTO_CATALOGO_CARREGANDO } from '@macuxi/ui/mobile/puro';
import { caminhoCatalogo, ENTIDADES_ARVORE, ENTIDADES_CONTEUDO, ENTIDADES_PRECO, entidadeProdutoRelacao, type FichaProduto } from '../../contracts';

/** Etapa "Catálogo e preços" e as entidades dela: as do Catálogo e as do Core que a vitrine lê. */
const CHAVES_DO_CATALOGO: ReadonlySet<string> = new Set([
  'catalogo_precos',
  ...ENTIDADES_CORE_CATALOGO_PRECOS,
  ...[...ENTIDADES_PRECO, ...ENTIDADES_CONTEUDO, ...ENTIDADES_ARVORE, entidadeProdutoRelacao].map((e) => e.nome),
]);

/** A consulta que não pode responder enquanto o catálogo carrega e não há sinal. */
export const consultaIndisponivel = (consulta: string) => new ConsultaIndisponivel(consulta, 'catalogo', TEXTO_CATALOGO_CARREGANDO);

export function catalogoPendente(pendentes: readonly string[] | undefined): boolean {
  return (pendentes ?? []).some((k) => CHAVES_DO_CATALOGO.has(k));
}

export type HttpOnline = <T>(caminho: string, query?: Record<string, string | number | boolean | null | undefined>) => Promise<T>;

export interface PortaCargaOnline {
  pendentes(): readonly string[] | undefined;
  online(): boolean;
  get: HttpOnline;
}

let portaDoShell: PortaCargaOnline | null = null;
export function definirCargaOnline(p: PortaCargaOnline | null): void {
  portaDoShell = p;
}
export const cargaOnlineDoShell = (): PortaCargaOnline | null => portaDoShell;

/** `local` = como hoje; `api` = pendente e com sinal; `sem_sinal` = pendente sem sinal (mostrar o texto de carregando). */
export function usarApiNaCarga(p: PortaCargaOnline | null): 'local' | 'api' | 'sem_sinal' {
  if (!p || !catalogoPendente(p.pendentes())) return 'local';
  return p.online() ? 'api' : 'sem_sinal';
}

/** Modo da carga a partir do estado do motor de sync (`pendentes` é opcional nele) e do sinal; um lugar só para as telas. */
export function modoDaCarga(sync: object, online: boolean): 'local' | 'api' | 'sem_sinal' {
  const pendentes = (sync as { pendentes?: readonly string[] }).pendentes;
  if (!catalogoPendente(pendentes)) return 'local';
  return online ? 'api' : 'sem_sinal';
}

/** RN-CAT-06: dentro do pedido só entra o vendável; sem preço visível (RN-CAT-05) não há o que filtrar. */
export const soVendaveisNaCarga = <T extends { price: { sellable: boolean } | null }>(itens: readonly T[]): T[] => itens.filter((i) => i.price === null || i.price.sellable);

const POR_PAGINA_API = 50;

/** Junta páginas de 50 (teto da rota) até `limite` itens ou o fim da API. */
export async function paginasDaApi<I>(
  get: HttpOnline,
  caminho: string,
  query: Record<string, string | number | boolean | null | undefined>,
  limite: number,
): Promise<{ items: I[]; total: number }> {
  const items: I[] = [];
  let total = 0;
  let offset = 0;
  while (items.length < limite) {
    const r = await get<{ items: I[]; total: number; next_offset: number | null }>(caminho, { ...query, limit: POR_PAGINA_API, offset });
    items.push(...r.items);
    total = r.total;
    if (r.next_offset === null || r.items.length === 0) break;
    offset = r.next_offset;
  }
  return { items: items.slice(0, limite), total };
}

const SIMULTANEAS = 6;

/** Fichas (`GET produtos/:id`, com o preço do cliente) na ordem pedida. Uma falha = consulta indisponível, nunca "sem preço". */
export async function fichasDaApi(get: HttpOnline, ids: readonly string[], clienteId: string | null): Promise<FichaProduto[]> {
  const saida: FichaProduto[] = new Array<FichaProduto>(ids.length);
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < ids.length) {
      const i = proximo++;
      saida[i] = await get<FichaProduto>(caminhoCatalogo('produto', { id: ids[i]! }), clienteId ? { customer_id: clienteId } : {});
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(SIMULTANEAS, ids.length) }, trabalhador));
  } catch {
    throw consultaIndisponivel('catalogo.fichas');
  }
  return saida;
}
