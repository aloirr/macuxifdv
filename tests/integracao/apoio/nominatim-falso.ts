/**
 * Nominatim SIMULADO (T-0191; RN-CORE-77): servidor http local que responde `GET /search` no formato `jsonv2` do Nominatim.
 * O Nominatim público está bloqueado na rede da sessão e nunca é chamado pelos testes: a implementação real
 * (`@macuxi/platform-sdk/geocodificador-nominatim`) aponta para cá por `MACUXI_NOMINATIM_URL` (`geocodificadorDoAmbiente`).
 *
 * Cada requisição fica registrada (parâmetros e cabeçalhos), para contar as consultas, conferir
 * o User-Agent e o `countrycodes=br`, e provar que o cache e o `JA_TENTADO` não chegam à rede. A resposta sai de `responder`,
 * trocável no meio do arquivo.
 */
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RequisicaoNominatim {
  params: Record<string, string>;
  headers: IncomingHttpHeaders;
}

/** Resposta do simulado: corpo JSON (status 200) ou um status de erro. */
export type RespostaNominatim = { corpo: unknown } | { status: number };

export interface NominatimFalso {
  url: string;
  requisicoes: RequisicaoNominatim[];
  /** Troca a regra das respostas. */
  definir(fn: (params: Record<string, string>) => RespostaNominatim): void;
  fechar(): Promise<void>;
}

/** Item do Nominatim com o número da porta (place_rank 30, `building`): precisão `numero`. */
export const itemNumero = (lat: number, lng: number, numero = '10') => ({ lat: String(lat), lon: String(lng), place_rank: 30, category: 'building', type: 'house', addresstype: 'building', address: { house_number: numero, road: 'Rua' } });
/** Item de via (place_rank 26, `highway`): precisão `rua`. */
export const itemRua = (lat: number, lng: number) => ({ lat: String(lat), lon: String(lng), place_rank: 26, category: 'highway', type: 'residential', addresstype: 'road', address: { road: 'Rua' } });
/** Item de CEP (`postcode`): precisão `cep` na busca pelo CEP de logradouro. */
export const itemCep = (lat: number, lng: number) => ({ lat: String(lat), lon: String(lng), place_rank: 21, category: 'place', type: 'postcode', addresstype: 'postcode', address: {} });
/** Item só da cidade (place_rank 16, fronteira administrativa): RN-CORE-77 = não localizado. */
export const itemCidade = (lat: number, lng: number) => ({ lat: String(lat), lon: String(lng), place_rank: 16, category: 'boundary', type: 'administrative', addresstype: 'city', address: {} });

export async function subirNominatimFalso(inicial: (params: Record<string, string>) => RespostaNominatim = () => ({ corpo: [] })): Promise<NominatimFalso> {
  let responder = inicial;
  const requisicoes: RequisicaoNominatim[] = [];
  const servidor: Server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1');
    const params = Object.fromEntries(u.searchParams.entries());
    requisicoes.push({ params, headers: req.headers });
    if (u.pathname !== '/search') {
      res.writeHead(404).end();
      return;
    }
    const r = responder(params);
    if ('status' in r) {
      res.writeHead(r.status, { 'content-type': 'application/json' }).end('{"error":"simulado"}');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(r.corpo));
  });
  await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
  const { port } = servidor.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requisicoes,
    definir: (fn) => {
      responder = fn;
    },
    fechar: () => new Promise<void>((ok) => servidor.close(() => ok())),
  };
}
