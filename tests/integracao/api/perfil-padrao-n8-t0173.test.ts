/**
 * T-0173 / nota N8 do corretor sobre o PR #448 (modulo-core): usuário SEM linha em `plataforma.perfis_do_usuario` (0041).
 * Risco apontado: quem não tem linha cai em `matrizDeFabrica([])` e perde as ações dos módulos (ex.: `usuario.filial_editar`, RN-CORE-39),
 * com regressão no login. Regra: RN-CORE-01 (o usuário tem um ou mais perfis e nunca fica sem perfil; o banco confere no COMMIT) e
 * RN-CORE-35 (permissão efetiva = fábrica + sobreposições + travas; multiperfil = união). Sem linha é dado antigo ou fora da regra:
 * o comportamento esperado é o da fábrica do perfil principal, IGUAL ao de quem tem a linha de fábrica.
 *
 * - N8-01 (sem banco) login: sem linha × linha de fábrica × fábrica do main antes do #448 (`perfisDeFabrica`), em todo perfil e app:
 *   mesmo `podeUsarApp` e mesmos apps do e-mail (`appsDosPerfis`). O login só decide `acesso.*` (chaves da plataforma).
 * - N8-02 (sem banco, fonte) os perfis do login (matriz sem manifestos) só alimentam `podeUsarApp`/`appsDosPerfis`: nunca decidem ação de módulo.
 * - N8-03 (sem banco) `core.usuarios_com_acao@1` com a matriz da API (todos os manifestos): em toda ação de todo módulo, sem linha = com
 *   linha = fórmula do manifesto (`acoes[a].perfis`). `usuario.filial_editar`: admin e analista, com ou sem linha.
 * - N8-04 (sem banco) `core.credencial_conferir@1`: admin sem linha autoriza `usuario.filial_editar` e `lote.reprocessar`; vendedor sem linha não.
 * - N8-05 (fonte) a consulta recebe a matriz da API (`ContextoConsulta.permissoes`, PR do engenheiro-software): sem ela o #448 falha fechado
 *   para TODO perfil de fábrica (ninguém autoriza o reprocessamento, RN-INT-16).
 * - N8-06 (Postgres) login real sem linha = com linha (analista e vendedor de A, 3 apps); a consulta com a RLS real lista o sem linha e
 *   nunca cruza tenant (A × B).
 * Matriz: docs/testes/T-0173.md (seção N8).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { comTenant, hashSenha } from '@macuxi/db';
import { estadoBanco, semBanco } from '@macuxi/db/teste/estado';
import { manifest as catalogo } from '@macuxi/catalogo/manifest';
import { manifest as core } from '@macuxi/core/manifest';
import { manifest as gestor } from '@macuxi/gestor/manifest';
import { manifest as integracao } from '@macuxi/integracao/manifest';
import { manifest as pesquisa } from '@macuxi/pesquisa/manifest';
import { manifest as promotor } from '@macuxi/promotor/manifest';
import { manifest as treinamento } from '@macuxi/treinamento/manifest';
import { manifest as vendedor } from '@macuxi/vendedor/manifest';
import {
  catalogoDePermissoes,
  matrizDeFabrica,
  PERFIS,
  type ClienteBanco,
  type Manifesto,
  type MatrizFabrica,
  type Perfil,
  type PerfilDaRequisicao,
} from '@macuxi/platform-sdk';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appsDosPerfis } from '../../../modules/core/api/email';
import { perfisDoUsuarioNoLogin } from '../../../modules/core/api/perfis-do-usuario';
import { perfisDeFabrica, podeUsarApp } from '../../../modules/core/domain';
import { A, B, subirApi, type ApiDeTeste } from '../apoio/api';
import { criarUsuarioNoTenant } from '../apoio/portal';

const RAIZ = join(__dirname, '..', '..', '..');
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8');
const MANIFESTOS: readonly Manifesto[] = [core, catalogo, vendedor, promotor, gestor, pesquisa, treinamento, integracao];
/** O mesmo motor que a API monta em createApp (catálogo + matriz de fábrica dos manifestos instalados). */
const MOTOR = { catalogo: catalogoDePermissoes(MANIFESTOS), matriz: matrizDeFabrica(MANIFESTOS) };
const APPS = ['campo', 'gestao', 'web'] as const;
const SENHA_N8 = 'Perfil#Padrao-N8';

