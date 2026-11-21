import { describe, expect, it } from 'vitest';
import { ErroHttpModulo, type LogRota } from './api';
import { CODIGO_GEOCODIFICADOR_INDISPONIVEL, GEOCODIFICADOR_DESLIGADO, type EnderecoGeocodificacao } from './geocodificador';
import {
  URL_NOMINATIM_PADRAO,
  USER_AGENT_GEOCODIFICADOR,
  consultasNominatim,
  criarFilaIntervalo,
  criarGeocodificadorNominatim,
  geocodificadorDoAmbiente,
  lerRespostaNominatim,
  type BuscarGeocodificacao,
  type RelogioGeocodificador,
} from './geocodificador-nominatim';

const END: EnderecoGeocodificacao = {
  logradouro: 'Rua Marcílio Dias',
  numero: '215',
  bairro: 'Centro',
  cidade: 'Manaus',
  uf: 'AM',
  cep: '69005-270',
};
const outro = (n: number): EnderecoGeocodificacao => ({ ...END, numero: String(300 + n) });

const flush = () => new Promise<void>((r) => setImmediate(r));

/** Relógio falso: o tempo só anda com `avancar`. */
function relogioFalso() {
  let t = 0;
  const timers: { em: number; resolver: () => void }[] = [];
  const relogio: RelogioGeocodificador & { avancar(ms: number): Promise<void> } = {
    agora: () => t,
    esperar: (ms, sinal) =>
      new Promise<void>((resolver) => {
        if (sinal?.aborted) return resolver();
        const tm = { em: t + ms, resolver };
        timers.push(tm);
        sinal?.addEventListener(
          'abort',
          () => {
            const i = timers.indexOf(tm);
            if (i >= 0) timers.splice(i, 1);
            resolver();
          },
          { once: true },
        );
      }),
    async avancar(ms) {
      const alvo = t + ms;
      for (;;) {
        await flush();
        const prox = timers.filter((x) => x.em <= alvo).sort((a, b) => a.em - b.em)[0];
        if (!prox) break;
        timers.splice(timers.indexOf(prox), 1);
        t = prox.em;
        prox.resolver();
      }
      t = alvo;
      await flush();
    },
  };
  return relogio;
}

interface Chamada {
  url: URL;
  headers: Record<string, string>;
  em: number;
  sinal: AbortSignal;
}

/** Servidor simulado do Nominatim: `responder` recebe a URL e devolve o corpo (lista jsonv2), um status ou `'nunca'`. */
function servidorSimulado(relogio: RelogioGeocodificador, responder: (u: URL) => unknown[] | number | 'nunca' | Error) {
  const chamadas: Chamada[] = [];
  const buscar: BuscarGeocodificacao = (url, init) => {
    const u = new URL(url);
    chamadas.push({ url: u, headers: init.headers, em: relogio.agora(), sinal: init.signal });
    const r = responder(u);
    if (r instanceof Error) return Promise.reject(r);
    if (r === 'nunca')
      return new Promise<Response>((_, rejeitar) => init.signal.addEventListener('abort', () => rejeitar(new Error(`abortado ${url}`))));
    if (typeof r === 'number') return Promise.resolve(new Response('erro', { status: r }));
    return Promise.resolve(new Response(JSON.stringify(r), { status: 200, headers: { 'content-type': 'application/json' } }));
  };
  return { buscar, chamadas };
}

const CASA = { lat: '-3.1340', lon: '-60.0230', place_rank: 30, category: 'place', type: 'house', addresstype: 'place', address: { house_number: '215', road: 'Rua Marcílio Dias' } };
const RUA = { lat: '-3.1335', lon: '-60.0225', place_rank: 26, category: 'highway', type: 'residential', addresstype: 'road', address: { road: 'Rua Marcílio Dias' } };
const CIDADE = { lat: '-3.1190', lon: '-60.0217', place_rank: 16, category: 'boundary', type: 'administrative', addresstype: 'city', address: { city: 'Manaus' } };
const POSTAL = { lat: '-3.1300', lon: '-60.0200', place_rank: 21, category: 'place', type: 'postcode', addresstype: 'postcode', address: { postcode: '69005-270' } };

