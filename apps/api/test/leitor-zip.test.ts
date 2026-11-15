/**
 * Leitor de ZIP seguro (ADR 0054 §3; RN-CAT-14), só com node:zlib: diretório central, path traversal, zip bomb (razão,
 * teto por entrada e soma), CRC-32 e tamanho real, ZIP64/vários discos, nomes UTF-8 e CP437, tipo pela assinatura e a
 * junção das partes de 8 MiB num temporário (com o SHA-256 do ZIP).
 */
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ENTRADAS_BRUTAS_MAX, LIMITES_ZIP_TETO, PARTE_ENVIO_BYTES, type LimitesZip, type TipoImagem } from '@macuxi/platform-sdk';
import { encode } from 'jpeg-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chaveDaParte, criarArmazenamentoEmMemoria } from '../src/arquivos';
import { abrirZipLocal, juntarPartes } from '../src/leitor-zip';
import { IMAGENS_TESTE } from './imagens-teste';
import { montarZip, type EntradaTeste } from './zip-teste';

const TODOS: readonly TipoImagem[] = ['image/jpeg', 'image/png', 'image/webp'];
const JPEG = new Uint8Array(encode({ width: 8, height: 6, data: Buffer.alloc(8 * 6 * 4, 128) }, 80).data);
const GIF = new Uint8Array(Buffer.from('GIF89a\x08\x00\x06\x00\x00\x00\x00;', 'latin1'));

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'macuxi-zip-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

let n = 0;
async function abrir(entradas: readonly EntradaTeste[], limites: Partial<LimitesZip> = {}, op: Parameters<typeof montarZip>[1] = {}) {
  const caminho = join(dir, `z${n++}.zip`);
  const bytes = montarZip(entradas, op);
  await writeFile(caminho, bytes);
  return { r: await abrirZipLocal(caminho, { ...LIMITES_ZIP_TETO, ...limites }, { tiposDecodificaveis: TODOS }), bytes };
}
async function aberto(entradas: readonly EntradaTeste[], limites: Partial<LimitesZip> = {}) {
  const { r, bytes } = await abrir(entradas, limites);
  if (!r.ok) throw new Error(`zip recusado: ${r.motivo}`);
  return { zip: r.zip, bytes };
}