type Linha = { codigo: string; base: string; fabrica: boolean; sobreposicoes: unknown };
const linhaDeFabrica = (p: Perfil): Linha => ({ codigo: p, base: p, fabrica: true, sobreposicoes: [] });
const dbCom = (linhas: Linha[]): ClienteBanco => ({ query: async () => ({ rows: linhas as never[], rowCount: linhas.length }) });

/** Exports do #448 (lidos por import dinâmico: no main sem o #448 eles não existem e os casos pulam). */
interface Consulta<E, S> {
  executar(entrada: E, ctx: unknown): Promise<S>;
}
interface ModCredencial {
  consultaUsuariosComAcao: Consulta<{ modulo: string; acao: string }, { usuarios: { id: string; nome: string }[] }>;
  consultaCredencialConferir: Consulta<{ usuario_id: string; senha: string; acao: { modulo: string; acao: string } }, { resultado: string }>;
}
interface ModPerfis {
  perfisEfetivosDoUsuario?: (db: ClienteBanco, id: string, principal: Perfil, matriz: MatrizFabrica) => Promise<PerfilDaRequisicao[]>;
}
const importar = async <T>(rel: string): Promise<T> => (await import(pathToFileURL(join(RAIZ, rel)).href)) as T;

const ctxDe = (db: ClienteBanco, tenantId: string, permissoes: typeof MOTOR | null = MOTOR) => ({
  db,
  usuario: { id: randomUUID(), tenant_id: tenantId, perfil: 'admin', modulos: ['core', 'integracao'], perfis: perfisDeFabrica('admin') },
  requestId: 'n8',
  agora: () => new Date(),
  parametros: () => ({}),
  fuso: () => 'America/Manaus',
  log: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
  ...(permissoes ? { permissoes } : {}),
});

/** Todas as ações declaradas nos manifestos (`modulo`, `acao`, perfis de fábrica pela fórmula do manifesto). */
const ACOES = MANIFESTOS.flatMap((m) =>
  Object.entries((m.acoes ?? {}) as Record<string, { perfis: readonly string[] }>).map(([acao, d]) => ({ modulo: m.id, acao, perfis: d.perfis })),
);