function montar(responder: Parameters<typeof servidorSimulado>[1], extra: { log?: LogRota; cacheMaximo?: number; cacheTtlMs?: number; prazoMs?: number } = {}) {
  const relogio = relogioFalso();
  const srv = servidorSimulado(relogio, responder);
  const geo = criarGeocodificadorNominatim({ url: 'http://nominatim.teste', buscar: srv.buscar, relogio, fila: criarFilaIntervalo(1000, relogio), ...extra });
  return { relogio, srv, geo };
}

/** Chama e deixa o relógio andar até resolver. */
async function rodar<T>(relogio: ReturnType<typeof relogioFalso>, p: Promise<T>, ms = 20_000): Promise<T> {
  let fim = false;
  const r = p.finally(() => {
    fim = true;
  });
  r.catch(() => undefined);
  for (let i = 0; i < ms / 100 && !fim; i++) await relogio.avancar(100);
  return r;
}

describe('Nominatim: consulta (RN-CORE-77)', () => {
  it('busca estruturada com countrycodes=br, jsonv2, addressdetails, limit=1 e User-Agent genérico', async () => {
    const { relogio, srv, geo } = montar(() => [CASA]);
    expect(await rodar(relogio, geo.localizar(END))).toEqual({ lat: -3.134, lng: -60.023, precisao: 'numero' });
    const c = srv.chamadas[0]!;
    expect(c.url.origin + c.url.pathname).toBe('http://nominatim.teste/search');
    expect(Object.fromEntries(c.url.searchParams)).toEqual({
      street: '215 Rua Marcílio Dias',
      city: 'Manaus',
      state: 'Amazonas',
      countrycodes: 'br',
      format: 'jsonv2',
      addressdetails: '1',
      limit: '1',
    });
    expect(c.headers['user-agent']).toBe(USER_AGENT_GEOCODIFICADOR);
    expect(USER_AGENT_GEOCODIFICADOR).toBe('MacuxiFDV/1.0');
  });

  it('"S/N" sai da rua; sem logradouro vai direto ao CEP; CEP geral da cidade (…000) não é consultado', () => {
    expect(consultasNominatim({ ...END, numero: 'S/N' })[0]!.params.street).toBe('Rua Marcílio Dias');
    expect(consultasNominatim({ ...END, logradouro: null }).map((c) => c.tipo)).toEqual(['cep']);
    expect(consultasNominatim({ ...END, logradouro: null, cep: '69400-000' })).toEqual([]);
  });

  it('precisão: número, rua; só cidade = não localizado', async () => {
    expect(lerRespostaNominatim([CASA], 'rua')?.precisao).toBe('numero');
    expect(lerRespostaNominatim([RUA], 'rua')?.precisao).toBe('rua');
    expect(lerRespostaNominatim([CIDADE], 'rua')).toBeNull();
    expect(lerRespostaNominatim([], 'rua')).toBeNull();
    expect(lerRespostaNominatim([POSTAL], 'cep')?.precisao).toBe('cep');
    expect(lerRespostaNominatim([CIDADE], 'cep')).toBeNull();
    expect(() => lerRespostaNominatim({ erro: 1 }, 'rua')).toThrow();
  });

  it('rua só com a cidade cai para o CEP de logradouro ("cep"); sem CEP útil = null', async () => {
    const { relogio, srv, geo } = montar((u) => (u.searchParams.has('postalcode') ? [POSTAL] : [CIDADE]));
    expect(await rodar(relogio, geo.localizar(END))).toEqual({ lat: -3.13, lng: -60.02, precisao: 'cep' });
    expect(srv.chamadas.map((c) => c.url.searchParams.get('postalcode'))).toEqual([null, '69005-270']);
    expect(srv.chamadas[1]!.em - srv.chamadas[0]!.em).toBeGreaterThanOrEqual(1000);

    const sem = montar(() => [CIDADE]);
    expect(await rodar(sem.relogio, sem.geo.localizar({ ...END, cep: '69400-000' }))).toBeNull();
    expect(sem.srv.chamadas).toHaveLength(1);
  });
});

