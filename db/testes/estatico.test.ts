/**
 * Testes estáticos do banco — rodam SEMPRE (sem Postgres): conferem as migrações SQL, os schemas
 * Drizzle, a fixture dois-tenants e o seed da Fase M contra as regras (CLAUDE.md regra 5, RN-CORE-05).
 */
import * as crypto from 'node:crypto';
import { PERFIS } from '@macuxi/platform-sdk';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as nuvemCore from '../../modules/core/db/nuvem';
import * as esquemaPlataforma from '../esquema/plataforma';
import { dadosFaseM, TENANT_FASE_M } from '../seeds/fase-m/fase-m';
import { dadosDoisTenants, DOIS_TENANTS, ORDEM_TABELAS } from '../seeds/fixtures/dois-tenants';
import { TABELAS_FORA_DO_SYNC, TABELAS_SEM_TENANT_ID } from '../src/excecoes';
import { idDeterministico, idFixo } from '../src/ids';
import { lerMigracoes } from '../src/migrador';
import { hashSenha, verificarSenha } from '../src/senha';

const COMUNS = ['id', 'created_at', 'updated_at', 'deleted_at', 'external_id'];
const migracoes = lerMigracoes();
const sqlUp = migracoes.map((m) => m.up).join('\n');

/** Blocos `create table x.y ( ... );` das migrações up, mais as colunas de `alter table x.y add column` posteriores. */
function tabelasCriadas(): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const m of /create table ([a-z_]+\.[a-z_]+) \(([\s\S]*?)\n\);/g[Symbol.matchAll](sqlUp)) mapa.set(m[1]!, m[2]!);
  for (const m of /^alter table ([a-z_]+\.[a-z_]+) add column ([a-z_]+) ([a-z][^;]*);/gm[Symbol.matchAll](sqlUp)) {
    mapa.set(m[1]!, `${mapa.get(m[1]!) ?? ''}\n  ${m[2]!} ${m[3]!}`);
  }
  return mapa;
}

function tabelasDrizzle(): Map<string, ReturnType<typeof getTableConfig>> {
  const mapa = new Map<string, ReturnType<typeof getTableConfig>>();
  for (const v of [...Object.values(esquemaPlataforma), ...Object.values(nuvemCore)]) {
    if (v instanceof PgTable) {
      const cfg = getTableConfig(v);
      mapa.set(`${cfg.schema}.${cfg.name}`, cfg);
    }
  }
  return mapa;
}

const escapar = (s: string) => s.replace(/\./g, '\\.');

describe('migrações (estático)', () => {
  it('toda migração tem up e down, numeração contínua', () => {
    expect(migracoes.map((m) => `${m.versao}_${m.nome}`)).toEqual(['0001_plataforma', '0002_core', '0003_plataforma_worker', '0004_core_sessao']);
  });

  it('down de cada migração remove os schemas que o up cria', () => {
    for (const m of migracoes) {
      for (const [, schema] of m.up.matchAll(/^create schema ([a-z_]+);/gm)) {
        expect(m.down, `${m.versao} deveria remover o schema ${schema}`).toMatch(new RegExp(`drop schema if exists ${schema} cascade`));
      }
    }
  });

  const criadas = tabelasCriadas();
  it('cria as tabelas pedidas na T-0002 (plataforma + core com produto, ADR-0005) e na T-0003 F2 (sessao, dispositivo)', () => {
    expect([...criadas.keys()].sort()).toEqual(
      [
        'plataforma.tenant', 'plataforma.tenant_modulo', 'plataforma.perfil_modulo', 'plataforma.usuario_modulo',
        'plataforma.evento', 'plataforma.evento_consumo', 'plataforma.parametro', 'plataforma.auditoria',
        'core.usuario', 'core.equipe', 'core.produto', 'core.cliente', 'core.carteira', 'core.sessao', 'core.dispositivo',
      ].sort(),
    );
  });

  for (const [tabela, corpo] of criadas) {
    it(`S0-023 ${tabela}: campos comuns, RLS ligado e forçado, política, grant e índice de sync`, () => {
      for (const col of COMUNS) expect(corpo, `${tabela}.${col}`).toMatch(new RegExp(`^\\s+${col}\\s`, 'm'));
      expect(corpo).toMatch(/^\s+id\s+uuid primary key/m);
      if (!(tabela in TABELAS_SEM_TENANT_ID)) {
        expect(corpo).toMatch(/^\s+tenant_id\s+uuid not null references plataforma\.tenant \(id\)/m);
        expect(sqlUp).toMatch(new RegExp(`create policy isolamento_tenant on ${escapar(tabela)} for all to macuxi_app\\s+using \\(tenant_id = plataforma\\.tenant_atual\\(\\)\\)\\s+with check \\(tenant_id = plataforma\\.tenant_atual\\(\\)\\)`));
      } else {
        expect(sqlUp).toMatch(new RegExp(`create policy isolamento_tenant on ${escapar(tabela)} for all to macuxi_app`));
      }
      expect(sqlUp).toContain(`alter table ${tabela} enable row level security;`);
      expect(sqlUp).toContain(`alter table ${tabela} force row level security;`);
      expect(sqlUp).toMatch(new RegExp(`grant [a-z, ]+ on ${escapar(tabela)} to macuxi_app;`));
      const foraDoSync = (TABELAS_FORA_DO_SYNC as readonly string[]).includes(tabela) || tabela in TABELAS_SEM_TENANT_ID;
      if (!foraDoSync) expect(sqlUp).toMatch(new RegExp(`on ${escapar(tabela)} \\(tenant_id, updated_at, id\\)`));
    });
  }

  it('auditoria: aplicação só lê e insere (RN-AUD-01)', () => {
    expect(sqlUp).toContain('grant select, insert on plataforma.auditoria to macuxi_app;');
  });

  it('contexto de tenant falha fechado: tenant_atual() devolve NULL sem app.tenant_id', () => {
    expect(sqlUp).toContain("nullif(current_setting('app.tenant_id', true), '')::uuid");
    const semComentarios = sqlUp.replace(/--.*$/gm, '');
    expect(semComentarios.match(/(?<!no)bypassrls/gi)).toBeNull();
    expect(sqlUp).toMatch(/create role macuxi_app nologin nosuperuser nobypassrls/);
  });
});

