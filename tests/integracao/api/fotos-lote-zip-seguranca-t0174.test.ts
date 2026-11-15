/**
 * T-0174 (RN-CAT-14, ADR 0058 §3): e2e de segurança do ZIP contra o leitor REAL da plataforma (`apps/api/src/leitor-zip.ts`),
 * com ZIPs montados byte a byte no teste, e a passagem plataforma → módulo (`itensDaConferencia` e `resolverItem` do
 * Catálogo) sem banco. Complementa apps/api/test/leitor-zip.test.ts (do engenheiro-software) com os vetores que ele não
 * cobre: variações de path traversal (barra invertida, absoluto, letra de unidade, meio do caminho, controle), pasta
 * funda (vale só o nome-base), lixo do macOS/Windows ignorado, tipos disfarçados (HTML, SVG, EXE, ZIP dentro de ZIP,
 * GIF/PDF), JPEG com extensão .png aceito pela assinatura, a bomba com razão exatamente no teto e acima, o teto de 8 MiB
 * exato e +1 e a soma de 1 GiB, e que nada é escrito no disco a partir do nome da entrada.
 * Convenção: `it` = vale hoje; `it.fails` = defeito/achado aberto (fica vermelho quando corrigir e vira `it`).
 */
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { classificarEntradaZip, ENTRADAS_BRUTAS_MAX, FOLGA_COMPACTADO_BYTES, LIMITES_ZIP_TETO, type EntradaZip, type LimitesZip, type TipoImagem } from '@macuxi/platform-sdk';
import { resolverItem, interpretarNome, type ProdutoParaCasar } from '../../../modules/catalogo/domain/fotos-lote';
import { encode } from 'jpeg-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { abrirZipLocal } from '../../../apps/api/src/leitor-zip';
import { IMAGENS_TESTE } from '../../../apps/api/test/imagens-teste';
import { montarZip, type EntradaTeste } from '../../../apps/api/test/zip-teste';
import { itensDaConferencia, nomeBaseDoCaminho } from '../../../modules/catalogo/api/trabalho-fotos-lote';

const TODOS: readonly TipoImagem[] = ['image/jpeg', 'image/png', 'image/webp'];
const MIB = 1024 * 1024;
const JPEG = new Uint8Array(encode({ width: 8, height: 6, data: Buffer.alloc(8 * 6 * 4, 90) }, 80).data);
const JPEG2 = new Uint8Array(encode({ width: 8, height: 6, data: Buffer.alloc(8 * 6 * 4, 170) }, 80).data);
const JPEG3 = new Uint8Array(encode({ width: 6, height: 8, data: Buffer.alloc(6 * 8 * 4, 40) }, 80).data);
const txt = (s: string) => new Uint8Array(Buffer.from(s, 'latin1'));
const DISFARCADOS: Record<string, Uint8Array> = {
  'gif.jpg': txt('GIF89a\x08\x00\x06\x00\x00\x00\x00;'),
  'pdf.jpg': txt('%PDF-1.7\n1 0 obj\n%%EOF\n'),
  'html.jpg': txt('<html><script>alert(1)</script></html>'),
  'svg.png': txt('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'),
  'exe.webp': txt('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff'),
  'zip.jpg': new Uint8Array(montarZip([{ nome: 'dentro.jpg', dados: JPEG }])),
  'riff-avi.webp': txt('RIFF\x10\x00\x00\x00AVI LIST\x04\x00\x00\x00'),
};

let dir: string;
let n = 0;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'macuxi-t0174-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function abrir(entradas: readonly EntradaTeste[], limites: Partial<LimitesZip> = {}) {
  const caminho = join(dir, `z${n++}.zip`);
  await writeFile(caminho, montarZip(entradas));
  return abrirZipLocal(caminho, { ...LIMITES_ZIP_TETO, ...limites }, { tiposDecodificaveis: TODOS });
}
async function aberto(entradas: readonly EntradaTeste[], limites: Partial<LimitesZip> = {}) {
  const r = await abrir(entradas, limites);
  if (!r.ok) throw new Error(`zip recusado: ${r.motivo}`);
  return r.zip;
}
const entrada = (caminho: string, o: Partial<EntradaZip> = {}): EntradaZip => ({ indice: 0, caminho, pasta: false, metodo: 8, criptografada: false, compactado: 1000, descompactado: 1000, crc32: 0, ...o });

