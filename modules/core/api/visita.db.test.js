/**
 * T-0018 × Postgres real (fixture dois-tenants, papel macuxi_app, RLS): push de check-in e checkout com o servidor
 * revalidando tudo (RN-CORE-10/11/12/13/14), idempotência pelo UUID do aparelho (modo avião: reenvio do lote não
 * duplica), pull de rota/parada/motivo/visita por escopo de usuários (RN-CORE-04/05), rotas do BKO, coordenada
 * sugerida e motivos. Pula sem Docker/Postgres (aviso no fim); com MACUXI_PG_EXIGIR=1 (CI) falha.
 * O escopo vem dos serviços REAIS (`carteiraDoUsuario`, `usuariosVisiveisDoUsuario`); `tx.publicar` e
 * `tx.registrarArquivo` são simulados aqui (a versão real é do `apps/api` e tem teste próprio).
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import { ErroNaoEncontrado, ErroRegraNegocio } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CheckinVisitaSchema, CheckoutVisitaSchema, MotivoSyncSchema, ParametroSyncSchema, RotaParadaSyncSchema, RotaSyncSchema, VisitaSyncSchema } from '../contracts';
import { resolverPerfil, matrizDeFabrica, perfilDeFabrica } from '@macuxi/platform-sdk';
import { manifest } from '../manifest';
import { dataLocal } from '../domain';
import { carteiraDoUsuario } from './carteira';
import { rotasDeRotasEVisitas } from './rotas';
import { provedoresSyncCore } from './sync';
import { usuariosVisiveisDoUsuario } from './usuarios-visiveis';
const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const U = A.usuarios;
const C = A.clientes;
const DIA_MS = 86_400_000;
const somarDias = (data, n) => new Date(Date.parse(`${data}T12:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);
/** Relógio da suíte: UMA linha do tempo (RN-CORE-11 depende do dia do fuso do tenant, Manaus UTC-4). Fora da madrugada
 *  de Manaus (00:00-04:00 locais) é o relógio real; na madrugada, `hora(3)` cairia no dia anterior do fuso e o cenário
 *  "outro cliente no mesmo dia" viraria "esquecida de ontem", então o relógio vai para as 12:00 de Manaus do mesmo dia. */