describe('0003 macuxi_worker (estático, ADR 0007)', () => {
  const m = migracoes.find((x) => x.versao === '0003')!;
  const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');

  it('papel sem BYPASSRLS e políticas despacho_outbox só para macuxi_worker', () => {
    expect(m.up).toMatch(/create role macuxi_worker nologin nosuperuser nobypassrls nocreatedb nocreaterole noreplication;/);
    expect(m.up).toMatch(/create policy despacho_outbox on plataforma\.evento for select to macuxi_worker\s+using \(true\);/);
    expect(m.up).toMatch(/create policy despacho_outbox_marcar on plataforma\.evento for update to macuxi_worker\s+using \(true\) with check \(true\);/);
  });

  it('grants do worker: só usage em plataforma e colunas de plataforma.evento', () => {
    const grants = [...semComentarios(sqlUp).matchAll(/grant ([^;]*?) to macuxi_worker;/g)].map((g) => g[1]!.replace(/\s+/g, ' '));
    expect(grants).toEqual([
      'usage on schema plataforma',
      'select (id, tenant_id, nome, modulo, agregado_id, payload, ocorrido_em, publicado_em, tentativas, usuario_id, request_id) on plataforma.evento',
      'update (publicado_em, tentativas, ultimo_erro) on plataforma.evento',
    ]);
  });

  it('carteira_usuario_sync_ix sem filtro de deleted_at (o pull devolve removidos)', () => {
    expect(m.up).toMatch(/create index carteira_usuario_sync_ix on core\.carteira \(tenant_id, usuario_id, updated_at, id\);/);
  });

  it('down desfaz tudo o que o up cria', () => {
    for (const trecho of [
      'drop index if exists core.carteira_usuario_sync_ix;',
      'drop table if exists plataforma.evento_consumo;',
      'drop policy if exists despacho_outbox_marcar on plataforma.evento;',
      'drop policy if exists despacho_outbox on plataforma.evento;',
      'revoke all on plataforma.evento from macuxi_worker;',
      'drop index if exists plataforma.evento_tenant_id_uk;',
      'alter table plataforma.evento drop column if exists request_id;',
      'alter table plataforma.evento drop column if exists usuario_id;',
      'revoke usage on schema plataforma from macuxi_worker;',
    ]) expect(m.down).toContain(trecho);
  });
});

