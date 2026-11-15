/**
 * ADR 0054 §1 (RN-CAT-14): envio do ZIP em partes de 8 MiB — `PUT /v1/arquivos/:id/partes/:n`, `POST /v1/arquivos/:id/concluir`
 * e a URL assinada ligável (`GET .../partes/:n/url-envio`) — e o ZIP nunca servido pelo GET. Banco falso com a linha de
 * `plataforma.arquivo` em memória.
 */
import { PARTE_ENVIO_BYTES, type ClienteBanco } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { chaveDaParte, criarArmazenamentoEmMemoria, type ArmazenamentoArquivos } from '../src/arquivos';
import type { BancoApp } from '../src/banco';
import { bancoFalso, cab, LICENCAS_PADRAO, opcoesDeTeste, TENANT, usuarios } from './apoio';

const ID = '0f000000-0000-4000-8000-0000000000c7';
const P = PARTE_ENVIO_BYTES;

interface Linha {
  modulo: string;
  finalidade: string;
  enviado_por: string;
  situacao: 'aguardando' | 'recebido';
  tipo: string;
  tamanho_bytes: number | null;
  chave_armazenamento: string | null;
  sha256: string | null;
  cliente_id: string | null;
  recebido_em: string | null;
}

function montar(o: { linha?: Partial<Linha> | null; licencas?: typeof LICENCAS_PADRAO; arquivos?: ArmazenamentoArquivos; urlAssinada?: boolean } = {}) {
  const linha: Linha | null =
    o.linha === null
      ? null
      : {
          modulo: 'catalogo',
          finalidade: 'foto_lote',
          enviado_por: usuarios.analista!.id,
          situacao: 'aguardando',
          tipo: 'application/zip',
          tamanho_bytes: null,
          chave_armazenamento: null,
          sha256: null,
          cliente_id: null,
          recebido_em: null,
          ...o.linha,
        };
  const sqls: string[] = [];
  const cliente: ClienteBanco = {
    query: async <R>(sql: string, v: readonly unknown[] = []) => {
      sqls.push(sql);
      const um = (r: unknown) => ({ rows: (r ? [r] : []) as R[], rowCount: r ? 1 : 0 });
      if (!linha) return um(null);
      if (/^\s*select[\s\S]*from plataforma\.arquivo/.test(sql)) return um({ ...linha });
      if (/set chave_armazenamento = coalesce/.test(sql)) {
        linha.chave_armazenamento ??= v[1] as string;
        return um({ chave_armazenamento: linha.chave_armazenamento });
      }
      if (/set situacao = 'recebido'/.test(sql) && linha.situacao === 'aguardando') {
        linha.situacao = 'recebido';
        linha.tamanho_bytes = v[1] as number;
        linha.recebido_em = v[2] as string;
        return um({ id: ID });
      }
      return um(null);
    },
  };
  const banco: BancoApp = { ...bancoFalso().banco, comTenant: async (_t, fn) => fn(cliente), semTenant: async (fn) => fn(cliente) };
  const arquivos = o.arquivos ?? criarArmazenamentoEmMemoria();
  const app = createApp(opcoesDeTeste(o.licencas, { banco, arquivos, envioUrlAssinada: o.urlAssinada ?? false }));
  return { app, linha, arquivos, sqls };
}

const parte = (app: ReturnType<typeof createApp>, n: number | string, corpo: Buffer, quem: 'analista' | 'vendedor' = 'analista') =>
  app.inject({ method: 'PUT', url: `/v1/arquivos/${ID}/partes/${n}`, headers: { ...cab(quem), 'content-type': 'application/octet-stream' }, payload: corpo });
const concluir = (app: ReturnType<typeof createApp>, corpo: unknown, quem: 'analista' | 'vendedor' = 'analista') =>
  app.inject({ method: 'POST', url: `/v1/arquivos/${ID}/concluir`, headers: cab(quem), payload: corpo as object });

