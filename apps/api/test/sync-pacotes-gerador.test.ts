/**
 * ADR 0054 §1.4 (desenho `docs/desenho/T-catalogo-pacote.md`): gerador do pacote pronto no worker, sem banco (repositório em
 * memória, armazenamento em disco temporário, `node:sqlite` de verdade). Formato do arquivo, trava por partição, gatilhos
 * (lote do Hub com espera de 5 min, agendado de 24 h), descarte, falha com espera crescente e retenção dos substituídos.
 * O arquivo gerado é importado pelo motor do aparelho (`importarPacote` do SDK, A2): prova de que os dois lados batem.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gunzipSync } from 'node:zlib';
import { manifest as catalogo } from '@macuxi/catalogo/manifest';
import {
  codificarCursor,
  criarArmazenamentoSqlite,
  definirEntidadeSync,
  definirModuloApi,
  MetaPacoteSchema,
  particaoDeFilial,
  UUID_NIL,
  type ContextoPacote,
  type LinhaSync,
  type PedidoPull,
} from '@macuxi/platform-sdk';
import { criarDriverNode } from '@macuxi/platform-sdk/sqlite-node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { LicencasTenant } from '../src/licencas';
import { criarArmazenamentoPacotesSyncEmDisco } from '../src/sync-pacotes';
import {
  criarGeradorPacotes,
  ESPERA_LOTE_MS,
  esperaDaFalha,
  MAX_TENTATIVAS,
  type NovoPacote,
  type OrigemPedidoPacote,
  type PacotePronto,
  type PedidoPacote,
  type RepositorioPacotes,
} from '../src/sync-pacotes-gerador';
import { bancoFalso, modulosDeTeste, TENANT } from './apoio';

const GERACAO = '0e000000-0000-4000-8000-0000000000aa';
const F1 = '0f000000-0000-4000-8000-000000000001';
const F2 = '0f000000-0000-4000-8000-000000000002';
const T0 = new Date('2026-11-15T12:00:00.000Z');
const uid = (n: number) => `0d000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const iso = (ms: number) => new Date(T0.getTime() + ms).toISOString();

const sinonimo = definirEntidadeSync({ nome: 'sinonimo', modulo: 'catalogo', direcao: 'pull', conflito: 'servidor_vence', schema: z.object({}) });
const precoItem = definirEntidadeSync({ nome: 'tabela_preco_item', modulo: 'catalogo', direcao: 'pull', conflito: 'servidor_vence', schema: z.object({}) });

/** Linhas "do banco" por entidade; a de preço leva `filial_id`. */
interface Base {
  sinonimo: LinhaSync[];
  tabela_preco_item: (LinhaSync & { filial_id: string })[];
}

function baseInicial(): Base {
  return {
    sinonimo: [
      { id: uid(1), updated_at: iso(-60_000), deleted_at: null, termo: 'refri' } as LinhaSync,
      { id: uid(2), updated_at: iso(-50_000), deleted_at: null, termo: 'bolacha' } as LinhaSync,
      { id: uid(3), updated_at: iso(-40_000), deleted_at: '2026-11-15T11:59:20.000Z' }, // apagada: fica fora
      { id: uid(4), updated_at: iso(-30_000), deleted_at: null, termo: 'sabão' } as LinhaSync,
      { id: uid(5), updated_at: iso(-20_000), deleted_at: null, termo: 'açúcar' } as LinhaSync,
      { id: uid(6), updated_at: iso(-1_000), deleted_at: null, termo: 'depois do horizonte' } as LinhaSync, // >= horizonte: fora
    ],
    tabela_preco_item: [
      { id: uid(11), updated_at: iso(-60_000), deleted_at: null, filial_id: F1, preco_centavos: 1990 } as LinhaSync & { filial_id: string },
      { id: uid(12), updated_at: iso(-50_000), deleted_at: null, filial_id: F2, preco_centavos: 2990 } as LinhaSync & { filial_id: string },
    ],
  };
}

