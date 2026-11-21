import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErroTempoEsgotadoIa, PARAMETROS_PADRAO, registrarDesfechoIa, resolverTimeoutIaMs } from '../../domain';
import { interpretarComMedicao, type LogIa } from './buscar';
import { criarPortaInterpretacaoHttp, ErroProvedorIa, type FetchIa } from './provedor-http';

/**
 * `AbortSignal.timeout` usa um timer interno do Node que o `vi.useFakeTimers` NÃO controla. Por isso a porta aceita
 * `criarSinalTempo`: aqui entra um equivalente com `setTimeout` (falso), que aborta com o mesmo `TimeoutError`.
 * Um teste no final usa o `AbortSignal.timeout` real, com timers reais.
 */
function sinalTempoFalso(ms: number): AbortSignal {
  const c = new AbortController();
  setTimeout(() => c.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError')), ms);
  return c.signal;
}

const resposta = (json: unknown, ok = true, status = 200) => ({ ok, status, json: async () => json });
const filtrosOk = { text: 'detergente', brand: 'Limpex', line: null, min_price_cents: null, max_price_cents: null, stock: null, code: null, measures: [], sort: null };

/** fetch falso que respeita o signal (rejeita com a razão do abort) e fica pendurado até lá. */
function fetchPendurado() {
  const chamadas: Array<{ signal: AbortSignal }> = [];
  const fetch: FetchIa = (_url, init) =>
    new Promise((_ok, falhar) => {
      chamadas.push({ signal: init.signal });
      init.signal.addEventListener('abort', () => falhar(init.signal.reason), { once: true });
    });
  return { fetch, chamadas };
}

const entradaPorta = { tenant_id: 't1', texto: 'detergente da limpex', marcas: ['Limpex'], linhas: [] as string[] };
const vocab = { marcas: ['Limpex'], linhas: ['Detergentes'] };
const logFalso = (): LogIa & { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> } => ({ info: vi.fn(), warn: vi.fn() });

describe('RN-CAT-03: tempo limite real da chamada ao provedor de IA', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('RN-CAT-03: resposta dentro do prazo vira filtros e o timer não dispara depois', async () => {
    const fetch = vi.fn<FetchIa>(async () => resposta(filtrosOk));
    const porta = criarPortaInterpretacaoHttp({ url: 'https://ia.exemplo/v1', timeoutMs: 8000, fetch, criarSinalTempo: sinalTempoFalso });
    await expect(porta.interpretar(entradaPorta)).resolves.toEqual(filtrosOk);
    const signal = fetch.mock.calls[0]![1].signal;
    await vi.advanceTimersByTimeAsync(9000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(signal.aborted).toBe(true); // o timer só marca o signal já inútil; ninguém mais escuta
  });

  it('RN-CAT-03: estouro do tempo cancela de fato o fetch (signal aborted) e vira ErroTempoEsgotadoIa, sem nova tentativa', async () => {
    const { fetch, chamadas } = fetchPendurado();
    const espiao = vi.fn(fetch);
    const porta = criarPortaInterpretacaoHttp({ url: 'https://ia.exemplo/v1', timeoutMs: 8000, fetch: espiao, criarSinalTempo: sinalTempoFalso });
    const p = porta.interpretar(entradaPorta);
    const resultado = p.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(7999);
    expect(chamadas[0]!.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(chamadas[0]!.signal.aborted).toBe(true);
    expect(await resultado).toBeInstanceOf(ErroTempoEsgotadoIa);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(espiao).toHaveBeenCalledTimes(1);
  });

  it('RN-CAT-03: mesmo um fetch que ignora o signal não prende a busca além do prazo', async () => {
    const fetch: FetchIa = () => new Promise(() => undefined);
    const porta = criarPortaInterpretacaoHttp({ url: 'https://ia.exemplo/v1', timeoutMs: 3000, fetch, criarSinalTempo: sinalTempoFalso });
    const resultado = porta.interpretar(entradaPorta).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await resultado).toBeInstanceOf(ErroTempoEsgotadoIa);
  });

  it('RN-CAT-03: o signal do chamador também cancela o fetch (combinado com o tempo) e não é tempo esgotado', async () => {
    const { fetch, chamadas } = fetchPendurado();
    const porta = criarPortaInterpretacaoHttp({ url: 'https://ia.exemplo/v1', timeoutMs: 8000, fetch, criarSinalTempo: sinalTempoFalso });
    const externo = new AbortController();
    const resultado = porta.interpretar(entradaPorta, { signal: externo.signal }).catch((e: unknown) => e);
    externo.abort();
    const erro = await resultado;
    expect(chamadas[0]!.signal.aborted).toBe(true);
    expect(erro).toBeInstanceOf(ErroProvedorIa);
    expect(erro).toMatchObject({ motivo: 'cancelada' });
  });

  it('RN-CAT-03: signal do chamador já abortado não chega a esperar o provedor', async () => {
    const { fetch } = fetchPendurado();
    const porta = criarPortaInterpretacaoHttp({ url: 'https://ia.exemplo/v1', timeoutMs: 8000, fetch, criarSinalTempo: sinalTempoFalso });
    await expect(porta.interpretar(entradaPorta, { signal: AbortSignal.abort() })).rejects.toMatchObject({ motivo: 'cancelada' });
  });

  it('RN-CAT-03: erro de rede, HTTP não-2xx e corpo que não é JSON viram ErroProvedorIa (sem o texto da pergunta)', async () => {
    const casos: Array<[FetchIa, string]> = [
      [async () => { throw new TypeError('fetch failed: detergente da limpex'); }, 'rede'],
      [async () => resposta({}, false, 503), 'http'],
      [async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token'); } }), 'resposta_invalida'],
    ];
    for (const [fetch, motivo] of casos) {
      const porta = criarPortaInterpretacaoHttp({ url: 'https://ia.exemplo/v1', timeoutMs: 8000, fetch, criarSinalTempo: sinalTempoFalso });
      const erro = await porta.interpretar(entradaPorta).catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(ErroProvedorIa);
      expect(erro).toMatchObject({ motivo });
      expect((erro as Error).message).not.toContain('detergente');
    }
  });

  it('RN-CAT-03: tempo limite inválido na configuração é recusado', () => {
    expect(() => criarPortaInterpretacaoHttp({ url: 'x', timeoutMs: 0 })).toThrow(/tempo limite/i);
  });
});

describe('RN-CAT-03: busca cai para o modo sem IA, com log e cota só quando o provedor respondeu', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const montar = (fetch: FetchIa, log: LogIa, debitarCota: () => Promise<void>, relogio: () => number, signal?: AbortSignal) => {
    const timeoutMs = resolverTimeoutIaMs();
    const porta = criarPortaInterpretacaoHttp({ url: 'https://ia.exemplo/v1', timeoutMs, fetch, criarSinalTempo: sinalTempoFalso });
    return interpretarComMedicao({
      tenant_id: 't1',
      texto: 'detergente da limpex com estoque',
      vocabulario: vocab,
      porta,
      online: true,
      ia: { permitido: true, mensagem: null },
      signal,
      log,
      relogio,
      timeoutMs,
      debitarCota,
    });
  };

  it('RN-CAT-03: resposta a tempo — origem llm, sem aviso, cota debitada uma vez e log info com tenant e duração', async () => {
    let t = 1000;
    const fetch: FetchIa = async () => { t += 420; return resposta(filtrosOk); };
    const log = logFalso();
    const debitar = vi.fn(async () => undefined);
    const r = await montar(fetch, log, debitar, () => t);
    expect(r).toMatchObject({ origem: 'llm', desfecho: 'respondida', cotaDebitada: true, duracaoMs: 420, resumo: { interpreted_by: 'llm', degraded: false, notice: null } });
    expect(debitar).toHaveBeenCalledTimes(1);
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(expect.objectContaining({ tenant_id: 't1', duracao_ms: 420, desfecho: 'respondida', timeout_ms: 8000 }), expect.any(String));
  });

  it('RN-CAT-03: estouro do tempo — busca sem IA com aviso, cota NÃO debitada, fetch cancelado e chamado 1 vez, log sem o texto', async () => {
    let t = 0;
    const { fetch, chamadas } = fetchPendurado();
    const espiao = vi.fn(fetch);
    const log = logFalso();
    const debitar = vi.fn(async () => undefined);
    const p = montar(espiao, log, debitar, () => t);
    t = 8000;
    await vi.advanceTimersByTimeAsync(8000);
    const r = await p;
    expect(r).toMatchObject({ origem: 'regras', desfecho: 'tempo_esgotado', consomeCota: false, cotaDebitada: false, duracaoMs: 8000, aviso: null, degradada: true });
    expect(r.resumo).toEqual({ interpreted_by: 'regras', degraded: true, notice: null });
    expect(r.filtros.stock).toBe('com'); // a busca por regras locais continua funcionando
    expect(chamadas[0]!.signal.aborted).toBe(true);
    expect(espiao).toHaveBeenCalledTimes(1);
    expect(debitar).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledTimes(1);
    const [dados] = log.warn.mock.calls[0]!;
    expect(dados).toMatchObject({ tenant_id: 't1', duracao_ms: 8000, desfecho: 'tempo_esgotado' });
    expect(JSON.stringify(log.warn.mock.calls)).not.toMatch(/detergente|limpex/i);
    // contador de uso inalterado
    const uso = registrarDesfechoIa({ dia: '2026-11-01', consultas: 7 }, '2026-11-01T15:00:00Z', 'America/Manaus', PARAMETROS_PADRAO, r.desfecho);
    expect(uso).toMatchObject({ consumiu: false, uso: { consultas: 7 } });
  });

  it('RN-CAT-03: erro do provedor (rede ou HTTP 503) — fallback sem IA, cota NÃO debitada, uma chamada só', async () => {
    for (const falha of [async () => { throw new TypeError('fetch failed'); }, async () => resposta({}, false, 503)] as FetchIa[]) {
      const espiao = vi.fn(falha);
      const log = logFalso();
      const debitar = vi.fn(async () => undefined);
      const r = await montar(espiao, log, debitar, () => 0);
      expect(r).toMatchObject({ origem: 'regras', desfecho: 'erro', cotaDebitada: false, aviso: null, degradada: true });
      expect(espiao).toHaveBeenCalledTimes(1);
      expect(debitar).not.toHaveBeenCalled();
      expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ tenant_id: 't1', desfecho: 'erro' }), expect.any(String));
    }
  });

  it('RN-CAT-03: resposta 2xx que não é JSON conta como erro do provedor — sem débito', async () => {
    const fetch: FetchIa = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } });
    const debitar = vi.fn(async () => undefined);
    const r = await montar(fetch, logFalso(), debitar, () => 0);
    expect(r).toMatchObject({ desfecho: 'erro', cotaDebitada: false });
    expect(debitar).not.toHaveBeenCalled();
  });

  it('RN-CAT-03: cancelamento pelo chamador — fallback sem IA, sem débito', async () => {
    const { fetch, chamadas } = fetchPendurado();
    const debitar = vi.fn(async () => undefined);
    const externo = new AbortController();
    const p = montar(fetch, logFalso(), debitar, () => 0, externo.signal);
    await vi.advanceTimersByTimeAsync(10);
    externo.abort();
    const r = await p;
    expect(chamadas[0]!.signal.aborted).toBe(true);
    expect(r).toMatchObject({ origem: 'regras', desfecho: 'erro', cotaDebitada: false });
    expect(debitar).not.toHaveBeenCalled();
  });

  it('RN-CAT-03: falha ao gravar o débito não derruba a busca; fica no log, sem texto da pergunta', async () => {
    const log = logFalso();
    const r = await montar(async () => resposta(filtrosOk), log, async () => { throw new Error('banco fora'); }, () => 0);
    expect(r).toMatchObject({ origem: 'llm', cotaDebitada: false });
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ evento: 'catalogo.ia.debito_falhou', tenant_id: 't1' }), expect.any(String));
  });

  it('RN-CAT-03: offline, limite e sem porta não chamam o provedor, não logam chamada e não debitam', async () => {
    const log = logFalso();
    const debitar = vi.fn(async () => undefined);
    const r = await interpretarComMedicao({ tenant_id: 't1', texto: 'detergente', vocabulario: vocab, porta: null, online: true, ia: { permitido: true, mensagem: null }, log, debitarCota: debitar });
    expect(r).toMatchObject({ chamouProvedor: false, desfecho: 'nao_chamada', cotaDebitada: false });
    expect(log.info).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
    expect(debitar).not.toHaveBeenCalled();
  });
});

describe('RN-CAT-03: AbortSignal.timeout real (timers reais)', () => {
  it('RN-CAT-03: sem fábrica injetada a porta usa AbortSignal.timeout e cancela o fetch no prazo', async () => {
    const { fetch, chamadas } = fetchPendurado();
    const porta = criarPortaInterpretacaoHttp({ url: 'https://ia.exemplo/v1', timeoutMs: 30, fetch });
    const inicio = Date.now();
    const erro = await porta.interpretar(entradaPorta).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroTempoEsgotadoIa);
    expect(chamadas[0]!.signal.aborted).toBe(true);
    expect(Date.now() - inicio).toBeLessThan(2000);
  });
});
