/**
 * 0084 — planos e licenças no portal e a trava do cadastro de usuários (ADR 0047 §3 a §6 e §8, revista pela ADR 0049; desenho
 * docs/desenho/planos-e-licencas.md §3; spec docs/design/telas/portal-config-enxuto.md §11.3; R-20261115-123000, item 1).
 * Dicionário: docs/banco/plataforma.md ("Troca de plano e licenças (0084)"). O que o BANCO garante:
 * - seed: os 4 planos do §11.3 (light, pme, enterprise, corporate) com os números da spec, promotor 0, adicionais Promotor 8000,
 *   Pesquisa 1000 e Treinamento 1000 centavos com incluidos 0, 2 meses grátis no anual e 14 dias de teste (PlanoSchema);
 * - sa_listar_planos: o catálogo (ListaPlanosSchema) para o super-admin e o admin do cliente; sessão inválida = 28000;
 * - sa_assinatura_da_empresa: a ficha (FichaAssinaturaSchema sem `valor`), 6 itens; sem assinatura = P0002; admin do cliente de
 *   outra empresa = 42501;
 * - sa_trocar_plano: idempotente por pedido_id, grava o histórico, liga os módulos e nunca desliga, abaixo do uso = 22023
 *   PLANO_ABAIXO_DO_USO (nada muda), hints do 422, só super-admin;
 * - licencas_do_tenant(): SECURITY INVOKER sob RLS, 6 itens = as regras do SDK (licencasContratadas, contarLicencasEmUso),
 *   for no key update na assinatura: na corrida da última vaga o 2º cadastro espera o 1º e já o vê (COMMIT de verdade);
 * - RLS: assinatura_historico e plano só do próprio tenant para o app (plano: for select); worker e portal sem tabela; o app (e
 *   papel que o herda) só trava a assinatura, o dono grava;
 * - up/down: só acrescenta; o down volta exatamente ao catálogo e às ACLs da migração anterior.
 * Estático (sempre) + banco (fixture dois-tenants, sempre com ROLLBACK; corrida e up/down num banco efêmero) no CI.
 * A migração é achada pelo NOME (o número é provisório até o merge).
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  conferirNovoUsuario,
  contarLicencasEmUso,
  FichaAssinaturaSchema,
  ITENS_CONTADOS,
  LICENCA_DO_PERFIL,
  licencasContratadas,
  ListaPlanosSchema,
  MODULOS,
  modulosDaAssinatura,
  usoPorItem,
  valorDaAssinatura,
  type ItemContado,
  type ModuloId,
  type Perfil,
  type Plano,
  type UsoDeLicenca,
} from '@macuxi/platform-sdk';
import { ASSINATURAS_FIXTURE, DOIS_TENANTS, PLANOS_FIXTURE } from '../seeds/fixtures/dois-tenants';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { TABELAS_FORA_DO_SYNC, TABELAS_SEM_TENANT_ID, TABELAS_SO_POR_FUNCAO } from '../src/excecoes';
import { lerMigracoes, migrarDown, migrarUp } from '../src/migrador';
import { comandoSetRole, SQL_PRECISA_SET_ROLE } from '../src/papeis';
import { banco, semBanco } from './estado';
import { FUNCOES_SA_PLANOS, FUNCOES_SA_ATE_0080, FUNCOES_SA_ATUAIS } from './funcoes-sa';
import { emTransacao, erroDe, HASH_TESTE, retratoDoCatalogo } from './util';

const migracoes = lerMigracoes();
const m81 = migracoes.find((m) => m.nome === 'plataforma_planos_troca_licencas')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(m81?.up ?? '');
const down = semComentarios(m81?.down ?? '');
/** Do início até o `$$;` que fecha a função. */
const bloco = (sql: string, inicio: string) => {
  const i = sql.indexOf(inicio);
  if (i < 0) return '';
  const fim = /^ {0,2}\$\$;$/m.exec(sql.slice(i));
  return fim ? sql.slice(i, i + fim.index + fim[0].length) : '';
};
const LISTAR = 'create function plataforma.sa_listar_planos(p_sid uuid)';
const FICHA = 'create function plataforma.sa_assinatura_da_empresa(p_sid uuid, p_tenant uuid)';
const TROCAR = 'create function plataforma.sa_trocar_plano(p_sid uuid, p_tenant uuid, p jsonb)';
const TRAVA = 'create function plataforma.licencas_do_tenant()';
const EM_USO = 'create function plataforma.licencas_em_uso(p_tenant uuid)';
const CONTRATADAS = 'create function plataforma.contratadas_do_plano(p_plano plataforma.plano, p_adicionais jsonb)';
const FUNCOES_APP = ['plataforma.contratadas_do_plano(plataforma.plano, jsonb)', 'plataforma.licencas_em_uso(uuid)', 'plataforma.situacao_das_licencas(plataforma.plano, jsonb, uuid)', 'plataforma.licencas_do_tenant()'];
const SITUACAO = 'create function plataforma.situacao_das_licencas(p_plano plataforma.plano, p_adicionais jsonb, p_tenant uuid)';

/** Os 4 planos de venda como o PlanoSchema os descreve (números da spec, §11.3). */
const MODULOS_DO_PLANO: ModuloId[] = ['core', 'catalogo', 'vendedor', 'gestor', 'integracao'];
const ADICIONAIS_DO_PLANO = [
  { adicional: 'promotor', preco_unitario_centavos: 8000, incluidos: 0 },
  { adicional: 'pesquisa', preco_unitario_centavos: 1000, incluidos: 0 },
  { adicional: 'treinamento', preco_unitario_centavos: 1000, incluidos: 0 },
] as const;
const plano = (n: number, codigo: string, nome: string, preco: number, vendedor: number, gestor: number, bko: number): Plano => ({
  id: `00830000-0000-4000-8000-00000000000${n}`, codigo, nome, ordem: n, preco_mensal_centavos: preco,
  licencas: { vendedor, gestor, bko, promotor: 0 }, modulos: [...MODULOS_DO_PLANO], adicionais: ADICIONAIS_DO_PLANO.map((a) => ({ ...a })),
  meses_gratis_anual: 2, dias_teste: 14, ativo: true,
});
const PLANOS_DE_VENDA: Plano[] = [
  plano(1, 'light', 'Light', 61000, 10, 1, 1),
  plano(2, 'pme', 'PME', 119700, 20, 2, 3),
  plano(3, 'enterprise', 'Enterprise', 171900, 30, 3, 5),
  plano(4, 'corporate', 'Corporate', 259250, 50, 5, 5),
];

const A = DOIS_TENANTS.A.tenantId;
const B = DOIS_TENANTS.B.tenantId;
const ADMIN_A = DOIS_TENANTS.A.usuarios.admin;
const ADMIN_B = DOIS_TENANTS.B.usuarios.admin;

