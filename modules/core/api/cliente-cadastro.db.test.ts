/**
 * RF-CORE-10 × Postgres real (fixture dois-tenants, papel macuxi_app, RLS; colunas das migrações 0095, 0097 e 0098): pré-cadastro
 * (obrigatórios da lista única, evento, tentativa), revisão do recusado no mesmo cliente, substituição pelo id novo do APK v1.0.28,
 * 23505 em corrida, receptor do push, parâmetro unificado e consulta do Hub (RN-CORE-16, RN-CORE-78, RN-CORE-79, RN-INT-22; ADR 0069).
 * Cada caso roda numa transação desfeita no fim (as corridas usam duas conexões e apagam o que gravaram). Pula sem Postgres.
 */
import { definirTenant } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EVENTO_CLIENTE_ATUALIZADO, EVENTO_CLIENTE_PRE_CADASTRADO, EVENTO_CLIENTE_PRE_CADASTRO_REVISADO, MENSAGENS_ERRO_PRE_CADASTRO, type ClientesPreCadastroSemErpSaida } from '../contracts';
import { A, B, emTransacao, ENDERECO_COMPLETO, recusar, type Ambiente } from './apoio-teste-pre-cadastro';
import { consultaClientesPreCadastroSemErp, rotasDeClienteCadastro } from './cliente-cadastro';
import { rotasDeParametrosCamposObrigatorios } from './parametros-campos-obrigatorios';
import { hashPreCadastro, receberPreCadastros } from './pre-cadastro-receber';

const ID1 = '5a000000-0000-4000-8000-000000000001';
const ID2 = '5a000000-0000-4000-8000-000000000002';
const ID3 = '5a000000-0000-4000-8000-000000000003';
const ID4 = '5a000000-0000-4000-8000-000000000004';
// documento próprio por id (o CPF/CNPJ é único por tenant)
const DOCS: Record<string, string> = { [ID1]: '11222333000181', [ID2]: '11444777000161', [ID3]: '12345678909', [ID4]: '11222333000181' };
const VENDEDOR = { id: A.usuarios.vendedor1, perfil: 'vendedor' } as const;
const ADMIN = { id: A.usuarios.admin, perfil: 'admin' } as const;

const pre = (id: string, extra: Record<string, unknown> = {}) => ({ id, origem: 'campo', razao_social: 'Mercado Novo', documento: DOCS[id] ?? '11222333000181', ...ENDERECO_COMPLETO, ...extra });
const post = (t: Ambiente, u: { id: string; perfil: 'vendedor' | 'admin' | 'analista' }, corpo: Record<string, unknown>, tenant?: string) =>
  t.rota(rotasDeClienteCadastro, 'POST', 'clientes/pre-cadastro', { ...u, tenant }, { corpo });
const param = (t: Ambiente, metodo: 'GET' | 'PUT', corpo?: unknown) => t.rota(rotasDeParametrosCamposObrigatorios, metodo, 'parametros/campos-obrigatorios', ADMIN, { corpo });
const tentativas = (t: Ambiente, id: string) =>
  t.q<{ revisao: number; hash: string | null; origem: string; resultado: string; campos_alterados: string[]; cliente_id_original: string | null; corrigido_por: string | null; corrigido_por_perfil: string | null }>(
    'select revisao, hash, origem, resultado, campos_alterados, cliente_id_original, corrigido_por, corrigido_por_perfil from core.cliente_pre_cadastro_tentativa where cliente_id = $1 order by revisao',
    [id],
  );
/** RN-CORE-39: sem filial no pedido o banco grava a padrão; o hash é o dos dados gravados. */
const comFilial = async (t: Ambiente, id: string, dados: Record<string, unknown>) => ({ ...dados, filial_id: (await t.q<{ filial_id: string }>('select filial_id from core.cliente where id = $1', [id]))[0]!.filial_id });
const eventos = (t: Ambiente, nome: string) => t.publicar.mock.calls.filter((c) => (c[0] as { nome: string }).nome === nome);