describe('T-0174 critério 4 — path traversal: só o nome-base vale, caminho perigoso é recusado', () => {
  it('ZS-01: ../, ..\\, a/../../, /absoluto, C:\\, C:relativo e controle no nome → caminho_invalido na leitura, sem descompactar', async () => {
    const perigosos = ['../x.jpg', '..\\x.jpg', 'fotos/../../x.jpg', 'fotos\\..\\..\\x.jpg', '/etc/x.jpg', '\\x.jpg', 'C:\\x.jpg', 'C:x.jpg', 'A1\u0000.jpg', 'A1\n.jpg'];
    const zip = await aberto(perigosos.map((nome) => ({ nome, dados: JPEG })));
    for (let i = 0; i < perigosos.length; i += 1) {
      expect(await zip.ler(i, { tipos: TODOS }), JSON.stringify(perigosos[i])).toEqual({ ok: false, motivo: 'caminho_invalido', tipo_detectado: null });
    }
    // na conferência todas viram item recusado (aparecem no relatório), nenhuma vira pendente
    const itens = itensDaConferencia(zip.entradas, LIMITES_ZIP_TETO);
    expect(itens).toHaveLength(perigosos.length);
    expect(itens.every((x) => x.situacao === 'recusado' && x.motivo === 'caminho_invalido' && x.codigo === null)).toBe(true);
    await zip.fechar();
  });

  it('ZS-02: pasta funda e barra invertida de Windows usam só o nome-base; "A..4.jpg" não é traversal; "..A3.jpg" é oculto (ignorado)', async () => {
    const zip = await aberto([
      { nome: 'catalogo/2026/novembro/A1.jpg', dados: JPEG },
      { nome: 'fotos\\A1_2.jpg', dados: JPEG2 },
      { nome: '..A3.jpg', dados: JPEG3 },
      { nome: 'A..4.jpg', dados: JPEG3 },
    ]);
    const itens = itensDaConferencia(zip.entradas, LIMITES_ZIP_TETO);
    expect(itens.map((x) => [x.situacao, x.codigo])).toEqual([
      ['pendente', 'A1'],
      ['pendente', 'A1_2'],
      ['pendente', 'A..4'],
    ]);
    expect(itens.map((x) => x.indice)).toEqual([0, 1, 3]);
    expect(nomeBaseDoCaminho('fotos\\A1_2.jpg')).toBe('A1_2.jpg');
    expect(await zip.ler(0, { tipos: TODOS })).toMatchObject({ ok: true, tipo: 'image/jpeg' });
    await zip.fechar();
  });

  it('ZS-03: __MACOSX, arquivos ocultos (._x, .DS_Store), Thumbs.db, desktop.ini e pastas são ignorados (fora do relatório e da contagem)', async () => {
    const zip = await aberto([
      { nome: '__MACOSX/', dados: new Uint8Array() },
      { nome: '__MACOSX/._A1.jpg', dados: JPEG },
      { nome: 'fotos/._A1.jpg', dados: JPEG },
      { nome: '.DS_Store', dados: txt('x') },
      { nome: 'fotos/Thumbs.db', dados: txt('x') },
      { nome: 'Desktop.ini', dados: txt('x') },
      { nome: '.oculta/A9.jpg', dados: JPEG },
      { nome: 'fotos/', dados: new Uint8Array() },
      { nome: 'fotos/A1.jpg', dados: JPEG },
    ]);
    const itens = itensDaConferencia(zip.entradas, LIMITES_ZIP_TETO);
    expect(itens.map((x) => x.indice)).toEqual([8]);
    await zip.fechar();
    // contam fora do teto de arquivos: 9 entradas com teto 1 não recusam o ZIP
    const teto1 = await aberto([{ nome: '__MACOSX/._A1.jpg', dados: JPEG }, { nome: '.DS_Store', dados: txt('x') }, { nome: 'A1.jpg', dados: JPEG }], { arquivosMax: 1 });
    await teto1.fechar();
    // e 2 fotos com teto 1 recusam o ZIP inteiro (muitos_arquivos)
    expect(await abrir([{ nome: 'A1.jpg', dados: JPEG }, { nome: 'A2.jpg', dados: JPEG }], { arquivosMax: 1 })).toEqual({ ok: false, motivo: 'muitos_arquivos' });
  });

  it('ZS-04: abrir e ler todas as entradas (inclusive as perigosas) não cria nenhum arquivo no disco: só o ZIP fica na pasta', async () => {
    const sub = await mkdtemp(join(dir, 'isolado-'));
    const caminho = join(sub, 'lote.zip');
    await writeFile(caminho, montarZip([{ nome: '../../fora.jpg', dados: JPEG }, { nome: '/tmp/fora2.jpg', dados: JPEG }, { nome: 'A1.jpg', dados: JPEG }, { nome: 'pasta/', dados: new Uint8Array() }]));
    const r = await abrirZipLocal(caminho, LIMITES_ZIP_TETO, { tiposDecodificaveis: TODOS });
    if (!r.ok) throw new Error(r.motivo);
    for (const e of r.zip.entradas) if (!e.pasta) await r.zip.ler(e.indice, { tipos: TODOS });
    await r.zip.fechar();
    expect(await readdir(sub)).toEqual(['lote.zip']);
    expect(await readdir(dir)).not.toContain('fora.jpg');
  });
});

