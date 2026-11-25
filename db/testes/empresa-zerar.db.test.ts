/**
 * 0100 — "Zerar dados" da empresa (v1.0.31; ADR 0068; desenho docs/desenho/empresa-zerar.md §4, §5 e §11; RN-PLA-12).
 * Dicionário: docs/banco/plataforma.md ("Zerar dados da empresa (0100)"). O que o BANCO garante:
 * - a empresa inteira (entidades nulo) = o resultado do #675 nos dados de scripts/producao/teste/limpar-cadastros-dados.sql: o
 *   retrato fixo RETRATO_675 (ordem, tabela, modo e linhas, tirado da rotina do #675 em f2556d68) e a cópia de cada linha;
 * - por entidade: as raízes do mapa, a cascata (o pedido que perde item sai inteiro), o Hub (lote, registro_atual e cursor) de
 *   toda entidade afetada, pedida ou caída pela cascata; as entidades não afetadas intactas;
 * - ficam usuários administradores, perfis, credenciais, conectores, plano, licenças e parâmetros; o outro tenant fica intacto;
 * - só o super-admin (sa_* 28000/42501), pedido e prévia idempotentes pelo id, recusas com o código do contrato no hint (55000
 *   ZERAR_HUB_PROCESSANDO, 22023); prévia = pedida pelo portal e contada pelo worker com a mesma função no modo simular (nada
 *   muda, nada trava) e bate com o executar; teto de 3 vezes no worker (zerar e prévia); tudo ou nada; cópia antes e
 *   restaurar_limpeza volta as contagens; expurgar_zerar só nos vencidos; app, worker e portal sem acesso às tabelas;
 * - a trava do Hub é só da empresa que zera: o Hub da outra segue (duas conexões);
 * - up/down exato; a 0100 traz as cópias da public.macuxi_limpeza_backup e o down as devolve.
 * Estático (sempre) + banco efêmero com a fixture dois-tenants (cada caso numa transação desfeita).
 * As constantes do contrato (packages/platform-sdk/src/empresa-zerar.ts) ficam repetidas aqui até o SDK entrar no main com
 * esta migração (PR conjunto alexandre/migracao-zerar).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { PASTA_DB } from '../src/config';
import { TABELAS_SEM_TENANT_ID, TABELAS_SO_POR_FUNCAO } from '../src/excecoes';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { agoraDaFixture, semBanco } from './estado';
import { carregarFixtureDosTestes } from './fixture-treinamento';
import { FUNCOES_SA_0102, FUNCOES_SA_0107, FUNCOES_SA_ATUAIS, FUNCOES_SA_ZERAR, FUNCOES_WORKER_ZERAR } from './funcoes-sa';
import { comoPapel, erroDe, HASH_TESTE, retratoDoCatalogo } from './util';

const migracoes = lerMigracoes();
const m100 = migracoes.find((m) => m.versao === '0100')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(m100.up);
const down = semComentarios(m100.down);
/** Do início até o `$$;` que fecha a função. */
const bloco = (sql: string, inicio: string) => {
  const i = sql.indexOf(inicio);
  if (i < 0) return '';
  const fim = /^\$\$;$/m.exec(sql.slice(i));
  return fim ? sql.slice(i, i + fim.index + fim[0].length) : '';
};
const nomeDe = (f: string) => f.slice(0, f.indexOf('('));

/** Contrato (packages/platform-sdk/src/empresa-zerar.ts): ENTIDADES_ZERAR, limites, situações, modos e lote. */
const ENTIDADES_ZERAR = [
  'filial', 'vendedor', 'catalogo_no', 'forma_pagamento', 'prazo_pagamento', 'produto', 'produto_unidade', 'preco',
  'tabela_escalonada', 'estoque', 'cliente', 'cliente_endereco', 'transportadora', 'rota', 'titulo', 'nota',
];
const LIMITE_LINHAS_ZERAR = 2_000_000;
const RETENCAO_COPIA_ZERAR_DIAS = 7;
const SITUACOES_ZERAR = ['em_andamento', 'concluido', 'falhou'];
const SITUACOES_PREVIA = ['em_andamento', 'pronta', 'falhou'];
const MODOS_LIMPEZA = ['soft', 'fisico', 'filial', 'sync_pacote', 'girar'];
const LOTE_LIMPEZA_FORMATO = /^[0-9]{8}T[0-9]{6}Z(-[0-9a-f]{8})?$/;

const TABELAS = ['plataforma.zerar_empresa', 'plataforma.limpeza_copia', 'plataforma.zerar_previa'];
/** Sem EXECUTE para ninguém (só o dono e as SECURITY DEFINER de mesmo dono): a regra, a volta, o descarte e as internas. */
const DO_DONO = [
  'plataforma.limpar_cadastros(uuid, text, text[], boolean, boolean)',
  'plataforma.mapa_limpeza_entidades()',
  'plataforma.entidades_limpeza_ordenadas(text[])',
  'plataforma.entidades_afetadas_limpeza(jsonb, text[])',
  'plataforma.restaurar_limpeza(uuid, text)',
  'plataforma.descartar_limpeza(uuid, text)',
  'plataforma.zerar_bloqueado(uuid, uuid, bigint)',
  'plataforma.zerar_empresa_json(plataforma.zerar_empresa)',
  'plataforma.zerar_previa_json(plataforma.zerar_previa)',
  'plataforma.zerar_max_linhas()',
  'plataforma.zerar_max_pegadas()',
  'plataforma.resumir_limpeza(uuid, text, text[], boolean, boolean)',
];
/** Saíram do desenho anterior da 0100 (não podem existir). */
const SAIRAM = [
  'zerar_tenant', 'zerar_tenant_manual', 'restaurar_zerar', 'tabelas_mantidas_no_zerar', 'alvos_do_zerar', 'previa_do_zerar',
  'objetos_do_expurgo_zerar', 'fechar_expurgo_zerar', 'tabelas_com_tenant', 'passos_em_ordem_fk', 'apagar_em_ordem_fk',
  'sa_previa_zerar',
];
/** Os dados de exemplo do #675 (kit antigo e ERP novo). */
const DADOS_675 = readFileSync(join(PASTA_DB, '..', 'scripts', 'producao', 'teste', 'limpar-cadastros-dados.sql'), 'utf8');
/** O bloco `do $$ ... end $$;` dos dados (sem os comandos do psql); lê o tenant de app.tenant_id. */
const BLOCO_DADOS = DADOS_675.slice(DADOS_675.indexOf('do $$'), DADOS_675.lastIndexOf('end $$;') + 'end $$;'.length);
/**
 * Retrato fixo do resultado do #675 (pg_temp.macuxi_limpar_cadastros de f2556d68, empresa inteira) no tenant A da fixture
 * dois-tenants com os dados acima: "ordem tabela modo linhas", na ordem do resumo. Mudança intencional da regra = este retrato
 * muda junto, no mesmo PR. Os rótulos que o #675 punha depois do nome da tabela saíram (o modo diz o que foi feito).
 */
const RETRATO_675 = `
1 integracao.inativacao_auditoria fisico 1 | 2 integracao.pendencia_inativacao fisico 2
3 integracao.lote_linha_erro fisico 3 | 4 integracao.lote_staging fisico 1 | 5 integracao.lote fisico 5
6 integracao.sessao_carga_recebido fisico 1 | 7 integracao.sessao_carga fisico 4 | 8 integracao.registro_atual fisico 8
9 integracao.cursor_entidade fisico 3 | 10 integracao.reconciliacao fisico 1 | 11 integracao.coleta_execucao fisico 1
12 gestor.projecao_fato fisico 2 | 13 integracao.cliente_fila_erp fisico 6 | 14 integracao.pedido_retorno_erro fisico 1
15 integracao.pedido_retorno fisico 1 | 16 integracao.pedido_fila_erp fisico 1 | 100 catalogo.busca_log soft 1
100 catalogo.catalogo_no soft 2 | 100 catalogo.deposito soft 2 | 100 catalogo.estoque_saldo soft 7
100 catalogo.produto_atributo soft 1 | 100 catalogo.produto_busca soft 1 | 100 catalogo.produto_conteudo soft 1
100 catalogo.produto_midia soft 1 | 100 catalogo.produto_no soft 1 | 100 catalogo.produto_referencia soft 2
100 catalogo.produto_relacao soft 3 | 100 catalogo.tabela_escalonada soft 3 | 100 catalogo.tabela_preco soft 2
100 catalogo.tabela_preco_item soft 7 | 100 catalogo.uso_ia soft 1 | 100 core.ausencia_usuario soft 1
100 core.carteira soft 10 | 100 core.cliente soft 6 | 100 core.cliente_endereco soft 6 | 100 core.deslocamento_dia soft 1
100 core.dispositivo soft 2 | 100 core.indicador_diario soft 1 | 100 core.meta soft 6 | 100 core.nota_erp soft 3
100 core.notificacao soft 8 | 100 core.ponto_trajeto soft 1 | 100 core.produto soft 7 | 100 core.produto_unidade soft 8
100 core.rota soft 3 | 100 core.rota_parada soft 4 | 100 core.sessao soft 2 | 100 core.tarefa_destinatario soft 1
100 core.titulo soft 6 | 100 core.usuario soft 7 | 100 core.usuario_avatar soft 1 | 100 core.usuario_contato soft 1
100 core.usuario_convite soft 3 | 100 core.usuario_filial soft 8 | 100 core.visita soft 5 | 100 core.visita_etapa soft 3
100 gestor.alerta soft 1 | 100 pesquisa.resposta soft 1 | 100 pesquisa.resposta_foto soft 1
100 pesquisa.resposta_item soft 9 | 100 plataforma.arquivo soft 3 | 100 plataforma.usuario_modulo soft 1
100 plataforma.usuario_perfil soft 7 | 100 promotor.acao_concorrencia soft 1 | 100 promotor.checklist_resposta soft 1
100 promotor.coleta_preco soft 2 | 100 promotor.foto_coleta soft 4 | 100 promotor.gondola_registro soft 1
100 promotor.medicao_share soft 1 | 100 promotor.mix_obrigatorio soft 1 | 100 promotor.ponto_extra soft 1
100 promotor.ponto_extra_negociado soft 1 | 100 promotor.produto_concorrente soft 1 | 100 promotor.ruptura_item soft 1
100 promotor.tarefa_execucao soft 1 | 100 promotor.validade_item soft 1 | 100 promotor.visita_loja soft 1
100 treinamento.medalha_usuario soft 1 | 100 treinamento.progresso soft 1 | 100 treinamento.tentativa soft 1
100 treinamento.xp_lancamento soft 2 | 100 vendedor.forma_pagamento soft 3 | 100 vendedor.pedido soft 3
100 vendedor.pedido_aprovacao soft 1 | 100 vendedor.pedido_devolucao soft 1 | 100 vendedor.pedido_evento soft 3
100 vendedor.pedido_faturamento soft 1 | 100 vendedor.pedido_item soft 4 | 100 vendedor.prazo_pagamento soft 5
200 plataforma.evento soft 6 | 201 core.filial filial 4 | 202 plataforma.sync_pacote sync_pacote 2
203 plataforma.tenant girar 1
`.trim().split(/\s*[|\n]\s*/);
/** As colunas da public.macuxi_limpeza_backup do #675, na ordem. */
const COLUNAS_BACKUP_675 = ['lote', 'tenant_id', 'tabela', 'modo', 'linha', 'copiado_em'];
/** Teto de vezes que o worker pega o mesmo zerar ou a mesma prévia. */
const TETO_TENTATIVAS = 3;

