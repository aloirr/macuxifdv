/**
 * RF-CORE-10 × Postgres real (fixture dois-tenants, papel macuxi_app, RLS; colunas das migrações 0095, 0097 e 0098): pré-cadastro
 * (obrigatórios da lista única, evento, tentativa, Código FDV gerado pelo banco e só de leitura, coordenada 'manual'), revisão do recusado no mesmo cliente, substituição pelo id novo do APK v1.0.28,
 * 23505 em corrida, receptor do push, parâmetro unificado e consulta do Hub (RN-CORE-16, RN-CORE-78, RN-CORE-79, RN-INT-22; ADR 0069).
 * Cada caso roda numa transação desfeita no fim (as corridas usam duas conexões e apagam o que gravaram). Pula sem Postgres.
 */
import { definirTenant } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EVENTO_CLIENTE_ATUALIZADO, EVENTO_CLIENTE_PRE_CADASTRADO, EVENTO_CLIENTE_PRE_CADASTRO_REVISADO, MENSAGENS_ERRO_PRE_CADASTRO } from '../contracts';
import { A, B, emTransacao, ENDERECO_COMPLETO, recusar } from './apoio-teste-pre-cadastro';
import { consultaClientesPreCadastroSemErp, rotasDeClienteCadastro } from './cliente-cadastro';
import { rotasDeClientes } from './clientes';
import { rotasDeParametrosCamposObrigatorios } from './parametros-campos-obrigatorios';
import { hashPreCadastro, receberPreCadastros } from './pre-cadastro-receber';
import { provedoresSyncCore } from './sync';
const ID1 = '5a000000-0000-4000-8000-000000000001';
const ID2 = '5a000000-0000-4000-8000-000000000002';
const ID3 = '5a000000-0000-4000-8000-000000000003';
const ID4 = '5a000000-0000-4000-8000-000000000004';
// documento próprio por id (o CPF/CNPJ é único por tenant)
const DOCS = { [ID1]: '11222333000181', [ID2]: '11444777000161', [ID3]: '12345678909', [ID4]: '11222333000181' };
const VENDEDOR = { id: A.usuarios.vendedor1, perfil: 'vendedor' };
const VENDEDOR_2 = { id: A.usuarios.vendedor2, perfil: 'vendedor' };
const ADMIN = { id: A.usuarios.admin, perfil: 'admin' };
const pre = (id, extra = {}) => ({ id, origem: 'campo', razao_social: 'Mercado Novo', documento: DOCS[id] ?? '11222333000181', ...ENDERECO_COMPLETO, ...extra });
const post = (t, u, corpo, tenant) => t.rota(rotasDeClienteCadastro, 'POST', 'clientes/pre-cadastro', { ...u, tenant }, { corpo });
const param = (t, metodo, corpo) => t.rota(rotasDeParametrosCamposObrigatorios, metodo, 'parametros/campos-obrigatorios', ADMIN, { corpo });
const tentativas = (t, id) => t.q('select revisao, hash, origem, resultado, campos_alterados, cliente_id_original, corrigido_por, corrigido_por_perfil from core.cliente_pre_cadastro_tentativa where cliente_id = $1 order by revisao', [id]);
/** RN-CORE-39: sem filial no pedido o banco grava a padrão; o hash é o dos dados gravados. */
const comFilial = async (t, id, dados) => ({ ...dados, filial_id: (await t.q('select filial_id from core.cliente where id = $1', [id]))[0].filial_id });
const FDV = expect.stringMatching(/^\d{5,}$/);
const hub = (t) => consultaClientesPreCadastroSemErp.executar(consultaClientesPreCadastroSemErp.consulta.entrada.parse({}), { db: t.c });
const eventos = (t, nome) => t.publicar.mock.calls.filter((c) => c[0].nome === nome);
describe.skipIf(semBanco())('Core × Postgres: cliente novo para o ERP (RN-CORE-78, RN-INT-22, ADR 0069)', () => {
    let pool;
    let admin;
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
            expect(r1).toEqual({ id: ID1, status_cadastro: 'pendente', revisao: 1, ja_existia: false, codigo_fdv: FDV });
            const r2 = await post(t, VENDEDOR, pre(ID1, { razao_social: 'Outro nome' }));
            expect(r2).toEqual({ id: ID1, status_cadastro: 'pendente', revisao: 1, ja_existia: true, codigo_fdv: r1.codigo_fdv });
            const [l] = await t.q('select razao_social, origem_cadastro, status_cadastro, revisao_cadastro, documento from core.cliente where id = $1', [ID1]);
            expect(l).toEqual({ razao_social: 'Mercado Novo', origem_cadastro: 'campo', status_cadastro: 'pendente', revisao_cadastro: 1, documento: '11222333000181' });
            expect(await t.q('select 1 from core.carteira where cliente_id = $1 and usuario_id = $2', [ID1, A.usuarios.vendedor1])).toHaveLength(1);
            const [tt] = await tentativas(t, ID1);
            expect(tt).toEqual({ revisao: 1, hash: hashPreCadastro(await comFilial(t, ID1, pre(ID1))), origem: 'campo', resultado: 'aguardando', campos_alterados: [], cliente_id_original: null, corrigido_por: A.usuarios.vendedor1, corrigido_por_perfil: 'vendedor' });
            expect(tt.hash).toMatch(/^[0-9a-f]{64}$/);
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
            const aud = await t.q("select depois from plataforma.auditoria where acao = 'cliente.pre_cadastrar' and entidade_id = $1", [ID1]);
            expect(aud[0]?.depois).toEqual({ origem: 'bko', status_cadastro: 'pendente', revisao: 1 });
            expect(JSON.stringify(aud)).not.toContain(hashPreCadastro(await comFilial(t, ID1, pre(ID1))));
        });
    });
    it('RN-CORE-79: a API revalida pela lista única; faltando, 422 CAMPOS_OBRIGATORIOS com os textos do contrato e só as chaves', async () => {
        await emTransacao(pool, async (t) => {
            // sem linha = padrão da RN-CORE-16 (endereço e IE para CNPJ)
            const e = await post(t, ADMIN, pre(ID1, { logradouro: null, cep: null, inscricao_estadual: null })).catch((x) => x);
            expect(e).toMatchObject({ status: 422, codigo: 'CAMPOS_OBRIGATORIOS', message: 'Preencha a inscrição estadual. Preencha o endereço.' });
            expect(e.detalhes.campos.sort()).toEqual(['cep', 'inscricao_estadual', 'logradouro']);
            expect(JSON.stringify(e.detalhes)).not.toContain('Mercado Novo');
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
            const linhas = await t.q("select chave, valor from plataforma.parametro where modulo = 'core' and chave in ('cliente.campos_obrigatorios', 'cliente.pre_cadastro.obrigatorios') and deleted_at is null order by chave");
            expect(linhas).toEqual([
                { chave: 'cliente.campos_obrigatorios', valor: ['razao_social', 'documento', 'telefone', 'email'] },
                { chave: 'cliente.pre_cadastro.obrigatorios', valor: ['telefone', 'email'] },
            ]);
            expect(await t.q("select 1 from plataforma.auditoria where acao = 'parametro.campos_obrigatorios_editar'")).toHaveLength(1);
            await param(t, 'PUT', { obrigatorios: ['cep'] });
            expect((await t.q("select valor from plataforma.parametro where modulo = 'core' and chave = 'cliente.pre_cadastro.obrigatorios' and deleted_at is null"))[0].valor).toEqual(['endereco']);
        });
    });
    it('RN-CORE-78: o recusado é corrigido no mesmo id como revisão nova; a repetição é idempotente e os eventos saem uma vez', async () => {
        await emTransacao(pool, async (t) => {
            await post(t, VENDEDOR, pre(ID1));
            await recusar(t, ID1);
            t.publicar.mockClear();
            const corrigido = pre(ID1, { revisao_base: 1, inscricao_estadual: '041234567', razao_social: 'Mercado Novo Ltda' });
            expect(await post(t, VENDEDOR, corrigido)).toEqual({ id: ID1, status_cadastro: 'pendente', revisao: 2, ja_existia: false, codigo_fdv: FDV });
            const [l] = await t.q('select status_cadastro, motivo_recusa, erros_recusa, revisao_cadastro, inscricao_estadual from core.cliente where id = $1', [ID1]);
            expect(l).toEqual({ status_cadastro: 'pendente', motivo_recusa: null, erros_recusa: null, revisao_cadastro: 2, inscricao_estadual: '041234567' });
            const ts = await tentativas(t, ID1);
            expect(ts.map((x) => [x.revisao, x.resultado, x.campos_alterados])).toEqual([
                [1, 'recusado', []],
                [2, 'aguardando', ['inscricao_estadual', 'razao_social']],
            ]);
            expect(ts[1].hash).toBe(hashPreCadastro(await comFilial(t, ID1, corrigido)));
            expect(eventos(t, EVENTO_CLIENTE_PRE_CADASTRO_REVISADO.nome)).toHaveLength(1);
            expect(eventos(t, EVENTO_CLIENTE_PRE_CADASTRO_REVISADO.nome)[0][1]).toMatchObject({ cliente_id: ID1, revisao: 2, origem: 'campo' });
            expect(eventos(t, EVENTO_CLIENTE_ATUALIZADO.nome)).toHaveLength(1);
            expect(eventos(t, EVENTO_CLIENTE_PRE_CADASTRADO.nome)).toHaveLength(0);
            // repetição: mesma revisão base e mesmo hash = ja_existia, sem nova revisão nem evento
            expect(await post(t, VENDEDOR, corrigido)).toEqual({ id: ID1, status_cadastro: 'pendente', revisao: 2, ja_existia: true, codigo_fdv: FDV });
            expect(t.publicar).toHaveBeenCalledTimes(2);
            // a mesma base com outros dados: outro corretor chegou antes
            await expect(post(t, ADMIN, pre(ID1, { revisao_base: 1, numero: '99' }))).rejects.toMatchObject({ status: 409, codigo: 'REVISAO_DESATUALIZADA', message: MENSAGENS_ERRO_PRE_CADASTRO.REVISAO_DESATUALIZADA });
            // revisão atual, mas pendente: não há o que corrigir
            await expect(post(t, ADMIN, pre(ID1, { revisao_base: 2, numero: '99' }))).rejects.toMatchObject({ status: 422, codigo: 'CADASTRO_NAO_RECUSADO' });
            // motivo e erros nunca na auditoria
            const aud = await t.q('select acao, depois from plataforma.auditoria where entidade_id = $1 order by created_at', [ID1]);
            expect(aud.find((a) => a.acao === 'cliente.pre_cadastro_corrigir')?.depois).toEqual({ revisao: 2, campos_alterados: ['inscricao_estadual', 'razao_social'], origem: 'campo' });
            expect(JSON.stringify(aud)).not.toMatch(/bloqueado|IE não confere/);
        });
    });
    it('RN-CORE-04 (ADR 0069 §3): pela rota, o vendedor não corrige o recusado nem lê o id existente da carteira de outro (403 FORA_DA_CARTEIRA)', async () => {
        await emTransacao(pool, async (t) => {
            await post(t, VENDEDOR, pre(ID1));
            await recusar(t, ID1);
            t.publicar.mockClear();
            const corrigido = pre(ID1, { revisao_base: 1, inscricao_estadual: '041234567' });
            await expect(post(t, VENDEDOR_2, corrigido)).rejects.toMatchObject({ status: 403, codigo: 'FORA_DA_CARTEIRA' });
            await expect(post(t, VENDEDOR_2, pre(ID1))).rejects.toMatchObject({ status: 403, codigo: 'FORA_DA_CARTEIRA' });
            expect((await t.q('select status_cadastro, revisao_cadastro from core.cliente where id = $1', [ID1]))[0]).toEqual({ status_cadastro: 'recusado', revisao_cadastro: 1 });
            expect(await tentativas(t, ID1)).toHaveLength(1);
            expect(t.publicar).not.toHaveBeenCalled();
            // quem tem na carteira corrige; o autor sem carteira repete e recebe ja_existia; o BKO (tenant) corrige
            expect(await post(t, VENDEDOR, corrigido)).toMatchObject({ status_cadastro: 'pendente', revisao: 2, ja_existia: false });
            await t.q('update core.carteira set deleted_at = now() where cliente_id = $1', [ID1]);
            expect(await post(t, VENDEDOR, pre(ID1))).toMatchObject({ revisao: 2, ja_existia: true });
            await recusar(t, ID1);
            expect(await post(t, ADMIN, pre(ID1, { revisao_base: 2, numero: '300' }))).toMatchObject({ revisao: 3, ja_existia: false });
        });
    });
    it('RN-CORE-78 (ADR 0069 §2): o hash da tentativa é o dos dados gravados, com a coordenada arredondada como o banco (o mesmo da consulta do Hub)', async () => {
        await emTransacao(pool, async (t) => {
            await post(t, ADMIN, pre(ID1, { latitude: -3.1234565, longitude: -60.0000005 }));
            const [l] = await t.q('select latitude::float8 as latitude, longitude::float8 as longitude from core.cliente where id = $1', [ID1]);
            expect(l).toEqual({ latitude: -3.123457, longitude: -60.000001 });
            const doHub = (await hub(t)).clientes.find((x) => x.cliente_id === ID1);
            expect((await tentativas(t, ID1))[0].hash).toBe(doHub.hash);
            await recusar(t, ID1);
            await post(t, ADMIN, pre(ID1, { revisao_base: 1, latitude: 2.0000005, longitude: -60.0000005, numero: '11' }));
            const hub2 = (await hub(t)).clientes.find((x) => x.cliente_id === ID1);
            expect((await tentativas(t, ID1))[1].hash).toBe(hub2.hash);
        });
    });
    it('RN-CORE-78: a correção com o CPF/CNPJ de outro cliente vivo dá 409 DOCUMENTO_JA_CADASTRADO e não grava', async () => {
        await emTransacao(pool, async (t) => {
            await post(t, ADMIN, pre(ID1));
            await post(t, ADMIN, pre(ID2));
            await recusar(t, ID2);
            await expect(post(t, ADMIN, pre(ID2, { revisao_base: 1, documento: DOCS[ID1] }))).rejects.toMatchObject({ status: 409, codigo: 'DOCUMENTO_JA_CADASTRADO' });
            expect((await t.q('select revisao_cadastro from core.cliente where id = $1', [ID2]))[0].revisao_cadastro).toBe(1);
        });
    });
    it('RN-CORE-78 (ADR 0069 §4): o id novo do APK v1.0.28 com o documento do recusado vira o cliente vivo e herda o histórico como revisão seguinte', async () => {
        await emTransacao(pool, async (t) => {
            const { codigo_fdv: codigoY } = await post(t, VENDEDOR, pre(ID1));
            await recusar(t, ID1);
            t.publicar.mockClear();
            const r = await t.push(receberPreCadastros, VENDEDOR, [pre(ID4, { razao_social: 'Mercado Novo Ltda' })]);
            expect(r).toEqual([{ id: ID4, status: 'aceito' }]);
            // ADR 0069 item 10: o Código FDV acompanha a linhagem (X herda o de Y)
            expect((await t.q('select codigo_fdv from core.cliente where id = $1', [ID4]))[0].codigo_fdv).toBe(codigoY);
            expect((await t.q('select deleted_at is not null as apagado from core.cliente where id = $1', [ID1]))[0].apagado).toBe(true);
            expect((await t.q('select status_cadastro, revisao_cadastro from core.cliente where id = $1', [ID4]))[0]).toEqual({ status_cadastro: 'pendente', revisao_cadastro: 2 });
            expect((await tentativas(t, ID4)).map((x) => [x.revisao, x.resultado, x.cliente_id_original, x.campos_alterados])).toEqual([
                [1, 'recusado', ID1, []],
                [2, 'aguardando', null, ['razao_social']],
            ]);
            expect(await tentativas(t, ID1)).toEqual([]);
            expect(eventos(t, EVENTO_CLIENTE_PRE_CADASTRADO.nome).map((c) => c[1].cliente_id)).toEqual([ID4]);
            const aud = await t.q("select depois from plataforma.auditoria where acao = 'cliente.recusado_substituido' and entidade_id = $1", [ID1]);
            expect(aud.map((a) => a.depois)).toEqual([{ substituido_por: ID4, regra: 'RN-CORE-78' }]);
            expect(await t.q('select 1 from core.carteira where cliente_id = $1 and usuario_id = $2 and deleted_at is null', [ID4, A.usuarios.vendedor1])).toHaveLength(1);
        });
    });
    it('RN-CORE-04 (ADR 0069 §3): o id novo com o documento do recusado de outra carteira dá 403 FORA_DA_CARTEIRA no push e na rota, sem gravar nada', async () => {
        await emTransacao(pool, async (t) => {
            const { codigo_fdv: codigoY } = await post(t, VENDEDOR, pre(ID1));
            await recusar(t, ID1);
            t.publicar.mockClear();
            expect(await t.push(receberPreCadastros, VENDEDOR_2, [pre(ID4)])).toMatchObject([{ id: ID4, status: 'rejeitado', codigo: 'FORA_DA_CARTEIRA' }]);
            await expect(post(t, VENDEDOR_2, pre(ID4))).rejects.toMatchObject({ status: 403, codigo: 'FORA_DA_CARTEIRA' });
            // Y segue vivo, com o Código FDV, as tentativas e a carteira; X não existe
            expect((await t.q('select status_cadastro, revisao_cadastro, codigo_fdv, deleted_at from core.cliente where id = $1', [ID1]))[0]).toEqual({ status_cadastro: 'recusado', revisao_cadastro: 1, codigo_fdv: codigoY, deleted_at: null });
            expect(await t.q('select 1 from core.cliente where id = $1', [ID4])).toHaveLength(0);
            expect(await tentativas(t, ID1)).toHaveLength(1);
            expect(await t.q('select 1 from core.carteira where usuario_id = $1 and cliente_id = any($2::uuid[])', [A.usuarios.vendedor2, [ID1, ID4]])).toHaveLength(0);
            expect(await t.q("select 1 from plataforma.auditoria where acao = 'cliente.recusado_substituido' and entidade_id = $1", [ID1])).toHaveLength(0);
            expect(t.publicar).not.toHaveBeenCalled();
            // o dono da carteira continua substituindo
            expect(await t.push(receberPreCadastros, VENDEDOR, [pre(ID4)])).toEqual([{ id: ID4, status: 'aceito' }]);
            expect((await t.q('select revisao_cadastro, codigo_fdv from core.cliente where id = $1', [ID4]))[0]).toEqual({ revisao_cadastro: 2, codigo_fdv: codigoY });
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
            const e = await post(t, { id: B.usuarios.admin, perfil: 'admin' }, pre(ID1), B.tenantId).catch((x) => x);
            expect(e).toMatchObject({ status: 409, codigo: 'CADASTRO_INDISPONIVEL', message: MENSAGENS_ERRO_PRE_CADASTRO.CADASTRO_INDISPONIVEL });
            expect(String(e.message)).not.toMatch(/outro|existe/i);
            await t.trocarTenant(A.tenantId);
            await t.q('update core.cliente set deleted_at = now() where id = $1', [ID1]);
            await expect(post(t, ADMIN, pre(ID1, { documento: DOCS[ID2] }))).rejects.toMatchObject({ status: 409, codigo: 'CADASTRO_INDISPONIVEL' });
        });
    });
    /** Corrida real (duas conexões): a 1ª grava sem confirmar; a 2ª passa da conferência, espera no índice e recebe o 23505. */
    async function corrida(primeiro, segundo) {
        const c1 = await pool.connect();
        const ids = [String(primeiro.id), String(segundo.id)];
        try {
            await c1.query('begin');
            await definirTenant(c1, A.tenantId);
            await c1.query("insert into core.cliente (id, tenant_id, razao_social, documento, origem_cadastro, status_cadastro, revisao_cadastro) values ($1, plataforma.tenant_atual(), 'Corrida', $2, 'bko', 'pendente', 1)", [primeiro.id, primeiro.documento]);
            let resultado;
            await emTransacao(pool, async (t) => {
                const pid = (await t.q('select pg_backend_pid() as pid'))[0].pid;
                const pedido = post(t, ADMIN, segundo).then((r) => r, (e) => e);
                for (let i = 0; i < 100; i++) {
                    const espera = (await admin.query('select wait_event_type as w from pg_stat_activity where pid = $1', [pid])).rows[0]?.w;
                    if (espera === 'Lock')
                        break;
                    await new Promise((r) => setTimeout(r, 50));
                }
                await c1.query('commit');
                resultado = await pedido;
            });
            return resultado;
        }
        finally {
            await c1.query('rollback').catch(() => undefined);
            c1.release();
            await admin.query('delete from core.cliente_pre_cadastro_tentativa where cliente_id = any($1::uuid[])', [ids]);
            await admin.query('delete from core.carteira where cliente_id = any($1::uuid[])', [ids]);
            await admin.query('delete from core.cliente where id = any($1::uuid[])', [ids]);
        }
    }
    it('RN-CORE-78 (ADR 0069 §5): 23505 de cliente_pkey em corrida no mesmo tenant devolve ja_existia', async () => {
        const r = await corrida({ id: ID1, documento: DOCS[ID1] }, pre(ID1));
        expect(r).toEqual({ id: ID1, status_cadastro: 'pendente', revisao: 1, ja_existia: true, codigo_fdv: FDV });
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
    it('RN-CORE-78 (ADR 0069 item 10): o Código FDV é gerado pelo banco e só de leitura: no corpo da rota ou do push dá 422 CODIGO_FDV_SOMENTE_LEITURA', async () => {
        await emTransacao(pool, async (t) => {
            await expect(post(t, ADMIN, pre(ID1, { codigo_fdv: '00001' }))).rejects.toMatchObject({ status: 422, codigo: 'CODIGO_FDV_SOMENTE_LEITURA', message: MENSAGENS_ERRO_PRE_CADASTRO.CODIGO_FDV_SOMENTE_LEITURA });
            expect(await t.q('select 1 from core.cliente where id = $1', [ID1])).toHaveLength(0);
            expect(await t.push(receberPreCadastros, VENDEDOR, [pre(ID1, { codigo_fdv: null })])).toMatchObject([{ id: ID1, status: 'rejeitado', codigo: 'CODIGO_FDV_SOMENTE_LEITURA' }]);
            const a = await post(t, ADMIN, pre(ID1));
            const b = await post(t, ADMIN, pre(ID2));
            expect(Number(b.codigo_fdv)).toBe(Number(a.codigo_fdv) + 1);
        });
    });
    it('RN-CORE-78 (ADR 0069 item 10, decisão 1 B): pull e Cliente 360 levam o Código FDV em todo cliente, inclusive o do ERP; motivo e erros da recusa só ao vendedor', async () => {
        await emTransacao(pool, async (t) => {
            const { codigo_fdv } = await post(t, VENDEDOR, pre(ID1));
            await recusar(t, ID1);
            // cliente do ERP na carteira do vendedor: o banco numera também este insert (decisão 1 B)
            await t.q("insert into core.cliente (id, tenant_id, razao_social, external_id, origem_cadastro) values ($1, plataforma.tenant_atual(), 'Cliente do ERP', 'C-ERP-1', 'erp')", [ID3]);
            await t.q("insert into core.carteira (tenant_id, cliente_id, usuario_id, papel) values (plataforma.tenant_atual(), $1, $2, 'vendedor')", [ID3, VENDEDOR.id]);
            const puxar = provedoresSyncCore.find((p) => p.entidade.nome === 'cliente').puxar;
            const linhas = (await puxar(t.ctx(VENDEDOR), { desde: null, ate: new Date(Date.now() + 60_000).toISOString(), limite: 500 }));
            expect(linhas.find((l) => l.id === ID1)).toMatchObject({ codigo_fdv, external_id: null, motivo_recusa: expect.any(String), erros_recusa: [{ campo: 'inscricao_estadual' }] });
            const get = rotasDeClientes.find((r) => r.metodo === 'GET' && r.caminho === 'clientes/:id');
            const ficha = async (u) => (await get.executar({ ...t.ctx(u, { params: { id: ID1 } }), params: { id: ID1 }, usuariosVisiveis: async () => 'tenant' }));
            expect((await ficha(VENDEDOR)).cliente).toMatchObject({ codigo_fdv, external_id: null, motivo_recusa: expect.any(String) });
            expect((await ficha(ADMIN)).cliente).toMatchObject({ codigo_fdv, motivo_recusa: null, erros_recusa: null });
            // o cliente do ERP também traz o Código FDV, no pull e no Cliente 360
            const erp = linhas.find((l) => l.id === ID3);
            expect(erp).toMatchObject({ external_id: 'C-ERP-1', codigo_fdv: FDV });
            expect(erp.codigo_fdv).not.toBe(codigo_fdv);
            for (const l of linhas)
                expect(l.codigo_fdv).toEqual(FDV);
            const fichaErp = (await get.executar({ ...t.ctx(VENDEDOR, { params: { id: ID3 } }), params: { id: ID3 }, usuariosVisiveis: async () => 'tenant' }));
            expect(fichaErp.cliente).toMatchObject({ external_id: 'C-ERP-1', codigo_fdv: erp.codigo_fdv });
        });
    });
    it('RN-CORE-77 (ADR 0069 item 10): a coordenada digitada no pré-cadastro e na correção grava coordenada_origem = manual; sem coordenada fica nula', async () => {
        await emTransacao(pool, async (t) => {
            await post(t, ADMIN, pre(ID1, { latitude: -3.1, longitude: -60.02 }));
            await post(t, ADMIN, pre(ID2));
            const origem = async (id) => (await t.q('select coordenada_origem from core.cliente where id = $1', [id]))[0].coordenada_origem;
            expect(await origem(ID1)).toBe('manual');
            expect(await origem(ID2)).toBeNull();
            await recusar(t, ID2);
            await post(t, ADMIN, pre(ID2, { revisao_base: 1, latitude: -3.2, longitude: -60.1 }));
            expect(await origem(ID2)).toBe('manual');
        });
    });
    it('RN-INT-22: o Hub lê só os pendentes sem código, em ordem de chegada e paginados, com a revisão e o hash dos dados atuais', async () => {
        await emTransacao(pool, async (t) => {
            const lista = (entrada = {}) => consultaClientesPreCadastroSemErp.executar(consultaClientesPreCadastroSemErp.consulta.entrada.parse(entrada), { db: t.c });
            for (const id of [ID1, ID2, ID3]) {
                await post(t, ADMIN, pre(id, { origem: 'bko', razao_social: `Cliente ${id.slice(-1)}`, latitude: -3.1, longitude: -60.02 }));
            }
            await t.q("update core.cliente set created_at = created_at - interval '2 minute' where id = $1", [ID2]);
            await recusar(t, ID3);
            expect((await lista()).clientes.map((x) => x.cliente_id)).toEqual([ID2, ID1]);
            const p1 = await lista({ limite: 1 });
            expect(p1.clientes).toHaveLength(1);
            expect(p1.proximo).toBe(p1.clientes[0].cliente_id);
            expect(p1.clientes[0]).toMatchObject({ latitude: -3.1, longitude: -60.02, cidade: 'Manaus', recebido_em: expect.any(String), revisao: 1, codigo_fdv: FDV });
            expect(p1.clientes[0].hash).toBe(hashPreCadastro(await comFilial(t, ID2, pre(ID2, { razao_social: 'Cliente 2', latitude: -3.1, longitude: -60.02 }))));
            const p2 = await lista({ limite: 1, depois_de: p1.proximo });
            expect(p2.clientes.map((x) => x.cliente_id)).toEqual([ID1]);
            expect(p2.proximo).toBeNull();
            await t.q("update core.cliente set external_id = 'ERP-1' where id = $1", [ID1]);
            expect((await lista()).clientes.map((x) => x.cliente_id)).toEqual([ID2]);
            // a revisão nova volta à fila com a revisão e o hash novos
            await post(t, ADMIN, pre(ID3, { origem: 'bko', revisao_base: 1, razao_social: 'Cliente 3 corrigido', latitude: -3.1, longitude: -60.02 }));
            const r3 = (await lista()).clientes.find((x) => x.cliente_id === ID3);
            expect(r3).toMatchObject({ revisao: 2, hash: hashPreCadastro(await comFilial(t, ID3, pre(ID3, { razao_social: 'Cliente 3 corrigido', latitude: -3.1, longitude: -60.02 }))) });
        });
    });
    it('RN-INT-22 (v1.0.34, aditivo): o Hub recebe o vendedor_external_id do vendedor que fez o pré-cadastro (autor da 1ª tentativa), mesmo com a carteira movida ou encerrada; sem código ou autor não vendedor, null; o hash não muda; outro tenant não vaza', async () => {
        await emTransacao(pool, async (t) => {
            await post(t, VENDEDOR, pre(ID1));
            await post(t, ADMIN, pre(ID2, { origem: 'bko' }));
            const achar = async (id) => (await hub(t)).clientes.find((x) => x.cliente_id === id);
            await t.q('update core.usuario set external_id = null where id = $1', [A.usuarios.vendedor1]);
            const antes = await achar(ID1);
            expect(antes.vendedor_external_id).toBeNull();
            await t.q("update core.usuario set external_id = 'V-77' where id = $1", [A.usuarios.vendedor1]);
            const depois = await achar(ID1);
            expect(depois.vendedor_external_id).toBe('V-77');
            expect(depois.hash).toBe(antes.hash);
            await t.q("update core.carteira set fim = current_date - 1 where cliente_id = $1", [ID1]);
            await t.q("insert into core.carteira (tenant_id, cliente_id, usuario_id, papel) values (plataforma.tenant_atual(), $1, $2, 'vendedor')", [ID1, A.usuarios.vendedor2]);
            expect((await achar(ID1)).vendedor_external_id).toBe('V-77');
            expect(depois.hash).toBe(hashPreCadastro(await comFilial(t, ID1, pre(ID1))));
            expect((await achar(ID2)).vendedor_external_id).toBeNull();
            // revisão 1 do BKO e revisão 2 de vendedor: o autor da 1ª tentativa não é vendedor, então null
            await recusar(t, ID2);
            await post(t, ADMIN, pre(ID2, { origem: 'bko', revisao_base: 1, razao_social: 'Cliente 2 corrigido' }));
            await t.q("update core.cliente_pre_cadastro_tentativa set corrigido_por = $2, corrigido_por_perfil = 'vendedor' where cliente_id = $1 and revisao = 2", [ID2, A.usuarios.vendedor1]);
            expect((await achar(ID2)).vendedor_external_id).toBeNull();
            await t.trocarTenant(B.tenantId);
            expect((await hub(t)).clientes).toEqual([]);
        });
    });
});
