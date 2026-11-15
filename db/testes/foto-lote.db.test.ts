/**
 * 0079 — fotos dos produtos em lote por ZIP e trabalho sob demanda (T-0174, RN-CAT-14, ADR 0054; desenho docs/desenho/T-0174.md
 * §2). Dicionário: docs/banco/catalogo.md e docs/banco/plataforma.md, "0079". O que o BANCO garante:
 * - plataforma.arquivo aceita JPEG, PNG e WEBP até 8 MiB e o ZIP até 500 MiB (R-20261115-074500); nada além;
 * - catalogo.foto_lote: o mesmo ZIP (SHA-256) vivo uma vez por tenant (fora 'falhou' e 'duplicado'); coerências de situação;
 * - catalogo.foto_lote_item: checkpoint único por (lote, indice); ordem repetida no lote entre os 'ligado'; ids reservados únicos;
 * - catalogo.produto_midia: mesma imagem viva no mesmo produto uma vez (hash_conteudo); principal sempre na ordem 1; ordem da
 *   foto viva única por produto; as principais antigas vão de 0 a 1 SEM andar o updated_at (aparelho não baixa de novo);
 * - plataforma.trabalho: um vivo por alvo; o worker só pelas 3 funções (reservar não entrega o mesmo trabalho a dois processos,
 *   devolve o de trava vencida e ignora tenant suspenso; devolver/renovar só com a trava);
 * - RLS enable + force entre dois tenants nas 3 tabelas novas; macuxi_app sem DELETE e sem UPDATE em plataforma.trabalho.
 * Estático no PC; banco (fixture dois-tenants, ROLLBACK) e up/down + worker num banco efêmero no CI.
 */
import pg from 'pg';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as nuvemCatalogo from '../../modules/catalogo/db/nuvem';
import * as esquemaPlataforma from '../esquema/plataforma';
import { DOIS_TENANTS, FOTO_LOTE_FIXTURE } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { banco, semBanco } from './estado';
import { emTransacao, erroDe, HASH_TESTE, retratoDoCatalogo } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const migracoes = lerMigracoes();
const m79 = migracoes.find((m) => m.versao === '0079')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(m79.up);
const down = semComentarios(m79.down);
const umaLinha = up.replace(/\s+/g, ' ');
const MIB = 1024 * 1024;
const TABELAS = ['plataforma.trabalho', 'catalogo.foto_lote', 'catalogo.foto_lote_item'] as const;
const FUNCOES = [
  'plataforma.trabalho_reservar(text, integer)',
  'plataforma.trabalho_devolver(uuid, text, text, text, integer)',
  'plataforma.trabalho_renovar(uuid, text, integer)',
] as const;

/** Colunas do `create table x (...)` da migração. */
const colunasDoSql = (tabela: string): string[] => {
  const corpo = new RegExp(`create table ${tabela.replace('.', '\\.')} \\(([\\s\\S]*?)\\n\\);`).exec(up)?.[1] ?? '';
  return [...corpo.matchAll(/^ {2}([a-z_][a-z0-9_]*) +[a-z]/gm)].map((m) => m[1]!).filter((c) => c !== 'constraint');
};
/** Valores do `check (<col> in (...))` da tabela. */
const valoresDoCheck = (nome: string): string[] =>
  [...(new RegExp(`constraint ${nome} check \\([a-z_]+ in \\(([^)]*)\\)\\)`).exec(umaLinha)?.[1] ?? '').matchAll(/'([a-z0-9_/]+)'/g)].map((x) => x[1]!);
const colunasDrizzle = (t: Parameters<typeof getTableConfig>[0]) => getTableConfig(t).columns.map((c) => c.name).sort();

