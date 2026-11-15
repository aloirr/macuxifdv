/**
 * ADR 0054 §4 (desenho `docs/desenho/T-catalogo-pacote.md` §1.6 e §4 item 4): manifesto `GET /v1/sync/pacotes` e a rota de
 * arquivo do driver `disco`, sem banco (fonte em memória que imita a RLS: só o tenant da sessão).
 * Segurança: pacote de outro tenant = 404; promotor sem preço não recebe a partição `filial` (RN-CAT-05); filial fora da
 * carteira não é oferecida (RN-CORE-39); módulo sem licença não aparece (RN-CORE-02); link vencido renova.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { manifest as catalogo } from '@macuxi/catalogo/manifest';
import {
  codificarCursor,
  definirEntidadeSync,
  definirModuloApi,
  MAX_PARTICOES_PACOTE,
  PacotesSyncRespostaSchema,
  particaoDeFilial,
  UUID_NIL,
  type ContextoBase,
  type LinhaSync,
} from '@macuxi/platform-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../src/app';
import { syncPacotesLigados, lerConfigSyncPacotes } from '../src/config';
import {
  chaveDoPacoteSync,
  criarArmazenamentoPacotesSyncEmDisco,
  lerFaixa,
  syncPacotesDoAmbiente,
  type ArmazenamentoPacotesSync,
  type FontePacotesSync,
  type LinhaPacoteSync,
  type OpcoesSyncPacotes,
} from '../src/sync-pacotes';
import { bancoFalso, cab, LICENCAS_PADRAO, modulosDeTeste, opcoesDeTeste, TENANT, type Licencas } from './apoio';

const AGORA = new Date('2026-11-15T12:00:00.000Z');
const OUTRO_TENANT = '0a000000-0000-4000-8000-000000000002';
const GERACAO = '0e000000-0000-4000-8000-0000000000aa';
const F1 = '0f000000-0000-4000-8000-000000000001';
const F2 = '0f000000-0000-4000-8000-000000000002';
const HORIZONTE = new Date('2026-11-15T10:00:00.000Z');
const id = (n: number) => `0d000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;

const sinonimo = definirEntidadeSync({ nome: 'sinonimo', modulo: 'catalogo', direcao: 'pull', conflito: 'servidor_vence', schema: z.object({}) });
const precoItem = definirEntidadeSync({ nome: 'tabela_preco_item', modulo: 'catalogo', direcao: 'pull', conflito: 'servidor_vence', schema: z.object({}) });

/** Filiais da carteira por perfil (vendedor: F1; supervisor: F1 e F2; analista: "todas"). */
const FILIAIS: Record<string, readonly string[] | null> = { vendedor: [F1], supervisor: [F1, F2], analista: null, promotor: [F1] };

const catalogoApi = definirModuloApi({
  manifesto: catalogo,
  sync: [
    {
      entidade: sinonimo,
      escopo: 'tenant',
      // T-0121 N3: a versão do usuário depende de uma regra (aqui, o perfil); o manifesto devolve a MESMA do pull
      variacaoEscopo: (ctx) => `perfil=${ctx.usuario.perfil}`,
      puxar: async (): Promise<LinhaSync[]> => [{ id: id(90), updated_at: '2026-11-15T09:00:00.000Z', deleted_at: null }],
      pacote: { particao: 'tenant', puxar: async () => [] },
    },
    {
      entidade: precoItem,
      escopo: 'tenant',
      puxar: async () => [],
      // RN-CAT-05: promotor sem preço não recebe o arquivo de preço
      pacote: { particao: 'filial', permitido: (ctx) => ctx.usuario.perfil !== 'promotor', puxar: async () => [] },
    },
  ],
  particoesPacote: {
    filiaisDoUsuario: async (ctx: ContextoBase) => FILIAIS[ctx.usuario.perfil] ?? null,
    filiaisDoTenant: async () => [F1, F2],
  },
});