describe('Nominatim: fila de no máximo 1 requisição por segundo', () => {
  it('três endereços pedidos juntos saem em 0 s, 1 s e 2 s', async () => {
    const { relogio, srv, geo } = montar(() => [CASA]);
    const ps = [geo.localizar(outro(1)), geo.localizar(outro(2)), geo.localizar(outro(3))];
    await relogio.avancar(0);
    expect(srv.chamadas).toHaveLength(1);
    await relogio.avancar(999);
    expect(srv.chamadas).toHaveLength(1);
    await relogio.avancar(1);
    expect(srv.chamadas).toHaveLength(2);
    await relogio.avancar(1000);
    await Promise.all(ps);
    expect(srv.chamadas.map((c) => c.em)).toEqual([0, 1000, 2000]);
  });

  it('a fila é compartilhada por instâncias que usam a mesma fila (a do processo)', async () => {
    const relogio = relogioFalso();
    const fila = criarFilaIntervalo(1000, relogio);
    const srv = servidorSimulado(relogio, () => [CASA]);
    const a = criarGeocodificadorNominatim({ buscar: srv.buscar, relogio, fila });
    const b = criarGeocodificadorNominatim({ buscar: srv.buscar, relogio, fila });
    await rodar(relogio, Promise.all([a.localizar(outro(1)), b.localizar(outro(2))]));
    expect(srv.chamadas.map((c) => c.em)).toEqual([0, 1000]);
  });

  it('uma falha não trava a fila', async () => {
    let n = 0;
    const { relogio, srv, geo } = montar(() => (n++ === 0 ? 500 : [CASA]));
    const r1 = geo.localizar(outro(1)).catch((e: unknown) => e);
    const r2 = geo.localizar(outro(2));
    await rodar(relogio, Promise.all([r1, r2]));
    expect(await r1).toBeInstanceOf(ErroHttpModulo);
    expect((await r2)?.precisao).toBe('numero');
    expect(srv.chamadas).toHaveLength(2);
  });
});

describe('Nominatim: cache LRU com TTL', () => {
  it('o mesmo endereço (escrito de outro jeito) não repete a consulta, inclusive o null', async () => {
    const { relogio, srv, geo } = montar((u) => (u.searchParams.get('street')?.startsWith('215') ? [CASA] : [CIDADE]));
    await rodar(relogio, geo.localizar(END));
    await rodar(relogio, geo.localizar({ ...END, logradouro: 'RUA MARCILIO DIAS', cep: '69005270' }));
    expect(srv.chamadas).toHaveLength(1);
    const semNumero = { ...END, numero: null, cep: null };
    expect(await rodar(relogio, geo.localizar(semNumero))).toBeNull();
    expect(await rodar(relogio, geo.localizar(semNumero))).toBeNull();
    expect(srv.chamadas).toHaveLength(2);
  });

  it('pedidos simultâneos do mesmo endereço viram uma chamada', async () => {
    const { relogio, srv, geo } = montar(() => [CASA]);
    await rodar(relogio, Promise.all([geo.localizar(END), geo.localizar(END)]));
    expect(srv.chamadas).toHaveLength(1);
  });

  it('expira pelo TTL e descarta o menos usado acima do máximo', async () => {
    const { relogio, srv, geo } = montar(() => [CASA], { cacheTtlMs: 60_000, cacheMaximo: 2 });
    await rodar(relogio, geo.localizar(outro(1)));
    await rodar(relogio, geo.localizar(outro(2)));
    await rodar(relogio, geo.localizar(outro(1))); // cache; o 1 vira o mais recente
    await rodar(relogio, geo.localizar(outro(3))); // descarta o 2
    expect(srv.chamadas).toHaveLength(3);
    await rodar(relogio, geo.localizar(outro(1)));
    expect(srv.chamadas).toHaveLength(3);
    await rodar(relogio, geo.localizar(outro(2)));
    expect(srv.chamadas).toHaveLength(4);
    await relogio.avancar(60_000);
    await rodar(relogio, geo.localizar(outro(2)));
    expect(srv.chamadas).toHaveLength(5);
  });

  it('erro não entra no cache: o próximo clique consulta de novo', async () => {
    let n = 0;
    const { relogio, srv, geo } = montar(() => (n++ === 0 ? 429 : [CASA]));
    await expect(rodar(relogio, geo.localizar(END))).rejects.toBeInstanceOf(ErroHttpModulo);
    expect((await rodar(relogio, geo.localizar(END)))?.precisao).toBe('numero');
    expect(srv.chamadas).toHaveLength(2);
  });
});