describe('0004 core.sessao / core.dispositivo / tentativas (estático, T-0003 F2)', () => {
  const m = migracoes.find((x) => x.versao === '0004')!;
  const criadas = tabelasCriadas();

  it('core.usuario ganha tentativas_falhas (not null default 0, >= 0) e bloqueio_ate', () => {
    expect(m.up).toContain('alter table core.usuario add column tentativas_falhas smallint not null default 0;');
    expect(m.up).toContain('alter table core.usuario add column bloqueio_ate timestamptz;');
    expect(m.up).toContain('check (tentativas_falhas >= 0)');
  });

  it('FKs compostas por tenant (usuário e aparelho do MESMO tenant) e hash sha256 hex', () => {
    expect(criadas.get('core.dispositivo')).toContain('foreign key (tenant_id, usuario_id) references core.usuario (tenant_id, id)');
    expect(criadas.get('core.sessao')).toContain('foreign key (tenant_id, usuario_id) references core.usuario (tenant_id, id)');
    expect(criadas.get('core.sessao')).toContain('foreign key (tenant_id, dispositivo_id) references core.dispositivo (tenant_id, id)');
    expect(criadas.get('core.sessao')).toContain("check (token_hash ~ '^[0-9a-f]{64}$')");
  });

  it('índices das consultas do repositório do Core (modules/core/api/repositorio.ts)', () => {
    for (const idx of [
      'create unique index sessao_token_uk on core.sessao (tenant_id, token_hash);',
      'create index sessao_usuario_ativa_ix on core.sessao (tenant_id, usuario_id) where revogado_em is null;',
      'create index sessao_familia_ix on core.sessao (tenant_id, familia_id);',
      'create index dispositivo_usuario_ix on core.dispositivo (tenant_id, usuario_id);',
      'create index equipe_responsavel_ix on core.equipe (tenant_id, responsavel_id);',
    ]) expect(m.up).toContain(idx);
  });

  it('sessao e dispositivo ficam fora do sync (nunca vão ao aparelho)', () => {
    expect(TABELAS_FORA_DO_SYNC).toEqual(expect.arrayContaining(['core.sessao', 'core.dispositivo']));
  });

  it('down desfaz tudo o que o up cria (sessao antes de dispositivo, por causa da FK)', () => {
    for (const trecho of [
      'drop index if exists core.equipe_responsavel_ix;',
      'drop table if exists core.sessao;',
      'drop table if exists core.dispositivo;',
      'alter table core.usuario drop constraint if exists usuario_tentativas_nao_negativas;',
      'alter table core.usuario drop column if exists bloqueio_ate;',
      'alter table core.usuario drop column if exists tentativas_falhas;',
    ]) expect(m.down).toContain(trecho);
    expect(m.down.indexOf('drop table if exists core.sessao;')).toBeLessThan(m.down.indexOf('drop table if exists core.dispositivo;'));
  });
});

describe('Drizzle x migrações (estático)', () => {
  const drizzle = tabelasDrizzle();
  const criadas = tabelasCriadas();

  it('toda tabela da migração tem espelho em Drizzle e vice-versa', () => {
    expect([...drizzle.keys()].sort()).toEqual([...criadas.keys()].sort());
  });

  for (const [tabela, cfg] of drizzle) {
    it(`${tabela}: mesmas colunas do SQL`, () => {
      const corpo = criadas.get(tabela) ?? '';
      const doSql = [...corpo.matchAll(/^ {2}([a-z_]+) +[a-z]/gm)].map((m) => m[1]!).filter((c) => c !== 'constraint').sort();
      expect(cfg.columns.map((c) => c.name).sort()).toEqual(doSql);
    });
  }
});

describe('perfis: SQL e Drizzle x @macuxi/platform-sdk (fonte única)', () => {
  const doSdk = [...PERFIS].sort();

  it('todo CHECK de perfil das migrações tem exatamente os PERFIS do platform-sdk', () => {
    const checks = [...sqlUp.matchAll(/check \(perfil in \(([^)]*)\)\)/g)].map((m) => [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!).sort());
    expect(checks.length, 'CHECKs de perfil (plataforma.perfil_modulo e core.usuario)').toBe(2);
    for (const lista of checks) expect(lista).toEqual(doSdk);
  });

  it('colunas perfil do Drizzle usam os PERFIS do platform-sdk', () => {
    expect([...(esquemaPlataforma.perfilModulo.perfil.enumValues ?? [])].sort()).toEqual(doSdk);
    expect([...(nuvemCore.usuario.perfil.enumValues ?? [])].sort()).toEqual(doSdk);
  });
});

