/**
 * Trabalhos sob demanda (ADR 0054 §2): disparo pelo evento da outbox (consumidor da plataforma que grava em
 * `plataforma.trabalho`), laço do worker em fatias (continua/concluido), erro com espera e `aoFalhar` na última tentativa,
 * licença do módulo no tenant (adiar sem contar tentativa), transação curta com autor de sistema e os arquivos do trabalho
 * (ZIP juntado no temporário, foto guardada com miniatura, descarte das partes). Sem banco: pools falsos.
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  definirEvento,
  definirModuloApi,
  definirTrabalho,
  LIMITES_ZIP_TETO,
  PARTE_ENVIO_BYTES,
  TENTATIVAS_TRABALHO_MAX,
  type ClienteBanco,
  type ContextoTrabalho,
  type ModuloApi,
  type ResultadoFatia,
} from '@macuxi/platform-sdk';
import { manifest as catalogo } from '@macuxi/catalogo/manifest';
import { encode } from 'jpeg-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { chaveDaParte, chaveDaParte1, criarArmazenamentoEmMemoria } from '../src/arquivos';
import { nomesConsumidos } from '../src/despachante';
import { codigoDoErro, consumidoresDosTrabalhos, criarLacoTrabalhos, ESPERA_SEM_LICENCA_S, esperaTrabalhoS } from '../src/trabalhos';
import { MODULOS_API } from '../src/modulos';
import { IMAGENS_TESTE } from './imagens-teste';
import { montarZip } from './zip-teste';

const TENANT = '0a000000-0000-4000-8000-000000000001';
const LOTE = '0e000000-0000-4000-8000-0000000000a1';
const ZIP_ID = '0e000000-0000-4000-8000-0000000000a2';
const FOTO_ID = '0e000000-0000-4000-8000-0000000000a3';
const ANALISTA = '0b000000-0000-4000-8000-000000000004';
const TRABALHO_ID = '0e000000-0000-4000-8000-0000000000f1';
const EV = definirEvento('catalogo.foto_lote.enfileirado@1', z.object({ lote_id: z.string().uuid() }).strict());

/** Catálogo com o evento do lote no manifesto e um trabalho programável pelo teste. */
function moduloComTrabalho(fatia: (alvo: string, ctx: ContextoTrabalho) => Promise<ResultadoFatia>, aoFalhar = async (_a: string, _c: ContextoTrabalho, _e: { codigo: string }) => undefined): ModuloApi {
  const manifesto = { ...catalogo, publica: [...catalogo.publica, EV.nome], consome: [...catalogo.consome, EV.nome] };
  return definirModuloApi({
    manifesto,
    trabalhos: [definirTrabalho({ nome: 'processar_foto_lote', disparadoPor: EV, alvo: (p) => p.lote_id, executarFatia: fatia, aoFalhar })],
  });
}
const modulos = (m: ModuloApi) => MODULOS_API.map((x) => (x.manifesto.id === 'catalogo' ? m : x));

interface Chamada {
  sql: string;
  v: readonly unknown[];
}

/** Pool do worker: devolve `reservas` em ordem e registra devolver/renovar. */
function workerFalso(reservas: Record<string, unknown>[]) {
  const chamadas: Chamada[] = [];
  return {
    chamadas,
    devolucoes: () => chamadas.filter((c) => c.sql.includes('trabalho_devolver')).map((c) => c.v.slice(2)),
    worker: {
      query: async (sql: string, v: readonly unknown[] = []) => {
        chamadas.push({ sql, v });
        if (sql.includes('trabalho_reservar')) {
          const r = reservas.shift();
          return { rows: r ? [r] : [], rowCount: r ? 1 : 0 };
        }
        return { rows: [{ ok: true }], rowCount: 1 };
      },
    } as never,
  };
}

