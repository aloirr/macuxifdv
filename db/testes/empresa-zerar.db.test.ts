/**
 * 0099 — "Zerar dados" da empresa pelo portal (v1.0.30; ADR 0068; desenho docs/desenho/empresa-zerar.md §4 e §5; RN-PLA-12).
 * Dicionário: docs/banco/plataforma.md ("Zerar dados da empresa (0099)"). O que o BANCO garante:
 * - classificação: toda tabela com tenant_id está na lista das que saem (abaixo) ou nas mantidas (tabelas_mantidas_no_zerar);
 *   uma tabela nova sem classificação reprova;
 * - prévia = contagem real do que sai, na ordem de FK; o zerar apaga numa transação (erro no meio = nada apagado), copia
 *   antes cada linha, mantém as configurações, os usuários e os conectores, deixa a filial padrão e os usuários nela
 *   (RN-CORE-39), zera os cursores do Hub e a outbox do tenant, gira a geração da base, semeia a forma e o prazo padrão e audita
 *   tenant.zerado sem dado pessoal; o outro tenant fica intacto;
 * - só o super-admin (sa_* 28000/42501), pedido idempotente pelo id, recusas com o código do contrato no hint;
 * - restaurar_zerar volta as contagens de toda tabela; o expurgo apaga a cópia e as chaves;
 * - a excluir_tenant (0032) segue com o mesmo resultado sobre o laço comum (lgpd-outbox.test.ts e empresa-acoes.db.test.ts);
 * - up/down exato.
 * Estático (sempre) + banco efêmero com a fixture dois-tenants (cada caso numa transação desfeita).
 * As constantes do contrato (packages/platform-sdk/src/empresa-zerar.ts) ficam repetidas aqui até o SDK entrar no main com
 * esta migração (PR conjunto alexandre/migracao-zerar).
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOIS_TENANTS, FILIAIS_FIXTURE } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { TABELAS_SEM_TENANT_ID, TABELAS_SO_POR_FUNCAO } from '../src/excecoes';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { agoraDaFixture, semBanco } from './estado';
import { carregarFixtureDosTestes } from './fixture-treinamento';
import { FUNCOES_SA_ATUAIS, FUNCOES_SA_ZERAR, FUNCOES_WORKER_ZERAR } from './funcoes-sa';
import { comoPapel, erroDe, HASH_TESTE, retratoDoCatalogo, tabelasComTenant } from './util';

const migracoes = lerMigracoes();
const m32 = migracoes.find((m) => m.versao === '0032')!;
const m99 = migracoes.find((m) => m.versao === '0099')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(m99.up);
const down = semComentarios(m99.down);
/** Do início até o `$$;` que fecha a função. */
const bloco = (sql: string, inicio: string) => {
  const i = sql.indexOf(inicio);
  if (i < 0) return '';
  const fim = /^\$\$;$/m.exec(sql.slice(i));
  return fim ? sql.slice(i, i + fim.index + fim[0].length) : '';
};
const nomeDe = (f: string) => f.slice(0, f.indexOf('('));

/** Contrato (packages/platform-sdk/src/empresa-zerar.ts): LIMITE_LINHAS_ZERAR, RETENCAO_COPIA_ZERAR_DIAS, situações e origens. */
const LIMITE_LINHAS_ZERAR = 2_000_000;
const RETENCAO_COPIA_ZERAR_DIAS = 7;
const SITUACOES_ZERAR = ['em_andamento', 'concluido', 'falhou'];
const ORIGENS_ZERAR = ['portal', 'workflow'];

const TABELAS = ['plataforma.zerar_empresa', 'plataforma.zerar_empresa_copia', 'plataforma.zerar_empresa_objeto'];
/** Só do dono (SECURITY INVOKER, sem EXECUTE para ninguém): a regra, o workflow, o desfazer e as internas. */
const DO_DONO = [
  'plataforma.zerar_tenant(uuid)',
  'plataforma.zerar_tenant_manual(uuid, text)',
  'plataforma.restaurar_zerar(uuid)',
  'plataforma.tabelas_mantidas_no_zerar()',
  'plataforma.alvos_do_zerar(uuid)',
  'plataforma.previa_do_zerar(uuid)',
  'plataforma.zerar_bloqueado(uuid, uuid, bigint)',
  'plataforma.zerar_empresa_json(plataforma.zerar_empresa)',
  'plataforma.tabelas_com_tenant()',
  'plataforma.passos_em_ordem_fk(oid[])',
  'plataforma.apagar_em_ordem_fk(uuid, jsonb, uuid)',
];

/**
 * RN-PLA-12 — as tabelas que SAEM inteiras (desenho §4: 110 na 0097, mais as que vieram depois). Tabela nova com tenant_id: o
 * autor da migração a põe aqui (dado) ou em plataforma.tabelas_mantidas_no_zerar() e em MANTIDAS (configuração).
 */
