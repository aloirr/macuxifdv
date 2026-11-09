/**
 * T-0097 b: versão reduzida da foto no servidor (`GET /v1/arquivos/:id/miniatura`, `src/miniatura.ts`), sem banco.
 * Maior lado 320 px sem ampliar, teto de 30 KB (até com foto de ruído), orientação EXIF aplicada, gerada na 1ª leitura e
 * guardada ao lado do original, e a MESMA regra de acesso do original (foto do tenant, usuários visíveis, licença).
 */
import { BYTES_MAX_MINIATURA_ARQUIVO, caminhoMiniaturaArquivo, LADO_MINIATURA_ARQUIVO_PX, type ClienteBanco } from '@macuxi/platform-sdk';
import { decode, encode } from 'jpeg-js';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { CHAVE_ARQUIVO_RE, criarArmazenamentoEmMemoria } from '../src/arquivos';
import type { BancoApp } from '../src/banco';
import { chaveDaMiniatura, ErroMiniatura, gerarMiniatura, orientacaoExif, tamanhoReduzido } from '../src/miniatura';
import { bancoFalso, cab, LICENCAS_PADRAO, opcoesDeTeste, TENANT, usuarios } from './apoio';

const ID = '0f000000-0000-4000-8000-0000000000c1';

/** JPEG sintético: degradê (`ruido: false`) ou ruído pseudoaleatório (pior caso para o teto de bytes). */
function jpeg(largura: number, altura: number, ruido = false, qualidade = 90): Uint8Array {
  const dados = new Uint8Array(largura * altura * 4);
  let semente = 42;
  const aleatorio = () => ((semente = (semente * 1103515245 + 12345) & 0x7fffffff) % 256);
  for (let y = 0; y < altura; y += 1)
    for (let x = 0; x < largura; x += 1) {
      const i = (y * largura + x) * 4;
      dados[i] = ruido ? aleatorio() : (x * 255) / largura;
      dados[i + 1] = ruido ? aleatorio() : (y * 255) / altura;
      dados[i + 2] = ruido ? aleatorio() : 128;
      dados[i + 3] = 255;
    }
  return new Uint8Array(encode({ width: largura, height: altura, data: dados }, qualidade).data);
}

/** Insere um APP1 Exif com a tag Orientation (0x0112) logo depois do SOI. */
function comOrientacao(j: Uint8Array, orientacao: number, bigEndian = false): Uint8Array {
  const u16 = (v: number) => (bigEndian ? [v >> 8, v & 0xff] : [v & 0xff, v >> 8]);
  const u32 = (v: number) => (bigEndian ? [0, 0, 0, v] : [v, 0, 0, 0]);
  const tiff = [...(bigEndian ? [0x4d, 0x4d] : [0x49, 0x49]), ...u16(42), ...u32(8), ...u16(1), ...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientacao), 0, 0, ...u32(0)];
  const corpo = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const tam = corpo.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, tam >> 8, tam & 0xff, ...corpo, ...j.subarray(2)]);
}

const dims = (b: Uint8Array) => {
  const d = decode(b, { useTArray: true });
  return { largura: d.width, altura: d.height };
};

describe('gerarMiniatura (T-0097 b)', () => {
  it('foto do app (1600 x 1200) vira 320 x 240, JPEG decodificável e dentro de 30 KB', () => {
    const m = gerarMiniatura(jpeg(1600, 1200));
    expect({ largura: m.largura, altura: m.altura }).toEqual({ largura: 320, altura: 240 });
    expect(dims(m.bytes)).toEqual({ largura: 320, altura: 240 });
    expect(m.bytes.length).toBeLessThanOrEqual(BYTES_MAX_MINIATURA_ARQUIVO);
    expect(LADO_MINIATURA_ARQUIVO_PX).toBe(320);
  });

  it('foto em pé maior que o teto e foto pequena: nunca passa de 320 no maior lado e nunca amplia', () => {
    expect(dims(gerarMiniatura(jpeg(900, 1600)).bytes)).toEqual({ largura: 180, altura: 320 });
    expect(dims(gerarMiniatura(jpeg(200, 100)).bytes)).toEqual({ largura: 200, altura: 100 });
    expect(tamanhoReduzido(321, 1, 320)).toEqual({ largura: 320, altura: 1 });
  });

  it('pior caso (ruído puro) ainda cabe no teto de 30 KB: baixa a qualidade e, se preciso, o lado', () => {
    const m = gerarMiniatura(jpeg(1200, 1200, true));
    expect(m.bytes.length).toBeLessThanOrEqual(BYTES_MAX_MINIATURA_ARQUIVO);
    expect(Math.max(m.largura, m.altura)).toBeLessThanOrEqual(320);
  });

  it('orientação EXIF (câmera em pé, 6 e 8; little e big endian) sai aplicada: a miniatura fica em pé', () => {
    const deitada = jpeg(640, 320);
    expect(orientacaoExif(deitada)).toBe(1);
    expect(orientacaoExif(comOrientacao(deitada, 6))).toBe(6);
    expect(orientacaoExif(comOrientacao(deitada, 8, true))).toBe(8);
    expect(dims(gerarMiniatura(comOrientacao(deitada, 6)).bytes)).toEqual({ largura: 160, altura: 320 });
    expect(dims(gerarMiniatura(comOrientacao(deitada, 3)).bytes)).toEqual({ largura: 320, altura: 160 });
    // a cor do canto superior esquerdo da foto girada (6 = 90° horário) é a do canto inferior esquerdo do original
    const m = decode(gerarMiniatura(comOrientacao(deitada, 6), { bytesMax: 1024 * 1024 }).bytes, { useTArray: true });
    expect(m.data[1]).toBeGreaterThan(200); // verde = y alto no original (canto de baixo)
    expect(m.data[0]).toBeLessThan(40); // vermelho = x baixo no original
  });

  it('bytes que não são JPEG decodificável → ErroMiniatura', () => {
    expect(() => gerarMiniatura(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02, 0xff, 0xd9]))).toThrow(ErroMiniatura);
  });

  it('chave da miniatura fica no formato fechado, ao lado do original; caminho público', () => {
    const original = `${TENANT}/catalogo/2026-11/${ID}.jpg`;
    expect(chaveDaMiniatura(original)).toBe(`${TENANT}/catalogo/2026-11/${ID}.m320.jpg`);
    expect(CHAVE_ARQUIVO_RE.test(chaveDaMiniatura(original))).toBe(true);
    expect(() => chaveDaMiniatura(chaveDaMiniatura(original))).toThrow();
    expect(caminhoMiniaturaArquivo(ID.toUpperCase())).toBe(`/v1/arquivos/${ID}/miniatura`);
  });
});