describe('T-0174 critério 4 — zip bomb e limites por entrada', () => {
  it('ZS-05: razão descompactado/compactado exatamente 20 passa a classificação; 20 e um pouco → compressao_suspeita', () => {
    expect(classificarEntradaZip(entrada('A1.jpg', { compactado: 100_000, descompactado: 2_000_000 }), LIMITES_ZIP_TETO)).toEqual({ acao: 'aceitar', nomeBase: 'A1.jpg' });
    expect(classificarEntradaZip(entrada('A1.jpg', { compactado: 100_000, descompactado: 2_000_001 }), LIMITES_ZIP_TETO)).toEqual({ acao: 'recusar', motivo: 'compressao_suspeita' });
    // compactado declarado 0 não divide por zero: vale como 1
    expect(classificarEntradaZip(entrada('A1.jpg', { compactado: 0, descompactado: 21 }), LIMITES_ZIP_TETO)).toEqual({ acao: 'recusar', motivo: 'compressao_suspeita' });
  });

  it('ZS-06: 8 MiB exatos declarados passam; 8 MiB + 1 → foto_grande (antes da razão)', () => {
    expect(classificarEntradaZip(entrada('A1.jpg', { compactado: 8 * MIB, descompactado: 8 * MIB, metodo: 0 }), LIMITES_ZIP_TETO).acao).toBe('aceitar');
    expect(classificarEntradaZip(entrada('A1.jpg', { compactado: 8 * MIB + 1, descompactado: 8 * MIB + 1, metodo: 0 }), LIMITES_ZIP_TETO)).toEqual({ acao: 'recusar', motivo: 'foto_grande' });
  });

  it('ZS-07: bomba real (8 MiB de zeros, razão ~1000) → compressao_suspeita na leitura; o resto do lote segue e a foto boa abre', async () => {
    const zip = await aberto([
      { nome: 'bomba.jpg', dados: new Uint8Array(8 * MIB) },
      { nome: 'A1.jpg', dados: JPEG },
    ]);
    expect(await zip.ler(0, { tipos: TODOS })).toEqual({ ok: false, motivo: 'compressao_suspeita', tipo_detectado: null });
    expect(await zip.ler(1, { tipos: TODOS })).toMatchObject({ ok: true, tipo: 'image/jpeg' });
    await zip.fechar();
  });

  it('ZS-08: bomba que mente no diretório central (declara pouco, descompacta 64 MiB) para no declarado → entrada_corrompida, sem estourar memória', async () => {
    const zeros = new Uint8Array(64 * MIB);
    const comp = deflateRawSync(zeros).length;
    // declara 15× o compactado: passa na razão e no teto, mas o real é ~1000×
    const zip = await aberto([{ nome: 'mentira.jpg', dados: zeros, descompactado: comp * 15 }]);
    const antes = process.memoryUsage().arrayBuffers;
    expect(await zip.ler(0, { tipos: TODOS })).toMatchObject({ ok: false, motivo: 'entrada_corrompida' });
    expect(process.memoryUsage().arrayBuffers - antes).toBeLessThan(32 * MIB);
    await zip.fechar();
  });

  it('ZS-09: soma declarada dos aceitos acima de 1 GiB → ZIP inteiro recusado (descompactado_grande) antes de qualquer leitura', async () => {
    // 3 entradas que dizem 400 MiB cada não passariam do teto por foto: com o teto por foto alto, quem segura é a soma
    const r = await abrir(
      [0, 1, 2].map((i) => ({ nome: `A${i}.jpg`, dados: JPEG, metodo: 0, compactado: JPEG.length, descompactado: JPEG.length })),
      { bytesDescompactadosMax: JPEG.length * 3 - 1 },
    );
    expect(r).toEqual({ ok: false, motivo: 'descompactado_grande' });
  });

  it('ZS-10 (A-T0174-1, corrigido): compactado declarado acima de 8 MiB + folga (stored, descompactado pequeno) → foto_grande na classificação e no leitor, sem alocar o compactado', async () => {
    // Uma foto legítima nunca tem compactado > teto por foto + folga do deflate; o leitor não pode fazer Buffer.alloc(compactado).
    const teto = LIMITES_ZIP_TETO.bytesEntradaMax + FOLGA_COMPACTADO_BYTES;
    const classificar = (compactado: number) => classificarEntradaZip(entrada('A1.jpg', { metodo: 0, compactado, descompactado: 1000 }), LIMITES_ZIP_TETO);
    expect(classificar(400 * MIB)).toEqual({ acao: 'recusar', motivo: 'foto_grande' });
    expect(classificar(teto + 1)).toEqual({ acao: 'recusar', motivo: 'foto_grande' });
    expect(classificar(teto).acao).toBe('aceitar');
    // e2e no leitor real: o diretório central declara 400 MiB compactados; a leitura recusa antes de alocar
    const zip = await aberto([{ nome: 'A1.jpg', dados: JPEG, metodo: 0, compactado: 400 * MIB, descompactado: JPEG.length }]);
    const antes = process.memoryUsage().arrayBuffers;
    expect(await zip.ler(0, { tipos: TODOS })).toEqual({ ok: false, motivo: 'foto_grande', tipo_detectado: null });
    expect(process.memoryUsage().arrayBuffers - antes).toBeLessThan(teto);
    await zip.fechar();
  });
});