/** Banco `macuxi_app` falso: guarda o SQL de cada transação e responde a linha do ZIP. */
function appFalso(linhaZip: Record<string, unknown> | null = null) {
  const transacoes: Chamada[][] = [];
  return {
    transacoes,
    app: {
      comTenant: async <T,>(tenant: string, fn: (db: ClienteBanco) => Promise<T>) => {
        expect(tenant).toBe(TENANT);
        const t: Chamada[] = [];
        transacoes.push(t);
        const db: ClienteBanco = {
          query: async <R,>(sql: string, v: readonly unknown[] = []) => {
            t.push({ sql, v });
            if (/from plataforma\.arquivo/.test(sql) && linhaZip) return { rows: [linhaZip] as R[], rowCount: 1 };
            return { rows: [] as R[], rowCount: /^\s*insert/.test(sql) ? 1 : 0 };
          },
        };
        return fn(db);
      },
      semTenant: async () => {
        throw new Error('não usado');
      },
    },
  };
}

const reserva = (o: Partial<{ tentativas: number; fatias: number }> = {}) => ({
  id: TRABALHO_ID,
  tenant_id: TENANT,
  modulo: 'catalogo',
  nome: 'processar_foto_lote',
  alvo_id: LOTE,
  tentativas: 0,
  fatias: 0,
  ...o,
});
const licencas = (ativos = ['core', 'catalogo']) => async () => ({ ativosNoTenant: ativos as never, parametros: { catalogo: { foto_lote_zip_max: 1 } }, fuso: 'America/Manaus' });

let dirTemp: string;
beforeAll(async () => {
  dirTemp = await mkdtemp(join(tmpdir(), 'macuxi-trab-'));
});
afterAll(async () => {
  await rm(dirTemp, { recursive: true, force: true });
});

describe('disparo pela outbox (consumidor da plataforma)', () => {
  it('o evento do trabalho é consumido pelo módulo e grava um pedido único por (tenant, módulo, nome, alvo)', async () => {
    const m = moduloComTrabalho(async () => 'concluido');
    expect(nomesConsumidos(modulos(m))).toContain(EV.nome);
    const [c] = consumidoresDosTrabalhos(m);
    const sqls: Chamada[] = [];
    await c!.executar({ lote_id: LOTE.toUpperCase() }, {
      envelope: { evento_id: 'e1', tenant_id: TENANT } as never,
      db: { query: async (sql: string, v: readonly unknown[] = []) => (sqls.push({ sql, v }), { rows: [], rowCount: 1 }) },
    } as never);
    expect(sqls[0]!.sql).toMatch(/insert into plataforma\.trabalho[\s\S]*on conflict \(tenant_id, modulo, nome, alvo_id\) where deleted_at is null do nothing/);
    expect(sqls[0]!.v.slice(1)).toEqual([TENANT, 'catalogo', 'processar_foto_lote', LOTE, 'e1']);
  });

  it('alvo que não é UUID = erro de programação (o evento volta com espera)', async () => {
    const m = definirModuloApi({
      manifesto: { ...catalogo, publica: [...catalogo.publica, EV.nome], consome: [...catalogo.consome, EV.nome] },
      trabalhos: [definirTrabalho({ nome: 'x', disparadoPor: EV, alvo: () => 'nao-uuid', executarFatia: async () => 'concluido', aoFalhar: async () => undefined })],
    });
    const [c] = consumidoresDosTrabalhos(m);
    await expect(c!.executar({ lote_id: LOTE }, { envelope: { tenant_id: TENANT }, db: { query: async () => ({ rows: [], rowCount: 0 }) } } as never)).rejects.toThrow(/alvo precisa ser UUID/);
  });
});