describe('fixture dois-tenants (estático)', () => {
  const dados = dadosDoisTenants('$argon2id$v=19$m=1,t=1,p=1$c2Fs$aGFzaA');
  const A = DOIS_TENANTS.A.tenantId;
  const B = DOIS_TENANTS.B.tenantId;
  const comTenant = [...tabelasCriadas().keys()].filter((t) => !(t in TABELAS_SEM_TENANT_ID));

  it('cobre toda tabela com tenant_id, com pelo menos 1 linha em CADA tenant', () => {
    expect([...ORDEM_TABELAS].sort()).toEqual([...tabelasCriadas().keys()].sort());
    for (const t of comTenant) {
      const linhas = dados[t as keyof typeof dados];
      expect(linhas.filter((l) => l.tenant_id === A).length, `${t} em A`).toBeGreaterThan(0);
      expect(linhas.filter((l) => l.tenant_id === B).length, `${t} em B`).toBeGreaterThan(0);
    }
  });

  it('UUIDs fixos com prefixo do tenant e sem repetição', () => {
    const ids = Object.values(dados).flat().map((l) => String(l.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of Object.keys(dados)) {
      for (const l of dados[t as keyof typeof dados]) {
        const dono = t === 'plataforma.tenant' ? l.id : l.tenant_id;
        expect(String(l.id).slice(0, 8)).toBe(dono === A ? 'aaaaaaaa' : 'bbbbbbbb');
      }
    }
  });

  it('usuários e módulos conforme tests/plano/sprint-0.md §3', () => {
    const us = dados['core.usuario'];
    expect(us.filter((u) => u.tenant_id === A).map((u) => u.perfil).sort()).toEqual(
      ['admin', 'analista', 'assistente', 'gerente', 'supervisor', 'vendedor', 'vendedor', 'promotor'].sort(),
    );
    expect(us.filter((u) => u.tenant_id === B).map((u) => u.perfil).sort()).toEqual(['admin', 'vendedor']);
    expect(us.every((u) => String(u.email).endsWith('@exemplo.com.br'))).toBe(true);
    expect(us.filter((u) => u.email === DOIS_TENANTS.emailRepetido).map((u) => u.tenant_id).sort()).toEqual([A, B].sort());
    const mods = (t: string) => dados['plataforma.tenant_modulo'].filter((m) => m.tenant_id === t).map((m) => m.modulo);
    expect(mods(A)).toEqual(['core', 'vendedor', 'promotor', 'teste', 'teste-dependente', 'catalogo']);
    expect(mods(B)).toEqual(['core', 'vendedor', 'catalogo']);
    const pm = (perfil: string) => dados['plataforma.perfil_modulo'].filter((p) => p.tenant_id === A && p.perfil === perfil).map((p) => p.modulo).sort();
    expect(pm('vendedor')).toEqual(['catalogo', 'core', 'teste', 'vendedor']);
    expect(pm('promotor')).toEqual(['core', 'promotor', 'teste']);
    expect(pm('supervisor')).toEqual(['catalogo', 'core', 'promotor', 'vendedor']);
    expect(pm('gerente')).toEqual(['catalogo', 'core', 'promotor', 'vendedor']);
    expect(pm('analista')).toEqual(['catalogo', 'core', 'promotor', 'vendedor']);
    expect(pm('assistente')).toEqual(['catalogo', 'core', 'vendedor']);
    // ADR 0005 / RN-CORE-03: em A e B, todo perfil com 'vendedor' também tem 'catalogo' (senão o Vendedor some)
    for (const t of [A, B]) {
      const linhas = dados['plataforma.perfil_modulo'].filter((p) => p.tenant_id === t);
      for (const { perfil } of linhas.filter((p) => p.modulo === 'vendedor')) {
        expect(linhas.some((p) => p.perfil === perfil && p.modulo === 'catalogo'), `${String(t).slice(0, 8)}/${String(perfil)}`).toBe(true);
      }
      expect(mods(t)).toContain('catalogo');
    }
    const exA = dados['plataforma.usuario_modulo'].filter((e) => e.tenant_id === A);
    expect(exA).toEqual([expect.objectContaining({ usuario_id: DOIS_TENANTS.A.usuarios.vendedor2, modulo: 'teste', efeito: 'remover' })]);
  });

  it('login (0004): sessões com sha256 hex do segredo exportado, aparelho do próprio usuário e tentativas zeradas', () => {
    for (const X of [DOIS_TENANTS.A, DOIS_TENANTS.B]) {
      expect(X.refresh.token).toBe(`${X.tenantId}.${X.refresh.segredo}`);
      expect(X.refresh.hash).toBe(crypto.createHash('sha256').update(X.refresh.segredo).digest('hex'));
      const s = dados['core.sessao'].filter((l) => l.tenant_id === X.tenantId);
      expect(s.map((l) => l.token_hash)).toEqual([X.refresh.hash]);
    }
    const aparelhos = new Map(dados['core.dispositivo'].map((d) => [d.id, d]));
    for (const s of dados['core.sessao']) expect(aparelhos.get(s.dispositivo_id)?.usuario_id).toBe(s.usuario_id);
    expect(aparelhos.get(DOIS_TENANTS.A.dispositivos.promotorBloqueado)?.bloqueado_em).not.toBeNull();
    expect(dados['core.usuario'].every((u) => u.tentativas_falhas === 0 && u.bloqueio_ate === null)).toBe(true);
  });

  it('vendedor-1 na equipe 1 e vendedor-2 na equipe 2, sob a regional do gerente', () => {
    const u = new Map(dados['core.usuario'].map((x) => [x.id, x]));
    expect(u.get(DOIS_TENANTS.A.usuarios.vendedor1)?.equipe_id).toBe(DOIS_TENANTS.A.equipes.equipe1);
    expect(u.get(DOIS_TENANTS.A.usuarios.vendedor2)?.equipe_id).toBe(DOIS_TENANTS.A.equipes.equipe2);
    const e = new Map(dados['core.equipe'].map((x) => [x.id, x]));
    expect(e.get(DOIS_TENANTS.A.equipes.equipe1)?.equipe_pai_id).toBe(DOIS_TENANTS.A.equipes.regional);
    expect(e.get(DOIS_TENANTS.A.equipes.regional)?.responsavel_id).toBe(DOIS_TENANTS.A.usuarios.gerente);
  });
});

describe('seed Fase M (estático)', () => {
  const dados = dadosFaseM('$argon2id$v=19$m=1,t=1,p=1$c2Fs$aGFzaA');

  it('S0-031 12 usuários da Fase M com o perfil mapeado', () => {
    const us = dados['core.usuario'].map((u) => `${u.email} ${u.perfil}`).sort();
    expect(us).toEqual(
      [
        'bruna@exemplo.com.br vendedor', 'rafael@exemplo.com.br vendedor', 'diego@exemplo.com.br vendedor', 'carla@exemplo.com.br vendedor',
        'marcos@exemplo.com.br vendedor', 'livia@exemplo.com.br vendedor', 'thiago@exemplo.com.br vendedor', 'paula@exemplo.com.br vendedor',
        'fernando@exemplo.com.br gerente', 'juliana@exemplo.com.br analista', 'ana@exemplo.com.br assistente', 'patricia@exemplo.com.br admin',
      ].sort(),
    );
    expect(dados['core.usuario'].every((u) => u.tenant_id === TENANT_FASE_M)).toBe(true);
  });

  it('S0-032 seis equipes sob a gerência do Fernando', () => {
    const eq = dados['core.equipe'];
    const raiz = eq.find((e) => e.equipe_pai_id === null)!;
    expect(raiz.responsavel_id).toBe(idDeterministico('fase-m:usuario:fernando@exemplo.com.br'));
    expect(eq.filter((e) => e.equipe_pai_id === raiz.id).map((e) => e.nome).sort()).toEqual(
      ['Centro', 'Interior', 'Zona Leste', 'Zona Norte', 'Zona Oeste', 'Zona Sul'],
    );
  });

  it('carteira aponta só para clientes e vendedores do seed', () => {
    const clientes = new Set(dados['core.cliente'].map((c) => c.id));
    const vendedores = new Set(dados['core.usuario'].filter((u) => u.perfil === 'vendedor').map((u) => u.id));
    for (const c of dados['core.carteira']) {
      expect(clientes.has(c.cliente_id)).toBe(true);
      expect(vendedores.has(c.usuario_id)).toBe(true);
    }
    expect(dados['core.produto']).toHaveLength(60);
  });
});

describe('utilitários', () => {
  it('idFixo e idDeterministico geram UUID válido e estável', () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    expect(idFixo('aaaaaaaa', 1, 7)).toBe('aaaaaaaa-0001-4000-8000-000000000007');
    expect(idDeterministico('x')).toMatch(uuid);
    expect(idDeterministico('x')).toBe(idDeterministico('x'));
    expect(idDeterministico('x')).not.toBe(idDeterministico('y'));
  });

  it.skipIf(!('argon2Sync' in crypto))('hash argon2id em PHC e verificação', () => {
    const h = hashSenha('segredo');
    expect(h.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
    expect(verificarSenha('segredo', h)).toBe(true);
    expect(verificarSenha('outra', h)).toBe(false);
  });
});