describe('T-0174 critério 6 — 10 mil arquivos com o teto REAL (sem baixar o limite no teste)', () => {
  const um = new Uint8Array([0xff]);
  const fotos = (q: number, prefixo = 'P'): EntradaTeste[] => Array.from({ length: q }, (_, i) => ({ nome: `${prefixo}${i}.jpg`, dados: um, metodo: 0 }));

  it('ZS-15: 10.000 fotos + 500 ignoradas (__MACOSX) abrem; 10.001 fotos → muitos_arquivos (o lote inteiro, antes de ler qualquer entrada)', async () => {
    const ok = await aberto([...fotos(10_000), ...fotos(500, '__MACOSX/._')]);
    expect(itensDaConferencia(ok.entradas, LIMITES_ZIP_TETO)).toHaveLength(10_000);
    await ok.fechar();
    expect(await abrir(fotos(10_001))).toEqual({ ok: false, motivo: 'muitos_arquivos' });
  });

  it(`ZS-16: mais de ${ENTRADAS_BRUTAS_MAX} entradas brutas, mesmo todas ignoradas, → muitos_arquivos sem classificar`, async () => {
    expect(await abrir(fotos(ENTRADAS_BRUTAS_MAX + 1, '__MACOSX/._'))).toEqual({ ok: false, motivo: 'muitos_arquivos' });
  });
});

describe('T-0174 critério 4 — tipo pela assinatura, não pela extensão', () => {
  it('ZS-11: GIF, PDF, HTML, SVG, EXE, ZIP dentro de ZIP e RIFF que não é WEBP, renomeados para .jpg/.png/.webp → tipo_nao_aceito', async () => {
    const nomes = Object.keys(DISFARCADOS);
    const zip = await aberto(nomes.map((nome) => ({ nome, dados: DISFARCADOS[nome]! })));
    for (let i = 0; i < nomes.length; i += 1) {
      expect(await zip.ler(i, { tipos: TODOS }), nomes[i]).toEqual({ ok: false, motivo: 'tipo_nao_aceito', tipo_detectado: null });
    }
    await zip.fechar();
  });

  it('ZS-12: JPEG com extensão .png e PNG com extensão .jpg são aceitos pelo que são (o tipo vem da assinatura); WEBP válido abre', async () => {
    const zip = await aberto([
      { nome: 'A1.png', dados: JPEG },
      { nome: 'A2.jpg', dados: IMAGENS_TESTE.png },
      { nome: '7891234567895.webp', dados: IMAGENS_TESTE.webpComPerda },
      { nome: 'A3.webp', dados: IMAGENS_TESTE.webpSemPerda },
    ]);
    expect(await zip.ler(0, { tipos: TODOS })).toMatchObject({ ok: true, tipo: 'image/jpeg' });
    expect(await zip.ler(1, { tipos: TODOS })).toMatchObject({ ok: true, tipo: 'image/png' });
    expect(await zip.ler(2, { tipos: TODOS })).toMatchObject({ ok: true, tipo: 'image/webp', largura: 40, altura: 30 });
    expect(await zip.ler(3, { tipos: TODOS })).toMatchObject({ ok: true, tipo: 'image/webp' });
    await zip.fechar();
  });
});