describe('PUT /v1/arquivos/:id/partes/:n (ADR 0054 §1)', () => {
  it('401 sem sessão, antes de receber o corpo', async () => {
    const { app } = montar();
    const r = await app.inject({ method: 'PUT', url: `/v1/arquivos/${ID}/partes/1`, headers: { 'content-type': 'application/octet-stream' }, payload: Buffer.alloc(10) });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it('grava a parte na chave <tenant>/catalogo/<aaaa-mm>/<id>.pNNN.zip ancorada na 1ª; reenviar a mesma parte sobrescreve', async () => {
    const { app, linha, arquivos } = montar();
    const r1 = await parte(app, 2, Buffer.alloc(100, 2));
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toEqual({ n: 2, tamanho_bytes: 100 });
    expect(linha!.chave_armazenamento).toMatch(new RegExp(`^${TENANT}/catalogo/\\d{4}-\\d{2}/${ID}\\.p001\\.zip$`));
    const chave2 = chaveDaParte(linha!.chave_armazenamento!, 2);
    expect(await arquivos.tamanho(chave2)).toBe(100);
    expect((await parte(app, 2, Buffer.alloc(50, 3))).statusCode).toBe(200);
    expect(await arquivos.tamanho(chave2)).toBe(50);
    await app.close();
  });

  it('400 PARTE_INVALIDA: n fora de 1..63 ou corpo vazio; 413 acima de 8 MiB', async () => {
    const { app } = montar();
    for (const n of [0, 64, 'x', -1]) expect((await parte(app, n, Buffer.alloc(10))).json(), String(n)).toMatchObject({ codigo: 'PARTE_INVALIDA' });
    expect((await parte(app, 1, Buffer.alloc(0))).json()).toMatchObject({ codigo: 'PARTE_INVALIDA' });
    const grande = await parte(app, 1, Buffer.alloc(P + 1));
    expect(grande.statusCode).toBe(413);
    await app.close();
  });

  it('de outro usuário ou sem linha → 409 ARQUIVO_SEM_REFERENCIA; foto JPEG (não é ZIP) → 409; já recebido → 409 ENVIO_INCOMPLETO não, 409 ARQUIVO_DIVERGENTE', async () => {
    expect((await parte(montar().app, 1, Buffer.alloc(10), 'vendedor')).json()).toMatchObject({ codigo: 'ARQUIVO_SEM_REFERENCIA' });
    expect((await parte(montar({ linha: null }).app, 1, Buffer.alloc(10))).json()).toMatchObject({ codigo: 'ARQUIVO_SEM_REFERENCIA' });
    expect((await parte(montar({ linha: { tipo: 'image/jpeg' } }).app, 1, Buffer.alloc(10))).json()).toMatchObject({ codigo: 'ARQUIVO_SEM_REFERENCIA' });
    const recebido = await parte(montar({ linha: { situacao: 'recebido' } }).app, 1, Buffer.alloc(10));
    expect(recebido.statusCode).toBe(409);
    expect(recebido.json()).toMatchObject({ codigo: 'ARQUIVO_DIVERGENTE' });
  });

  it('licença do módulo da linha: Catálogo inativo para o usuário → 403 MODULO_INATIVO', async () => {
    const { app } = montar({ licencas: { ...LICENCAS_PADRAO, perfil: { ...LICENCAS_PADRAO.perfil, analista: ['core', 'vendedor'] } } });
    const r = await parte(app, 1, Buffer.alloc(10));
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ codigo: 'MODULO_INATIVO' });
    await app.close();
  });
});