function linha(p: Partial<LinhaPacoteSync> & Pick<LinhaPacoteSync, 'id' | 'particao'>): LinhaPacoteSync {
  const tenant_id = p.tenant_id ?? TENANT;
  const modulo = p.modulo ?? 'catalogo';
  return {
    tenant_id,
    modulo,
    formato: 1,
    situacao: 'pronto',
    horizonte: HORIZONTE,
    geracao_base: GERACAO,
    chave_armazenamento: chaveDoPacoteSync({ tenant_id, modulo, particao: p.particao, id: p.id }),
    bytes: 10,
    md5: 'a'.repeat(32),
    entidades: p.particao === 'tenant' ? { sinonimo: 3 } : { tabela_preco_item: 5 },
    ...p,
  };
}

const PACOTE_TENANT = id(1);
const PACOTE_F1 = id(2);
const PACOTE_F2 = id(3);
const PACOTE_OUTRO = id(4);

function fonteEmMemoria(linhas: LinhaPacoteSync[]) {
  const pedidos: { tenant: string; modulo: string; particao: string }[] = [];
  const fonte: FontePacotesSync = {
    // RLS: só o tenant da sessão
    prontos: async (ctx, modulos) =>
      linhas.filter((l) => l.tenant_id === ctx.usuario.tenant_id && l.situacao === 'pronto' && modulos.includes(l.modulo)),
    porId: async (ctx, i) => linhas.find((l) => l.id === i && l.tenant_id === ctx.usuario.tenant_id) ?? null,
    pedir: async (ctx, ps) => void pedidos.push(...ps.map((x) => ({ tenant: ctx.usuario.tenant_id, ...x }))),
  };
  return { fonte, pedidos };
}

/** Armazenamento de "S3": link com validade pelo relógio do teste (o segredo da URL nunca é conferido aqui). */
function s3Falso(relogio: () => Date): ArmazenamentoPacotesSync {
  return {
    driver: 's3',
    gravar: async () => undefined,
    remover: async () => undefined,
    link: (chave, validadeS) => ({ url: `https://s3.exemplo/${chave}?X-Amz-Signature=segredo`, expiraEm: new Date(relogio().getTime() + validadeS * 1000) }),
    caminhoLocal: () => null,
  };
}

const LINHAS_PADRAO = (): LinhaPacoteSync[] => [
  linha({ id: PACOTE_TENANT, particao: 'tenant' }),
  linha({ id: PACOTE_F1, particao: particaoDeFilial(F1) }),
  linha({ id: PACOTE_F2, particao: particaoDeFilial(F2) }),
  linha({ id: PACOTE_OUTRO, particao: particaoDeFilial(F1), tenant_id: OUTRO_TENANT }),
];

function montar(o: { linhas?: LinhaPacoteSync[]; licencas?: Licencas; sync?: Partial<OpcoesSyncPacotes> | null; relogio?: () => Date } = {}) {
  const relogio = o.relogio ?? (() => AGORA);
  const { fonte, pedidos } = fonteEmMemoria(o.linhas ?? LINHAS_PADRAO());
  const { banco } = bancoFalso(() => new Date(relogio().getTime() - 2000));
  banco.geracaoBase = async () => GERACAO;
  const syncPacotes = o.sync === null ? null : { armazenamento: s3Falso(relogio), validadeS: 900, fonte, ...o.sync };
  const app = createApp({
    ...opcoesDeTeste(o.licencas ?? LICENCAS_PADRAO, { banco, relogio }),
    modulos: modulosDeTeste({ catalogo: catalogoApi }),
    syncPacotes,
  });
  return { app, pedidos };
}

const manifesto = async (app: ReturnType<typeof createApp>, quem: Parameters<typeof cab>[0]) => {
  const r = await app.inject({ method: 'GET', url: '/v1/sync/pacotes', headers: cab(quem) });
  expect(r.statusCode).toBe(200);
  return PacotesSyncRespostaSchema.parse(r.json());
};