describe('0084 planos, troca e licenças (estático)', () => {
  it('a migração existe com up e down, depois da 0074', () => {
    expect(m81, '0084_plataforma_planos_troca_licencas').toBeDefined();
    expect(m81.versao > '0074').toBe(true);
  });

  it('assinatura_historico: RLS por tenant, app só lê, fora do sync, pedido único por tenant; plano: o app lê só o do próprio tenant', () => {
    expect(TABELAS_SEM_TENANT_ID).not.toHaveProperty(['plataforma.assinatura_historico']);
    expect(TABELAS_FORA_DO_SYNC).toContain('plataforma.assinatura_historico');
    expect(TABELAS_SO_POR_FUNCAO).not.toContain('plataforma.plano');
    expect(TABELAS_SEM_TENANT_ID).toHaveProperty(['plataforma.plano']);
    expect(up).toContain('create unique index assinatura_historico_pedido_uk on plataforma.assinatura_historico (tenant_id, pedido_id);');
    expect(up).toMatch(
      /create policy isolamento_tenant on plataforma\.plano for select to macuxi_app\s+using \(id in \(select a\.plano_id from plataforma\.assinatura a where a\.tenant_id = plataforma\.tenant_atual\(\) and a\.deleted_at is null\)\);/,
    );
    expect(up).toContain('create policy leitura on plataforma.assinatura_historico for select to macuxi_leitura using (tenant_id = plataforma.tenant_atual());');
    // todas as permissões novas: o app (e o macuxi_leitura) lê o histórico, o app lê o seu plano, trava a assinatura e chama a trava; o portal, as 3 sa_*
    expect([...up.matchAll(/\bgrant [^;]+;/g)].map((x) => x[0].replace(/\s+/g, ' '))).toEqual([
      'grant select on plataforma.assinatura_historico to macuxi_app;',
      'grant select on plataforma.assinatura_historico to macuxi_leitura;', // consulta só leitura (0078, ADR 0055)
      'grant select on plataforma.plano to macuxi_app;',
      'grant update (updated_at) on plataforma.assinatura to macuxi_app;',
      ...FUNCOES_APP.map((f) => `grant execute on function ${f} to macuxi_app;`),
      ...FUNCOES_SA_PLANOS.map((f) => `grant execute on function ${f} to macuxi_portal;`),
    ]);
    expect(up).not.toMatch(/create policy [a-z_]+ on plataforma\.[a-z_]+ for [a-z]+ to macuxi_(worker|portal)/);
    // o app só trava a assinatura: o gatilho recusa o UPDATE de quem tem os privilégios do macuxi_app ('usage' pega o papel que o
    // herda; 'member' pegaria o admin, membro com SET sem INHERIT), menos o dono da tabela (sa_* DEFINER) e o superusuário
    const trava = bloco(up, 'create function plataforma.assinatura_so_trava()');
    expect(trava).toMatch(
      /if pg_has_role\(current_user, 'macuxi_app', 'usage'\)\s+and not pg_has_role\(current_user, \(select c\.relowner from pg_catalog\.pg_class c where c\.oid = tg_relid\), 'usage'\) then/,
    );
    expect(trava).not.toMatch(/current_user = 'macuxi_app'|'member'/);
    expect(trava).toContain("using errcode = '42501';");
    expect(up).toContain('create trigger assinatura_so_trava before update on plataforma.assinatura');
  });

  it('licencas_do_tenant: SECURITY INVOKER, trava a assinatura num comando e conta no seguinte; contagem pela base (= LICENCA_DO_PERFIL do SDK)', () => {
    const b = bloco(up, TRAVA);
    expect(b).toMatch(/returns table \(item text, contratadas integer, em_uso integer, teste_ate text, paga boolean\)\s+language plpgsql volatile security invoker\s+set search_path = pg_catalog, plataforma, pg_temp/);
    expect(b).not.toContain('for update;');
    const lock = b.indexOf('for no key update;');
    const conta = b.indexOf('return query');
    expect(lock).toBeGreaterThan(-1);
    expect(conta).toBeGreaterThan(lock);
    expect(b.slice(0, lock)).toContain('where a.tenant_id = plataforma.tenant_atual() and a.deleted_at is null');
    const uso = bloco(up, EM_USO);
    expect(uso).toMatch(/language sql stable\s+set search_path = pg_catalog, plataforma, pg_temp/);
    expect(uso).not.toMatch(/security definer/);
    const mapa = Object.fromEntries([...uso.matchAll(/when '([a-z]+)' then '([a-z]+)'/g)].map((x) => [x[1], x[2]]));
    expect(mapa).toEqual({ ...LICENCA_DO_PERFIL });
    // RN-PLA-02: só o usuário ativo e não excluído, pelo perfil vivo e ativo (um por usuário, ADR 0049); sem prioridade de multiperfil
    expect(uso).toContain('where u.tenant_id = p_tenant and u.ativo and u.deleted_at is null');
    expect(uso).toContain('pf.deleted_at is null and pf.ativo');
    expect(uso).not.toMatch(/prioridade|array_position\(array\['vendedor', 'gestor', 'promotor'/);
    // RN-PLA-03: módulo efetivo = perfil ∩ tenant ativo − exceção
    expect(uso).toContain("pm.modulo in ('pesquisa', 'treinamento')");
    expect(uso).toContain("um.efeito = 'remover' and um.deleted_at is null");
    // os 6 itens na ordem de ITENS_CONTADOS
    expect(uso).toContain(`unnest(array[${ITENS_CONTADOS.map((i) => `'${i}'`).join(', ')}])`);
    // RD-1625: a junção contratadas × em uso só na situacao_das_licencas, na ordem de contratadas_do_plano; quem lê ordena por n
    const situacao = bloco(up, SITUACAO);
    expect(situacao).toMatch(/language sql stable\s+set search_path = pg_catalog, plataforma, pg_temp/);
    expect(situacao).toContain('from plataforma.contratadas_do_plano(p_plano, p_adicionais) with ordinality as c (item, contratadas, n)');
    expect(situacao).toContain('join plataforma.licencas_em_uso(p_tenant) u on u.item = c.item');
    expect(up.match(/join plataforma\.licencas_em_uso\(/g)).toHaveLength(1);
    expect(up).not.toContain('array_position(');
    expect(b).toContain('plataforma.situacao_das_licencas(pl, v_a.adicionais, v_a.tenant_id) l');
    expect([...bloco(up, CONTRATADAS).matchAll(/\((\d), '([a-z]+)', /g)].map((x) => x[2])).toEqual([...ITENS_CONTADOS]);
    expect(bloco(up, CONTRATADAS)).toMatch(/language sql immutable\s+set search_path = pg_catalog, plataforma, pg_temp/);
  });

  it('sa_*: SECURITY DEFINER, sessão (28000), permissão (42501), P0002, hints do 422, idempotência por pedido_id e trava da assinatura', () => {
    // as 27 até o main na frente; as dos lotes da v1.0.14 (outros lotes, como a logo, também entram) depois
    expect(FUNCOES_SA_ATUAIS.slice(0, FUNCOES_SA_ATE_0080.length)).toEqual([...FUNCOES_SA_ATE_0080]);
    expect(FUNCOES_SA_ATUAIS).toEqual(expect.arrayContaining([...FUNCOES_SA_PLANOS]));
    expect(new Set(FUNCOES_SA_ATUAIS).size).toBe(FUNCOES_SA_ATUAIS.length); // sem repetição; o total não é fixado (cada lote soma a sua)
    for (const inicio of [LISTAR, FICHA, TROCAR]) {
      const b = bloco(up, inicio);
      expect(b, inicio).toMatch(/returns jsonb\s+language plpgsql volatile security definer\s+set search_path = pg_catalog, plataforma, pg_temp/);
      expect(b, inicio).toContain('from plataforma.sa_sessao_valida(p_sid) v;');
      expect(b, inicio).toMatch(/if v_tipo is null then\s+raise exception '[^']+' using errcode = '28000';/);
    }
    for (const f of FUNCOES_SA_PLANOS) {
      expect(up).toContain(`revoke all on function ${f} from public, macuxi_app, macuxi_worker;`);
      expect(up).toContain(`grant execute on function ${f} to macuxi_portal;`);
    }
    const ficha = bloco(up, FICHA);
    expect(ficha).toContain("(v_tipo = 'admin_cliente' and v_t is not null and v_t = p_tenant)");
    expect(ficha.indexOf("errcode = '42501'")).toBeLessThan(ficha.indexOf("errcode = 'P0002'"));
    for (const chave of ['tenant_id', 'plano', 'ciclo', 'adicionais', 'teste_ate', 'paga', 'desde', 'atualizada_em', 'licencas']) {
      expect(ficha).toContain(`'${chave}', `);
    }
    expect(Object.keys(FichaAssinaturaSchema.shape).filter((k) => k !== 'valor').sort()).toEqual(
      ['tenant_id', 'plano', 'ciclo', 'adicionais', 'teste_ate', 'paga', 'desde', 'atualizada_em', 'licencas'].sort(),
    );
    const t = bloco(up, TROCAR);
    expect(t).toMatch(/if v_tipo is distinct from 'super_admin' or v_sa is null then\s+raise exception '[^']+' using errcode = '42501';/);
    // as chaves da EntradaTrocaDePlano de apps/api/src/planos-portal.ts
    expect(t).toContain("k not in ('plano', 'ciclo', 'adicionais', 'pedido_id', 'modulos')");
    for (const hint of ['PLANO_DESCONHECIDO', 'PLANO_INATIVO', 'ADICIONAL_FORA_DO_PLANO', 'MODULOS_FORA_DO_PLANO', 'PLANO_ABAIXO_DO_USO']) {
      expect(t).toContain(`errcode = '22023', hint = '${hint}'`);
    }
    // em fila com a sa_gravar_assinatura, assinatura travada, e o pedido repetido antes de qualquer conferência do plano
    const fila = t.indexOf("perform pg_advisory_xact_lock(hashtextextended('plataforma.assinatura:' || p_tenant::text, 0));");
    const forUpdate = t.indexOf('for update;');
    const repetido = t.indexOf('from plataforma.assinatura_historico h where h.tenant_id = p_tenant and h.pedido_id = v_pedido');
    const catalogo = t.indexOf("hint = 'PLANO_DESCONHECIDO'");
    expect(fila).toBeGreaterThan(-1);
    expect(forUpdate).toBeGreaterThan(fila);
    expect(repetido).toBeGreaterThan(forUpdate);
    expect(catalogo).toBeGreaterThan(repetido);
    // RN-PLA-05: o uso igual ao contratado cabe (só o uso maior recusa)
    expect(t).toContain('where l.contratadas is not null and l.em_uso > l.contratadas;');
    expect(t).not.toMatch(/u\.em_uso >= c\.contratadas/);
    // a recusa (raise, que desfaz a transação) vem antes de gravar o histórico: o pedido recusado não fica como existente
    const abaixo = t.indexOf("hint = 'PLANO_ABAIXO_DO_USO'");
    expect(abaixo).toBeGreaterThan(catalogo);
    expect(t.indexOf('insert into plataforma.assinatura_historico')).toBeGreaterThan(abaixo);
    // o pedido_id é chave por tenant: o mesmo uuid em outra empresa é outro pedido
    expect(up).toContain('create unique index assinatura_historico_pedido_uk on plataforma.assinatura_historico (tenant_id, pedido_id);');
    // nunca desliga módulo: só insere ou religa
    expect(t).not.toMatch(/set ativo = false|desativado_em = now\(\)/);
    expect(t).toContain('on conflict (tenant_id, modulo) where deleted_at is null do nothing;');
    // auditoria sem dado pessoal
    const aud = t.split('\n').filter((l) => /sa_registrar_auditoria|jsonb_build_object\('plano'/.test(l)).join('\n');
    expect(aud).toContain("'sa.assinatura.trocar'");
    expect(aud).not.toMatch(/nome|email|cnpj|documento/);
    // conferência pela diferença (as 0075 a 0083 de outros lotes também acrescentam sa_*)
    expect(up).toContain("select set_config('macuxi.sa_portal_antes_0084', (");
    expect(up).toContain('if v_antes is null or v_n <> v_antes + 3 then');
  });

  it('seed: os 4 planos do §11.3 da spec (preço, licenças, anual com 2 meses grátis), promotor 0 e os 3 adicionais com incluidos 0', () => {
    const linhas = [...up.matchAll(/\('(00830000-[0-9a-f-]+)', '([a-z]+)',\s+'([^']+)',\s+(\d+),\s+(\d+), (\d+), (\d+), (\d+)\)/g)].map((x) => ({
      id: x[1], codigo: x[2], nome: x[3], ordem: Number(x[4]), preco: Number(x[5]), vendedor: Number(x[6]), gestor: Number(x[7]), bko: Number(x[8]),
    }));
    expect(linhas).toEqual(
      PLANOS_DE_VENDA.map((p) => ({
        id: p.id, codigo: p.codigo, nome: p.nome, ordem: p.ordem, preco: p.preco_mensal_centavos, vendedor: p.licencas.vendedor, gestor: p.licencas.gestor, bko: p.licencas.bko,
      })),
    );
    const seed = up.slice(up.indexOf('insert into plataforma.plano'), up.indexOf('on conflict (codigo) where deleted_at is null do nothing;'));
    expect(seed).toContain("array['core', 'catalogo', 'vendedor', 'gestor', 'integracao']");
    expect(seed).toMatch(/v\.vendedor, v\.gestor, v\.bko, 0,/);
    expect(seed).toMatch(/\s2, 14, true\s/);
    const adicionais = JSON.parse(/'(\[[^']+\])'::jsonb/.exec(seed)![1]!);
    expect(adicionais).toEqual(ADICIONAIS_DO_PLANO);

    // a tabela do §11.3 da spec (docs/design/telas/portal-config-enxuto.md), copiada aqui: o teste de banco não lê docs
    // (regra R4 do grafo do turbo). Spec mudou? Atualize esta tabela e a semente juntas.
    const DA_SPEC = [
      { nome: 'Light', codigo: 'light', mensal: 61000, anual: 610000, licencas: [10, 1, 1] },
      { nome: 'PME', codigo: 'pme', mensal: 119700, anual: 1197000, licencas: [20, 2, 3] },
      { nome: 'Enterprise', codigo: 'enterprise', mensal: 171900, anual: 1719000, licencas: [30, 3, 5] },
      { nome: 'Corporate', codigo: 'corporate', mensal: 259250, anual: 2592500, licencas: [50, 5, 5] },
    ] as const;
    expect(DA_SPEC.map((x) => x.codigo)).toEqual(PLANOS_DE_VENDA.map((p) => p.codigo));
    for (const [i, x] of DA_SPEC.entries()) {
      const p = PLANOS_DE_VENDA[i]!;
      expect(x.nome, p.codigo).toBe(p.nome);
      expect(x.mensal, p.codigo).toBe(p.preco_mensal_centavos);
      expect(x.anual, p.codigo).toBe(valorDaAssinatura(p, [], 'anual').por_ciclo_centavos);
      expect([...x.licencas], p.codigo).toEqual([p.licencas.vendedor, p.licencas.gestor, p.licencas.bko]);
    }
    // §11.9: preço por licença (vendedor R$ 50, gestor R$ 70, BKO R$ 40) com o desconto de cada plano
    for (const [i, desconto] of [0, 5, 10, 15].entries()) {
      const p = PLANOS_DE_VENDA[i]!;
      const cheio = p.licencas.vendedor! * 5000 + p.licencas.gestor! * 7000 + p.licencas.bko! * 4000;
      expect((cheio * (100 - desconto)) / 100, p.codigo).toBe(p.preco_mensal_centavos);
    }
    // §11.3, 2 e 4: adicionais (Promotor R$ 80,00 por licença; Pesquisa e Treinamento R$ 10,00 por usuário, por mês) e o
    // exemplo da simulação (PME + 3 promotores + 10 Pesquisa = R$ 1.537,00/mês)
    expect(Object.fromEntries(ADICIONAIS_DO_PLANO.map((x) => [x.adicional, x.preco_unitario_centavos]))).toEqual({ promotor: 8000, pesquisa: 1000, treinamento: 1000 });
    const pme = PLANOS_DE_VENDA[1]!;
    expect(valorDaAssinatura(pme, [{ adicional: 'promotor', quantidade: 3 }, { adicional: 'pesquisa', quantidade: 10 }], 'mensal').mensal_centavos).toBe(153700);
    // e a fixture continua com os planos só de teste (códigos fixture_*), sem colidir com os de venda
    expect(Object.values(PLANOS_FIXTURE).map((p) => p.codigo).every((c) => c.startsWith('fixture_'))).toBe(true);
  });

  it('down: apaga funções, gatilho, grants, política e o histórico, e só os planos do seed sem assinatura; nada criado', () => {
    for (const f of [...FUNCOES_SA_PLANOS, ...FUNCOES_APP, 'plataforma.plano_json(plataforma.plano)', 'plataforma.assinatura_so_trava()']) {
      expect(down).toContain(`drop function if exists ${f};`);
    }
    expect(down).toContain('drop trigger if exists assinatura_so_trava on plataforma.assinatura;');
    expect(down).toContain('revoke update (updated_at) on plataforma.assinatura from macuxi_app;');
    expect(down).toContain('drop policy if exists isolamento_tenant on plataforma.plano;');
    expect(down).toContain('revoke select on plataforma.plano from macuxi_app;');
    expect(down.indexOf('drop table if exists plataforma.assinatura_historico;')).toBeLessThan(down.indexOf('delete from plataforma.plano pl'));
    expect(down).toContain('and not exists (select 1 from plataforma.assinatura a where a.plano_id = pl.id);');
    for (const p of PLANOS_DE_VENDA) expect(down).toContain(`'${p.id}'`);
    expect(down).not.toMatch(/\bcreate |\bgrant /);
  });
});

describe.skipIf(semBanco())('0084 planos, troca e licenças (banco, fixture dois-tenants)', () => {
  let admin: pg.Client;
  beforeAll(async () => {
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    await admin?.end();
  });

  /** Roda como o papel dado (contexto de tenant opcional) dentro da transação aberta; um erro não aborta o caso. */
  async function como<T extends pg.QueryResultRow = Record<string, unknown>>(papel: string, sql: string, params: unknown[] = [], tenant = '') {
    await admin.query('savepoint como');
    try {
      await admin.query(`set local role ${papel}`);
      await admin.query("select set_config('app.tenant_id', $1, true)", [tenant]);
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
  const portal = <T extends pg.QueryResultRow = Record<string, unknown>>(sql: string, params: unknown[] = []) => como<T>('macuxi_portal', sql, params).then((r) => r.rows);
  const abrir = async (p: unknown) => (await portal<{ sessao_id: string }>('select * from plataforma.sa_abrir_sessao_portal($1::jsonb)', [JSON.stringify(p)]))[0]!.sessao_id;
  async function sessaoSuperAdmin() {
    const sa = (await q<{ r: { super_admin_id: string } }>('select plataforma.criar_super_admin($1::jsonb) as r', [JSON.stringify({ acao: 'criar', email: 'operador.troca@macuxi.exemplo', nome: 'Operador 0084', senha_hash: HASH_TESTE })]))[0]!.r;
    return abrir({ tipo: 'super_admin', super_admin_id: sa.super_admin_id });
  }
  const listar = async (sid: string | null) => (await portal<{ r: unknown }>('select plataforma.sa_listar_planos($1) as r', [sid]))[0]!.r;
  const ficha = async (sid: string | null, tenant: string | null) => (await portal<{ r: unknown }>('select plataforma.sa_assinatura_da_empresa($1, $2) as r', [sid, tenant]))[0]!.r;
  const trocar = async (sid: string | null, tenant: string | null, e: unknown) =>
    (await portal<{ r: { resultado: string; modulos_ligados: string[] } }>('select plataforma.sa_trocar_plano($1, $2, $3::jsonb) as r', [sid, tenant, JSON.stringify(e)]))[0]!.r;
  /** SQLSTATE e hint do erro (o hint leva o código do 422). */
  const falha = async (p: Promise<unknown>) => {
    try {
      await p;
      return null;
    } catch (e) {
      const x = e as { code?: string; hint?: string };
      return { code: x.code, hint: x.hint ?? null };
    }
  };
  const FichaCrua = FichaAssinaturaSchema.omit({ valor: true });
  const novoTenant = async (codigo: string) =>
    (await q<{ id: string }>('insert into plataforma.tenant (codigo, nome) values ($1, $2) returning id', [codigo, `Empresa ${codigo}`]))[0]!.id;
  /** Adicionais dos planos de teste: Pesquisa e Treinamento com incluídos sem limite (só o item testado fica abaixo do uso). */
  const ADICIONAIS_SEM_LIMITE = ADICIONAIS_DO_PLANO.map((a) => ({ ...a, incluidos: a.adicional === 'promotor' ? 0 : null }));
  /** Plano de teste gravado na transação (desfeita no fim): licenças sem limite, salvo o vendedor pedido. */
  async function planoDeTeste(codigo: string, extra: { vendedor?: number | null; modulos?: string[]; adicionais?: unknown[]; ativo?: boolean } = {}) {
    await q(
      `insert into plataforma.plano (codigo, nome, ordem, preco_mensal_centavos, licenca_vendedor, licenca_gestor, licenca_bko, licenca_promotor, modulos, adicionais, ativo)
       values ($1, $1, 50, 1000, $2, null, null, null, $3, $4::jsonb, $5)`,
      [codigo, extra.vendedor ?? null, extra.modulos ?? MODULOS_DO_PLANO, JSON.stringify(extra.adicionais ?? ADICIONAIS_SEM_LIMITE), extra.ativo ?? true],
    );
  }
  const planoDoCatalogo = async (sid: string, codigo: string) => ListaPlanosSchema.parse(await listar(sid)).itens.find((p) => p.codigo === codigo)!;
  const linhasDaTrava = async (tenant: string) =>
    (await como<UsoDeLicenca & { teste_ate: string | null; paga: boolean }>('macuxi_app', 'select * from plataforma.licencas_do_tenant()', [], tenant)).rows;

  /** Em uso pelas regras do SDK (contarLicencasEmUso), a partir das linhas cruas (independente da função do banco). */
  async function usoPeloSdk(tenant: string): Promise<Record<ItemContado, number>> {
    const usuarios = await q<{ id: string; ativo: boolean; base: Perfil | null; codigo: string | null }>(
      `select u.id, u.ativo, pf.base, pf.codigo
         from core.usuario u
         left join plataforma.usuario_perfil up on up.tenant_id = u.tenant_id and up.usuario_id = u.id and up.deleted_at is null
         left join plataforma.perfil pf on pf.tenant_id = up.tenant_id and pf.id = up.perfil_id and pf.deleted_at is null and pf.ativo
        where u.tenant_id = $1 and u.deleted_at is null`,
      [tenant],
    );
    const perfilModulo = await q<{ perfil: string; modulo: string }>('select perfil, modulo from plataforma.perfil_modulo where tenant_id = $1 and deleted_at is null', [tenant]);
    const ativos = new Set((await q<{ modulo: string }>('select modulo from plataforma.tenant_modulo where tenant_id = $1 and ativo and deleted_at is null', [tenant])).map((x) => x.modulo));
    const removidos = await q<{ usuario_id: string; modulo: string }>(
      "select usuario_id, modulo from plataforma.usuario_modulo where tenant_id = $1 and efeito = 'remover' and deleted_at is null",
      [tenant],
    );
    const ehModulo = (m: string): m is ModuloId => (MODULOS as readonly string[]).includes(m);
    return contarLicencasEmUso(
      usuarios.map((u) => ({
        ativo: u.ativo,
        bases: u.base ? [u.base] : [],
        modulos: perfilModulo
          .filter((p) => p.perfil === u.codigo && ativos.has(p.modulo) && !removidos.some((r) => r.usuario_id === u.id && r.modulo === p.modulo))
          .map((p) => p.modulo)
          .filter(ehModulo),
      })),
    );
  }

  it('seed e sa_listar_planos: os 4 planos de venda iguais à spec (ListaPlanosSchema), para o super-admin e o admin do cliente; 28000 sem sessão; app e worker 42501', async () => {
    await emTransacao(admin, null, async () => {
      const sid = await sessaoSuperAdmin();
      const lista = ListaPlanosSchema.parse(await listar(sid));
      expect(lista.itens.filter((p) => !p.codigo.startsWith('fixture_'))).toEqual(PLANOS_DE_VENDA);
      // o inativo da fixture aparece (a ficha mostra o plano mesmo fora de venda; o portal oferece só os ativos)
      expect(lista.itens.find((p) => p.codigo === PLANOS_FIXTURE.antigo.codigo)?.ativo).toBe(false);
      const cli = await abrir({ tipo: 'admin_cliente', empresas: [{ tenant_id: A, usuario_id: ADMIN_A }] });
      expect(ListaPlanosSchema.parse(await listar(cli))).toEqual(lista);
      expect((await erroDe(listar(null)))?.code).toBe('28000');
      for (const papel of ['macuxi_app', 'macuxi_worker']) {
        expect((await erroDe(como(papel, 'select plataforma.sa_listar_planos(null)')))?.code, papel).toBe('42501');
      }
    });
  });

  it('RLS: o app lê só o plano e o histórico do próprio tenant, só trava a assinatura (UPDATE = 42501); worker e portal sem tabela', async () => {
    await emTransacao(admin, null, async () => {
      expect((await como<{ id: string }>('macuxi_app', 'select id from plataforma.plano', [], A)).rows).toEqual([{ id: PLANOS_FIXTURE.pme.id }]);
      expect((await como('macuxi_app', 'select id from plataforma.plano', [], '')).rowCount).toBe(0);
      expect((await como<{ id: string }>('macuxi_app', 'select id from plataforma.assinatura_historico', [], A)).rows).toEqual([{ id: ASSINATURAS_FIXTURE.A.historico.id }]);
      expect((await como<{ id: string }>('macuxi_app', 'select id from plataforma.assinatura_historico', [], B)).rows).toEqual([{ id: ASSINATURAS_FIXTURE.B.historico.id }]);
      for (const sql of [
        'update plataforma.assinatura_historico set ciclo = ciclo',
        'delete from plataforma.assinatura_historico',
        "update plataforma.plano set nome = 'x'",
        'update plataforma.assinatura set paga = true',
        'update plataforma.assinatura set updated_at = now()',
      ]) {
        expect((await erroDe(como('macuxi_app', sql, [], A)))?.code, sql).toBe('42501');
      }
      // travar a linha é permitido (é o que a licencas_do_tenant faz)
      expect((await como('macuxi_app', 'select id from plataforma.assinatura for no key update', [], A)).rowCount).toBe(1);
      // papel que herda o macuxi_app também só trava; o dono (admin/migrador) grava
      const herdeiro = `macuxi_t0084_${randomBytes(4).toString('hex')}`;
      await q(`create role ${herdeiro} nologin nosuperuser nobypassrls`);
      await q(`grant macuxi_app to ${herdeiro} with inherit true`);
      const set = await q<{ precisa: boolean }>(SQL_PRECISA_SET_ROLE, [herdeiro]);
      if (set[0]?.precisa === true) await q(comandoSetRole(herdeiro));
      expect((await como(herdeiro, 'select id from plataforma.assinatura for no key update', [], A)).rowCount).toBe(1);
      expect((await erroDe(como(herdeiro, 'update plataforma.assinatura set updated_at = now()', [], A)))?.code).toBe('42501');
      expect((await admin.query('update plataforma.assinatura set updated_at = updated_at where tenant_id = $1', [A])).rowCount).toBe(1);
      for (const papel of ['macuxi_worker', 'macuxi_portal']) {
        for (const t of ['plataforma.assinatura_historico', 'plataforma.plano']) {
          expect((await erroDe(como(papel, `select 1 from ${t} limit 1`, [], A)))?.code, `${papel} ${t}`).toBe('42501');
        }
        expect((await erroDe(como(papel, 'select * from plataforma.licencas_do_tenant()', [], A)))?.code, papel).toBe('42501');
      }
    });
  });

  it('licencas_do_tenant: 6 itens = SDK (licencasContratadas e contarLicencasEmUso), teste_ate e paga; sem contexto ou sem assinatura = nada; um perfil por usuário', async () => {
    await emTransacao(admin, null, async () => {
      const sid = await sessaoSuperAdmin();
      const pme = await planoDoCatalogo(sid, PLANOS_FIXTURE.pme.codigo);
      const conferir = async (tenant: string, adicionais: { adicional: 'promotor' | 'pesquisa' | 'treinamento'; quantidade: number }[]) => {
        const linhas = await linhasDaTrava(tenant);
        expect(linhas.map((l) => l.item)).toEqual([...ITENS_CONTADOS]);
        const { contratadas, emUso } = usoPorItem(linhas.map(({ item, contratadas: c, em_uso }) => ({ item, contratadas: c, em_uso })));
        expect(contratadas).toEqual(licencasContratadas(pme, adicionais));
        expect(emUso).toEqual(await usoPeloSdk(tenant));
        return { linhas, emUso };
      };
      const a = await conferir(A, [{ adicional: 'promotor', quantidade: 2 }]);
      expect(a.linhas.every((l) => l.teste_ate === ASSINATURAS_FIXTURE.A.teste_ate && l.paga === false)).toBe(true);
      expect(a.emUso.vendedor).toBeGreaterThanOrEqual(2);
      const b = await conferir(B, []);
      expect(b.linhas.every((l) => l.teste_ate === null && l.paga === true)).toBe(true);

      // inativo não conta; bloqueado conta; o perfil (um só) dá o tipo; Pesquisa = módulo efetivo (perfil ∩ tenant − exceção)
      const antes = a.emUso;
      await q("update core.usuario set ativo = false where id = $1", [DOIS_TENANTS.A.usuarios.vendedor2]);
      await q("update core.usuario set bloqueado_em = now() where id = $1", [DOIS_TENANTS.A.usuarios.vendedor1]);
      await q("insert into core.usuario (tenant_id, nome, email, perfil, senha_hash) values ($1, 'Gerente 83', 'gerente83@exemplo.com.br', 'gerente', $2)", [A, HASH_TESTE]);
      await q("insert into plataforma.tenant_modulo (tenant_id, modulo, ativo) values ($1, 'pesquisa', true)", [A]);
      await q("insert into plataforma.perfil_modulo (tenant_id, perfil, modulo) values ($1, 'gerente', 'pesquisa'), ($1, 'supervisor', 'pesquisa')", [A]);
      const comPesquisa = await conferir(A, [{ adicional: 'promotor', quantidade: 2 }]);
      expect(comPesquisa.emUso.vendedor).toBe(antes.vendedor - 1);
      expect(comPesquisa.emUso.gestor).toBe(antes.gestor + 1);
      expect(comPesquisa.emUso.pesquisa).toBeGreaterThanOrEqual(3); // o gerente e o supervisor da fixture e o gerente novo
      await q("insert into plataforma.usuario_modulo (tenant_id, usuario_id, modulo) values ($1, $2, 'pesquisa')", [A, DOIS_TENANTS.A.usuarios.supervisor]);
      const depois = await conferir(A, [{ adicional: 'promotor', quantidade: 2 }]);
      expect(depois.emUso.pesquisa).toBe(comPesquisa.emUso.pesquisa - 1);

      expect(await linhasDaTrava('')).toEqual([]);
      const semPlano = await novoTenant('t0084-sem-plano');
      expect(await linhasDaTrava(semPlano)).toEqual([]);
      // a trava do SDK: com a situação do banco, a próxima vaga de vendedor da fixture (3 contratadas)
      const s = usoPorItem(depois.linhas.map(({ item, contratadas: c, em_uso }) => ({ item, contratadas: c, em_uso })));
      const r = conferirNovoUsuario({ ...s, testeAte: null, paga: true }, { bases: ['vendedor'], modulos: [] }, '2026-11-15');
      expect(r.pode).toBe(depois.emUso.vendedor + 1 <= 3);
    });
  });

  it('sa_assinatura_da_empresa: a ficha (FichaAssinaturaSchema sem valor) igual à trava; admin do cliente só a da sessão (42501); sem assinatura P0002; 28000', async () => {
    await emTransacao(admin, null, async () => {
      const sid = await sessaoSuperAdmin();
      const fa = FichaCrua.parse(await ficha(sid, A));
      expect(fa).toMatchObject({
        tenant_id: A, ciclo: 'mensal', adicionais: [{ adicional: 'promotor', quantidade: 2 }], teste_ate: ASSINATURAS_FIXTURE.A.teste_ate, paga: false,
      });
      expect(fa.plano.id).toBe(PLANOS_FIXTURE.pme.id);
      expect(fa.licencas).toEqual((await linhasDaTrava(A)).map(({ item, contratadas, em_uso }) => ({ item, contratadas, em_uso })));
      expect(FichaCrua.parse(await ficha(sid, B))).toMatchObject({ tenant_id: B, ciclo: 'anual', teste_ate: null, paga: true });

      const cliA = await abrir({ tipo: 'admin_cliente', empresas: [{ tenant_id: A, usuario_id: ADMIN_A }] });
      const cliB = await abrir({ tipo: 'admin_cliente', empresas: [{ tenant_id: B, usuario_id: ADMIN_B }] });
      expect(FichaCrua.parse(await ficha(cliA, A)).tenant_id).toBe(A);
      expect((await erroDe(ficha(cliA, B)))?.code).toBe('42501');
      expect((await erroDe(ficha(cliB, A)))?.code).toBe('42501');
      // a outra empresa que nem existe: 42501 antes de dizer que não existe
      expect((await erroDe(ficha(cliA, '00830000-ffff-4000-8000-000000000000')))?.code).toBe('42501');

      const semPlano = await novoTenant('t0084-ficha');
      expect((await erroDe(ficha(sid, semPlano)))?.code).toBe('P0002');
      expect((await erroDe(ficha(sid, '00830000-ffff-4000-8000-000000000000')))?.code).toBe('P0002');
      expect((await erroDe(ficha(null, A)))?.code).toBe('28000');
      expect((await erroDe(ficha(sid, null)))?.code).toBe('22023');
      for (const papel of ['macuxi_app', 'macuxi_worker']) {
        expect((await erroDe(como(papel, 'select plataforma.sa_assinatura_da_empresa(null, null)')))?.code, papel).toBe('42501');
      }
    });
  });

  it('sa_trocar_plano: troca, grava o histórico, liga (e religa) os módulos e nunca desliga; idempotente por pedido_id; audita', async () => {
    await emTransacao(admin, null, async () => {
      const sid = await sessaoSuperAdmin();
      await planoDeTeste('teste_livre_84');
      const livre = await planoDoCatalogo(sid, 'teste_livre_84');
      // integracao desligado antes: a troca religa
      await q("insert into plataforma.tenant_modulo (tenant_id, modulo, ativo, desativado_em) values ($1, 'integracao', false, now())", [A]);
      const adicionais = [{ adicional: 'promotor' as const, quantidade: 1 }];
      const pedido1 = '00830000-0000-4000-8000-0000000000a1';
      const e1 = { plano: livre.codigo, ciclo: 'anual', adicionais, pedido_id: pedido1, modulos: modulosDaAssinatura(livre, adicionais) };
      expect(await trocar(sid, A, e1)).toEqual({ resultado: 'trocada', modulos_ligados: ['gestor', 'integracao'] });
      expect(await q('select plano_id, ciclo, adicionais, teste_ate::text as teste_ate, paga from plataforma.assinatura where tenant_id = $1 and deleted_at is null', [A])).toEqual([
        { plano_id: livre.id, ciclo: 'anual', adicionais, teste_ate: ASSINATURAS_FIXTURE.A.teste_ate, paga: false },
      ]);
      const modulos = async () =>
        Object.fromEntries((await q<{ modulo: string; ativo: boolean }>('select modulo, ativo from plataforma.tenant_modulo where tenant_id = $1 and deleted_at is null', [A])).map((x) => [x.modulo, x.ativo]));
      expect(await modulos()).toMatchObject({ core: true, catalogo: true, vendedor: true, promotor: true, gestor: true, integracao: true, teste: true, 'teste-dependente': true });
      expect(await q("select desativado_em from plataforma.tenant_modulo where tenant_id = $1 and modulo = 'integracao' and deleted_at is null", [A])).toEqual([{ desativado_em: null }]);

      // 2ª troca: sem o adicional Promotor; o módulo promotor (com usuário) e os de teste continuam ligados
      const pedido2 = '00830000-0000-4000-8000-0000000000a2';
      expect(await trocar(sid, A, { ...e1, ciclo: 'mensal', adicionais: [], pedido_id: pedido2, modulos: modulosDaAssinatura(livre, []) })).toEqual({ resultado: 'trocada', modulos_ligados: [] });
      expect(await modulos()).toMatchObject({ promotor: true, teste: true, 'teste-dependente': true });

      // repetir o 1º pedido (ou o da fixture): nada muda
      const antes = await q('select plano_id, ciclo, adicionais, updated_at from plataforma.assinatura where tenant_id = $1 and deleted_at is null', [A]);
      expect(await trocar(sid, A, e1)).toEqual({ resultado: 'existente', modulos_ligados: [] });
      expect(await trocar(sid, A, { ...e1, pedido_id: ASSINATURAS_FIXTURE.A.historico.pedido_id })).toEqual({ resultado: 'existente', modulos_ligados: [] });
      expect(await q('select plano_id, ciclo, adicionais, updated_at from plataforma.assinatura where tenant_id = $1 and deleted_at is null', [A])).toEqual(antes);

      const hist = await q<{ pedido_id: string; plano_anterior_id: string; plano_id: string; ciclo_anterior: string; ciclo: string; modulos_ligados: string[] }>(
        'select pedido_id, plano_anterior_id, plano_id, ciclo_anterior, ciclo, modulos_ligados from plataforma.assinatura_historico where tenant_id = $1 order by created_at, pedido_id',
        [A],
      );
      expect(hist.filter((h) => h.pedido_id !== ASSINATURAS_FIXTURE.A.historico.pedido_id)).toEqual([
        { pedido_id: pedido1, plano_anterior_id: PLANOS_FIXTURE.pme.id, plano_id: livre.id, ciclo_anterior: 'mensal', ciclo: 'anual', modulos_ligados: ['gestor', 'integracao'] },
        { pedido_id: pedido2, plano_anterior_id: livre.id, plano_id: livre.id, ciclo_anterior: 'anual', ciclo: 'mensal', modulos_ligados: [] },
      ]);
      const aud = await q<{ detalhes: Record<string, unknown> }>(
        "select detalhes from plataforma.auditoria_plataforma where acao = 'sa.assinatura.trocar' and sessao_id = $1 order by created_at, id",
        [sid],
      );
      expect(aud.map((x) => x.detalhes.resultado).sort()).toEqual(['existente', 'existente', 'trocada', 'trocada']);
      expect(aud.find((x) => x.detalhes.resultado === 'trocada' && x.detalhes.ciclo === 'anual')!.detalhes).toEqual({
        plano: livre.codigo, plano_anterior: PLANOS_FIXTURE.pme.codigo, ciclo: 'anual', resultado: 'trocada', modulos_ligados: ['gestor', 'integracao'], origem: 'banco',
      });
      // a ficha mostra o plano novo
      expect(FichaCrua.parse(await ficha(sid, A))).toMatchObject({ plano: { codigo: livre.codigo }, ciclo: 'mensal', adicionais: [] });
    });
  });

  it('sa_trocar_plano: uso igual ao contratado cabe; o reenvio do pedido recusado troca (não fica existente); o mesmo pedido_id em outra empresa é outro pedido', async () => {
    await emTransacao(admin, null, async () => {
      const sid = await sessaoSuperAdmin();
      const n = (await linhasDaTrava(A)).find((l) => l.item === 'vendedor')!.em_uso;
      expect(n).toBeGreaterThanOrEqual(2);
      await planoDeTeste('teste_justo_84', { vendedor: n });
      await planoDeTeste('teste_curto_84', { vendedor: n - 1 });
      await planoDeTeste('teste_livre_b_84');
      const justo = await planoDoCatalogo(sid, 'teste_justo_84');
      const curto = await planoDoCatalogo(sid, 'teste_curto_84');
      const livre = await planoDoCatalogo(sid, 'teste_livre_b_84');
      const pedido = '00830000-0000-4000-8000-0000000000c1';
      const entrada = (p: Plano) => ({ plano: p.codigo, ciclo: 'mensal', adicionais: [], pedido_id: pedido, modulos: modulosDaAssinatura(p, []) });
      const assinatura = (tenant: string) =>
        q('select plano_id, ciclo, adicionais, updated_at from plataforma.assinatura where tenant_id = $1 and deleted_at is null', [tenant]);
      const doPedido = async (tenant: string) =>
        (await q<{ plano_id: string }>('select plano_id from plataforma.assinatura_historico where tenant_id = $1 and pedido_id = $2', [tenant, pedido])).map((h) => h.plano_id);

      // 3. recusa abaixo do uso (n - 1 < n): nada gravado; o reenvio do mesmo pedido_id não fica "travado" como existente
      const antesA = await assinatura(A);
      expect(await falha(trocar(sid, A, entrada(curto)))).toEqual({ code: '22023', hint: 'PLANO_ABAIXO_DO_USO' });
      expect(await doPedido(A)).toEqual([]);
      expect(await assinatura(A)).toEqual(antesA);
      // 1. no limite exato (n em uso, n contratadas) a troca é aceita, com o mesmo pedido_id da recusa
      // modulos_ligados depende do que a fixture já liga em A (ex.: gestor e integracao); aqui só importa que a troca passa
      expect(await trocar(sid, A, entrada(justo))).toEqual({ resultado: 'trocada', modulos_ligados: expect.any(Array) });
      expect(await doPedido(A)).toEqual([justo.id]);
      expect((await linhasDaTrava(A)).find((l) => l.item === 'vendedor')).toMatchObject({ contratadas: n, em_uso: n });
      // agora sim o pedido existe: repetir não muda nada
      const depoisA = await assinatura(A);
      expect(await trocar(sid, A, entrada(justo))).toEqual({ resultado: 'existente', modulos_ligados: [] });
      expect(await assinatura(A)).toEqual(depoisA);

      // 2. pedido_id é chave por empresa (PUT /empresas/:tenant_id/assinatura): o mesmo uuid em B é outro pedido, troca B e não toca A
      expect(await doPedido(B)).toEqual([]);
      expect(await trocar(sid, B, entrada(livre))).toEqual({ resultado: 'trocada', modulos_ligados: expect.any(Array) });
      expect(await doPedido(B)).toEqual([livre.id]);
      expect((await assinatura(B))[0]).toMatchObject({ plano_id: livre.id, ciclo: 'mensal', adicionais: [] });
      expect(await assinatura(A)).toEqual(depoisA);
      expect(await doPedido(A)).toEqual([justo.id]);
      // e cada empresa vê só o próprio pedido (RLS)
      expect((await como<{ plano_id: string }>('macuxi_app', 'select plano_id from plataforma.assinatura_historico where pedido_id = $1', [pedido], A)).rows).toEqual([{ plano_id: justo.id }]);
      expect((await como<{ plano_id: string }>('macuxi_app', 'select plano_id from plataforma.assinatura_historico where pedido_id = $1', [pedido], B)).rows).toEqual([{ plano_id: livre.id }]);
      // o reenvio em B também é existente
      expect(await trocar(sid, B, entrada(livre))).toEqual({ resultado: 'existente', modulos_ligados: [] });
    });
  });

  it('sa_trocar_plano: abaixo do uso = 22023 PLANO_ABAIXO_DO_USO e nada muda; hints do 422; entrada fora do contrato 22023; 42501, 28000 e P0002', async () => {
    await emTransacao(admin, null, async () => {
      const sid = await sessaoSuperAdmin();
      await planoDeTeste('teste_zero_84', { vendedor: 0 });
      const zero = await planoDoCatalogo(sid, 'teste_zero_84');
      const pme = await planoDoCatalogo(sid, PLANOS_FIXTURE.pme.codigo);
      const entrada = (p: Plano, extra: Record<string, unknown> = {}) => ({
        plano: p.codigo, ciclo: 'mensal', adicionais: [], pedido_id: '00830000-0000-4000-8000-0000000000b1', modulos: modulosDaAssinatura(p, []), ...extra,
      });
      const antes = await q('select plano_id, ciclo, adicionais, updated_at from plataforma.assinatura where tenant_id = $1', [A]);
      const historico = async () => (await q<{ n: number }>('select count(*)::int as n from plataforma.assinatura_historico where tenant_id = $1', [A]))[0]!.n;
      const n0 = await historico();

      // RN-PLA-05: A tem vendedores ativos; o plano com 0 vendedores fica abaixo do uso
      expect(await falha(trocar(sid, A, entrada(zero)))).toEqual({ code: '22023', hint: 'PLANO_ABAIXO_DO_USO' });
      expect((await erroDe(trocar(sid, A, entrada(zero))))?.message).toMatch(/vendedor: \d+ em uso, 0 contratadas/);
      expect(await falha(trocar(sid, A, entrada(pme, { plano: 'nao_existe' })))).toEqual({ code: '22023', hint: 'PLANO_DESCONHECIDO' });
      expect(await falha(trocar(sid, A, entrada(pme, { plano: PLANOS_FIXTURE.antigo.codigo })))).toEqual({ code: '22023', hint: 'PLANO_INATIVO' });
      expect(await falha(trocar(sid, A, entrada(pme, { adicionais: [{ adicional: 'treinamento', quantidade: 1 }], modulos: modulosDaAssinatura(pme, [{ adicional: 'treinamento', quantidade: 1 }]) })))).toEqual({
        code: '22023', hint: 'ADICIONAL_FORA_DO_PLANO',
      });
      expect(await falha(trocar(sid, A, entrada(pme, { modulos: ['core', 'catalogo', 'vendedor', 'gestor'] })))).toEqual({ code: '22023', hint: 'MODULOS_FORA_DO_PLANO' });
      for (const [caso, e] of [
        ['chave a mais', { ...entrada(pme), valor: 1 }],
        ['sem modulos', { ...entrada(pme), modulos: undefined }],
        ['módulo desconhecido', entrada(pme, { modulos: [...modulosDaAssinatura(pme, []), 'teste'] })],
        ['módulo repetido', entrada(pme, { modulos: [...modulosDaAssinatura(pme, []), 'core'] })],
        ['ciclo', entrada(pme, { ciclo: 'semanal' })],
        ['pedido_id', entrada(pme, { pedido_id: 'x' })],
        ['quantidade 0', entrada(pme, { adicionais: [{ adicional: 'promotor', quantidade: 0 }] })],
        ['adicional repetido', entrada(pme, { adicionais: [{ adicional: 'promotor', quantidade: 1 }, { adicional: 'promotor', quantidade: 2 }] })],
        ['entrada não objeto', [1]],
      ] as const) {
        expect(await falha(trocar(sid, A, e)), caso).toEqual({ code: '22023', hint: null });
      }
      expect(await q('select plano_id, ciclo, adicionais, updated_at from plataforma.assinatura where tenant_id = $1', [A])).toEqual(antes);
      expect(await historico()).toBe(n0);

      const cli = await abrir({ tipo: 'admin_cliente', empresas: [{ tenant_id: A, usuario_id: ADMIN_A }] });
      expect((await erroDe(trocar(cli, A, entrada(pme))))?.code).toBe('42501');
      expect((await erroDe(trocar(null, A, entrada(pme))))?.code).toBe('28000');
      for (const papel of ['macuxi_app', 'macuxi_worker']) {
        expect((await erroDe(como(papel, 'select plataforma.sa_trocar_plano(null, null, null)')))?.code, papel).toBe('42501');
      }
      const semPlano = await novoTenant('t0084-troca');
      expect((await erroDe(trocar(sid, semPlano, entrada(pme))))?.code).toBe('P0002');
      expect((await erroDe(trocar(sid, '00830000-ffff-4000-8000-000000000000', entrada(pme))))?.code).toBe('P0002');
    });
  });
});

describe.skipIf(semBanco())('0084 corrida e up/down (banco efêmero, COMMIT de verdade)', () => {
  let b: BancoDeTeste;
  beforeAll(async () => {
    b = await criarBancoDeTeste();
  });
  afterAll(async () => {
    await b?.apagar();
  });
  const LIGHT = PLANOS_DE_VENDA[0]!;

  it('corrida da última vaga: o 2º cadastro espera a trava do 1º e já conta o vendedor dele (LICENCAS_ESGOTADAS)', async () => {
    const T = await comAdmin(b.nome, async (c) => {
      const t = (await c.query<{ id: string }>("insert into plataforma.tenant (codigo, nome) values ('t0084-corrida', 'Empresa da corrida') returning id")).rows[0]!.id;
      await c.query('insert into plataforma.assinatura (tenant_id, plano_id, pedido_id, paga) values ($1, $2, gen_random_uuid(), true)', [t, LIGHT.id]);
      for (let i = 1; i < LIGHT.licencas.vendedor!; i += 1) {
        await c.query("insert into core.usuario (tenant_id, nome, email, perfil) values ($1, $2, $3, 'vendedor')", [t, `Vendedor ${i}`, `v${i}@t0084.exemplo`]);
      }
      return t;
    });
    const vendedor = (linhas: UsoDeLicenca[]) => linhas.find((l) => l.item === 'vendedor')!;
    const situacao = (linhas: (UsoDeLicenca & { teste_ate: string | null; paga: boolean })[]) => ({ ...usoPorItem(linhas), testeAte: linhas[0]!.teste_ate, paga: linhas[0]!.paga });
    const c1 = new pg.Client({ connectionString: b.urlApp });
    const c2 = new pg.Client({ connectionString: b.urlApp });
    await c1.connect();
    await c2.connect();
    try {
      for (const c of [c1, c2]) {
        await c.query('begin');
        await c.query("select set_config('app.tenant_id', $1, true)", [T]);
      }
      const s1 = (await c1.query('select * from plataforma.licencas_do_tenant()')).rows;
      expect(vendedor(s1)).toMatchObject({ contratadas: 10, em_uso: 9 });
      expect(conferirNovoUsuario(situacao(s1), { bases: ['vendedor'], modulos: [] }, '2026-11-15')).toEqual({ pode: true });

      const pid2 = (await c2.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0]!.pid;
      const p2 = c2.query('select * from plataforma.licencas_do_tenant()');
      // o 2º fica parado na trava da assinatura enquanto o 1º não grava
      let parado = false;
      for (let i = 0; i < 100 && !parado; i += 1) {
        parado = (await comAdmin(b.nome, (c) => c.query('select 1 from pg_locks where pid = $1 and not granted', [pid2]))).rowCount! > 0;
        if (!parado) await new Promise((r) => setTimeout(r, 50));
      }
      expect(parado).toBe(true);
      await c1.query("insert into core.usuario (tenant_id, nome, email, perfil) values ($1, 'Vendedor 10', 'v10@t0084.exemplo', 'vendedor')", [T]);
      await c1.query('commit');

      const s2 = (await p2).rows;
      expect(vendedor(s2)).toMatchObject({ contratadas: 10, em_uso: 10 });
      expect(conferirNovoUsuario(situacao(s2), { bases: ['vendedor'], modulos: [] }, '2026-11-15')).toMatchObject({ pode: false, codigo: 'LICENCAS_ESGOTADAS', item: 'vendedor' });
      await c2.query('rollback');
    } finally {
      await c1.end();
      await c2.end();
    }
  });

  it('up/down: só acrescenta (tabela, 9 funções, 2 gatilhos, 4 políticas, o único (tenant_id, id) da assinatura e os 4 planos); o down volta exatamente', async () => {
    const outro = await criarBancoDeTeste({ migrar: false });
    try {
      await comAdmin(outro.nome, async (c) => {
        const anterior = migracoes[migracoes.indexOf(m81) - 1]!.versao;
        const privilegios = async () =>
          (await c.query(
            `select has_table_privilege('macuxi_app', 'plataforma.plano', 'select') as plano_app,
                    has_column_privilege('macuxi_app', 'plataforma.assinatura', 'updated_at', 'update') as trava_app,
                    (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'plataforma' and p.proname like 'sa\\_%' and has_function_privilege('macuxi_portal', p.oid, 'execute')) as sa_portal,
                    (select count(*)::int from plataforma.plano) as planos`,
          )).rows[0];
        await migrarUp(c, { ate: anterior });
        const catalogo = await retratoDoCatalogo(c);
        const antes = await privilegios();
        expect((await migrarUp(c, { ate: m81.versao })).aplicadas).toEqual([`${m81.versao}_${m81.nome}`]);
        const depois = await retratoDoCatalogo(c);
        expect(catalogo.filter((l) => !depois.includes(l))).toEqual([]);
        const novos = depois.filter((l) => !catalogo.includes(l));
        expect(novos.filter((l) => l.startsWith('fn ')).sort()).toEqual([
          'fn plataforma.assinatura_so_trava()',
          'fn plataforma.contratadas_do_plano(p_plano plataforma.plano, p_adicionais jsonb)',
          'fn plataforma.licencas_do_tenant()',
          'fn plataforma.licencas_em_uso(p_tenant uuid)',
          'fn plataforma.plano_json(p plataforma.plano)',
          'fn plataforma.sa_assinatura_da_empresa(p_sid uuid, p_tenant uuid)',
          'fn plataforma.sa_listar_planos(p_sid uuid)',
          'fn plataforma.sa_trocar_plano(p_sid uuid, p_tenant uuid, p jsonb)',
          'fn plataforma.situacao_das_licencas(p_plano plataforma.plano, p_adicionais jsonb, p_tenant uuid)',
        ]);
        expect(novos.filter((l) => l.startsWith('rel ')).sort()).toEqual([
          'rel plataforma.assinatura_historico r rls=true force=true',
          'rel plataforma.assinatura_historico_assinatura_ix i rls=false force=false',
          'rel plataforma.assinatura_historico_pedido_uk i rls=false force=false',
          'rel plataforma.assinatura_historico_pkey i rls=false force=false',
          'rel plataforma.assinatura_tenant_id_uk i rls=false force=false',
        ]);
        expect(novos.filter((l) => l.startsWith('trg ')).sort()).toEqual([
          'trg plataforma.assinatura.assinatura_so_trava',
          'trg plataforma.assinatura_historico.assinatura_historico_updated_at',
        ]);
        expect(novos.filter((l) => l.startsWith('pol ')).map((l) => l.split(' ')[1]).sort()).toEqual([
          'plataforma.assinatura_historico.isolamento_tenant',
          'plataforma.assinatura_historico.leitura',
          'plataforma.assinatura_historico.manutencao',
          'plataforma.plano.isolamento_tenant',
        ]);
        expect(await privilegios()).toEqual({ plano_app: true, trava_app: true, sa_portal: antes!.sa_portal + 3, planos: antes!.planos + 4 });

        expect((await migrarDown(c, { passos: 1 })).aplicadas).toEqual([`${m81.versao}_${m81.nome}`]);
        expect(await retratoDoCatalogo(c)).toEqual(catalogo);
        expect(await privilegios()).toEqual(antes);
        await migrarUp(c, { ate: m81.versao });
        expect(await retratoDoCatalogo(c)).toEqual(depois);
      });
    } finally {
      await outro.apagar();
    }
  });
});