describe('laço do worker (fatias, erro, licença)', () => {
  it('nada reservado → vazio; fatia continua/concluido devolve o resultado; o ctx traz tenant, alvo, fatia, parâmetros e fuso', async () => {
    const vistos: ContextoTrabalho[] = [];
    const resultados: ResultadoFatia[] = ['continua', 'concluido'];
    const w = workerFalso([reserva(), reserva({ fatias: 1 })]);
    const laco = criarLacoTrabalhos({
      worker: w.worker,
      app: appFalso().app,
      modulos: modulos(moduloComTrabalho(async (_a, ctx) => (vistos.push(ctx), resultados.shift()!))),
      armazenamento: null,
      licencasNoTenant: licencas(),
      dirTemp,
    });
    expect(await laco.ciclo()).toBe('continua');
    expect(await laco.ciclo()).toBe('concluido');
    expect(await laco.ciclo()).toBe('vazio');
    expect(vistos.map((c) => [c.tenantId, c.alvoId, c.fatia, c.tentativa])).toEqual([[TENANT, LOTE, 0, 0], [TENANT, LOTE, 1, 0]]);
    expect(vistos[0]!.parametros()).toEqual({ foto_lote_zip_max: 1 });
    expect(vistos[0]!.fuso()).toBe('America/Manaus');
    expect(w.devolucoes()).toEqual([['continua', null, null], ['concluido', null, null]]);
    expect(w.chamadas[0]!.v).toEqual([laco.processo, 120]);
  });

  it('exceção: tentativa + 1 com espera crescente e só o código; na última, aoFalhar e o trabalho para (espera nula)', async () => {
    const falhas: { codigo: string }[] = [];
    const w = workerFalso([reserva({ tentativas: 0 }), reserva({ tentativas: TENTATIVAS_TRABALHO_MAX - 1 })]);
    const laco = criarLacoTrabalhos({
      worker: w.worker,
      app: appFalso().app,
      modulos: modulos(
        moduloComTrabalho(
          async () => {
            throw new TypeError('detalhe com dado que não pode ir ao banco: A1.jpg');
          },
          async (_a, _c, e) => void falhas.push(e),
        ),
      ),
      armazenamento: null,
      licencasNoTenant: licencas(),
      dirTemp,
    });
    expect(await laco.ciclo()).toBe('erro');
    expect(await laco.ciclo()).toBe('erro');
    expect(w.devolucoes()).toEqual([['erro', 'TypeError', esperaTrabalhoS(1)], ['erro', 'TypeError', null]]);
    expect(falhas).toEqual([{ codigo: 'TypeError' }]);
    expect(esperaTrabalhoS(1)).toBe(30);
    expect(esperaTrabalhoS(3)).toBe(120);
    expect(codigoDoErro(new Error('x'))).toBe('Error');
  });

  it('aoFalhar que lança: volta com espera (tenta marcar a falha de novo na próxima reserva, sem rodar fatia)', async () => {
    let fatias = 0;
    const w = workerFalso([reserva({ tentativas: TENTATIVAS_TRABALHO_MAX })]);
    const laco = criarLacoTrabalhos({
      worker: w.worker,
      app: appFalso().app,
      modulos: modulos(
        moduloComTrabalho(
          async () => (fatias++, 'concluido'),
          async () => {
            throw new RangeError('banco fora');
          },
        ),
      ),
      armazenamento: null,
      licencasNoTenant: licencas(),
      dirTemp,
    });
    expect(await laco.ciclo()).toBe('erro');
    expect(fatias).toBe(0);
    expect(w.devolucoes()).toEqual([['erro', 'RangeError', esperaTrabalhoS(TENTATIVAS_TRABALHO_MAX + 1)]]);
  });

  it('Catálogo sem licença no tenant: adiar 15 min sem rodar a fatia nem contar tentativa (RN-CORE-02)', async () => {
    let rodou = false;
    const w = workerFalso([reserva()]);
    const laco = criarLacoTrabalhos({
      worker: w.worker,
      app: appFalso().app,
      modulos: modulos(moduloComTrabalho(async () => ((rodou = true), 'concluido'))),
      armazenamento: null,
      licencasNoTenant: licencas(['core']),
      dirTemp,
    });
    expect(await laco.ciclo()).toBe('adiar');
    expect(rodou).toBe(false);
    expect(w.devolucoes()).toEqual([['adiar', null, ESPERA_SEM_LICENCA_S]]);
  });

  it('deveParar quando vence o prazo da fatia; emTransacao abre uma transação do tenant com autor de sistema e publica na outbox', async () => {
    const a = appFalso();
    const laco = criarLacoTrabalhos({
      worker: workerFalso([reserva()]).worker,
      app: a.app,
      modulos: modulos(
        moduloComTrabalho(async (_alvo, ctx) => {
          expect(ctx.deveParar()).toBe(true);
          await ctx.emTransacao((t) => t.publicar(EV, { lote_id: LOTE }));
          await ctx.emTransacao((t) =>
            t.registrarArquivo({ id: FOTO_ID, finalidade: 'foto_produto', entidade: 'produto', entidade_id: LOTE, enviado_por: ANALISTA }),
          );
          return 'continua';
        }),
      ),
      armazenamento: null,
      licencasNoTenant: licencas(),
      dirTemp,
      prazoFatiaMs: 0,
    });
    expect(await laco.ciclo()).toBe('continua');
    expect(a.transacoes).toHaveLength(2);
    const evento = a.transacoes[0]![0]!;
    expect(evento.sql).toMatch(/insert into plataforma\.evento/);
    expect(evento.v[7]).toBeNull(); // usuario_id: sistema
    const arquivo = a.transacoes[1]![0]!;
    expect(arquivo.v.slice(0, 3)).toEqual([FOTO_ID, TENANT, 'catalogo']);
    expect(arquivo.v[7]).toBe(ANALISTA);
    expect(arquivo.v[10]).toBe('aguardando');
  });
});