describe('configuração (MACUXI_SYNC_PACOTES)', () => {
  it('desligado por padrão: só 1/true/sim liga', () => {
    expect(syncPacotesLigados({})).toBe(false);
    expect(syncPacotesLigados({ MACUXI_SYNC_PACOTES: '0' })).toBe(false);
    expect(syncPacotesLigados({ MACUXI_SYNC_PACOTES: 'talvez' })).toBe(false);
    expect(syncPacotesLigados({ MACUXI_SYNC_PACOTES: 'sim' })).toBe(true);
    expect(syncPacotesDoAmbiente({})).toBeNull();
  });

  it('validade e intervalo: padrão 900 s e 60 s; fora da faixa = erro com o nome da variável', () => {
    expect(lerConfigSyncPacotes({})).toEqual({ validadeS: 900, intervaloMs: 60_000, dirTemp: null });
    expect(() => lerConfigSyncPacotes({ MACUXI_SYNC_PACOTES_VALIDADE_S: '30' })).toThrow(/MACUXI_SYNC_PACOTES_VALIDADE_S/);
    expect(() => lerConfigSyncPacotes({ MACUXI_SYNC_PACOTES_INTERVALO_MS: 'x' })).toThrow(/MACUXI_SYNC_PACOTES_INTERVALO_MS/);
    expect(() => syncPacotesDoAmbiente({ MACUXI_SYNC_PACOTES: '1', MACUXI_ARQUIVOS_DRIVER: 's3' })).toThrow(/MACUXI_S3_ENDPOINT/);
    expect(syncPacotesDoAmbiente({ MACUXI_SYNC_PACOTES: '1', MACUXI_ARQUIVOS_DIR: '/tmp/x' })?.armazenamento.driver).toBe('disco');
  });
});

