/**
 * 0072 — Inativar, Backup e Excluir a empresa pelo portal (ADR 0052; desenho docs/desenho/empresa-acoes.md §4 e §7; regras
 * aprovadas em R-20261114-195600-alexandre e R-20261114-202000-alexandre). Dicionário: docs/banco/plataforma.md ("Ações da
 * empresa (0072)"). O que o BANCO garante:
 * - RN-PLA-07: inativa = status suspenso com inativada_em, motivo opcional (CHECK + gatilho); despachante e e-mail do worker não veem
 *   a empresa inativa (políticas com plataforma.tenant_esta_ativo; os plataforma.tenant.* passam);
 * - RN-PLA-08: um backup em andamento por empresa; consistente só com a empresa inativa do início ao fim; o worker exporta
 *   só o tenant da LINHA DO BACKUP, em ordem de FK, por keyset;
 * - RN-PLA-09: a conferirExclusao do SDK repetida no pedido e na execução (códigos no hint); a exclusão apaga o MESMO que o
 *   backup exportou (contagem por tabela) e o registro sobrevive;
 * - RN-PLA-10: o código da empresa excluída não volta (gatilho e sorteio); a restauração (mesmo id) pode;
 * - RN-PLA-11: backup 30 dias, o da exclusão 90 dias depois dela;
 * - papéis da ADR 0024: sa_* só do macuxi_portal, as do worker só do macuxi_worker, nenhum grant de tabela; up/down exato.
 * Estático (sempre) + banco (fixture dois-tenants, sempre com ROLLBACK; up/down num banco efêmero) no CI.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AcoesDaEmpresaSchema,
  BackupEmpresaSchema,
  EVENTO_TENANT_BACKUP_CONCLUIDO,
  EVENTO_TENANT_INATIVADO,
  EVENTO_TENANT_REATIVADO,
  ExclusaoEmpresaSchema,
  ListaBackupsEmpresaSchema,
  MOTIVOS_INATIVACAO,
  PRAZO_BACKUP_PARA_EXCLUIR_DIAS,
  RETENCAO_BACKUP_EMPRESA_DIAS,
  RETENCAO_BACKUP_EXCLUIDA_DIAS,
  SITUACOES_BACKUP,
  SITUACOES_EXCLUSAO,
  ETAPAS_EXCLUSAO,
  SituacaoEmpresaRespostaSchema,
} from '@macuxi/platform-sdk';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { TABELAS_SEM_TENANT_ID, TABELAS_SO_POR_FUNCAO } from '../src/excecoes';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { FUNCOES_SA_0072, FUNCOES_SA_ATE_0072, FUNCOES_WORKER_0072 } from './funcoes-sa';
import { emTransacao, erroDe, HASH_TESTE, retratoDoCatalogo, tabelasComTenant } from './util';

const migracoes = lerMigracoes();
const m68 = migracoes.find((m) => m.versao === '0068')!;
const m72 = migracoes.find((m) => m.versao === '0072')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(m72.up);
const down = semComentarios(m72.down);
/** Do início até o `$$;` que fecha a função. */
const bloco = (sql: string, inicio: string) => {
  const i = sql.indexOf(inicio);
  if (i < 0) return '';
  const fim = /^\$\$;$/m.exec(sql.slice(i));
  return fim ? sql.slice(i, i + fim.index + fim[0].length) : '';
};
const TABELAS = ['plataforma.backup_empresa', 'plataforma.backup_empresa_parte', 'plataforma.exclusao_empresa', 'plataforma.empresa_excluida'];
const INTERNAS = [
  'plataforma.instante_iso(timestamptz)',
  'plataforma.backup_empresa_json(plataforma.backup_empresa)',
  'plataforma.exclusao_empresa_json(plataforma.exclusao_empresa)',
  'plataforma.exclusao_bloqueada(uuid, uuid, uuid)',
  'plataforma.ordem_do_backup()',
  'plataforma.tenant_inativacao_preencher()',
  'plataforma.tenant_codigo_nao_reaproveitado()',
];
const nomeDe = (f: string) => f.slice(0, f.indexOf('('));