describe('T-0173 N8 — login do usuário sem linha de perfil não regride (RN-CORE-01, RN-CORE-33/35)', () => {
  it('N8-01: em todo perfil e app, sem linha = linha de fábrica = fábrica do main antes do #448 (podeUsarApp e apps do e-mail)', async () => {
    const divergencias: string[] = [];
    for (const p of PERFIS) {
      const semLinha = await perfisDoUsuarioNoLogin(dbCom([]), 'u', p);
      const comLinha = await perfisDoUsuarioNoLogin(dbCom([linhaDeFabrica(p)]), 'u', p);
      const antes = perfisDeFabrica(p);
      for (const app of APPS) {
        const v = [podeUsarApp(semLinha, app), podeUsarApp(comLinha, app), podeUsarApp(antes, app)];
        if (new Set(v).size !== 1) divergencias.push(`${p}/${app}: sem=${v[0]} com=${v[1]} antes=${v[2]}`);
      }
      expect(appsDosPerfis(semLinha), p).toEqual(appsDosPerfis(comLinha));
      expect(appsDosPerfis(semLinha), p).toEqual(appsDosPerfis(antes));
    }
    expect(divergencias).toEqual([]);
    // âncora da regra: vendedor só no Campo, analista no BKO (RN-CORE-33)
    expect(appsDosPerfis(await perfisDoUsuarioNoLogin(dbCom([]), 'u', 'vendedor'))).toEqual(['campo']);
    expect(podeUsarApp(await perfisDoUsuarioNoLogin(dbCom([]), 'u', 'analista'), 'web')).toBe(true);
  });

  it('N8-02: os perfis do login (matriz sem manifestos) só decidem acesso ao app (podeUsarApp/appsDosPerfis), nunca ação de módulo', () => {
    const dir = join(RAIZ, 'modules/core/api');
    const usos: string[] = [];
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts') && n !== 'perfis-do-usuario.ts')) {
      const linhas = readFileSync(join(dir, f), 'utf8').split('\n');
      const vars = new Set<string>();
      linhas.forEach((l) => {
        const m = /(?:const|let)\s+(\w+)\s*=\s*await\s+perfisDoUsuarioNoLogin\(/.exec(l);
        if (m) vars.add(m[1]!);
      });
      linhas.forEach((l, i) => {
        const chamada = l.includes('perfisDoUsuarioNoLogin(');
        const usaVar = [...vars].some((v) => new RegExp(`\\b${v}\\b`).test(l));
        if (!chamada && !usaVar) return;
        const decl = /(?:const|let)\s+\w+\s*=\s*await\s+perfisDoUsuarioNoLogin\(/.test(l);
        if (!decl && !/podeUsarApp|appsDosPerfis/.test(l)) usos.push(`${f}:${i + 1}: ${l.trim()}`);
      });
    }
    expect(usos).toEqual([]);
  });
});

describe('T-0173 N8 — ações dos módulos para quem não tem linha de perfil (RN-CORE-35, RN-CORE-39, RN-INT-16)', () => {
  let cred: ModCredencial;
  let perfis: ModPerfis;
  beforeAll(async () => {
    cred = await importar<ModCredencial>('modules/core/api/credencial.ts');
    perfis = await importar<ModPerfis>('modules/core/api/perfis-do-usuario.ts');
  });

  /** Um usuário sem linha e um com a linha de fábrica, por perfil; a consulta faz o left join (linha nula = sem perfil). */
  const TENANT = '0e000000-0000-4000-8000-0000000000a8';
  const id = (tipo: 'sem' | 'com', p: Perfil) => `0e000000-0000-4000-8${tipo === 'sem' ? '0' : '1'}00-${String(PERFIS.indexOf(p)).padStart(12, '0')}`;
  const linhasDaConsulta = PERFIS.flatMap((p) => [
    { id: id('sem', p), nome: `sem ${p}`, perfil: p, ativo: true, bloqueado_em: null, bloqueio_ate: null, codigo: null, base: null, fabrica: null, sobreposicoes: null },
    { id: id('com', p), nome: `com ${p}`, perfil: p, ativo: true, bloqueado_em: null, bloqueio_ate: null, ...linhaDeFabrica(p) },
  ]);

  it('N8-03: em toda ação de todo módulo, sem linha = com linha = fórmula do manifesto (acoes[a].perfis)', async () => {
    expect(ACOES.length).toBeGreaterThan(20);
    const divergencias: string[] = [];
    for (const a of ACOES) {
      const { usuarios } = await cred.consultaUsuariosComAcao.executar({ modulo: a.modulo, acao: a.acao }, ctxDe(dbCom(linhasDaConsulta as never), TENANT));
      const obtidos = usuarios.map((u) => u.nome).sort();
      const esperados = PERFIS.filter((p) => a.perfis.includes(p)).flatMap((p) => [`sem ${p}`, `com ${p}`]).sort();
      if (JSON.stringify(obtidos) !== JSON.stringify(esperados)) divergencias.push(`${a.modulo}:${a.acao} obtido=${obtidos.join(',')} esperado=${esperados.join(',')}`);
    }
    expect(divergencias).toEqual([]);
  });

  it('N8-03b: usuario.filial_editar (RN-CORE-39) — admin e analista, com e sem linha; perfisEfetivosDoUsuario idem', async () => {
    const { usuarios } = await cred.consultaUsuariosComAcao.executar({ modulo: 'core', acao: 'usuario.filial_editar' }, ctxDe(dbCom(linhasDaConsulta as never), TENANT));
    expect(usuarios.map((u) => u.nome).sort()).toEqual(['com admin', 'com analista', 'sem admin', 'sem analista']);
    const efetivos = perfis.perfisEfetivosDoUsuario!;
    const { pode } = await import('@macuxi/platform-sdk');
    for (const p of PERFIS) {
      const sem = await efetivos(dbCom([]), 'u', p, MOTOR.matriz);
      const com = await efetivos(dbCom([linhaDeFabrica(p)]), 'u', p, MOTOR.matriz);
      expect(pode(sem, 'usuario.filial_editar'), p).toBe(pode(com, 'usuario.filial_editar'));
      expect(pode(sem, 'usuario.filial_editar'), p).toBe(p === 'admin' || p === 'analista');
    }
  });

  it('N8-04: credencial_conferir — admin sem linha autoriza usuario.filial_editar e lote.reprocessar; vendedor sem linha = sem_permissao', async () => {
    const hash = hashSenha(SENHA_N8);
    const db = (perfil: Perfil): ClienteBanco => ({
      query: async (sql: string) =>
        (sql.includes('from core.usuario')
          ? { rows: [{ senha_hash: hash, ativo: true, bloqueado_em: null, bloqueio_ate: null, deleted_at: null, perfil }], rowCount: 1 }
          : { rows: [], rowCount: 0 }) as never,
    });
    const conferir = (perfil: Perfil, acao: { modulo: string; acao: string }) =>
      cred.consultaCredencialConferir.executar({ usuario_id: randomUUID(), senha: SENHA_N8, acao }, ctxDe(db(perfil), TENANT)).then((r) => r.resultado);
    expect(await conferir('admin', { modulo: 'core', acao: 'usuario.filial_editar' })).toBe('ok');
    expect(await conferir('admin', { modulo: 'integracao', acao: 'lote.reprocessar' })).toBe('ok');
    expect(await conferir('analista', { modulo: 'integracao', acao: 'lote.reprocessar' })).toBe('ok');
    expect(await conferir('vendedor', { modulo: 'integracao', acao: 'lote.reprocessar' })).toBe('sem_permissao');
  });

  it('N8-05: a API entrega a matriz dos módulos à consulta (ContextoConsulta.permissoes); sem ela, nenhum perfil de fábrica autoriza', async () => {
    const sdk = ler('packages/platform-sdk/src/api.ts');
    const corpoConsulta = /export interface ContextoConsulta \{([\s\S]*?)\n\}/.exec(sdk)?.[1] ?? '';
    expect(corpoConsulta, 'ContextoConsulta sem permissoes: o #448 depende do PR do engenheiro-software (T-0173)').toMatch(/\bpermissoes\?:/);
    expect(ler('apps/api/src/outbox.ts')).toMatch(/permissoes:\s*motorPermissoesDe\(/);
    // o efeito que a dependência evita: sem a matriz, só as chaves da plataforma valem (falha fechada para todos)
    const { usuarios } = await cred.consultaUsuariosComAcao.executar(
      { modulo: 'integracao', acao: 'lote.reprocessar' },
      ctxDe(dbCom(linhasDaConsulta as never), TENANT, null),
    );
    expect(usuarios).toEqual([]);
  });
});

describe.skipIf(semBanco())('T-0173 N8-06 — sem linha de perfil com Postgres real (login, RLS, A × B)', () => {
  let api: ApiDeTeste;
  const u = { semAnalista: '', comAnalista: '', semVendedor: '', comVendedor: '' };
  const email = (k: keyof typeof u) => `${k.toLowerCase()}.n8@exemplo.com.br`;
  let cred: ModCredencial;

  beforeAll(async () => {
    expect(estadoBanco().disponivel).toBe(true);
    api = await subirApi();
    cred = await importar<ModCredencial>('modules/core/api/credencial.ts');
    for (const k of Object.keys(u) as (keyof typeof u)[]) {
      u[k] = await criarUsuarioNoTenant(api.admin, { tenantId: A.tenantId, email: email(k), nome: `N8 ${k}`, senha: SENHA_N8, perfil: k.endsWith('Analista') ? 'analista' : 'vendedor' });
    }
    // dado antigo/fora da RN-CORE-01: o banco recusa ficar sem perfil no COMMIT; a administração desliga os gatilhos só nesta transação
    const c = await api.admin.connect();
    try {
      await c.query('begin');
      await c.query("set local session_replication_role = 'replica'");
      await c.query('update plataforma.usuario_perfil set deleted_at = now() where usuario_id = any($1::uuid[]) and deleted_at is null', [[u.semAnalista, u.semVendedor]]);
      await c.query('commit');
    } finally {
      c.release();
    }
  }, 300_000);
  afterAll(async () => {
    await api?.fechar();
  });

  const contar = (id: string) =>
    comTenant(api.pool, A.tenantId, async (c) => (await c.query<{ n: number }>('select count(*)::int as n from plataforma.perfis_do_usuario($1)', [id])).rows[0]!.n);

  it('pré-condição: o sem linha não tem perfil vivo; o com linha tem o de fábrica', async () => {
    expect(await contar(u.semAnalista)).toBe(0);
    expect(await contar(u.semVendedor)).toBe(0);
    expect(await contar(u.comAnalista)).toBe(1);
    expect(await contar(u.comVendedor)).toBe(1);
  });

  it('login (POST /v1/auth/login) sem linha = com linha em Campo, Gestão e BKO; vendedor entra no Campo, analista no BKO', async () => {
    const status = async (k: keyof typeof u, app: (typeof APPS)[number]) => (await api.entrar(email(k), { senha: SENHA_N8, tenant: A, app })).statusCode;
    for (const app of APPS) {
      expect(await status('semAnalista', app), `analista ${app}`).toBe(await status('comAnalista', app));
      expect(await status('semVendedor', app), `vendedor ${app}`).toBe(await status('comVendedor', app));
    }
    expect(await status('semVendedor', 'campo')).toBe(200);
    expect(await status('semVendedor', 'web')).toBe(403);
    expect(await status('semAnalista', 'web')).toBe(200);
    // outro tenant: a mesma pessoa não existe em B (401, sem revelar)
    expect((await api.entrar(email('semAnalista'), { senha: SENHA_N8, tenant: B, app: 'web' })).statusCode).toBe(401);
  });

  it('core.usuarios_com_acao@1 com a RLS real: usuario.filial_editar lista o analista sem linha e o com linha de A, nunca os de B', async () => {
    const lista = (tenantId: string) =>
      comTenant(api.pool, tenantId, (c) => cred.consultaUsuariosComAcao.executar({ modulo: 'core', acao: 'usuario.filial_editar' }, ctxDe(c, tenantId)));
    const emA = (await lista(A.tenantId)).usuarios.map((x) => x.id);
    expect(emA).toEqual(expect.arrayContaining([u.semAnalista, u.comAnalista]));
    expect(emA).not.toContain(u.semVendedor);
    expect(emA).not.toContain(u.comVendedor);
    const emB = (await lista(B.tenantId)).usuarios.map((x) => x.id);
    for (const id of Object.values(u)) expect(emB).not.toContain(id);
  });

  it('core.credencial_conferir@1 com a RLS real: analista sem linha de A = ok em A; a mesma senha consultada do tenant B = incorreta', async () => {
    const conferir = (tenantId: string, usuario_id: string) =>
      comTenant(api.pool, tenantId, (c) =>
        cred.consultaCredencialConferir.executar({ usuario_id, senha: SENHA_N8, acao: { modulo: 'integracao', acao: 'lote.reprocessar' } }, ctxDe(c, tenantId)),
      ).then((r) => r.resultado);
    expect(await conferir(A.tenantId, u.semAnalista)).toBe('ok');
    expect(await conferir(A.tenantId, u.semVendedor)).toBe('sem_permissao');
    expect(await conferir(B.tenantId, u.semAnalista)).toBe('incorreta');
  });
});