/** `pacote.puxar` como o SQL do módulo: vivas, `(updated_at, id) > desde`, `updated_at < ate`, da filial, em ordem, até `limite`. */
function puxarDe(linhas: () => (LinhaSync & { filial_id?: string })[], chamadas: { filial: string | null; pedido: PedidoPull }[]) {
  return async (_ctx: ContextoPacote, p: PedidoPull & { filial: string | null }): Promise<LinhaSync[]> => {
    chamadas.push({ filial: p.filial, pedido: p });
    const depois = (l: LinhaSync) => !p.desde || l.updated_at > p.desde.updated_at || (l.updated_at === p.desde.updated_at && l.id > p.desde.id);
    return linhas()
      .filter((l) => !l.deleted_at && l.updated_at < p.ate && depois(l) && (p.filial === null || l.filial_id === p.filial))
      .sort((a, b) => (a.updated_at === b.updated_at ? (a.id < b.id ? -1 : 1) : a.updated_at < b.updated_at ? -1 : 1))
      .slice(0, p.limite);
  };
}

/** Repositório em memória com a semântica da 0074 (um pronto vivo e um pendente vivo por partição). */
function repositorioEmMemoria(agora: () => Date) {
  const pacotes: (PacotePronto & { situacao: 'pronto' | 'substituido' | 'apagado'; chave: string; substituido_em: Date | null; bytes: number; md5: string })[] = [];
  const pedidos: (PedidoPacote & { situacao: 'pendente' | 'atendido' | 'descartado'; gerar_apos: Date; ultimo_erro: string | null })[] = [];
  const travadas = new Set<string>();
  const lotes: { tenant_id: string; ocorrido_em: Date }[] = [];
  let n = 100;
  const repo: RepositorioPacotes = {
    tenantsAtivos: async () => [TENANT],
    lotesConcluidos: async (tenants, desde) => {
      const ultimo = new Map<string, Date>();
      for (const l of lotes) if (tenants.includes(l.tenant_id) && l.ocorrido_em > desde && (!ultimo.get(l.tenant_id) || l.ocorrido_em > ultimo.get(l.tenant_id)!)) ultimo.set(l.tenant_id, l.ocorrido_em);
      return [...ultimo].map(([tenant_id, u]) => ({ tenant_id, ultimo: u }));
    },
    prontos: async (f) => pacotes.filter((p) => p.situacao === 'pronto' && ('tenant_id' in f ? p.tenant_id === f.tenant_id : p.created_at < f.criadosAntes)),
    pedir: async (p) => {
      const atual = pedidos.find((x) => x.situacao === 'pendente' && x.tenant_id === p.tenant_id && x.modulo === p.modulo && x.particao === p.particao);
      if (!atual) {
        pedidos.push({ id: uid(n++), tenant_id: p.tenant_id, modulo: p.modulo, particao: p.particao, origem: p.origem, tentativas: 0, updated_at: agora(), situacao: 'pendente', gerar_apos: p.gerar_apos, ultimo_erro: null });
      } else if (p.origem === 'lote' && p.gerar_apos > atual.gerar_apos) {
        atual.gerar_apos = p.gerar_apos;
        atual.updated_at = agora();
      }
    },
    pendentes: async (quando, limite) =>
      pedidos.filter((p) => p.situacao === 'pendente' && p.gerar_apos <= quando).sort((a, b) => a.gerar_apos.getTime() - b.gerar_apos.getTime()).slice(0, limite),
    pendente: async (i) => pedidos.find((p) => p.id === i && p.situacao === 'pendente') ?? null,
    travar: async (chave) => {
      if (travadas.has(chave)) return null;
      travadas.add(chave);
      return { liberar: async () => void travadas.delete(chave) };
    },
    registrar: async (p: NovoPacote) => {
      for (const x of pacotes)
        if (x.situacao === 'pronto' && x.tenant_id === p.tenant_id && x.modulo === p.modulo && x.particao === p.particao) {
          x.situacao = 'substituido';
          x.substituido_em = agora();
        }
      pacotes.push({ ...p, created_at: agora(), situacao: 'pronto', substituido_em: null });
    },
    concluir: async (i, situacao, erro) => {
      const p = pedidos.find((x) => x.id === i && x.situacao === 'pendente');
      if (p) Object.assign(p, { situacao, ultimo_erro: erro ?? p.ultimo_erro });
    },
    adiar: async (i, erro, gerarApos) => {
      const p = pedidos.find((x) => x.id === i && x.situacao === 'pendente');
      if (p) Object.assign(p, { tentativas: p.tentativas + 1, ultimo_erro: erro, gerar_apos: gerarApos });
    },
    substituidos: async (antes) => pacotes.filter((p) => p.situacao === 'substituido' && p.substituido_em! < antes).map((p) => ({ id: p.id, chave: p.chave })),
    marcarApagado: async (i) => {
      const p = pacotes.find((x) => x.id === i);
      if (p) p.situacao = 'apagado';
    },
    expurgar: async () => ({ pacotes: 0, pedidos: 0 }),
  };
  return { repo, pacotes, pedidos, travadas, lotes };
}