describe.skipIf(semBanco())('Core × Postgres: cliente novo para o ERP (RN-CORE-78, RN-INT-22, ADR 0069)', () => {
  let pool: pg.Pool;
  let admin: pg.Pool;
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
    admin = new pg.Pool({ connectionString: banco().urlAdmin, max: 2 });
  });
  afterAll(async () => {
    await pool?.end();
    await admin?.end();
  });

  it('RN-CORE-78: o pré-cadastro entra pendente na revisão 1, grava a tentativa, é idempotente pelo id e o vendedor recebe o cliente na carteira', async () => {
    await emTransacao(pool, async (t) => {
      const r1 = await post(t, VENDEDOR, pre(ID1, { documento: '11.222.333/0001-81' }));
      expect(r1).toEqual({ id: ID1, status_cadastro: 'pendente', revisao: 1, ja_existia: false });
      const r2 = await post(t, VENDEDOR, pre(ID1, { razao_social: 'Outro nome' }));
      expect(r2).toEqual({ id: ID1, status_cadastro: 'pendente', revisao: 1, ja_existia: true });
      const [l] = await t.q('select razao_social, origem_cadastro, status_cadastro, revisao_cadastro, documento from core.cliente where id = $1', [ID1]);
      expect(l).toEqual({ razao_social: 'Mercado Novo', origem_cadastro: 'campo', status_cadastro: 'pendente', revisao_cadastro: 1, documento: '11222333000181' });
      expect(await t.q('select 1 from core.carteira where cliente_id = $1 and usuario_id = $2', [ID1, A.usuarios.vendedor1])).toHaveLength(1);
      const [tt] = await tentativas(t, ID1);
      expect(tt).toEqual({ revisao: 1, hash: hashPreCadastro(await comFilial(t, ID1, pre(ID1))), origem: 'campo', resultado: 'aguardando', campos_alterados: [], cliente_id_original: null, corrigido_por: A.usuarios.vendedor1, corrigido_por_perfil: 'vendedor' });
      expect(tt!.hash).toMatch(/^[0-9a-f]{64}$/);
      await expect(post(t, ADMIN, pre(ID2, { documento: '11222333000181' }))).rejects.toMatchObject({ status: 409, codigo: 'DOCUMENTO_JA_CADASTRADO', message: MENSAGENS_ERRO_PRE_CADASTRO.DOCUMENTO_JA_CADASTRADO });
    });
  });

  it('RN-CORE-78: o pré-cadastro publica core.cliente.pre_cadastrado@1 uma vez só; a auditoria leva a revisão e nunca o hash', async () => {
    await emTransacao(pool, async (t) => {
      await post(t, ADMIN, pre(ID1, { origem: 'bko' }));
      expect(t.publicar).toHaveBeenCalledTimes(1);
      expect(t.publicar).toHaveBeenCalledWith(EVENTO_CLIENTE_PRE_CADASTRADO, expect.objectContaining({ cliente_id: ID1, recebido_em: expect.any(String) }), ID1);
      await post(t, ADMIN, pre(ID1, { origem: 'bko' }));
      expect(t.publicar).toHaveBeenCalledTimes(1);
      const aud = await t.q<{ depois: unknown }>("select depois from plataforma.auditoria where acao = 'cliente.pre_cadastrar' and entidade_id = $1", [ID1]);
      expect(aud[0]?.depois).toEqual({ origem: 'bko', status_cadastro: 'pendente', revisao: 1 });
      expect(JSON.stringify(aud)).not.toContain(hashPreCadastro(await comFilial(t, ID1, pre(ID1))));
    });
  });

  it('RN-CORE-79: a API revalida pela lista única; faltando, 422 CAMPOS_OBRIGATORIOS com os textos do contrato e só as chaves', async () => {
    await emTransacao(pool, async (t) => {
      // sem linha = padrão da RN-CORE-16 (endereço e IE para CNPJ)
      const e = await post(t, ADMIN, pre(ID1, { logradouro: null, cep: null, inscricao_estadual: null })).catch((x: unknown) => x);
      expect(e).toMatchObject({ status: 422, codigo: 'CAMPOS_OBRIGATORIOS', message: 'Preencha a inscrição estadual. Preencha o endereço.' });
      expect((e as { detalhes: { campos: string[] } }).detalhes.campos.sort()).toEqual(['cep', 'inscricao_estadual', 'logradouro']);
      expect(JSON.stringify((e as { detalhes: unknown }).detalhes)).not.toContain('Mercado Novo');
      // CPF não exige IE; o telefone marcado na lista única passa a ser exigido; formato inválido também recusa
      await param(t, 'PUT', { obrigatorios: ['telefone'] });
      await expect(post(t, ADMIN, pre(ID3, { inscricao_estadual: null }))).rejects.toMatchObject({ codigo: 'CAMPOS_OBRIGATORIOS', message: 'Preencha o telefone.' });
      await expect(post(t, ADMIN, pre(ID3, { telefone: '123' }))).rejects.toMatchObject({ codigo: 'CAMPOS_OBRIGATORIOS', message: 'Telefone inválido.' });
      expect(t.publicar).not.toHaveBeenCalled();
      expect(await t.q('select 1 from core.cliente where id = any($1::uuid[])', [[ID1, ID3]])).toHaveLength(0);
      expect(await post(t, ADMIN, pre(ID3, { inscricao_estadual: null, telefone: '92999990000', logradouro: null }))).toMatchObject({ status_cadastro: 'pendente', ja_existia: false });
    });
  });

  it('RN-CORE-16/79: o parâmetro único lê o padrão, grava com os fixos, escreve o espelho do APK v1.0.28 e só audita a mudança', async () => {
    await emTransacao(pool, async (t) => {
      expect(await param(t, 'GET')).toEqual({ obrigatorios: ['razao_social', 'documento', 'inscricao_estadual', 'logradouro', 'numero', 'bairro', 'cidade', 'uf', 'cep'] });
      expect(await param(t, 'PUT', { obrigatorios: ['email', 'telefone'] })).toEqual({ obrigatorios: ['razao_social', 'documento', 'telefone', 'email'] });
      await param(t, 'PUT', { obrigatorios: ['telefone', 'email', 'documento'] });
      expect(await param(t, 'GET')).toEqual({ obrigatorios: ['razao_social', 'documento', 'telefone', 'email'] });
      const linhas = await t.q<{ chave: string; valor: unknown }>("select chave, valor from plataforma.parametro where modulo = 'core' and chave in ('cliente.campos_obrigatorios', 'cliente.pre_cadastro.obrigatorios') and deleted_at is null order by chave");
      expect(linhas).toEqual([
        { chave: 'cliente.campos_obrigatorios', valor: ['razao_social', 'documento', 'telefone', 'email'] },
        { chave: 'cliente.pre_cadastro.obrigatorios', valor: ['telefone', 'email'] },
      ]);
      expect(await t.q("select 1 from plataforma.auditoria where acao = 'parametro.campos_obrigatorios_editar'")).toHaveLength(1);
      await param(t, 'PUT', { obrigatorios: ['cep'] });
      expect((await t.q<{ valor: unknown }>("select valor from plataforma.parametro where modulo = 'core' and chave = 'cliente.pre_cadastro.obrigatorios' and deleted_at is null"))[0]!.valor).toEqual(['endereco']);
    });
  });

  it('RN-CORE-78: o recusado é corrigido no mesmo id como revisão nova; a repetição é idempotente e os eventos saem uma vez', async () => {
    await emTransacao(pool, async (t) => {
      await post(t, VENDEDOR, pre(ID1));
      await recusar(t, ID1);
      t.publicar.mockClear();
      const corrigido = pre(ID1, { revisao_base: 1, inscricao_estadual: '041234567', razao_social: 'Mercado Novo Ltda' });
      expect(await post(t, VENDEDOR, corrigido)).toEqual({ id: ID1, status_cadastro: 'pendente', revisao: 2, ja_existia: false });
      const [l] = await t.q('select status_cadastro, motivo_recusa, erros_recusa, revisao_cadastro, inscricao_estadual from core.cliente where id = $1', [ID1]);
      expect(l).toEqual({ status_cadastro: 'pendente', motivo_recusa: null, erros_recusa: null, revisao_cadastro: 2, inscricao_estadual: '041234567' });
      const ts = await tentativas(t, ID1);
      expect(ts.map((x) => [x.revisao, x.resultado, x.campos_alterados])).toEqual([
        [1, 'recusado', []],
        [2, 'aguardando', ['inscricao_estadual', 'razao_social']],
      ]);
      expect(ts[1]!.hash).toBe(hashPreCadastro(await comFilial(t, ID1, corrigido)));
      expect(eventos(t, EVENTO_CLIENTE_PRE_CADASTRO_REVISADO.nome)).toHaveLength(1);
      expect(eventos(t, EVENTO_CLIENTE_PRE_CADASTRO_REVISADO.nome)[0]![1]).toMatchObject({ cliente_id: ID1, revisao: 2, origem: 'campo' });
      expect(eventos(t, EVENTO_CLIENTE_ATUALIZADO.nome)).toHaveLength(1);
      expect(eventos(t, EVENTO_CLIENTE_PRE_CADASTRADO.nome)).toHaveLength(0);
      // repetição: mesma revisão base e mesmo hash = ja_existia, sem nova revisão nem evento
      expect(await post(t, VENDEDOR, corrigido)).toEqual({ id: ID1, status_cadastro: 'pendente', revisao: 2, ja_existia: true });
      expect(t.publicar).toHaveBeenCalledTimes(2);
      // a mesma base com outros dados: outro corretor chegou antes
      await expect(post(t, ADMIN, pre(ID1, { revisao_base: 1, numero: '99' }))).rejects.toMatchObject({ status: 409, codigo: 'REVISAO_DESATUALIZADA', message: MENSAGENS_ERRO_PRE_CADASTRO.REVISAO_DESATUALIZADA });
      // revisão atual, mas pendente: não há o que corrigir
      await expect(post(t, ADMIN, pre(ID1, { revisao_base: 2, numero: '99' }))).rejects.toMatchObject({ status: 422, codigo: 'CADASTRO_NAO_RECUSADO' });
      // motivo e erros nunca na auditoria
      const aud = await t.q<{ acao: string; depois: unknown }>('select acao, depois from plataforma.auditoria where entidade_id = $1 order by created_at', [ID1]);
      expect(aud.find((a) => a.acao === 'cliente.pre_cadastro_corrigir')?.depois).toEqual({ revisao: 2, campos_alterados: ['inscricao_estadual', 'razao_social'], origem: 'campo' });
      expect(JSON.stringify(aud)).not.toMatch(/bloqueado|IE não confere/);
    });
  });

  it('RN-CORE-78: a correção com o CPF/CNPJ de outro cliente vivo dá 409 DOCUMENTO_JA_CADASTRADO e não grava', async () => {
    await emTransacao(pool, async (t) => {
      await post(t, ADMIN, pre(ID1));
      await post(t, ADMIN, pre(ID2));
      await recusar(t, ID2);
      await expect(post(t, ADMIN, pre(ID2, { revisao_base: 1, documento: DOCS[ID1] }))).rejects.toMatchObject({ status: 409, codigo: 'DOCUMENTO_JA_CADASTRADO' });
      expect((await t.q<{ revisao_cadastro: number }>('select revisao_cadastro from core.cliente where id = $1', [ID2]))[0]!.revisao_cadastro).toBe(1);
    });
  });

  it('RN-CORE-78 (ADR 0069 §4): o id novo do APK v1.0.28 com o documento do recusado vira o cliente vivo e herda o histórico como revisão seguinte', async () => {
    await emTransacao(pool, async (t) => {
      await post(t, VENDEDOR, pre(ID1));
      await recusar(t, ID1);
      t.publicar.mockClear();
      const r = await t.push(receberPreCadastros, VENDEDOR, [pre(ID4, { razao_social: 'Mercado Novo Ltda' })]);
      expect(r).toEqual([{ id: ID4, status: 'aceito' }]);
      expect((await t.q<{ apagado: boolean }>('select deleted_at is not null as apagado from core.cliente where id = $1', [ID1]))[0]!.apagado).toBe(true);
      expect((await t.q('select status_cadastro, revisao_cadastro from core.cliente where id = $1', [ID4]))[0]).toEqual({ status_cadastro: 'pendente', revisao_cadastro: 2 });
      expect((await tentativas(t, ID4)).map((x) => [x.revisao, x.resultado, x.cliente_id_original, x.campos_alterados])).toEqual([
        [1, 'recusado', ID1, []],
        [2, 'aguardando', null, ['razao_social']],
      ]);
      expect(await tentativas(t, ID1)).toEqual([]);
      expect(eventos(t, EVENTO_CLIENTE_PRE_CADASTRADO.nome).map((c) => (c[1] as { cliente_id: string }).cliente_id)).toEqual([ID4]);
      const aud = await t.q<{ depois: unknown }>("select depois from plataforma.auditoria where acao = 'cliente.recusado_substituido' and entidade_id = $1", [ID1]);
      expect(aud.map((a) => a.depois)).toEqual([{ substituido_por: ID4, regra: 'RN-CORE-78' }]);
      expect(await t.q('select 1 from core.carteira where cliente_id = $1 and usuario_id = $2 and deleted_at is null', [ID4, A.usuarios.vendedor1])).toHaveLength(1);
    });
  });

  it('RN-CORE-78 (ADR 0069 §3): o receptor do push aceita, rejeita com o código da regra e confere perfil e carteira', async () => {
    await emTransacao(pool, async (t) => {
      const ok = await t.push(receberPreCadastros, VENDEDOR, [pre(ID1), pre(ID2, { cep: null })]);
      expect(ok[0]).toEqual({ id: ID1, status: 'aceito' });
      expect(ok[1]).toMatchObject({ id: ID2, status: 'rejeitado', codigo: 'CAMPOS_OBRIGATORIOS', mensagem: 'Preencha o endereço.' });
      expect(await t.q('select 1 from core.cliente where id = $1', [ID2])).toHaveLength(0);
      // repetição do mesmo item = aceito (ja_existia)
      expect(await t.push(receberPreCadastros, VENDEDOR, [pre(ID1)])).toEqual([{ id: ID1, status: 'aceito' }]);
      // correção de recusado fora da carteira do vendedor
      await post(t, ADMIN, pre(ID3));
      await recusar(t, ID3);
      expect(await t.push(receberPreCadastros, VENDEDOR, [pre(ID3, { revisao_base: 1 })])).toMatchObject([{ id: ID3, status: 'rejeitado', codigo: 'FORA_DA_CARTEIRA' }]);
      // RN-CORE-78: o promotor não pré-cadastra
      expect(await t.push(receberPreCadastros, { id: A.usuarios.promotor, perfil: 'promotor' }, [pre(ID2)])).toMatchObject([{ id: ID2, status: 'rejeitado', codigo: 'PERFIL_SEM_ACESSO' }]);
      expect(await t.push(receberPreCadastros, VENDEDOR, [pre(ID1)], 'remover')).toMatchObject([{ id: ID1, status: 'rejeitado', codigo: 'OPERACAO_NAO_SUPORTADA' }]);
      // correção pelo app, na carteira: revisão nova com origem campo
      await recusar(t, ID1);
      expect(await t.push(receberPreCadastros, VENDEDOR, [pre(ID1, { revisao_base: 1, numero: '12' })])).toEqual([{ id: ID1, status: 'aceito' }]);
      expect((await tentativas(t, ID1)).map((x) => [x.revisao, x.origem, x.campos_alterados])).toEqual([
        [1, 'campo', []],
        [2, 'campo', ['numero']],
      ]);
    });
  });

  it('RN-CORE-78 (ADR 0069 §5): id que já existe em outro tenant ou apagado dá 409 CADASTRO_INDISPONIVEL, sem 500 e sem dizer que existe', async () => {
    await emTransacao(pool, async (t) => {
      await post(t, ADMIN, pre(ID1));
      await t.trocarTenant(B.tenantId);
      const e = await post(t, { id: B.usuarios.admin, perfil: 'admin' }, pre(ID1), B.tenantId).catch((x: unknown) => x);
      expect(e).toMatchObject({ status: 409, codigo: 'CADASTRO_INDISPONIVEL', message: MENSAGENS_ERRO_PRE_CADASTRO.CADASTRO_INDISPONIVEL });
      expect(String((e as Error).message)).not.toMatch(/outro|existe/i);
      await t.trocarTenant(A.tenantId);
      await t.q('update core.cliente set deleted_at = now() where id = $1', [ID1]);
      await expect(post(t, ADMIN, pre(ID1, { documento: DOCS[ID2] }))).rejects.toMatchObject({ status: 409, codigo: 'CADASTRO_INDISPONIVEL' });
    });
  });

  /** Corrida real (duas conexões): a 1ª grava sem confirmar; a 2ª passa da conferência, espera no índice e recebe o 23505. */
  async function corrida(primeiro: Record<string, unknown>, segundo: Record<string, unknown>): Promise<unknown> {
    const c1 = await pool.connect();
    const ids = [String(primeiro.id), String(segundo.id)];
    try {
      await c1.query('begin');
      await definirTenant(c1, A.tenantId);
      await c1.query(
        "insert into core.cliente (id, tenant_id, razao_social, documento, origem_cadastro, status_cadastro, revisao_cadastro) values ($1, plataforma.tenant_atual(), 'Corrida', $2, 'bko', 'pendente', 1)",
        [primeiro.id, primeiro.documento],
      );
      let resultado: unknown;
      await emTransacao(pool, async (t) => {
        const pid = (await t.q<{ pid: number }>('select pg_backend_pid() as pid'))[0]!.pid;
        const pedido = post(t, ADMIN, segundo).then(
          (r) => r,
          (e: unknown) => e,
        );
        for (let i = 0; i < 100; i++) {
          const espera = (await admin.query<{ w: string | null }>('select wait_event_type as w from pg_stat_activity where pid = $1', [pid])).rows[0]?.w;
          if (espera === 'Lock') break;
          await new Promise((r) => setTimeout(r, 50));
        }
        await c1.query('commit');
        resultado = await pedido;
      });
      return resultado;
    } finally {
      await c1.query('rollback').catch(() => undefined);
      c1.release();
      await admin.query('delete from core.cliente_pre_cadastro_tentativa where cliente_id = any($1::uuid[])', [ids]);
      await admin.query('delete from core.carteira where cliente_id = any($1::uuid[])', [ids]);
      await admin.query('delete from core.cliente where id = any($1::uuid[])', [ids]);
    }
  }

  it('RN-CORE-78 (ADR 0069 §5): 23505 de cliente_pkey em corrida no mesmo tenant devolve ja_existia', async () => {
    const r = await corrida({ id: ID1, documento: DOCS[ID1] }, pre(ID1));
    expect(r).toEqual({ id: ID1, status_cadastro: 'pendente', revisao: 1, ja_existia: true });
  });

  it('RN-CORE-78 (ADR 0069 §5): 23505 de cliente_documento_uk em corrida dá 409 DOCUMENTO_JA_CADASTRADO', async () => {
    const r = await corrida({ id: ID2, documento: DOCS[ID1] }, pre(ID1));
    expect(r).toMatchObject({ status: 409, codigo: 'DOCUMENTO_JA_CADASTRADO' });
  });

  it('RN-CORE-78: no tenant B o pré-cadastro e as tentativas do tenant A não existem (RLS)', async () => {
    await emTransacao(pool, async (t) => {
      await post(t, ADMIN, pre(ID3));
      expect(await tentativas(t, ID3)).toHaveLength(1);
      await t.trocarTenant(B.tenantId);
      expect(await t.q('select 1 from core.cliente where id = $1', [ID3])).toHaveLength(0);
      expect(await tentativas(t, ID3)).toHaveLength(0);
    });
  });

  it('RN-INT-22: o Hub lê só os pendentes sem código, em ordem de chegada e paginados, com a revisão e o hash dos dados atuais', async () => {
    await emTransacao(pool, async (t) => {
      const lista = (entrada: unknown = {}): Promise<ClientesPreCadastroSemErpSaida> => consultaClientesPreCadastroSemErp.executar(consultaClientesPreCadastroSemErp.consulta.entrada.parse(entrada), { db: t.c } as never);
      for (const id of [ID1, ID2, ID3]) {
        await post(t, ADMIN, pre(id, { origem: 'bko', razao_social: `Cliente ${id.slice(-1)}`, latitude: -3.1, longitude: -60.02 }));
      }
      await t.q("update core.cliente set created_at = created_at - interval '2 minute' where id = $1", [ID2]);
      await recusar(t, ID3);
      expect((await lista()).clientes.map((x) => x.cliente_id)).toEqual([ID2, ID1]);
      const p1 = await lista({ limite: 1 });
      expect(p1.clientes).toHaveLength(1);
      expect(p1.proximo).toBe(p1.clientes[0]!.cliente_id);
      expect(p1.clientes[0]).toMatchObject({ latitude: -3.1, longitude: -60.02, cidade: 'Manaus', recebido_em: expect.any(String), revisao: 1 });
      expect(p1.clientes[0]!.hash).toBe(hashPreCadastro(await comFilial(t, ID2, pre(ID2, { razao_social: 'Cliente 2', latitude: -3.1, longitude: -60.02 }))));
      const p2 = await lista({ limite: 1, depois_de: p1.proximo });
      expect(p2.clientes.map((x) => x.cliente_id)).toEqual([ID1]);
      expect(p2.proximo).toBeNull();
      await t.q("update core.cliente set external_id = 'ERP-1' where id = $1", [ID1]);
      expect((await lista()).clientes.map((x) => x.cliente_id)).toEqual([ID2]);
      // a revisão nova volta à fila com a revisão e o hash novos
      await post(t, ADMIN, pre(ID3, { origem: 'bko', revisao_base: 1, razao_social: 'Cliente 3 corrigido', latitude: -3.1, longitude: -60.02 }));
      const r3 = (await lista()).clientes.find((x) => x.cliente_id === ID3)!;
      expect(r3).toMatchObject({ revisao: 2, hash: hashPreCadastro(await comFilial(t, ID3, pre(ID3, { razao_social: 'Cliente 3 corrigido', latitude: -3.1, longitude: -60.02 }))) });
    });
  });
});
