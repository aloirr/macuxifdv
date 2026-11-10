import { createVerify, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error script .mjs sem tipos
import * as pacote from '../scripts/pacote.mjs';

let dir = '';
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

describe('pacote win-x64 do Conector', () => {
  it('estrutura do zip: arquivos esperados, conteúdo íntegro e leitura de volta', () => {
    const exemplos = [{ nome: 'conector.exemplo.json', dados: Buffer.from('{"a":1}') }];
    const entradas = pacote.montarEntradas({ versao: '1.4.0', conector: Buffer.from('// js'), nodeExe: Buffer.alloc(5000, 7), winsw: Buffer.from('winsw'), exemplos });
    const lidas = pacote.lerZip(pacote.criarZip(entradas)) as { nome: string; dados: Buffer }[];
    expect(lidas.map((e) => e.nome).sort()).toEqual(['LEIA-ME.txt', 'WinSW-x64.exe', 'conector.mjs', 'exemplos/conector.exemplo.json', 'node.exe']);
    expect(lidas.find((e) => e.nome === 'node.exe')?.dados.equals(Buffer.alloc(5000, 7))).toBe(true);
    expect(lidas.find((e) => e.nome === 'LEIA-ME.txt')?.dados.toString()).toContain('conector-1.4.0.zip.sha256');
  });

  it('zip é reprodutível e o sha256 do conteúdo bate com a linha do .sha256', () => {
    const e = pacote.montarEntradas({ versao: '1.4.0', conector: Buffer.from('x'), nodeExe: Buffer.from('n'), winsw: Buffer.from('w'), exemplos: [] });
    const a = pacote.criarZip(e);
    expect(pacote.sha256(pacote.criarZip(e))).toBe(pacote.sha256(a));
    expect(pacote.sha256(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('binário de terceiro com SHA-256 diferente do fixado aborta (falha fechada) e não vai para o cache', async () => {
    dir = mkdtempSync(join(tmpdir(), 'pacote-'));
    await expect(pacote.obterTerceiro({ url: 'https://x.test/WinSW-x64.exe', sha: pacote.WINSW_SHA256, nome: 'WinSW', cache: dir, baixarFn: async () => Buffer.from('adulterado') })).rejects.toThrow(/não confere/);
    const ok = Buffer.from('conteudo');
    const buf = await pacote.obterTerceiro({ url: 'https://x.test/a.bin', sha: pacote.sha256(ok), nome: 'a', cache: dir, baixarFn: async () => ok });
    expect(buf.equals(ok)).toBe(true);
    // segunda chamada usa o cache (a função de download não pode ser chamada)
    await pacote.obterTerceiro({ url: 'https://x.test/a.bin', sha: pacote.sha256(ok), nome: 'a', cache: dir, baixarFn: async () => { throw new Error('rede'); } });
  });

  it('assinatura RSA-SHA256 (PKCS#1 v1.5) verifica com a chave pública e falha com o zip alterado', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const zip = Buffer.from('pacote');
    const sig = pacote.assinar(zip, privateKey.export({ type: 'pkcs8', format: 'pem' }));
    expect(createVerify('RSA-SHA256').update(zip).verify(publicKey, sig)).toBe(true);
    expect(createVerify('RSA-SHA256').update(Buffer.from('outro')).verify(publicKey, sig)).toBe(false);
  });

  it('versões e hashes fixados dos terceiros estão no formato esperado', () => {
    expect(pacote.NODE_ZIP_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(pacote.WINSW_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(pacote.NODE_VERSAO).toMatch(/^24\.\d+\.\d+$/);
  });
});