const A = DOIS_TENANTS.A.tenantId;
const B = DOIS_TENANTS.B.tenantId;
const ADMIN_A = DOIS_TENANTS.A.usuarios.admin;
const SHA = 'a'.repeat(64);
const id = (n: number) => `00720000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('0072 ações da empresa (estático)', () => {
  it('nome e posição: 0072_plataforma_empresa_acoes logo depois da 0071 (planos)', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[nomes.indexOf('0071_plataforma_listar_tenants_plano') + 1]).toBe('0072_plataforma_empresa_acoes');
  });

  it('as 4 tabelas: sem tenant_id, só por função (sem grant), RLS forçado, só a política manutencao; empresa_id sem FK', () => {
    for (const t of TABELAS) {
      expect(TABELAS_SEM_TENANT_ID, t).toHaveProperty([t]);
      expect(TABELAS_SO_POR_FUNCAO, t).toContain(t);
      expect(up).toContain(`revoke all on ${t} from public, macuxi_app, macuxi_worker;`);
      expect(up).toContain(`create policy manutencao on ${t} for all to macuxi_manutencao using (true) with check (true);`);
    }
    expect(up).not.toMatch(/references plataforma\.tenant/);
    expect(up).toContain('  empresa_id      uuid not null,\n');
    expect(up).toContain('create unique index backup_empresa_um_em_andamento_uk on plataforma.backup_empresa (empresa_id) where situacao = \'em_andamento\';');
    expect(up).toContain('create unique index exclusao_empresa_em_andamento_uk on plataforma.exclusao_empresa (empresa_id) where situacao = \'em_andamento\';');
    expect(up).toContain('create unique index empresa_excluida_codigo_uk on plataforma.empresa_excluida (lower(codigo));');
    expect(up).toContain('create unique index backup_empresa_parte_tabela_uk on plataforma.backup_empresa_parte (backup_id, tabela);');
    // nenhum grant de tabela; só EXECUTE de função
    expect([...up.matchAll(/\bgrant ([^;]+);/g)].map((x) => x[1]!).filter((g) => !g.startsWith('execute on function '))).toEqual([]);
  });

  it('listas fechadas do banco = contrato do SDK (motivos, situações e etapas)', () => {
    const lista = (re: RegExp) => [...(re.exec(up)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect(lista(/constraint tenant_motivo_inativacao_valido\s+check \(motivo_inativacao is null\s+or motivo_inativacao in \(([^)]+)\)\)/)).toEqual([...MOTIVOS_INATIVACAO]);
    expect(lista(/constraint backup_empresa_situacao_valida check \(situacao in \(([^)]+)\)\)/)).toEqual([...SITUACOES_BACKUP]);
    expect(lista(/constraint exclusao_empresa_situacao_valida check \(situacao in \(([^)]+)\)\)/)).toEqual([...SITUACOES_EXCLUSAO]);
    expect(lista(/constraint exclusao_empresa_etapa_valida check \(etapa in \(([^)]+)\)\)/)).toEqual([...ETAPAS_EXCLUSAO]);
    // a sa_inativar_tenant confere a mesma lista
    expect(lista(/p_motivo not in \(([^)]+)\) then/)).toEqual([...MOTIVOS_INATIVACAO]);
    expect(up).toContain("constraint tenant_inativacao_coerente\n  check ((status = 'ativo') = (inativada_em is null) and (status <> 'ativo' or motivo_inativacao is null));");
    // motivo opcional (ADR 0052 §1.1): nulo passa na sa_inativar_tenant e o gatilho não inventa motivo
    expect(up).toContain('  if p_motivo is not null\n     and p_motivo not in (');
    expect(up).not.toContain("motivo_inativacao := coalesce(");
  });

  it('prazos do SDK no banco: 7 dias para excluir, 30 de retenção, 90 depois da exclusão', () => {
    expect(PRAZO_BACKUP_PARA_EXCLUIR_DIAS).toBe(7);
    expect(bloco(up, 'create function plataforma.exclusao_bloqueada(')).toContain(`now() - v_b.concluido_em > interval '${PRAZO_BACKUP_PARA_EXCLUIR_DIAS} days'`);
    expect(bloco(up, 'create function plataforma.fechar_backup(')).toContain(`expira_em = v_agora + interval '${RETENCAO_BACKUP_EMPRESA_DIAS} days'`);
    expect(bloco(up, 'create function plataforma.fechar_exclusao(')).toContain(`set expira_em = v_agora + interval '${RETENCAO_BACKUP_EXCLUIDA_DIAS} days'`);
    expect(bloco(up, 'create function plataforma.executar_exclusao(')).toContain(`set expira_em = v_agora + interval '${RETENCAO_BACKUP_EXCLUIDA_DIAS} days'`);
  });

  it('exclusao_bloqueada: as recusas da conferirExclusao na mesma ordem', () => {
    const b = bloco(up, 'create function plataforma.exclusao_bloqueada(');
    const ordem = ['TENANT_NAO_ENCONTRADO', 'EXCLUSAO_EM_ANDAMENTO', 'EXCLUSAO_EMPRESA_ATIVA', 'EXCLUSAO_SEM_BACKUP', 'EXCLUSAO_BACKUP_ANTES_DA_INATIVACAO', 'EXCLUSAO_BACKUP_VENCIDO'];
    const pos = ordem.map((c) => b.indexOf(`return '${c}';`));
    expect(pos.every((p) => p > 0)).toBe(true);
    expect([...pos].sort((x, y) => x - y)).toEqual(pos);
  });

  it('funções: sa_* SECURITY DEFINER só ao portal (28000/42501); as do worker só ao worker, sem argumento de tenant; internas de ninguém', () => {
    for (const f of FUNCOES_SA_0072) {
      const b = bloco(up, `create function ${nomeDe(f)}(`);
      expect(b, f).toMatch(/language plpgsql volatile security definer\s+set search_path = pg_catalog, plataforma, pg_temp/);
      expect(b, f).toMatch(/if v_tipo is null then\s+raise exception '[^']+' using errcode = '28000';/);
      expect(b, f).toMatch(/if v_tipo is distinct from 'super_admin' or v_sa is null then\s+raise exception '[^']+' using errcode = '42501';/);
      expect(up).toContain(`revoke all on function ${f} from public, macuxi_app, macuxi_worker;`);
      expect(up).toContain(`grant execute on function ${f} to macuxi_portal;`);
    }
    expect(FUNCOES_SA_ATE_0072).toHaveLength(25);
    expect(up).toContain('if v_n <> 25 then');
    for (const f of FUNCOES_WORKER_0072) {
      const b = bloco(up, `create function ${nomeDe(f)}(`);
      expect(b, f).toMatch(/security definer\s+set search_path = pg_catalog, plataforma, pg_temp/);
      // o tenant sai da linha do job: nenhuma função do worker recebe tenant (a tenant_esta_ativo é a pergunta da política)
      if (f !== 'plataforma.tenant_esta_ativo(uuid)') expect(b.slice(0, b.indexOf(')')), f).not.toMatch(/tenant/);
      expect(up).toContain(`revoke all on function ${f} from public;`);
      expect(up).toContain(`grant execute on function ${f} to macuxi_worker;`);
    }
    for (const f of INTERNAS) {
      expect(up).toContain(`revoke all on function ${f} from public;`);
      expect(up).not.toContain(`grant execute on function ${f} `);
      expect(bloco(up, `create function ${nomeDe(f)}(`), f).toMatch(/security invoker/);
    }
  });

  it('sa_* com os códigos do contrato no hint (404/409/422) e auditoria sem dado pessoal', () => {
    for (const c of ['TENANT_NAO_ENCONTRADO', 'EXCLUSAO_EM_ANDAMENTO', 'BACKUP_EM_ANDAMENTO', 'EXCLUSAO_CODIGO_NAO_CONFERE']) expect(up).toContain(`hint = '${c}'`);
    expect(up).toContain("using errcode = '22023', hint = v_bloqueio;");
    const aud = up.split('\n').filter((l) => /sa_registrar_auditoria|jsonb_build_object\('(motivo|backup_id|exclusao_id)'/.test(l)).join('\n');
    expect(aud).not.toMatch(/nome|email|cnpj|documento|razao/);
  });

  it('despachante e e-mail: políticas do worker pela tenant_esta_ativo (eventos plataforma.tenant.* passam); down volta a using (true)', () => {
    expect(up).toContain("alter policy despacho_outbox on plataforma.evento\n  using (nome like 'plataforma.tenant.%' or plataforma.tenant_esta_ativo(tenant_id));");
    expect(up).toContain('alter policy despacho_email on plataforma.email_saida\n  using (plataforma.tenant_esta_ativo(tenant_id));');
    expect(down).toContain('alter policy despacho_outbox on plataforma.evento using (true);');
    expect(down).toContain('alter policy despacho_email on plataforma.email_saida using (true);');
  });

  it('RN-PLA-10: gatilho do código e sorteio sem código de empresa excluída; o down devolve o sorteio da 0068', () => {
    expect(up).toContain('create trigger tenant_codigo_nao_reaproveitado before insert or update of codigo on plataforma.tenant');
    expect(bloco(up, 'create function plataforma.tenant_codigo_nao_reaproveitado(')).toContain('x.id <> new.id');
    const sortear = bloco(up, 'create or replace function plataforma.sortear_codigo_licenca(p_uf text)');
    expect(sortear.match(/plataforma\.empresa_excluida/g)).toHaveLength(2);
    // o down tem o texto da 0068 (create or replace)
    const de68 = bloco(semComentarios(m68.up), 'create function plataforma.sortear_codigo_licenca(p_uf text)');
    const doDown = bloco(down, 'create or replace function plataforma.sortear_codigo_licenca(p_uf text)');
    expect(doDown.replace('create or replace function', 'create function').trim()).toBe(de68.trim());
  });

  it('down: apaga o que o up cria, tabelas filhas antes das mães, sem grant', () => {
    for (const f of [...FUNCOES_SA_0072, ...FUNCOES_WORKER_0072, ...INTERNAS]) expect(down, f).toContain(`drop function if exists ${f};`);
    const pos = ['plataforma.empresa_excluida', 'plataforma.exclusao_empresa', 'plataforma.backup_empresa_parte', 'plataforma.backup_empresa'].map((t) => down.indexOf(`drop table if exists ${t};`));
    expect(pos.every((p) => p > 0)).toBe(true);
    expect([...pos].sort((x, y) => x - y)).toEqual(pos);
    expect(down).toContain('alter table plataforma.tenant drop column if exists inativada_em;');
    expect(down).toContain('alter table plataforma.tenant drop column if exists motivo_inativacao;');
    expect(down).not.toMatch(/\bgrant\b/);
  });
});

describe.skipIf(semBanco())('0072 ações da empresa (banco, fixture dois-tenants)', () => {
  let admin: pg.Client;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
  });

  /** Roda como o papel dado dentro da transação aberta; um erro não aborta o caso. */
  async function como<T extends pg.QueryResultRow = Record<string, unknown>>(papel: string, sql: string, params: unknown[] = []) {
    await admin.query('savepoint como');
    try {
      await admin.query(`set local role ${papel}`);
      const r = await admin.query<T>(sql, params);
      await admin.query('reset role');
      await admin.query('release savepoint como');
      return r;
    } catch (e) {
      await admin.query('rollback to savepoint como');
      throw e;
    }
  }
  const q = async <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await admin.query<T>(sql, params)).rows;
  const portal = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await como<{ r: T }>('macuxi_portal', sql, params)).rows[0]!.r;
  const worker = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await como<{ r: T }>('macuxi_worker', sql, params)).rows[0]!.r;
  const abrir = async (p: unknown) => (await como<{ sessao_id: string }>('macuxi_portal', 'select * from plataforma.sa_abrir_sessao_portal($1::jsonb)', [JSON.stringify(p)])).rows[0]!;
  /** Comando do admin que deve falhar, num savepoint (o erro não aborta a transação do caso). */
  async function erroDoAdmin(sql: string, params: unknown[] = []) {
    await admin.query('savepoint erro');
    const e = await erroDe(admin.query(sql, params));
    await admin.query(e ? 'rollback to savepoint erro' : 'release savepoint erro');
    return e;
  }
  async function sessaoSuperAdmin() {
    const sa = (await q<{ r: { super_admin_id: string } }>('select plataforma.criar_super_admin($1::jsonb) as r', [JSON.stringify({ acao: 'criar', email: 'operador.acoes@macuxi.exemplo', nome: 'Operador 0072', senha_hash: HASH_TESTE })]))[0]!.r;
    return (await abrir({ tipo: 'super_admin', super_admin_id: sa.super_admin_id })).sessao_id;
  }
  /** SQLSTATE e hint do erro (o hint leva o código do contrato). */
  const falha = async (p: Promise<unknown>) => {
    try {
      await p;
      return null;
    } catch (e) {
      const x = e as { code?: string; hint?: string };
      return { code: x.code, hint: x.hint ?? null };
    }
  };
  const inativar = (sid: string | null, t: string, motivo: string | null = 'inadimplencia') => portal('select plataforma.sa_inativar_tenant($1, $2, $3) as r', [sid, t, motivo]);
  const reativar = (sid: string, t: string) => portal('select plataforma.sa_reativar_tenant($1, $2) as r', [sid, t]);
  const pedirBackup = (sid: string, t: string, b: string) => portal('select plataforma.sa_pedir_backup($1, $2, $3) as r', [sid, t, b]);
  const pedirExclusao = (sid: string, t: string, x: string, b: string, codigo: string) =>
    portal('select plataforma.sa_pedir_exclusao($1, $2, $3, $4, $5) as r', [sid, t, x, b, codigo]);

  /** O worker exporta o backup todo (páginas de `limite`), confirma as partes e devolve as linhas por tabela. */
  async function exportarTudo(backup: string, limite = 5000) {
    const tabelas = (await como<{ ordem: number; tabela: string; chave: string[]; adiar: string[] }>('macuxi_worker', 'select * from plataforma.tabelas_do_backup($1)', [backup])).rows;
    const linhas = new Map<string, Array<Record<string, unknown>>>();
    for (const t of tabelas) {
      const todas: Array<Record<string, unknown>> = [];
      let depois: unknown = null;
      for (;;) {
        const pagina = (await como<{ chave: unknown; linha: Record<string, unknown> }>('macuxi_worker', 'select * from plataforma.exportar_backup_pagina($1, $2, $3::jsonb, $4)', [backup, t.tabela, depois === null ? null : JSON.stringify(depois), limite])).rows;
        todas.push(...pagina.map((p) => p.linha));
        if (pagina.length < limite) break;
        depois = pagina.at(-1)!.chave;
      }
      linhas.set(t.tabela, todas);
      await worker('select plataforma.registrar_parte_backup($1, $2, $3, $4, $5) as r', [backup, t.tabela, todas.length, 10, SHA]);
    }
    return { tabelas, linhas };
  }

  it('acesso direto às 4 tabelas: 42501 para app, worker e portal; funções só pelo papel certo', async () => {
    await emTransacao(admin, null, async () => {
      for (const t of TABELAS) {
        for (const papel of ['macuxi_app', 'macuxi_worker', 'macuxi_portal']) {
          expect((await erroDe(como(papel, `select 1 from ${t} limit 1`)))?.code, `${papel} ${t}`).toBe('42501');
        }
      }
      const r = await q<{ f: string; app: boolean; worker: boolean; portal: boolean; definer: boolean }>(
        `select f, has_function_privilege('macuxi_app', f::regprocedure, 'execute') as app,
                has_function_privilege('macuxi_worker', f::regprocedure, 'execute') as worker,
                has_function_privilege('macuxi_portal', f::regprocedure, 'execute') as portal,
                (select p.prosecdef from pg_proc p where p.oid = f::regprocedure) as definer
           from unnest($1::text[]) f`,
        [[...FUNCOES_SA_0072, ...FUNCOES_WORKER_0072, ...INTERNAS]],
      );
      for (const x of r) {
        const sa = (FUNCOES_SA_0072 as readonly string[]).includes(x.f);
        const wk = (FUNCOES_WORKER_0072 as readonly string[]).includes(x.f);
        expect({ app: x.app, worker: x.worker, portal: x.portal, definer: x.definer }, x.f).toEqual({ app: false, worker: wk, portal: sa, definer: sa || wk });
      }
    });
  });

  it('RN-PLA-07 inativar e reativar: idempotentes, auditoria e eventos na outbox; erros do contrato', async () => {
    await emTransacao(admin, null, async () => {
      for (const papel of ['macuxi_app', 'macuxi_worker']) {
        expect((await erroDe(como(papel, 'select plataforma.sa_inativar_tenant(null, null, null)')))?.code, papel).toBe('42501');
      }
      expect((await falha(inativar(null, A)))?.code).toBe('28000');
      const cli = await abrir({ tipo: 'admin_cliente', empresas: [{ tenant_id: A, usuario_id: ADMIN_A }] });
      expect((await falha(inativar(cli.sessao_id, A)))?.code).toBe('42501');
      const sid = await sessaoSuperAdmin();
      expect(await falha(inativar(sid, A, 'qualquer'))).toEqual({ code: '22023', hint: null });
      expect(await falha(inativar(sid, id(999)))).toEqual({ code: 'P0002', hint: 'TENANT_NAO_ENCONTRADO' });

      const r1 = SituacaoEmpresaRespostaSchema.parse(await inativar(sid, A));
      expect(r1).toMatchObject({ tenant_id: A, status: 'suspenso', motivo: 'inadimplencia', resultado: 'alterado' });
      expect(SituacaoEmpresaRespostaSchema.parse(await inativar(sid, A, 'outro'))).toEqual({ ...r1, resultado: 'sem_mudanca' });
      expect(await q('select status, motivo_inativacao from plataforma.tenant where id = $1', [A])).toEqual([{ status: 'suspenso', motivo_inativacao: 'inadimplencia' }]);
      const ev = await q<{ nome: string; payload: unknown }>("select nome, payload from plataforma.evento where tenant_id = $1 and nome like 'plataforma.tenant.%'", [A]);
      expect(ev.map((e) => e.nome)).toEqual([EVENTO_TENANT_INATIVADO.nome]);
      expect(EVENTO_TENANT_INATIVADO.schema.parse(ev[0]!.payload)).toMatchObject({ tenant_id: A, motivo: 'inadimplencia' });

      const r2 = SituacaoEmpresaRespostaSchema.parse(await reativar(sid, A));
      expect(r2).toEqual({ tenant_id: A, status: 'ativo', inativada_em: null, motivo: null, resultado: 'alterado' });
      expect(SituacaoEmpresaRespostaSchema.parse(await reativar(sid, A)).resultado).toBe('sem_mudanca');
      const ev2 = await q<{ payload: unknown }>('select payload from plataforma.evento where tenant_id = $1 and nome = $2', [A, EVENTO_TENANT_REATIVADO.nome]);
      expect(EVENTO_TENANT_REATIVADO.schema.parse(ev2[0]!.payload)).toMatchObject({ tenant_id: A, inativa_desde: r1.inativada_em });
      const aud = await q<{ acao: string; detalhes: Record<string, unknown> }>("select acao, detalhes from plataforma.auditoria_plataforma where sessao_id = $1 and acao like 'tenant.%' order by ocorrido_em, acao", [sid]);
      expect(aud.map((x) => x.acao).sort()).toEqual(['tenant.inativado', 'tenant.reativado']);
      expect(aud.find((x) => x.acao === 'tenant.inativado')!.detalhes).toEqual({ motivo: 'inadimplencia', antes: 'ativo', depois: 'suspenso', origem: 'banco' });

      // quem ainda muda o status direto não quebra o CHECK: o gatilho preenche a data, sem motivo (e limpa ao voltar a ativo)
      await q("update plataforma.tenant set status = 'suspenso' where id = $1", [B]);
      expect(await q('select inativada_em is not null as tem, motivo_inativacao from plataforma.tenant where id = $1', [B])).toEqual([{ tem: true, motivo_inativacao: null }]);
      await q("update plataforma.tenant set status = 'ativo' where id = $1", [B]);
      expect(await q('select inativada_em, motivo_inativacao from plataforma.tenant where id = $1', [B])).toEqual([{ inativada_em: null, motivo_inativacao: null }]);

      // motivo opcional (a tela envia {}): nulo na empresa, na resposta, no evento e na auditoria
      const r3 = SituacaoEmpresaRespostaSchema.parse(await inativar(sid, B, null));
      expect(r3).toMatchObject({ tenant_id: B, status: 'suspenso', motivo: null, resultado: 'alterado' });
      expect(await q('select status, motivo_inativacao from plataforma.tenant where id = $1', [B])).toEqual([{ status: 'suspenso', motivo_inativacao: null }]);
      const ev3 = await q<{ payload: unknown }>('select payload from plataforma.evento where tenant_id = $1 and nome = $2', [B, EVENTO_TENANT_INATIVADO.nome]);
      expect(EVENTO_TENANT_INATIVADO.schema.parse(ev3[0]!.payload)).toMatchObject({ tenant_id: B, motivo: null });
      const aud3 = await q<{ detalhes: Record<string, unknown> }>("select detalhes from plataforma.auditoria_plataforma where sessao_id = $1 and acao = 'tenant.inativado' and tenant_alvo_id = $2", [sid, B]);
      expect(aud3).toHaveLength(1);
      expect(aud3[0]!.detalhes).toMatchObject({ antes: 'ativo', depois: 'suspenso' });
      expect(aud3[0]!.detalhes.motivo ?? null).toBeNull();
      expect(SituacaoEmpresaRespostaSchema.parse(await reativar(sid, B)).resultado).toBe('alterado');
    });
  });

  it('RN-PLA-07 despachante e e-mail: o worker não vê o evento nem o e-mail da empresa inativa (os plataforma.tenant.* sim)', async () => {
    await emTransacao(admin, null, async () => {
      const sid = await sessaoSuperAdmin();
      const ev = (await q<{ id: string }>("insert into plataforma.evento (tenant_id, nome, modulo, payload) values ($1, 'core.teste.criado@1', 'core', '{}') returning id", [A]))[0]!.id;
      const visiveis = async () => (await como<{ id: string }>('macuxi_worker', 'select id from plataforma.evento where tenant_id = $1 and publicado_em is null', [A])).rows.map((x) => x.id);
      expect(await visiveis()).toContain(ev);
      await inativar(sid, A);
      const inativo = await visiveis();
      expect(inativo).not.toContain(ev);
      expect(inativo).toHaveLength(1); // só o plataforma.tenant.inativado@1
      expect((await como('macuxi_worker', 'select 1 from plataforma.email_saida where tenant_id = $1', [A])).rowCount).toBe(0);
      expect((await como('macuxi_worker', 'select 1 from plataforma.evento where tenant_id = $1', [B])).rowCount).toBe(
        (await q('select 1 from plataforma.evento where tenant_id = $1', [B])).length,
      );
      await reativar(sid, A);
      expect(await visiveis()).toContain(ev);
      const pol = await q<{ policyname: string; qual: string }>("select policyname, qual from pg_policies where policyname in ('despacho_outbox', 'despacho_email') order by 1");
      expect(pol.map((p) => [p.policyname, p.qual.includes('tenant_esta_ativo(tenant_id)')])).toEqual([['despacho_email', true], ['despacho_outbox', true]]);
    });
  });

  it('backup → exclusão: ordem de FK, só o tenant do backup, contagem igual por tabela, registro que sobrevive e código não reaproveitado', async () => {
    await emTransacao(admin, null, async () => {
      const sid = await sessaoSuperAdmin();
      const codigoA = (await q<{ codigo: string }>('select codigo from plataforma.tenant where id = $1', [A]))[0]!.codigo;
      await inativar(sid, A, 'pedido_do_cliente');
      const pedido = BackupEmpresaSchema.parse(await pedirBackup(sid, A, id(1)));
      expect(pedido).toMatchObject({ id: id(1), tenant_id: A, situacao: 'em_andamento', consistente: true, progresso_pct: 0 });
      expect(BackupEmpresaSchema.parse(await pedirBackup(sid, A, id(1)))).toEqual(pedido);
      expect(await falha(pedirBackup(sid, A, id(2)))).toEqual({ code: '55000', hint: 'BACKUP_EM_ANDAMENTO' });
      expect((await falha(pedirBackup(sid, B, id(1))))?.code).toBe('23505');
      expect(await falha(pedirExclusao(sid, A, id(50), id(1), codigoA))).toEqual({ code: '22023', hint: 'EXCLUSAO_SEM_BACKUP' });

      // worker: pega, lista em ordem de FK e exporta (páginas de 2 numa tabela grande, para o keyset)
      const pego = await worker<Record<string, unknown>>('select plataforma.pegar_backup() as r');
      expect(pego).toMatchObject({ id: id(1), codigo: codigoA, partes: [] });
      expect(await worker('select plataforma.pegar_backup() as r')).toBeNull(); // concessão viva
      const { tabelas, linhas } = await exportarTudo(id(1));
      expect(tabelas[0]).toEqual({ ordem: 1, tabela: 'plataforma.tenant', chave: ['id'], adiar: [] });
      const comTenant = (await tabelasComTenant(admin)).map((t) => t.nome);
      expect(tabelas.slice(1).map((t) => t.tabela).sort()).toEqual([...comTenant].sort());
      for (const t of tabelas) expect(t.chave.length, t.tabela).toBeGreaterThan(0);
      const posicao = new Map(tabelas.map((t) => [t.tabela, t.ordem]));
      const adiadas = new Map(tabelas.map((t) => [t.tabela, new Set(t.adiar)]));
      const fks = await q<{ filha: string; mae: string; cols: string[] }>(
        `select con.conrelid::regclass::text as filha, con.confrelid::regclass::text as mae,
                array(select a.attname::text from unnest(con.conkey) k(n) join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n where a.attname <> 'tenant_id') as cols
           from pg_constraint con where con.contype = 'f' and con.conparentid = 0`,
      );
      const qualificado = (n: string) => (n.includes('.') ? n : `plataforma.${n}`);
      for (const fk of fks) {
        const filha = qualificado(fk.filha);
        const mae = qualificado(fk.mae);
        if (!posicao.has(filha) || !posicao.has(mae) || filha === mae) continue;
        // mãe antes da filha, salvo a FK adiada (ciclo quebrado: as colunas dela ficam para o fim da restauração)
        if (fk.cols.length === 0 || !fk.cols.every((c) => adiadas.get(filha)!.has(c))) expect(posicao.get(mae)!, `${filha} -> ${mae}`).toBeLessThan(posicao.get(filha)!);
      }
      // só o tenant do backup
      for (const [t, ls] of linhas) for (const l of ls) expect(t === 'plataforma.tenant' ? l.id : l.tenant_id, t).toBe(A);
      const contagemB = Number((await q<{ n: string }>('select count(*) as n from core.cliente where tenant_id = $1', [A]))[0]!.n);
      expect(linhas.get('core.cliente')!.length).toBe(contagemB);
      const paginado = (await (async () => {
        const todas: string[] = [];
        let depois: unknown = null;
        for (;;) {
          const p = (await como<{ chave: unknown; linha: { id: string } }>('macuxi_worker', 'select * from plataforma.exportar_backup_pagina($1, $2, $3::jsonb, 2)', [id(1), 'core.cliente', depois === null ? null : JSON.stringify(depois)])).rows;
          todas.push(...p.map((x) => x.linha.id));
          if (p.length < 2) return todas;
          depois = p.at(-1)!.chave;
        }
      })());
      expect(paginado).toEqual(linhas.get('core.cliente')!.map((l) => l.id));
      expect((await erroDe(como('macuxi_worker', 'select * from plataforma.exportar_backup_pagina($1, $2, null, 10)', [id(1), 'plataforma.super_admin'])))?.code).toBe('22023');
      expect((await erroDe(como('macuxi_worker', 'select * from plataforma.exportar_backup_pagina($1, $2, null, 10)', [id(9), 'core.cliente'])))?.code).toBe('P0002');

      const pronto = BackupEmpresaSchema.parse(await worker('select plataforma.fechar_backup($1, $2::jsonb) as r', [id(1), JSON.stringify({ situacao: 'pronto', tamanho_bytes: 1234, arquivos: 3 })]));
      expect(pronto).toMatchObject({ situacao: 'pronto', consistente: true, progresso_pct: 100, tamanho_bytes: 1234, arquivos: 3, tabelas: tabelas.length });
      expect(pronto.linhas).toBe([...linhas.values()].reduce((s, ls) => s + ls.length, 0));
      expect(BackupEmpresaSchema.parse(await worker('select plataforma.fechar_backup($1, $2::jsonb) as r', [id(1), JSON.stringify({ situacao: 'pronto', tamanho_bytes: 1234, arquivos: 3 })]))).toEqual(pronto);
      const concl = await q<{ payload: unknown }>('select payload from plataforma.evento where tenant_id = $1 and nome = $2', [A, EVENTO_TENANT_BACKUP_CONCLUIDO.nome]);
      expect(EVENTO_TENANT_BACKUP_CONCLUIDO.schema.parse(concl[0]!.payload)).toMatchObject({ backup_id: id(1), consistente: true });
      expect(ListaBackupsEmpresaSchema.parse(await portal('select plataforma.sa_listar_backups($1, $2, null) as r', [sid, A])).itens.map((b) => b.id)).toEqual([id(1)]);

      // exclusão: código errado, depois o certo (sem diferença de maiúsculas); idempotente; nada mais vale com ela em andamento
      expect(await falha(pedirExclusao(sid, A, id(50), id(1), 'outro-codigo'))).toEqual({ code: '22023', hint: 'EXCLUSAO_CODIGO_NAO_CONFERE' });
      const exclusao = ExclusaoEmpresaSchema.parse(await pedirExclusao(sid, A, id(50), id(1), ` ${codigoA.toUpperCase()} `));
      expect(exclusao).toMatchObject({ id: id(50), tenant_id: A, codigo: codigoA, backup_id: id(1), situacao: 'em_andamento', etapa: 'banco' });
      expect(ExclusaoEmpresaSchema.parse(await pedirExclusao(sid, A, id(50), id(1), codigoA))).toEqual(exclusao);
      expect(await falha(reativar(sid, A))).toEqual({ code: '55000', hint: 'EXCLUSAO_EM_ANDAMENTO' });
      expect(await falha(pedirBackup(sid, A, id(3)))).toEqual({ code: '55000', hint: 'EXCLUSAO_EM_ANDAMENTO' });
      const acoes = (await portal<{ itens: Array<Record<string, unknown>> }>('select plataforma.sa_acoes_das_empresas($1) as r', [sid])).itens;
      const deA = acoes.find((x) => x.tenant_id === A)!;
      const semId = Object.fromEntries(Object.entries(deA).filter(([k]) => k !== 'tenant_id'));
      expect(AcoesDaEmpresaSchema.parse(semId)).toMatchObject({ motivo_inativacao: 'pedido_do_cliente', exclusao_bloqueada: 'EXCLUSAO_EM_ANDAMENTO' });
      const deB = acoes.find((x) => x.tenant_id === B)!;
      expect(deB).toMatchObject({ inativada_em: null, ultimo_backup: null, exclusao: null, exclusao_bloqueada: 'EXCLUSAO_EMPRESA_ATIVA' });

      // worker: etapa banco (excluir_tenant) e arquivos
      expect(await worker('select plataforma.pegar_exclusao() as r')).toMatchObject({ id: id(50), etapa: 'banco' });
      const banco1 = ExclusaoEmpresaSchema.parse(await worker('select plataforma.executar_exclusao($1) as r', [id(50)]));
      expect(banco1).toMatchObject({ situacao: 'em_andamento', etapa: 'arquivos' });
      expect(ExclusaoEmpresaSchema.parse(await worker('select plataforma.executar_exclusao($1) as r', [id(50)]))).toEqual(banco1);
      expect(await q('select 1 from plataforma.tenant where id = $1', [A])).toEqual([]);
      // o que a exclusão apagou = o que o backup exportou, tabela a tabela (a outbox tem 1 a mais: o backup_concluido@1)
      const contagem = (await q<{ contagem: Record<string, number> }>('select contagem from plataforma.exclusao_empresa where id = $1', [id(50)]))[0]!.contagem;
      const exportado = Object.fromEntries([...linhas].filter(([, ls]) => ls.length > 0).map(([t, ls]) => [t, ls.length]));
      exportado['plataforma.evento'] = (exportado['plataforma.evento'] ?? 0) + 1;
      expect(contagem).toEqual(exportado);
      expect(banco1.linhas_apagadas).toBe(Object.values(exportado).reduce((s, n) => s + n, 0));
      expect(await q('select id, codigo, backup_id, exclusao_id from plataforma.empresa_excluida where id = $1', [A])).toEqual([{ id: A, codigo: codigoA, backup_id: id(1), exclusao_id: id(50) }]);
      expect(await falha(worker('select plataforma.fechar_exclusao($1, $2::jsonb) as r', [id(50), JSON.stringify({ situacao: 'falhou', erro_codigo: 'S3_FALHOU' })]))).toEqual({ code: '55000', hint: null });
      const fim = ExclusaoEmpresaSchema.parse(await worker('select plataforma.fechar_exclusao($1, $2::jsonb) as r', [id(50), JSON.stringify({ situacao: 'concluida', arquivos_apagados: 3 })]));
      expect(fim).toMatchObject({ situacao: 'concluida', etapa: 'fim', arquivos_apagados: 3 });
      expect(await q<{ dias: number }>('select round(extract(epoch from expira_em - now()) / 86400)::int as dias from plataforma.backup_empresa where id = $1', [id(1)])).toEqual([{ dias: RETENCAO_BACKUP_EXCLUIDA_DIAS }]);
      // o registro sobrevive: o portal ainda lê a exclusão e os backups da empresa excluída
      expect(ExclusaoEmpresaSchema.parse(await portal('select plataforma.sa_ler_exclusao($1, $2) as r', [sid, A]))).toEqual(fim);
      expect(ListaBackupsEmpresaSchema.parse(await portal('select plataforma.sa_listar_backups($1, $2, $3) as r', [sid, A, id(1)])).itens).toHaveLength(1);
      const auditadas = await q<{ acao: string; detalhes: Record<string, unknown> }>("select acao, detalhes from plataforma.auditoria_plataforma where tenant_alvo_id = $1 and acao = 'tenant.excluido'", [A]);
      expect(auditadas).toHaveLength(1);

      // RN-PLA-10: o código não volta para outra empresa; a restauração (mesmo id) pode
      expect((await erroDoAdmin('insert into plataforma.tenant (codigo, nome) values ($1, $2)', [codigoA, 'Outra']))?.code).toBe('23505');
      expect((await erroDoAdmin('update plataforma.tenant set codigo = $1 where id = $2', [codigoA.toUpperCase(), B]))?.code).toBe('23505');
      await q('savepoint restaurar');
      await q('insert into plataforma.tenant (id, codigo, nome) values ($1, $2, $3)', [A, codigoA, 'Restaurada']);
      await q('rollback to savepoint restaurar');
    });
  });

  it('RN-PLA-08/09: backup com a empresa ativa, reativada no meio, vencido ou falho não libera a exclusão', async () => {
    await emTransacao(admin, null, async () => {
      const sid = await sessaoSuperAdmin();
      const codigoB = (await q<{ codigo: string }>('select codigo from plataforma.tenant where id = $1', [B]))[0]!.codigo;
      const fechar = async (b: string) => {
        await exportarTudo(b);
        return BackupEmpresaSchema.parse(await worker('select plataforma.fechar_backup($1, $2::jsonb) as r', [b, JSON.stringify({ situacao: 'pronto', tamanho_bytes: 1, arquivos: 0 })]));
      };
      // pedido com a empresa ativa: sai inconsistente
      expect(BackupEmpresaSchema.parse(await pedirBackup(sid, B, id(11))).consistente).toBe(false);
      await worker('select plataforma.pegar_backup() as r');
      expect((await fechar(id(11))).consistente).toBe(false);
      expect(await falha(pedirExclusao(sid, B, id(60), id(11), codigoB))).toEqual({ code: '22023', hint: 'EXCLUSAO_EMPRESA_ATIVA' });
      await inativar(sid, B);
      expect(await falha(pedirExclusao(sid, B, id(60), id(11), codigoB))).toEqual({ code: '22023', hint: 'EXCLUSAO_BACKUP_ANTES_DA_INATIVACAO' });
      // reativada durante o backup: inconsistente
      await pedirBackup(sid, B, id(12));
      await worker('select plataforma.pegar_backup() as r');
      await reativar(sid, B);
      await inativar(sid, B);
      expect((await fechar(id(12))).consistente).toBe(false);
      // inativa do início ao fim: consistente; depois de 7 dias, vencido
      await pedirBackup(sid, B, id(13));
      await worker('select plataforma.pegar_backup() as r');
      expect((await fechar(id(13))).consistente).toBe(true);
      await q(`update plataforma.backup_empresa set concluido_em = now() - interval '${PRAZO_BACKUP_PARA_EXCLUIR_DIAS + 1} days' where id = $1`, [id(13)]);
      expect(await falha(pedirExclusao(sid, B, id(60), id(13), codigoB))).toEqual({ code: '22023', hint: 'EXCLUSAO_BACKUP_VENCIDO' });
      // falhou: código técnico, evento e não libera
      await pedirBackup(sid, B, id(14));
      await worker('select plataforma.pegar_backup() as r');
      const falhou = BackupEmpresaSchema.parse(await worker('select plataforma.fechar_backup($1, $2::jsonb) as r', [id(14), JSON.stringify({ situacao: 'falhou', erro_codigo: 'S3_FALHOU' })]));
      expect(falhou).toMatchObject({ situacao: 'falhou', erro_codigo: 'S3_FALHOU' });
      expect(await falha(pedirExclusao(sid, B, id(60), id(14), codigoB))).toEqual({ code: '22023', hint: 'EXCLUSAO_SEM_BACKUP' });
      // backup de outra empresa não serve
      expect(await falha(pedirExclusao(sid, A, id(61), id(13), DOIS_TENANTS.A.codigo))).toEqual({ code: '22023', hint: 'EXCLUSAO_EMPRESA_ATIVA' });
      // fechar sem todas as partes: 55000 BACKUP_INCOMPLETO
      await pedirBackup(sid, B, id(15));
      await worker('select plataforma.pegar_backup() as r');
      expect(await falha(worker('select plataforma.fechar_backup($1, $2::jsonb) as r', [id(15), JSON.stringify({ situacao: 'pronto', tamanho_bytes: 1, arquivos: 0 })]))).toEqual({ code: '55000', hint: 'BACKUP_INCOMPLETO' });
      // retenção (RN-PLA-11): o falho e os prontos mais velhos vencem; o pronto mais novo (o 12: mesma hora do 11, id maior) fica
      await q("update plataforma.backup_empresa set expira_em = now() - interval '1 day' where id = any ($1::uuid[])", [[id(11), id(12), id(13), id(14)]]);
      const vencidos = (await como<{ backup_id: string }>('macuxi_worker', 'select backup_id from plataforma.backups_vencidos(100)')).rows.map((x) => x.backup_id).filter((x) => x.startsWith('00720000'));
      expect(vencidos.sort()).toEqual([id(11), id(13), id(14)]);
      expect(await worker('select plataforma.marcar_backup_apagado($1) as r', [id(14)])).toMatchObject({ situacao: 'apagado', erro_codigo: null });
      expect(await worker('select plataforma.marcar_backup_apagado($1) as r', [id(14)])).toMatchObject({ situacao: 'apagado' });
      expect((await falha(worker('select plataforma.marcar_backup_apagado($1) as r', [id(12)])))?.code).toBe('55000');
    });
  });
});

describe.skipIf(semBanco())('0072 up/down (banco efêmero)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('a 0072 só acrescenta (e troca o corpo da sortear_codigo_licenca e o USING de 2 políticas); o down volta exatamente', async () => {
    await comAdmin(b.nome, async (c) => {
      const sortear = async () =>
        (await c.query<{ def: string; acl: string | null }>("select pg_get_functiondef('plataforma.sortear_codigo_licenca(text)'::regprocedure) as def, proacl::text as acl from pg_proc where oid = 'plataforma.sortear_codigo_licenca(text)'::regprocedure")).rows[0]!;
      await migrarUp(c, { ate: '0071' });
      const antes = await retratoDoCatalogo(c);
      const sortear71 = await sortear();
      expect((await migrarUp(c, { ate: '0072' })).aplicadas).toEqual(['0072_plataforma_empresa_acoes']);
      const depois = await retratoDoCatalogo(c);
      const sumiram = antes.filter((l) => !depois.includes(l));
      expect(sumiram.every((l) => l.startsWith('pol plataforma.evento.despacho_outbox ') || l.startsWith('pol plataforma.email_saida.despacho_email '))).toBe(true);
      expect(sumiram).toHaveLength(2);
      const novos = depois.filter((l) => !antes.includes(l));
      expect(novos.filter((l) => l.startsWith('rel ') && l.endsWith(' r rls=true force=true')).sort()).toEqual(TABELAS.map((t) => `rel ${t} r rls=true force=true`).sort());
      expect(novos.filter((l) => l.startsWith('col plataforma.tenant.')).sort()).toEqual(['col plataforma.tenant.inativada_em timestamp with time zone nn=false', 'col plataforma.tenant.motivo_inativacao text nn=false']);
      expect((await sortear()).acl).toBe(sortear71.acl);
      expect((await sortear()).def).toContain('plataforma.empresa_excluida');
      expect((await c.query<{ n: number }>("select count(*)::int as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'plataforma' and p.proname like 'sa\\_%' and has_function_privilege('macuxi_portal', p.oid, 'execute')")).rows).toEqual([{ n: 25 }]);

      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0072_plataforma_empresa_acoes']);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      expect(await sortear()).toEqual(sortear71);
      await c.query(m72.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: '0072' });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