describe('arquivos do trabalho', () => {
  const JPEG = new Uint8Array(encode({ width: 16, height: 12, data: Buffer.alloc(16 * 12 * 4, 90) }, 80).data);

  async function preparar(zip: Buffer) {
    const arm = criarArmazenamentoEmMemoria();
    const chave1 = chaveDaParte1({ tenant_id: TENANT, modulo: 'catalogo', id: ZIP_ID }, new Date('2026-11-15T12:00:00Z'));
    for (let n = 1; n * PARTE_ENVIO_BYTES < zip.length + PARTE_ENVIO_BYTES; n += 1)
      await arm.gravar(chaveDaParte(chave1, n), new Uint8Array(zip.subarray((n - 1) * PARTE_ENVIO_BYTES, n * PARTE_ENVIO_BYTES)));
    const a = appFalso({ tipo: 'application/zip', situacao: 'recebido', tamanho_bytes: String(zip.length), chave_armazenamento: chave1 });
    return { arm, a, chave1 };
  }

  it('abrirZip junta as partes (com o SHA), lê a entrada; guardarImagem grava original + miniatura e registra recebido; descartar apaga as partes e o temporário', async () => {
    const zip = montarZip([{ nome: 'A1.png', dados: IMAGENS_TESTE.png }, { nome: 'A1_2.jpg', dados: JPEG }]);
    const { arm, a, chave1 } = await preparar(zip);
    const dir = await mkdtemp(join(dirTemp, 'z-'));
    const laco = criarLacoTrabalhos({
      worker: workerFalso([reserva()]).worker,
      app: a.app,
      modulos: modulos(
        moduloComTrabalho(async (_alvo, ctx) => {
          const r = await ctx.arquivos.abrirZip(ZIP_ID, LIMITES_ZIP_TETO);
          if (!r.ok) throw new Error(r.motivo);
          expect(r.zip.entradas.map((e) => e.caminho)).toEqual(['A1.png', 'A1_2.jpg']);
          const png = await r.zip.ler(0, { tipos: ['image/jpeg', 'image/png', 'image/webp'] });
          if (!png.ok) throw new Error(png.motivo);
          await r.zip.fechar();
          const g = await ctx.arquivos.guardarImagem({ id: FOTO_ID, bytes: png.bytes, tipo: png.tipo });
          if (!g.ok) throw new Error(g.motivo);
          expect(g.recebido).toMatchObject({ tipo: 'image/png', largura_px: 40, altura_px: 30, sha256: png.sha256 });
          expect(g.recebido.chave).toMatch(new RegExp(`^${TENANT}/catalogo/\\d{4}-\\d{2}/${FOTO_ID}\\.png$`));
          await ctx.emTransacao((t) =>
            t.registrarArquivo({ id: FOTO_ID, finalidade: 'foto_produto', entidade: 'produto', entidade_id: LOTE, enviado_por: ANALISTA, recebido: g.recebido }),
          );
          // recebido com a chave de outro arquivo = erro de programação
          await expect(
            ctx.emTransacao((t) =>
              t.registrarArquivo({ id: LOTE, finalidade: 'foto_produto', entidade: 'produto', entidade_id: LOTE, enviado_por: ANALISTA, recebido: g.recebido }),
            ),
          ).rejects.toThrow(/chave não é do arquivo/);
          await ctx.arquivos.descartar(ZIP_ID);
          return 'concluido';
        }),
      ),
      armazenamento: arm,
      licencasNoTenant: licencas(),
      dirTemp: dir,
    });
    expect(await laco.ciclo()).toBe('concluido');
    const chaves = arm.chaves();
    expect(chaves.some((c) => c.endsWith(`${FOTO_ID}.png`))).toBe(true);
    expect(chaves.some((c) => c.endsWith(`${FOTO_ID}.m320.jpg`))).toBe(true);
    expect(chaves.filter((c) => c.endsWith('.zip'))).toEqual([]);
    expect(chaves).not.toContain(chave1);
    const registro = a.transacoes.flat().find((c) => /insert into plataforma\.arquivo/.test(c.sql))!;
    expect(registro.v[10]).toBe('recebido');
    expect(registro.v[8]).toBe('image/png');
    expect(a.transacoes.flat().some((c) => /set deleted_at = now\(\)/.test(c.sql))).toBe(true);
    const sobra = await readdir(join(dir, 'macuxi-trabalhos'), { recursive: true });
    expect(sobra.filter((n) => String(n).endsWith('.zip'))).toEqual([]);
  });

  it('parte faltando → zip_incompleto; limites do módulo acima do teto não sobem o teto; foto que não decodifica → foto_ilegivel', async () => {
    const zip = montarZip([{ nome: 'A1.jpg', dados: JPEG }]);
    const { arm, a, chave1 } = await preparar(zip);
    const laco = (fatia: (alvo: string, ctx: ContextoTrabalho) => Promise<ResultadoFatia>) =>
      criarLacoTrabalhos({ worker: workerFalso([reserva()]).worker, app: a.app, modulos: modulos(moduloComTrabalho(fatia)), armazenamento: arm, licencasNoTenant: licencas(), dirTemp });
    expect(
      await laco(async (_a, ctx) => {
        const r = await ctx.arquivos.abrirZip(ZIP_ID, { ...LIMITES_ZIP_TETO, bytesZipMax: 10 * LIMITES_ZIP_TETO.bytesZipMax, bytesEntradaMax: 10 });
        if (!r.ok) throw new Error(r.motivo);
        // o teto por foto do módulo (10 bytes) vale; o do ZIP não passa do da plataforma
        expect(await r.zip.ler(0, { tipos: ['image/jpeg'] })).toMatchObject({ ok: false, motivo: 'foto_grande' });
        await r.zip.fechar();
        const g = await ctx.arquivos.guardarImagem({ id: FOTO_ID, bytes: IMAGENS_TESTE.png.subarray(0, 30), tipo: 'image/png' });
        expect(g).toEqual({ ok: false, motivo: 'foto_ilegivel' });
        return 'concluido';
      }).ciclo(),
    ).toBe('concluido');
    await arm.remover(chave1);
    expect(
      await laco(async (_a, ctx) => {
        await ctx.arquivos.descartar(ZIP_ID); // limpa o temporário do processo anterior
        expect(await ctx.arquivos.abrirZip(ZIP_ID, LIMITES_ZIP_TETO)).toEqual({ ok: false, motivo: 'zip_incompleto' });
        return 'concluido';
      }).ciclo(),
    ).toBe('concluido');
  });
});