const SAEM = [
  'catalogo.busca_log', 'catalogo.catalogo_no', 'catalogo.cliente_tabela_preco', 'catalogo.deposito', 'catalogo.estoque_saldo',
  'catalogo.foto_lote', 'catalogo.foto_lote_item', 'catalogo.marca_concorrente', 'catalogo.produto_atributo', 'catalogo.produto_busca',
  'catalogo.produto_conteudo', 'catalogo.produto_midia', 'catalogo.produto_no', 'catalogo.produto_referencia', 'catalogo.produto_relacao',
  'catalogo.sinonimo', 'catalogo.tabela_escalonada', 'catalogo.tabela_preco', 'catalogo.tabela_preco_item', 'catalogo.uso_ia',
  'core.carteira', 'core.cliente', 'core.cliente_contato', 'core.cliente_endereco', 'core.cliente_financeiro', 'core.cliente_foto',
  'core.deslocamento_dia', 'core.documento_cliente', 'core.documento_excecao', 'core.historico_compra', 'core.indicador_diario',
  'core.meta', 'core.nota_erp', 'core.notificacao', 'core.ponto_trajeto', 'core.produto', 'core.produto_unidade', 'core.rota',
  'core.rota_parada', 'core.tarefa', 'core.tarefa_destinatario', 'core.titulo', 'core.visita', 'core.visita_etapa',
  'vendedor.cliente_condicao', 'vendedor.condicao_pagamento', 'vendedor.forma_pagamento', 'vendedor.prazo_pagamento',
  'vendedor.transportadora', 'vendedor.pedido', 'vendedor.pedido_item', 'vendedor.pedido_aprovacao', 'vendedor.pedido_devolucao',
  'vendedor.pedido_evento', 'vendedor.pedido_faturamento',
  'integracao.lote', 'integracao.lote_linha_erro', 'integracao.lote_staging', 'integracao.registro_atual', 'integracao.cursor_entidade',
  'integracao.sessao_carga', 'integracao.sessao_carga_recebido', 'integracao.pedido_fila_erp', 'integracao.cliente_fila_erp',
  'integracao.pedido_retorno', 'integracao.pedido_retorno_erro', 'integracao.pendencia_inativacao', 'integracao.inativacao_auditoria',
  'integracao.reconciliacao', 'integracao.coleta_execucao', 'integracao.implantacao_dia',
  'promotor.acao_concorrencia', 'promotor.categoria_gondola', 'promotor.checklist_loja', 'promotor.checklist_resposta',
  'promotor.coleta_preco', 'promotor.concorrente', 'promotor.foto_coleta', 'promotor.foto_referencia', 'promotor.gondola_registro',
  'promotor.medicao_share', 'promotor.meta_share', 'promotor.mix_obrigatorio', 'promotor.ponto_extra', 'promotor.ponto_extra_negociado',
  'promotor.produto_concorrente', 'promotor.ruptura_item', 'promotor.tarefa_execucao', 'promotor.tarefa_trade', 'promotor.validade_item',
  'promotor.visita_loja',
  'pesquisa.resposta', 'pesquisa.resposta_item', 'pesquisa.resposta_foto',
  'treinamento.progresso', 'treinamento.tentativa', 'treinamento.xp_lancamento', 'treinamento.medalha_usuario',
  'treinamento.desafio_vendas', 'treinamento.desafio_vendas_produto',
  'gestor.alerta', 'gestor.evento_aplicado', 'gestor.projecao_fato',
  'plataforma.evento', 'plataforma.evento_consumo', 'plataforma.trabalho', 'plataforma.email_saida', 'plataforma.diagnostico',
  'plataforma.sync_pacote', 'plataforma.sync_pacote_pedido',
  // 0098 (v1.0.29, sessão C): tentativas do pré-cadastro do cliente
  'core.cliente_pre_cadastro_tentativa',
];
/** As que FICAM inteiras (iguais à plataforma.tabelas_mantidas_no_zerar(), parcial = false). */
const MANTIDAS = [
  'plataforma.assinatura', 'plataforma.assinatura_historico', 'plataforma.tenant_modulo', 'plataforma.perfil', 'plataforma.perfil_modulo',
  'plataforma.perfil_permissao', 'plataforma.usuario_perfil', 'plataforma.usuario_modulo', 'plataforma.parametro', 'plataforma.auditoria',
  'core.usuario', 'core.usuario_contato', 'core.usuario_avatar', 'core.usuario_convite', 'core.usuario_codigo_fdv_contador', 'core.equipe',
  'core.sessao', 'core.dispositivo', 'core.ausencia_usuario', 'core.motivo', 'core.medida', 'core.foto_tipo', 'core.frase_dia',
  'core.documento_tipo', 'core.documento_permissao', 'core.plano_rv', 'core.meta_produtividade',
  'vendedor.numeracao_pedido',
  'integracao.conector', 'integracao.conector_api', 'integracao.credencial', 'integracao.credencial_erp', 'integracao.mapeamento',
  'integracao.politica_versao', 'integracao.implantacao',
  'gestor.alerta_regra', 'pesquisa.questionario', 'pesquisa.questionario_versao',
  'treinamento.trilha', 'treinamento.modulo_trilha', 'treinamento.licao', 'treinamento.quiz', 'treinamento.questao',
  'treinamento.alternativa', 'treinamento.trilha_publicacao', 'treinamento.medalha',
];
/** Parciais: entram no conjunto com filtro por linha (fica a filial padrão, a (usuário, padrão) e o arquivo do avatar). */
const PARCIAIS = ['core.filial', 'core.usuario_filial', 'plataforma.arquivo'];

/** Classificação: o que o catálogo tem e nenhuma das listas cobre (deve ser vazio). */
const semClassificacao = (catalogo: string[]) => catalogo.filter((t) => !SAEM.includes(t) && !MANTIDAS.includes(t) && !PARCIAIS.includes(t));