describe('0100 zerar dados da empresa (estático)', () => {
  it('nome e posição: 0100_plataforma_zerar_empresa logo depois da 0099; a excluir_tenant fica a da 0032', () => {
    const i = migracoes.findIndex((m) => m.versao === '0100');
    expect(`${m100.versao}_${m100.nome}`).toBe('0100_plataforma_zerar_empresa');
    expect(migracoes[i - 1]?.versao).toBe('0099');
    expect(up).not.toMatch(/excluir_tenant/);
    expect(down).not.toMatch(/excluir_tenant/);
    for (const f of SAIRAM) expect(up, f).not.toMatch(new RegExp(`plataforma\\.${f}\\(`));
  });

  it('as 2 tabelas: só por função (sem grant), RLS forçado, só a política manutencao; sem tenant_id nem FK', () => {
    for (const t of TABELAS) {
      expect(TABELAS_SO_POR_FUNCAO, t).toContain(t);
      expect(up).toContain(`alter table ${t} force row level security;`);
      expect(up).toContain(`revoke all on ${t} from public, macuxi_app, macuxi_worker;`);
      expect(up).toContain(`create policy manutencao on ${t} for all to macuxi_manutencao using (true) with check (true);`);
    }
    for (const t of TABELAS) expect(TABELAS_SEM_TENANT_ID, t).toHaveProperty([t]);
    expect(up).not.toMatch(/\breferences\b/);
    expect([...up.matchAll(/\bgrant ([^;]+);/g)].map((x) => x[1]!).filter((g) => !g.startsWith('execute on function '))).toEqual([]);
  });

  it('limpeza_copia: as 6 primeiras colunas = as da public.macuxi_limpeza_backup do #675, na mesma ordem (tenant em empresa_id); a 0100 move e apaga a public', () => {
    const colunas = (sql: string, tabela: string) =>
      new RegExp(`create table (?:if not exists )?${tabela.replace('.', '\\.')} \\(([\\s\\S]*?)\\n\\s*\\);`).exec(sql)![1]!
        .split('\n').map((l) => l.trim().split(/\s+/)[0]!).filter((c) => c && c !== 'constraint');
    const do675 = COLUNAS_BACKUP_675;
    // a mesma ordem; o tenant vira empresa_id (sem FK, como nas tabelas da 0072)
    expect(colunas(up, 'plataforma.limpeza_copia').slice(0, 6)).toEqual(do675.map((c) => (c === 'tenant_id' ? 'empresa_id' : c)));
    expect(colunas(down, 'public.macuxi_limpeza_backup')).toEqual(do675);
    expect(up).toContain("constraint limpeza_copia_modo_valido check (modo in ('soft', 'fisico', 'filial', 'sync_pacote'))");
    expect(down).toContain("modo text not null check (modo in ('soft', 'fisico', 'filial', 'sync_pacote'))");
    expect(up).toContain('drop table public.macuxi_limpeza_backup;');
  });

  it('listas do contrato: situações, lote, modos, 7 dias, 2 milhões e 3 pegadas (os tetos num lugar só)', () => {
    const lista = (re: RegExp) => [...(re.exec(up)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect(lista(/constraint zerar_empresa_situacao_valida check \(situacao in \(([^)]+)\)\)/)).toEqual(SITUACOES_ZERAR);
    expect(lista(/constraint zerar_previa_situacao_valida check \(situacao in \(([^)]+)\)\)/)).toEqual(SITUACOES_PREVIA);
    expect(up).toContain("expira_em       timestamptz not null default now() + interval '1 hour',");
    // RD-2685: cada teto só na sua função; os 6 pontos leem dela
    expect(bloco(up, 'create function plataforma.zerar_max_linhas(')).toMatch(
      new RegExp(`language sql immutable security invoker[\\s\\S]*select ${LIMITE_LINHAS_ZERAR}::bigint`));
    expect(bloco(up, 'create function plataforma.zerar_max_pegadas(')).toMatch(
      new RegExp(`language sql immutable security invoker[\\s\\S]*select ${TETO_TENTATIVAS}\\s`));
    expect(up.replace(/--.*$/gm, '').match(new RegExp(`\\b${LIMITE_LINHAS_ZERAR}\\b`, 'g'))).toHaveLength(1);
    expect(up).not.toMatch(/tentativas [<>]=? *[1-9]/);
    expect(bloco(up, 'create function plataforma.pegar_zerar(')).toContain("perform plataforma.fechar_zerar(v_z.id, 'ZERAR_FALHOU');");
    const previas = bloco(up, 'create function plataforma.pegar_previa_zerar(');
    expect(previas).toContain("erro_codigo = 'ZERAR_FALHOU'");
    for (const f of ['pegar_zerar', 'pegar_previa_zerar']) {
      const b = bloco(up, `create function plataforma.${f}(`);
      expect(b, f).toContain('tentativas >= plataforma.zerar_max_pegadas()');
      expect(b, f).toContain('tentativas < plataforma.zerar_max_pegadas()');
    }
    expect(up).toContain(`'${LOTE_LIMPEZA_FORMATO.source}'`);
    const modos = new Set(['soft', 'fisico', ...[...up.matchAll(/insert into _limpeza_resumo values \(\d+, '[a-z_.]+', '([a-z_]+)'/g)].map((x) => x[1]!)]);
    expect([...modos].sort()).toEqual([...MODOS_LIMPEZA].sort());
    const executar = bloco(up, 'create function plataforma.executar_zerar(');
    expect(executar).toContain(`copia_expira_em = v_agora + interval '${RETENCAO_COPIA_ZERAR_DIAS} days'`);
    expect(executar).toContain('if v_total > plataforma.zerar_max_linhas() then');
    expect(bloco(up, 'create function plataforma.zerar_bloqueado(')).toContain('if p_total > plataforma.zerar_max_linhas() then');
  });

  it('um lugar só: falhou + auditoria na fechar_zerar (RD-2686) e o resumo na resumir_limpeza (RD-2687)', () => {
    const semComentarios = up.replace(/--.*$/gm, '');
    expect(semComentarios.match(/'tenant\.zerar_falhou'/g)).toHaveLength(1);
    expect(bloco(up, 'create function plataforma.fechar_zerar(')).toContain("'tenant.zerar_falhou'");
    expect(bloco(up, 'create function plataforma.executar_zerar(')).toContain('return plataforma.fechar_zerar(p_zerar, v_bloqueio);');
    expect(semComentarios.match(/filter \(where l\.r_modo in \('soft', 'fisico'\)\)/g)).toHaveLength(1);
    expect(bloco(up, 'create function plataforma.resumir_limpeza(')).toContain("filter (where l.r_modo in ('soft', 'fisico'))");
    for (const f of ['executar_zerar', 'executar_previa_zerar']) {
      const b = bloco(up, `create function plataforma.${f}(`);
      expect(b, f).toContain('from plataforma.resumir_limpeza(');
      expect(b, f).not.toContain('plataforma.limpar_cadastros(');
    }
    // contagem do zerar = LinhaLimpezaSchema (.strict(), sem a ordem)
    expect(bloco(up, 'create function plataforma.executar_zerar(')).toContain("jsonb_agg(e.x - 'ordem' order by e.n)");
  });

  it('zerar_bloqueado: as recusas na ordem da RN-PLA-12 (exclusão, zerar, backup, Hub, volume)', () => {
    const b = bloco(up, 'create function plataforma.zerar_bloqueado(');
    const ordem = ['TENANT_NAO_ENCONTRADO', 'EXCLUSAO_EM_ANDAMENTO', 'ZERAR_EM_ANDAMENTO', 'BACKUP_EM_ANDAMENTO', 'ZERAR_HUB_PROCESSANDO', 'ZERAR_VOLUME_ALTO'];
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
    // 42 depois da 0100 (o if v_n <> 42 dela); as migrações seguintes somam as delas
    expect(FUNCOES_SA_ATUAIS).toHaveLength(42 + FUNCOES_SA_0102.length + FUNCOES_SA_0107.length);
    expect(FUNCOES_SA_ATUAIS).toEqual(expect.arrayContaining([...FUNCOES_SA_ZERAR]));
    expect(up).toContain('if v_n <> 42 then');
    for (const f of FUNCOES_WORKER_ZERAR) {
      const b = bloco(up, `create function ${nomeDe(f)}(`);
      expect(b, f).toMatch(/security definer\s+set search_path = pg_catalog, plataforma, pg_temp/);
      expect(b.slice(0, b.indexOf(')')), f).not.toMatch(/tenant/);
      expect(up).toContain(`revoke all on function ${f} from public;`);
      expect(up).toContain(`grant execute on function ${f} to macuxi_worker;`);
    }
    for (const f of DO_DONO) {
      const b = bloco(up, `create function ${nomeDe(f)}(`);
      const esperado = f.startsWith('plataforma.limpar_cadastros(')
        ? /security definer\s+set search_path = pg_catalog, pg_temp\s/
        : /security invoker\s+set search_path = pg_catalog, (plataforma, )?pg_temp\s/;
      expect(b, f).toMatch(esperado);
      expect(up).toContain(`revoke all on function ${f} from public;`);
      expect(up).not.toContain(`grant execute on function ${f} `);
    }
  });

  it('auditoria sem dado pessoal; códigos do contrato no hint', () => {
    for (const c of ['TENANT_NAO_ENCONTRADO', 'ZERAR_CODIGO_NAO_CONFERE', 'ZERAR_HUB_PROCESSANDO', 'ZERAR_VOLUME_ALTO']) expect(up).toContain(`hint = '${c}'`);
    const aud = up.split('\n').filter((l) => /sa_registrar_auditoria|jsonb_build_object\('(zerar_id|tenant_id)'/.test(l)).join('\n');
    expect(aud).not.toMatch(/nome|email|cnpj|documento|razao|senha/);
  });

  it('down: apaga o que o up cria e devolve as cópias à public, sem grant', () => {
    for (const f of [...FUNCOES_SA_ZERAR, ...FUNCOES_WORKER_ZERAR, ...DO_DONO]) expect(down, f).toContain(`drop function if exists ${f};`);
    for (const t of TABELAS) expect(down).toContain(`drop table if exists ${t};`);
    expect(down.indexOf('insert into public.macuxi_limpeza_backup')).toBeLessThan(down.indexOf('drop table if exists plataforma.limpeza_copia;'));
    expect(down.indexOf('drop table if exists plataforma.zerar_empresa;')).toBeLessThan(down.indexOf('drop function if exists plataforma.entidades_limpeza_ordenadas(text[]);'));
    expect(down).not.toMatch(/\bgrant\b/);
  });

  it('trava do Hub só da empresa (sem lock table); o simular não copia, não muda e não trava', () => {
    const corpo = bloco(up, 'create function plataforma.limpar_cadastros(');
    expect(corpo).not.toMatch(/\block table\b/);
    expect(corpo).toContain('perform 1 from integracao.conector c where c.tenant_id = p_tenant for update;');
    expect(corpo).toContain('perform 1 from integracao.lote l where l.tenant_id = p_tenant for update;');
    expect(corpo).toMatch(/if not p_simular then\s+perform 1 from integracao\.conector/);
    const previa = bloco(up, 'create function plataforma.executar_previa_zerar(');
    expect(previa).toMatch(/v_p\.entidades, false, true\) r;/);
    expect(previa).toContain("raise exception 'prévia desfeita' using errcode = 'MXZ99';");
  });
});

describe.skipIf(semBanco())('0100 zerar dados da empresa (banco efêmero, fixture dois-tenants + dados do #675)', () => {
  let b: BancoDeTeste;
  let admin: pg.Client;
  const A = DOIS_TENANTS.A;
  const B = DOIS_TENANTS.B;
  /** O lote do portal leva os 8 primeiros dígitos do id: cada id do teste tem os seus (009900nn). */
  const id = (n: number) => `009900${String(n).padStart(2, '0')}-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const LOTE = '20261123T190000Z';

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
    const sa = (await q<{ r: { super_admin_id: string } }>('select plataforma.criar_super_admin($1::jsonb) as r', [JSON.stringify({ acao: 'criar', email: 'operador.zerar@macuxi.exemplo', nome: 'Operador 0100', senha_hash: HASH_TESTE })]))[0]!.r;
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
  /** Transação do caso, sempre desfeita (o banco efêmero volta à fixture), com os dados do #675 nos dois tenants. */
  async function caso(fn: () => Promise<void>) {
    await admin.query('begin');
    try {
      for (const t of [A.tenantId, B.tenantId]) {
        await admin.query("select set_config('app.tenant_id', $1, true)", [t]);
        await admin.query(BLOCO_DADOS);
      }
      // retrato por tabela do tenant: hash da linha inteira, vivas e total (a limpeza_copia fica fora: é a cópia)
      await admin.query(`create function pg_temp.retrato(p_tenant uuid) returns table (tabela text, hash text, vivas bigint, total bigint)
        language plpgsql as $f$
        declare r record; begin
          for r in select n.nspname || '.' || c.relname as nome from pg_class c join pg_namespace n on n.oid = c.relnamespace
                    join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
                   where c.relkind = 'r' and n.nspname in ('core','catalogo','vendedor','promotor','pesquisa','treinamento','gestor','integracao','plataforma')
                     and n.nspname || '.' || c.relname <> 'plataforma.limpeza_copia' order by 1 loop
            tabela := r.nome;
            execute format('select md5(coalesce(string_agg(to_jsonb(t)::text, ''|'' order by to_jsonb(t)::text), '''')), count(*) filter (where (to_jsonb(t) ->> ''deleted_at'') is null), count(*) from %s t where t.tenant_id = %L', r.nome, p_tenant)
              into hash, vivas, total;
            return next;
          end loop;
          -- a geracao_base gira por sequência (não volta no rollback): fica fora; o giro aparece no resumo (modo girar)
          tabela := 'plataforma.tenant';
          select md5((to_jsonb(t) - 'geracao_base')::text), 1, 1 into hash, vivas, total from plataforma.tenant t where t.id = p_tenant;
          return next;
        end $f$`);
      await fn();
    } finally {
      await admin.query('rollback');
    }
  }
  type Retrato = Record<string, { hash: string; vivas: number; total: number }>;
  async function retrato(tenant: string): Promise<Retrato> {
    const r: Retrato = {};
    for (const x of await q<{ tabela: string; hash: string; vivas: string; total: string }>('select * from pg_temp.retrato($1)', [tenant])) {
      r[x.tabela] = { hash: x.hash, vivas: Number(x.vivas), total: Number(x.total) };
    }
    return r;
  }
  const mudaram = (a: Retrato, d: Retrato) => Object.keys(a).filter((t) => a[t]!.hash !== d[t]?.hash).sort();
  const contagens = (r: Retrato, campo: 'vivas' | 'total') => Object.fromEntries(Object.entries(r).map(([t, v]) => [t, v[campo]]));
  type Linha = { r_ordem: number; r_tabela: string; r_modo: string; r_linhas: string };
  const limpar = (tenant: string, lote: string, entidades: string[] | null, exigir = true, simular = false) =>
    q<Linha>('select * from plataforma.limpar_cadastros($1, $2, $3::text[], $4, $5)', [tenant, lote, entidades, exigir, simular]);
  type Previa = {
    id: string; situacao: string; entidades: string[] | null; linhas: { ordem: number; tabela: string; modo: string; linhas: number }[] | null;
    entidades_afetadas: string[] | null; total: number | null; bloqueio: string | null; erro_codigo: string | null; criado_em: string;
  };
  const pedirPrevia = (sid: string, tenant: string, idPrevia: string, entidades: string[] | null = null) =>
    portal<Previa>('select plataforma.sa_pedir_previa_zerar($1, $2, $3, $4::text[]) as r', [sid, tenant, idPrevia, entidades]);
  const lerPrevia = (sid: string, tenant: string, idPrevia: string) =>
    portal<Previa | null>('select plataforma.sa_ler_previa_zerar($1, $2, $3) as r', [sid, tenant, idPrevia]);
  const pegarPrevia = async () => (await comoPapel<{ id: string; empresa_id: string }>(admin, 'macuxi_worker', 'select id, empresa_id from plataforma.pegar_previa_zerar()')).rows;
  const contarPrevia = (idPrevia: string) => worker<Previa>('select plataforma.executar_previa_zerar($1) as r', [idPrevia]);
  const soft = (l: Linha[]) => l.filter((x) => x.r_modo === 'soft' && Number(x.r_linhas) > 0).map((x) => x.r_tabela);
  const comoLista = (l: Linha[]) => JSON.stringify(l.map((x) => ({ tabela: x.r_tabela, modo: x.r_modo, linhas: Number(x.r_linhas) })));
  const afetadas = async (l: Linha[], entidades: string[]) =>
    (await q<{ r: string[] }>('select plataforma.entidades_afetadas_limpeza($1::jsonb, $2::text[]) as r', [comoLista(l), entidades]))[0]!.r;
  const vivo = async (tabela: string, idLinha: string) => (await q<{ v: boolean }>(`select deleted_at is null as v from ${tabela} where id = $1`, [idLinha]))[0]?.v;
  const contar = async (sql: string, params: unknown[] = []) => Number((await q<{ n: string }>(sql, params))[0]!.n);
  const processando = (tenant: string) =>
    q("update integracao.lote set status = 'processando' where tenant_id = $1 and chave_idempotencia = 'chave-erp-produto-0001'", [tenant]);
  /** Mantidos (RN-PLA-12): plano, licenças, perfis, parâmetros, conectores, credenciais, mapeamentos e configurações. */
  const MANTIDOS = ['plataforma.assinatura', 'plataforma.tenant_modulo', 'plataforma.perfil', 'plataforma.perfil_modulo',
    'plataforma.perfil_permissao', 'plataforma.parametro', 'integracao.conector', 'integracao.credencial', 'integracao.credencial_erp',
    'integracao.mapeamento', 'core.equipe', 'core.medida', 'core.motivo'];

  it('mapa: as 16 chaves = ENTIDADES_ZERAR, na ordem de carga; ordenadas e afetadas', async () => {
    await caso(async () => {
      const chaves = await q<{ k: string }>("select e.key as k from jsonb_each(plataforma.mapa_limpeza_entidades()) e order by (e.value ->> 'ordem')::int");
      expect(chaves.map((x) => x.k)).toEqual(ENTIDADES_ZERAR);
      expect((await q<{ r: string[] }>("select plataforma.entidades_limpeza_ordenadas(array['nota', 'cliente', 'filial', 'x']) as r"))[0]!.r).toEqual(['filial', 'cliente', 'nota']);
      const afet = await q<{ r: string[] }>(
        `select plataforma.entidades_afetadas_limpeza('[{"tabela":"core.cliente_endereco","modo":"soft","linhas":2},{"tabela":"catalogo.tabela_preco_item","modo":"soft","linhas":0},{"tabela":"core.filial","modo":"filial","linhas":1}]', array['cliente']) as r`,
      );
      expect(afet[0]!.r).toEqual(['filial', 'cliente', 'cliente_endereco']);
    });
  });

  it('acesso: 42501 nas 2 tabelas para app, worker e portal; funções só pelo papel certo; as que saíram não existem', async () => {
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
        [[...FUNCOES_SA_ZERAR, ...FUNCOES_WORKER_ZERAR, ...DO_DONO]],
      );
      expect(r).toHaveLength(FUNCOES_SA_ZERAR.length + FUNCOES_WORKER_ZERAR.length + DO_DONO.length);
      for (const x of r) {
        const sa = (FUNCOES_SA_ZERAR as readonly string[]).includes(x.f);
        const wk = (FUNCOES_WORKER_ZERAR as readonly string[]).includes(x.f);
        expect(x).toEqual({ f: x.f, app: false, worker: wk, portal: sa, definer: sa || wk || x.f.startsWith('plataforma.limpar_cadastros(') });
      }
      for (const f of SAIRAM) expect(await q('select 1 from pg_proc where proname = $1', [f]), f).toEqual([]);
    });
  });

  it('só o super-admin: sessão inválida 28000, admin do cliente 42501', async () => {
    await caso(async () => {
      const cli = await abrir({ tipo: 'admin_cliente', empresas: [{ tenant_id: A.tenantId, usuario_id: A.usuarios.admin }] });
      for (const [sql, args] of [
        ['select plataforma.sa_pedir_previa_zerar($1, $2, $3, null) as r', [A.tenantId, id(1)]],
        ['select plataforma.sa_ler_previa_zerar($1, $2, $3) as r', [A.tenantId, id(1)]],
        ['select plataforma.sa_pedir_zerar($1, $2, $3, $4, null) as r', [A.tenantId, id(1), A.codigo]],
        ['select plataforma.sa_ler_zerar($1, $2) as r', [A.tenantId]],
      ] as const) {
        expect((await falha(portal(sql, [null, ...args])))?.code, sql).toBe('28000');
        expect((await falha(portal(sql, [cli.sessao_id, ...args])))?.code, sql).toBe('42501');
      }
      expect(await q('select 1 from plataforma.zerar_empresa')).toEqual([]);
      expect(await q('select 1 from plataforma.zerar_previa')).toEqual([]);
    });
  });

  it('empresa inteira = o retrato do #675 (resumo e cópia); o simular conta o mesmo sem mudar nada; mantidos e o outro tenant intactos', async () => {
    await caso(async () => {
      const antesA = await retrato(A.tenantId);
      const antesB = await retrato(B.tenantId);
      const norm = (l: Linha[]) => l.map((x) => `${x.r_ordem} ${x.r_tabela} ${x.r_modo} ${x.r_linhas}`);
      const simulado = await limpar(A.tenantId, LOTE, null, false, true);
      expect(mudaram(antesA, await retrato(A.tenantId))).toEqual([]);
      expect(await q('select 1 from plataforma.limpeza_copia')).toEqual([]);

      const r99 = await limpar(A.tenantId, LOTE, null);
      const depois99 = await retrato(A.tenantId);
      expect(norm(r99)).toEqual(RETRATO_675);
      expect(norm(simulado)).toEqual(RETRATO_675);
      // a cópia: uma linha por linha mudada, por tabela e modo (girar não copia)
      const copia = await q<{ l: string }>("select tabela || ' ' || modo || ' ' || count(*) as l from plataforma.limpeza_copia where lote = $1 group by tabela, modo", [LOTE]);
      expect(copia.map((x) => x.l).sort()).toEqual(RETRATO_675.map((x) => x.split(' ').slice(1).join(' ')).filter((x) => !x.includes(' girar ')).sort());
      // o estado final: as vivas de cada tabela soft caem exatamente o que o resumo diz
      for (const x of r99.filter((y) => y.r_modo === 'soft')) {
        expect(antesA[x.r_tabela]!.vivas - depois99[x.r_tabela]!.vivas, x.r_tabela).toBe(Number(x.r_linhas));
      }
      for (const x of r99.filter((y) => y.r_modo === 'fisico')) {
        expect(antesA[x.r_tabela]!.total - depois99[x.r_tabela]!.total, x.r_tabela).toBe(Number(x.r_linhas));
      }
      expect(mudaram(antesA, depois99).length).toBeGreaterThan(50);
      // o que fica e o outro tenant
      expect(mudaram(antesB, await retrato(B.tenantId))).toEqual([]);
      const mudou = mudaram(antesA, depois99);
      expect(MANTIDOS.filter((t) => mudou.includes(t))).toEqual([]);
      expect(await vivo('core.usuario', A.usuarios.admin)).toBe(true);
      expect(await vivo('core.usuario', A.usuarios.vendedor1)).toBe(false);
      expect(await contar('select count(*) as n from integracao.credencial where tenant_id = $1 and deleted_at is null and revogada_em is null', [A.tenantId])).toBeGreaterThan(0);
      expect(await contar('select count(*) as n from integracao.registro_atual where tenant_id = $1', [A.tenantId])).toBe(0);
      expect(await afetadas(r99, [])).toEqual(expect.arrayContaining(['filial', 'vendedor', 'produto', 'cliente', 'titulo']));
    });
  });

  it('por entidade (cliente): clientes do ERP, endereços e os pedidos deles saem; produtos, Hub e cursor de produto ficam', async () => {
    await caso(async () => {
      // um pedido da fixture passa a ser de um cliente do ERP; um endereço do ERP com registro no Hub; cursor de cliente
      const ped = (await q<{ id: string; cliente_id: string }>('select id, cliente_id from vendedor.pedido where tenant_id = $1 and deleted_at is null order by id limit 1', [A.tenantId]))[0]!;
      await q("update core.cliente set external_id = 'ERP-CLI-PED' where id = $1", [ped.cliente_id]);
      const end = (await q<{ id: string }>("select e.id from core.cliente_endereco e join core.cliente c on c.id = e.cliente_id where c.external_id = 'ERP-CLI-1' and e.tenant_id = $1", [A.tenantId]))[0]!;
      await q("update core.cliente_endereco set external_id = 'ERP-END-1' where id = $1", [end.id]);
      const con = (await q<{ id: string }>("select id from integracao.conector where tenant_id = $1 and identificador = 'macuxierp'", [A.tenantId]))[0]!.id;
      await q("insert into integracao.registro_atual (tenant_id, entidade, conector_id, external_id, hash, alterado_em) values ($1, 'cliente_endereco', $2, 'ERP-END-1', repeat('c', 64), now()), ($1, 'cliente_endereco', $2, 'OUTRO-END', repeat('c', 64), now())", [A.tenantId, con]);
      await q("insert into integracao.cursor_entidade (tenant_id, conector_id, entidade) values ($1, $2, 'cliente')", [A.tenantId, con]);
      const antesA = await retrato(A.tenantId);
      const antesB = await retrato(B.tenantId);
      const hub = async (entidade: string) => ({
        registro: await contar('select count(*) as n from integracao.registro_atual where tenant_id = $1 and entidade = $2', [A.tenantId, entidade]),
        cursor: await contar('select count(*) as n from integracao.cursor_entidade where tenant_id = $1 and entidade = $2', [A.tenantId, entidade]),
        lote: await contar('select count(*) as n from integracao.lote where tenant_id = $1 and entidade = $2', [A.tenantId, entidade]),
      });
      const produtoAntes = await hub('produto');
      expect(produtoAntes.registro).toBeGreaterThan(0);
      expect(produtoAntes.cursor).toBeGreaterThan(0);
      const clientesErp = await contar('select count(*) as n from core.cliente where tenant_id = $1 and deleted_at is null and external_id is not null', [A.tenantId]);
      const clientesSem = await contar('select count(*) as n from core.cliente where tenant_id = $1 and deleted_at is null and external_id is null', [A.tenantId]);

      const r = await limpar(A.tenantId, LOTE, ['cliente']);
      const linhas = (t: string) => Number(r.find((x) => x.r_tabela === t)?.r_linhas ?? 0);
      expect(linhas('core.cliente')).toBe(clientesErp);
      expect(await contar('select count(*) as n from core.cliente where tenant_id = $1 and deleted_at is null', [A.tenantId])).toBe(clientesSem);
      expect(await vivo('core.cliente_endereco', end.id)).toBe(false);
      expect(await vivo('vendedor.pedido', ped.id)).toBe(false);
      expect(await contar('select count(*) as n from vendedor.pedido_item where pedido_id = $1 and deleted_at is null', [ped.id])).toBe(0);
      // o Hub: cliente inteiro (cursor incluso); o endereço caiu pela cascata e sai inteiro também; o de produto intacto
      expect(await hub('cliente')).toEqual({ registro: 0, cursor: 0, lote: 0 });
      expect(await hub('cliente_endereco')).toEqual({ registro: 0, cursor: 0, lote: 0 });
      expect(await hub('produto')).toEqual(produtoAntes);
      const mudou = mudaram(antesA, await retrato(A.tenantId));
      for (const t of ['core.produto', 'core.produto_unidade', 'catalogo.tabela_preco', 'catalogo.tabela_preco_item', 'catalogo.estoque_saldo', 'core.usuario', 'core.filial', ...MANTIDOS]) {
        expect(mudou, t).not.toContain(t);
      }
      expect(soft(r)).toEqual(expect.arrayContaining(['core.cliente', 'core.cliente_endereco', 'vendedor.pedido', 'vendedor.pedido_item']));
      expect(r.find((x) => x.r_tabela === 'core.filial')).toBeUndefined();
      expect(mudaram(antesB, await retrato(B.tenantId))).toEqual([]);
      // os títulos e as notas do cliente saem pela cascata: o ERP reenvia também essas entidades
      expect(await afetadas(r, ['cliente'])).toEqual(['cliente', 'cliente_endereco', 'titulo', 'nota']);
    });
  });

  it('por entidade (cliente): o Hub das entidades que caem pela cascata (título, nota, endereço) sai inteiro; as não afetadas ficam', async () => {
    await caso(async () => {
      // nota e endereço do ERP de um cliente do ERP (os títulos do ERP já vêm dos dados do #675)
      const cli = (await q<{ id: string }>('select id from core.cliente where tenant_id = $1 and deleted_at is null and external_id is not null order by id limit 1', [A.tenantId]))[0]!.id;
      await q("insert into core.nota_erp (tenant_id, cliente_id, tipo, numero, emitida_em, ano_mes, total_cents, external_id) values ($1, $2, 'faturamento', 'NF-1', now(), '2026-11', 1000, 'ERP-NF-1')", [A.tenantId, cli]);
      await q("update core.cliente_endereco set external_id = 'ERP-END-' || id where cliente_id = $1", [cli]);
      const con = (await q<{ id: string }>("select id from integracao.conector where tenant_id = $1 and identificador = 'macuxierp'", [A.tenantId]))[0]!.id;
      // lote delta, registro_atual e cursor em cada entidade: as 3 da cascata, a pedida e 2 não afetadas (rota sem linha)
      for (const e of ['cliente', 'cliente_endereco', 'titulo', 'nota', 'produto', 'rota']) {
        await q(`insert into integracao.lote (tenant_id, conector_id, entidade, modo, versao_contrato, chave_idempotencia, hash_conteudo, recebidas, status)
                 values ($1, $2, $3, 'delta', '1', 'chave-cascata-' || $3, repeat('d', 64), 1, 'concluido')`, [A.tenantId, con, e]);
        await q("insert into integracao.registro_atual (tenant_id, entidade, conector_id, external_id, hash, alterado_em) values ($1, $2, $3, 'REG-' || $2, repeat('e', 64), now())", [A.tenantId, e, con]);
        await q('insert into integracao.cursor_entidade (tenant_id, conector_id, entidade) values ($1, $2, $3) on conflict do nothing', [A.tenantId, con, e]);
      }
      const hub = async (entidade: string) => ({
        lote: await contar('select count(*) as n from integracao.lote where tenant_id = $1 and entidade = $2', [A.tenantId, entidade]),
        registro: await contar('select count(*) as n from integracao.registro_atual where tenant_id = $1 and entidade = $2', [A.tenantId, entidade]),
        cursor: await contar('select count(*) as n from integracao.cursor_entidade where tenant_id = $1 and entidade = $2', [A.tenantId, entidade]),
      });
      const naoAfetadas = { produto: await hub('produto'), rota: await hub('rota') };
      expect(naoAfetadas.produto.lote).toBeGreaterThan(1);
      const hashHub = async () =>
        (await q<{ h: string }>(`select md5(string_agg(to_jsonb(x)::text, '|' order by to_jsonb(x)::text)) as h from (
           select 'lote' as t, to_jsonb(l) as x from integracao.lote l where l.tenant_id = $1 and l.entidade in ('produto', 'rota')
           union all select 'registro', to_jsonb(r) from integracao.registro_atual r where r.tenant_id = $1 and r.entidade in ('produto', 'rota')
           union all select 'cursor', to_jsonb(c) from integracao.cursor_entidade c where c.tenant_id = $1 and c.entidade in ('produto', 'rota')
           union all select 'erro', to_jsonb(s) from integracao.lote_linha_erro s join integracao.lote l on l.id = s.lote_id where l.tenant_id = $1 and l.entidade in ('produto', 'rota')) y`, [A.tenantId]))[0]!.h;
      const antes = await hashHub();
      const antesB = await retrato(B.tenantId);

      const r = await limpar(A.tenantId, LOTE, ['cliente']);
      expect(soft(r)).toEqual(expect.arrayContaining(['core.cliente', 'core.cliente_endereco', 'core.titulo', 'core.nota_erp']));
      expect(await afetadas(r, ['cliente'])).toEqual(['cliente', 'cliente_endereco', 'titulo', 'nota']);
      for (const e of ['cliente', 'cliente_endereco', 'titulo', 'nota']) {
        expect(await hub(e), e).toEqual({ lote: 0, registro: 0, cursor: 0 });
      }
      // um reenvio delta com a mesma chave não acha lote anterior (não volta repetido)
      expect(await contar("select count(*) as n from integracao.lote where tenant_id = $1 and chave_idempotencia = 'chave-cascata-titulo'", [A.tenantId])).toBe(0);
      expect({ produto: await hub('produto'), rota: await hub('rota') }).toEqual(naoAfetadas);
      expect(await hashHub()).toBe(antes);
      expect(mudaram(antesB, await retrato(B.tenantId))).toEqual([]);
    });
  });

  it('por entidade (produto): o pedido com item do produto sai inteiro; os clientes ficam; afetadas trazem as dependentes', async () => {
    await caso(async () => {
      const it0 = (await q<{ id: string; pedido_id: string; produto_id: string }>('select id, pedido_id, produto_id from vendedor.pedido_item where tenant_id = $1 and deleted_at is null order by id limit 1', [A.tenantId]))[0]!;
      await q("update core.produto set external_id = 'ERP-PRD-PED' where id = $1", [it0.produto_id]);
      const itens = await contar('select count(*) as n from vendedor.pedido_item where pedido_id = $1 and deleted_at is null', [it0.pedido_id]);
      const clientes = await contar('select count(*) as n from core.cliente where tenant_id = $1 and deleted_at is null', [A.tenantId]);
      const r = await limpar(A.tenantId, LOTE, ['produto']);
      expect(itens).toBeGreaterThan(0);
      expect(await vivo('vendedor.pedido', it0.pedido_id)).toBe(false);
      expect(await contar('select count(*) as n from vendedor.pedido_item where pedido_id = $1 and deleted_at is null', [it0.pedido_id])).toBe(0);
      expect(await contar('select count(*) as n from core.cliente where tenant_id = $1 and deleted_at is null', [A.tenantId])).toBe(clientes);
      expect(await contar("select count(*) as n from integracao.registro_atual where tenant_id = $1 and entidade = 'produto'", [A.tenantId])).toBe(0);
      const afet = await afetadas(r, ['produto']);
      expect(afet).toEqual(expect.arrayContaining(['produto', 'produto_unidade', 'preco', 'estoque']));
      expect(afet).not.toContain('cliente');
    });
  });

  it('por entidade (filial): só o external_id das filiais sai; nenhuma linha soft', async () => {
    await caso(async () => {
      const com = await contar('select count(*) as n from core.filial where tenant_id = $1 and deleted_at is null and external_id is not null', [A.tenantId]);
      const antesA = await retrato(A.tenantId);
      const r = await limpar(A.tenantId, LOTE, ['filial']);
      expect(com).toBeGreaterThan(0);
      expect(soft(r)).toEqual([]);
      expect(r.find((x) => x.r_tabela === 'core.filial')).toMatchObject({ r_modo: 'filial', r_linhas: String(com) });
      expect(await contar('select count(*) as n from core.filial where tenant_id = $1 and external_id is not null', [A.tenantId])).toBe(0);
      const mudou = mudaram(antesA, await retrato(A.tenantId));
      expect(mudou).toContain('core.filial');
      expect(mudou.filter((t) => !['core.filial', 'plataforma.tenant', 'plataforma.sync_pacote'].includes(t))).toEqual([]);
      expect(await afetadas(r, ['filial'])).toEqual(['filial']);
    });
  });

  it('recusas: entidades e lote inválidos 22023; lote repetido 23505; Hub processando 55000 ZERAR_HUB_PROCESSANDO; volume', async () => {
    await caso(async () => {
      expect((await falhaAdmin("select * from plataforma.limpar_cadastros($1, $2, array['xis'])", [A.tenantId, LOTE]))?.code).toBe('22023');
      expect((await falhaAdmin("select * from plataforma.limpar_cadastros($1, $2, array['cliente', 'cliente'])", [A.tenantId, LOTE]))?.code).toBe('22023');
      expect((await falhaAdmin("select * from plataforma.limpar_cadastros($1, $2, '{}'::text[])", [A.tenantId, LOTE]))?.code).toBe('22023');
      expect((await falhaAdmin('select * from plataforma.limpar_cadastros($1, $2)', [A.tenantId, '2026-11-23']))?.code).toBe('22023');
      await limpar(A.tenantId, LOTE, ['nota']);
      expect((await falhaAdmin("select * from plataforma.limpar_cadastros($1, $2, array['titulo'])", [A.tenantId, LOTE]))?.code).toBe('23505');
      await processando(A.tenantId);
      expect(await falhaAdmin("select * from plataforma.limpar_cadastros($1, '20261123T190500Z', array['cliente'])", [A.tenantId])).toEqual({ code: '55000', hint: 'ZERAR_HUB_PROCESSANDO' });
      // sem exigir o Hub parado (prévia e simular) a função roda
      expect((await limpar(A.tenantId, '20261123T190600Z', ['cliente'], false)).length).toBeGreaterThan(0);
      expect((await q<{ r: string | null }>('select plataforma.zerar_bloqueado($1, null, null) as r', [A.tenantId]))[0]!.r).toBe('ZERAR_HUB_PROCESSANDO');
      expect((await q<{ r: string | null }>('select plataforma.zerar_bloqueado($1, null, $2) as r', [B.tenantId, LIMITE_LINHAS_ZERAR + 1]))[0]!.r).toBe('ZERAR_VOLUME_ALTO');
      expect((await q<{ r: string | null }>('select plataforma.zerar_bloqueado($1, null, $2) as r', [B.tenantId, LIMITE_LINHAS_ZERAR]))[0]!.r).toBeNull();
    });
  });

  it('portal e worker: prévia pedida, contada pelo worker, não muda nada e bate com o executar; idempotência; 409 e 422; volta pela cópia', async () => {
    await caso(async () => {
      const sid = await sessaoSuperAdmin();
      const antesA = await retrato(A.tenantId);
      // a prévia: o portal pede (nada é contado no pool do portal), o worker conta, o portal lê
      const pedida = await pedirPrevia(sid, A.tenantId, id(11), ['cliente_endereco', 'cliente']);
      expect(pedida).toEqual({ id: id(11), situacao: 'em_andamento', entidades: ['cliente', 'cliente_endereco'], linhas: null, entidades_afetadas: null, total: null, bloqueio: null, erro_codigo: null, criado_em: pedida.criado_em });
      expect(pedida.criado_em).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);
      expect(await pedirPrevia(sid, A.tenantId, id(11), null)).toEqual(pedida);
      expect((await falha(pedirPrevia(sid, B.tenantId, id(11))))?.code).toBe('23505');
      expect((await falha(pedirPrevia(sid, A.tenantId, id(12), ['xis'])))?.code).toBe('22023');
      expect((await falha(pedirPrevia(sid, A.tenantId, id(12), ['cliente', 'cliente'])))?.code).toBe('22023');
      expect(await falha(pedirPrevia(sid, '00000000-0000-4000-8000-0000000000ff', id(12)))).toEqual({ code: 'P0002', hint: 'TENANT_NAO_ENCONTRADO' });
      expect(await lerPrevia(sid, B.tenantId, id(11))).toBeNull();
      expect(await lerPrevia(sid, A.tenantId, id(12))).toBeNull();
      expect(await pegarPrevia()).toEqual([{ id: id(11), empresa_id: A.tenantId }]);
      expect(await pegarPrevia()).toEqual([]);
      const previa = await contarPrevia(id(11));
      expect(await contarPrevia(id(11))).toEqual(previa);
      expect(await lerPrevia(sid, A.tenantId, id(11))).toEqual(previa);
      expect(mudaram(antesA, await retrato(A.tenantId))).toEqual([]);
      expect(await q('select 1 from plataforma.limpeza_copia')).toEqual([]);
      expect(previa).toMatchObject({ situacao: 'pronta', entidades: ['cliente', 'cliente_endereco'], entidades_afetadas: ['cliente', 'cliente_endereco', 'titulo'], bloqueio: null, erro_codigo: null });
      expect(previa.linhas!.length).toBeGreaterThan(3);
      expect(previa.linhas!.every((t) => t.linhas > 0 && Number.isInteger(t.ordem) && /^[a-z_]+\.[a-z_]+$/.test(t.tabela))).toBe(true);
      // modo em cada linha (o do resumo): soft e fisico somam o total; filial, sync_pacote e girar não saem
      expect(previa.linhas!.every((t) => ['soft', 'fisico', 'filial', 'sync_pacote', 'girar'].includes(t.modo))).toBe(true);
      expect(previa.linhas!.find((t) => t.tabela === 'plataforma.tenant')).toMatchObject({ modo: 'girar', linhas: 1 });
      expect(previa.total).toBe(previa.linhas!.filter((t) => t.modo === 'soft' || t.modo === 'fisico').reduce((a, t) => a + t.linhas, 0));
      expect(previa.total).toBeGreaterThan(0);

      // Hub processando: 409 no pedido e bloqueio na leitura da prévia (zerar_bloqueado, agora); código errado 422
      await processando(A.tenantId);
      expect(await falha(portal('select plataforma.sa_pedir_zerar($1, $2, $3, $4, null) as r', [sid, A.tenantId, id(9), A.codigo]))).toEqual({ code: '55000', hint: 'ZERAR_HUB_PROCESSANDO' });
      expect((await lerPrevia(sid, A.tenantId, id(11)))!.bloqueio).toBe('ZERAR_HUB_PROCESSANDO');
      await q("update integracao.lote set status = 'concluido_com_erros' where tenant_id = $1 and chave_idempotencia = 'chave-erp-produto-0001'", [A.tenantId]);
      expect(await falha(portal('select plataforma.sa_pedir_zerar($1, $2, $3, $4, null) as r', [sid, A.tenantId, id(9), 'outro']))).toEqual({ code: '22023', hint: 'ZERAR_CODIGO_NAO_CONFERE' });
      expect((await falha(portal("select plataforma.sa_pedir_zerar($1, $2, $3, $4, array['xis']) as r", [sid, A.tenantId, id(9), A.codigo])))?.code).toBe('22023');

      const pedido = await portal<{ id: string; lote: string; situacao: string; entidades: string[] }>(
        'select plataforma.sa_pedir_zerar($1, $2, $3, $4, $5::text[]) as r', [sid, A.tenantId, id(1), ` ${A.codigo.toUpperCase()} `, ['cliente_endereco', 'cliente']]);
      expect(pedido).toMatchObject({ id: id(1), situacao: 'em_andamento', entidades: ['cliente', 'cliente_endereco'], entidades_afetadas: null });
      expect(pedido.lote).toMatch(/^[0-9]{8}T[0-9]{6}Z-00990001$/);
      expect(await portal('select plataforma.sa_pedir_zerar($1, $2, $3, $4, null) as r', [sid, A.tenantId, id(1), 'qualquer'])).toEqual(pedido);
      expect(await falha(portal('select plataforma.sa_pedir_zerar($1, $2, $3, $4, null) as r', [sid, A.tenantId, id(2), A.codigo]))).toEqual({ code: '55000', hint: 'ZERAR_EM_ANDAMENTO' });
      expect(await portal('select plataforma.sa_ler_zerar($1, $2) as r', [sid, A.tenantId])).toEqual(pedido);

      expect((await comoPapel(admin, 'macuxi_worker', 'select id, empresa_id from plataforma.pegar_zerar()')).rows).toEqual([{ id: id(1), empresa_id: A.tenantId }]);
      expect((await comoPapel(admin, 'macuxi_worker', 'select id, empresa_id from plataforma.pegar_zerar()')).rows).toEqual([]);
      type Feito = { situacao: string; contagem: unknown[]; linhas_apagadas: number; entidades_afetadas: string[] | null; lote: string };
      const feito = await worker<Feito>('select plataforma.executar_zerar($1) as r', [id(1)]);
      // a prévia bate com o executado: as mesmas tabelas, na mesma ordem, com o mesmo modo e as mesmas linhas; total = linhas_apagadas
      expect(feito).toMatchObject({ situacao: 'concluido', linhas_apagadas: previa.total, entidades_afetadas: previa.entidades_afetadas, lote: pedido.lote });
      expect((feito.contagem as { tabela: string; modo: string; linhas: number }[]).map((x) => `${x.tabela} ${x.modo} ${x.linhas}`)).toEqual(previa.linhas!.map((x) => `${x.tabela} ${x.modo} ${x.linhas}`));
      // a prévia pedida depois: o zerar já foi (bloqueio null; os números agora são os do que sobrou)
      expect((await lerPrevia(sid, A.tenantId, id(11)))!.bloqueio).toBeNull();
      expect(await worker('select plataforma.executar_zerar($1) as r', [id(1)])).toEqual(feito);
      expect(await falha(worker("select plataforma.fechar_zerar($1, 'ZERAR_FALHOU') as r", [id(1)]))).toMatchObject({ code: '55000' });
      const aud = await q<{ acao: string; detalhes: Record<string, unknown> }>("select acao, detalhes from plataforma.auditoria_plataforma where tenant_alvo_id = $1 and acao like 'tenant.zera%'", [A.tenantId]);
      expect(aud.map((x) => x.acao).sort()).toEqual(['tenant.zerado', 'tenant.zerar_pedido']);
      expect(Object.keys(aud.find((x) => x.acao === 'tenant.zerado')!.detalhes).sort()).toEqual(['codigo', 'copia_expira_em', 'entidades', 'linhas_apagadas', 'lote', 'tenant_id', 'zerado_em', 'zerar_id']);

      // cópia antes e volta: restaurar_limpeza devolve as contagens de toda tabela
      expect(await contar('select count(*) as n from plataforma.limpeza_copia where lote = $1', [pedido.lote])).toBeGreaterThan(0);
      expect(contagens(await retrato(A.tenantId), 'vivas')).not.toEqual(contagens(antesA, 'vivas'));
      await q('select * from plataforma.restaurar_limpeza($1, $2)', [A.tenantId, pedido.lote]);
      const voltou = await retrato(A.tenantId);
      expect(contagens(voltou, 'vivas')).toEqual(contagens(antesA, 'vivas'));
      expect(contagens(voltou, 'total')).toEqual(contagens(antesA, 'total'));
      expect((await q<{ d: boolean }>('select desfeito_em is not null as d from plataforma.zerar_empresa where id = $1', [id(1)]))[0]!.d).toBe(true);
      expect(await contar("select count(*) as n from plataforma.auditoria_plataforma where tenant_alvo_id = $1 and acao = 'tenant.zerar_desfeito'", [A.tenantId])).toBe(1);
      expect(Number((await q<{ n: string }>('select plataforma.descartar_limpeza($1, $2) as n', [A.tenantId, pedido.lote]))[0]!.n)).toBeGreaterThan(0);
      expect(await contar('select count(*) as n from plataforma.limpeza_copia where lote = $1', [pedido.lote])).toBe(0);
    });
  });

  it('tudo ou nada: erro no meio = nada muda, sem cópia, e o job fica em andamento; o worker fecha com o código', async () => {
    await caso(async () => {
      const sid = await sessaoSuperAdmin();
      await portal('select plataforma.sa_pedir_zerar($1, $2, $3, $4, null) as r', [sid, A.tenantId, id(3), A.codigo]);
      await q("create function public.falha_0100() returns trigger language plpgsql as $f$ begin raise exception 'falha no meio'; end $f$");
      await q('create trigger falha_0100 before update on core.titulo for each row execute function public.falha_0100()');
      const antesA = await retrato(A.tenantId);
      expect((await falha(worker('select plataforma.executar_zerar($1) as r', [id(3)])))?.code).toBe('P0001');
      expect(mudaram(antesA, await retrato(A.tenantId))).toEqual([]);
      expect(await q('select 1 from plataforma.limpeza_copia')).toEqual([]);
      expect((await q<{ s: string }>('select situacao as s from plataforma.zerar_empresa where id = $1', [id(3)]))[0]!.s).toBe('em_andamento');
      const f = await worker<{ situacao: string; erro_codigo: string }>("select plataforma.fechar_zerar($1, 'ZERAR_FALHOU') as r", [id(3)]);
      expect(f).toMatchObject({ situacao: 'falhou', erro_codigo: 'ZERAR_FALHOU' });
      expect(await worker("select plataforma.fechar_zerar($1, 'OUTRO') as r", [id(3)])).toEqual(f);
      expect((await falha(worker("select plataforma.fechar_zerar($1, 'minusculo') as r", [id(3)])))?.code).toBe('22023');
      // Hub em processamento entre o pedido e o worker: falhou com o próprio código, nada muda
      await portal('select plataforma.sa_pedir_zerar($1, $2, $3, $4, null) as r', [sid, A.tenantId, id(4), A.codigo]);
      await processando(A.tenantId);
      const antes2 = await retrato(A.tenantId);
      expect(await worker('select plataforma.executar_zerar($1) as r', [id(4)])).toMatchObject({ situacao: 'falhou', erro_codigo: 'ZERAR_HUB_PROCESSANDO' });
      expect(mudaram(antes2, await retrato(A.tenantId))).toEqual([]);
      // o código do bloqueio (zerar_bloqueado, a fonte única) chega à tela pela sa_ler_zerar
      expect(await portal('select plataforma.sa_ler_zerar($1, $2) as r', [sid, A.tenantId])).toMatchObject({ id: id(4), situacao: 'falhou', erro_codigo: 'ZERAR_HUB_PROCESSANDO' });
    });
  });

  it('teto de tentativas: o zerar e a prévia pegos 3 vezes sem fechar fecham falhou ZERAR_FALHOU; prévia vencida sai', async () => {
    await caso(async () => {
      const sid = await sessaoSuperAdmin();
      const vencer = (tabela: string, idJob: string) => q(`update plataforma.${tabela} set bloqueado_ate = now() - interval '1 minute' where id = $1`, [idJob]);
      // zerar: 3 concessões vencidas (o processo caiu no meio de cada uma)
      await portal('select plataforma.sa_pedir_zerar($1, $2, $3, $4, null) as r', [sid, A.tenantId, id(7), A.codigo]);
      for (let n = 1; n <= TETO_TENTATIVAS; n++) {
        expect((await comoPapel(admin, 'macuxi_worker', 'select id from plataforma.pegar_zerar()')).rows, `vez ${n}`).toEqual([{ id: id(7) }]);
        await vencer('zerar_empresa', id(7));
      }
      expect((await comoPapel(admin, 'macuxi_worker', 'select id from plataforma.pegar_zerar()')).rows).toEqual([]);
      expect(await portal('select plataforma.sa_ler_zerar($1, $2) as r', [sid, A.tenantId])).toMatchObject({ id: id(7), situacao: 'falhou', erro_codigo: 'ZERAR_FALHOU' });
      expect(await contar("select count(*) as n from plataforma.auditoria_plataforma where tenant_alvo_id = $1 and acao = 'tenant.zerar_falhou' and detalhes ->> 'erro_codigo' = 'ZERAR_FALHOU'", [A.tenantId])).toBe(1);
      // a empresa fica livre para outro pedido
      expect(await portal('select plataforma.sa_pedir_zerar($1, $2, $3, $4, null) as r', [sid, A.tenantId, id(8), A.codigo])).toMatchObject({ situacao: 'em_andamento' });
      // concessão viva: não volta antes de vencer
      expect((await comoPapel(admin, 'macuxi_worker', 'select id from plataforma.pegar_zerar()')).rows).toEqual([{ id: id(8) }]);
      expect((await comoPapel(admin, 'macuxi_worker', 'select id from plataforma.pegar_zerar()')).rows).toEqual([]);

      // prévia: o mesmo teto
      await pedirPrevia(sid, B.tenantId, id(13));
      for (let n = 1; n <= TETO_TENTATIVAS; n++) {
        expect(await pegarPrevia(), `vez ${n}`).toEqual([{ id: id(13), empresa_id: B.tenantId }]);
        await vencer('zerar_previa', id(13));
      }
      expect(await pegarPrevia()).toEqual([]);
      expect(await lerPrevia(sid, B.tenantId, id(13))).toMatchObject({ situacao: 'falhou', erro_codigo: 'ZERAR_FALHOU', linhas: null, total: null });
      expect(await contarPrevia(id(13))).toMatchObject({ situacao: 'falhou', erro_codigo: 'ZERAR_FALHOU' });
      // vencida (1 hora): a leitura não acha e o worker apaga
      await pedirPrevia(sid, B.tenantId, id(14));
      await q("update plataforma.zerar_previa set expira_em = now() - interval '1 second' where id in ($1, $2)", [id(13), id(14)]);
      expect(await lerPrevia(sid, B.tenantId, id(14))).toBeNull();
      expect(await pegarPrevia()).toEqual([]);
      expect(await contar('select count(*) as n from plataforma.zerar_previa where id in ($1, $2)', [id(13), id(14)])).toBe(0);
      // empresa que saiu entre o pedido e o worker: falhou TENANT_NAO_ENCONTRADO
      await pedirPrevia(sid, B.tenantId, id(15), ['nota']);
      await q('update plataforma.tenant set deleted_at = now() where id = $1', [B.tenantId]);
      expect(await contarPrevia(id(15))).toMatchObject({ situacao: 'falhou', erro_codigo: 'TENANT_NAO_ENCONTRADO', bloqueio: 'TENANT_NAO_ENCONTRADO' });
    });
  });

  it('expurgar_zerar: só a cópia dos zerar vencidos; os lotes do workflow ficam', async () => {
    await caso(async () => {
      const sid = await sessaoSuperAdmin();
      const lotes: string[] = [];
      for (const [n, t, codigo, e] of [[5, A.tenantId, A.codigo, ['nota']], [6, B.tenantId, B.codigo, ['titulo']]] as const) {
        lotes.push((await portal<{ lote: string }>('select plataforma.sa_pedir_zerar($1, $2, $3, $4, $5::text[]) as r', [sid, t, id(n), codigo, e])).lote);
        expect(await worker('select plataforma.executar_zerar($1) as r', [id(n)])).toMatchObject({ situacao: 'concluido' });
      }
      await limpar(A.tenantId, LOTE, ['estoque']);
      await q("update plataforma.zerar_empresa set copia_expira_em = now() - interval '1 minute' where id = $1", [id(5)]);
      const copias = async (lote: string) => contar('select count(*) as n from plataforma.limpeza_copia where lote = $1', [lote]);
      expect(await copias(lotes[0]!)).toBeGreaterThan(0);
      expect(await worker<number>('select plataforma.expurgar_zerar(20) as r')).toBe(1);
      expect(await copias(lotes[0]!)).toBe(0);
      expect(await copias(lotes[1]!)).toBeGreaterThan(0);
      expect(await copias(LOTE)).toBeGreaterThan(0);
      expect(await worker<number>('select plataforma.expurgar_zerar(20) as r')).toBe(0);
      expect((await falha(worker('select plataforma.expurgar_zerar(0) as r')))?.code).toBe('22023');
      expect((await q<{ x: boolean }>('select expurgado_em is not null as x from plataforma.zerar_empresa where id = $1', [id(5)]))[0]!.x).toBe(true);
    });
  });
});

describe.skipIf(semBanco())('0100 trava do Hub por empresa (duas conexões, dados do #675 gravados)', () => {
  let b: BancoDeTeste;
  const conexoes: pg.Client[] = [];
  const A = DOIS_TENANTS.A;
  const B = DOIS_TENANTS.B;
  const nova = async () => {
    const c = new pg.Client({ connectionString: b.urlAdmin });
    await c.connect();
    conexoes.push(c);
    return c;
  };
  beforeAll(async () => {
    b = await criarBancoDeTeste({ preparar: (c) => carregarFixtureDosTestes(c, { agora: agoraDaFixture() }) });
    const c = await nova();
    for (const t of [A.tenantId, B.tenantId]) {
      await c.query('begin');
      await c.query("select set_config('app.tenant_id', $1, true)", [t]);
      await c.query(BLOCO_DADOS);
      await c.query('commit');
    }
  });
  afterAll(async () => {
    for (const c of conexoes) await c.end();
    await b?.apagar();
  });
  /** O Hub numa transação curta com lock_timeout de 300 ms: null = passou; senão o SQLSTATE (55P03 = esperou a trava). */
  async function hub(c: pg.Client, tenant: string, chave: string) {
    const con = (await c.query<{ id: string }>("select id from integracao.conector where tenant_id = $1 and identificador = 'macuxierp'", [tenant])).rows[0]!.id;
    const passos = {
      lote_novo: () => c.query(`insert into integracao.lote (tenant_id, conector_id, entidade, modo, versao_contrato, chave_idempotencia, hash_conteudo, recebidas, status)
                               values ($1, $2, 'produto', 'delta', '1', 'chave-trava-' || $3 || '-0000', repeat('d', 64), 1, 'recebido')`, [tenant, con, chave]),
      lote_situacao: () => c.query("update integracao.lote set updated_at = now() where tenant_id = $1 and chave_idempotencia = 'chave-erp-produto-0001'", [tenant]),
      registro_novo: () => c.query("insert into integracao.registro_atual (tenant_id, entidade, conector_id, external_id, hash, alterado_em) values ($1, 'produto', $2, $3, repeat('e', 64), now())", [tenant, con, chave]),
      cliente: () => c.query('update core.cliente set updated_at = now() where tenant_id = $1 and external_id is not null', [tenant]),
    };
    const r: Record<string, string | null> = {};
    for (const [nome, f] of Object.entries(passos)) {
      await c.query('begin');
      await c.query("set local lock_timeout = '300ms'");
      try {
        await f();
        r[nome] = null;
      } catch (e) {
        r[nome] = (e as { code?: string }).code ?? 'erro';
      }
      await c.query('rollback');
    }
    return r;
  }

  it('o zerar trava o Hub só da empresa que zera; o Hub da outra segue; a prévia não trava nem a própria', async () => {
    const zerar = await nova();
    const outra = await nova();
    // o zerar em andamento (transação aberta): conector e lotes da A em FOR UPDATE
    await zerar.query('begin');
    await zerar.query("select * from plataforma.limpar_cadastros($1, '20261123T200000Z', array['nota'], true)", [A.tenantId]);
    expect(await hub(outra, B.tenantId, 'b-1')).toEqual({ lote_novo: null, lote_situacao: null, registro_novo: null, cliente: null });
    const naA = await hub(outra, A.tenantId, 'a-1');
    expect(naA).toMatchObject({ lote_novo: '55P03', lote_situacao: '55P03', registro_novo: '55P03' });
    await zerar.query('rollback');
    expect(await hub(outra, A.tenantId, 'a-1')).toEqual({ lote_novo: null, lote_situacao: null, registro_novo: null, cliente: null });

    // a prévia (worker, transação aberta depois de contar): nada da A nem da B fica travado
    const idPrevia = '00990099-0000-4000-8000-000000000099';
    await zerar.query("insert into plataforma.zerar_previa (id, empresa_id, super_admin_id) values ($1, $2, gen_random_uuid())", [idPrevia, A.tenantId]);
    await zerar.query('begin');
    const r = (await zerar.query<{ r: { situacao: string; total: number } }>('select plataforma.executar_previa_zerar($1) as r', [idPrevia])).rows[0]!.r;
    expect(r.situacao).toBe('pronta');
    expect(r.total).toBeGreaterThan(100);
    expect(await hub(outra, A.tenantId, 'a-2')).toEqual({ lote_novo: null, lote_situacao: null, registro_novo: null, cliente: null });
    expect(await hub(outra, B.tenantId, 'b-2')).toEqual({ lote_novo: null, lote_situacao: null, registro_novo: null, cliente: null });
    await zerar.query('commit');
  });
});

describe.skipIf(semBanco())('0100 up/down (banco efêmero vazio)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste({ migrar: false });
  });
  afterAll(async () => {
    await b?.apagar();
  });

  it('a 0100 só acrescenta; o down volta exatamente; as cópias do #675 vão e voltam pela public.macuxi_limpeza_backup', async () => {
    await comAdmin(b.nome, async (c) => {
      const T = '11111111-0000-4000-8000-000000000001';
      await migrarUp(c, { ate: '0099' });
      const antes = await retratoDoCatalogo(c);
      // o workflow do #675 rodou antes: a public existe com uma cópia
      await c.query(`create table public.macuxi_limpeza_backup (lote text not null, tenant_id uuid not null, tabela text not null,
        modo text not null check (modo in ('soft', 'fisico', 'filial', 'sync_pacote')), linha jsonb not null, copiado_em timestamptz not null default now())`);
      await c.query(`insert into public.macuxi_limpeza_backup (lote, tenant_id, tabela, modo, linha) values ('20261123T190000Z', $1, 'core.cliente', 'soft', '{"id": 1}')`, [T]);
      expect((await migrarUp(c, { ate: '0100' })).aplicadas).toEqual(['0100_plataforma_zerar_empresa']);
      const depois = await retratoDoCatalogo(c);
      expect(antes.filter((l) => !depois.includes(l))).toEqual([]);
      expect(depois.filter((l) => !antes.includes(l) && l.startsWith('rel ') && l.endsWith(' r rls=true force=true')).sort()).toEqual(TABELAS.map((t) => `rel ${t} r rls=true force=true`).sort());
      expect((await c.query<{ t: string | null }>("select to_regclass('public.macuxi_limpeza_backup')::text as t")).rows[0]!.t).toBeNull();
      const linha = { lote: '20261123T190000Z', tenant_id: T, tabela: 'core.cliente', modo: 'soft', linha: { id: 1 } };
      expect((await c.query('select lote, empresa_id as tenant_id, tabela, modo, linha from plataforma.limpeza_copia')).rows).toEqual([linha]);

      expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual(['0100_plataforma_zerar_empresa']);
      expect((await c.query('select lote, tenant_id, tabela, modo, linha from public.macuxi_limpeza_backup')).rows).toEqual([linha]);
      await c.query('drop table public.macuxi_limpeza_backup');
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await c.query(m100.down);
      expect(await retratoDoCatalogo(c)).toEqual(antes);
      await migrarUp(c, { ate: '0100' });
      expect(await retratoDoCatalogo(c)).toEqual(depois);
      await migrarDown(c, { passos: 1 });
      expect(await retratoDoCatalogo(c)).toEqual(antes);
    });
  });
});