describe('Nominatim: prazo e falhas viram 503 GEOCODIFICADOR_INDISPONIVEL sem o endereço', () => {
  it('servidor que não responde: aborta no prazo', async () => {
    const { relogio, srv, geo } = montar(() => 'nunca', { prazoMs: 5000 });
    const p = geo.localizar(END).catch((e: unknown) => e);
    await relogio.avancar(4999);
    expect(srv.chamadas[0]!.sinal.aborted).toBe(false);
    await relogio.avancar(1);
    const erro = await p;
    expect(srv.chamadas[0]!.sinal.aborted).toBe(true);
    expect(erro).toBeInstanceOf(ErroHttpModulo);
    expect((erro as ErroHttpModulo).codigo).toBe(CODIGO_GEOCODIFICADOR_INDISPONIVEL);
  });

  it.each([
    ['500', 500],
    ['rede', new Error('fetch failed http://nominatim.teste/search?street=215+Rua+Marc%C3%ADlio+Dias&city=Manaus')],
    ['JSON fora do formato', [{ lat: 'x', lon: 'y' }]],
  ] as const)('%s', async (_, resposta) => {
    const { relogio, geo } = montar(() => (Array.isArray(resposta) ? [...resposta] : resposta) as never);
    const erro = (await rodar(relogio, geo.localizar(END).catch((e: unknown) => e))) as ErroHttpModulo;
    expect(erro).toBeInstanceOf(ErroHttpModulo);
    expect(erro.status).toBe(503);
    expect(erro.codigo).toBe(CODIGO_GEOCODIFICADOR_INDISPONIVEL);
    expect(erro.message + JSON.stringify(erro)).not.toMatch(/Marc|Manaus|69005|215/i);
    expect(erro.cause).toBeUndefined();
  });
});

describe('Nominatim: nenhum endereço nem coordenada em log', () => {
  it('o log só leva origem, resultado, precisão, status e duração', async () => {
    const linhas: unknown[] = [];
    const log: LogRota = { info: (o, m) => linhas.push([o, m]), warn: (o, m) => linhas.push([o, m]), error: (o, m) => linhas.push([o, m]) };
    let n = 0;
    const { relogio, geo } = montar(() => (n++ === 2 ? 503 : [CASA]), { log });
    await rodar(relogio, geo.localizar(END));
    await rodar(relogio, geo.localizar(END));
    await rodar(relogio, geo.localizar({ ...END, numero: '9' }).catch(() => null));
    await rodar(relogio, geo.localizar({ ...END, numero: '10' }).catch(() => null));
    expect(linhas.length).toBeGreaterThanOrEqual(3);
    const texto = JSON.stringify(linhas);
    expect(texto).not.toMatch(/Marc|Manaus|Centro|69005|AM"|-3\.13|-60\.02|nominatim\.teste/i);
    for (const [o] of linhas as [Record<string, unknown>][]) {
      expect(Object.keys(o).every((k) => ['geocodificacao', 'resultado', 'precisao', 'status', 'duracao_ms'].includes(k))).toBe(true);
    }
  });
});

describe('geocodificadorDoAmbiente (MACUXI_NOMINATIM_URL)', () => {
  it('ausente = Nominatim público; "desligado" = sem serviço; outro valor tem de ser http(s)', () => {
    expect(geocodificadorDoAmbiente({}).descricao).toBe(`nominatim ${new URL(URL_NOMINATIM_PADRAO).host}`);
    expect(geocodificadorDoAmbiente({ MACUXI_NOMINATIM_URL: 'http://127.0.0.1:8088' }).descricao).toBe('nominatim 127.0.0.1:8088');
    expect(geocodificadorDoAmbiente({ MACUXI_NOMINATIM_URL: 'desligado' }).criar()).toBe(GEOCODIFICADOR_DESLIGADO);
    expect(geocodificadorDoAmbiente({}).criar().disponivel()).toBe(true);
    expect(() => geocodificadorDoAmbiente({ MACUXI_NOMINATIM_URL: 'ftp://x' })).toThrow(/MACUXI_NOMINATIM_URL/);
    expect(() => geocodificadorDoAmbiente({ MACUXI_NOMINATIM_URL: 'nao é url' })).toThrow(/MACUXI_NOMINATIM_URL/);
  });
});
