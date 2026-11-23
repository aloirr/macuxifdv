/**
 * "Zerar dados" da empresa × Postgres real (ADR 0068; desenho docs/desenho/empresa-zerar.md §3 e §5; RN-PLA-12; migração 0100), de
 * ponta a ponta: rotas do portal (`macuxi_portal`, sa_*) → worker (`macuxi_worker`: pegar_zerar, executar_zerar, fechar_zerar) →
 * concluído. Confere: só o super-admin; prévia sem mudar nada e igual ao executado; pedido idempotente pelo id e um em andamento
 * por empresa; recusa na conferência do worker (lote do Hub em processamento) fecha `falhou` com o código e nada muda; ficam
 * administradores, credenciais, conectores, plano e licenças; saem os cadastros do ERP e os outros usuários; cópia no lote;
 * auditoria `tenant.zerar_pedido`, `tenant.zerar_falhou` e `tenant.zerado` (detalhes = payload de plataforma.tenant.zerado@1).
 * A regra do que sai (`plataforma.limpar_cadastros`) é testada no `db/testes/empresa-zerar.db.test.ts` (banco-dados). Cada
 * execução cria a própria empresa e a apaga no fim (excluir_tenant). Pula sem Postgres; com MACUXI_PG_EXIGIR=1 falha.
 */
import { randomUUID } from 'node:crypto';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import {
  CODIGOS_ZERAR_EMPRESA,
  EVENTO_TENANT_ZERADO,
  mensagemDoZerar,
  PreviaZerarEmpresaSchema,
  ZerarEmpresaSchema,
  type AcessoPortalAutenticado,
} from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { criarBancoApp, criarBancoPortal } from '../src/banco';
import { criarWorkerZerar } from '../src/empresa-zerar-worker';

const HASH = '$argon2id$v=19$m=1,t=1,p=1$b3V0cm8$b3V0cm9oYXNo';
const { SENHA } = vi.hoisted(() => ({ SENHA: 'Senha#Certa2026' }));
vi.mock('@macuxi/db', async (original) => ({
  ...(await original<typeof import('@macuxi/db')>()),
  verificarSenha: (senha: string, phc: string) => senha === SENHA && phc === '$argon2id$v=19$m=1,t=1,p=1$b3V0cm8$b3V0cm9oYXNo',
}));
const Z = CODIGOS_ZERAR_EMPRESA;