describe('GET /v1/sync/pacotes', () => {
  it('desligado: lista vazia (o aparelho segue no pull) e nenhum pedido; sem sessão = 401', async () => {
    const { app } = montar({ sync: null });
    expect(await manifesto(app, 'vendedor')).toEqual({ pacotes: [] });
    expect((await app.inject({ method: 'GET', url: '/v1/sync/pacotes' })).statusCode).toBe(401);
    // padrão do createApp sem a opção: pelo ambiente, e o ambiente dos testes não liga
    const padrao = createApp(opcoesDeTeste());
    expect((await padrao.inject({ method: 'GET', url: '/v1/sync/pacotes', headers: cab('vendedor') })).json()).toEqual({ pacotes: [] });
  });

  it('vendedor: partição tenant + a filial da carteira, cursor (horizonte, UUID nulo), geração e link assinado sem cache', async () => {
    const { app, pedidos } = montar();
    const r = await app.inject({ method: 'GET', url: '/v1/sync/pacotes', headers: cab('vendedor') });
    expect(r.headers['cache-control']).toBe('no-store');
    const m = PacotesSyncRespostaSchema.parse(r.json());
    expect(m.geracao_base).toBe(GERACAO);
    expect(m.pacotes.map((p) => p.id).sort()).toEqual([PACOTE_TENANT, PACOTE_F1]);
    const f1 = m.pacotes.find((p) => p.id === PACOTE_F1)!;
    expect(f1).toMatchObject({ modulo: 'catalogo', particao: `filial:${F1}`, horizonte: HORIZONTE.toISOString(), bytes: 10 });
    expect(f1.entidades).toEqual([{ nome: 'tabela_preco_item', linhas: 5, cursor: codificarCursor({ updated_at: HORIZONTE.toISOString(), id: UUID_NIL }) }]);
    expect(f1.url).toContain(`sync-pacotes/${TENANT}/catalogo/filial:${F1}/${PACOTE_F1}.sqlite.gz`);
    expect(f1.expira_em).toBe(new Date(AGORA.getTime() + 900_000).toISOString());
    expect(pedidos).toEqual([]);
  });

  it('a versao_escopo da entidade é a mesma do pull (a importação não dispara ressincronização)', async () => {
    const { app } = montar();
    for (const quem of ['vendedor', 'promotor'] as const) {
      const m = await manifesto(app, quem);
      const doPacote = m.pacotes.find((p) => p.particao === 'tenant')!.entidades[0]!;
      const pull = await app.inject({ method: 'GET', url: '/v1/sync/pull?entidade=sinonimo', headers: cab(quem) });
      expect(pull.statusCode).toBe(200);
      expect(doPacote.versao_escopo).toBeDefined();
      expect(doPacote.versao_escopo).toBe(pull.json().versao_escopo);
    }
  });

  it('pacote de outro tenant nunca é oferecido (mesmo módulo e partição)', async () => {
    const { app } = montar();
    const ids = (await manifesto(app, 'vendedor')).pacotes.map((p) => p.id);
    expect(ids).not.toContain(PACOTE_OUTRO);
  });

  it('RN-CAT-05: promotor sem preço não recebe a partição filial (só a tenant)', async () => {
    const { app, pedidos } = montar();
    expect((await manifesto(app, 'promotor')).pacotes.map((p) => p.id)).toEqual([PACOTE_TENANT]);
    expect(pedidos).toEqual([]);
  });

  it('RN-CORE-39: filial fora da carteira não é oferecida', async () => {
    const { app } = montar();
    expect((await manifesto(app, 'vendedor')).pacotes.map((p) => p.particao)).not.toContain(`filial:${F2}`);
  });

  it('tudo ou nada nas filiais: falta uma = nenhuma de filial, e o pedido só da que falta', async () => {
    const { app, pedidos } = montar({ linhas: LINHAS_PADRAO().filter((l) => l.id !== PACOTE_F2) });
    expect((await manifesto(app, 'supervisor')).pacotes.map((p) => p.id)).toEqual([PACOTE_TENANT]);
    expect(pedidos).toEqual([{ tenant: TENANT, modulo: 'catalogo', particao: `filial:${F2}` }]);
    const completo = montar();
    expect((await manifesto(completo.app, 'supervisor')).pacotes.map((p) => p.id).sort()).toEqual([PACOTE_TENANT, PACOTE_F1, PACOTE_F2]);
  });

  it(`"todas" as filiais (ou mais de ${MAX_PARTICOES_PACOTE}) = sem pacote de filial e sem pedido`, async () => {
    const { app, pedidos } = montar();
    expect((await manifesto(app, 'analista')).pacotes.map((p) => p.id)).toEqual([PACOTE_TENANT]);
    expect(pedidos).toEqual([]);
  });

  it('RN-CORE-02: módulo sem licença não aparece nem gera pedido', async () => {
    const semCatalogo: Licencas = { ...LICENCAS_PADRAO, perfil: { ...LICENCAS_PADRAO.perfil, vendedor: ['core', 'vendedor'] } };
    const { app, pedidos } = montar({ licencas: semCatalogo });
    expect(await manifesto(app, 'vendedor')).toEqual({ geracao_base: undefined, pacotes: [] });
    expect(pedidos).toEqual([]);
  });

  it('sem pacote pronto ou de outra geração (ADR 0021): não oferece e grava o pedido da partição', async () => {
    const velho = LINHAS_PADRAO().map((l) => (l.id === PACOTE_F1 ? { ...l, geracao_base: '0e000000-0000-4000-8000-0000000000bb' } : l));
    const { app, pedidos } = montar({ linhas: velho.filter((l) => l.id !== PACOTE_TENANT) });
    expect((await manifesto(app, 'vendedor')).pacotes).toEqual([]);
    expect(pedidos.map((p) => p.particao).sort()).toEqual([`filial:${F1}`, 'tenant']);
  });

  it('pacote com entidade que o usuário não pode ver não sai (nem vira pedido)', async () => {
    const misturado = LINHAS_PADRAO().map((l) => (l.id === PACOTE_TENANT ? { ...l, entidades: { sinonimo: 3, tabela_preco_item: 1 } } : l));
    const { app, pedidos } = montar({ linhas: misturado });
    expect((await manifesto(app, 'promotor')).pacotes).toEqual([]);
    expect(pedidos).toEqual([]);
  });

  it('link vencido renova: o manifesto seguinte traz outro link com validade nova', async () => {
    let agora = AGORA;
    const { app } = montar({ relogio: () => agora });
    const antes = (await manifesto(app, 'vendedor')).pacotes[0]!;
    agora = new Date(AGORA.getTime() + 901_000);
    const depois = (await manifesto(app, 'vendedor')).pacotes.find((p) => p.id === antes.id)!;
    expect(Date.parse(depois.expira_em)).toBeGreaterThan(Date.parse(antes.expira_em));
    expect(Date.parse(depois.expira_em)).toBeGreaterThan(agora.getTime());
  });

  it('banco antes da 0074 (tabela ausente): lista vazia em vez de erro', async () => {
    const { app } = montar({
      sync: {
        fonte: {
          prontos: async () => Promise.reject(Object.assign(new Error('relation does not exist'), { code: '42P01' })),
          porId: async () => null,
          pedir: async () => undefined,
        },
      },
    });
    expect((await manifesto(app, 'vendedor')).pacotes).toEqual([]);
  });
});