describe('0079 fotos em lote e trabalho sob demanda (estático)', () => {
  it('nome e posição: 0079_catalogo_foto_lote na posição 79 (número 0079, correção da sessão principal em 15/11)', () => {
    const nomes = migracoes.map((m) => `${m.versao}_${m.nome}`);
    expect(nomes[78]).toBe('0079_catalogo_foto_lote');
  });

  it('plataforma.arquivo: JPEG, PNG e WEBP até 8 MiB; ZIP até 500 MiB (R-20261115-074500)', () => {
    expect(umaLinha).toContain("add constraint arquivo_tipo_valido check (tipo in ('image/jpeg', 'image/png', 'image/webp', 'application/zip'));");
    expect(umaLinha).toContain(
      "add constraint arquivo_tamanho_faixa check ( tamanho_bytes is null or (tipo in ('image/jpeg', 'image/png', 'image/webp') and tamanho_bytes between 1 and 8388608) or (tipo = 'application/zip' and tamanho_bytes between 1 and 524288000) );",
    );
    expect(umaLinha).toContain(
      "add constraint arquivo_recebido_completo check ( situacao <> 'recebido' or (recebido_em is not null and tamanho_bytes is not null and chave_armazenamento is not null and (sha256 is not null or tipo = 'application/zip')) );",
    );
    expect(8388608).toBe(8 * MIB);
    expect(524288000).toBe(500 * MIB);
    expect([...esquemaPlataforma.TIPOS_ARQUIVO_BANCO]).toEqual(['image/jpeg', 'image/png', 'image/webp', 'application/zip']);
    expect(getTableConfig(esquemaPlataforma.arquivo).columns.find((c) => c.name === 'tipo')?.enumValues).toEqual([...esquemaPlataforma.TIPOS_ARQUIVO_BANCO]);
  });

  it('listas fechadas do SQL = constantes do espelho Drizzle (contratos do Catálogo e do trabalho)', () => {
    expect(valoresDoCheck('trabalho_situacao_valida')).toEqual([...esquemaPlataforma.SITUACOES_TRABALHO_BANCO]);
    expect(valoresDoCheck('foto_lote_situacao_valida')).toEqual([...nuvemCatalogo.SITUACOES_FOTO_LOTE_BANCO]);
    expect(valoresDoCheck('foto_lote_motivo_valido')).toEqual([...nuvemCatalogo.MOTIVOS_FOTO_LOTE_BANCO]);
    expect(valoresDoCheck('foto_lote_item_situacao_valida')).toEqual([...nuvemCatalogo.SITUACOES_FOTO_LOTE_ITEM_BANCO]);
    expect(valoresDoCheck('foto_lote_item_motivo_valido')).toEqual([...nuvemCatalogo.MOTIVOS_FOTO_LOTE_ITEM_BANCO]);
    expect(valoresDoCheck('foto_lote_item_tipo_valido')).toEqual([...nuvemCatalogo.TIPOS_IMAGEM_FOTO_LOTE_BANCO]);
    expect(nuvemCatalogo.MOTIVOS_FOTO_LOTE_ITEM_BANCO).toHaveLength(11);
  });

  it('idempotência e checkpoint: únicos do desenho §2', () => {
    for (const i of [
      'create unique index trabalho_alvo_uk on plataforma.trabalho (tenant_id, modulo, nome, alvo_id) where deleted_at is null;',
      'create index trabalho_fila_ix on plataforma.trabalho (situacao, proxima_em);',
      "create unique index foto_lote_sha256_uk on catalogo.foto_lote (tenant_id, sha256) where sha256 is not null and deleted_at is null and situacao not in ('falhou', 'duplicado');",
      'create unique index foto_lote_arquivo_uk on catalogo.foto_lote (tenant_id, arquivo_id) where deleted_at is null;',
      'create index foto_lote_recentes_ix on catalogo.foto_lote (tenant_id, created_at desc);',
      "create index foto_lote_ativos_ix on catalogo.foto_lote (tenant_id, situacao) where situacao in ('enfileirado', 'conferindo', 'processando');",
      'create unique index foto_lote_item_indice_uk on catalogo.foto_lote_item (tenant_id, lote_id, indice);',
      "create unique index foto_lote_item_ordem_uk on catalogo.foto_lote_item (tenant_id, lote_id, produto_id, ordem) where situacao = 'ligado';",
      'create unique index foto_lote_item_arquivo_uk on catalogo.foto_lote_item (tenant_id, arquivo_id);',
      'create unique index foto_lote_item_midia_uk on catalogo.foto_lote_item (tenant_id, midia_id);',
      'create index foto_lote_item_fila_ix on catalogo.foto_lote_item (tenant_id, lote_id, situacao, indice);',
      'create unique index produto_midia_hash_uk on catalogo.produto_midia (tenant_id, produto_id, hash_conteudo) where hash_conteudo is not null and deleted_at is null;',
      "create unique index produto_midia_ordem_foto_uk on catalogo.produto_midia (tenant_id, produto_id, ordem) where tipo = 'foto' and ordem >= 1 and deleted_at is null;",
      'create index produto_sku_lower_ix on core.produto (tenant_id, lower(sku)) where deleted_at is null;',
    ]) expect(umaLinha).toContain(i);
  });

  it('produto_midia: principais antigas 0 -> 1 com o gatilho de updated_at DESLIGADO (inclusive as removidas); depois o CHECK e o único', () => {
    const desliga = up.indexOf('alter table catalogo.produto_midia disable trigger produto_midia_updated_at;');
    const atualiza = up.indexOf('update catalogo.produto_midia set ordem = 1 where principal and ordem <> 1;');
    const liga = up.indexOf('alter table catalogo.produto_midia enable trigger produto_midia_updated_at;');
    const check = up.indexOf('add constraint produto_midia_principal_ordem check (not principal or ordem = 1);');
    const unico = up.indexOf('create unique index produto_midia_ordem_foto_uk');
    expect([desliga, atualiza, liga, check, unico].every((x) => x > 0)).toBe(true);
    expect(desliga < atualiza && atualiza < liga && liga < check && check < unico).toBe(true);
    // a conferência das fotos não principais com ordem 1 vem antes de mudar qualquer dado (55000)
    expect(up.indexOf("using errcode = '55000'")).toBeLessThan(desliga);
    expect(up).toContain('alter table catalogo.produto_midia alter column ordem set default 1;');
    expect(up).toContain("add constraint produto_midia_hash_hex check (hash_conteudo is null or hash_conteudo ~ '^[0-9a-f]{64}$');");
  });

  it('worker: 3 funções SECURITY DEFINER com search_path fixo, só tenants ativos, EXECUTE só ao macuxi_worker', () => {
    for (const f of FUNCOES) {
      const nome = f.slice(0, f.indexOf('('));
      expect(umaLinha).toMatch(new RegExp(`create function ${nome.replace('.', '\\.')}\\([^)]*\\) returns [^$]*? language plpgsql volatile security definer set search_path = pg_catalog, plataforma, pg_temp as`));
      expect(up).toContain(`revoke all on function ${f} from public;`);
      expect(up).toContain(`grant execute on function ${f} to macuxi_worker;`);
    }
    expect(umaLinha).toContain("join plataforma.tenant tn on tn.id = t.tenant_id and tn.status = 'ativo' and tn.deleted_at is null");
    expect(umaLinha).toContain('for update of t skip locked');
    expect(up).not.toMatch(/grant [^;]* on plataforma\.trabalho to macuxi_worker/);
    expect(up).not.toMatch(/grant [^;]* on catalogo\.[a-z_]+ to macuxi_worker/);
    expect(up).not.toMatch(/grant execute on function plataforma\.trabalho_[a-z]+\([^)]*\) to macuxi_app/);
  });

  it('RLS enable + force, isolamento_tenant e manutencao nas 3 tabelas; app sem DELETE; trabalho só select e insert', () => {
    for (const t of TABELAS) {
      expect(up).toContain(`alter table ${t} enable row level security;`);
      expect(up).toContain(`alter table ${t} force row level security;`);
      expect(umaLinha).toContain(`create policy isolamento_tenant on ${t} for all to macuxi_app using (tenant_id = plataforma.tenant_atual()) with check (tenant_id = plataforma.tenant_atual());`);
      expect(up).toContain(`create policy manutencao on ${t} for all to macuxi_manutencao using (true) with check (true);`);
      expect(up).not.toMatch(new RegExp(`grant [^;]*delete[^;]* on ${t.replace('.', '\\.')} `));
    }
    expect(up).toContain('grant select, insert on plataforma.trabalho to macuxi_app;');
    expect(up).toContain('grant select, insert, update on catalogo.foto_lote to macuxi_app;');
    expect(up).toContain('grant select, insert, update on catalogo.foto_lote_item to macuxi_app;');
  });

  it('macuxi_leitura (0078): SELECT e a política leitura nas 3 tabelas; produto_midia por coluna sem hash_conteudo (o down volta)', () => {
    for (const t of TABELAS) {
      expect(up).toContain(`grant select on ${t} to macuxi_leitura;`);
      expect(up).toContain(`create policy leitura on ${t} for select to macuxi_leitura using (tenant_id = plataforma.tenant_atual());`);
    }
    expect(up).toContain("execute 'revoke select on catalogo.produto_midia from macuxi_leitura';");
    expect(up).toContain("execute format('grant select (%s) on catalogo.produto_midia to macuxi_leitura', v_colunas);");
    expect(up.indexOf("execute 'revoke select on catalogo.produto_midia")).toBeGreaterThan(up.indexOf('add column hash_conteudo'));
    expect(down).toContain('revoke select on catalogo.produto_midia from macuxi_leitura;\ngrant select on catalogo.produto_midia to macuxi_leitura;');
    expect(down.indexOf('grant select on catalogo.produto_midia')).toBeGreaterThan(down.indexOf('drop column if exists hash_conteudo'));
  });

  it('fronteira: sem FK para core.* nem plataforma.arquivo (só tenant e dentro do schema)', () => {
    expect(up).not.toMatch(/references core\./);
    expect(up).not.toMatch(/references plataforma\.arquivo/);
    expect(umaLinha).toContain('constraint foto_lote_item_lote_fk foreign key (tenant_id, lote_id) references catalogo.foto_lote (tenant_id, id)');
    expect(umaLinha).toContain('constraint foto_lote_duplicado_de_fk foreign key (tenant_id, duplicado_de) references catalogo.foto_lote (tenant_id, id)');
  });

  it('down: confere os arquivos antes, desfaz tudo e devolve os CHECKs da 0005', () => {
    expect(down.indexOf("using errcode = '55000'")).toBeLessThan(down.indexOf('drop '));
    for (const trecho of [
      'drop index if exists core.produto_sku_lower_ix;',
      'drop index if exists catalogo.produto_midia_ordem_foto_uk;',
      'alter table catalogo.produto_midia drop constraint if exists produto_midia_principal_ordem;',
      'alter table catalogo.produto_midia alter column ordem set default 0;',
      'drop index if exists catalogo.produto_midia_hash_uk;',
      'alter table catalogo.produto_midia drop constraint if exists produto_midia_hash_hex;',
      'alter table catalogo.produto_midia drop column if exists hash_conteudo;',
      'drop table if exists catalogo.foto_lote_item;',
      'drop table if exists catalogo.foto_lote;',
      'drop table if exists plataforma.trabalho;',
      "add constraint arquivo_tipo_valido check (tipo in ('image/jpeg'));",
      "add constraint arquivo_recebido_completo check (\n  situacao <> 'recebido'\n  or (recebido_em is not null and sha256 is not null and tamanho_bytes is not null and chave_armazenamento is not null)\n);",
      'add constraint arquivo_tamanho_faixa check (tamanho_bytes is null or tamanho_bytes between 1 and 2097152);',
      ...FUNCOES.map((f) => `drop function if exists ${f};`),
    ]) expect(down).toContain(trecho);
    expect(down.indexOf('drop table if exists catalogo.foto_lote_item;')).toBeLessThan(down.indexOf('drop table if exists catalogo.foto_lote;'));
  });

  it('espelho Drizzle: mesmas colunas do SQL (trabalho, foto_lote, foto_lote_item, produto_midia.hash_conteudo e ordem padrão 1)', () => {
    expect(colunasDrizzle(esquemaPlataforma.trabalho)).toEqual(colunasDoSql('plataforma.trabalho').sort());
    expect(colunasDrizzle(nuvemCatalogo.fotoLote)).toEqual(colunasDoSql('catalogo.foto_lote').sort());
    expect(colunasDrizzle(nuvemCatalogo.fotoLoteItem)).toEqual(colunasDoSql('catalogo.foto_lote_item').sort());
    const midia = getTableConfig(nuvemCatalogo.produtoMidia).columns;
    expect(midia.find((c) => c.name === 'hash_conteudo')?.notNull).toBe(false);
    expect(midia.find((c) => c.name === 'ordem')?.default).toBe(1);
  });
});

