/**
 * Testes estáticos do banco — rodam SEMPRE (sem Postgres): conferem as migrações SQL, os schemas
 * Drizzle, a fixture dois-tenants e o seed da Fase M contra as regras (CLAUDE.md regra 5, RN-CORE-05).
 */
import * as crypto from 'node:crypto';
import { PERFIS } from '@macuxi/platform-sdk';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { INDICADORES_META, RESULTADOS_VISITA, TIPOS_NOTIFICACAO } from '../../modules/core/contracts/sync';
import * as nuvemCatalogo from '../../modules/catalogo/db/nuvem';
import * as nuvemCore from '../../modules/core/db/nuvem';
import * as nuvemVendedor from '../../modules/vendedor/db/nuvem';
import { MOTIVOS_APROVACAO, NIVEIS_APROVACAO } from '../../modules/vendedor/domain/aprovacao';
import { ORDER_STATUSES } from '../../modules/vendedor/domain/order';
import * as esquemaPlataforma from '../esquema/plataforma';
import { ALCADAS_DEMO, dadosDemo } from '../seeds/demo/demo';
import { dadosFaseM, TENANT_FASE_M } from '../seeds/fase-m/fase-m';
import { dadosDoisTenants, DOIS_TENANTS, ORDEM_TABELAS } from '../seeds/fixtures/dois-tenants';
import { TABELAS_FORA_DO_SYNC, TABELAS_SEM_TENANT_ID } from '../src/excecoes';
import { idDeChave, idDeterministico, idFixo } from '../src/ids';
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
  for (const v of [...Object.values(esquemaPlataforma), ...Object.values(nuvemCore), ...Object.values(nuvemCatalogo), ...Object.values(nuvemVendedor)]) {
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
    expect(migracoes.map((m) => `${m.versao}_${m.nome}`)).toEqual([
      '0001_plataforma', '0002_core', '0003_plataforma_worker', '0004_core_sessao', '0005_plataforma_arquivo', '0006_core_lote_a', '0007_vendedor_pedido',
      '0008_catalogo_preco', '0009_vendedor_pedido_completo',
    ]);
  });

  it('down de cada migração remove os schemas que o up cria', () => {
    for (const m of migracoes) {
      for (const [, schema] of m.up.matchAll(/^create schema ([a-z_]+);/gm)) {
        expect(m.down, `${m.versao} deveria remover o schema ${schema}`).toMatch(new RegExp(`drop schema if exists ${schema} cascade`));
      }
    }
  });

  const criadas = tabelasCriadas();
  it('cria as tabelas pedidas na T-0002, na T-0003 F2 (sessao, dispositivo), na Sprint 1 (lote A, arquivo, vendedor mínimo) e na T-0029', () => {
    expect([...criadas.keys()].sort()).toEqual(
      [
        'plataforma.tenant', 'plataforma.tenant_modulo', 'plataforma.perfil_modulo', 'plataforma.usuario_modulo',
        'plataforma.evento', 'plataforma.evento_consumo', 'plataforma.parametro', 'plataforma.auditoria',
        'core.usuario', 'core.equipe', 'core.produto', 'core.cliente', 'core.carteira', 'core.sessao', 'core.dispositivo',
        'plataforma.arquivo',
        'core.cliente_contato', 'core.cliente_financeiro', 'core.titulo', 'core.historico_compra', 'core.motivo', 'core.rota', 'core.rota_parada',
        'core.visita', 'core.visita_etapa', 'core.notificacao', 'core.meta', 'core.indicador_diario',
        'vendedor.pedido', 'vendedor.pedido_item',
        'catalogo.tabela_preco', 'catalogo.tabela_preco_item', 'catalogo.cliente_tabela_preco',
        'vendedor.pedido_evento', 'vendedor.condicao_pagamento', 'vendedor.cliente_condicao', 'vendedor.numeracao_pedido',
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

describe('Sprint 1: 0005 arquivo, 0006 lote A do core, 0007 vendedor mínimo (estático, desenho T-0016 §7)', () => {
  const m5 = migracoes.find((x) => x.versao === '0005')!;
  const m6 = migracoes.find((x) => x.versao === '0006')!;
  const m7 = migracoes.find((x) => x.versao === '0007')!;
  const criadas = tabelasCriadas();
  /** Valores de um `check (col in ('a', 'b'))` (ou `col is null or col in (...)`) no corpo da tabela. */
  const valoresDoCheck = (tabela: string, coluna: string): string[] => {
    const m = new RegExp(`check \\((?:${coluna} is null or )?${coluna} in \\(([^)]*)\\)\\)`).exec(criadas.get(tabela) ?? '');
    return m ? [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!) : [];
  };

  it('RN-CORE-11: único parcial de visita aberta por usuário (checkout nulo e viva) e checkout_id único', () => {
    expect(m6.up).toContain('create unique index visita_aberta_uk on core.visita (tenant_id, usuario_id) where checkout_em is null and deleted_at is null;');
    expect(m6.up).toContain('create unique index visita_checkout_uk on core.visita (tenant_id, checkout_id) where checkout_id is not null;');
  });

  it('RN-CORE-10 e RN-CORE-14: checks da visita (justificativa fora do raio; cliente fechado com motivo e foto)', () => {
    const v = criadas.get('core.visita')!;
    expect(v).toContain("check (not fora_do_raio or nullif(btrim(justificativa_fora_raio), '') is not null)");
    expect(v).toContain("check (resultado is distinct from 'cliente_fechado' or (motivo_id is not null and foto_fachada_id is not null))");
    expect(v).toContain('check (checkout_em is null or checkout_em >= checkin_em)');
    expect(v).toContain('foreign key (tenant_id, foto_fachada_id) references plataforma.arquivo (tenant_id, id)');
    expect(v).not.toMatch(/pedido_id[^\n]*references/);
  });

  it('listas fechadas do banco = contratos (core: resultado, tipo de notificação, indicador de meta; vendedor: status)', () => {
    expect(valoresDoCheck('core.visita', 'resultado')).toEqual([...RESULTADOS_VISITA, 'nao_finalizado']);
    expect([...nuvemCore.RESULTADOS_VISITA_BANCO]).toEqual([...RESULTADOS_VISITA, 'nao_finalizado']);
    expect(valoresDoCheck('core.notificacao', 'tipo')).toEqual([...TIPOS_NOTIFICACAO]);
    expect([...nuvemCore.TIPOS_NOTIFICACAO_BANCO]).toEqual([...TIPOS_NOTIFICACAO]);
    expect(valoresDoCheck('core.meta', 'indicador')).toEqual([...INDICADORES_META]);
    expect([...nuvemCore.INDICADORES_META_BANCO]).toEqual([...INDICADORES_META]);
    expect(valoresDoCheck('vendedor.pedido', 'status')).toEqual([...ORDER_STATUSES]);
    expect([...(nuvemVendedor.pedido.status.enumValues ?? [])]).toEqual([...ORDER_STATUSES]);
  });

  it('rota_parada: usuario_id/data presos à rota (FK com on update cascade) e sequência única ADIÁVEL entre as vivas', () => {
    const rp = criadas.get('core.rota_parada')!;
    expect(rp).toMatch(/foreign key \(tenant_id, rota_id, usuario_id, data\)\s+references core\.rota \(tenant_id, id, usuario_id, data\) on update cascade/);
    expect(rp).toMatch(/exclude using btree \(tenant_id with =, rota_id with =, sequencia with =\)\s+where \(deleted_at is null\) deferrable initially deferred/);
  });

  it('pull por usuário: rota, rota_parada, visita, notificacao, meta com (tenant_id, usuario_id, updated_at, id); pedido por vendedor', () => {
    for (const t of ['rota', 'rota_parada', 'visita', 'notificacao', 'meta']) {
      expect(m6.up).toContain(`on core.${t} (tenant_id, usuario_id, updated_at, id);`);
    }
    expect(m7.up).toContain('create index pedido_vendedor_sync_ix on vendedor.pedido (tenant_id, vendedor_id, updated_at, id);');
    expect(m7.up).toContain('create index pedido_cliente_ix on vendedor.pedido (tenant_id, cliente_id, created_at desc);');
    expect(criadas.get('vendedor.pedido_item')).toContain('constraint pedido_item_sequencia_uk unique (tenant_id, pedido_id, sequencia)');
  });

  it('fronteira: vendedor.* sem FK para core.* (só plataforma.tenant e dentro do schema)', () => {
    expect(m7.up).not.toMatch(/references core\./);
    expect(m7.down).toContain('drop schema if exists vendedor cascade;');
  });

  it('RN-CORE-14: motivos de sistema e parâmetros do Core semeados em todo tenant (existentes e novos, gatilho)', () => {
    expect(m6.up).toContain("('cliente_fechado', 'loja_fechada',");
    expect(m6.up).toContain("('cliente_fechado', 'acesso_negado',");
    expect(m6.up).toContain("('checkin.raio_m',       '200'::jsonb)");
    expect(m6.up).toContain("('metas.base_apuracao',  '\"aprovado\"'::jsonb)");
    expect(m6.up).toContain('create trigger tenant_semear_core after insert on plataforma.tenant');
    expect(m6.up).toContain('select core.semear_padroes(t.id) from plataforma.tenant t;');
    // a semeadura não é SECURITY DEFINER (o macuxi_app não insere tenant; nada de função que ignore RLS)
    expect(m6.up.replace(/--.*$/gm, '')).not.toMatch(/security definer/i);
  });

  it('plataforma.arquivo (ADR 0010): índices por entidade e parcial dos aguardando; fora do sync', () => {
    expect(m5.up).toContain('create index arquivo_entidade_ix on plataforma.arquivo (tenant_id, entidade, entidade_id);');
    expect(m5.up).toContain("create index arquivo_aguardando_ix on plataforma.arquivo (tenant_id, situacao) where situacao = 'aguardando';");
    expect(TABELAS_FORA_DO_SYNC).toContain('plataforma.arquivo');
  });

  it('downs desfazem o que os ups criam', () => {
    expect(m5.down).toContain('drop table if exists plataforma.arquivo;');
    expect(m5.down).toContain('drop function if exists plataforma.uuid_de_chave(text);');
    for (const t of ['cliente_contato', 'cliente_financeiro', 'titulo', 'historico_compra', 'motivo', 'rota', 'rota_parada', 'visita', 'visita_etapa', 'notificacao', 'meta', 'indicador_diario']) {
      expect(m6.down).toContain(`drop table if exists core.${t};`);
    }
    for (const c of ['frequencia_semanas', 'dia_semana']) expect(m6.down).toContain(`alter table core.carteira drop column if exists ${c};`);
    for (const c of ['push_token', 'push_plataforma', 'push_atualizado_em']) expect(m6.down).toContain(`alter table core.dispositivo drop column if exists ${c};`);
    expect(m6.down).toContain('drop trigger if exists tenant_semear_core on plataforma.tenant;');
    // visita antes de rota_parada/motivo (FKs), parada antes de rota
    expect(m6.down.indexOf('drop table if exists core.visita;')).toBeLessThan(m6.down.indexOf('drop table if exists core.rota_parada;'));
    expect(m6.down.indexOf('drop table if exists core.rota_parada;')).toBeLessThan(m6.down.indexOf('drop table if exists core.rota;'));
  });
});

describe('T-0029: 0008 preço do Catálogo e 0009 pedido completo do Vendedor (estático, desenho T-0029 §10)', () => {
  const m8 = migracoes.find((x) => x.versao === '0008')!;
  const m9 = migracoes.find((x) => x.versao === '0009')!;
  const criadas = tabelasCriadas();
  const lista = (trecho: string) => [...trecho.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
  /** Valores de `check (col in (...))` ou `check (col is null or col in (...))` no corpo da tabela. */
  const valoresDoCheck = (tabela: string, coluna: string): string[] => {
    const m = new RegExp(`check \\((?:${coluna} is null or )?${coluna} in \\(([^)]*)\\)\\)`).exec(criadas.get(tabela) ?? '');
    return m ? lista(m[1]!) : [];
  };

  it('listas fechadas = código do Vendedor: status (pedido e pedido_evento.de/para) x ORDER_STATUSES; níveis x NIVEIS_APROVACAO; motivos x MOTIVOS_APROVACAO', () => {
    expect(valoresDoCheck('vendedor.pedido', 'status')).toEqual([...ORDER_STATUSES]);
    expect(valoresDoCheck('vendedor.pedido_evento', 'de')).toEqual([...ORDER_STATUSES]);
    expect(valoresDoCheck('vendedor.pedido_evento', 'para')).toEqual([...ORDER_STATUSES]);
    expect(valoresDoCheck('vendedor.pedido', 'nivel_aprovacao')).toEqual([...NIVEIS_APROVACAO]);
    expect(valoresDoCheck('vendedor.pedido_evento', 'nivel')).toEqual([...NIVEIS_APROVACAO]);
    const motivos = /check \(motivos_aprovacao <@ array\[([^\]]*)\]::text\[\]\)/.exec(m9.up);
    expect(lista(motivos?.[1] ?? '')).toEqual([...MOTIVOS_APROVACAO]);
    // Drizzle com as mesmas listas
    expect([...(nuvemVendedor.pedido.nivel_aprovacao.enumValues ?? [])]).toEqual([...NIVEIS_APROVACAO]);
    expect([...(nuvemVendedor.pedidoEvento.para.enumValues ?? [])]).toEqual([...ORDER_STATUSES]);
    expect([...(nuvemVendedor.pedidoEvento.nivel.enumValues ?? [])]).toEqual([...NIVEIS_APROVACAO]);
    // o vocabulário dos eventos (STATUS_CONTRATO) não vai ao banco
    expect(m9.up).not.toMatch(/'em_aprovacao'|'aprovado'|'rejeitado'/);
  });

  it('RN-GES-08 e RN-VEN-10: pending_approval exige nível; rejected exige motivo com 3+ caracteres (dados antigos preenchidos antes)', () => {
    expect(m9.up).toContain("check (status <> 'pending_approval' or nivel_aprovacao is not null)");
    expect(m9.up).toContain("check (status <> 'rejected' or coalesce(char_length(btrim(motivo_rejeicao)), 0) >= 3)");
    expect(m9.up.indexOf("where status = 'pending_approval' and nivel_aprovacao is null")).toBeLessThan(m9.up.indexOf('add constraint pedido_pendente_com_nivel'));
    expect(m9.up.indexOf("where status = 'rejected'")).toBeLessThan(m9.up.indexOf('add constraint pedido_rejeitado_com_motivo'));
  });

  it('únicos parciais e índices das consultas (número, lista do BKO, condição padrão, tabela do cliente, preço vigente)', () => {
    for (const idx of [
      'create unique index pedido_numero_uk on vendedor.pedido (tenant_id, numero) where numero is not null;',
      'create index pedido_status_ix on vendedor.pedido (tenant_id, status, created_at desc);',
      'create index pedido_evento_pedido_ix on vendedor.pedido_evento (tenant_id, pedido_id, ocorrido_em);',
      'create unique index condicao_pagamento_codigo_uk on vendedor.condicao_pagamento (tenant_id, codigo) where deleted_at is null;',
      'create unique index condicao_pagamento_padrao_uk on vendedor.condicao_pagamento (tenant_id) where padrao and deleted_at is null;',
      'create unique index cliente_condicao_uk on vendedor.cliente_condicao (tenant_id, cliente_id, condicao_pagamento_id) where deleted_at is null;',
    ]) expect(m9.up).toContain(idx);
    for (const idx of [
      'create unique index tabela_preco_codigo_uk on catalogo.tabela_preco (tenant_id, codigo) where deleted_at is null;',
      'create unique index tabela_preco_item_vigencia_uk on catalogo.tabela_preco_item (tenant_id, tabela_preco_id, produto_id, vigencia_inicio) nulls not distinct where deleted_at is null;',
      'create unique index cliente_tabela_preco_cliente_uk on catalogo.cliente_tabela_preco (tenant_id, cliente_id) where deleted_at is null;',
    ]) expect(m8.up).toContain(idx);
    expect(criadas.get('catalogo.tabela_preco_item')).toContain('check (preco_cents > 0)');
    expect(criadas.get('catalogo.tabela_preco_item')).toContain('check (vigencia_inicio is null or vigencia_fim is null or vigencia_fim > vigencia_inicio)');
  });

  it('fronteira: catalogo e vendedor sem FK para outro schema; FKs compostas dentro do schema', () => {
    for (const m of [m8, m9]) expect(m.up.replace(/--.*$/gm, '')).not.toMatch(/references core\./);
    expect(m8.up.replace(/--.*$/gm, '')).not.toMatch(/references vendedor\./);
    expect(m9.up.replace(/--.*$/gm, '')).not.toMatch(/references catalogo\./);
    expect(criadas.get('catalogo.tabela_preco_item')).toContain('foreign key (tenant_id, tabela_preco_id) references catalogo.tabela_preco (tenant_id, id)');
    expect(criadas.get('catalogo.cliente_tabela_preco')).toContain('foreign key (tenant_id, tabela_preco_id) references catalogo.tabela_preco (tenant_id, id)');
    expect(criadas.get('vendedor.pedido_evento')).toContain('foreign key (tenant_id, pedido_id) references vendedor.pedido (tenant_id, id)');
    expect(criadas.get('vendedor.cliente_condicao')).toContain('foreign key (tenant_id, condicao_pagamento_id) references vendedor.condicao_pagamento (tenant_id, id)');
    expect(m9.up).toContain('add constraint pedido_condicao_fk foreign key (tenant_id, condicao_pagamento_id) references vendedor.condicao_pagamento (tenant_id, id);');
  });

  it('número legível: contador por tenant (fora do sync), função invoker sem SECURITY DEFINER; histórico só leitura e inserção', () => {
    expect(TABELAS_FORA_DO_SYNC).toContain('vendedor.numeracao_pedido');
    expect(criadas.get('vendedor.numeracao_pedido')).toContain('constraint numeracao_pedido_tenant_uk unique (tenant_id)');
    expect(m9.up).toContain('create function vendedor.proximo_numero_pedido() returns text');
    expect(m9.up.replace(/--.*$/gm, '')).not.toMatch(/security definer/i);
    expect(m9.up).toContain('grant select, insert on vendedor.pedido_evento to macuxi_app;');
  });

  it('downs desfazem o que os ups criam', () => {
    expect(m8.down).toContain('drop schema if exists catalogo cascade;');
    for (const t of ['pedido_evento', 'numeracao_pedido', 'cliente_condicao', 'condicao_pagamento']) expect(m9.down).toContain(`drop table if exists vendedor.${t};`);
    expect(m9.down).toContain('drop function if exists vendedor.proximo_numero_pedido();');
    for (const [, tabela, coluna] of m9.up.matchAll(/^alter table (vendedor\.[a-z_]+) add column ([a-z_]+) /gm)) {
      expect(m9.down).toContain(`alter table ${tabela} drop column if exists ${coluna};`);
    }
    for (const [, nome] of m9.up.matchAll(/add constraint ([a-z_]+) /g)) expect(m9.down).toContain(`drop constraint if exists ${nome};`);
    for (const [, nome] of m9.up.matchAll(/^create (?:unique )?index ([a-z_]+) on vendedor\.pedido /gm)) expect(m9.down).toContain(`drop index if exists vendedor.${nome};`);
    // condicao_pagamento só depois de soltar a FK do pedido e a cliente_condicao
    expect(m9.down.indexOf('drop constraint if exists pedido_condicao_fk')).toBeLessThan(m9.down.indexOf('drop table if exists vendedor.condicao_pagamento;'));
    expect(m9.down.indexOf('drop table if exists vendedor.cliente_condicao;')).toBeLessThan(m9.down.indexOf('drop table if exists vendedor.condicao_pagamento;'));
  });
});

describe('base de demo x T-0029 (estático)', () => {
  const d = dadosDemo('$argon2id$v=19$m=1,t=1,p=1$c2Fs$aGFzaA', { hoje: '2026-11-04' });

  it('alçadas do Vendedor nos parâmetros do tenant (5/10/15, acima do gerente = analista)', () => {
    const p = Object.fromEntries(d['plataforma.parametro'].filter((x) => x.modulo === 'vendedor').map((x) => [x.chave, JSON.parse(String(x.valor))]));
    expect(p).toEqual({ ...ALCADAS_DEMO });
  });

  it('pedidos com status, nível e motivos dentro das listas do contrato', () => {
    for (const p of d['vendedor.pedido']) {
      expect(ORDER_STATUSES as readonly string[]).toContain(p.status);
      if (p.nivel_aprovacao !== null) expect(NIVEIS_APROVACAO as readonly string[]).toContain(p.nivel_aprovacao);
      for (const m of String(p.motivos_aprovacao).replace(/[{}]/g, '').split(',').filter(Boolean)) expect(MOTIVOS_APROVACAO as readonly string[]).toContain(m);
    }
    for (const e of d['vendedor.pedido_evento']) {
      expect(ORDER_STATUSES as readonly string[]).toContain(e.para);
      if (e.de !== null) expect(ORDER_STATUSES as readonly string[]).toContain(e.de);
    }
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
      const doSql = [...corpo.matchAll(/^ {2}([a-z_][a-z0-9_]*) +[a-z]/gm)].map((m) => m[1]!).filter((c) => c !== 'constraint').sort();
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

  describe('Sprint 1 (com "hoje" fixo)', () => {
    const HOJE = '2026-11-03';
    const d = dadosDoisTenants('$argon2id$v=19$m=1,t=1,p=1$c2Fs$aGFzaA', { hoje: HOJE });
    const X = DOIS_TENANTS.A;

    it('cliente sem coordenada (c3) e com coordenada (c1, c2); carteiras sem mudança', () => {
      const c = new Map(d['core.cliente'].map((x) => [x.id, x]));
      expect(c.get(X.clientes.c3)?.latitude).toBeNull();
      expect(c.get(X.clientes.c1)?.latitude).not.toBeNull();
      expect(d['core.carteira']).toHaveLength(5);
    });

    it('rota de hoje com paradas; vendedor-1 com 2 paradas na própria carteira, em sequência', () => {
      expect(d['core.rota'].every((r) => r.data === HOJE)).toBe(true);
      const p = d['core.rota_parada'].filter((x) => x.rota_id === X.rotas.vendedor1).map((x) => [x.cliente_id, x.sequencia]);
      expect(p).toEqual([[X.clientes.c1, 1], [X.clientes.c3, 2]]);
      const carteira = new Set(d['core.carteira'].map((x) => `${x.usuario_id}:${x.cliente_id}`));
      for (const parada of d['core.rota_parada']) expect(carteira.has(`${parada.usuario_id}:${parada.cliente_id}`)).toBe(true);
    });

    it('títulos vencidos, a vencer e vencendo hoje; histórico de 12 meses de c1', () => {
      const t = d['core.titulo'].filter((x) => x.tenant_id === X.tenantId && x.situacao === 'aberto');
      expect(t.some((x) => String(x.vencimento) < HOJE)).toBe(true);
      expect(t.some((x) => String(x.vencimento) > HOJE)).toBe(true);
      expect(t.some((x) => x.vencimento === HOJE)).toBe(true);
      const h = d['core.historico_compra'].filter((x) => x.cliente_id === X.clientes.c1).map((x) => x.ano_mes);
      expect(h).toHaveLength(12);
      expect(h[0]).toBe('2025-12');
      expect(h[11]).toBe('2026-11');
    });

    it('uma visita aberta no máximo por usuário; cliente fechado com motivo de sistema e foto; uma notificação por usuário', () => {
      const abertas = d['core.visita'].filter((v) => v.checkout_em === null).map((v) => v.usuario_id);
      expect(new Set(abertas).size).toBe(abertas.length);
      const fechadas = d['core.visita'].filter((v) => v.resultado === 'cliente_fechado');
      expect(fechadas.map((v) => v.motivo_id).sort()).toEqual([X.motivos.lojaFechada, DOIS_TENANTS.B.motivos.acessoNegado].sort());
      expect(fechadas.every((v) => v.foto_fachada_id !== null)).toBe(true);
      const comNotificacao = new Set(d['core.notificacao'].map((n) => n.usuario_id));
      for (const u of d['core.usuario']) expect(comNotificacao.has(u.id), String(u.email)).toBe(true);
    });

    it('motivos padrão não estão nas listas (vêm do gatilho); ids batem com idDeChave', () => {
      expect(d['core.motivo'].map((m) => m.codigo)).toEqual(['obra_na_via', 'cliente_inadimplente']);
      expect(X.motivos.lojaFechada).toBe(idDeChave(`${X.tenantId}:core.motivo:cliente_fechado:loja_fechada`));
    });

    it('pedidos: totais = soma dos itens; status da lista do contrato', () => {
      for (const p of d['vendedor.pedido']) {
        const itens = d['vendedor.pedido_item'].filter((i) => i.pedido_id === p.id);
        expect(itens.reduce((s, i) => s + Number(i.total_cents), 0), String(p.id)).toBe(p.total_cents);
        expect(ORDER_STATUSES as readonly string[]).toContain(p.status);
      }
    });
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
  it('idDeChave: UUID v5 com variante RFC 4122, estável (gêmeo de plataforma.uuid_de_chave)', () => {
    // valor de referência calculado pelo Postgres: select plataforma.uuid_de_chave('x')
    expect(idDeChave('x')).toBe('7f29305d-fba6-5e0d-a7cc-1ec3291e82ef');
    expect(idDeChave('y')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

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
