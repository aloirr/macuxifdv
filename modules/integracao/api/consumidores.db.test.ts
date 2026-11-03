/**
 * A7 e A8 × Postgres real (fixture dois-tenants, papel macuxi_app, RLS): consumidores da Integração com o `ctx.db` do `comTenant`,
 * como o despachante da outbox os entrega (o ciclo do despachante em si é do teste de `apps/api`). Eventos publicados são
 * capturados e validados pelo schema do evento. Nenhum teste usa hora fixa. Pula sem Postgres; com MACUXI_PG_EXIGIR=1 falha.
 *  - A7: lote válido → aplicado com `integracao.<entidade>.atualizado@1`; só inválidas → `concluido_com_erros` (P-1); reentrega não
 *    duplica; obsoleta/inalterada não publica; dependência espera e referência ausente é erro reprocessável (RN-INT-04); sessão
 *    completa inativa ou cria a pendência e inválido nunca é inativado (RN-INT-06); multi-tenant.
 *  - A8: pedido aprovado → fila → Conector retira; sem de-para fica retido; cancelado antes da entrega sai; depois, não; reentrega
 *    do evento não duplica; multi-tenant.
 */
import { createHash, randomUUID } from 'node:crypto';
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import { ConsultaIndisponivel, type ContextoConsumo, type DefinicaoEvento } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { VERSAO_CONTRATO } from '../contracts';
import manifest from '../manifest';
import { aplicarLote } from './aplicar-lote';
import { entrarNaFila, sairDaFila } from './consumidores-pedido';
import { moduloApi } from './index';
import { pedidosPendentes } from './rotas-pedidos';

// o Core ainda não publica `core.medidas@1` (PR separado): o consumidor A7 acha a definição em `@macuxi/core/contracts` por nome, então aqui ela é
// injetada (só a definição; a resposta é o stub em memória abaixo). Quando o Core publicar a real, este mock pode sair.
vi.mock('@macuxi/core/contracts', async (importar) => ({
  ...(await importar<Record<string, unknown>>()),
  CONSULTA_MEDIDAS: { nome: 'core.medidas@1' },
}));

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
/** Prefixo dos external_id deste arquivo: a limpeza só toca o que ele criou. */
const P = `T0032A7${randomUUID().slice(0, 6)}`;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
/** Relógio do teste: uma instância só; as colunas `now()` do banco andam à frente dela (nunca contra data fixa). */
const AGORA = new Date();
const em = (ms: number) => new Date(AGORA.getTime() + ms).toISOString();

interface Capturado {
  nome: string;
  payload: Record<string, unknown>;
}

describe('A7/A8: ligação no manifesto e no moduloApi', () => {
  it('manifesto declara o consumo e o moduloApi expõe os 3 consumidores (o despachante só entrega o que está em consome)', () => {
    for (const nome of ['vendedor.pedido.aprovado@1', 'vendedor.pedido.status_alterado@1', 'integracao.lote.recebido@1']) {
      expect(manifest.consome).toContain(nome);
    }
    expect(moduloApi.consumidores?.map((c) => c.evento.nome).sort()).toEqual(['integracao.lote.recebido@1', 'vendedor.pedido.aprovado@1', 'vendedor.pedido.status_alterado@1']);
  });
});