describe('0099 zerar dados da empresa (estático)', () => {
  it('nome e posição: 0099_plataforma_zerar_empresa logo depois da 0098', () => {
    const i = migracoes.findIndex((m) => m.versao === '0099');
    expect(`${m99.versao}_${m99.nome}`).toBe('0099_plataforma_zerar_empresa');
    expect(migracoes[i - 1]?.versao).toBe('0098');
  });

  it('as 3 tabelas: sem tenant_id, só por função (sem grant), RLS forçado, só a política manutencao; empresa_id sem FK', () => {
    for (const t of TABELAS) {
      expect(TABELAS_SEM_TENANT_ID, t).toHaveProperty([t]);
      expect(TABELAS_SO_POR_FUNCAO, t).toContain(t);
      expect(up).toContain(`alter table ${t} force row level security;`);
      expect(up).toContain(`revoke all on ${t} from public, macuxi_app, macuxi_worker;`);
      expect(up).toContain(`create policy manutencao on ${t} for all to macuxi_manutencao using (true) with check (true);`);
    }
    expect(up).not.toMatch(/references plataforma\.tenant/);
    expect(up).toContain("create unique index zerar_empresa_em_andamento_uk on plataforma.zerar_empresa (empresa_id) where situacao = 'em_andamento';");
    expect([...up.matchAll(/\bgrant ([^;]+);/g)].map((x) => x[1]!).filter((g) => !g.startsWith('execute on function '))).toEqual([]);
  });

  it('listas fechadas do banco = contrato (situações e origens); prazo de 7 dias e limite de 2 milhões', () => {
    const lista = (re: RegExp) => [...(re.exec(up)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect(lista(/constraint zerar_empresa_situacao_valida check \(situacao in \(([^)]+)\)\)/)).toEqual(SITUACOES_ZERAR);
    expect(lista(/constraint zerar_empresa_origem_valida check \(origem in \(([^)]+)\)\)/)).toEqual(ORIGENS_ZERAR);
    expect(bloco(up, 'create function plataforma.executar_zerar(')).toContain(`copia_expira_em = v_agora + interval '${RETENCAO_COPIA_ZERAR_DIAS} days'`);
    expect(bloco(up, 'create function plataforma.zerar_bloqueado(')).toContain(`if p_total > ${LIMITE_LINHAS_ZERAR} then`);
  });

  it('zerar_bloqueado: as recusas da conferirZerar na mesma ordem', () => {
    const b = bloco(up, 'create function plataforma.zerar_bloqueado(');
    const ordem = ['TENANT_NAO_ENCONTRADO', 'EXCLUSAO_EM_ANDAMENTO', 'ZERAR_EM_ANDAMENTO', 'BACKUP_EM_ANDAMENTO', 'ZERAR_VOLUME_ALTO'];
    const pos = ordem.map((c) => b.indexOf(`return '${c}';`));
    expect(pos.every((p) => p > 0)).toBe(true);
    expect([...pos].sort((x, y) => x - y)).toEqual(pos);
  });

  it('funções: sa_* só ao portal (28000/42501), as do worker só ao worker e sem argumento de tenant, as do dono de ninguém', () => {
    for (const f of FUNCOES_SA_ZERAR) {
      const b = bloco(up, `create function ${nomeDe(f)}(`);
      expect(b, f).toMatch(/language plpgsql volatile security definer\s+set search_path = pg_catalog, plataforma, pg_temp/);
      expect(b, f).toMatch(/if v_tipo is null then\s+raise exception '[^']+' using errcode = '28000';/);
      expect(b, f).toMatch(/if v_tipo is distinct from 'super_admin' or v_sa is null then\s+raise exception '[^']+' using errcode = '42501';/);
      expect(up).toContain(`revoke all on function ${f} from public, macuxi_app, macuxi_worker;`);
      expect(up).toContain(`grant execute on function ${f} to macuxi_portal;`);
    }
    expect(FUNCOES_SA_ATUAIS).toHaveLength(41);
    expect(FUNCOES_SA_ATUAIS).toEqual(expect.arrayContaining([...FUNCOES_SA_ZERAR]));
    expect(up).toContain('if v_n <> 41 then');
    for (const f of FUNCOES_WORKER_ZERAR) {
      const b = bloco(up, `create function ${nomeDe(f)}(`);
      expect(b, f).toMatch(/security definer\s+set search_path = pg_catalog, plataforma, pg_temp/);
      expect(b.slice(0, b.indexOf(')')), f).not.toMatch(/tenant/);
      expect(up).toContain(`revoke all on function ${f} from public;`);
      expect(up).toContain(`grant execute on function ${f} to macuxi_worker;`);
    }
    for (const f of DO_DONO) {
      expect(bloco(up, `create function ${nomeDe(f)}(`), f).toMatch(/security invoker\s+set search_path = pg_catalog, plataforma, pg_temp/);
      expect(up).toContain(`revoke all on function ${f} from public;`);
      expect(up).not.toContain(`grant execute on function ${f} `);
    }
  });

  it('auditoria sem dado pessoal; códigos do contrato no hint (409/422/404)', () => {
    for (const c of ['TENANT_NAO_ENCONTRADO', 'ZERAR_CODIGO_NAO_CONFERE']) expect(up).toContain(`hint = '${c}'`);
    expect(bloco(up, 'create function plataforma.sa_pedir_zerar(')).toContain("if v_bloqueio in ('EXCLUSAO_EM_ANDAMENTO', 'ZERAR_EM_ANDAMENTO', 'BACKUP_EM_ANDAMENTO') then");
    const aud = up.split('\n').filter((l) => /sa_registrar_auditoria|jsonb_build_object\('(zerar_id|tenant_id)'/.test(l)).join('\n');
    expect(aud).not.toMatch(/nome|email|cnpj|documento|razao|senha/);
  });

  it('excluir_tenant recriada sobre o laço comum: mesma assinatura, invoker, sem grant; o down volta ao corpo da 0032', () => {
    const b = bloco(up, 'create or replace function plataforma.excluir_tenant(');
    expect(b).toMatch(/create or replace function plataforma\.excluir_tenant\(p_tenant uuid, p_codigo text\)\s+returns table \(tabela text, quantidade bigint\)\s+language plpgsql volatile\s+set search_path = pg_catalog, plataforma, pg_temp/);
    expect(b).toContain('plataforma.apagar_em_ordem_fk(');
    expect(b).not.toMatch(/security definer|session_replication_role/);
    for (const c of ["'22004'", "'P0002'", "'22023'", "'55000'"]) expect(b).toContain(`errcode = ${c}`);
    const da0032 = bloco(m32.up, 'create or replace function plataforma.excluir_tenant(');
    expect(da0032.length).toBeGreaterThan(100);
    expect(m99.down).toContain(da0032);
  });

  it('down: apaga o que o up cria, tabelas filhas antes das mães, sem grant', () => {
    for (const f of [...FUNCOES_SA_ZERAR, ...FUNCOES_WORKER_ZERAR, ...DO_DONO]) expect(down, f).toContain(`drop function if exists ${f};`);
    const pos = ['plataforma.zerar_empresa_objeto', 'plataforma.zerar_empresa_copia', 'plataforma.zerar_empresa'].map((t) => down.indexOf(`drop table if exists ${t};`));
    expect(pos.every((p) => p > 0)).toBe(true);
    expect([...pos].sort((x, y) => x - y)).toEqual(pos);
    // a excluir_tenant volta antes de o laço comum sair
    expect(down.indexOf('create or replace function plataforma.excluir_tenant(')).toBeLessThan(down.indexOf('drop function if exists plataforma.apagar_em_ordem_fk('));
    expect(down).not.toMatch(/\bgrant\b/);
  });

  it('listas do teste sem repetição e sem tabela nas duas', () => {
    const todas = [...SAEM, ...MANTIDAS, ...PARCIAIS];
    expect(new Set(todas).size).toBe(todas.length);
  });
});

describe.skipIf(semBanco())('0099 zerar dados da empresa (banco efêmero, fixture dois-tenants)', () => {
  let b: BancoDeTeste;
  let admin: pg.Client;
  const A = DOIS_TENANTS.A;
  const B = DOIS_TENANTS.B;
  const PADRAO_A = FILIAIS_FIXTURE.A.padrao;
  const BOA_VISTA = FILIAIS_FIXTURE.A.boaVista;
  const id = (n: number) => `00990000-0000-4000-8000-${String(n).padStart(12, '0')}`;

  beforeAll(async () => {
    b = await criarBancoDeTeste({ preparar: (c) => carregarFixtureDosTestes(c, { agora: agoraDaFixture() }) });
    admin = new pg.Client({ connectionString: b.urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
    await b?.apagar();
  });

  const q = async <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await admin.query<T>(sql, params)).rows;
  const portal = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await comoPapel<{ r: T }>(admin, 'macuxi_portal', sql, params)).rows[0]!.r;
  const worker = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await comoPapel<{ r: T }>(admin, 'macuxi_worker', sql, params)).rows[0]!.r;
  const abrir = async (p: unknown) => (await comoPapel<{ sessao_id: string }>(admin, 'macuxi_portal', 'select * from plataforma.sa_abrir_sessao_portal($1::jsonb)', [JSON.stringify(p)])).rows[0]!;
  async function sessaoSuperAdmin() {
    const sa = (await q<{ r: { super_admin_id: string } }>('select plataforma.criar_super_admin($1::jsonb) as r', [JSON.stringify({ acao: 'criar', email: 'operador.zerar@macuxi.exemplo', nome: 'Operador 0099', senha_hash: HASH_TESTE })]))[0]!.r;
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
  /** Comando do admin que deve falhar, num savepoint (o erro não aborta a transação do caso): SQLSTATE e hint. */
  async function falhaAdmin(sql: string, params: unknown[] = []) {
    await admin.query('savepoint falha_admin');
    const e = await falha(admin.query(sql, params));
    await admin.query(e ? 'rollback to savepoint falha_admin' : 'release savepoint falha_admin');
    return e;
  }
  /** Transação do caso, sempre desfeita (o banco efêmero volta à fixture). */
  async function caso(fn: () => Promise<void>) {
    await admin.query('begin');
    try {
      await fn();
    } finally {
      await admin.query('rollback');
    }
  }
  /** Linhas por tabela com tenant_id, do tenant. */
  async function contar(tenant: string) {
    const mapa: Record<string, number> = {};
    for (const t of await tabelasComTenant(admin)) {
      mapa[t.nome] = (await q<{ n: number }>(`select count(*)::int as n from ${t.schema}.${t.tabela} where tenant_id = $1`, [tenant]))[0]!.n;
    }
    return mapa;
  }
  const pedir = (sid: string, t: string, z: string, codigo: string) => portal('select plataforma.sa_pedir_zerar($1, $2, $3, $4) as r', [sid, t, z, codigo]);

  /**
   * Monta em A o que a fixture não tem: o supervisor com cadastro na Boa Vista (já vende lá), o vendedor 1 só na Boa Vista (sem
   * a padrão: o zerar cria a (usuário, padrão)) e um arquivo de avatar vivo (fica) ao lado das fotos de cliente (saem).
   */
  async function montarA() {
    await q('update core.usuario set filial_cadastro_id = $2 where id = $1', [A.usuarios.supervisor, BOA_VISTA]);
    await q('insert into core.usuario_filial (tenant_id, usuario_id, filial_id) values ($1, $2, $3)', [A.tenantId, A.usuarios.vendedor1, BOA_VISTA]);
    await q('update core.usuario set filial_cadastro_id = $2 where id = $1', [A.usuarios.vendedor1, BOA_VISTA]);
    await q('delete from core.usuario_filial where usuario_id = $1 and filial_id = $2', [A.usuarios.vendedor1, PADRAO_A]);
    await q(
      `insert into plataforma.arquivo (id, tenant_id, modulo, finalidade, entidade, entidade_id, cliente_id, enviado_por, tipo, tamanho_bytes,
                                       sha256, largura_px, altura_px, situacao, recebido_em, chave_armazenamento, perfis_leitura)
       select $2, tenant_id, modulo, finalidade, entidade, entidade_id, null, enviado_por, tipo, tamanho_bytes, sha256, largura_px, altura_px,
              situacao, recebido_em, tenant_id || '/core/avatar-0099.jpg', null
         from plataforma.arquivo where tenant_id = $1 and chave_armazenamento is not null order by id limit 1`,
      [A.tenantId, id(900)],
    );
    await q("update core.usuario_avatar set tipo = 'foto', avatar_codigo = null, arquivo_id = $2 where tenant_id = $1 and usuario_id = $3", [A.tenantId, id(900), A.usuarios.supervisor]);
    await q('set constraints all immediate');
    await q('set constraints all deferred');
  }

  it('classificação: toda tabela com tenant_id sai ou fica; o conjunto do banco = a lista do teste; tabela nova reprova', async () => {
    await caso(async () => {
      const catalogo = (await tabelasComTenant(admin)).map((t) => t.nome);
      expect(semClassificacao(catalogo)).toEqual([]);
      expect([...SAEM, ...MANTIDAS, ...PARCIAIS].filter((t) => !catalogo.includes(t))).toEqual([]);
      const mantidas = await q<{ tabela: string; parcial: boolean }>('select tabela, parcial from plataforma.tabelas_mantidas_no_zerar()');
      expect(mantidas.filter((m) => !m.parcial).map((m) => m.tabela).sort()).toEqual([...MANTIDAS].sort());
      expect(mantidas.filter((m) => m.parcial).map((m) => m.tabela).sort()).toEqual([...PARCIAIS].sort());
      const alvos = (await q<{ k: string }>('select jsonb_object_keys(plataforma.alvos_do_zerar($1)) as k', [A.tenantId])).map((x) => x.k);
      expect(alvos.sort()).toEqual([...SAEM, ...PARCIAIS].sort());
      // uma tabela nova com tenant_id entra sozinha no conjunto e a classificação do teste a acusa
      await q('create table core.nova_0099 (id uuid primary key, tenant_id uuid not null references plataforma.tenant (id))');
      expect(semClassificacao((await tabelasComTenant(admin)).map((t) => t.nome))).toEqual(['core.nova_0099']);
      expect((await q<{ k: string }>('select jsonb_object_keys(plataforma.alvos_do_zerar($1)) as k', [A.tenantId])).map((x) => x.k)).toContain('core.nova_0099');
    });
  });

  it('acesso: 42501 nas 3 tabelas para app, worker e portal; funções só pelo papel certo', async () => {
    await caso(async () => {
      for (const t of TABELAS) {
        for (const papel of ['macuxi_app', 'macuxi_worker', 'macuxi_portal']) {
          expect((await erroDe(comoPapel(admin, papel, `select 1 from ${t} limit 1`)))?.code, `${papel} ${t}`).toBe('42501');
        }
      }
      const r = await q<{ f: string; app: boolean; worker: boolean; portal: boolean; definer: boolean }>(
        `select f, has_function_privilege('macuxi_app', f::regprocedure, 'execute') as app,
                has_function_privilege('macuxi_worker', f::regprocedure, 'execute') as worker,
                has_function_privilege('macuxi_portal', f::regprocedure, 'execute') as portal,
                (select p.prosecdef from pg_proc p where p.oid = f::regprocedure) as definer
           from unnest($1::text[]) f`,
        [[...FUNCOES_SA_ZERAR, ...FUNCOES_WORKER_ZERAR, ...DO_DONO, 'plataforma.excluir_tenant(uuid, text)']],
      );
      for (const x of r) {
        const sa = (FUNCOES_SA_ZERAR as readonly string[]).includes(x.f);
        const wk = (FUNCOES_WORKER_ZERAR as readonly string[]).includes(x.f);
        expect({ app: x.app, worker: x.worker, portal: x.portal, definer: x.definer }, x.f).toEqual({ app: false, worker: wk, portal: sa, definer: sa || wk });
      }
      expect((await q<{ n: number }>("select count(*)::int as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'plataforma' and p.proname like 'sa\\_%' and has_function_privilege('macuxi_portal', p.oid, 'execute')"))[0]!.n).toBe(41);
    });
  });

  it('só o super-admin: sessão inválida 28000, admin do cliente 42501, app e worker sem EXECUTE', async () => {
    await caso(async () => {
      for (const papel of ['macuxi_app', 'macuxi_worker']) {
        expect((await erroDe(comoPapel(admin, papel, 'select plataforma.sa_previa_zerar(null, null)')))?.code, papel).toBe('42501');
      }
      const cli = await abrir({ tipo: 'admin_cliente', empresas: [{ tenant_id: A.tenantId, usuario_id: A.usuarios.admin }] });
      for (const [sql, args] of [
        ['select plataforma.sa_previa_zerar($1, $2) as r', [A.tenantId]],
        ['select plataforma.sa_pedir_zerar($1, $2, $3, $4) as r', [A.tenantId, id(1), A.codigo]],
        ['select plataforma.sa_ler_zerar($1, $2) as r', [A.tenantId]],
      ] as const) {
        expect((await falha(portal(sql, [null, ...args])))?.code, sql).toBe('28000');
        expect((await falha(portal(sql, [cli.sessao_id, ...args])))?.code, sql).toBe('42501');
      }
      expect(await q('select 1 from plataforma.zerar_empresa')).toEqual([]);
    });
  });

  it('prévia = contagem real; zerar apaga o conjunto, mantém o resto, filial padrão e usuários desbloqueados; B intacto; restaurar volta tudo', async () => {
    await caso(async () => {
      await montarA();
      const sid = await sessaoSuperAdmin();
      const antesA = await contar(A.tenantId);
      const antesB = await contar(B.tenantId);
      const geracao = (await q<{ g: string }>('select geracao_base::text as g from plataforma.tenant where id = $1', [A.tenantId]))[0]!.g;
      const avatares = (await q<{ n: number }>('select count(*)::int as n from plataforma.arquivo where tenant_id = $1 and id = $2', [A.tenantId, id(900)]))[0]!.n;
      expect(avatares).toBe(1);

      // prévia: só as tabelas com linhas, na ordem de apagar, e a soma
      const previa = await portal<{ tenant_id: string; codigo: string; total_linhas: number; tabelas: Array<{ tabela: string; linhas: number }>; bloqueio: string | null }>(
        'select plataforma.sa_previa_zerar($1, $2) as r', [sid, A.tenantId]);
      expect(previa).toMatchObject({ tenant_id: A.tenantId, codigo: A.codigo, bloqueio: null });
      expect(previa.tabelas.reduce((s, t) => s + t.linhas, 0)).toBe(previa.total_linhas);
      for (const t of previa.tabelas) {
        expect(t.linhas, t.tabela).toBeGreaterThan(0);
        if (SAEM.includes(t.tabela)) expect(t.linhas, t.tabela).toBe(antesA[t.tabela]);
      }
      // cada tabela inteira com linha em A está na prévia (a fixture tem linha em toda tabela)
      expect(SAEM.filter((t) => antesA[t]! > 0 && !previa.tabelas.some((x) => x.tabela === t))).toEqual([]);
      const pos = (t: string) => previa.tabelas.findIndex((x) => x.tabela === t);
      expect(pos('vendedor.pedido_item')).toBeLessThan(pos('vendedor.pedido'));
      expect(pos('vendedor.pedido')).toBeLessThan(pos('core.cliente'));
      expect(previa.tabelas.find((x) => x.tabela === 'core.filial')?.linhas).toBe(1); // Boa Vista
      expect(previa.tabelas.find((x) => x.tabela === 'plataforma.arquivo')?.linhas).toBe(antesA['plataforma.arquivo']! - 1); // o avatar fica

      // pedido: código errado 422; o certo (maiúsculas e espaços); repetido = o mesmo; outro id = 409
      expect(await falha(pedir(sid, A.tenantId, id(1), 'outro'))).toEqual({ code: '22023', hint: 'ZERAR_CODIGO_NAO_CONFERE' });
      const pedido = await pedir(sid, A.tenantId, id(1), ` ${A.codigo.toUpperCase()} `);
      expect(pedido).toMatchObject({ id: id(1), tenant_id: A.tenantId, codigo: A.codigo, origem: 'portal', situacao: 'em_andamento', concluido_em: null, contagem: null, erro_codigo: null });
      expect(await pedir(sid, A.tenantId, id(1), A.codigo)).toEqual(pedido);
      expect(await falha(pedir(sid, A.tenantId, id(2), A.codigo))).toEqual({ code: '55000', hint: 'ZERAR_EM_ANDAMENTO' });
      expect(await falha(pedir(sid, B.tenantId, id(1), B.codigo))).toEqual({ code: '23505', hint: null });
      expect((await portal<{ bloqueio: string }>('select plataforma.sa_previa_zerar($1, $2) as r', [sid, A.tenantId])).bloqueio).toBe('ZERAR_EM_ANDAMENTO');
      expect(await portal('select plataforma.sa_ler_zerar($1, $2) as r', [sid, A.tenantId])).toEqual(pedido);
      expect(await portal('select plataforma.sa_ler_zerar($1, $2) as r', [sid, B.tenantId])).toBeNull();

      // worker: pega (concessão) e executa
      expect(await worker('select plataforma.pegar_zerar() as r')).toMatchObject({ id: id(1), situacao: 'em_andamento' });
      expect(await worker('select plataforma.pegar_zerar() as r')).toBeNull();
      const feito = await worker<{ situacao: string; linhas_apagadas: number; contagem: Record<string, number>; copia_expira_em: string; concluido_em: string }>(
        'select plataforma.executar_zerar($1) as r', [id(1)]);
      expect(feito.situacao).toBe('concluido');
      expect(await worker('select plataforma.executar_zerar($1) as r', [id(1)])).toEqual(feito);
      expect(Object.fromEntries(previa.tabelas.map((t) => [t.tabela, t.linhas]))).toEqual(feito.contagem);
      expect(feito.linhas_apagadas).toBe(previa.total_linhas);
      const dias = (Date.parse(feito.copia_expira_em) - Date.parse(feito.concluido_em)) / 86_400_000;
      expect(dias).toBe(RETENCAO_COPIA_ZERAR_DIAS);
      await q('set constraints all immediate'); // as conferências adiadas (RN-CORE-39, perfis) passam como no COMMIT
      await q('set constraints all deferred');

      const depoisA = await contar(A.tenantId);
      // saem: vazias, menos a forma e o prazo padrão semeados de novo
      for (const t of SAEM) expect(depoisA[t], t).toBe(t === 'vendedor.forma_pagamento' || t === 'vendedor.prazo_pagamento' ? 1 : 0);
      expect(depoisA['integracao.cursor_entidade']).toBe(0);
      expect(depoisA['integracao.registro_atual']).toBe(0);
      expect(depoisA['plataforma.evento']).toBe(0);
      // ficam: iguais
      for (const t of MANTIDAS) expect(depoisA[t], t).toBe(antesA[t]);
      // parciais: a filial padrão, a (usuário, padrão) de cada usuário vivo com cadastro e o avatar
      expect(await q('select id from core.filial where tenant_id = $1', [A.tenantId])).toEqual([{ id: PADRAO_A }]);
      expect(await q('select count(*)::int as n from core.usuario where tenant_id = $1 and filial_cadastro_id <> $2', [A.tenantId, PADRAO_A])).toEqual([{ n: 0 }]);
      expect(await q(
        `select u.id from core.usuario u where u.tenant_id = $1 and u.deleted_at is null and u.filial_cadastro_id is not null
            and not exists (select 1 from core.usuario_filial uf where uf.tenant_id = u.tenant_id and uf.usuario_id = u.id and uf.filial_id = $2 and uf.deleted_at is null)`,
        [A.tenantId, PADRAO_A])).toEqual([]);
      expect(await q('select count(*)::int as n from core.usuario_filial where tenant_id = $1 and filial_id <> $2', [A.tenantId, PADRAO_A])).toEqual([{ n: 0 }]);
      expect(await q('select id from plataforma.arquivo where tenant_id = $1', [A.tenantId])).toEqual([{ id: id(900) }]);
      // geração girada; outro tenant intacto
      expect((await q<{ g: string }>('select geracao_base::text as g from plataforma.tenant where id = $1', [A.tenantId]))[0]!.g).not.toBe(geracao);
      expect(await contar(B.tenantId)).toEqual(antesB);

      // cópia de cada linha apagada; chaves dos bytes para o expurgo (o avatar não)
      expect((await q<{ n: number }>("select count(*)::int as n from plataforma.zerar_empresa_copia where zerar_id = $1 and acao = 'delete'", [id(1)]))[0]!.n).toBe(feito.linhas_apagadas);
      const objetos = await q<{ armazenamento: string; chave: string }>('select armazenamento, chave from plataforma.zerar_empresa_objeto where zerar_id = $1', [id(1)]);
      expect(objetos.filter((o) => o.armazenamento === 'arquivos')).toHaveLength(antesA['plataforma.arquivo']! - 1);
      expect(objetos.some((o) => o.chave.endsWith('avatar-0099.jpg'))).toBe(false);

      // auditoria: pedido e zerado (payload de plataforma.tenant.zerado@1), sem dado pessoal
      const aud = await q<{ acao: string; detalhes: Record<string, unknown> }>(
        "select acao, detalhes from plataforma.auditoria_plataforma where tenant_alvo_id = $1 and acao like 'tenant.zera%' order by ocorrido_em, acao", [A.tenantId]);
      expect(aud.map((x) => x.acao).sort()).toEqual(['tenant.zerado', 'tenant.zerar_pedido']);
      const zerado = aud.find((x) => x.acao === 'tenant.zerado')!.detalhes;
      // detalhes = payload de plataforma.tenant.zerado@1, exatamente (sem nome, documento ou e-mail)
      expect(zerado).toEqual({
        tenant_id: A.tenantId, codigo: A.codigo, zerar_id: id(1), origem: 'portal', linhas_apagadas: feito.linhas_apagadas,
        copia_expira_em: feito.copia_expira_em, zerado_em: feito.concluido_em,
      });

      // desfazer: as contagens de toda tabela voltam (A e B), os usuários voltam à filial de cadastro
      const desfeito = await q<{ r: { linhas_restauradas: number } }>('select plataforma.restaurar_zerar($1) as r', [id(1)]);
      expect(desfeito[0]!.r.linhas_restauradas).toBe(feito.linhas_apagadas);
      await q('set constraints all immediate');
      await q('set constraints all deferred');
      expect(await contar(A.tenantId)).toEqual(antesA);
      expect(await contar(B.tenantId)).toEqual(antesB);
      expect(await q('select id, filial_cadastro_id from core.usuario where id = any ($1::uuid[]) order by id', [[A.usuarios.supervisor, A.usuarios.vendedor1]])).toEqual(
        [{ id: A.usuarios.supervisor, filial_cadastro_id: BOA_VISTA }, { id: A.usuarios.vendedor1, filial_cadastro_id: BOA_VISTA }].sort((x, y) => x.id.localeCompare(y.id)));
      expect(await q('select count(*)::int as n from plataforma.zerar_empresa_copia where zerar_id = $1', [id(1)])).toEqual([{ n: 0 }]);
      expect(await q('select count(*)::int as n from plataforma.zerar_empresa_objeto where zerar_id = $1', [id(1)])).toEqual([{ n: 0 }]);
      expect(await falhaAdmin('select plataforma.restaurar_zerar($1)', [id(1)])).toEqual({ code: '55000', hint: 'ZERAR_SEM_COPIA' });
      expect((await q<{ n: number }>("select count(*)::int as n from plataforma.auditoria_plataforma where tenant_alvo_id = $1 and acao = 'tenant.zerar_desfeito'", [A.tenantId]))[0]!.n).toBe(1);
    });
  });

  it('uma transação: erro no meio do zerar = nada apagado e o job segue em andamento', async () => {
    await caso(async () => {
      const sid = await sessaoSuperAdmin();
      await pedir(sid, A.tenantId, id(3), A.codigo);
      const antes = await contar(A.tenantId);
      // core.cliente sai depois de pedido, visita e item: o erro nele desfaz o que já tinha saído
      await q("create function core.falhar_0099() returns trigger language plpgsql as $$ begin raise exception 'falha no meio' using errcode = 'XX000'; end $$");
      await q('create trigger falhar_0099 before delete on core.cliente for each statement execute function core.falhar_0099()');
      expect((await falha(worker('select plataforma.executar_zerar($1) as r', [id(3)])))?.code).toBe('XX000');
      expect(await contar(A.tenantId)).toEqual(antes);
      expect(await q('select situacao from plataforma.zerar_empresa where id = $1', [id(3)])).toEqual([{ situacao: 'em_andamento' }]);
      expect(await q('select count(*)::int as n from plataforma.zerar_empresa_copia where zerar_id = $1', [id(3)])).toEqual([{ n: 0 }]);
      // o worker fecha como falhou numa transação nova (idempotente); a empresa intacta
      const f = await worker<{ situacao: string; erro_codigo: string }>('select plataforma.fechar_zerar($1, $2::jsonb) as r', [id(3), JSON.stringify({ situacao: 'falhou', erro_codigo: 'ZERAR_FALHOU' })]);
      expect(f).toMatchObject({ situacao: 'falhou', erro_codigo: 'ZERAR_FALHOU' });
      expect(await worker('select plataforma.fechar_zerar($1, $2::jsonb) as r', [id(3), JSON.stringify({ situacao: 'falhou', erro_codigo: 'ZERAR_FALHOU' })])).toEqual(f);
      expect((await falha(worker('select plataforma.fechar_zerar($1, $2::jsonb) as r', [id(3), JSON.stringify({ situacao: 'concluido' })])))?.code).toBe('22023');
      expect((await q<{ n: number }>("select count(*)::int as n from plataforma.auditoria_plataforma where tenant_alvo_id = $1 and acao = 'tenant.zerar_falhou'", [A.tenantId]))[0]!.n).toBe(1);
    });
  });

  it('recusas: backup ou exclusão em andamento (409), empresa inexistente (404), volume alto (422)', async () => {
    await caso(async () => {
      const sid = await sessaoSuperAdmin();
      expect(await falha(pedir(sid, id(999), id(4), 'x'))).toEqual({ code: 'P0002', hint: 'TENANT_NAO_ENCONTRADO' });
      expect(await falha(portal('select plataforma.sa_previa_zerar($1, $2) as r', [sid, id(999)]))).toEqual({ code: 'P0002', hint: 'TENANT_NAO_ENCONTRADO' });
      await portal('select plataforma.sa_pedir_backup($1, $2, $3) as r', [sid, A.tenantId, id(5)]);
      expect(await falha(pedir(sid, A.tenantId, id(4), A.codigo))).toEqual({ code: '55000', hint: 'BACKUP_EM_ANDAMENTO' });
      expect((await portal<{ bloqueio: string }>('select plataforma.sa_previa_zerar($1, $2) as r', [sid, A.tenantId])).bloqueio).toBe('BACKUP_EM_ANDAMENTO');
      await q("update plataforma.tenant set status = 'encerrado' where id = $1", [B.tenantId]);
      expect(await falha(pedir(sid, B.tenantId, id(4), B.codigo))).toEqual({ code: '55000', hint: 'EXCLUSAO_EM_ANDAMENTO' });
      expect(await q('select plataforma.zerar_bloqueado($1, null, $2) as r', [A.tenantId, LIMITE_LINHAS_ZERAR + 1])).toEqual([{ r: 'BACKUP_EM_ANDAMENTO' }]);
      await q("update plataforma.backup_empresa set situacao = 'falhou', erro_codigo = 'X_TESTE' where id = $1", [id(5)]);
      expect(await q('select plataforma.zerar_bloqueado($1, null, $2) as r', [A.tenantId, LIMITE_LINHAS_ZERAR + 1])).toEqual([{ r: 'ZERAR_VOLUME_ALTO' }]);
      expect(await q('select plataforma.zerar_bloqueado($1, null, $2) as r', [A.tenantId, LIMITE_LINHAS_ZERAR])).toEqual([{ r: null }]);
      // na execução: backup pedido depois do zerar = falhou com o código, nada apagado
      await pedir(sid, A.tenantId, id(6), A.codigo);
      await portal('select plataforma.sa_pedir_backup($1, $2, $3) as r', [sid, A.tenantId, id(7)]);
      const antes = await contar(A.tenantId);
      expect(await worker('select plataforma.executar_zerar($1) as r', [id(6)])).toMatchObject({ situacao: 'falhou', erro_codigo: 'BACKUP_EM_ANDAMENTO' });
      expect(await contar(A.tenantId)).toEqual(antes);
    });
  });

  it('workflow (zerar_tenant_manual) e expurgo: código, origem workflow, cópia vencida some; sem cópia não há desfazer', async () => {
    await caso(async () => {
      expect(await falhaAdmin('select plataforma.zerar_tenant_manual($1, $2)', [B.tenantId, 'errado'])).toEqual({ code: '22023', hint: 'ZERAR_CODIGO_NAO_CONFERE' });
      const z = (await q<{ r: { id: string; origem: string; situacao: string; linhas_apagadas: number } }>('select plataforma.zerar_tenant_manual($1, $2) as r', [B.tenantId, B.codigo]))[0]!.r;
      expect(z).toMatchObject({ origem: 'workflow', situacao: 'concluido' });
      expect(z.linhas_apagadas).toBeGreaterThan(0);
      await q('set constraints all immediate');
      await q('set constraints all deferred');
      expect((await q<{ n: number }>("select count(*)::int as n from plataforma.auditoria_plataforma where tenant_alvo_id = $1 and acao = 'tenant.zerado' and ator_tipo is null and super_admin_id is null", [B.tenantId]))[0]!.n).toBe(1);
      // cópia ainda válida: o expurgo não vê nem fecha
      expect(await worker('select coalesce(jsonb_agg(x), \'[]\') as r from plataforma.objetos_do_expurgo_zerar(50) x')).toEqual([]);
      expect((await falha(worker('select plataforma.fechar_expurgo_zerar($1) as r', [z.id])))?.code).toBe('55000');
      expect((await falha(worker('select coalesce(jsonb_agg(x), \'[]\') as r from plataforma.objetos_do_expurgo_zerar(0) x')))?.code).toBe('22023');
      await q("update plataforma.zerar_empresa set copia_expira_em = now() - interval '1 minute' where id = $1", [z.id]);
      const objetos = await worker<Array<{ zerar_id: string; armazenamento: string | null; chave: string | null }>>('select coalesce(jsonb_agg(x), \'[]\') as r from plataforma.objetos_do_expurgo_zerar(50) x');
      expect(objetos.length).toBeGreaterThan(0);
      expect(objetos.every((o) => o.zerar_id === z.id)).toBe(true);
      const fechado = await worker<{ id: string }>('select plataforma.fechar_expurgo_zerar($1) as r', [z.id]);
      expect(await worker('select plataforma.fechar_expurgo_zerar($1) as r', [z.id])).toEqual(fechado);
      expect(await q('select count(*)::int as n from plataforma.zerar_empresa_copia where zerar_id = $1', [z.id])).toEqual([{ n: 0 }]);
      expect(await q('select (expurgado_em is not null) as e from plataforma.zerar_empresa where id = $1', [z.id])).toEqual([{ e: true }]);
      expect(await falhaAdmin('select plataforma.restaurar_zerar($1)', [z.id])).toEqual({ code: '55000', hint: 'ZERAR_SEM_COPIA' });
    });
  });

  it('restaurar recusa quando há linha nova nas tabelas do conjunto (ZERAR_DADOS_NOVOS) e nada muda', async () => {
    await caso(async () => {
      const z = (await q<{ r: { id: string } }>('select plataforma.zerar_tenant_manual($1, $2) as r', [A.tenantId, A.codigo]))[0]!.r;
      await q("insert into core.cliente (tenant_id, razao_social) values ($1, 'Cliente novo 0099')", [A.tenantId]);
      expect(await falhaAdmin('select plataforma.restaurar_zerar($1)', [z.id])).toEqual({ code: '55000', hint: 'ZERAR_DADOS_NOVOS' });
      expect((await q<{ n: number }>("select count(*)::int as n from plataforma.zerar_empresa_copia where zerar_id = $1 and acao = 'delete'", [z.id]))[0]!.n).toBeGreaterThan(0);
    });
  });

  it('excluir_tenant sobre o laço comum: mesmo resultado (toda linha do tenant e o tenant; B intacto)', async () => {
    await caso(async () => {
      const antesA = await contar(A.tenantId);
      const antesB = await contar(B.tenantId);
      await q("update plataforma.tenant set status = 'encerrado' where id = $1", [A.tenantId]);
      const r = await q<{ tabela: string; quantidade: string }>('select tabela, quantidade from plataforma.excluir_tenant($1, $2)', [A.tenantId, A.codigo]);
      expect(r.at(-1)).toEqual({ tabela: 'plataforma.tenant', quantidade: '1' });
      expect(Object.fromEntries(r.slice(0, -1).map((x) => [x.tabela, Number(x.quantidade)]))).toEqual(Object.fromEntries(Object.entries(antesA).filter(([, n]) => n > 0)));
      expect(await contar(B.tenantId)).toEqual(antesB);
    });
  });
});

describe.skipIf(semBanco())('0099 up/down (banco efêmero)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('a 0099 só acrescenta (e troca o corpo da excluir_tenant); o down volta exatamente', async () => {
    await comAdmin(b.nome, async (c) => {
      const excluir = async () => (await c.query<{ d: string; acl: string | null }>("select pg_get_functiondef(p.oid) as d, p.proacl::text as acl from pg_proc p where p.oid = 'plataforma.excluir_tenant(uuid,text)'::regprocedure")).rows[0]!;
      await migrarUp(c, { ate: '0098' });
      const antes = await retratoDoCatalogo(c);
      const excluir98 = await excluir();
      expect((await migrarUp(c, { ate: '0099' })).aplicadas).toEqual(['0099_plataforma_zerar_empresa']);
      const depois = await retratoDoCatalogo(c);
      expect(antes.filter((l) => !depois.includes(l))).toEqual([]);
      expect(depois.filter((l) => !antes.includes(l) && l.startsWith('rel ') && l.endsWith(' r rls=true force=true')).sort()).toEqual(TABELAS.map((t) => `rel ${t} r rls=true force=true`).sort());
      expect((await excluir()).acl).toBe(excluir98.acl);
      expect((await excluir()).d).toContain('apagar_em_ordem_fk');

      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0099_plataforma_zerar_empresa']);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      expect(await excluir()).toEqual(excluir98);
      await c.query(m99.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: '0099' });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
    });
  });
});