describe('T-0174 critérios 2, 3 e 4 — do ZIP ao casamento (plataforma → módulo, sem banco)', () => {
  const produtos: ProdutoParaCasar[] = [
    { id: 'p-a1', sku: 'A1', ean: null, ativo: true },
    { id: 'p-a2', sku: 'A2', ean: '7891234567895', ativo: true },
    { id: 'p-ab', sku: 'ab', ean: null, ativo: true },
    { id: 'p-AB', sku: 'AB', ean: null, ativo: true },
    { id: 'p-cx', sku: 'CX', ean: null, ativo: true },
    { id: 'p-cx12', sku: 'CX_12', ean: null, ativo: false },
  ];

  it('ZS-13: A1.jpg, A1_2.jpg, a1_3.jpg → A1 nas ordens 1-2-3; Ab.jpg ambíguo (ab, AB); EAN do A2 liga; CX_12 ambíguo; Z9 sem produto; bytes lidos são os do arquivo', async () => {
    const zip = await aberto([
      { nome: 'A1.jpg', dados: JPEG },
      { nome: 'fotos/A1_2.jpg', dados: JPEG2 },
      { nome: 'a1_3.jpg', dados: JPEG3 },
      { nome: 'Ab.jpg', dados: JPEG },
      { nome: '7891234567895.png', dados: IMAGENS_TESTE.png },
      { nome: 'CX_12.jpg', dados: JPEG },
      { nome: 'Z9.jpg', dados: JPEG },
      { nome: 'A1_2.gif.jpg', dados: DISFARCADOS['gif.jpg']! },
    ]);
    const itens = itensDaConferencia(zip.entradas, LIMITES_ZIP_TETO);
    const resolucao = itens.map((it) => {
      const nome = interpretarNome(nomeBaseDoCaminho(it.caminho));
      return nome.ok ? resolverItem(nome.interpretacoes, produtos) : null;
    });
    expect(resolucao.slice(0, 3)).toEqual([
      { situacao: 'ligar', produto: produtos[0], ordem: 1 },
      { situacao: 'ligar', produto: produtos[0], ordem: 2 },
      { situacao: 'ligar', produto: produtos[0], ordem: 3 },
    ]);
    expect(resolucao[3]).toEqual({ situacao: 'ambiguo', codigos: ['ab', 'AB'] });
    expect(resolucao[4]).toEqual({ situacao: 'ligar', produto: produtos[1], ordem: 1 });
    expect(resolucao[5]).toMatchObject({ situacao: 'ambiguo' });
    expect((resolucao[5] as { codigos: string[] }).codigos.sort()).toEqual(['CX', 'CX_12']);
    expect(resolucao[6]).toEqual({ situacao: 'sem_produto' });
    // "A1_2.gif.jpg": tira só a última extensão → código "A1_2.gif", que não casa; e o conteúdo GIF seria recusado
    expect(resolucao[7]).toEqual({ situacao: 'sem_produto' });
    expect(await zip.ler(7, { tipos: TODOS })).toMatchObject({ ok: false, motivo: 'tipo_nao_aceito' });
    // as três fotos do A1 são imagens distintas (SHA diferentes): nenhuma vira "repetido" por engano
    const shas = new Set<string>();
    for (const i of [0, 1, 2]) {
      const l = await zip.ler(i, { tipos: TODOS });
      if (!l.ok) throw new Error(l.motivo);
      shas.add(l.sha256);
    }
    expect(shas.size).toBe(3);
    await zip.fechar();
  });

  it('ZS-14: o mesmo ZIP aberto duas vezes tem o mesmo SHA-256 (chave do "mesmo ZIP não reprocessa"); um byte diferente muda o SHA', async () => {
    const e: EntradaTeste[] = [{ nome: 'A1.jpg', dados: JPEG }];
    const a = await aberto(e);
    const b = await aberto(e);
    const c = await aberto([{ nome: 'A1.jpg', dados: JPEG2 }]);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(b.sha256).toBe(a.sha256);
    expect(c.sha256).not.toBe(a.sha256);
    // a mesma foto em ZIPs diferentes tem o mesmo SHA da imagem (chave do "repetido")
    const z2 = await aberto([{ nome: 'outro/A1.jpg', dados: JPEG }, { nome: 'A9.jpg', dados: JPEG2 }]);
    const l1 = await a.ler(0, { tipos: TODOS });
    const l2 = await z2.ler(0, { tipos: TODOS });
    expect(l1.ok && l2.ok && l1.sha256 === l2.sha256).toBe(true);
    for (const z of [a, b, c, z2]) await z.fechar();
  });
});