describe('GET /v1/sync/pacotes/:id/arquivo (driver disco)', () => {
  let dir: string;
  const BYTES = Buffer.from('0123456789');
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'macuxi-pacotes-teste-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function comDisco() {
    const armazenamento = criarArmazenamentoPacotesSyncEmDisco(dir);
    const origem = join(dir, 'origem.gz');
    writeFileSync(origem, BYTES);
    return { armazenamento, origem };
  }

  const baixar = (app: ReturnType<typeof createApp>, quem: Parameters<typeof cab>[0] | null, pacote: string, range?: string) =>
    app.inject({ method: 'GET', url: `/v1/sync/pacotes/${pacote}/arquivo`, headers: { ...(quem ? cab(quem) : {}), ...(range ? { range } : {}) } });

  it('no disco o manifesto aponta para a rota; o dono baixa inteiro e por Range (retomada)', async () => {
    const { armazenamento, origem } = comDisco();
    const linhas = LINHAS_PADRAO();
    for (const l of linhas) await armazenamento.gravar(l.chave_armazenamento, origem);
    const { app } = montar({ linhas, sync: { armazenamento } });
    const f1 = (await manifesto(app, 'vendedor')).pacotes.find((p) => p.id === PACOTE_F1)!;
    expect(f1.url).toBe(`/v1/sync/pacotes/${PACOTE_F1}/arquivo`);
    const inteiro = await baixar(app, 'vendedor', PACOTE_F1);
    expect(inteiro.statusCode).toBe(200);
    expect(inteiro.headers['accept-ranges']).toBe('bytes');
    expect(inteiro.rawPayload.equals(BYTES)).toBe(true);
    const parte = await baixar(app, 'vendedor', PACOTE_F1, 'bytes=4-');
    expect(parte.statusCode).toBe(206);
    expect(parte.headers['content-range']).toBe('bytes 4-9/10');
    expect(parte.rawPayload.toString()).toBe('456789');
    expect((await baixar(app, 'vendedor', PACOTE_F1, 'bytes=20-')).statusCode).toBe(416);
  });

  it('§4 item 4: outro tenant, filial fora da carteira, promotor sem preço, id inválido = 404; sem sessão = 401', async () => {
    const { armazenamento, origem } = comDisco();
    const linhas = LINHAS_PADRAO();
    for (const l of linhas) await armazenamento.gravar(l.chave_armazenamento, origem);
    const { app } = montar({ linhas, sync: { armazenamento } });
    expect((await baixar(app, 'vendedor', PACOTE_OUTRO)).statusCode).toBe(404);
    expect((await baixar(app, 'vendedor', PACOTE_F2)).statusCode).toBe(404);
    expect((await baixar(app, 'promotor', PACOTE_F1)).statusCode).toBe(404);
    expect((await baixar(app, 'promotor', PACOTE_TENANT)).statusCode).toBe(200);
    expect((await baixar(app, 'vendedor', 'nao-e-uuid')).statusCode).toBe(404);
    expect((await baixar(app, null, PACOTE_F1)).statusCode).toBe(401);
    const semLicenca = montar({ linhas, sync: { armazenamento }, licencas: { ...LICENCAS_PADRAO, perfil: { vendedor: ['core', 'vendedor'] } } });
    expect((await baixar(semLicenca.app, 'vendedor', PACOTE_TENANT)).statusCode).toBe(404);
  });

  it('substituído ainda baixa (quem estava baixando termina); apagado = 404', async () => {
    const { armazenamento, origem } = comDisco();
    const linhas = LINHAS_PADRAO().map((l) => (l.id === PACOTE_F1 ? { ...l, situacao: 'substituido' as const } : l.id === PACOTE_TENANT ? { ...l, situacao: 'apagado' as const } : l));
    for (const l of linhas) await armazenamento.gravar(l.chave_armazenamento, origem);
    const { app } = montar({ linhas, sync: { armazenamento } });
    expect((await baixar(app, 'vendedor', PACOTE_F1)).statusCode).toBe(200);
    expect((await baixar(app, 'vendedor', PACOTE_TENANT)).statusCode).toBe(404);
  });

  it('no S3 (ou desligado) a rota de arquivo não existe', async () => {
    expect((await baixar(montar().app, 'vendedor', PACOTE_F1)).statusCode).toBe(404);
    expect((await baixar(montar({ sync: null }).app, 'vendedor', PACOTE_F1)).statusCode).toBe(404);
  });
});

