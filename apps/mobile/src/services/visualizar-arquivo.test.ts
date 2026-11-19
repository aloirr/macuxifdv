/**
 * T-0186 (RD-2356; P15 e P17): a porta `abrirArquivo` do Cliente 360 só mostra. Imagem vai ao visor de foto comum (em
 * memória); o resto abre `/arquivo` com o título e o subtítulo. O PDF baixado pela API da sessão vai só para
 * `<cache>/visualizar/` e é apagado ao fechar; sem sinal, mensagem curta; nada em log.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sim = vi.hoisted(() => ({
  empurrados: [] as unknown[],
  fotos: [] as unknown[],
  gravados: [] as { caminho: string; bytes: number }[],
  criadas: [] as string[],
  existentes: new Set<string>(),
  online: true,
  ligada: true,
  resposta: null as Uint8Array | null,
  falha: null as Error | null,
  pedidos: [] as { path: string; opts: unknown }[],
}));

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-router', () => ({ router: { push: (r: unknown) => sim.empurrados.push(r) } }));
vi.mock('expo-file-system', () => {
  const caminho = (partes: unknown[]) => partes.map((p) => (typeof p === 'string' ? p : (p as { caminho: string }).caminho)).join('/');
  class Directory {
    caminho: string;
    constructor(...partes: unknown[]) {
      this.caminho = caminho(partes);
    }
    get exists() {
      return sim.existentes.has(this.caminho);
    }
    create() {
      sim.criadas.push(this.caminho);
      sim.existentes.add(this.caminho);
    }
    delete() {
      for (const c of [...sim.existentes]) if (c === this.caminho || c.startsWith(`${this.caminho}/`)) sim.existentes.delete(c);
    }
  }
  class File {
    caminho: string;
    constructor(...partes: unknown[]) {
      this.caminho = caminho(partes);
    }
    get uri() {
      return `file:///${this.caminho}`;
    }
    create() {
      sim.existentes.add(this.caminho);
    }
    write(b: Uint8Array) {
      sim.gravados.push({ caminho: this.caminho, bytes: b.length });
    }
  }
  return { Directory, File, Paths: { cache: 'cache', document: 'documentos' } };
});
vi.mock('./device', () => ({ uuid: () => 'aaaaaaaa-0000-4000-8000-000000000001' }));
vi.mock('./visor-foto', () => ({ abrirFoto: (p: unknown) => sim.fotos.push(p) }));
vi.mock('@/services/api', () => ({ NetworkError: class NetworkError extends Error {} }));
vi.mock('./foto-pdv', () => ({
  fonteDeArquivos: () =>
    sim.ligada
      ? {
          online: () => sim.online,
          api: () => ({
            bytes: async (path: string, opts: unknown) => {
              sim.pedidos.push({ path, opts });
              if (sim.falha) throw sim.falha;
              return sim.resposta;
            },
          }),
        }
      : null,
}));

import { TEXTO_ARQUIVO_INDISPONIVEL, TEXTO_PDF_SEM_VISOR, TEXTO_SEM_INTERNET } from '@/lib/visualizar-arquivo';
import { NetworkError } from '@/services/api';
import { abrirArquivo, baixarArquivo, limparTemporarios } from './visualizar-arquivo';

const ID = '0b9f6c3e-6a7d-4c1e-9f0a-2b3c4d5e6f70';
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);

let logs: ReturnType<typeof vi.spyOn>[] = [];

beforeEach(() => {
  sim.empurrados.length = 0;
  sim.fotos.length = 0;
  sim.gravados.length = 0;
  sim.criadas.length = 0;
  sim.pedidos.length = 0;
  sim.existentes.clear();
  sim.online = true;
  sim.ligada = true;
  sim.resposta = PDF;
  sim.falha = null;
  logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m));
});

afterEach(() => {
  for (const l of logs) {
    expect(l).not.toHaveBeenCalled(); // sem id nem dado pessoal em log: nada em log
    l.mockRestore();
  }
});

describe('abrirArquivo (porta do Core)', () => {
  it('PDF da NF: abre /arquivo com o título e o subtítulo', () => {
    abrirArquivo({ arquivo_id: ID, titulo: 'NF 12345', subtitulo: 'Emitida em 08/11/2026', formato: 'pdf' });
    expect(sim.empurrados).toEqual([{ pathname: '/arquivo', params: { arquivo: ID, titulo: 'NF 12345', subtitulo: 'Emitida em 08/11/2026' } }]);
    expect(sim.fotos).toEqual([]);
  });

  it('documento de imagem: o visor de foto comum, com o título e o subtítulo', () => {
    abrirArquivo({ arquivo_id: ID, titulo: 'Alvará', subtitulo: 'Vence em 10/12/2026', formato: 'jpg' });
    expect(sim.fotos).toEqual([{ arquivo_id: ID, titulo: 'Alvará', subtitulo: 'Vence em 10/12/2026' }]);
    expect(sim.empurrados).toEqual([]);
  });

  it('formato desconhecido vai a /arquivo (os bytes decidem); arquivo que não é UUID não abre nada', () => {
    abrirArquivo({ arquivo_id: ID, titulo: 'Contrato', formato: null });
    expect(sim.empurrados).toEqual([{ pathname: '/arquivo', params: { arquivo: ID, titulo: 'Contrato' } }]);
    abrirArquivo({ arquivo_id: '../x', titulo: 'X', formato: 'pdf' });
    expect(sim.empurrados).toHaveLength(1);
  });
});

describe('baixarArquivo', () => {
  it('PDF: baixa pela API da sessão e grava só em <cache>/visualizar/; limparTemporarios apaga ao fechar', async () => {
    const r = await baixarArquivo(ID, { pdf: true });
    expect(sim.pedidos[0]!.path).toBe(`/v1/arquivos/${ID}`);
    expect(r).toEqual({ tipo: 'pdf', uri: 'file:///cache/visualizar/aaaaaaaa-0000-4000-8000-000000000001.pdf' });
    expect(sim.gravados).toEqual([{ caminho: 'cache/visualizar/aaaaaaaa-0000-4000-8000-000000000001.pdf', bytes: PDF.length }]);
    expect([...sim.existentes].every((c) => c.startsWith('cache/visualizar'))).toBe(true);
    limparTemporarios();
    expect(sim.existentes.size).toBe(0);
  });

  it('a sobra de uma abertura anterior é apagada antes do novo download', async () => {
    sim.existentes.add('cache/visualizar');
    sim.existentes.add('cache/visualizar/antigo.pdf');
    await baixarArquivo(ID, { pdf: true });
    expect(sim.existentes.has('cache/visualizar/antigo.pdf')).toBe(false);
  });

  it('sem o visor de PDF no aparelho: nada é gravado e volta a mensagem', async () => {
    expect(await baixarArquivo(ID, { pdf: false })).toEqual({ tipo: 'erro', mensagem: TEXTO_PDF_SEM_VISOR });
    expect(sim.gravados).toEqual([]);
  });

  it('imagem: fica em memória (data: URI), nada é gravado', async () => {
    sim.resposta = JPEG;
    const r = await baixarArquivo(ID, { pdf: true });
    expect(r.tipo).toBe('imagem');
    expect(r.tipo === 'imagem' && r.uri.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(sim.gravados).toEqual([]);
  });

  it('sem internet: "Sem internet", como no Core, sem chamar a API; queda de rede no meio: a mesma mensagem', async () => {
    expect(TEXTO_SEM_INTERNET).toBe('Sem internet');
    sim.online = false;
    expect(await baixarArquivo(ID, { pdf: true })).toEqual({ tipo: 'erro', mensagem: TEXTO_SEM_INTERNET });
    expect(sim.pedidos).toEqual([]);
    sim.online = true;
    sim.falha = new NetworkError('x');
    expect(await baixarArquivo(ID, { pdf: true })).toEqual({ tipo: 'erro', mensagem: TEXTO_SEM_INTERNET });
  });

  it('recusa da API, bytes que não são PDF nem imagem, ou sem sessão: não foi possível abrir, nada gravado', async () => {
    sim.falha = new Error('http_403');
    expect(await baixarArquivo(ID, { pdf: true })).toEqual({ tipo: 'erro', mensagem: TEXTO_ARQUIVO_INDISPONIVEL });
    sim.falha = null;
    sim.resposta = new Uint8Array([1, 2, 3, 4]);
    expect(await baixarArquivo(ID, { pdf: true })).toEqual({ tipo: 'erro', mensagem: TEXTO_ARQUIVO_INDISPONIVEL });
    sim.ligada = false;
    expect(await baixarArquivo(ID, { pdf: true })).toEqual({ tipo: 'erro', mensagem: TEXTO_ARQUIVO_INDISPONIVEL });
    expect(sim.gravados).toEqual([]);
  });
});