describe('abrirZipLocal: diretório central (ADR 0054 §3)', () => {
  it('lista as entradas na ordem do diretório, com o SHA-256 e o tamanho do ZIP; nomes UTF-8 e CP437 em NFC', async () => {
    const { zip, bytes } = await aberto([
      { nome: 'A1.jpg', dados: JPEG },
      { nome: 'fotos/A1_2.png', dados: IMAGENS_TESTE.png, metodo: 0 },
      { nome: 'fotos/' },
      { nome: 'Pão.jpg', dados: JPEG },
      { nome: 'x', nomeBytes: new Uint8Array([0x80, 0x2e, 0x6a, 0x70, 0x67]), dados: JPEG }, // "Ç.jpg" em CP437
    ]);
    expect(zip.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(zip.tamanho_bytes).toBe(bytes.length);
    expect(zip.entradas.map((e) => [e.indice, e.caminho, e.pasta, e.metodo])).toEqual([
      [0, 'A1.jpg', false, 8],
      [1, 'fotos/A1_2.png', false, 0],
      [2, 'fotos/', true, 8],
      [3, 'Pão'.normalize('NFC') + '.jpg', false, 8],
      [4, 'Ç.jpg', false, 8],
    ]);
    await zip.fechar();
  });

  it('lê a foto (tipo pela assinatura, dimensões, SHA-256 da imagem) em stored e deflate', async () => {
    const { zip } = await aberto([
      { nome: 'A1.jpg', dados: JPEG },
      { nome: 'A2.png', dados: IMAGENS_TESTE.png, metodo: 0 },
      { nome: '7891234567895.webp', dados: IMAGENS_TESTE.webpComPerda },
    ]);
    const a = await zip.ler(0, { tipos: TODOS });
    expect(a).toMatchObject({ ok: true, tipo: 'image/jpeg', largura: 8, altura: 6, sha256: createHash('sha256').update(JPEG).digest('hex') });
    expect(await zip.ler(1, { tipos: TODOS })).toMatchObject({ ok: true, tipo: 'image/png', largura: 40, altura: 30 });
    expect(await zip.ler(2, { tipos: TODOS })).toMatchObject({ ok: true, tipo: 'image/webp', largura: 40, altura: 30 });
    await zip.fechar();
  });

  it('GIF renomeado para .jpg e PDF → tipo_nao_aceito; PNG com o módulo aceitando só JPEG → tipo_nao_aceito com o tipo detectado', async () => {
    const { zip } = await aberto([
      { nome: 'A1.jpg', dados: GIF },
      { nome: 'A2.jpg', dados: new Uint8Array(Buffer.from('%PDF-1.7\n%%EOF\n')) },
      { nome: 'A3.jpg', dados: IMAGENS_TESTE.png },
    ]);
    expect(await zip.ler(0, { tipos: TODOS })).toEqual({ ok: false, motivo: 'tipo_nao_aceito', tipo_detectado: null });
    expect(await zip.ler(1, { tipos: TODOS })).toEqual({ ok: false, motivo: 'tipo_nao_aceito', tipo_detectado: null });
    expect(await zip.ler(2, { tipos: ['image/jpeg'] })).toEqual({ ok: false, motivo: 'tipo_nao_aceito', tipo_detectado: 'image/png' });
    await zip.fechar();
  });

  it('cabeçalho de imagem quebrado (assinatura certa, resto lixo) → foto_ilegivel', async () => {
    const { zip } = await aberto([{ nome: 'A1.png', dados: IMAGENS_TESTE.png.subarray(0, 12) }]);
    expect(await zip.ler(0, { tipos: TODOS })).toEqual({ ok: false, motivo: 'foto_ilegivel', tipo_detectado: 'image/png' });
    await zip.fechar();
  });

  it('CRC-32 errado, tamanho real maior ou menor que o declarado → entrada_corrompida', async () => {
    const { zip } = await aberto([
      { nome: 'crc.jpg', dados: JPEG, crc: 1 },
      { nome: 'maior.jpg', dados: JPEG, descompactado: JPEG.length - 10 },
      { nome: 'menor.jpg', dados: JPEG, descompactado: JPEG.length + 10 },
      { nome: 'stored.jpg', dados: JPEG, metodo: 0, descompactado: JPEG.length + 1 },
    ]);
    for (const i of [0, 1, 2, 3]) expect(await zip.ler(i, { tipos: TODOS }), String(i)).toMatchObject({ ok: false, motivo: 'entrada_corrompida' });
    await zip.fechar();
  });

  it('path traversal e criptografia: a leitura devolve a recusa da classificação, sem descompactar', async () => {
    const { zip } = await aberto([
      { nome: '../x.jpg', dados: JPEG },
      { nome: 'A1.jpg', dados: JPEG, flags: 1 },
      { nome: 'A2.jpg', dados: JPEG, metodo: 12 },
    ]);
    expect(await zip.ler(0, { tipos: TODOS })).toEqual({ ok: false, motivo: 'caminho_invalido', tipo_detectado: null });
    expect(await zip.ler(1, { tipos: TODOS })).toEqual({ ok: false, motivo: 'criptografado', tipo_detectado: null });
    expect(await zip.ler(2, { tipos: TODOS })).toEqual({ ok: false, motivo: 'compressao_nao_suportada', tipo_detectado: null });
    await zip.fechar();
  });

  it('zip bomb: 4 MB de zeros (razão ≫ 20) → compressao_suspeita; foto declarada com mais de 8 MB → foto_grande', async () => {
    const { zip } = await aberto([
      { nome: 'bomba.jpg', dados: new Uint8Array(4 * 1024 * 1024) },
      { nome: 'grande.jpg', dados: JPEG, metodo: 0, descompactado: 8 * 1024 * 1024 + 1, compactado: JPEG.length },
    ]);
    expect(await zip.ler(0, { tipos: TODOS })).toMatchObject({ ok: false, motivo: 'compressao_suspeita' });
    expect(await zip.ler(1, { tipos: TODOS })).toMatchObject({ ok: false, motivo: 'foto_grande' });
    await zip.fechar();
  });

  it('A-T0174-1: stored que declara 400 MiB compactados e 1 KB descompactado → foto_grande, sem alocar o compactado', async () => {
    const { zip } = await aberto([{ nome: 'A1.jpg', dados: JPEG, metodo: 0, descompactado: 1000, compactado: 400 * 1024 * 1024 }]);
    expect(await zip.ler(0, { tipos: TODOS })).toEqual({ ok: false, motivo: 'foto_grande', tipo_detectado: null });
    await zip.fechar();
  });

  it('deflate que mente o tamanho para caber na razão: o inflate para no declarado (nunca passa do teto real)', async () => {
    // declara 30 KB descompactados (razão < 20 com 4 KB compactados), mas descompacta 4 MB: corta no declarado
    const { zip } = await aberto([{ nome: 'mentira.jpg', dados: new Uint8Array(4 * 1024 * 1024), descompactado: 30_000 }]);
    expect(await zip.ler(0, { tipos: TODOS })).toMatchObject({ ok: false, motivo: 'entrada_corrompida' });
    await zip.fechar();
  });
});

describe('abrirZipLocal: recusa do lote inteiro', () => {
  it('lixo, ZIP64, vários discos e diretório central cortado', async () => {
    const lixo = join(dir, 'lixo.zip');
    await writeFile(lixo, Buffer.from('isto não é um zip'.repeat(10)));
    expect(await abrirZipLocal(lixo, LIMITES_ZIP_TETO, { tiposDecodificaveis: TODOS })).toEqual({ ok: false, motivo: 'zip_invalido' });
    expect((await abrir([{ nome: 'A1.jpg', dados: JPEG }], {}, { zip64: true })).r).toEqual({ ok: false, motivo: 'zip64_nao_suportado' });
    expect((await abrir([{ nome: 'A1.jpg', dados: JPEG }], {}, { discos: true })).r).toEqual({ ok: false, motivo: 'zip_invalido' });
    const inteiro = montarZip([{ nome: 'A1.jpg', dados: JPEG }, { nome: 'A2.jpg', dados: JPEG }]);
    const cortado = join(dir, 'cortado.zip');
    // tira um pedaço do meio: o diretório central aponta para depois do fim do que sobrou
    await writeFile(cortado, Buffer.concat([inteiro.subarray(0, 40), inteiro.subarray(inteiro.length - 160)]));
    const r = await abrirZipLocal(cortado, LIMITES_ZIP_TETO, { tiposDecodificaveis: TODOS });
    expect(r.ok).toBe(false);
  });

  it('comentário no fim não atrapalha achar o diretório', async () => {
    const { r } = await abrir([{ nome: 'A1.jpg', dados: JPEG }], {}, { comentario: 'PK\u0005\u0006 falso no comentário' });
    expect(r.ok).toBe(true);
    if (r.ok) await r.zip.fechar();
  });

  it('ZIP acima do teto → zip_grande; mais arquivos considerados que o teto → muitos_arquivos; soma declarada → descompactado_grande', async () => {
    expect((await abrir([{ nome: 'A1.jpg', dados: JPEG }], { bytesZipMax: 100 })).r).toEqual({ ok: false, motivo: 'zip_grande' });
    // 3 considerados com teto 2 (pasta e __MACOSX não contam)
    const tres: EntradaTeste[] = [{ nome: 'a/' }, { nome: '__MACOSX/._A1.jpg', dados: JPEG }, { nome: 'A1.jpg', dados: JPEG }, { nome: 'A2.jpg', dados: JPEG }, { nome: '../A3.jpg', dados: JPEG }];
    expect((await abrir(tres, { arquivosMax: 2 })).r).toEqual({ ok: false, motivo: 'muitos_arquivos' });
    expect((await abrir(tres, { arquivosMax: 3 })).r.ok).toBe(true);
    expect((await abrir(tres, { bytesDescompactadosMax: JPEG.length * 2 - 1 })).r).toEqual({ ok: false, motivo: 'descompactado_grande' });
  });

  it(`mais de ${ENTRADAS_BRUTAS_MAX} entradas no diretório → muitos_arquivos antes de ler qualquer entrada`, async () => {
    const muitas = Array.from({ length: ENTRADAS_BRUTAS_MAX + 1 }, (_, i) => ({ nome: `p${i}/`, metodo: 0 }));
    expect((await abrir(muitas)).r).toEqual({ ok: false, motivo: 'muitos_arquivos' });
  });
});

describe('juntarPartes: partes de 8 MiB → temporário + SHA-256', () => {
  const CHAVE1 = '0f000000-0000-4000-8000-0000000000aa/catalogo/2026-11/0f000000-0000-4000-8000-0000000000b9.p001.zip';

  it('chaveDaParte deriva p002..p063 da chave da parte 1', () => {
    expect(chaveDaParte(CHAVE1, 2)).toBe(CHAVE1.replace('.p001.zip', '.p002.zip'));
    expect(chaveDaParte(CHAVE1, 63)).toBe(CHAVE1.replace('.p001.zip', '.p063.zip'));
    expect(() => chaveDaParte(CHAVE1, 64)).toThrow();
    expect(() => chaveDaParte('x/y.jpg', 2)).toThrow();
  });

  it('junta na ordem e devolve o SHA-256; parte faltando ou tamanho diferente → zip_incompleto', async () => {
    const arm = criarArmazenamentoEmMemoria();
    const p1 = new Uint8Array(PARTE_ENVIO_BYTES).fill(7);
    const p2 = new Uint8Array([1, 2, 3]);
    await arm.gravar(CHAVE1, p1);
    await arm.gravar(chaveDaParte(CHAVE1, 2), p2);
    const destino = join(dir, 'junto.zip');
    const r = await juntarPartes({ armazenamento: arm, chaveParte1: CHAVE1, tamanhoBytes: PARTE_ENVIO_BYTES + 3, destino });
    const tudo = Buffer.concat([p1, p2]);
    expect(r).toEqual({ ok: true, sha256: createHash('sha256').update(tudo).digest('hex') });
    expect((await readFile(destino)).equals(tudo)).toBe(true);
    expect(await juntarPartes({ armazenamento: arm, chaveParte1: CHAVE1, tamanhoBytes: PARTE_ENVIO_BYTES + 4, destino })).toEqual({ ok: false, motivo: 'zip_incompleto' });
    await arm.remover(chaveDaParte(CHAVE1, 2));
    expect(await juntarPartes({ armazenamento: arm, chaveParte1: CHAVE1, tamanhoBytes: PARTE_ENVIO_BYTES + 3, destino })).toEqual({ ok: false, motivo: 'zip_incompleto' });
  });
});