const AGORA = (() => {
    const real = new Date();
    const horaEmManaus = (real.getUTCHours() + 20) % 24;
    if (horaEmManaus >= 4)
        return real;
    const dia = new Date(real.getTime() - 4 * 3_600_000).toISOString().slice(0, 10);
    return new Date(`${dia}T12:00:00-04:00`);
})();
const HOJE = AGORA.toISOString().slice(0, 10);
/** Segunda-feira a mais de 40 dias de qualquer "hoje" próximo: fora das janelas do pull (`data >= hoje - 40`) e sem limite superior. */
const SEMANA = (() => {
    const base = somarDias(HOJE, 400);
    const dow = new Date(`${base}T12:00:00Z`).getUTCDay();
    return somarDias(base, (8 - dow) % 7);
})();
const SEMANA_TER = somarDias(SEMANA, 1);
const SEMANA_QUA = somarDias(SEMANA, 2);
const SEMANA_QUI = somarDias(SEMANA, 3);
const SEMANA_LONGE = somarDias(SEMANA, 91); // segunda-feira, a mais de 30 dias à frente da SEMANA
const LIMPEZA_DESDE = somarDias(HOJE, 300);
const id = (n) => `0e300000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PERTO = { lat: -3.1019, lng: -60.025 }; // coordenada de c1
const LONGE = { lat: -3.11, lng: -60.025 }; // ~900 m de c1
const hora = (h) => new Date(AGORA.getTime() - h * 3_600_000).toISOString();
describe.skipIf(semBanco())('Core T-0018 × Postgres: push de visita, rotas, motivos e coordenada sugerida', () => {
    let pool;
    let acesso;
    const eventos = [];
    const usuario = (uid, perfil, tenant = A.tenantId) => ({ id: uid, tenant_id: tenant, perfil });
    const vendedor1 = usuario(U.vendedor1, 'vendedor');
    const vendedor2 = usuario(U.vendedor2, 'vendedor');
    const promotor = usuario(U.promotor, 'promotor');
    const supervisor = usuario(U.supervisor, 'supervisor');
    const gerente = usuario(U.gerente, 'gerente');
    const analista = usuario(U.analista, 'analista');
    const vendedorB = usuario(B.usuarios.vendedor, 'vendedor', B.tenantId);
    /** RN-CORE-52: perfil de fábrica (a ação `visita.checkin_fora_de_rota` vem ligada); `semForaDeRota` simula o BKO desligando a ação. */
    const perfisSemForaDeRota = new Set();
    function perfilDoTeste(u, semForaDeRota) {
        const matriz = matrizDeFabrica([manifest]);
        const base = perfilDeFabrica(u.perfil);
        return resolverPerfil(semForaDeRota ? { ...base, sobreposicoes: [{ chave: 'visita.checkin_fora_de_rota', concedida: false }] } : base, matriz);
    }
    function ctx(u, modulos = ['core', 'vendedor']) {
        const tx = {
            publicar: async (def, payload) => {
                eventos.push({ nome: def.nome, payload });
                return {};
            },
            // simula tx.registrarArquivo: linha 'aguardando', idempotente pelo id, 409 se for de outra entidade
            registrarArquivo: async (a, c) => {
                const r = await c.query('select entidade_id from plataforma.arquivo where id = $1', [a.id]);
                if (r.rows[0]) {
                    if (r.rows[0].entidade_id !== a.entidade_id)
                        throw new ErroRegraNegocio('ARQUIVO_JA_REFERENCIADO', 'Este arquivo já pertence a outro registro.');
                    return { criado: false };
                }
                await c.query(`insert into plataforma.arquivo (id, tenant_id, modulo, finalidade, entidade, entidade_id, cliente_id, enviado_por) values ($1, plataforma.tenant_atual(), 'core', $2, $3, $4, $5, $6)`, [a.id, a.finalidade, a.entidade, a.entidade_id, a.cliente_id ?? null, u.id]);
                return { criado: true };
            },
        };
        return {
            usuario: { ...u, modulos, perfis: [perfilDoTeste(u, perfisSemForaDeRota.has(u.id))] },
            requestId: 'req-teste',
            agora: () => AGORA,
            fuso: () => 'America/Manaus',
            comTenant: (fn) => comTenant(pool, u.tenant_id, (c) => fn(c, { publicar: tx.publicar, registrarArquivo: (a) => tx.registrarArquivo(a, c) })),
            carteira: () => carteiraDoUsuario(u, acesso),
            usuariosVisiveis: () => usuariosVisiveisDoUsuario(u, acesso),
        };
    }
    const prov = (nome) => provedoresSyncCore.find((p) => p.entidade.nome === nome);
    const pedido = () => ({ desde: null, ate: new Date(Date.now() + 60_000).toISOString(), limite: 1001 });
    const puxar = (nome, u) => prov(nome).puxar(ctx(u), pedido());
    const item = (entidade, uid, payload) => ({ entidade, id: uid, operacao: 'upsert', payload });
    const checkin = (u, vid, over = {}, modulos) => prov('visita').receber(ctx(u, modulos), [item('visita', vid, CheckinVisitaSchema.parse({ id: vid, cliente_id: C.c1, checkin_em: AGORA.toISOString(), ...PERTO, ...over }))]);
    const checkout = (u, cmd, vid, over = {}, modulos, semSchema = false) => {
        const bruto = { id: cmd, visita_id: vid, checkout_em: AGORA.toISOString(), resultado: 'sem_pedido', motivo_texto: 'Sem necessidade hoje', etapas: [], ...over };
        return prov('visita_checkout').receber(ctx(u, modulos), [item('visita_checkout', cmd, semSchema ? bruto : CheckoutVisitaSchema.parse(bruto))]);
    };
    const linhaVisita = (vid) => comTenant(pool, A.tenantId, async (c) => (await c.query('select * from core.visita where id = $1', [vid])).rows[0]);
    const contar = (sql, v = []) => comTenant(pool, A.tenantId, async (c) => Number((await c.query(sql, v)).rows[0].n));
    const rota = (metodo, caminho) => rotasDeRotasEVisitas.find((r) => r.metodo === metodo && r.caminho === caminho);
    const chamar = (metodo, caminho, u, extra = {}) => {
        const r = rota(metodo, caminho);
        return r.executar({ ...ctx(u), corpo: r.corpo ? r.corpo.parse(extra.corpo ?? {}) : {}, query: r.query ? r.query.parse(extra.query ?? {}) : {}, params: r.params ? r.params.parse(extra.params ?? {}) : {} }); // eslint-disable-line @typescript-eslint/no-explicit-any
    };
    const limpar = async () => {
        await comTenant(pool, A.tenantId, async (c) => {
            await c.query("delete from core.visita_etapa where visita_id::text like '0e300000%'");
            await c.query("delete from core.visita where id::text like '0e300000%'");
            await c.query("delete from plataforma.arquivo where id::text like '0e300000%'");
            await c.query('delete from core.rota_parada where data >= $1', [LIMPEZA_DESDE]);
            await c.query('delete from core.rota where data >= $1', [LIMPEZA_DESDE]);
            await c.query("delete from core.carteira where id::text like '0e300000%'");
            await c.query("update core.carteira set frequencia_semanas = null, dia_semana = null where cliente_id = $1 and usuario_id = $2 and papel = 'promotor'", [C.c1, U.promotor]);
            await c.query("delete from core.cliente where id::text like '0e300000%'");
            await c.query("delete from core.motivo where id::text like '0e300000%'");
        });
    };
    beforeAll(async () => {
        pool = new pg.Pool({ connectionString: banco().urlApp, max: 6 });
        acesso = {
            comTenant: (tenantId, fn) => comTenant(pool, tenantId, (c) => fn(c)),
            semTenant: (fn) => fn({ query: async () => ({ rows: [], rowCount: 0 }) }),
        };
        await limpar();
    });
    afterAll(async () => {
        if (pool)
            await limpar();
        await pool?.end();
    });
    describe('check-in (RN-CORE-10, RN-CORE-13)', () => {
        it('RN-CORE-10: dentro do raio é aceito, grava distância e data local; reenviar o mesmo id não duplica (modo avião)', async () => {
            const vid = id(1);
            expect(await checkin(vendedor1, vid)).toEqual([{ id: vid, status: 'aceito' }]);
            expect(await checkin(vendedor1, vid)).toEqual([{ id: vid, status: 'aceito' }]);
            expect(await contar('select count(*) as n from core.visita where id = $1', [vid])).toBe(1);
            const v = await linhaVisita(vid);
            expect(v).toMatchObject({ fora_do_raio: false, sem_gps: false, usuario_id: U.vendedor1, cliente_id: C.c1, checkout_em: null });
            expect(v.distancia_m).toBeLessThan(200);
            expect(eventos.filter((e) => e.nome === 'core.visita.checkin@1' && e.payload.visita_id === vid)).toHaveLength(1); // o reenvio não republica
            await checkout(vendedor1, id(101), vid); // libera o único aberto para os próximos casos
        });
        it('RN-CORE-10: fora do raio SEM justificativa é rejeitado e nada é gravado', async () => {
            const vid = id(2);
            const r = await checkin(vendedor1, vid, LONGE);
            expect(r[0]).toMatchObject({ status: 'rejeitado', codigo: 'RN-CORE-10' });
            expect(await contar('select count(*) as n from core.visita where id = $1', [vid])).toBe(0);
        });
        it('RN-CORE-10: fora do raio COM justificativa é aceito e fica sinalizado', async () => {
            const vid = id(3);
            expect(await checkin(vendedor1, vid, { ...LONGE, justificativa_fora_raio: 'Cliente atendeu no depósito ao lado' })).toEqual([{ id: vid, status: 'aceito' }]);
            expect(await linhaVisita(vid)).toMatchObject({ fora_do_raio: true, justificativa_fora_raio: 'Cliente atendeu no depósito ao lado' });
            expect((await linhaVisita(vid)).distancia_m).toBeGreaterThan(200);
            await checkout(vendedor1, id(103), vid);
        });
        it('RN-CORE-10: o raio vem do parâmetro do tenant (plataforma.parametro): com 2000 m o check-in a ~900 m é aceito sem justificativa, e o pull entrega só esse parâmetro', async () => {
            const mudar = (v) => comTenant(pool, A.tenantId, (c) => c.query("update plataforma.parametro set valor = $1::jsonb where modulo = 'core' and chave = 'checkin.raio_m'", [JSON.stringify(v)]));
            const vid = id(900);
            await mudar(2000);
            try {
                expect(await checkin(vendedor1, vid, LONGE)).toEqual([{ id: vid, status: 'aceito' }]);
                expect(await linhaVisita(vid)).toMatchObject({ fora_do_raio: false });
                const linhas = await puxar('parametro', vendedor1);
                for (const l of linhas)
                    ParametroSyncSchema.parse(l);
                expect(linhas.map((l) => l.chave)).toEqual(['checkin.raio_m']);
                expect(linhas[0].valor).toBe(2000);
                expect(await puxar('parametro', vendedorB)).not.toContainEqual(expect.objectContaining({ valor: 2000 }));
            }
            finally {
                await mudar(200);
            }
            await checkout(vendedor1, id(901), vid);
        });
        it('RN-CORE-13: sem GPS o atendimento segue, marcado sem_gps e sem coordenada gravada', async () => {
            const vid = id(4);
            expect(await checkin(vendedor1, vid, { lat: null, lng: null })).toEqual([{ id: vid, status: 'aceito' }]);
            expect(await linhaVisita(vid)).toMatchObject({ sem_gps: true, checkin_lat: null, checkin_lng: null, distancia_m: null, fora_do_raio: false });
            await checkout(vendedor1, id(104), vid);
        });
        it('RN-CORE-10: cliente sem coordenada (c3) aceita o 1º check-in e sugere a coordenada ao BKO', async () => {
            const vid = id(5);
            expect(await checkin(vendedor1, vid, { cliente_id: C.c3, lat: -3.29, lng: -60.62 })).toEqual([{ id: vid, status: 'aceito' }]);
            expect(await linhaVisita(vid)).toMatchObject({ sugere_coordenada: true, fora_do_raio: false });
            await checkout(vendedor1, id(105), vid);
        });
        it('RN-CORE-52: sem a ação visita.checkin_fora_de_rota, cliente fora da rota do dia é rejeitado (CHECKIN_FORA_DE_ROTA); na rota ou com a ação passa', async () => {
            const dia = dataLocal(AGORA, 'America/Manaus');
            const rotaId = id(950);
            const paradaId = id(951);
            // a fixture já põe c1 na rota de HOJE do vendedor-1 (A.paradas.v1c1): tira a parada do dia (soft delete) e devolve no fim
            const ocultas = await comTenant(pool, A.tenantId, async (c) => (await c.query('update core.rota_parada set deleted_at = now() where usuario_id = $1 and data = $2::date and cliente_id = $3 and deleted_at is null returning id', [vendedor1.id, dia, C.c1])).rows.map((r) => r.id));
            const devolver = () => comTenant(pool, A.tenantId, (c) => c.query('update core.rota_parada set deleted_at = null where id = any($1::uuid[])', [ocultas]));
            perfisSemForaDeRota.add(vendedor1.id);
            try {
                const sem = id(952);
                expect((await checkin(vendedor1, sem, { cliente_id: C.c1 }))[0]).toMatchObject({ status: 'rejeitado', codigo: 'CHECKIN_FORA_DE_ROTA' });
                expect(await linhaVisita(sem)).toBeUndefined();
                if (ocultas.length > 0)
                    await devolver();
                else
                    await comTenant(pool, A.tenantId, async (c) => {
                        await c.query("insert into core.rota (id, tenant_id, usuario_id, data, situacao, origem) values ($1, $2, $3, $4, 'publicada', 'bko')", [rotaId, A.tenantId, vendedor1.id, dia]);
                        await c.query('insert into core.rota_parada (id, tenant_id, rota_id, usuario_id, data, cliente_id, sequencia) values ($1, $2, $3, $4, $5, $6, 1)', [paradaId, A.tenantId, rotaId, vendedor1.id, dia, C.c1]);
                    });
                const na = id(953);
                expect(await checkin(vendedor1, na, { cliente_id: C.c1 })).toEqual([{ id: na, status: 'aceito' }]);
                await checkout(vendedor1, id(954), na);
            }
            finally {
                perfisSemForaDeRota.delete(vendedor1.id);
                await devolver();
                await comTenant(pool, A.tenantId, async (c) => {
                    await c.query('delete from core.rota_parada where id = $1', [paradaId]);
                    await c.query('delete from core.rota where id = $1', [rotaId]);
                });
            }
        });
        it('RN-CORE-04: cliente fora da carteira (c2 do vendedor-2) é rejeitado; o promotor só faz check-in na sua carteira', async () => {
            expect((await checkin(vendedor1, id(6), { cliente_id: C.c2 }))[0]).toMatchObject({ status: 'rejeitado', codigo: 'FORA_DA_CARTEIRA' });
            expect((await checkin(promotor, id(7), { cliente_id: C.c3 }, ['core']))[0]).toMatchObject({ status: 'rejeitado', codigo: 'FORA_DA_CARTEIRA' });
        });
        it('idempotência: o mesmo id enviado por OUTRO usuário é ID_EM_USO (não vaza nem sobrescreve)', async () => {
            const vid = id(8);
            await checkin(vendedor1, vid);
            expect((await checkin(promotor, vid, {}, ['core']))[0]).toMatchObject({ status: 'rejeitado', codigo: 'ID_EM_USO' });
            await checkout(vendedor1, id(108), vid);
        });
        it('id do item diferente do id do payload é PAYLOAD_INVALIDO', async () => {
            const r = await prov('visita').receber(ctx(vendedor1), [item('visita', id(9), CheckinVisitaSchema.parse({ id: id(10), cliente_id: C.c1, checkin_em: AGORA.toISOString() }))]);
            expect(r[0]).toMatchObject({ status: 'rejeitado', codigo: 'PAYLOAD_INVALIDO' });
        });
    });
    describe('um atendimento aberto (RN-CORE-11)', () => {
        it('RN-CORE-11: novo check-in em outro cliente fecha o anterior como auto/nao_finalizado e publica o checkout automático', async () => {
            await checkin(vendedor1, id(20), { checkin_em: hora(2) });
            await checkin(vendedor1, id(21), { cliente_id: C.c3, lat: -3.29, lng: -60.62, checkin_em: hora(1) });
            expect(await linhaVisita(id(20))).toMatchObject({ resultado: 'nao_finalizado', fechada_por: 'auto' });
            expect(await linhaVisita(id(21))).toMatchObject({ checkout_em: null });
            expect(await contar('select count(*) as n from core.visita where usuario_id = $1 and checkout_em is null and deleted_at is null', [U.vendedor1])).toBe(1);
            expect(eventos.some((e) => e.nome === 'core.visita.checkout@1' && e.payload.visita_id === id(20) && e.payload.fechada_por === 'auto')).toBe(true);
        });
        it('RN-CORE-11: o esquecido de ontem fecha na virada do dia do fuso do tenant (Manaus) ao entrar o check-in de hoje', async () => {
            const ontem = hora(26);
            await checkout(vendedor1, id(122), id(21)); // fecha a de c3 do caso anterior
            await checkin(vendedor1, id(22), { checkin_em: ontem });
            await checkin(vendedor1, id(23), { cliente_id: C.c3, lat: -3.29, lng: -60.62 });
            const v = await linhaVisita(id(22));
            expect(v).toMatchObject({ resultado: 'nao_finalizado', fechada_por: 'auto' });
            expect(new Date(v.checkout_em).getTime()).toBeGreaterThan(new Date(ontem).getTime());
            expect(new Date(v.checkout_em).getTime()).toBeLessThanOrEqual(AGORA.getTime());
            await checkout(vendedor1, id(123), id(23));
        });
        it('RN-CORE-11: o checkout do usuário vence o fechamento automático (é o fato real)', async () => {
            await checkin(vendedor1, id(24), { checkin_em: hora(3) });
            await checkin(vendedor1, id(25), { cliente_id: C.c3, lat: -3.29, lng: -60.62, checkin_em: hora(2) }); // fecha id(24) como auto
            expect((await checkout(vendedor1, id(124), id(24), { checkout_em: hora(2.5), resultado: 'sem_pedido', motivo_texto: 'Fechou o dia sem compra' }))[0]).toEqual({ id: id(124), status: 'aceito' });
            expect(await linhaVisita(id(24))).toMatchObject({ resultado: 'sem_pedido', fechada_por: 'usuario', checkout_id: id(124) });
            await checkout(vendedor1, id(125), id(25));
        });
    });
    describe('checkout (RN-CORE-12, RN-CORE-14)', () => {
        it('RN-CORE-12: com Vendedor efetivo, sem_pedido sem motivo é rejeitado; com motivo de não venda é aceito; reenvio do comando não duplica', async () => {
            const vid = id(30);
            await checkin(vendedor1, vid);
            expect((await checkout(vendedor1, id(130), vid, { motivo_texto: null }, undefined, true))[0]).toMatchObject({ status: 'rejeitado', codigo: 'RN-CORE-12' });
            const m = await comTenant(pool, A.tenantId, async (c) => (await c.query("select id from core.motivo where tipo = 'nao_venda' and deleted_at is null order by ordem limit 1")).rows[0].id);
            expect(await checkout(vendedor1, id(131), vid, { motivo_id: m, motivo_texto: null })).toEqual([{ id: id(131), status: 'aceito' }]);
            expect(await checkout(vendedor1, id(131), vid, { motivo_id: m, motivo_texto: null })).toEqual([{ id: id(131), status: 'aceito' }]);
            expect(await linhaVisita(vid)).toMatchObject({ resultado: 'sem_pedido', motivo_id: m, fechada_por: 'usuario', checkout_id: id(131) });
            expect(eventos.filter((e) => e.nome === 'core.visita.checkout@1' && e.payload.visita_id === vid)).toHaveLength(1);
        });
        it('checkout de visita já encerrada por outro comando é conflito; visita de outro usuário é VISITA_NAO_ENCONTRADA (mesma resposta de inexistente)', async () => {
            const r = await checkout(vendedor1, id(132), id(30), { motivo_texto: 'Outra tentativa' });
            expect(r[0]).toMatchObject({ status: 'conflito' });
            expect((await checkout(vendedor2, id(133), id(30)))[0]).toMatchObject({ status: 'rejeitado', codigo: 'VISITA_NAO_ENCONTRADA' });
            expect((await checkout(vendedor1, id(134), id(999)))[0]).toMatchObject({ status: 'rejeitado', codigo: 'VISITA_NAO_ENCONTRADA' });
        });
        it('RN-CORE-12: promotor (sem Vendedor efetivo) fecha como "atendido" sem motivo; "sem_pedido" é rejeitado', async () => {
            const vid = id(31);
            await checkin(promotor, vid, {}, ['core']);
            expect((await checkout(promotor, id(135), vid, { resultado: 'sem_pedido' }, ['core']))[0]).toMatchObject({ status: 'rejeitado', codigo: 'RN-CORE-12' });
            expect(await checkout(promotor, id(136), vid, { resultado: 'atendido', motivo_texto: null }, ['core'])).toEqual([{ id: id(136), status: 'aceito' }]);
            expect(await linhaVisita(vid)).toMatchObject({ resultado: 'atendido', fechada_por: 'usuario' });
        });
        it('RN-CORE-12: as etapas do checkout são gravadas uma vez (idempotente)', async () => {
            const vid = id(32);
            await checkin(vendedor1, vid);
            await checkout(vendedor1, id(137), vid, { etapas: [{ modulo: 'pesquisa', etapa: 'pesquisa.preco', situacao: 'concluida', referencia_id: id(500) }] });
            expect(await contar("select count(*) as n from core.visita_etapa where visita_id = $1 and modulo = 'pesquisa'", [vid])).toBe(1);
        });
        it('RN-CORE-14: cliente fechado sem foto ou com motivo que não é de cliente fechado é rejeitado (servidor revalida mesmo com app adulterado)', async () => {
            const vid = id(33);
            await checkin(vendedor1, vid);
            const loja = await comTenant(pool, A.tenantId, async (c) => (await c.query("select id from core.motivo where codigo = 'loja_fechada'")).rows[0].id);
            const naoVenda = await comTenant(pool, A.tenantId, async (c) => (await c.query("select id from core.motivo where tipo = 'nao_venda' and deleted_at is null limit 1")).rows[0].id);
            expect((await checkout(vendedor1, id(138), vid, { resultado: 'cliente_fechado', motivo_id: loja, motivo_texto: null }, undefined, true))[0]).toMatchObject({ status: 'rejeitado', codigo: 'RN-CORE-14' });
            expect((await checkout(vendedor1, id(139), vid, { resultado: 'cliente_fechado', motivo_id: naoVenda, foto_fachada_id: id(600), motivo_texto: null }, undefined, true))[0]).toMatchObject({ status: 'rejeitado', codigo: 'RN-CORE-14' });
            expect(await contar('select count(*) as n from plataforma.arquivo where id = $1', [id(600)])).toBe(0);
            expect(await linhaVisita(vid)).toMatchObject({ checkout_em: null });
        });
        it('RN-CORE-14: cliente fechado com motivo loja_fechada e foto persiste motivo e foto; o arquivo nasce "aguardando" e o reenvio é idempotente', async () => {
            const vid = id(33);
            const loja = await comTenant(pool, A.tenantId, async (c) => (await c.query("select id from core.motivo where codigo = 'loja_fechada'")).rows[0].id);
            const dados = { resultado: 'cliente_fechado', motivo_id: loja, foto_fachada_id: id(601), motivo_texto: null };
            expect(await checkout(vendedor1, id(140), vid, dados)).toEqual([{ id: id(140), status: 'aceito' }]);
            expect(await checkout(vendedor1, id(140), vid, dados)).toEqual([{ id: id(140), status: 'aceito' }]);
            expect(await linhaVisita(vid)).toMatchObject({ resultado: 'cliente_fechado', motivo_id: loja, foto_fachada_id: id(601), fechada_por: 'usuario' });
            const arq = await comTenant(pool, A.tenantId, async (c) => (await c.query('select situacao, finalidade, entidade, entidade_id, cliente_id, enviado_por from plataforma.arquivo where id = $1', [id(601)])).rows);
            expect(arq).toEqual([{ situacao: 'aguardando', finalidade: 'fachada', entidade: 'visita', entidade_id: vid, cliente_id: C.c1, enviado_por: U.vendedor1 }]);
            expect(eventos.find((e) => e.nome === 'core.visita.checkout@1' && e.payload.visita_id === vid)?.payload).toMatchObject({ resultado: 'cliente_fechado', motivo_codigo: 'loja_fechada', fechada_por: 'usuario' });
        });
        it('RN-CORE-14: foto já usada por outra visita rejeita só aquele item (ARQUIVO_JA_REFERENCIADO)', async () => {
            const vid = id(34);
            await checkin(vendedor1, vid);
            const loja = await comTenant(pool, A.tenantId, async (c) => (await c.query("select id from core.motivo where codigo = 'acesso_negado'")).rows[0].id);
            const r = await checkout(vendedor1, id(141), vid, { resultado: 'cliente_fechado', motivo_id: loja, foto_fachada_id: id(601), motivo_texto: null });
            expect(r[0]).toMatchObject({ status: 'rejeitado', codigo: 'ARQUIVO_JA_REFERENCIADO' });
            expect(await linhaVisita(vid)).toMatchObject({ checkout_em: null });
            await checkout(vendedor1, id(142), vid);
        });
    });
    describe('pull por escopo de usuários (RN-CORE-04, RN-CORE-05)', () => {
        it('as 4 entidades novas declaram o escopo certo e as linhas validam o schema do contrato', async () => {
            expect(prov('motivo').escopo).toBe('tenant');
            for (const n of ['rota', 'rota_parada', 'visita'])
                expect(prov(n).escopo, n).toBe('usuarios');
            for (const l of await puxar('motivo', vendedor1))
                MotivoSyncSchema.parse(l);
            for (const l of await puxar('rota', vendedor1))
                RotaSyncSchema.parse(l);
            for (const l of await puxar('rota_parada', vendedor1))
                RotaParadaSyncSchema.parse(l);
            const visitas = await puxar('visita', vendedor1);
            expect(visitas.length).toBeGreaterThan(0);
            for (const l of visitas)
                VisitaSyncSchema.parse(l);
        });
        it('RN-CORE-04: vendedor-1 só recebe as próprias visitas, rotas e paradas; o supervisor recebe a equipe e não o vendedor-2', async () => {
            const usuariosDe = (l) => [...new Set(l.map((x) => x.usuario_id))].sort();
            for (const n of ['visita', 'rota', 'rota_parada'])
                expect(usuariosDe(await puxar(n, vendedor1)), n).toEqual([U.vendedor1]);
            const sup = usuariosDe(await puxar('visita', supervisor));
            expect(sup).toContain(U.promotor);
            expect(sup).not.toContain(U.vendedor2);
            expect(usuariosDe(await puxar('visita', gerente))).toContain(U.vendedor2);
        });
        it('a visita criada pelo push chega no pull com checkout_id e foto (sobreposição da fila usa o checkout_id)', async () => {
            const l = (await puxar('visita', vendedor1)).find((x) => x.id === id(33));
            expect(l).toMatchObject({ checkout_id: id(140), foto_fachada_id: id(601), resultado: 'cliente_fechado' });
        });
        it('RN-CORE-05: vendedor do tenant B nunca recebe visita, rota ou parada do tenant A', async () => {
            for (const n of ['visita', 'rota', 'rota_parada', 'motivo']) {
                const linhas = await puxar(n, vendedorB);
                expect(linhas.some((x) => x.id.startsWith('0e300000')), n).toBe(false);
                expect(linhas.every((x) => !Object.values(A.visitas).includes(x.id) && !Object.values(A.rotas).includes(x.id)), n).toBe(true);
            }
            expect((await checkin(vendedorB, id(40), { cliente_id: C.c1 }))[0]).toMatchObject({ status: 'rejeitado', codigo: 'FORA_DA_CARTEIRA' });
            expect(await contar('select count(*) as n from core.visita where id = $1', [id(40)])).toBe(0);
        });
        it('RN-CORE-05: o tenant B não consegue fechar visita do tenant A (VISITA_NAO_ENCONTRADA)', async () => {
            expect((await checkout(vendedorB, id(143), id(33)))[0]).toMatchObject({ status: 'rejeitado', codigo: 'VISITA_NAO_ENCONTRADA' });
        });
    });
    describe('janela da rota sem limite superior (ADR 0009, adendo §5)', () => {
        it('rota e parada gravadas a mais de 30 dias à frente chegam ao aparelho do dono (e só dele)', async () => {
            const data = SEMANA_LONGE;
            await chamar('PUT', 'rotas/:usuarioId/:data', gerente, { params: { usuarioId: U.vendedor1, data }, corpo: { paradas: [{ cliente_id: C.c1 }] } });
            const rotas = (await puxar('rota', vendedor1));
            const paradas = (await puxar('rota_parada', vendedor1));
            expect(rotas.some((r) => r.data === data)).toBe(true);
            expect(paradas.some((r) => r.data === data)).toBe(true);
            expect((await puxar('rota', vendedor2)).some((r) => r.data === data)).toBe(false);
        });
    });
    describe('concorrência no push de visita', () => {
        it('dois checkouts simultâneos do mesmo comando publicam 1 evento e ambos são aceitos', async () => {
            const vid = id(70);
            await checkin(vendedor1, vid, { cliente_id: C.c3, lat: -3.29, lng: -60.62 }); // c3: não disputa as "últimas visitas" de c1 com outros arquivos
            const antes = eventos.filter((e) => e.nome === 'core.visita.checkout@1' && e.payload.visita_id === vid).length;
            const [r1, r2] = await Promise.all([checkout(vendedor1, id(170), vid), checkout(vendedor1, id(170), vid)]);
            expect(r1).toEqual([{ id: id(170), status: 'aceito' }]);
            expect(r2).toEqual([{ id: id(170), status: 'aceito' }]);
            expect(eventos.filter((e) => e.nome === 'core.visita.checkout@1' && e.payload.visita_id === vid).length - antes).toBe(1);
        });
        it('dois check-ins simultâneos do mesmo id publicam 1 evento e ambos são aceitos', async () => {
            const vid = id(71);
            const [r1, r2] = await Promise.all([checkin(vendedor1, vid, { cliente_id: C.c3, lat: -3.29, lng: -60.62 }), checkin(vendedor1, vid, { cliente_id: C.c3, lat: -3.29, lng: -60.62 })]);
            expect(r1).toEqual([{ id: vid, status: 'aceito' }]);
            expect(r2).toEqual([{ id: vid, status: 'aceito' }]);
            expect(eventos.filter((e) => e.nome === 'core.visita.checkin@1' && e.payload.visita_id === vid)).toHaveLength(1);
            await checkout(vendedor1, id(171), vid);
        });
    });
    describe('rotas do BKO (RN-CORE-04)', () => {
        it('PUT rota: monta a rota na ordem, rejeita cliente fora da carteira do usuário (422 RN-CORE-04) e reordenar mantém o id da parada', async () => {
            await expect(chamar('PUT', 'rotas/:usuarioId/:data', gerente, { params: { usuarioId: U.vendedor1, data: SEMANA }, corpo: { paradas: [{ cliente_id: C.c2 }] } })).rejects.toMatchObject({ codigo: 'RN-CORE-04' });
            const r1 = await chamar('PUT', 'rotas/:usuarioId/:data', gerente, { params: { usuarioId: U.vendedor1, data: SEMANA }, corpo: { paradas: [{ cliente_id: C.c1 }, { cliente_id: C.c3, janela_inicio: '09:00', janela_fim: '10:00' }] } });
            expect(r1.paradas.map((p) => p.cliente_id)).toEqual([C.c1, C.c3]);
            const idC1 = r1.paradas[0].id;
            const r2 = await chamar('PUT', 'rotas/:usuarioId/:data', gerente, { params: { usuarioId: U.vendedor1, data: SEMANA }, corpo: { paradas: [{ cliente_id: C.c3 }, { cliente_id: C.c1 }] } });
            expect(r2.paradas.map((p) => [p.cliente_id, p.sequencia])).toEqual([[C.c3, 1], [C.c1, 2]]);
            expect(r2.paradas.find((p) => p.cliente_id === C.c1).id).toBe(idC1);
            expect(r2).toMatchObject({ total: 2, feitas: 0 });
        });
        it('o editor do BKO recebe o cliente de cada parada (nome, cidade e coordenada) e a carteira vigente do usuário com o vínculo', async () => {
            const dia = await chamar('GET', 'rotas/:usuarioId/:data', gerente, { params: { usuarioId: U.vendedor1, data: SEMANA } });
            expect(dia.paradas.find((p) => p.cliente_id === C.c1)).toMatchObject({ cliente_nome: 'Auto Peças Um', lat: expect.any(Number), lng: expect.any(Number) });
            expect(dia.paradas.find((p) => p.cliente_id === C.c3).lat).toBeNull();
            const cart = await chamar('GET', 'usuarios/:id/clientes', supervisor, { params: { id: U.vendedor1 } });
            expect(cart.itens.map((c) => c.id).sort()).toEqual([C.c1, C.c3].sort());
            expect(cart.itens[0]).toMatchObject({ papel: 'vendedor', carteira_id: expect.any(String) });
            await expect(chamar('GET', 'usuarios/:id/clientes', supervisor, { params: { id: U.vendedor2 } })).rejects.toBeInstanceOf(ErroNaoEncontrado);
        });
        it('RN-CORE-04: supervisor lê a rota da equipe e recebe 404 para usuário de outra equipe', async () => {
            const ok = await chamar('GET', 'rotas/:usuarioId/:data', supervisor, { params: { usuarioId: U.vendedor1, data: SEMANA } });
            expect(ok.total).toBe(2);
            await expect(chamar('GET', 'rotas/:usuarioId/:data', supervisor, { params: { usuarioId: U.vendedor2, data: SEMANA } })).rejects.toBeInstanceOf(ErroNaoEncontrado);
            const lista = await chamar('GET', 'rotas', supervisor, { query: { de: SEMANA, ate: SEMANA } });
            expect(lista.itens.map((i) => i.usuario_id)).toEqual([U.vendedor1]);
        });
        it('copiar dia: copia para as datas livres e ignora a data que já tem visita', async () => {
            await comTenant(pool, A.tenantId, async (c) => {
                await c.query("insert into core.visita (id, tenant_id, usuario_id, cliente_id, data_local, checkin_em, checkout_em, resultado, fechada_por, motivo_texto) values ($1, $2, $3, $4, $5, $6, $7, 'sem_pedido', 'usuario', 'x')", [id(60), A.tenantId, U.vendedor1, C.c1, SEMANA_QUI, `${SEMANA_QUI}T14:00:00Z`, `${SEMANA_QUI}T14:30:00Z`]);
            });
            const r = await chamar('POST', 'rotas/:usuarioId/:data/copiar', gerente, { params: { usuarioId: U.vendedor1, data: SEMANA }, corpo: { para: [SEMANA_TER, SEMANA_QUA, SEMANA_QUI] } });
            expect(r).toEqual({ copiadas: [SEMANA_TER, SEMANA_QUA], ignoradas: [SEMANA_QUI] });
            const copia = await chamar('GET', 'rotas/:usuarioId/:data', gerente, { params: { usuarioId: U.vendedor1, data: SEMANA_QUA } });
            expect(copia.paradas.map((p) => p.cliente_id)).toEqual([C.c3, C.c1]);
        });
        it('gerar pela frequência: cria a rota da semana uma vez e não sobrescreve a existente (idempotente)', async () => {
            await comTenant(pool, A.tenantId, async (c) => {
                await c.query("update core.carteira set frequencia_semanas = 1, dia_semana = 3 where cliente_id = $1 and usuario_id = $2 and papel = 'promotor'", [C.c1, U.promotor]);
            });
            const corpo = { semana: SEMANA, usuario_ids: [U.promotor] };
            expect(await chamar('POST', 'rotas/gerar', gerente, { corpo })).toEqual({ criadas: 1, ignoradas: 0 });
            expect(await chamar('POST', 'rotas/gerar', gerente, { corpo })).toEqual({ criadas: 0, ignoradas: 1 });
            const dia = await chamar('GET', 'rotas/:usuarioId/:data', gerente, { params: { usuarioId: U.promotor, data: SEMANA_QUA } });
            expect(dia.rota).toMatchObject({ origem: 'frequencia', situacao: 'planejada' });
        });
    });
    describe('coordenada sugerida (RN-CORE-10) e motivos (RN-CORE-14)', () => {
        it('RN-CORE-10: aprova a coordenada sugerida, grava no cliente, audita e publica core.cliente.atualizado@1; só analista/admin veem a lista', async () => {
            const novo = id(800);
            await comTenant(pool, A.tenantId, async (c) => {
                await c.query("insert into core.cliente (id, tenant_id, razao_social, nome_fantasia, cidade, uf) values ($1, $2, 'Sem Coordenada Ltda', 'Sem Coordenada', 'Manaus', 'AM')", [novo, A.tenantId]);
                await c.query("insert into core.carteira (id, tenant_id, cliente_id, usuario_id, papel) values ($1, $2, $3, $4, 'vendedor')", [id(801), A.tenantId, novo, U.vendedor1]);
            });
            await checkin(vendedor1, id(50), { cliente_id: novo, lat: -3.2, lng: -60.7 });
            await checkout(vendedor1, id(150), id(50));
            const lista = await chamar('GET', 'coordenadas-sugeridas', analista);
            const entrada = lista.itens.find((i) => i.cliente_id === novo);
            expect(entrada.visitas[0]).toMatchObject({ visita_id: id(50), lat: -3.2, lng: -60.7 });
            expect(rota('GET', 'coordenadas-sugeridas').acao).toBe('cliente.aprovar_coordenada');
            await chamar('PUT', 'clientes/:id/coordenada', analista, { params: { id: novo }, corpo: { visita_id: id(50) } });
            const cli = await comTenant(pool, A.tenantId, async (c) => (await c.query('select latitude::float8 as lat, longitude::float8 as lng from core.cliente where id = $1', [novo])).rows[0]);
            expect(cli).toEqual({ lat: -3.2, lng: -60.7 });
            expect((await linhaVisita(id(50))).sugere_coordenada).toBe(false);
            expect(eventos.some((e) => e.nome === 'core.cliente.atualizado@1' && e.payload.cliente_id === novo && e.payload.origem === 'bko')).toBe(true);
            expect(eventos.find((e) => e.nome === 'core.cliente.atualizado@1' && e.payload.cliente_id === novo)?.payload).toMatchObject({ vendedor_id: U.vendedor1, ativo: true, frequencia_visita: null });
            expect(typeof eventos.find((e) => e.nome === 'core.cliente.atualizado@1' && e.payload.cliente_id === novo)?.payload.na_carteira_desde).toBe('string');
            const aud = await comTenant(pool, A.tenantId, async (c) => (await c.query("select usuario_id from plataforma.auditoria where acao = 'cliente.aprovar_coordenada' and entidade_id = $1", [novo])).rows);
            expect(aud.map((l) => l.usuario_id)).toEqual([U.analista]);
            await expect(chamar('PUT', 'clientes/:id/coordenada', analista, { params: { id: novo }, corpo: { visita_id: id(50) } })).rejects.toBeInstanceOf(ErroNaoEncontrado);
            expect((await chamar('GET', 'coordenadas-sugeridas', analista)).itens.some((i) => i.cliente_id === novo)).toBe(false);
        });
        it('RN-CORE-14: motivo de sistema não se edita nem remove (422); motivo novo é criado, editado e removido, com código fixo', async () => {
            const loja = await comTenant(pool, A.tenantId, async (c) => (await c.query("select id from core.motivo where codigo = 'loja_fechada'")).rows[0].id);
            const corpoLoja = { tipo: 'cliente_fechado', codigo: 'loja_fechada', descricao: 'Mudou', ativo: false };
            await expect(chamar('PUT', 'motivos/:id', analista, { params: { id: loja }, corpo: corpoLoja })).rejects.toMatchObject({ codigo: 'RN-CORE-14' });
            await expect(chamar('DELETE', 'motivos/:id', analista, { params: { id: loja } })).rejects.toMatchObject({ codigo: 'RN-CORE-14' });
            const mid = id(900);
            await chamar('PUT', 'motivos/:id', analista, { params: { id: mid }, corpo: { tipo: 'nao_venda', codigo: 'sem_verba', descricao: 'Sem verba no mês', ordem: 50 } });
            await expect(chamar('PUT', 'motivos/:id', analista, { params: { id: id(901) }, corpo: { tipo: 'nao_venda', codigo: 'sem_verba', descricao: 'Repetido' } })).rejects.toMatchObject({ codigo: 'MOTIVO_DUPLICADO' });
            await expect(chamar('PUT', 'motivos/:id', analista, { params: { id: mid }, corpo: { tipo: 'nao_venda', codigo: 'outro', descricao: 'Trocou código' } })).rejects.toMatchObject({ codigo: 'MOTIVO_CODIGO_FIXO' });
            await chamar('PUT', 'motivos/:id', analista, { params: { id: mid }, corpo: { tipo: 'nao_venda', codigo: 'sem_verba', descricao: 'Sem verba', ativo: false } });
            const lista = await chamar('GET', 'motivos', vendedor1);
            expect(lista.itens.find((m) => m.id === mid)).toMatchObject({ descricao: 'Sem verba', ativo: false, sistema: false });
            await chamar('DELETE', 'motivos/:id', analista, { params: { id: mid } });
            expect((await chamar('GET', 'motivos', vendedor1)).itens.some((m) => m.id === mid)).toBe(false);
        });
        it('as rotas de escrita exigem ação do manifesto e só analista/admin editam motivo e coordenada', () => {
            for (const [m, c] of [['PUT', 'rotas/:usuarioId/:data'], ['POST', 'rotas/gerar'], ['PUT', 'motivos/:id'], ['PUT', 'clientes/:id/coordenada']])
                expect(rota(m, c).acao, `${m} ${c}`).toBeTruthy();
        });
        it('visitas no BKO: supervisor vê a equipe com fora do raio sinalizado e etapas; não vê a de outra equipe', async () => {
            const r = await chamar('GET', 'visitas', supervisor, { query: { fora_do_raio: 'true' } });
            expect(r.itens.length).toBeGreaterThan(0);
            expect(r.itens.every((v) => v.fora_do_raio && v.usuario_id !== U.vendedor2)).toBe(true);
            const tudo = await chamar('GET', 'visitas', gerente, { query: { usuario_id: U.vendedor1 } });
            expect(tudo.itens.find((v) => v.id === id(32)).etapas).toEqual([{ modulo: 'pesquisa', etapa: 'pesquisa.preco', situacao: 'concluida' }]);
            expect((await chamar('GET', 'visitas', supervisor, { query: { usuario_id: U.vendedor2 } })).itens).toEqual([]);
        });
    });
});
