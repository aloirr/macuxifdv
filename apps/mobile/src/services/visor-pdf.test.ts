/**
 * T-0186 (v1.0.16): carga do PDF — o download (`baixarArquivoDoVisor`, testado em foto-pdv.test.ts) é simulado; aqui
 * fica o que é do PDF: temporário no cache apagado ao fechar (também quando chega depois de fechar), erro do download
 * sem arquivo, bytes que não são PDF recusados, nada guardado de outra abertura e a pasta apagada no bloqueio.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sim = vi.hoisted(() => ({
  arquivos: new Map<string, Uint8Array>(),
  baixar: vi.fn(),
}));

vi.mock('@/services/foto-pdv', () => ({ baixarArquivoDoVisor: sim.baixar }));

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
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
  return { Directory, File, Paths: { cache: 'file:///cache' } };
});

import type { EstadoVisor } from '@/lib/visor-foto';

import { abrirPdfNaTela, carregarPdf, limparPdfsTemporarios } from './visor-pdf';

const ID = '0b9f6c3e-6a7d-4c1e-9f0a-2b3c4d5e6f70';
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
const esperar = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  sim.arquivos.clear();
  sim.baixar.mockReset();
  sim.baixar.mockResolvedValue({ tipo: 'ok', bytes: PDF });
});

describe('carregarPdf', () => {
  it('baixa pelo download do visor e grava um temporário na pasta visor-pdf do cache', async () => {
    const r = await carregarPdf(ID);
    expect(sim.baixar).toHaveBeenCalledWith(ID);
    expect(r.tipo).toBe('ok');
    const uri = r.tipo === 'ok' ? r.uri : '';
    expect(uri.startsWith(`file:///cache/visor-pdf/${ID}-`)).toBe(true);
    expect(sim.arquivos.get(uri)).toEqual(PDF);
  });

  it('erro do download: a mensagem dele chega à tela e nada é gravado', async () => {
    sim.baixar.mockResolvedValue({ tipo: 'erro', mensagem: 'Sem internet' });
    expect(await carregarPdf(ID)).toEqual({ tipo: 'erro', mensagem: 'Sem internet' });
    expect(sim.arquivos.size).toBe(0);
  });

  it('bytes que não são PDF: "Não foi possível abrir." e nada gravado', async () => {
    sim.baixar.mockResolvedValue({ tipo: 'ok', bytes: new Uint8Array([0xff, 0xd8, 0xff]) });
    expect(await carregarPdf(ID)).toEqual({ tipo: 'erro', mensagem: 'Não foi possível abrir.' });
    expect(sim.arquivos.size).toBe(0);
  });

  it('nova abertura apaga a sobra da anterior; o bloqueio apaga a pasta', async () => {
    sim.arquivos.set('file:///cache/visor-pdf/sobra.pdf', PDF);
    await carregarPdf(ID);
    expect([...sim.arquivos.keys()].some((k) => k.endsWith('sobra.pdf'))).toBe(false);
    expect(sim.arquivos.size).toBe(1);
    limparPdfsTemporarios();
    expect(sim.arquivos.size).toBe(0);
  });
});

describe('abrirPdfNaTela', () => {
  it('carregando, depois o temporário; fechar apaga o arquivo', async () => {
    const estados: EstadoVisor[] = [];
    const fechar = abrirPdfNaTela(ID, (e) => estados.push(e));
    await esperar();
    expect(estados.map((e) => e.tipo)).toEqual(['carregando', 'ok']);
    expect(sim.arquivos.size).toBe(1);
    fechar();
    expect(sim.arquivos.size).toBe(0);
  });

  it('fechou antes de chegar: o temporário é apagado e a tela não recebe nada', async () => {
    const estados: EstadoVisor[] = [];
    const fechar = abrirPdfNaTela(ID, (e) => estados.push(e));
    fechar();
    await esperar();
    expect(estados.map((e) => e.tipo)).toEqual(['carregando']);
    expect(sim.arquivos.size).toBe(0);
  });
});