describe('apoio', () => {
  it('lerFaixa: a-b, a- e -n; fora do tamanho = inválida', () => {
    expect(lerFaixa(undefined, 10)).toBeNull();
    expect(lerFaixa('bytes=0-3', 10)).toEqual({ inicio: 0, fim: 3 });
    expect(lerFaixa('bytes=5-', 10)).toEqual({ inicio: 5, fim: 9 });
    expect(lerFaixa('bytes=-4', 10)).toEqual({ inicio: 6, fim: 9 });
    expect(lerFaixa('bytes=8-100', 10)).toEqual({ inicio: 8, fim: 9 });
    expect(lerFaixa('bytes=10-', 10)).toBe('invalida');
    expect(lerFaixa('bytes=0-1,3-4', 10)).toBe('invalida');
    expect(lerFaixa('itens=0-1', 10)).toBe('invalida');
  });

  it('chave: formato fechado (o tenant da chave é o da linha); nada de .. nem partição inventada', () => {
    expect(chaveDoPacoteSync({ tenant_id: TENANT, modulo: 'catalogo', particao: 'tenant', id: id(1) })).toBe(`sync-pacotes/${TENANT}/catalogo/tenant/${id(1)}.sqlite.gz`);
    expect(() => chaveDoPacoteSync({ tenant_id: TENANT, modulo: '..', particao: 'tenant', id: id(1) })).toThrow();
    expect(() => chaveDoPacoteSync({ tenant_id: TENANT, modulo: 'catalogo', particao: 'filial:x', id: id(1) })).toThrow();
    const disco = criarArmazenamentoPacotesSyncEmDisco('/tmp/raiz');
    expect(disco.caminhoLocal(`sync-pacotes/${TENANT}/catalogo/filial:${F1}/${id(1)}.sqlite.gz`)).toBe(`/tmp/raiz/sync-pacotes/${TENANT}/catalogo/filial_${F1}/${id(1)}.sqlite.gz`);
    expect(() => disco.caminhoLocal('../../etc/passwd')).toThrow();
  });
});
