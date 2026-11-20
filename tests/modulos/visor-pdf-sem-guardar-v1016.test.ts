/**
 * v1.0.16 (T-0187, "Também na v1.0.16": abrir PDF na ficha do cliente, NF e Documentação; corte da T-0186 de 19/11) — o visor de
 * PDF do shell, de fora, com o código REAL de `apps/mobile/src/services/visor-pdf.ts` e da tela de mensagem (`VisorDeFoto`):
 * só o disco (expo-file-system, num sistema de arquivos em memória que cobre o cache E os documentos do app), o React Native e a
 * fonte de rede (API e sinal, ligada pela porta real `ligarFonteFotoPdv`) são trocados.
 *
 * Pedido do dono do produto: "visualizar sem baixar, sob demanda, sem guardar no aparelho". O que se prova (matriz:
 * docs/testes/T-0187.md, seção "PDF", P-01..P-06):
 *  P-01 abrir com sinal e fechar: durante a leitura há um único temporário; ao fechar, NENHUM arquivo sobra no aparelho;
 *  P-02 sem sinal: nenhum download, nenhum arquivo, e o estado da tela é "Sem internet";
 *  P-03 a rede cai no meio do download: "Sem internet" e nenhum arquivo;
 *  P-04 fechou antes de o PDF chegar, ou abriu dois seguidos: nada sobra depois de fechar;
 *  P-05 a tela de erro mostra o texto "Sem internet" (render real do `VisorDeFoto`, que o visor de PDF usa);
 *  P-06 o download pede `cache: 'no-store'` ao fetch (nada no cache HTTP do aparelho).
 *
 * O visor só existe com o branch `nuvem/v1016-pdf-engenheiro-apps` (engenheiro-apps). Sem o arquivo no `main`, a suíte PULA; o
 * import é dinâmico por caminho em variável, para o typecheck do `main` não depender do módulo novo.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sim = vi.hoisted(() => ({
  arquivos: new Map<string, Uint8Array>(),
  online: true,
  pedidos: [] as string[],
  resposta: null as Uint8Array | null | Error,
  atraso: null as Promise<void> | null,
}));

vi.mock('react-native', async () => {
  const { createElement: ce } = await import('react');
  const h = (tag: string) => (p: { children?: import('react').ReactNode; testID?: string }) => ce(tag, p.testID ? { 'data-testid': p.testID } : {}, p.children);
  class Valor {
    constructor(public v: number) {}
    setValue() {}
    setOffset() {}
    flattenOffset() {}
    extractOffset() {}
  }
  return {
    Platform: { OS: 'android' },
    View: h('div'),
    Text: h('span'),
    Pressable: h('button'),
    Image: h('img'),
    ActivityIndicator: h('progress'),
    StyleSheet: { create: <T,>(s: T) => s, absoluteFillObject: {} },
    Animated: { Value: Valor, View: h('div'), timing: () => ({ start() {} }), spring: () => ({ start() {} }) },
    PanResponder: { create: () => ({ panHandlers: {} }) },
  };
});
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('@macuxi/ui/mobile', async () => {
  const { createElement: ce } = await import('react');
  return { colors: new Proxy({}, { get: () => '#000' }), fonte: new Proxy({}, { get: () => ({}) }), Icon: () => ce('i') };
});
vi.mock('expo-file-system', () => {
  const caminho = (partes: unknown[]) => partes.map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri)).join('/');
  class Directory {
    uri: string;
    constructor(...partes: unknown[]) {
      this.uri = caminho(partes);
    }
    get exists() {
      return [...sim.arquivos.keys()].some((k) => k.startsWith(`${this.uri}/`));
    }
    create() {}
    delete() {
      for (const k of [...sim.arquivos.keys()]) if (k.startsWith(`${this.uri}/`)) sim.arquivos.delete(k);
    }
  }
  class File {
    uri: string;
    constructor(...partes: unknown[]) {
      this.uri = caminho(partes);
    }
    get exists() {
      return sim.arquivos.has(this.uri);
    }
    create() {
      sim.arquivos.set(this.uri, new Uint8Array());
    }
    write(b: Uint8Array) {
      sim.arquivos.set(this.uri, b);
    }
    delete() {
      sim.arquivos.delete(this.uri);
    }
  }
  return { Directory, File, Paths: { cache: 'file:///cache', document: 'file:///document' } };
});
const RAIZ_MOBILE = join(__dirname, '../../apps/mobile/src');
const TEM_VISOR = existsSync(join(RAIZ_MOBILE, 'services/visor-pdf.ts'));
const ID = '0b9f6c3e-6a7d-4c1e-9f0a-2b3c4d5e6f71';
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const esperar = () => new Promise((r) => setTimeout(r, 0));

type Estado = { tipo: string; mensagem?: string; uri?: string };
interface VisorPdf {
  carregarPdf(id: string): Promise<Estado>;
  abrirPdfNaTela(id: string, aoEstado: (e: Estado) => void): () => void;
}
/** Import pelo caminho em variável: o typecheck do `main` (sem o visor) não resolve o módulo. */
const carregar = async <T,>(rel: string): Promise<T> => (await import(/* @vite-ignore */ join(RAIZ_MOBILE, rel))) as T;

/** A fonte (API e sinal) entra pela porta real do shell (`ligarFonteFotoPdv`), e o download é o real (`baixarArquivoDoVisor`). */
const apiFalsa = () => ({
  bytes: async (path: string) => {
    sim.pedidos.push(path);
    if (sim.atraso) await sim.atraso;
    if (sim.resposta instanceof Error) throw sim.resposta;
    return sim.resposta;
  },
});

