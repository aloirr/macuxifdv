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
export type ModoDaCarga = 'local' | 'api' | 'sem_sinal';

/** Modo da carga a partir do estado do motor de sync (`pendentes` é opcional nele) e do sinal; um lugar só para as telas. */
export function modoDaCarga(sync: object, online: boolean): ModoDaCarga {
  const pendentes = (sync as { pendentes?: readonly string[] }).pendentes;
  if (!catalogoPendente(pendentes)) return 'local';
  return online ? 'api' : 'sem_sinal';
}

/** Mesma regra de `modoDaCarga`, a partir da porta do shell (sem porta = local). */
export function usarApiNaCarga(p: PortaCargaOnline | null): ModoDaCarga {
  return p ? modoDaCarga({ pendentes: p.pendentes() }, p.online()) : 'local';
}

/** RN-CAT-06: dentro do pedido só entra o vendável; sem preço visível (RN-CAT-05) não há o que filtrar. */
export const soVendaveisNaCarga = <T extends { price: { sellable: boolean } | null }>(itens: readonly T[]): T[] => itens.filter((i) => i.price === null || i.price.sellable);

const POR_PAGINA_API = 50;

/**
 * Junta páginas e o aviso (`notice`) da API (padrão 50, o teto da rota; `porPagina` nunca passa disso) por `offset` até `limite` itens ou o fim da API,
 * sem repetir item por `id`. O "Mostrar mais" da busca usa `PAGINA_DA_BUSCA` (A1).
 */
export async function paginasDaApi<I>(
  get: HttpOnline,
  caminho: string,
  query: Record<string, string | number | boolean | null | undefined>,
  limite: number,
  porPagina: number = POR_PAGINA_API,
): Promise<{ items: I[]; total: number; notice: string | null }> {
  const tam = Math.min(Math.max(1, Math.floor(porPagina)), POR_PAGINA_API);
  const vistos = new Set<string>();
  const items: I[] = [];
  let total = 0;
  let notice: string | null = null;
  let offset = 0;
  while (items.length < limite) {
    const r = await get<{ items: I[]; total: number; next_offset: number | null; notice?: string | null }>(caminho, { ...query, limit: tam, offset });
    for (const i of r.items) {
      const id = (i as { id?: unknown }).id;
      if (typeof id === 'string') {
        if (vistos.has(id)) continue;
        vistos.add(id);
      }
      items.push(i);
    }
    total = r.total;
    notice ??= r.notice ?? null;
    if (r.next_offset === null || r.items.length === 0) break;
    offset = r.next_offset;
  }
  return { items: items.slice(0, limite), total, notice };
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

/**
 * Busca com sinal (v1.0.18): com resposta da API, o `notice` dela segue (limite diário atingido, IA desligada);
 * só o ERRO cai para a busca do aparelho, e apenas a falta de conexão traz o aviso `avisoSemConexao`; erro HTTP cai sem aviso.
 */
export async function buscaComSinal<P extends { notice: string | null }>(
  chamarApi: () => Promise<P>,
  ehSemConexao: (e: unknown) => boolean,
  avisoSemConexao: string,
): Promise<{ origem: 'api'; pag: P; aviso: string | null } | { origem: 'aparelho'; aviso: string | null }> {
  try {
    const pag = await chamarApi();
    return { origem: 'api', pag, aviso: pag.notice };
  } catch (e) {
    return { origem: 'aparelho', aviso: ehSemConexao(e) ? avisoSemConexao : null };
  }
}