describe('GET /v1/arquivos/:id/miniatura (T-0097 b)', () => {
  const CHAVE = `${TENANT}/catalogo/2026-11/${ID}.jpg`;
  const ORIGINAL = jpeg(1600, 1200);

  async function montarCom(finalidade: string, licencas = LICENCAS_PADRAO) {
    const linha = {
      modulo: 'catalogo',
      finalidade,
      enviado_por: usuarios.analista!.id,
      situacao: 'recebido',
      sha256: 'b'.repeat(64),
      tamanho_bytes: ORIGINAL.length,
      cliente_id: null,
      chave_armazenamento: CHAVE,
    };
    const cliente: ClienteBanco = {
      query: async <R>(sql: string) => (/from plataforma\.arquivo/.test(sql) ? { rows: [linha] as R[], rowCount: 1 } : { rows: [] as R[], rowCount: 0 }),
    };
    const banco: BancoApp = { ...bancoFalso().banco, comTenant: async (_t, fn) => fn(cliente), semTenant: async (fn) => fn(cliente) };
    const arquivos = criarArmazenamentoEmMemoria();
    await arquivos.gravar(CHAVE, ORIGINAL);
    const app = createApp(opcoesDeTeste(licencas, { banco, arquivos, usuariosVisiveis: async (u) => (u.perfil === 'analista' ? 'tenant' : new Set([u.id])) }));
    return { app, arquivos };
  }
  const get = (app: ReturnType<typeof createApp>, quem: 'vendedor' | 'promotor' | 'supervisor') =>
    app.inject({ method: 'GET', url: caminhoMiniaturaArquivo(ID), headers: cab(quem) });

  it('foto de produto: gera na 1ª leitura (320 px, até 30 KB), guarda ao lado do original e a 2ª leitura usa a guardada', async () => {
    const { app, arquivos } = await montarCom('foto_produto');
    const r = await get(app, 'vendedor');
    expect(r.statusCode, r.body).toBe(200);
    expect(r.headers['content-type']).toBe('image/jpeg');
    expect(r.headers.etag).toBe(`"${'b'.repeat(64)}-m320"`);
    expect(r.rawPayload.length).toBeLessThanOrEqual(BYTES_MAX_MINIATURA_ARQUIVO);
    expect(dims(new Uint8Array(r.rawPayload))).toEqual({ largura: 320, altura: 240 });
    expect(arquivos.chaves().sort()).toEqual([CHAVE, chaveDaMiniatura(CHAVE)]);
    // a 2ª leitura devolve a guardada (troca o conteúdo guardado para provar que não gera de novo)
    const marcada = jpeg(10, 10);
    await arquivos.gravar(chaveDaMiniatura(CHAVE), marcada);
    const r2 = await get(app, 'promotor');
    expect(r2.statusCode).toBe(200);
    expect(new Uint8Array(r2.rawPayload)).toEqual(marcada);
    await app.close();
  });

  it('mesma regra do original: outra finalidade sem cliente → 404 para quem não enxerga o remetente; sem licença → 403', async () => {
    const { app } = await montarCom('anexo_interno');
    const r = await get(app, 'vendedor');
    expect(r.statusCode).toBe(404);
    expect(r.json()).toMatchObject({ codigo: 'ARQUIVO_NAO_ENCONTRADO' });
    await app.close();
    const semCatalogo = await montarCom('foto_produto', { ...LICENCAS_PADRAO, perfil: { ...LICENCAS_PADRAO.perfil, vendedor: ['core', 'vendedor'] } });
    const r2 = await get(semCatalogo.app, 'vendedor');
    expect(r2.statusCode).toBe(403);
    expect(r2.json()).toMatchObject({ codigo: 'MODULO_INATIVO' });
    expect(semCatalogo.arquivos.chaves()).toEqual([CHAVE]); // nada gerado para quem não pode ler
    await semCatalogo.app.close();
  });

  it('401 sem sessão; original que não decodifica → 422 MINIATURA_INDISPONIVEL e nada guardado', async () => {
    const { app, arquivos } = await montarCom('foto_produto');
    expect((await app.inject({ method: 'GET', url: caminhoMiniaturaArquivo(ID) })).statusCode).toBe(401);
    await arquivos.gravar(CHAVE, new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02, 0xff, 0xd9]));
    const r = await get(app, 'vendedor');
    expect(r.statusCode).toBe(422);
    expect(r.json()).toMatchObject({ codigo: 'MINIATURA_INDISPONIVEL' });
    expect(arquivos.chaves()).toEqual([CHAVE]);
    await app.close();
  });
});