describe.skipIf(semBanco())('Integração A7/A8 × Postgres', () => {
  let pool: pg.Pool;
  let admin: pg.Client;
  let eventos: Capturado[] = [];

  /** Roda `fn` numa transação do tenant com o contexto do consumidor (como o despachante entrega). */
  const rodar = <T>(tenantId: string, fn: (ctx: ContextoConsumo) => Promise<T>, extra: Record<string, unknown> = {}): Promise<T> =>
    comTenant(pool, tenantId, (db) =>
      fn({
        envelope: { evento_id: randomUUID(), tenant_id: tenantId },
        db,
        agora: () => AGORA,
        publicar: (async (def: DefinicaoEvento, payload: unknown) => {
          const valido = def.schema.parse(payload) as Record<string, unknown>;
          eventos.push({ nome: def.nome, payload: valido });
          return {} as never;
        }) as never,
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        // o despachante sempre entrega `consultar`; por padrão o Core não aponta nada incompleto
        consultar: async () => ({ resultados: [] }),
        ...extra,
      } as unknown as ContextoConsumo),
    );
  const nomes = (nome: string) => eventos.filter((e) => e.nome === nome);

  const novoLote = async (
    tenantId: string,
    conectorId: string,
    entidade: string,
    corpo: { registros?: unknown[]; linhas_invalidas?: unknown[]; linhas_invalidas_omitidas?: number },
    sessao?: { id: string; parte: number; ultimo: boolean },
  ): Promise<string> =>
    comTenant(pool, tenantId, async (db) => {
      let sessaoId: string | null = null;
      if (sessao) {
        const { rows } = await db.query<{ id: string }>(
          `insert into integracao.sessao_carga (tenant_id, sessao_uuid, conector_id, entidade, ultima_parte) values (plataforma.tenant_atual(), $1, $2, $3, $4)
           on conflict (tenant_id, conector_id, sessao_uuid) do update set ultima_parte = coalesce(excluded.ultima_parte, integracao.sessao_carga.ultima_parte) returning id`,
          [sessao.id, conectorId, entidade, sessao.ultimo ? sessao.parte : null],
        );
        sessaoId = rows[0]!.id;
      }
      const registros = corpo.registros ?? [];
      const invalidas = corpo.linhas_invalidas ?? [];
      const chave = randomUUID().replace(/-/g, '');
      const { rows } = await db.query<{ id: string }>(
        `insert into integracao.lote (tenant_id, conector_id, entidade, modo, versao_contrato, sessao_id, sessao_parte, sessao_ultimo, chave_idempotencia, hash_conteudo, recebidas, invalidas_omitidas)
         values (plataforma.tenant_atual(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
        [conectorId, entidade, sessao ? 'completo' : 'delta', VERSAO_CONTRATO, sessaoId, sessao?.parte ?? null, sessao?.ultimo ?? null, chave, sha(chave), registros.length + invalidas.length + (corpo.linhas_invalidas_omitidas ?? 0), corpo.linhas_invalidas_omitidas ?? 0],
      );
      const id = rows[0]!.id;
      await db.query('insert into integracao.lote_staging (tenant_id, lote_id, corpo) values (plataforma.tenant_atual(), $1, $2::jsonb)', [id, JSON.stringify({ registros, linhas_invalidas: invalidas, linhas_invalidas_omitidas: corpo.linhas_invalidas_omitidas ?? 0 })]);
      return id;
    });

  const aplicar = (tenantId: string, loteId: string, entidade: string, conectorIdentificador: string, extra: Record<string, unknown> = {}) =>
    rodar(tenantId, (ctx) => aplicarLote({ lote_id: loteId, conector_id: conectorIdentificador, entidade: entidade as never, modo: 'delta', recebidas: 1, recebido_em: AGORA.toISOString() }, ctx), extra);
  const lerLote = (tenantId: string, id: string) =>
    comTenant(pool, tenantId, async (db) =>
      (
        await db.query<Record<string, unknown>>(
          'select status, recebidas, com_erro, novas, atualizadas, inalteradas, obsoletas, duplicadas_no_lote, inativadas, cursor_resultante from integracao.lote where id = $1',
          [id],
        )
      ).rows[0],
    );
  const erros = (tenantId: string, id: string) =>
    comTenant(pool, tenantId, async (db) => (await db.query<{ indice: number; origem: string; codigo: string; reprocessavel: boolean; external_id: string | null }>('select indice, origem, codigo, reprocessavel, external_id from integracao.lote_linha_erro where lote_id = $1 order by origem, indice', [id])).rows);
  const registros = (tenantId: string, entidade: string) =>
    comTenant(pool, tenantId, async (db) => (await db.query<{ external_id: string; ativo: boolean; deleted_at: Date | null }>('select external_id, ativo, deleted_at from integracao.registro_atual where entidade = $1 and external_id like $2 order by external_id', [entidade, `${P}%`])).rows);
  const vend = (n: string, nome = `Vendedor ${n}`, alterado: string = em(-60_000)) => ({ external_id: `${P}-${n}`, nome, alterado_em: alterado });
  const ID_A = A.integracao.identificador;

  /** A fixture traz um lote delta de produto `recebido` no tenant A, que seguraria os lotes de produto destes testes (mesma entidade, mesmo Conector). */
  async function liberarFilaDeProduto() {
    await admin.query("update integracao.lote set status = 'concluido' where tenant_id = $1 and entidade = 'produto' and status = 'recebido' and id not in (select lote_id from integracao.lote_staging where corpo::text like '%T0032A7%')", [A.tenantId]);
  }

  async function limpar() {
    const t = [A.tenantId, B.tenantId];
    await admin.query('delete from integracao.pendencia_inativacao where sessao_id in (select id from integracao.sessao_carga where external_id = $1)', [P]);
    await admin.query('delete from integracao.lote where tenant_id = any($1) and id in (select lote_id from integracao.lote_staging where corpo::text like $2)', [t, '%T0032A7%']); // também os lotes que uma execução anterior interrompida deixou em aberto
    await admin.query('delete from integracao.registro_atual where tenant_id = any($1) and external_id like $2', [t, `${P}%`]);
    await admin.query("delete from integracao.pedido_fila_erp where tenant_id = any($1) and payload_origem->>'observacao' = $2", [t, P]);
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
    admin = new pg.Client({ connectionString: banco().urlAdmin });
    await admin.connect();
  });
  afterAll(async () => {
    if (admin) {
      // sessões criadas pelos testes (uuid próprio) e o que dependia delas
      await admin.query('delete from integracao.pendencia_inativacao where sessao_id in (select id from integracao.sessao_carga where external_id = $1)', [P]);
      await admin.query('delete from integracao.lote where sessao_id in (select id from integracao.sessao_carga where external_id = $1)', [P]);
      await limpar();
      await admin.query('delete from integracao.sessao_carga where external_id = $1', [P]);
    }
    await admin?.end();
    await pool?.end();
  });

  // ------------------------------------------------------------------------------------------------------------ A7
  describe('A7: aplicar o lote recebido', () => {
    it('RN-INT-02/05: lote válido vira aplicado, grava registro_atual, avança o cursor e publica integracao.vendedor.atualizado@1 + lote.concluido', async () => {
      eventos = [];
      const lote = await novoLote(A.tenantId, A.integracao.conector, 'vendedor', { registros: [vend('1'), vend('2')] });
      await aplicar(A.tenantId, lote, 'vendedor', ID_A);
      expect(await lerLote(A.tenantId, lote)).toMatchObject({ status: 'concluido', recebidas: 2, novas: 2, com_erro: 0, atualizadas: 0, inalteradas: 0 });
      expect((await registros(A.tenantId, 'vendedor')).map((r) => r.external_id)).toEqual([`${P}-1`, `${P}-2`]);
      const atualizados = nomes('integracao.vendedor.atualizado@1');
      expect(atualizados).toHaveLength(2);
      expect(atualizados[0]?.payload).toMatchObject({ lote_id: lote, entidade: 'vendedor', acao: 'criado', registro: { nome: expect.any(String) } });
      expect(nomes('integracao.lote.concluido@1')).toHaveLength(1);
      const cur = await comTenant(pool, A.tenantId, async (db) => (await db.query<{ cursor_external_id: string }>("select cursor_external_id from integracao.cursor_entidade where conector_id = $1 and entidade = 'vendedor'", [A.integracao.conector])).rows[0]);
      expect(cur?.cursor_external_id).toBe(`${P}-2`);
    });

    it('RN-INT-03: linha inválida não trava o lote (concluido_com_erros) e o erro fica legível por linha; igual = inalterada, mais antiga = obsoleta, nenhum publica', async () => {
      eventos = [];
      const lote = await novoLote(A.tenantId, A.integracao.conector, 'vendedor', {
        registros: [vend('1'), { external_id: `${P}-3`, alterado_em: em(-1000) }, vend('2', 'Nome velho', em(-3_600_000)), vend('4', 'Quatro')],
      });
      await aplicar(A.tenantId, lote, 'vendedor', ID_A);
      expect(await lerLote(A.tenantId, lote)).toMatchObject({ status: 'concluido_com_erros', recebidas: 4, com_erro: 1, novas: 1, inalteradas: 1, obsoletas: 1 });
      expect(await erros(A.tenantId, lote)).toEqual([{ indice: 1, origem: 'hub', codigo: 'campo_obrigatorio', reprocessavel: false, external_id: `${P}-3` }]);
      const atualizados = nomes('integracao.vendedor.atualizado@1');
      expect(atualizados.map((e) => e.payload.external_id)).toEqual([`${P}-4`]);
    });

    it('RN-INT-02: hash novo é atualizada e publica acao atualizado; a reentrega da outbox do mesmo lote não duplica', async () => {
      eventos = [];
      const lote = await novoLote(A.tenantId, A.integracao.conector, 'vendedor', { registros: [vend('1', 'Vendedor 1 renomeado', em(-30_000))] });
      await aplicar(A.tenantId, lote, 'vendedor', ID_A);
      await aplicar(A.tenantId, lote, 'vendedor', ID_A);
      expect(await lerLote(A.tenantId, lote)).toMatchObject({ status: 'concluido', atualizadas: 1, novas: 0 });
      expect(nomes('integracao.vendedor.atualizado@1').map((e) => e.payload.acao)).toEqual(['atualizado']);
      expect(nomes('integracao.lote.concluido@1')).toHaveLength(1);
    });

    it('RN-INT-01/P-1: lote só de linhas inválidas do Conector termina concluido_com_erros, com os erros origem=conector e sem evento de registro', async () => {
      eventos = [];
      const lote = await novoLote(A.tenantId, A.integracao.conector, 'vendedor', {
        linhas_invalidas: [{ external_id: `${P}-9`, codigo: 'campo_obrigatorio', campo: 'nome', mensagem: 'nome vazio no ERP' }],
        linhas_invalidas_omitidas: 2,
      });
      await aplicar(A.tenantId, lote, 'vendedor', ID_A);
      expect(await lerLote(A.tenantId, lote)).toMatchObject({ status: 'concluido_com_erros', com_erro: 3, novas: 0 });
      expect(await erros(A.tenantId, lote)).toEqual([{ indice: 0, origem: 'conector', codigo: 'campo_obrigatorio', reprocessavel: false, external_id: `${P}-9` }]);
      expect(nomes('integracao.vendedor.atualizado@1')).toHaveLength(0);
      expect(nomes('integracao.lote.concluido@1')[0]?.payload).toMatchObject({ status: 'concluido_com_erros', com_erro: 3 });
    });

    it('RN-INT-04: cliente espera o lote de vendedor em aberto (a outbox repete); depois aplica e referência ausente é erro reprocessável', async () => {
      eventos = [];
      const cli = (n: string, vendedor: string) => ({ external_id: `${P}-C${n}`, razao_social: `Cliente ${n}`, vendedor_external_id: vendedor, alterado_em: em(-60_000) });
      const loteVend = await novoLote(A.tenantId, A.integracao.conector, 'vendedor', { registros: [vend('5')] });
      const loteCli = await novoLote(A.tenantId, A.integracao.conector, 'cliente', { registros: [cli('1', `${P}-5`), cli('2', `${P}-NAOEXISTE`)] });
      await expect(aplicar(A.tenantId, loteCli, 'cliente', ID_A)).rejects.toThrow(/aguardando a carga de vendedor/);
      expect((await lerLote(A.tenantId, loteCli))?.status).toBe('recebido');
      await aplicar(A.tenantId, loteVend, 'vendedor', ID_A);
      await aplicar(A.tenantId, loteCli, 'cliente', ID_A);
      expect(await lerLote(A.tenantId, loteCli)).toMatchObject({ status: 'concluido_com_erros', novas: 1, com_erro: 1 });
      expect(await erros(A.tenantId, loteCli)).toEqual([{ indice: 1, origem: 'hub', codigo: 'referencia_ausente', reprocessavel: true, external_id: `${P}-C2` }]);
      expect((await registros(A.tenantId, 'cliente')).map((r) => r.external_id)).toEqual([`${P}-C1`]);
    });

    it('RN-INT-14: cliente sem campo obrigatório é aplicado e ganha o aviso cadastro_incompleto no lote (não é erro de linha)', async () => {
      await limpar();
      const cli = (n: string) => ({ external_id: `${P}-K${n}`, razao_social: `Cliente ${n}`, alterado_em: em(-60_000) });
      const lote = await novoLote(A.tenantId, A.integracao.conector, 'cliente', { registros: [cli('1'), cli('2')] });
      const consultar = vi.fn(async (_def: unknown, entrada: { clientes: { chave: string }[] }) => ({
        resultados: entrada.clientes.map((c) => (c.chave.endsWith('K1') ? { chave: c.chave, completo: false, campos_faltantes: ['documento', 'cep'] } : { chave: c.chave, completo: true, campos_faltantes: [] })),
      }));
      await aplicar(A.tenantId, lote, 'cliente', ID_A, { consultar });
      expect(consultar).toHaveBeenCalledTimes(1);
      expect(await lerLote(A.tenantId, lote)).toMatchObject({ status: 'concluido', novas: 2, com_erro: 0 });
      const avisos = await comTenant(pool, A.tenantId, async (db) => (await db.query<{ avisos: Record<string, unknown>[] }>('select avisos from integracao.lote where id = $1', [lote])).rows[0]?.avisos);
      expect(avisos).toEqual([{ indice: 0, external_id: `${P}-K1`, codigo: 'cadastro_incompleto', mensagem: expect.stringContaining('falta CNPJ/CPF, CEP') }]);
      expect((await registros(A.tenantId, 'cliente')).map((r) => r.external_id)).toEqual([`${P}-K1`, `${P}-K2`]);
    });

    it('RN-INT-14: Core indisponível para o tenant (ConsultaIndisponivel) não derruba o lote: aplica sem o aviso', async () => {
      await limpar();
      const lote = await novoLote(A.tenantId, A.integracao.conector, 'cliente', { registros: [{ external_id: `${P}-K9`, razao_social: 'Cliente 9', alterado_em: em(-60_000) }] });
      const consultar = vi.fn(async () => {
        throw new ConsultaIndisponivel('core.cadastro_cliente@1', 'core');
      });
      await aplicar(A.tenantId, lote, 'cliente', ID_A, { consultar });
      expect(await lerLote(A.tenantId, lote)).toMatchObject({ status: 'concluido', novas: 1, com_erro: 0 });
    });

    it('RN-INT-02/04: produto_unidade e cliente_endereco são aplicados e publicam os eventos; sem o pai viram referencia_ausente', async () => {
      await limpar();
      await liberarFilaDeProduto();
      eventos = [];
      const prod = { external_id: `${P}-PR1`, sku: 'SKU1', nome: 'Refri', unidade: 'UN', alterado_em: em(-60_000) };
      const cli = { external_id: `${P}-CE1`, razao_social: 'Cliente E', alterado_em: em(-60_000) };
      await aplicar(A.tenantId, await novoLote(A.tenantId, A.integracao.conector, 'produto', { registros: [prod] }), 'produto', ID_A);
      await aplicar(A.tenantId, await novoLote(A.tenantId, A.integracao.conector, 'cliente', { registros: [cli] }), 'cliente', ID_A, { consultar: async () => ({ resultados: [] }) });
      const pu = (n: string, produto: string) => ({ external_id: `${P}-PU${n}`, produto_external_id: produto, unidade: 'CX', fator: 12, alterado_em: em(-60_000) });
      const lotePu = await novoLote(A.tenantId, A.integracao.conector, 'produto_unidade', { registros: [pu('1', `${P}-PR1`), pu('2', `${P}-NAO`)] });
      await aplicar(A.tenantId, lotePu, 'produto_unidade', ID_A);
      expect(await lerLote(A.tenantId, lotePu)).toMatchObject({ status: 'concluido_com_erros', novas: 1, com_erro: 1 });
      expect((await erros(A.tenantId, lotePu))[0]).toMatchObject({ codigo: 'referencia_ausente', reprocessavel: true });
      expect(nomes('integracao.produto_unidade.atualizado@1').map((e) => e.payload.external_id)).toEqual([`${P}-PU1`]);
      const ce = (n: string, cliente: string) => ({ external_id: `${P}-CEN${n}`, cliente_external_id: cliente, logradouro: 'Rua A', cidade: 'Boa Vista', uf: 'RR', alterado_em: em(-60_000) });
      const loteCe = await novoLote(A.tenantId, A.integracao.conector, 'cliente_endereco', { registros: [ce('1', `${P}-CE1`), ce('2', `${P}-NAO`)] });
      await aplicar(A.tenantId, loteCe, 'cliente_endereco', ID_A);
      expect(await lerLote(A.tenantId, loteCe)).toMatchObject({ status: 'concluido_com_erros', novas: 1, com_erro: 1 });
      expect(nomes('integracao.cliente_endereco.atualizado@1').map((e) => e.payload.external_id)).toEqual([`${P}-CEN1`]);
    });

    it('RN-INT-04: produto com nó do catálogo ausente entra com o aviso referencia_fraca_ausente (não é erro de linha)', async () => {
      await limpar();
      await liberarFilaDeProduto();
      const prod = { external_id: `${P}-PN1`, sku: 'SKUN', nome: 'Suco', unidade: 'UN', catalogo_no_external_id: `${P}-NO-AUSENTE`, alterado_em: em(-60_000) };
      const lote = await novoLote(A.tenantId, A.integracao.conector, 'produto', { registros: [prod] });
      await aplicar(A.tenantId, lote, 'produto', ID_A);
      expect(await lerLote(A.tenantId, lote)).toMatchObject({ status: 'concluido', novas: 1, com_erro: 0 });
      const avisos = await comTenant(pool, A.tenantId, async (db) => (await db.query<{ avisos: { codigo: string }[] }>('select avisos from integracao.lote where id = $1', [lote])).rows[0]?.avisos);
      expect(avisos?.map((a) => a.codigo)).toEqual(['referencia_fraca_ausente']);
    });

    it('RN-INT-06: carga completa dentro do limite inativa o ausente, publica acao inativado e nunca inativa quem chegou inválido', async () => {
      await limpar();
      eventos = [];
      // 10 ativos; a carga completa traz 8 válidos + 1 inválido (V9, existe no ERP) e omite V10: só V10 sai (10% ≤ 30%)
      const todos = Array.from({ length: 10 }, (_, i) => vend(`S${i + 1}`));
      await aplicar(A.tenantId, await novoLote(A.tenantId, A.integracao.conector, 'vendedor', { registros: todos }), 'vendedor', ID_A);
      eventos = [];
      const sessao = randomUUID();
      const lote = await novoLote(
        A.tenantId,
        A.integracao.conector,
        'vendedor',
        { registros: [...todos.slice(0, 8), { external_id: `${P}-S9`, alterado_em: em(-1000) }] },
        { id: sessao, parte: 1, ultimo: true },
      );
      await admin.query('update integracao.sessao_carga set external_id = $2 where sessao_uuid = $1', [sessao, P]);
      await aplicar(A.tenantId, lote, 'vendedor', ID_A);
      expect(await lerLote(A.tenantId, lote)).toMatchObject({ status: 'concluido_com_erros', inativadas: 1, com_erro: 1 });
      const r = await registros(A.tenantId, 'vendedor');
      expect(r.filter((x) => x.deleted_at !== null).map((x) => x.external_id)).toEqual([`${P}-S10`]);
      expect(r.find((x) => x.external_id === `${P}-S9`)?.deleted_at).toBeNull();
      expect(nomes('integracao.vendedor.atualizado@1').map((e) => [e.payload.external_id, e.payload.acao])).toEqual([[`${P}-S10`, 'inativado']]);
    });

    it('RN-INT-06: carga completa que inativaria mais de 30% não inativa nada e cria a pendência para o operador', async () => {
      await limpar();
      eventos = [];
      const todos = Array.from({ length: 4 }, (_, i) => vend(`L${i + 1}`));
      await aplicar(A.tenantId, await novoLote(A.tenantId, A.integracao.conector, 'vendedor', { registros: todos }), 'vendedor', ID_A);
      const sessao = randomUUID();
      const lote = await novoLote(A.tenantId, A.integracao.conector, 'vendedor', { registros: todos.slice(0, 2) }, { id: sessao, parte: 1, ultimo: true });
      await admin.query('update integracao.sessao_carga set external_id = $2 where sessao_uuid = $1', [sessao, P]);
      await aplicar(A.tenantId, lote, 'vendedor', ID_A);
      expect(await lerLote(A.tenantId, lote)).toMatchObject({ status: 'concluido', inativadas: 0 });
      expect((await registros(A.tenantId, 'vendedor')).every((x) => x.deleted_at === null)).toBe(true);
      const p = await comTenant(pool, A.tenantId, async (db) => (await db.query<{ estado: string; candidatos: number; total_ativos: number; amostra: string[] }>('select estado, candidatos, total_ativos, amostra from integracao.pendencia_inativacao where lote_id = $1', [lote])).rows);
      expect(p.map((x) => ({ ...x, amostra: [...x.amostra].sort() }))).toEqual([{ estado: 'aguardando', candidatos: 2, total_ativos: 4, amostra: [`${P}-L3`, `${P}-L4`] }]);
    });

    it('multi-tenant: o evento de um lote do tenant A entregue no contexto do B é no-op, e o registro de A não aparece em B', async () => {
      await limpar();
      const lote = await novoLote(A.tenantId, A.integracao.conector, 'vendedor', { registros: [vend('M1')] });
      await aplicar(B.tenantId, lote, 'vendedor', B.integracao.identificador);
      expect((await lerLote(A.tenantId, lote))?.status).toBe('recebido');
      await aplicar(A.tenantId, lote, 'vendedor', ID_A);
      expect(await registros(B.tenantId, 'vendedor')).toEqual([]);
      expect((await registros(A.tenantId, 'vendedor')).map((r) => r.external_id)).toEqual([`${P}-M1`]);
    });
  });

  // ------------------------------------------------------------------------------------------------------------ A7 × medidas
  /**
   * T-0063 / RN-CORE-19 + RN-INT-04: sigla de medida desconhecida ou inativa é `referencia_ausente` reprocessável; sigla fora do
   * formato é `formato_invalido` não reprocessável. A consulta `core.medidas@1` é do Core: aqui ela é um stub em memória, por tenant
   * (o cadastro e a RLS de `core.medida` são testados pelo Core; o Hub não lê tabela de outro módulo, regra 1). O que se prova é o
   * comportamento do consumidor A7 sobre a resposta.
   */
  describe('A7: medidas do produto (RN-CORE-19)', () => {
    const SIGLA = `Z${Array.from({ length: 3 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('')}`; // 1 a 4 letras (formato da medida)
    const SIGLA_EMB = `Y${SIGLA.slice(1)}`;
    /** cadastro simulado do Core: tenant -> sigla -> ativo */
    const cadastro = new Map<string, Map<string, boolean>>();

    const medida = (tenantId: string, sigla: string, ativo = true) => {
      if (!cadastro.has(tenantId)) cadastro.set(tenantId, new Map());
      cadastro.get(tenantId)?.set(sigla, ativo);
    };
    const limparMedidas = () => cadastro.clear();
    /** Como o handler do Core: responde só com as medidas do tenant da transação `{ sigla, descricao, ativo }`. */
    const aplicarComMedidas = (tenantId: string, loteId: string, extra: (ctx: ContextoConsumo) => Partial<ContextoConsumo> = () => ({})) =>
      rodar(tenantId, async (ctx) => {
        const consultar = (async (def: { nome: string }, entrada: { siglas: string[] }) => {
          if (def.nome !== 'core.medidas@1') return { resultados: [] };
          const doTenant = cadastro.get(tenantId) ?? new Map<string, boolean>();
          return { medidas: entrada.siglas.filter((x) => doTenant.has(x)).map((x) => ({ sigla: x, descricao: `Medida ${x}`, ativo: doTenant.get(x) === true })) };
        }) as unknown as ContextoConsumo['consultar'];
        return aplicarLote({ lote_id: loteId, conector_id: tenantId === A.tenantId ? ID_A : B.integracao.identificador, entidade: 'produto', modo: 'delta', recebidas: 1, recebido_em: AGORA.toISOString() }, { ...ctx, consultar, ...extra(ctx) });
      });
    // lote em que TODAS as linhas têm erro termina `falhou` (erros.ts: linhasComErro >= efetivas); as linhas seguem reprocessáveis
    const produto = (n: string, extra: Record<string, unknown> = {}) => ({ external_id: `${P}-MD${n}`, sku: `SKUMD${n}`, nome: `Produto ${n}`, unidade: SIGLA, alterado_em: em(-60_000), ...extra });
    const loteProduto = (tenantId: string, conector: string, regs: unknown[]) => novoLote(tenantId, conector, 'produto', { registros: regs });
    const mensagens = (tenantId: string, id: string) =>
      comTenant(pool, tenantId, async (db) => (await db.query<{ campo: string; mensagem: string; reprocessavel: boolean; codigo: string }>('select campo, mensagem, reprocessavel, codigo from integracao.lote_linha_erro where lote_id = $1 order by indice', [id])).rows);

    it('RN-CORE-19/RN-INT-04: sigla desconhecida no tenant A = referencia_ausente reprocessável, com a sigla e o campo na mensagem; a linha não entra', async () => {
      await limpar();
      await liberarFilaDeProduto();
      limparMedidas();
      const lote = await loteProduto(A.tenantId, A.integracao.conector, [produto('1')]);
      await aplicarComMedidas(A.tenantId, lote);
      expect(await lerLote(A.tenantId, lote)).toMatchObject({ status: 'falhou', novas: 0, com_erro: 1 });
      expect(await mensagens(A.tenantId, lote)).toEqual([
        { codigo: 'referencia_ausente', campo: 'unidade', reprocessavel: true, mensagem: `Medida '${SIGLA}' não cadastrada (campo unidade). Cadastre em Parâmetros → Produtos e reprocesse.` },
      ]);
      expect(await registros(A.tenantId, 'produto')).toEqual([]);
    });

    it('multi-tenant: a mesma sigla cadastrada só no tenant B não vale para o A; vale para o B', async () => {
      await limpar();
      await liberarFilaDeProduto();
      limparMedidas();
      medida(B.tenantId, SIGLA);
      const loteA = await loteProduto(A.tenantId, A.integracao.conector, [produto('2')]);
      await aplicarComMedidas(A.tenantId, loteA);
      expect(await lerLote(A.tenantId, loteA)).toMatchObject({ status: 'falhou', novas: 0, com_erro: 1 });
      expect((await erros(A.tenantId, loteA))[0]).toMatchObject({ codigo: 'referencia_ausente', reprocessavel: true });
      const loteB = await loteProduto(B.tenantId, B.integracao.conector, [produto('2')]);
      await aplicarComMedidas(B.tenantId, loteB);
      expect(await lerLote(B.tenantId, loteB)).toMatchObject({ status: 'concluido', novas: 1, com_erro: 0 });
    });

    it('RN-INT-04: o BKO cadastra a medida no tenant A e o reprocessamento da linha (mesmo registro reaplicado do staging) a aplica', async () => {
      await limpar();
      await liberarFilaDeProduto();
      limparMedidas();
      eventos = [];
      const reg = produto('3');
      const primeiro = await loteProduto(A.tenantId, A.integracao.conector, [reg]);
      await aplicarComMedidas(A.tenantId, primeiro);
      expect((await erros(A.tenantId, primeiro))[0]).toMatchObject({ codigo: 'referencia_ausente', reprocessavel: true });
      expect(nomes('integracao.produto.atualizado@1')).toHaveLength(0);
      medida(A.tenantId, SIGLA);
      const reprocesso = await loteProduto(A.tenantId, A.integracao.conector, [reg]);
      await aplicarComMedidas(A.tenantId, reprocesso);
      expect(await lerLote(A.tenantId, reprocesso)).toMatchObject({ status: 'concluido', novas: 1, com_erro: 0 });
      expect((await registros(A.tenantId, 'produto')).map((r) => r.external_id)).toEqual([`${P}-MD3`]);
      expect(nomes('integracao.produto.atualizado@1').map((e) => e.payload.external_id)).toEqual([`${P}-MD3`]);
    });

    it('RN-CORE-19: medida INATIVA também é referencia_ausente reprocessável (pede para reativar); reativada, a linha é aplicada', async () => {
      await limpar();
      await liberarFilaDeProduto();
      limparMedidas();
      medida(A.tenantId, SIGLA, false);
      const reg = produto('4');
      const lote = await loteProduto(A.tenantId, A.integracao.conector, [reg]);
      await aplicarComMedidas(A.tenantId, lote);
      expect(await mensagens(A.tenantId, lote)).toEqual([
        { codigo: 'referencia_ausente', campo: 'unidade', reprocessavel: true, mensagem: `Medida '${SIGLA}' está inativa (campo unidade). Reative em Parâmetros → Produtos e reprocesse.` },
      ]);
      medida(A.tenantId, SIGLA, true);
      const reprocesso = await loteProduto(A.tenantId, A.integracao.conector, [reg]);
      await aplicarComMedidas(A.tenantId, reprocesso);
      expect(await lerLote(A.tenantId, reprocesso)).toMatchObject({ status: 'concluido', novas: 1, com_erro: 0 });
    });

    it('RN-CORE-19: a embalagem_medida do produto também é conferida (campo embalagem_medida); com as duas cadastradas a linha entra', async () => {
      await limpar();
      await liberarFilaDeProduto();
      limparMedidas();
      medida(A.tenantId, SIGLA);
      const reg = produto('5', { embalagem_medida: SIGLA_EMB, embalagem_quantidade: 12 });
      const lote = await loteProduto(A.tenantId, A.integracao.conector, [reg]);
      await aplicarComMedidas(A.tenantId, lote);
      expect(await mensagens(A.tenantId, lote)).toEqual([
        { codigo: 'referencia_ausente', campo: 'embalagem_medida', reprocessavel: true, mensagem: `Medida '${SIGLA_EMB}' não cadastrada (campo embalagem_medida). Cadastre em Parâmetros → Produtos e reprocesse.` },
      ]);
      medida(A.tenantId, SIGLA_EMB);
      const reprocesso = await loteProduto(A.tenantId, A.integracao.conector, [reg]);
      await aplicarComMedidas(A.tenantId, reprocesso);
      expect(await lerLote(A.tenantId, reprocesso)).toMatchObject({ status: 'concluido', novas: 1, com_erro: 0 });
    });

    it('RN-CORE-19: sigla fora do formato (unidade e embalagem_medida) é formato_invalido NÃO reprocessável, mesmo cadastrada; a linha não entra', async () => {
      await limpar();
      await liberarFilaDeProduto();
      limparMedidas();
      medida(A.tenantId, SIGLA);
      const lote = await loteProduto(A.tenantId, A.integracao.conector, [produto('7', { unidade: 'CAIXA' }), produto('8', { embalagem_medida: 'CX12', embalagem_quantidade: 12 })]);
      await aplicarComMedidas(A.tenantId, lote);
      expect(await lerLote(A.tenantId, lote)).toMatchObject({ status: 'falhou', novas: 0, com_erro: 2 });
      expect(await mensagens(A.tenantId, lote)).toEqual([
        { codigo: 'formato_invalido', campo: 'unidade', reprocessavel: false, mensagem: "Medida 'CAIXA' inválida (campo unidade): use de 1 a 4 letras. Corrija no ERP." },
        { codigo: 'formato_invalido', campo: 'embalagem_medida', reprocessavel: false, mensagem: "Medida 'CX12' inválida (campo embalagem_medida): use de 1 a 4 letras. Corrija no ERP." },
      ]);
      expect(await registros(A.tenantId, 'produto')).toEqual([]);
    });

    it('RN-CORE-19: embalagem_quantidade fora de 2 a 9999 é valor_fora_da_faixa NÃO reprocessável; a linha não entra', async () => {
      await limpar();
      await liberarFilaDeProduto();
      limparMedidas();
      medida(A.tenantId, SIGLA);
      medida(A.tenantId, SIGLA_EMB);
      const lote = await loteProduto(A.tenantId, A.integracao.conector, [
        produto('9', { embalagem_medida: SIGLA_EMB, embalagem_quantidade: 10000 }),
        produto('10', { embalagem_medida: SIGLA_EMB, embalagem_quantidade: 2147483648 }),
      ]);
      await aplicarComMedidas(A.tenantId, lote);
      expect(await lerLote(A.tenantId, lote)).toMatchObject({ status: 'falhou', novas: 0, com_erro: 2 });
      expect((await mensagens(A.tenantId, lote)).map((m) => [m.codigo, m.campo, m.reprocessavel])).toEqual([
        ['valor_fora_da_faixa', 'embalagem_quantidade', false],
        ['valor_fora_da_faixa', 'embalagem_quantidade', false],
      ]);
    });

    it('RN-INT-14: consulta de medidas indisponível não recusa a linha (o lote segue sem a conferência)', async () => {
      await limpar();
      await liberarFilaDeProduto();
      limparMedidas();
      const lote = await loteProduto(A.tenantId, A.integracao.conector, [produto('6')]);
      await rodar(A.tenantId, (ctx) =>
        aplicarLote(
          { lote_id: lote, conector_id: ID_A, entidade: 'produto', modo: 'delta', recebidas: 1, recebido_em: AGORA.toISOString() },
          {
            ...ctx,
            consultar: (async () => {
              throw new ConsultaIndisponivel('core.medidas@1', 'core');
            }) as unknown as ContextoConsumo['consultar'],
          },
        ),
      );
      expect(await lerLote(A.tenantId, lote)).toMatchObject({ status: 'concluido', novas: 1, com_erro: 0 });
    });
  });

  // ------------------------------------------------------------------------------------------------------------ A8
  describe('A8: pedido aprovado na fila do ERP', () => {
    const pedido = (uuid: string, condicao: string | null = 'AVISTA') => ({
      pedido_uuid: uuid,
      cliente_external_id: 'CLI-1',
      vendedor_external_id: 'VEN-1',
      condicao_pagamento_codigo: condicao,
      criado_em: em(-120_000),
      aprovado_em: em(-60_000),
      observacao: P,
      itens: [{ sequencia: 1, produto_external_id: 'PRD-1', quantidade: 2, preco_unitario_cents: 1000, desconto_cents: 0, total_cents: 2000 }],
      desconto_total_cents: 0,
      total_cents: 2000,
    });
    const fila = (tenantId: string, uuid: string) =>
      comTenant(pool, tenantId, async (db) => (await db.query<{ estado: string; tentativas: number; retencao_codigo: string | null; deleted_at: Date | null; payload: Record<string, unknown> | null }>('select estado, tentativas, retencao_codigo, deleted_at, payload from integracao.pedido_fila_erp where pedido_uuid = $1', [uuid])).rows[0]);
    const aprovar = (tenantId: string, p: ReturnType<typeof pedido>) => rodar(tenantId, (ctx) => entrarNaFila(p, ctx));
    const cancelar = (tenantId: string, uuid: string, para = 'cancelado') => rodar(tenantId, (ctx) => sairDaFila({ pedido_id: uuid, para, alterado_em: AGORA.toISOString() }, ctx));
    /** O que o Conector A recebe em GET /pedidos/pendentes (handler real, com o `comTenant` da fixture). */
    const retirar = (versao = '1.2.1') =>
      pedidosPendentes({
        cabecalhos: { 'x-macuxi-conector-versao': versao },
        tenantId: A.tenantId,
        conector: { id: A.integracao.conector, identificador: ID_A, recebe_pedidos: true },
        query: { limite: 100 },
        parametros: () => ({}),
        agora: () => AGORA,
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        comTenant: (fn: (db: pg.PoolClient, tx: unknown) => Promise<unknown>) => comTenant(pool, A.tenantId, (db) => fn(db, {})),
      } as never);

    it('RN-INT-08: pedido aprovado entra na fila como pendente com o de-para da condição e o Conector o retira uma vez (enviado)', async () => {
      await limpar();
      const uuid = randomUUID();
      await aprovar(A.tenantId, pedido(uuid));
      expect(await fila(A.tenantId, uuid)).toMatchObject({ estado: 'pendente', tentativas: 0, retencao_codigo: null, payload: { pedido_uuid: uuid, condicao_pagamento_erp: '001', total_cents: 2000 } });
      const r1 = await retirar();
      expect(r1.pedidos.map((x) => x.pedido_uuid)).toContain(uuid);
      expect(await fila(A.tenantId, uuid)).toMatchObject({ estado: 'enviado', tentativas: 1 });
      expect((await retirar()).pedidos.map((x) => x.pedido_uuid)).not.toContain(uuid);
    });

    it('RN-INT-08: a reentrega do evento da outbox não duplica a linha da fila nem reinicia a entrega', async () => {
      const uuid = randomUUID();
      await aprovar(A.tenantId, pedido(uuid));
      await aprovar(A.tenantId, pedido(uuid));
      const n = await comTenant(pool, A.tenantId, async (db) => (await db.query<{ n: string }>('select count(*)::text as n from integracao.pedido_fila_erp where pedido_uuid = $1', [uuid])).rows[0]?.n);
      expect(n).toBe('1');
      await retirar();
      await aprovar(A.tenantId, pedido(uuid));
      expect(await fila(A.tenantId, uuid)).toMatchObject({ estado: 'enviado', tentativas: 1 });
    });

    it('RN-INT-08: sem de-para da condição o pedido fica retido com a mensagem do que cadastrar e o Conector não o recebe', async () => {
      const uuid = randomUUID();
      await aprovar(A.tenantId, pedido(uuid, 'SEM-DEPARA'));
      expect(await fila(A.tenantId, uuid)).toMatchObject({ estado: 'pendente', retencao_codigo: 'mapeamento_ausente', payload: null });
      expect((await retirar()).pedidos.map((x) => x.pedido_uuid)).not.toContain(uuid);
    });

    it('RN-INT-08: cancelado/devolvido antes da 1ª entrega sai da fila; depois da entrega nada muda (o ERP avisa); aprovado no status não age', async () => {
      const antes = randomUUID();
      const depois = randomUUID();
      await aprovar(A.tenantId, pedido(antes));
      await cancelar(A.tenantId, antes, 'aprovado');
      expect((await fila(A.tenantId, antes))?.deleted_at).toBeNull();
      await cancelar(A.tenantId, antes);
      expect((await fila(A.tenantId, antes))?.deleted_at).not.toBeNull();
      expect((await retirar()).pedidos.map((x) => x.pedido_uuid)).not.toContain(antes);

      await aprovar(A.tenantId, pedido(depois));
      await retirar();
      await cancelar(A.tenantId, depois);
      expect(await fila(A.tenantId, depois)).toMatchObject({ estado: 'enviado', deleted_at: null });
    });

    it('RN-INT-08: aprovado sem chave do ERP (cliente sem external_id) não entra: erro legível para a outbox repetir', async () => {
      const uuid = randomUUID();
      await expect(aprovar(A.tenantId, { ...pedido(uuid), cliente_external_id: null as never })).rejects.toThrow(/chaves do ERP/);
      expect(await fila(A.tenantId, uuid)).toBeUndefined();
    });

    it('RN-INT-11: pedido FOB espera o Conector 1.3.0 na fila (exige_conector gravado) e sai quando o Conector atualiza; o simples sai ao 1.2.1', async () => {
      await limpar();
      const fob = randomUUID();
      const simples = randomUUID();
      const frete = { modalidade: 'FOB', transportadora: { tipo: 'digitada', nome: 'Rápido', cnpj: '12345678000199' } };
      await aprovar(A.tenantId, { ...pedido(fob), frete } as never);
      await aprovar(A.tenantId, pedido(simples));
      const col = await comTenant(pool, A.tenantId, async (db) => (await db.query<{ pedido_uuid: string; exige_conector: string | null }>('select pedido_uuid, exige_conector from integracao.pedido_fila_erp where pedido_uuid = any($1)', [[fob, simples]])).rows);
      expect(col.find((r) => r.pedido_uuid === fob)?.exige_conector).toBe('1.3.0');
      expect(col.find((r) => r.pedido_uuid === simples)?.exige_conector).toBeNull();
      const antigo = (await retirar('1.2.1')).pedidos.map((x) => x.pedido_uuid);
      expect(antigo).toContain(simples);
      expect(antigo).not.toContain(fob);
      expect(await fila(A.tenantId, fob)).toMatchObject({ estado: 'pendente', tentativas: 0 });
      const novo = (await retirar('1.3.0')).pedidos.find((x) => x.pedido_uuid === fob);
      expect(novo?.frete).toEqual(frete);
      await limpar();
    });

    it('multi-tenant: a fila do tenant B não enxerga o pedido de A e a aprovação em B usa o de-para de B', async () => {
      const uuid = randomUUID();
      await aprovar(A.tenantId, pedido(uuid));
      expect(await fila(B.tenantId, uuid)).toBeUndefined();
      const ub = randomUUID();
      await aprovar(B.tenantId, pedido(ub));
      expect(await fila(B.tenantId, ub)).toMatchObject({ payload: { condicao_pagamento_erp: 'AV' } });
      expect(await fila(A.tenantId, ub)).toBeUndefined();
      await limpar();
    });
  });
});