const LICENCAS: LicencasTenant = { ativosNoTenant: ['core', 'catalogo', 'vendedor'], parametros: {}, fuso: 'America/Manaus' } as LicencasTenant;

describe('gerador do pacote da primeira carga', () => {
  let dir: string;
  let agora: Date;
  let base: Base;
  let chamadas: { filial: string | null; pedido: PedidoPull }[];
  let licencas: LicencasTenant;
  let falharPuxar: Error | null;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'macuxi-gerador-teste-'));
    agora = T0;
    base = baseInicial();
    chamadas = [];
    licencas = LICENCAS;
    falharPuxar = null;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function montar(tamanhoPagina = 2, comGeracao = true) {
    const relogio = () => agora;
    const puxarSinonimo = puxarDe(() => base.sinonimo, chamadas);
    const catalogoApi = definirModuloApi({
      manifesto: catalogo,
      sync: [
        {
          entidade: sinonimo,
          escopo: 'tenant',
          puxar: async () => [],
          pacote: {
            particao: 'tenant',
            puxar: async (ctx, p) => {
              if (falharPuxar) throw falharPuxar;
              return puxarSinonimo(ctx, p);
            },
          },
        },
        { entidade: precoItem, escopo: 'tenant', puxar: async () => [], pacote: { particao: 'filial', puxar: puxarDe(() => base.tabela_preco_item, chamadas) } },
      ],
      particoesPacote: { filiaisDoUsuario: async () => [F1], filiaisDoTenant: async () => [F1, F2] },
    });
    // horizonte = agora - 2 s (relógio do banco, ADR 0006)
    const { banco } = bancoFalso(() => new Date(relogio().getTime() - 2_000));
    if (comGeracao) banco.geracaoBase = async () => GERACAO;
    const mem = repositorioEmMemoria(relogio);
    const armazenamento = criarArmazenamentoPacotesSyncEmDisco(join(dir, 'arquivos'));
    const avisos: { o: Record<string, unknown>; msg?: string }[] = [];
    const modulos = modulosDeTeste({ catalogo: catalogoApi });
    const gerador = criarGeradorPacotes({
      app: banco,
      repositorio: mem.repo,
      modulos,
      armazenamento,
      dirTemp: join(dir, 'temp'),
      licencasNoTenant: async () => licencas,
      agora: relogio,
      tamanhoPagina,
      log: { info: () => undefined, warn: (o, msg) => void avisos.push({ o, msg }), error: () => undefined },
    });
    return { gerador, armazenamento, avisos, modulos, banco, ...mem };
  }

  /** Abre o arquivo do pacote (gunzip) e devolve a meta e as linhas por entidade. */
  function abrir(caminhoGz: string) {
    const arquivo = join(dir, `lido-${Math.random()}.sqlite`);
    writeFileSync(arquivo, gunzipSync(readFileSync(caminhoGz)));
    const db = new DatabaseSync(arquivo);
    const meta = MetaPacoteSchema.parse(Object.fromEntries((db.prepare('SELECT chave, valor FROM _pacote').all() as { chave: string; valor: string }[]).map((r) => [r.chave, r.valor])));
    const linhas = (e: string) => db.prepare(`SELECT id, updated_at, dados FROM ent_${e} ORDER BY updated_at, id`).all() as { id: string; updated_at: string; dados: string }[];
    return { meta, linhas, arquivo, fechar: () => db.close() };
  }

  it('pedido do manifesto: gera o .sqlite.gz no formato do aparelho, só vivas abaixo do horizonte, em páginas', async () => {
    const g = montar(2);
    await g.repo.pedir({ tenant_id: TENANT, modulo: 'catalogo', particao: 'tenant', origem: 'manifesto', gerar_apos: agora });
    const r = await g.gerador.ciclo();
    expect(r).toMatchObject({ gerados: 1, falhas: 0 });
    expect(g.pedidos[0]!.situacao).toBe('atendido');
    const p = g.pacotes[0]!;
    expect(p.chave).toBe(`sync-pacotes/${TENANT}/catalogo/tenant/${p.id}.sqlite.gz`);
    const caminho = g.armazenamento.caminhoLocal(p.chave)!;
    const bytes = readFileSync(caminho);
    expect(p.bytes).toBe(bytes.length);
    expect(p.md5).toBe(createHash('md5').update(bytes).digest('hex'));
    expect(p.horizonte.toISOString()).toBe(iso(-2_000));
    expect(p.geracao_base).toBe(GERACAO);
    const a = abrir(caminho);
    expect(a.meta).toMatchObject({ formato: 1, tenant_id: TENANT, modulo: 'catalogo', particao: 'tenant', horizonte: iso(-2_000), geracao_base: GERACAO, entidades: { sinonimo: 4 } });
    const vivas = base.sinonimo.filter((l) => !l.deleted_at && l.updated_at < iso(-2_000));
    // `dados` = JSON da MESMA linha do pull (byte a byte)
    expect(a.linhas('sinonimo')).toEqual(vivas.map((l) => ({ id: l.id, updated_at: l.updated_at, dados: JSON.stringify(l) })));
    a.fechar();
    expect(p.entidades).toEqual({ sinonimo: 4 });
    // páginas de 2: (desde nulo) → 2 linhas → (cursor da 2ª) → 2 linhas → (cursor da 4ª) → 0
    expect(chamadas.map((c) => c.pedido.desde?.id ?? null)).toEqual([null, uid(2), uid(5)]);
    expect(chamadas.every((c) => c.filial === null && c.pedido.ate === iso(-2_000))).toBe(true);
    // temporários apagados
    expect(readdirSync(join(dir, 'temp'))).toEqual([]);
  });

  it('o arquivo gerado é importado pelo motor do aparelho (importarPacote, A2) com cursor e contagem conferidos', async () => {
    const g = montar(3);
    await g.repo.pedir({ tenant_id: TENANT, modulo: 'catalogo', particao: particaoDeFilial(F1), origem: 'manifesto', gerar_apos: agora });
    await g.gerador.ciclo();
    const p = g.pacotes[0]!;
    expect(p.entidades).toEqual({ tabela_preco_item: 1 });
    expect(chamadas.every((c) => c.filial === F1)).toBe(true);
    const a = abrir(g.armazenamento.caminhoLocal(p.chave)!);
    a.fechar();
    const aparelho = criarArmazenamentoSqlite(criarDriverNode(':memory:'), { entidades: [{ nome: 'tabela_preco_item', modulo: 'catalogo' }] });
    const cursor = codificarCursor({ updated_at: p.horizonte.toISOString(), id: UUID_NIL });
    await aparelho.linhas.importarPacote!(a.arquivo, [{ nome: 'tabela_preco_item', linhas: 1, cursor }], { modulo: 'catalogo', particao: particaoDeFilial(F1), geracao_base: GERACAO });
    expect(await aparelho.linhas.listar('tabela_preco_item')).toEqual([base.tabela_preco_item[0]]);
  });

  it('trava por partição: outro processo gerando = pula sem gerar e o pedido fica pendente', async () => {
    const g = montar();
    await g.repo.pedir({ tenant_id: TENANT, modulo: 'catalogo', particao: 'tenant', origem: 'manifesto', gerar_apos: agora });
    g.travadas.add(`sync-pacote:${TENANT}:catalogo:tenant`);
    expect(await g.gerador.ciclo()).toMatchObject({ gerados: 0, ocupados: 1 });
    expect(g.pedidos[0]!.situacao).toBe('pendente');
    expect(g.pacotes).toEqual([]);
    g.travadas.clear();
    expect(await g.gerador.ciclo()).toMatchObject({ gerados: 1, ocupados: 0 });
    expect(g.travadas.size).toBe(0); // destravou no fim
  });

  it('dois geradores no mesmo ciclo: um gera, o outro acha a partição travada', async () => {
    const g = montar();
    const outro = criarGeradorPacotes({
      app: g.banco,
      repositorio: g.repo,
      modulos: g.modulos,
      dirTemp: join(dir, 'temp2'),
      armazenamento: g.armazenamento,
      licencasNoTenant: async () => licencas,
      agora: () => agora,
    });
    await g.repo.pedir({ tenant_id: TENANT, modulo: 'catalogo', particao: 'tenant', origem: 'manifesto', gerar_apos: agora });
    const [a, b] = await Promise.all([g.gerador.ciclo(), outro.ciclo()]);
    expect(a.gerados + b.gerados).toBe(1);
    expect(g.pacotes).toHaveLength(1);
  });

  it('gatilho do lote: pede todas as partições do tenant com espera de 5 min, empurra com lote novo e não repete', async () => {
    const g = montar();
    const lote1 = new Date(T0.getTime() - 60_000);
    g.lotes.push({ tenant_id: TENANT, ocorrido_em: lote1 });
    const r = await g.gerador.ciclo();
    expect(r.pedidos_lote).toBe(3); // tenant, F1 e F2
    expect(g.pedidos.map((p) => [p.particao, p.origem, p.gerar_apos.getTime()])).toEqual([
      ['tenant', 'lote', lote1.getTime() + ESPERA_LOTE_MS],
      [`filial:${F1}`, 'lote', lote1.getTime() + ESPERA_LOTE_MS],
      [`filial:${F2}`, 'lote', lote1.getTime() + ESPERA_LOTE_MS],
    ]);
    expect(r.gerados).toBe(0); // ainda dentro da espera
    // mesmo lote no ciclo seguinte: nada novo
    expect((await g.gerador.ciclo()).pedidos_lote).toBe(0);
    // lote novo antes de vencer: empurra a espera (não gera no meio de uma carga de vários lotes)
    agora = new Date(T0.getTime() + 120_000);
    const lote2 = new Date(agora.getTime() - 1_000);
    g.lotes.push({ tenant_id: TENANT, ocorrido_em: lote2 });
    await g.gerador.ciclo();
    expect(g.pedidos.filter((p) => p.situacao === 'pendente')).toHaveLength(3);
    expect(g.pedidos.every((p) => p.gerar_apos.getTime() === lote2.getTime() + ESPERA_LOTE_MS)).toBe(true);
    // passou a espera: gera (até 5 por ciclo) e um pacote mais novo que o lote não pede de novo
    agora = new Date(lote2.getTime() + ESPERA_LOTE_MS + 1_000);
    expect((await g.gerador.ciclo()).gerados).toBe(3);
    expect(g.pacotes.map((p) => p.particao).sort()).toEqual([`filial:${F1}`, `filial:${F2}`, 'tenant']);
  });

  it('gatilho agendado: pacote com mais de 24 h só é regerado se mudou algo depois do horizonte', async () => {
    const g = montar();
    await g.repo.pedir({ tenant_id: TENANT, modulo: 'catalogo', particao: 'tenant', origem: 'manifesto', gerar_apos: agora });
    await g.gerador.ciclo();
    expect(g.pacotes).toHaveLength(1);
    // a linha que estava acima do horizonte também é mudança: tira para o caso "sem mudança"
    base.sinonimo = base.sinonimo.filter((l) => l.id !== uid(6));
    // 25 h depois, sem mudança: nada
    agora = new Date(T0.getTime() + 25 * 3_600_000);
    expect((await g.gerador.ciclo()).pedidos_agendados).toBe(0);
    // mudou um sinônimo (e passou a 1 h do gatilho agendado): pede e gera
    base.sinonimo.push({ id: uid(7), updated_at: new Date(agora.getTime() - 10_000).toISOString(), deleted_at: null });
    agora = new Date(agora.getTime() + 3_600_000);
    const r = await g.gerador.ciclo();
    expect(r.pedidos_agendados).toBe(1);
    expect(r.gerados).toBe(1);
    expect(g.pacotes.filter((p) => p.situacao === 'pronto')[0]!.entidades).toEqual({ sinonimo: 5 });
  });

  it('retenção: a geração nova substitui a anterior; o arquivo antigo só sai 1 h depois', async () => {
    const g = montar();
    await g.repo.pedir({ tenant_id: TENANT, modulo: 'catalogo', particao: 'tenant', origem: 'manifesto', gerar_apos: agora });
    await g.gerador.ciclo();
    agora = new Date(T0.getTime() + 60_000);
    await g.repo.pedir({ tenant_id: TENANT, modulo: 'catalogo', particao: 'tenant', origem: 'manifesto', gerar_apos: agora });
    await g.gerador.ciclo();
    const [antigo, novo] = g.pacotes;
    expect(antigo!.situacao).toBe('substituido');
    expect(novo!.situacao).toBe('pronto');
    const caminhoAntigo = g.armazenamento.caminhoLocal(antigo!.chave)!;
    agora = new Date(T0.getTime() + 60_000 + 59 * 60_000);
    await g.gerador.ciclo();
    expect(existsSync(caminhoAntigo)).toBe(true); // quem estava baixando termina
    agora = new Date(T0.getTime() + 60_000 + 61 * 60_000);
    expect((await g.gerador.ciclo()).arquivos_apagados).toBe(1);
    expect(existsSync(caminhoAntigo)).toBe(false);
    expect(antigo!.situacao).toBe('apagado');
    expect(existsSync(g.armazenamento.caminhoLocal(novo!.chave)!)).toBe(true);
  });

  it('pacote mais novo que o pedido já o atende (sem gerar de novo)', async () => {
    const g = montar();
    await g.repo.pedir({ tenant_id: TENANT, modulo: 'catalogo', particao: 'tenant', origem: 'manifesto', gerar_apos: agora });
    await g.gerador.ciclo();
    // pedido antigo (criado antes do horizonte do pacote pronto)
    g.pedidos.push({ id: uid(900), tenant_id: TENANT, modulo: 'catalogo', particao: 'tenant', origem: 'lote' as OrigemPedidoPacote, tentativas: 0, updated_at: new Date(T0.getTime() - 3_600_000), situacao: 'pendente', gerar_apos: agora, ultimo_erro: null });
    const r = await g.gerador.ciclo();
    expect(r).toMatchObject({ gerados: 0, atendidos_sem_gerar: 1 });
  });

  it('módulo sem licença no tenant ou filial que saiu: pedido descartado sem gerar', async () => {
    const g = montar();
    await g.repo.pedir({ tenant_id: TENANT, modulo: 'catalogo', particao: particaoDeFilial('0f000000-0000-4000-8000-000000000099'), origem: 'manifesto', gerar_apos: agora });
    expect(await g.gerador.ciclo()).toMatchObject({ gerados: 0, descartados: 1 });
    licencas = { ...LICENCAS, ativosNoTenant: ['core', 'vendedor'] } as LicencasTenant;
    await g.repo.pedir({ tenant_id: TENANT, modulo: 'catalogo', particao: 'tenant', origem: 'manifesto', gerar_apos: agora });
    expect(await g.gerador.ciclo()).toMatchObject({ gerados: 0, descartados: 1 });
    expect(g.pedidos.map((p) => p.ultimo_erro)).toEqual(['fora_do_tenant', 'fora_do_tenant']);
  });

  it('falha: espera crescente com código curto; depois de MAX_TENTATIVAS o pedido é descartado; nada fica no armazenamento', async () => {
    const g = montar();
    falharPuxar = Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
    await g.repo.pedir({ tenant_id: TENANT, modulo: 'catalogo', particao: 'tenant', origem: 'manifesto', gerar_apos: agora });
    await g.gerador.ciclo();
    const p = g.pedidos[0]!;
    expect(p).toMatchObject({ situacao: 'pendente', tentativas: 1, ultimo_erro: 'banco_57014' });
    expect(p.gerar_apos.getTime()).toBe(agora.getTime() + esperaDaFalha(1));
    expect(g.avisos.some((a) => !JSON.stringify(a).includes('http'))).toBe(true);
    for (let i = 1; i < MAX_TENTATIVAS; i++) {
      agora = new Date(p.gerar_apos.getTime() + 1);
      await g.gerador.ciclo();
    }
    expect(p.situacao).toBe('descartado');
    expect(g.pacotes).toEqual([]);
    expect(esperaDaFalha(1)).toBe(60_000);
    expect(esperaDaFalha(20)).toBe(3_600_000);
  });

  it('sem geração da base conhecida (ADR 0021): não gera e adia; sem módulo com pacote, não faz nada', async () => {
    const g = montar(2, false);
    await g.repo.pedir({ tenant_id: TENANT, modulo: 'catalogo', particao: 'tenant', origem: 'manifesto', gerar_apos: agora });
    expect(await g.gerador.ciclo()).toMatchObject({ gerados: 0, falhas: 1 });
    expect(g.pedidos[0]).toMatchObject({ situacao: 'pendente', ultimo_erro: 'sem_geracao' });
    expect(g.pacotes).toEqual([]);
    // os módulos reais ainda sem `pacote` declarado (tarefas C e D): o gerador não tem o que gerar
    const vazio = criarGeradorPacotes({ app: g.banco, repositorio: g.repo, modulos: modulosDeTeste(), armazenamento: g.armazenamento });
    expect(vazio.modulos()).toEqual([]);
    expect(await vazio.ciclo()).toMatchObject({ gerados: 0, falhas: 0 });
  });
});