describe.skipIf(semBanco() || !banco().urlWorker || !banco().urlPortal)('API × Postgres: Zerar dados da empresa (portal + worker; ADR 0068, RN-PLA-12)', () => {
  let app: pg.Pool;
  let admin: pg.Pool;
  let portal: pg.Pool;
  let worker: pg.Pool;
  const codigo = `zerar-${randomUUID().slice(0, 8)}`;
  let tenant = '';
  let quem: AcessoPortalAutenticado;
  let cli: AcessoPortalAutenticado;
  const ids = { admin: '', vendedor: '', filial: '', cliente: '', produto: '', conector: '', credencial: '', lote: '' };

  beforeAll(async () => {
    vi.stubEnv('MACUXI_JWT_SEGREDO_PLATAFORMA', 's'.repeat(40));
    app = new pg.Pool({ connectionString: banco().urlApp, max: 2 });
    admin = new pg.Pool({ connectionString: banco().urlAdmin, max: 1 });
    portal = new pg.Pool({ connectionString: banco().urlPortal!, max: 2 });
    worker = new pg.Pool({ connectionString: banco().urlWorker!, max: 1 });
    const um = async (sql: string, args: unknown[]) => (await admin.query<{ id: string }>(sql, args)).rows[0]!.id;
    tenant = await um('insert into plataforma.tenant (codigo, nome) values ($1, $2) returning id', [codigo, 'Empresa do zerar']);
    // a filial padrão nasce com a empresa; o ERP a adotou (external_id)
    ids.filial = await um("update core.filial set external_id = 'ERP-F1' where tenant_id = $1 and padrao and deleted_at is null returning id", [tenant]);
    ids.admin = await um("insert into core.usuario (tenant_id, nome, email, perfil) values ($1, 'Admin', $2, 'admin') returning id", [tenant, `admin.${codigo}@cliente.exemplo`]);
    ids.vendedor = await um(
      "insert into core.usuario (tenant_id, nome, email, perfil, external_id) values ($1, 'Vendedor', $2, 'vendedor', 'ERP-V1') returning id",
      [tenant, `vend.${codigo}@cliente.exemplo`],
    );
    ids.cliente = await um("insert into core.cliente (tenant_id, filial_id, razao_social, external_id) values ($1, $2, 'Cliente ERP', 'ERP-C1') returning id", [tenant, ids.filial]);
    ids.produto = await um("insert into core.produto (tenant_id, sku, nome, external_id) values ($1, 'SKU-1', 'Produto ERP', 'ERP-P1') returning id", [tenant]);
    ids.conector = await um("insert into integracao.conector (tenant_id, identificador, nome) values ($1, 'macuxierp', 'ERP') returning id", [tenant]);
    ids.credencial = await um("insert into integracao.credencial (tenant_id, conector_id, prefixo, hash_chave) values ($1, $2, 'zrr1', $3) returning id", [
      tenant,
      ids.conector,
      'a'.repeat(64),
    ]);
    const sa = (
      await admin.query<{ r: { super_admin_id: string } }>('select plataforma.criar_super_admin($1::jsonb) as r', [
        JSON.stringify({ acao: 'criar', email: `operador.${codigo}@macuxi.exemplo`, nome: 'Operador zerar', senha_hash: HASH }),
      ])
    ).rows[0]!.r;
    const abriu = await portal.query<{ sessao_id: string }>('select * from plataforma.sa_abrir_sessao_portal($1::jsonb)', [
      JSON.stringify({ tipo: 'super_admin', super_admin_id: sa.super_admin_id }),
    ]);
    quem = { tipo: 'super_admin', id: sa.super_admin_id, sessao_id: abriu.rows[0]!.sessao_id };
    cli = { tipo: 'admin_cliente', sessao_id: randomUUID(), empresa: { tenant_id: tenant, usuario_id: ids.admin } };
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    if (tenant) {
      await admin.query('delete from plataforma.limpeza_copia where empresa_id = $1', [tenant]);
      await admin.query('delete from plataforma.zerar_empresa where empresa_id = $1', [tenant]);
      await admin.query("update plataforma.tenant set status = 'encerrado' where id = $1", [tenant]);
      await admin.query('select * from plataforma.excluir_tenant($1, $2)', [tenant, codigo]);
    }
    await Promise.all([app?.end(), admin?.end(), portal?.end(), worker?.end()]);
  });

  const montarApi = () =>
    createApp({
      banco: criarBancoApp(app),
      bancoPortal: criarBancoPortal(portal),
      autenticarPortal: async (h) => (h['x-quem'] === 'sa' ? quem : h['x-quem'] === 'cli' ? cli : null),
      empresaAcoesPortal: true,
      planosPortal: true,
      relogio: () => new Date(),
    });
  const sa = { 'x-quem': 'sa' };
  const url = (resto: string) => `/v1/plataforma/empresas/${tenant}/${resto}`;
  /** Retrato do que FICA (sem updated_at): administrador, credencial, conector, plano e licenças. */
  const ficam = async () =>
    (
      await admin.query<{ r: string }>(
        `select md5(concat_ws('#',
           (select string_agg((to_jsonb(u) - 'updated_at')::text, '|' order by u.id) from core.usuario u where u.tenant_id = $1 and u.perfil = 'admin'),
           (select string_agg((to_jsonb(c) - 'updated_at')::text, '|' order by c.id) from integracao.credencial c where c.tenant_id = $1),
           (select string_agg((to_jsonb(c) - 'updated_at')::text, '|' order by c.id) from integracao.conector c where c.tenant_id = $1),
           (select string_agg((to_jsonb(a) - 'updated_at')::text, '|' order by a.id) from plataforma.assinatura a where a.tenant_id = $1),
           (select string_agg((to_jsonb(m) - 'updated_at')::text, '|' order by m.id) from plataforma.tenant_modulo m where m.tenant_id = $1))) as r`,
        [tenant],
      )
    ).rows[0]!.r;
  const vivos = async () =>
    (
      await admin.query<{ r: string }>(
        `select concat_ws('/',
           (select count(*) from core.usuario where tenant_id = $1 and deleted_at is null),
           (select count(*) from core.cliente where tenant_id = $1 and deleted_at is null),
           (select count(*) from core.produto where tenant_id = $1 and deleted_at is null),
           (select count(*) from core.filial where tenant_id = $1 and deleted_at is null and external_id is not null)) as r`,
        [tenant],
      )
    ).rows[0]!.r;
  const auditoria = async () =>
    (await admin.query<{ acao: string; detalhes: Record<string, unknown> }>(
      "select acao, detalhes from plataforma.auditoria_plataforma where tenant_alvo_id = $1 and acao like 'tenant.zera%' order by created_at, acao",
      [tenant],
    )).rows;

  it('pedir → worker → concluído: só super-admin, prévia = executado, recusa do worker sem mudar nada, ficam usuários/credenciais/plano, auditoria', async () => {
    const api = montarApi();
    try {
      // plano e licenças da empresa (ficam)
      const plano = await api.inject({ method: 'POST', url: url('assinatura'), headers: sa, payload: { plano: 'pme', ciclo: 'mensal', adicionais: [], pedido_id: randomUUID() } });
      expect(plano.statusCode, plano.body).toBe(201);

      // RN-PLA-12: só super-admin (o admin do cliente = 403, sem chamar o banco)
      for (const [method, rota] of [['GET', 'zerar/previa'], ['POST', 'zerar'], ['GET', 'zerar']] as const) {
        const r = await api.inject({ method, url: url(rota), headers: { 'x-quem': 'cli' }, ...(method === 'POST' ? { payload: { id: randomUUID(), codigo_confirmacao: codigo, senha: SENHA } } : {}) });
        expect([r.statusCode, r.json().codigo], rota).toEqual([403, 'PERFIL_SEM_ACESSO']);
      }
      const nenhum = await api.inject({ method: 'GET', url: url('zerar'), headers: sa });
      expect([nenhum.statusCode, nenhum.json().codigo]).toEqual([404, Z.zerarNaoEncontrado]);

      // prévia (por entidade e inteira): nada muda
      const fica0 = await ficam();
      const vivos0 = await vivos();
      expect(vivos0).toBe('2/1/1/1');
      const porCliente = await api.inject({ method: 'GET', url: url('zerar/previa?entidades=cliente'), headers: sa });
      expect(porCliente.statusCode, porCliente.body).toBe(200);
      const pc = PreviaZerarEmpresaSchema.parse(porCliente.json());
      expect(pc.entidades).toEqual(['cliente']);
      expect(pc.entidades_afetadas).toContain('cliente');
      expect(pc.tabelas).toContainEqual({ tabela: 'core.cliente', modo: 'soft', linhas: 1 });
      expect(pc.tabelas.some((t) => t.tabela === 'core.produto')).toBe(false);
      const inteira = await api.inject({ method: 'GET', url: url('zerar/previa'), headers: sa });
      expect(inteira.statusCode, inteira.body).toBe(200);
      const previa = PreviaZerarEmpresaSchema.parse(inteira.json());
      expect([previa.entidades, previa.bloqueio, previa.codigo]).toEqual([null, null, codigo]);
      expect(previa.entidades_afetadas).toEqual(['filial', 'vendedor', 'produto', 'cliente']);
      expect([await ficam(), await vivos()]).toEqual([fica0, vivos0]);
      expect((await admin.query('select 1 from plataforma.limpeza_copia where empresa_id = $1', [tenant])).rowCount).toBe(0);

      // recusa na conferência do worker: lote do Hub entra em processamento depois do pedido → falhou com o código, nada muda
      const id1 = randomUUID();
      const p1 = await api.inject({ method: 'POST', url: url('zerar'), headers: sa, payload: { id: id1, codigo_confirmacao: codigo.toUpperCase(), senha: SENHA, entidades: ['produto'] } });
      expect(p1.statusCode, p1.body).toBe(202);
      expect(ZerarEmpresaSchema.parse(p1.json())).toMatchObject({ id: id1, situacao: 'em_andamento', entidades: ['produto'] });
      ids.lote = (
        await admin.query<{ id: string }>(
          `insert into integracao.lote (tenant_id, conector_id, entidade, modo, versao_contrato, chave_idempotencia, hash_conteudo, recebidas, status)
           values ($1, $2, 'produto', 'delta', '1', $3, repeat('a', 64), 1, 'processando') returning id`,
          [tenant, ids.conector, `chave-${codigo}`],
        )
      ).rows[0]!.id;
      const w = criarWorkerZerar({ pool: worker });
      expect(await w.ciclo()).toBe('falhou');
      const lido1 = await api.inject({ method: 'GET', url: url('zerar'), headers: sa });
      expect(ZerarEmpresaSchema.parse(lido1.json())).toMatchObject({ id: id1, situacao: 'falhou', erro_codigo: Z.hubProcessando, entidades_afetadas: null });
      expect(mensagemDoZerar(Z.hubProcessando)).toBeTruthy();
      expect([await ficam(), await vivos()]).toEqual([fica0, vivos0]);
      // com o lote em processamento o pedido já é recusado (409 com a frase do SDK)
      const ocupado = await api.inject({ method: 'POST', url: url('zerar'), headers: sa, payload: { id: randomUUID(), codigo_confirmacao: codigo, senha: SENHA } });
      expect([ocupado.statusCode, ocupado.json().codigo, ocupado.json().mensagem]).toEqual([409, Z.hubProcessando, mensagemDoZerar(Z.hubProcessando)]);
      await admin.query("update integracao.lote set status = 'concluido_com_erros' where id = $1", [ids.lote]);

      // senha errada e código errado: nada é pedido
      const id2 = randomUUID();
      const senhaErrada = await api.inject({ method: 'POST', url: url('zerar'), headers: sa, payload: { id: id2, codigo_confirmacao: codigo, senha: 'errada' } });
      expect([senhaErrada.statusCode, senhaErrada.json().codigo]).toEqual([403, Z.reautenticacaoFalhou]);
      const codigoErrado = await api.inject({ method: 'POST', url: url('zerar'), headers: sa, payload: { id: id2, codigo_confirmacao: 'outra', senha: SENHA } });
      expect([codigoErrado.statusCode, codigoErrado.json().codigo]).toEqual([422, Z.codigoNaoConfere]);

      // a empresa inteira: idempotente pelo id; outro pedido com este em andamento = 409
      const p2 = await api.inject({ method: 'POST', url: url('zerar'), headers: sa, payload: { id: id2, codigo_confirmacao: codigo, senha: SENHA } });
      expect(p2.statusCode, p2.body).toBe(202);
      const pedido = ZerarEmpresaSchema.parse(p2.json());
      expect(pedido).toMatchObject({ id: id2, tenant_id: tenant, situacao: 'em_andamento', entidades: null, entidades_afetadas: null });
      const deNovo = await api.inject({ method: 'POST', url: url('zerar'), headers: sa, payload: { id: id2, codigo_confirmacao: codigo, senha: SENHA } });
      expect([deNovo.statusCode, deNovo.json()]).toEqual([202, p2.json()]);
      const outro = await api.inject({ method: 'POST', url: url('zerar'), headers: sa, payload: { id: randomUUID(), codigo_confirmacao: codigo, senha: SENHA } });
      expect([outro.statusCode, outro.json().codigo]).toEqual([409, Z.zerarEmAndamento]);

      expect(await w.ciclo()).toBe('concluido');
      expect(await w.ciclo()).toBeNull();
      const lido2 = await api.inject({ method: 'GET', url: url('zerar'), headers: sa });
      const z = ZerarEmpresaSchema.parse(lido2.json());
      expect(z).toMatchObject({ id: id2, situacao: 'concluido', erro_codigo: null, lote: pedido.lote });
      expect(z.linhas_apagadas).toBe(previa.total_linhas + 1); // + o lote do Hub que entrou depois da prévia
      expect(z.entidades_afetadas).toEqual(['filial', 'vendedor', 'produto', 'cliente']);
      expect(z.contagem).toContainEqual({ tabela: 'integracao.lote', modo: 'fisico', linhas: 1 });

      // ficam: administrador, credencial, conector, plano e licenças; saem: vendedor, cliente, produto; a filial perde o external_id
      expect(await ficam()).toBe(fica0);
      expect(await vivos()).toBe('1/0/0/0');
      const sv = (await admin.query<{ v: number }>('select sessao_versao as v from core.usuario where id = $1', [ids.vendedor])).rows[0]!.v;
      expect(sv).toBeGreaterThan(0);
      const copia = (await admin.query<{ n: string }>('select count(*) as n from plataforma.limpeza_copia where empresa_id = $1 and lote = $2', [tenant, pedido.lote])).rows[0]!.n;
      expect(Number(copia)).toBeGreaterThan(0);

      // auditoria: pedido, falha, pedido, zerado (payload de plataforma.tenant.zerado@1)
      const aud = await auditoria();
      expect(aud.map((a) => a.acao).sort()).toEqual(['tenant.zerado', 'tenant.zerar_falhou', 'tenant.zerar_pedido', 'tenant.zerar_pedido']);
      expect(aud.find((a) => a.acao === 'tenant.zerar_falhou')?.detalhes).toMatchObject({ zerar_id: id1, erro_codigo: Z.hubProcessando });
      const zerado = EVENTO_TENANT_ZERADO.schema.parse(aud.find((a) => a.acao === 'tenant.zerado')?.detalhes);
      expect(zerado).toMatchObject({ tenant_id: tenant, codigo, zerar_id: id2, lote: pedido.lote, entidades: null, linhas_apagadas: z.linhas_apagadas });
      expect(JSON.stringify(aud)).not.toContain(SENHA);
    } finally {
      await api.close();
    }
  });
});