describe.skipIf(semBanco())('0079 fotos em lote (banco, papel de aplicação, fixture dois-tenants)', () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });
  const q = (sql: string, p: readonly unknown[] = []) => app.query(sql, [...p]);
  const recusa = async (sql: string, p: readonly unknown[], code: string, trecho: string) => {
    await q('savepoint s');
    expect(await erroDe(q(sql, p)), sql).toMatchObject({ code, message: expect.stringContaining(trecho) });
    await q('rollback to savepoint s');
  };
  const id = (n: number) => `aaaaaaaa-0174-4000-8000-${String(n).padStart(12, '0')}`;
  const SHA1 = 'a'.repeat(64);
  const SHA2 = 'b'.repeat(64);
  const PRODUTO = A.produtos.p1;
  const PRODUTO2 = A.produtos.p2;

  const novoLote = (lote: string, zip: string, sha: string | null = null, situacao = 'aguardando_envio', extra = '', vals: unknown[] = []) =>
    q(
      `insert into catalogo.foto_lote (id, tenant_id, enviado_por, arquivo_id, nome_arquivo, tamanho_bytes, sha256, situacao${extra ? `, ${extra}` : ''})
       values ($1, $2, $3, $4, 'fotos.zip', 1048576, $5, $6${vals.map((_, i) => `, $${i + 7}`).join('')})`,
      [lote, A.tenantId, A.usuarios.analista, zip, sha, situacao, ...vals],
    );
  const novoItem = (item: number, lote: string, indice: number, situacao = 'pendente', extra = '', vals: unknown[] = []) =>
    q(
      `insert into catalogo.foto_lote_item (id, tenant_id, lote_id, indice, caminho, situacao, arquivo_id, midia_id${extra ? `, ${extra}` : ''})
       values ($1, $2, $3, $4, 'A1.jpg', $5, $6, $7${vals.map((_, i) => `, $${i + 8}`).join('')})`,
      [id(item), A.tenantId, lote, indice, situacao, id(item + 1000), id(item + 2000), ...vals],
    );

  it('arquivo: PNG/WEBP até 8 MiB e ZIP até 500 MiB; GIF, 8 MiB + 1 e ZIP de 500 MiB + 1 recusados (23514)', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const ins = `insert into plataforma.arquivo (id, tenant_id, modulo, finalidade, entidade, entidade_id, enviado_por, tipo, tamanho_bytes)
                   values (gen_random_uuid(), $1, 'catalogo', $2, $3, gen_random_uuid(), $4, $5, $6)`;
      const v = (tipo: string, bytes: number | null, finalidade = 'foto_produto', entidade = 'produto') => [A.tenantId, finalidade, entidade, A.usuarios.analista, tipo, bytes];
      for (const tipo of ['image/jpeg', 'image/png', 'image/webp']) await q(ins, v(tipo, 8 * MIB));
      await q(ins, v('application/zip', 500 * MIB, 'foto_lote', 'foto_lote'));
      await recusa(ins, v('image/png', 8 * MIB + 1), '23514', 'arquivo_tamanho_faixa');
      // o ZIP fica recebido sem sha256 (o SHA vai para o lote); a imagem recebida continua exigindo o sha256
      const recebido = `insert into plataforma.arquivo (id, tenant_id, modulo, finalidade, entidade, entidade_id, enviado_por, tipo, tamanho_bytes, situacao, recebido_em, chave_armazenamento)
                        values (gen_random_uuid(), $1, 'catalogo', $2, $3, gen_random_uuid(), $4, $5, $6, 'recebido', now(), 'x/catalogo/2026-11/z.p001.zip')`;
      await q(recebido, v('application/zip', 100 * MIB, 'foto_lote', 'foto_lote'));
      await recusa(recebido, v('image/webp', 1000), '23514', 'arquivo_recebido_completo');
      await recusa(ins, v('application/zip', 500 * MIB + 1, 'foto_lote', 'foto_lote'), '23514', 'arquivo_tamanho_faixa');
      // sem tamanho: só o tipo decide (o CHECK de tamanho vem antes na ordem dos nomes)
      await recusa(ins, v('image/gif', null), '23514', 'arquivo_tipo_valido');
      await recusa(ins, v('application/pdf', null), '23514', 'arquivo_tipo_valido');
    });
  });

  it('lote: o mesmo ZIP vivo uma vez no tenant (23505); duplicado e falhou não contam; B pode ter o mesmo SHA', async () => {
    await emTransacao(app, A.tenantId, async () => {
      await novoLote(id(1), id(101), SHA1, 'processando');
      await recusa(
        "insert into catalogo.foto_lote (tenant_id, enviado_por, arquivo_id, nome_arquivo, tamanho_bytes, sha256, situacao) values ($1, $2, $3, 'outro.zip', 10, $4, 'processando')",
        [A.tenantId, A.usuarios.analista, id(102), SHA1],
        '23505',
        'foto_lote_sha256_uk',
      );
      await novoLote(id(2), id(102), SHA1, 'duplicado', 'duplicado_de, concluido_em', [id(1), new Date()]);
      await novoLote(id(3), id(103), SHA1, 'falhou', 'concluido_em', [new Date()]);
      await recusa("insert into catalogo.foto_lote (tenant_id, enviado_por, arquivo_id, nome_arquivo, tamanho_bytes) values ($1, $2, $3, 'z.zip', 10)", [A.tenantId, A.usuarios.analista, id(101)], '23505', 'foto_lote_arquivo_uk');
      await q("select set_config('app.tenant_id', $1, true)", [B.tenantId]);
      await q(
        "insert into catalogo.foto_lote (tenant_id, enviado_por, arquivo_id, nome_arquivo, tamanho_bytes, sha256, situacao) values ($1, $2, $3, 'b.zip', 10, $4, 'processando')",
        [B.tenantId, B.usuarios.admin, id(101), SHA1],
      );
    });
  });

  it('lote: coerências (motivo só no recusado, duplicado_de só no duplicado, concluido_em só nos finais) e faixas', async () => {
    await emTransacao(app, A.tenantId, async () => {
      await novoLote(id(1), id(101));
      const upd = (set: string, p: unknown[] = []) => [`update catalogo.foto_lote set ${set} where id = $1`, [id(1), ...p]] as const;
      await recusa(...upd("situacao = 'recusado', concluido_em = now()"), '23514', 'foto_lote_motivo_coerente');
      await recusa(...upd("motivo = 'zip_grande'"), '23514', 'foto_lote_motivo_coerente');
      await recusa(...upd("situacao = 'recusado', motivo = 'zip_gigante', concluido_em = now()"), '23514', 'foto_lote_motivo_valido');
      await recusa(...upd("situacao = 'duplicado', concluido_em = now()"), '23514', 'foto_lote_duplicado_coerente');
      await recusa(...upd("situacao = 'duplicado', duplicado_de = id, concluido_em = now()"), '23514', 'foto_lote_duplicado_coerente');
      await recusa(...upd("situacao = 'concluido'"), '23514', 'foto_lote_concluido_coerente');
      await recusa(...upd("situacao = 'enviado'"), '23514', 'foto_lote_situacao_valida');
      await recusa(...upd('tamanho_bytes = $2', [500 * MIB + 1]), '23514', 'foto_lote_tamanho_faixa');
      await recusa(...upd("sha256 = 'ABC'"), '23514', 'foto_lote_sha256_hex');
      await recusa(...upd("nome_arquivo = '   '"), '23514', 'foto_lote_nome_tamanho');
      await recusa(...upd("situacao = 'duplicado', concluido_em = now(), duplicado_de = $2", [FOTO_LOTE_FIXTURE.B.lote]), '23503', 'foto_lote_duplicado_de_fk');
      await q(...upd("situacao = 'recusado', motivo = 'muitos_arquivos', concluido_em = now()"));
    });
  });

  it('item: checkpoint único por (lote, indice); ordem repetida no lote entre os ligado (foto_lote_item_ordem_uk); ids reservados únicos', async () => {
    await emTransacao(app, A.tenantId, async () => {
      await novoLote(id(1), id(101), SHA1, 'processando');
      await novoItem(1, id(1), 0);
      await novoItem(2, id(1), 1);
      // a conferência repetida não duplica (on conflict do nothing pelo checkpoint)
      const repete = await q(
        "insert into catalogo.foto_lote_item (tenant_id, lote_id, indice, caminho, arquivo_id, midia_id) values ($1, $2, 0, 'A1.jpg', gen_random_uuid(), gen_random_uuid()) on conflict (tenant_id, lote_id, indice) do nothing",
        [A.tenantId, id(1)],
      );
      expect(repete.rowCount).toBe(0);
      await recusa(
        "insert into catalogo.foto_lote_item (tenant_id, lote_id, indice, caminho, arquivo_id, midia_id) values ($1, $2, 0, 'A1.jpg', gen_random_uuid(), gen_random_uuid())",
        [A.tenantId, id(1)],
        '23505',
        'foto_lote_item_indice_uk',
      );
      await recusa(
        "insert into catalogo.foto_lote_item (tenant_id, lote_id, indice, caminho, arquivo_id, midia_id) values ($1, $2, 9, 'x.jpg', $3, gen_random_uuid())",
        [A.tenantId, id(1), id(1001)],
        '23505',
        'foto_lote_item_arquivo_uk',
      );
      const ligar = "update catalogo.foto_lote_item set situacao = 'ligado', produto_id = $2, ordem = 1, processado_em = now() where id = $1";
      await q(ligar, [id(1), PRODUTO]);
      await recusa(ligar, [id(2), PRODUTO], '23505', 'foto_lote_item_ordem_uk');
      // outro produto ou o mesmo como 'repetido' não colidem
      await q("update catalogo.foto_lote_item set situacao = 'repetido', produto_id = $2, ordem = 1 where id = $1", [id(2), PRODUTO]);
    });
  });

  it('item: coerências (motivo no recusado, candidatos no ambiguo, produto e ordem no ligado/repetido, faixas)', async () => {
    await emTransacao(app, A.tenantId, async () => {
      await novoLote(id(1), id(101), SHA1, 'processando');
      await novoItem(1, id(1), 0);
      const upd = (set: string, p: unknown[] = []) => [`update catalogo.foto_lote_item set ${set} where id = $1`, [id(1), ...p]] as const;
      await recusa(...upd("situacao = 'recusado'"), '23514', 'foto_lote_item_motivo_coerente');
      await recusa(...upd("situacao = 'recusado', motivo = 'gif'"), '23514', 'foto_lote_item_motivo_valido');
      await recusa(...upd("situacao = 'ambiguo'"), '23514', 'foto_lote_item_candidatos_coerente');
      await recusa(...upd("situacao = 'ambiguo', codigos_candidatos = '{a,b,c,d,e,f}'"), '23514', 'foto_lote_item_candidatos_coerente');
      await recusa(...upd("codigos_candidatos = '{ab,AB}'"), '23514', 'foto_lote_item_candidatos_coerente');
      await recusa(...upd("situacao = 'ligado'"), '23514', 'foto_lote_item_produto_coerente');
      await recusa(...upd('ordem = 100'), '23514', 'foto_lote_item_ordem_faixa');
      await recusa(...upd("tipo_detectado = 'image/gif'"), '23514', 'foto_lote_item_tipo_valido');
      await recusa(...upd("codigo = repeat('x', 101)"), '23514', 'foto_lote_item_codigo_tamanho');
      await recusa(...upd("caminho = ''"), '23514', 'foto_lote_item_caminho_tamanho');
      await recusa(...upd('indice = -1'), '23514', 'foto_lote_item_indice_faixa');
      await recusa(...upd('lote_id = $2', [FOTO_LOTE_FIXTURE.B.lote]), '23503', 'foto_lote_item_lote_fk');
      await q(...upd("situacao = 'ambiguo', codigos_candidatos = '{ab,AB}', codigo = 'Ab'"));
      await q(...upd("situacao = 'recusado', motivo = 'tipo_nao_aceito', tipo_detectado = 'image/png', codigos_candidatos = null"));
    });
  });

  it('produto_midia: mesma imagem viva no mesmo produto = 23505 (repetido); removida libera; outro produto pode', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const ins = "insert into catalogo.produto_midia (id, tenant_id, produto_id, tipo, arquivo_id, ordem, principal, hash_conteudo) values ($1, $2, $3, 'foto', gen_random_uuid(), $4, false, $5)";
      await q(ins, [id(11), A.tenantId, PRODUTO, 2, SHA2]);
      await recusa(ins, [id(12), A.tenantId, PRODUTO, 3, SHA2], '23505', 'produto_midia_hash_uk');
      await q(ins, [id(13), A.tenantId, PRODUTO2, 2, SHA2]);
      await recusa(ins, [id(14), A.tenantId, PRODUTO, 4, 'F'.repeat(64)], '23514', 'produto_midia_hash_hex');
      await q('update catalogo.produto_midia set deleted_at = now() where id = $1', [id(11)]);
      await q(ins, [id(15), A.tenantId, PRODUTO, 2, SHA2]);
      // a foto da ficha (sem hash) nunca é repetida
      await q("insert into catalogo.produto_midia (tenant_id, produto_id, tipo, url, ordem) values ($1, $2, 'foto', 'https://x/1.jpg', 5), ($1, $2, 'foto', 'https://x/1.jpg', 6)", [A.tenantId, PRODUTO]);
    });
  });

  it('produto_midia: principal só na ordem 1; ordem da foto viva única por produto; principal sem ordem (definirFotoPrincipal de hoje) nasce na 1', async () => {
    await emTransacao(app, A.tenantId, async () => {
      // a fixture tem a principal viva de ALFA-001 na ordem 1
      await recusa("insert into catalogo.produto_midia (tenant_id, produto_id, tipo, url, ordem) values ($1, $2, 'foto', 'https://x/2.jpg', 1)", [A.tenantId, PRODUTO], '23505', 'produto_midia_ordem_foto_uk');
      await recusa("insert into catalogo.produto_midia (tenant_id, produto_id, tipo, url, ordem, principal) values ($1, $2, 'foto', 'https://x/2.jpg', 2, true)", [A.tenantId, PRODUTO2], '23514', 'produto_midia_principal_ordem');
      // vídeo e PDF não entram no único da ordem; ordem 0 também não
      await q("insert into catalogo.produto_midia (tenant_id, produto_id, tipo, url, ordem) values ($1, $2, 'pdf', 'https://x/a.pdf', 1), ($1, $2, 'foto', 'https://x/0.jpg', 0)", [A.tenantId, PRODUTO]);
      // o mesmo SQL do definirFotoPrincipal (aposenta a anterior e insere sem ordem)
      await q("update catalogo.produto_midia set deleted_at = now() where tenant_id = $1 and produto_id = $2 and principal and deleted_at is null", [A.tenantId, PRODUTO]);
      const r = await q(
        "insert into catalogo.produto_midia (id, tenant_id, produto_id, tipo, arquivo_id, url, titulo, principal) values ($1, $2, $3, 'foto', null, 'https://x/nova.jpg', null, true) returning ordem",
        [id(21), A.tenantId, PRODUTO],
      );
      expect(r.rows).toEqual([{ ordem: 1 }]);
    });
  });

  it('trabalho: um vivo por alvo (on conflict do nothing); app não altera nem apaga (42501) nem executa as funções do worker', async () => {
    await emTransacao(app, A.tenantId, async () => {
      const ins = "insert into plataforma.trabalho (tenant_id, modulo, nome, alvo_id, evento_id) values ($1, 'catalogo', 'processar_foto_lote', $2, gen_random_uuid()) on conflict do nothing";
      expect((await q(ins, [A.tenantId, id(1)])).rowCount).toBe(1);
      expect((await q(ins, [A.tenantId, id(1)])).rowCount).toBe(0);
      await recusa("insert into plataforma.trabalho (tenant_id, modulo, nome, alvo_id) values ($1, 'Catalogo', 'x', $2)", [A.tenantId, id(2)], '23514', 'trabalho_modulo_formato');
      await recusa("insert into plataforma.trabalho (tenant_id, modulo, nome, alvo_id, ultimo_erro) values ($1, 'catalogo', 'x', $2, 'erro com espaço')", [A.tenantId, id(2)], '23514', 'trabalho_ultimo_erro_codigo');
      await recusa("insert into plataforma.trabalho (tenant_id, modulo, nome, alvo_id, situacao) values ($1, 'catalogo', 'x', $2, 'em_execucao')", [A.tenantId, id(2)], '23514', 'trabalho_trava_em_execucao');
      await recusa("insert into plataforma.trabalho (tenant_id, modulo, nome, alvo_id, situacao) values ($1, 'catalogo', 'x', $2, 'concluido')", [A.tenantId, id(2)], '23514', 'trabalho_concluido_coerente');
      await recusa("update plataforma.trabalho set situacao = 'concluido'", [], '42501', 'trabalho');
      await recusa('delete from plataforma.trabalho', [], '42501', 'trabalho');
      await recusa('delete from catalogo.foto_lote', [], '42501', 'foto_lote');
      await recusa('delete from catalogo.foto_lote_item', [], '42501', 'foto_lote_item');
      await recusa("select * from plataforma.trabalho_reservar('api', 60)", [], '42501', 'trabalho_reservar');
      await recusa("select plataforma.trabalho_devolver($1, 'api', 'concluido', null, null)", [id(1)], '42501', 'trabalho_devolver');
      await recusa("select plataforma.trabalho_renovar($1, 'api', 60)", [id(1)], '42501', 'trabalho_renovar');
    });
  });

  it('vazamento (critério 9): B não vê, não altera e não grava lote, item e trabalho de A; sem contexto, 0 linhas', async () => {
    const FA = FOTO_LOTE_FIXTURE.A;
    await emTransacao(app, B.tenantId, async () => {
      expect((await q('select id from catalogo.foto_lote where id = $1', [FA.lote])).rowCount).toBe(0);
      expect((await q('select id from catalogo.foto_lote_item where id = $1', [FA.item])).rowCount).toBe(0);
      expect((await q('select id from plataforma.trabalho where id = $1', [FA.trabalho])).rowCount).toBe(0);
      expect((await q("update catalogo.foto_lote set nome_arquivo = 'x.zip' where id = $1", [FA.lote])).rowCount).toBe(0);
      expect((await q("update catalogo.foto_lote_item set caminho = 'x' where id = $1", [FA.item])).rowCount).toBe(0);
      expect((await q('select id from catalogo.foto_lote')).rows.map((r) => r.id)).toEqual([FOTO_LOTE_FIXTURE.B.lote]);
      await recusa(
        "insert into catalogo.foto_lote (tenant_id, enviado_por, arquivo_id, nome_arquivo, tamanho_bytes) values ($1, $2, gen_random_uuid(), 'x.zip', 10)",
        [A.tenantId, A.usuarios.analista],
        '42501',
        'row-level security',
      );
      await recusa("insert into plataforma.trabalho (tenant_id, modulo, nome, alvo_id) values ($1, 'catalogo', 'x', gen_random_uuid())", [A.tenantId], '42501', 'row-level security');
    });
    await emTransacao(app, '', async () => {
      for (const t of TABELAS) expect((await q(`select id from ${t}`)).rowCount, t).toBe(0);
    });
  });
});