describe('POST /v1/arquivos/:id/concluir (ADR 0054 §1)', () => {
  it('confere as partes (1..n−1 com 8 MiB, a última até 8 MiB, soma = total) e marca recebido; repetir → 200', async () => {
    const { app, linha } = montar();
    expect((await parte(app, 1, Buffer.alloc(P, 1))).statusCode).toBe(200);
    expect((await parte(app, 2, Buffer.alloc(7, 2))).statusCode).toBe(200);
    const r = await concluir(app, { partes: 2, tamanho_bytes: P + 7 });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ id: ID, tipo: 'application/zip', situacao: 'recebido', tamanho_bytes: P + 7 });
    expect(linha!.situacao).toBe('recebido');
    expect((await concluir(app, { partes: 2, tamanho_bytes: P + 7 })).statusCode).toBe(200);
    // já recebido com outro tamanho = divergente
    expect((await concluir(app, { partes: 2, tamanho_bytes: P + 8 })).json()).toMatchObject({ codigo: 'ARQUIVO_DIVERGENTE' });
    await app.close();
  });

  it('409 ENVIO_INCOMPLETO com as partes a reenviar; nada é marcado', async () => {
    const { app, linha } = montar();
    await parte(app, 1, Buffer.alloc(P - 1, 1));
    await parte(app, 3, Buffer.alloc(5, 3));
    const r = await concluir(app, { partes: 3, tamanho_bytes: 2 * P + 5 });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ codigo: 'ENVIO_INCOMPLETO', detalhes: { partes_faltando: [1, 2] } });
    expect(linha!.situacao).toBe('aguardando');
    // sem nenhuma parte enviada: todas faltando
    const vazio = await concluir(montar().app, { partes: 2, tamanho_bytes: P + 1 });
    expect(vazio.json()).toMatchObject({ codigo: 'ENVIO_INCOMPLETO', detalhes: { partes_faltando: [1, 2] } });
  });

  it('acima do teto da categoria (catalogo/foto_lote = 500 MiB) → 413 com o código da RN-CAT-14, antes de olhar as partes', async () => {
    const { app } = montar();
    const r = await concluir(app, { partes: 63, tamanho_bytes: 500 * 1024 * 1024 + 1 });
    expect(r.statusCode).toBe(413);
    expect(r.json()).toMatchObject({ codigo: 'RN-CAT-14' });
    await app.close();
  });

  it('400 com corpo inválido; partes incoerentes com o tamanho → 400', async () => {
    const { app } = montar();
    expect((await concluir(app, { partes: 0, tamanho_bytes: 1 })).statusCode).toBe(400);
    expect((await concluir(app, { partes: 2, tamanho_bytes: 10 })).statusCode).toBe(400);
    await app.close();
  });
});

describe('URL assinada de envio (ligável, desligada por padrão)', () => {
  it('desligada → 404 URL_ASSINADA_DESLIGADA; ligada com armazenamento sem urlEnvio (disco) → 404 também', async () => {
    const r = await montar().app.inject({ method: 'GET', url: `/v1/arquivos/${ID}/partes/1/url-envio`, headers: cab('analista') });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toMatchObject({ codigo: 'URL_ASSINADA_DESLIGADA' });
    const r2 = await montar({ urlAssinada: true }).app.inject({ method: 'GET', url: `/v1/arquivos/${ID}/partes/1/url-envio`, headers: cab('analista') });
    expect(r2.json()).toMatchObject({ codigo: 'URL_ASSINADA_DESLIGADA' });
  });

  it('ligada com S3: PUT pré-assinado da chave da parte, 15 min; mesmas regras de dono e situação', async () => {
    const base = criarArmazenamentoEmMemoria();
    const arquivos: ArmazenamentoArquivos = { ...base, urlEnvio: (chave, validadeS) => ({ url: `https://s3.exemplo/${chave}?X-Amz-Expires=${validadeS}`, expiraEm: new Date('2026-11-15T12:15:00Z') }) };
    const { app, linha } = montar({ urlAssinada: true, arquivos });
    const r = await app.inject({ method: 'GET', url: `/v1/arquivos/${ID}/partes/3/url-envio`, headers: cab('analista') });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ url: `https://s3.exemplo/${chaveDaParte(linha!.chave_armazenamento!, 3)}?X-Amz-Expires=900`, metodo: 'PUT', expira_em: '2026-11-15T12:15:00.000Z' });
    const outro = await app.inject({ method: 'GET', url: `/v1/arquivos/${ID}/partes/3/url-envio`, headers: cab('vendedor') });
    expect(outro.statusCode).toBe(409);
    await app.close();
  });
});

describe('GET de ZIP (ADR 0054 §1): nunca é servido', () => {
  it('original e miniatura → 404', async () => {
    const { app } = montar({ linha: { situacao: 'recebido', sha256: null, tamanho_bytes: 10, chave_armazenamento: `${TENANT}/catalogo/2026-11/${ID}.p001.zip` } });
    for (const url of [`/v1/arquivos/${ID}`, `/v1/arquivos/${ID}/miniatura`]) {
      const r = await app.inject({ method: 'GET', url, headers: cab('analista') });
      expect(r.statusCode, url).toBe(404);
    }
    await app.close();
  });
});