beforeEach(async () => {
  if (TEM_VISOR) {
    const { ligarFonteFotoPdv } = await carregar<{ ligarFonteFotoPdv: (api: () => unknown, online: () => boolean) => () => void }>(
      'services/foto-pdv.ts',
    );
    ligarFonteFotoPdv(apiFalsa, () => sim.online);
  }
  sim.arquivos.clear();
  sim.pedidos.length = 0;
  sim.online = true;
  sim.resposta = PDF;
  sim.atraso = null;
});

describe.runIf(TEM_VISOR)('v1.0.16 — visor de PDF: nada guardado no aparelho e "Sem internet" sem sinal', () => {
  it('P-01: com sinal, um único temporário enquanto a tela está aberta; ao fechar, nenhum arquivo sobra no aparelho', async () => {
    const v = await carregar<VisorPdf>('services/visor-pdf.ts');
    const estados: Estado[] = [];
    const fechar = v.abrirPdfNaTela(ID, (e) => estados.push(e));
    await esperar();
    expect(estados.map((e) => e.tipo)).toEqual(['carregando', 'ok']);
    expect(sim.pedidos).toEqual([`/v1/arquivos/${ID}`]);
    expect([...sim.arquivos.keys()]).toHaveLength(1);
    expect([...sim.arquivos.keys()][0]!.startsWith('file:///cache/')).toBe(true);
    fechar();
    expect([...sim.arquivos.keys()], 'depois de fechar').toEqual([]);
  });

  it('P-02: sem sinal, nenhum download e nenhum arquivo; o estado da tela é "Sem internet"', async () => {
    const v = await carregar<VisorPdf>('services/visor-pdf.ts');
    sim.online = false;
    const estados: Estado[] = [];
    v.abrirPdfNaTela(ID, (e) => estados.push(e));
    await esperar();
    expect(estados).toEqual([{ tipo: 'carregando' }, { tipo: 'erro', mensagem: 'Sem internet' }]);
    expect(sim.pedidos).toEqual([]);
    expect([...sim.arquivos.keys()]).toEqual([]);
  });

  it('P-03: a rede cai no meio do download — "Sem internet" e nenhum arquivo gravado', async () => {
    const v = await carregar<VisorPdf>('services/visor-pdf.ts');
    const { NetworkError } = await carregar<{ NetworkError: new (m?: string) => Error }>('services/api.ts');
    sim.resposta = new NetworkError('caiu no meio');
    expect(await v.carregarPdf(ID)).toEqual({ tipo: 'erro', mensagem: 'Sem internet' });
    expect([...sim.arquivos.keys()]).toEqual([]);
  });

  it('P-04: fechou antes de o PDF chegar, ou abriu dois seguidos e fechou — nada sobra no aparelho', async () => {
    const v = await carregar<VisorPdf>('services/visor-pdf.ts');
    let soltar = () => undefined as void;
    sim.atraso = new Promise<void>((r) => {
      soltar = r;
    });
    const fecharAntes = v.abrirPdfNaTela(ID, () => undefined);
    fecharAntes();
    soltar();
    await esperar();
    await esperar();
    expect([...sim.arquivos.keys()], 'fechou antes de chegar').toEqual([]);
    sim.atraso = null;
    const f1 = v.abrirPdfNaTela(ID, () => undefined);
    await esperar();
    const f2 = v.abrirPdfNaTela('0b9f6c3e-6a7d-4c1e-9f0a-2b3c4d5e6f72', () => undefined);
    await esperar();
    // cada visor aberto da pilha tem o próprio temporário (apps/mobile/src/services/visor-pdf.ts); fechar um não apaga o do outro
    expect([...sim.arquivos.keys()], 'dois visores abertos, um temporário de cada').toHaveLength(2);
    f2();
    expect([...sim.arquivos.keys()], 'fechou o segundo, sobra só o do primeiro, ainda aberto').toHaveLength(1);
    f1();
    expect([...sim.arquivos.keys()], 'depois de fechar as duas').toEqual([]);
  });

  it('P-05: a tela de erro do visor mostra o texto "Sem internet" (render do VisorDeFoto com o estado do visor de PDF)', async () => {
    const v = await carregar<VisorPdf>('services/visor-pdf.ts');
    sim.online = false;
    const estado = await v.carregarPdf(ID);
    const { VisorDeFoto } = await carregar<{ VisorDeFoto: (p: Record<string, unknown>) => import('react').ReactElement }>('components/visor-foto.tsx');
    const html = renderToStaticMarkup(createElement(VisorDeFoto, { titulo: 'NF 1001', estado, aoFechar: () => undefined, conteudo: () => null }));
    expect(html).toContain('data-testid="visor-foto-erro"');
    expect(html).toContain('Sem internet');
  });

  it('P-06: o download pede ao fetch `cache: "no-store"` (nada no cache HTTP do aparelho)', async () => {
    const { ApiClient } = await carregar<{ ApiClient: new (...a: unknown[]) => { bytes(p: string, o: { maxBytes: number }): Promise<Uint8Array | null> } }>('services/api.ts');
    const chamadas: RequestInit[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
      chamadas.push(init ?? {});
      return new Response(PDF, { status: 200, headers: { 'content-length': String(PDF.length) } });
    }) as typeof fetch;
    try {
      const api = new ApiClient('https://api.exemplo.invalid', () => 'token-de-teste');
      await api.bytes(`/v1/arquivos/${ID}`, { maxBytes: 1_000_000 }).catch(() => null);
    } finally {
      globalThis.fetch = original;
    }
    expect(chamadas.length).toBeGreaterThan(0);
    expect(chamadas[0]!.cache).toBe('no-store');
  });
});