describe.skipIf(semBanco())('0079 up/down e funções do worker (banco efêmero)', () => {
  let b: BancoDeTeste;
  const T = 'cccccccc-0000-4000-8000-000000000080';
  const S = 'cccccccc-0000-4000-8000-000000000071';
  const U = 'cccccccc-0079-4000-8000-000000000001';
  const P1 = 'cccccccc-0079-4000-8000-000000000101';
  const P2 = 'cccccccc-0079-4000-8000-000000000102';
  const M = (n: number) => `cccccccc-0079-4000-8000-0000000002${String(n).padStart(2, '0')}`;
  const W = (n: number) => `cccccccc-0079-4000-8000-0000000003${String(n).padStart(2, '0')}`;
  /** hora-fixa-ok: updated_at antigo das mídias, só comparado com ele mesmo depois da migração. */
  const ANTIGO = '2026-01-02T03:04:05.000Z';
  let antes: string[];
  let depois: string[];
  /** O migrador embrulha o erro do Postgres (`cause`): devolve o SQLSTATE dele e a mensagem. */
  const falhaDaMigracao = async (p: Promise<unknown>) => {
    try {
      await p;
      return null;
    } catch (e) {
      return { code: (e as { cause?: { code?: string } }).cause?.code, message: (e as Error).message };
    }
  };

  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('up: aborta (55000) com foto viva não principal na ordem 1 ao lado da principal; corrigido, as principais vão a 1 SEM andar o updated_at', async () => {
    await comAdmin(b.nome, async (c) => {
      await migrarUp(c, { ate: '0078' });
      antes = await retratoDoCatalogo(c);
      await c.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'antigo70', 'Antigo')", [T]);
      const midia = "insert into catalogo.produto_midia (id, tenant_id, produto_id, tipo, url, ordem, principal, updated_at, deleted_at) values ($1, $2, $3, 'foto', 'https://x/f.jpg', $4, $5, $6, $7)";
      await c.query(midia, [M(1), T, P1, 0, true, ANTIGO, null]); // principal antiga, viva
      await c.query(midia, [M(2), T, P1, 0, true, ANTIGO, ANTIGO]); // principal antiga, removida
      await c.query(midia, [M(3), T, P2, 0, true, ANTIGO, null]);
      await c.query(midia, [M(4), T, P2, 1, false, ANTIGO, null]); // colidiria com a principal de P2 na ordem 1
      expect(await falhaDaMigracao(migrarUp(c, { ate: '0079' }))).toMatchObject({ code: '55000', message: expect.stringContaining('1 foto(s)') });
      await c.query('update catalogo.produto_midia set ordem = 2 where id = $1', [M(4)]);
      const tocadas = (await c.query<{ updated_at: Date }>('select updated_at from catalogo.produto_midia where id = $1', [M(4)])).rows[0]!.updated_at;
      expect((await migrarUp(c, { ate: '0079' })).aplicadas).toEqual(['0079_catalogo_foto_lote']);
      const r = await c.query<{ id: string; ordem: number; updated_at: Date }>('select id, ordem, updated_at from catalogo.produto_midia order by id');
      expect(r.rows.map((x) => [x.id, x.ordem])).toEqual([[M(1), 1], [M(2), 1], [M(3), 1], [M(4), 2]]);
      for (const x of r.rows.filter((y) => y.id !== M(4))) expect(x.updated_at.toISOString(), x.id).toBe(ANTIGO);
      expect(r.rows.find((x) => x.id === M(4))!.updated_at).toEqual(tocadas);
      // o gatilho voltou ligado: a próxima mudança anda o updated_at
      await c.query("update catalogo.produto_midia set titulo = 'x' where id = $1", [M(1)]);
      expect((await c.query<{ n: number }>("select count(*)::int as n from catalogo.produto_midia where id = $1 and updated_at > $2", [M(1), ANTIGO])).rows[0]!.n).toBe(1);
      depois = await retratoDoCatalogo(c);
      for (const t of TABELAS) expect(depois).toContain(`rel ${t} r rls=true force=true`);
      expect(depois).toContain('col catalogo.produto_midia.hash_conteudo text nn=false');
      for (const f of ['trabalho_reservar(p_processo text, p_trava_s integer)', 'trabalho_renovar(p_id uuid, p_processo text, p_trava_s integer)']) expect(depois).toContain(`fn plataforma.${f}`);
    });
  });

  it('down: aborta (55000) com arquivo ZIP; sem ele, volta ao catálogo da 0078; idempotente; up de novo igual', async () => {
    await comAdmin(b.nome, async (c) => {
      await c.query("insert into core.usuario (id, tenant_id, nome, email, perfil, senha_hash) values ($1, $2, 'Analista', 'a@x.com.br', 'analista', $3)", [U, T, HASH_TESTE]);
      const zip = (
        await c.query<{ id: string }>(
          "insert into plataforma.arquivo (tenant_id, modulo, finalidade, entidade, entidade_id, enviado_por, tipo, tamanho_bytes) values ($1, 'catalogo', 'foto_lote', 'foto_lote', gen_random_uuid(), $2, 'application/zip', 104857600) returning id",
          [T, U],
        )
      ).rows[0]!.id;
      expect(await falhaDaMigracao(migrarDown(c, { passos: 1 }))).toMatchObject({ code: '55000', message: expect.stringContaining('1 arquivo(s)') });
      await c.query('delete from plataforma.arquivo where id = $1', [zip]);
      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0079_catalogo_foto_lote']);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await c.query(m79.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: '0079' });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });

  it('worker: reservar não entrega o mesmo trabalho a dois processos (skip locked), pula tenant suspenso e o futuro', async () => {
    await comAdmin(b.nome, async (c) => {
      await c.query("insert into plataforma.tenant (id, codigo, nome, status) values ($1, 'suspenso70', 'Suspenso', 'suspenso')", [S]);
      const ins = "insert into plataforma.trabalho (id, tenant_id, modulo, nome, alvo_id, proxima_em) values ($1, $2, 'catalogo', 'processar_foto_lote', gen_random_uuid(), now() + $3::interval)";
      await c.query(ins, [W(1), T, '-2 minutes']);
      await c.query(ins, [W(2), T, '-1 minute']);
      await c.query(ins, [W(3), S, '-3 minutes']); // tenant suspenso: nunca sai
      await c.query(ins, [W(4), T, '1 hour']); // ainda não venceu
    });
    await comAdmin(b.nome, async (c1) => {
      await comAdmin(b.nome, async (c2) => {
        const reservar = async (c: pg.Client, processo: string) => {
          await c.query('begin');
          await c.query('set local role macuxi_worker');
          return (await c.query<{ id: string; fatias: number; tentativas: number }>('select * from plataforma.trabalho_reservar($1, 120)', [processo])).rows;
        };
        const r1 = await reservar(c1, 'proc-1');
        const r2 = await reservar(c2, 'proc-2'); // c1 ainda não fez commit: a linha de W(1) está travada
        expect(r1.map((x) => x.id)).toEqual([W(1)]);
        expect(r2.map((x) => x.id)).toEqual([W(2)]);
        await c1.query('commit');
        await c2.query('commit');
        expect(await reservar(c1, 'proc-3')).toEqual([]);
        await c1.query('commit');
      });
    });
  });

  it('worker: devolver só com a trava; continua/adiar/erro/falhou/concluido; trava vencida volta para outro processo', async () => {
    await comAdmin(b.nome, async (c) => {
      const w = <T extends pg.QueryResultRow>(sql: string, p: unknown[] = []) =>
        c.query('begin').then(async () => {
          await c.query('set local role macuxi_worker');
          try {
            return (await c.query<T>(sql, p)).rows;
          } finally {
            await c.query('commit');
          }
        });
      const devolver = (id: string, proc: string, res: string, erro: string | null, espera: number | null) =>
        w<{ ok: boolean }>('select plataforma.trabalho_devolver($1, $2, $3, $4, $5) as ok', [id, proc, res, erro, espera]).then((r) => r[0]!.ok);
      const linha = async (id: string) =>
        (await c.query('select situacao, fatias, tentativas, ultimo_erro, travado_por, (concluido_em is not null) as fim, proxima_em > now() as futuro from plataforma.trabalho where id = $1', [id])).rows[0];

      expect(await devolver(W(1), 'outro', 'continua', null, null)).toBe(false);
      expect(await devolver(W(1), 'proc-1', 'continua', null, null)).toBe(true);
      expect(await linha(W(1))).toEqual({ situacao: 'pendente', fatias: 1, tentativas: 0, ultimo_erro: null, travado_por: null, fim: false, futuro: false });
      expect(await devolver(W(1), 'proc-1', 'concluido', null, null)).toBe(false); // já devolvido: sem trava

      expect(await devolver(W(2), 'proc-2', 'erro', 'ETIMEDOUT', 30)).toBe(true);
      expect(await linha(W(2))).toEqual({ situacao: 'pendente', fatias: 0, tentativas: 1, ultimo_erro: 'ETIMEDOUT', travado_por: null, fim: false, futuro: true });
      expect((await erroDe(w('select plataforma.trabalho_devolver($1, $2, $3, $4, $5)', [W(2), 'p', 'erro', null, 30])))?.code).toBe('22023');
      expect((await erroDe(w('select plataforma.trabalho_devolver($1, $2, $3, $4, $5)', [W(2), 'p', 'pausar', null, 30])))?.code).toBe('22023');
      expect((await erroDe(w('select * from plataforma.trabalho_reservar($1, 0)', ['p'])))?.code).toBe('22023');

      // W(1) volta (pendente, proxima_em = now()); trava curta vence e outro processo assume; o antigo perde a trava
      expect((await w<{ id: string }>('select id from plataforma.trabalho_reservar($1, 60)', ['proc-a'])).map((x) => x.id)).toEqual([W(1)]);
      expect((await w<{ ok: boolean }>('select plataforma.trabalho_renovar($1, $2, 60) as ok', [W(1), 'proc-a']))[0]!.ok).toBe(true);
      expect((await w<{ ok: boolean }>('select plataforma.trabalho_renovar($1, $2, 60) as ok', [W(1), 'proc-b']))[0]!.ok).toBe(false);
      await c.query("update plataforma.trabalho set travado_ate = now() - interval '1 second' where id = $1", [W(1)]);
      expect((await w<{ id: string; fatias: number }>('select id, fatias from plataforma.trabalho_reservar($1, 60)', ['proc-b']))).toEqual([{ id: W(1), fatias: 1 }]);
      expect(await devolver(W(1), 'proc-a', 'concluido', null, null)).toBe(false);
      expect(await devolver(W(1), 'proc-b', 'adiar', null, 900)).toBe(true);
      expect(await linha(W(1))).toEqual({ situacao: 'pendente', fatias: 1, tentativas: 0, ultimo_erro: null, travado_por: null, fim: false, futuro: true });

      // erro sem espera = falhou (definitivo); concluido fecha com concluido_em
      await c.query("update plataforma.trabalho set proxima_em = now() - interval '1 minute' where id in ($1, $2)", [W(1), W(2)]);
      const [x] = await w<{ id: string }>('select id from plataforma.trabalho_reservar($1, 60)', ['proc-c']);
      const [y] = await w<{ id: string }>('select id from plataforma.trabalho_reservar($1, 60)', ['proc-c']);
      expect(await devolver(x!.id, 'proc-c', 'erro', 'RN-CAT-14', null)).toBe(true);
      expect(await devolver(y!.id, 'proc-c', 'concluido', null, null)).toBe(true);
      expect((await linha(x!.id))).toMatchObject({ situacao: 'falhou', fim: true, ultimo_erro: 'RN-CAT-14' });
      expect((await linha(y!.id))).toMatchObject({ situacao: 'concluido', fim: true });
      expect(await w('select * from plataforma.trabalho_reservar($1, 60)', ['proc-c'])).toEqual([]);
    });
  });
});
