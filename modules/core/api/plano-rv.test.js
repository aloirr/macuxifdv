import { ConsultaIndisponivel, criarPermissoes, verificarAcao, PERFIS } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { manifest } from '../manifest';
import { rotasDePlanoRv } from './plano-rv';
const TENANT = '0a000000-0000-4000-8000-0000000000aa';
const ANALISTA = '0b000000-0000-4000-8000-000000000009';
const V1 = '0b000000-0000-4000-8000-000000000001';
const V2 = '0b000000-0000-4000-8000-000000000002';
const P1 = '0d000000-0000-4000-8000-000000000001';
const P2 = '0d000000-0000-4000-8000-000000000002';
const faixas = [
    { de_pct: 0, modo: 'zero', pagamento_pct: 0 },
    { de_pct: 80, modo: 'proporcional', pagamento_pct: 0 },
    { de_pct: 100, modo: 'fixo', pagamento_pct: 100 },
];
const regras = [
    { indicador: 'venda_cents', peso_pct: 50, gatilho: false, faixas },
    { indicador: 'positivacao', peso_pct: 30, gatilho: false, faixas },
    { indicador: 'cobertura_pct', peso_pct: 20, gatilho: false, faixas },
];
const corpo = (extra = {}) => ({ nome: 'Plano 2026', vigencia_inicio: '2026-01', perfis: ['vendedor'], valor_maximo_cents: 200_000, regras, ...extra });
const linhaPlano = (id, vigencia_inicio, extra = {}) => ({
    id,
    nome: 'Plano 2026',
    vigencia_inicio,
    perfis: ['vendedor'],
    valor_maximo_cents: 200_000,
    // o jsonb do banco devolve as chaves em outra ordem: o normalizador precisa absorver
    regras: regras.map((r) => ({ faixas: r.faixas, gatilho: r.gatilho, indicador: r.indicador, peso_pct: r.peso_pct })),
    updated_at: '2026-10-01T10:00:00Z',
    atualizado_por_nome: 'Ana Analista',
    ...extra,
});
function fakeDb(r) {
    const chamadas = [];
    let leituras = 0;
    const db = {
        query: async (sql, valores = []) => {
            chamadas.push({ sql, valores });
            let rows = [];
            if (sql.includes('from core.plano_rv p'))
                rows = ++leituras > 1 && r.planosDepois ? r.planosDepois : (r.planos ?? []);
            else if (sql.includes('from core.plano_rv where id'))
                rows = r.apagado ? [{ x: 1 }] : [];
            else if (sql.includes('select id from core.usuario where equipe_id'))
                rows = r.membros ?? [];
            else if (sql.includes('select id, perfil, equipe_id'))
                rows = r.info ?? [];
            else if (sql.includes('select id, nome from core.usuario'))
                rows = r.usuarios ?? [];
            else if (sql.includes('from core.indicador_diario'))
                rows = r.diarios ?? [];
            else if (sql.includes('from core.meta'))
                rows = r.metas ?? [];
            if (r.colisao && /^\s*(insert into|update) core\.plano_rv/.test(sql))
                throw Object.assign(new Error('duplicate key'), { code: '23505', constraint: r.colisao.constraint });
            if (/^\s*insert into core\.plano_rv/.test(sql))
                rows = r.insercaoIgnorada ? [] : [{ id: valores[0] }];
            return { rows: rows, rowCount: rows.length };
        },
    };
    return { db, chamadas };
}
const AGORA = new Date('2026-11-05T15:00:00Z'); // mês aberto: novembro; outubro fechou no 2º dia útil (03/11)
const rota = (metodo, caminho) => rotasDePlanoRv.find((x) => x.metodo === metodo && x.caminho === caminho);
function chamar(metodo, caminho, db, o = {}) {
    const r = rota(metodo, caminho);
    const ctx = {
        usuario: { id: ANALISTA, tenant_id: TENANT, perfil: 'analista' },
        requestId: 'req-1',
        agora: () => AGORA,
        fuso: () => 'America/Manaus',
        usuariosVisiveis: async () => o.visiveis ?? 'tenant',
        comTenant: async (fn) => fn(db, {}),
        corpo: r.corpo ? r.corpo.parse(o.corpo) : undefined,
        query: r.query ? r.query.parse(o.query ?? {}) : {},
        params: r.params ? r.params.parse(o.params ?? {}) : {},
    };
    return r.executar(ctx); // eslint-disable-line @typescript-eslint/no-explicit-any
}
const ehAuditoria = (c) => c.sql.includes('plataforma.auditoria');
const ehEscrita = (c) => /^\s*(insert into core\.plano_rv|update core\.plano_rv)/.test(c.sql);
describe('RN-CORE-30: permissões do plano de RV', () => {
    const permissoes = criarPermissoes([manifest]);
    const quem = (acao, modulos = ['core']) => PERFIS.filter((perfil) => verificarAcao({ id: 'x', tenant_id: TENANT, perfil, modulos }, permissoes, acao).ok);
    it('RN-CORE-30: só analista e admin editam; supervisor, gerente, analista e admin veem o plano; a RV, também vendedor e promotor (a própria); o assistente não vê nenhuma', () => {
        expect(quem('plano_rv.editar')).toEqual(['analista', 'admin']);
        expect(quem('plano_rv.ver')).toEqual(['supervisor', 'gerente', 'analista', 'admin']);
        expect(quem('rv.ver')).toEqual(['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'admin']);
    });
    it('RN-CORE-03: sem o módulo core licenciado nenhuma ação do plano de RV vale', () => {
        for (const a of ['plano_rv.editar', 'plano_rv.ver', 'rv.ver'])
            expect(quem(a, [])).toEqual([]);
    });
    it('RN-CORE-30: as quatro rotas usam as ações certas; a RV filtra no domínio (escopo de carteira)', () => {
        expect(rotasDePlanoRv.map((r) => `${r.metodo} ${r.caminho} ${r.acao} ${r.carteira}`)).toEqual([
            'GET plano-rv plano_rv.ver nao_se_aplica',
            'PUT plano-rv/:id plano_rv.editar nao_se_aplica',
            'DELETE plano-rv/:id plano_rv.editar nao_se_aplica',
            'GET rv rv.ver filtrar_no_dominio',
        ]);
    });
});
describe('RN-CORE-30: GET plano-rv', () => {
    it('RN-CORE-30: devolve o vigente do mês e as versões, a mais recente primeiro; plano de mês fechado vem como não editável', async () => {
        const { db } = fakeDb({ planos: [linhaPlano(P1, '2026-01'), linhaPlano(P2, '2026-12')] });
        const r = await chamar('GET', 'plano-rv', db);
        expect(r.vigente.id).toBe(P1);
        expect(r.planos.map((p) => p.id)).toEqual([P2, P1]);
        expect(r.planos.find((p) => p.id === P1).editavel).toBe(false);
        expect(r.planos.find((p) => p.id === P2).editavel).toBe(true);
        expect(r.planos[0].atualizado_por_nome).toBe('Ana Analista');
    });
    it('RN-CORE-30: sem plano o vigente é nulo', async () => {
        expect(await chamar('GET', 'plano-rv', fakeDb({}).db)).toEqual({ vigente: null, planos: [] });
    });
});
describe('RN-CORE-30 / RN-AUD-01: PUT plano-rv/:id', () => {
    it('RN-AUD-01: cria o plano da vigência futura e audita antes (nulo) e depois', async () => {
        const { db, chamadas } = fakeDb({ planos: [linhaPlano(P1, '2026-01')], planosDepois: [linhaPlano(P1, '2026-01'), linhaPlano(P2, '2026-12')] });
        const r = await chamar('PUT', 'plano-rv/:id', db, { params: { id: P2 }, corpo: corpo({ vigencia_inicio: '2026-12' }) });
        expect(r.id).toBe(P2);
        const escritas = chamadas.filter(ehEscrita);
        expect(escritas).toHaveLength(1);
        expect(escritas[0].sql).toMatch(/^\s*insert/);
        const aud = chamadas.filter(ehAuditoria);
        expect(aud).toHaveLength(1);
        expect(aud[0].valores[1]).toBe('plano_rv.editar');
        expect(JSON.parse(aud[0].valores[4])).toBeNull();
        expect(JSON.parse(aud[0].valores[5])).toMatchObject({ id: P2, vigencia_inicio: '2026-12', valor_maximo_cents: 200_000 });
    });
    it('RN-AUD-01: repetir o mesmo corpo não grava nem audita de novo (idempotente)', async () => {
        const { db, chamadas } = fakeDb({ planos: [linhaPlano(P2, '2026-12')] });
        await chamar('PUT', 'plano-rv/:id', db, { params: { id: P2 }, corpo: corpo({ vigencia_inicio: '2026-12' }) });
        expect(chamadas.filter(ehEscrita)).toHaveLength(0);
        expect(chamadas.filter(ehAuditoria)).toHaveLength(0);
    });
    it('RN-AUD-01: editar plano futuro grava o update e audita antes/depois', async () => {
        const { db, chamadas } = fakeDb({ planos: [linhaPlano(P2, '2026-12')] });
        await chamar('PUT', 'plano-rv/:id', db, { params: { id: P2 }, corpo: corpo({ vigencia_inicio: '2026-12', valor_maximo_cents: 300_000 }) });
        expect(chamadas.filter(ehEscrita)[0].sql).toMatch(/^\s*update/);
        const aud = chamadas.find(ehAuditoria);
        expect(JSON.parse(aud.valores[4]).valor_maximo_cents).toBe(200_000);
        expect(JSON.parse(aud.valores[5]).valor_maximo_cents).toBe(300_000);
    });
    it('RN-CORE-30: id de plano que pertence a outro tenant responde 404 (não vaza) e não audita', async () => {
        const { db, chamadas } = fakeDb({ planos: [linhaPlano(P1, '2026-01')], insercaoIgnorada: true });
        await expect(chamar('PUT', 'plano-rv/:id', db, { params: { id: P2 }, corpo: corpo({ vigencia_inicio: '2026-12' }) })).rejects.toMatchObject({ status: 404 });
        expect(chamadas.filter(ehAuditoria)).toHaveLength(0);
    });
    it('RN-CORE-30: PUT simultâneo que colide no id ou no mês de início (23505) responde 409 com a ação seguinte, nunca 500', async () => {
        for (const constraint of ['plano_rv_pkey', 'plano_rv_vigencia_uk']) {
            const { db, chamadas } = fakeDb({ planos: [linhaPlano(P1, '2026-01')], colisao: { constraint } });
            await expect(chamar('PUT', 'plano-rv/:id', db, { params: { id: P2 }, corpo: corpo({ vigencia_inicio: '2026-12' }) })).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/Atualize/) });
            expect(chamadas.filter(ehAuditoria)).toHaveLength(0);
        }
    });
    it('RN-CORE-30: outro erro do banco na escrita segue como está (não vira 409)', async () => {
        const { db } = fakeDb({ planos: [linhaPlano(P1, '2026-01')] });
        const original = db.query;
        db.query = async (sql, valores) => {
            if (/^\s*insert into core\.plano_rv/.test(sql))
                throw Object.assign(new Error('boom'), { code: '08006' });
            return original(sql, valores);
        };
        await expect(chamar('PUT', 'plano-rv/:id', db, { params: { id: P2 }, corpo: corpo({ vigencia_inicio: '2026-12' }) })).rejects.toThrow('boom');
    });
    it('RN-CORE-30: pesos que não somam 100 são recusados (422) e nada é gravado', async () => {
        const { db, chamadas } = fakeDb({});
        const ruim = corpo({ regras: [{ ...regras[0], peso_pct: 60 }, regras[1]] });
        await expect(chamar('PUT', 'plano-rv/:id', db, { params: { id: P1 }, corpo: ruim })).rejects.toMatchObject({ codigo: 'RN-CORE-30' });
        expect(chamadas.filter(ehEscrita)).toHaveLength(0);
    });
    it('RN-CORE-30: plano que já valeu para mês fechado não muda', async () => {
        const { db, chamadas } = fakeDb({ planos: [linhaPlano(P1, '2026-01')] });
        await expect(chamar('PUT', 'plano-rv/:id', db, { params: { id: P1 }, corpo: corpo({ valor_maximo_cents: 999_000 }) })).rejects.toThrow(/versão nova/i);
        expect(chamadas.filter(ehEscrita)).toHaveLength(0);
    });
    it('RN-CORE-30: vigência nova que reescreveria mês fechado é recusada', async () => {
        const { db } = fakeDb({ planos: [linhaPlano(P1, '2026-01')] });
        await expect(chamar('PUT', 'plano-rv/:id', db, { params: { id: P2 }, corpo: corpo({ vigencia_inicio: '2026-09' }) })).rejects.toThrow(/mês já fechado/i);
    });
    it('RN-CORE-30: mesmo mês de início de outro plano é recusado', async () => {
        const { db } = fakeDb({ planos: [linhaPlano(P1, '2026-12')] });
        await expect(chamar('PUT', 'plano-rv/:id', db, { params: { id: P2 }, corpo: corpo({ vigencia_inicio: '2026-12' }) })).rejects.toThrow(/esse mês de início/i);
    });
    it('RN-CORE-30: plano excluído não ressuscita pelo mesmo id', async () => {
        const { db } = fakeDb({ apagado: true });
        await expect(chamar('PUT', 'plano-rv/:id', db, { params: { id: P2 }, corpo: corpo({ vigencia_inicio: '2026-12' }) })).rejects.toThrow(/excluído/i);
    });
    it('RN-CORE-30: o contrato é estrito (campo estranho, perfil, valor e mês inválidos)', () => {
        const r = rota('PUT', 'plano-rv/:id').corpo;
        expect(() => r.parse(corpo({ extra: 1 }))).toThrow();
        expect(() => r.parse(corpo({ perfis: ['gerente'] }))).toThrow();
        expect(() => r.parse(corpo({ valor_maximo_cents: 0 }))).toThrow();
        expect(() => r.parse(corpo({ vigencia_inicio: '2026-13' }))).toThrow();
    });
});
describe('RN-CORE-30 / RN-AUD-01: DELETE plano-rv/:id', () => {
    it('RN-AUD-01: exclui plano de vigência futura (soft delete) e audita', async () => {
        const { db, chamadas } = fakeDb({ planos: [linhaPlano(P1, '2026-01'), linhaPlano(P2, '2026-12')] });
        expect(await chamar('DELETE', 'plano-rv/:id', db, { params: { id: P2 } })).toEqual({ id: P2, excluido: true });
        expect(chamadas.some((c) => c.sql.includes('set deleted_at = $3'))).toBe(true);
        expect(chamadas.find(ehAuditoria).valores[1]).toBe('plano_rv.excluir');
    });
    it('RN-CORE-30: plano que já valeu para mês fechado não pode ser excluído', async () => {
        const { db, chamadas } = fakeDb({ planos: [linhaPlano(P1, '2026-01')] });
        await expect(chamar('DELETE', 'plano-rv/:id', db, { params: { id: P1 } })).rejects.toMatchObject({ codigo: 'RN-CORE-30' });
        expect(chamadas.some((c) => c.sql.includes('set deleted_at'))).toBe(false);
    });
    it('RN-CORE-30: excluir plano que já não existe é idempotente', async () => {
        const { db, chamadas } = fakeDb({});
        expect(await chamar('DELETE', 'plano-rv/:id', db, { params: { id: P2 } })).toEqual({ id: P2, excluido: true });
        expect(chamadas.filter(ehAuditoria)).toHaveLength(0);
    });
});
describe('RN-CORE-29: GET rv', () => {
    const usuarios = [
        { id: V1, nome: 'Ana' },
        { id: V2, nome: 'Beto' },
    ];
    const info = [
        { id: V1, perfil: 'vendedor', equipe_id: null },
        { id: V2, perfil: 'promotor', equipe_id: null },
    ];
    const meta = (usuario_id, indicador, valor, periodo = '2026-10') => ({ usuario_id, periodo, indicador, valor, tipo: 'pedido' });
    const plano = [linhaPlano(P1, '2026-01')];
    it('RN-CORE-29: mês fechado paga pelo realizado; perfil sem plano (promotor) fica de fora', async () => {
        const { db } = fakeDb({
            planos: plano,
            usuarios,
            info,
            metas: [meta(V1, 'venda_cents', 100_000), meta(V2, 'venda_cents', 100_000)],
            diarios: [{ usuario_id: V1, data: '2026-10-10', pedidos: 3, vendido_cents: 100_000, cancelado_cents: 0 }],
        });
        const r = await chamar('GET', 'rv', db, { query: { periodo: '2026-10' } });
        expect(r.situacao).toBe('fechado');
        expect(r.plano_id).toBe(P1);
        expect(r.pessoas.map((p) => p.nome)).toEqual(['Ana']);
        const ana = r.pessoas[0];
        expect(ana.indicadores.find((i) => i.indicador === 'venda_cents')).toMatchObject({ atingimento_pbp: 10000, pagamento_pct: 100, valor_cents: 100_000 });
        expect(ana.plano_id).toBe(P1);
        expect(ana.rv_cents).toBe(100_000); // 50% de R$ 2.000,00 cheio; positivação e cobertura sem meta pagam 0
    });
    it('RN-CORE-27/29: admin e analista veem a mesma RV (consulta pela licença do tenant, ADR 0025)', async () => {
        const dados = {
            planos: plano,
            usuarios,
            info,
            metas: [meta(V1, 'venda_cents', 100_000)],
            diarios: [{ usuario_id: V1, data: '2026-10-10', pedidos: 3, vendido_cents: 100_000, cancelado_cents: 0 }],
        };
        const pedido = { vendedor_id: V1, emitido_em: '2026-10-10T15:00:00Z', status: 'aprovado', total_cents: 150_000 }; // diferente do read-model (100_000): só a consulta do Vendedor chega a 150_000
        const opcoesVistas = [];
        const rodar = async (perfil) => {
            const r = rota('GET', 'rv');
            const consultar = async (_d, _q, opcoes) => {
                opcoesVistas.push(opcoes);
                // como o SDK: sem { licenca: 'tenant' } o Vendedor não está na licença de quem consulta, então a consulta é indisponível
                if (opcoes?.licenca !== 'tenant')
                    throw new ConsultaIndisponivel('vendedor.pedidos_da_meta@1', 'vendedor');
                return { pedidos: [pedido], faturamentos: [] };
            };
            const ctx = {
                usuario: { id: ANALISTA, tenant_id: TENANT, perfil },
                requestId: 'r',
                agora: () => AGORA,
                fuso: () => 'America/Manaus',
                usuariosVisiveis: async () => 'tenant',
                comTenant: async (fn) => fn(fakeDb(dados).db, { consultar }),
                query: r.query.parse({ periodo: '2026-10' }),
                params: {},
            };
            return r.executar(ctx);
        };
        const analista = await rodar('analista');
        expect(await rodar('admin')).toEqual(analista);
        const venda = analista.pessoas[0].indicadores.find((i) => i.indicador === 'venda_cents');
        expect(venda.realizado).toBe(150_000); // veio da consulta do Vendedor; se a RV deixar de passar a opção, cai no read-model (100_000) e o teste falha
        expect(opcoesVistas.length).toBeGreaterThan(0);
        expect(opcoesVistas.every((o) => o.licenca === 'tenant')).toBe(true);
    });
    it('RN-CORE-30: com planos diferentes para vendedor e promotor, cada pessoa traz o plano que usou (plano_id por pessoa)', async () => {
        const { db } = fakeDb({
            planos: [linhaPlano(P1, '2026-01'), linhaPlano(P2, '2026-01', { perfis: ['promotor'] })],
            usuarios,
            info,
            metas: [meta(V1, 'venda_cents', 100_000), meta(V2, 'venda_cents', 100_000)],
            diarios: [],
        });
        const r = await chamar('GET', 'rv', db, { query: { periodo: '2026-10' } });
        const porNome = Object.fromEntries(r.pessoas.map((p) => [p.nome, p.plano_id]));
        expect(porNome).toEqual({ Ana: P1, Beto: P2 });
        expect(r.plano_id).toBe(P1); // o do vendedor continua como plano principal do painel
    });
    it('RN-CORE-29: mês aberto fica parcial e a venda usa a projeção em dias úteis', async () => {
        const { db } = fakeDb({
            planos: plano,
            usuarios: [usuarios[0]],
            info,
            metas: [meta(V1, 'venda_cents', 100_000, '2026-11')],
            diarios: [{ usuario_id: V1, data: '2026-11-03', pedidos: 1, vendido_cents: 20_000, cancelado_cents: 0 }],
        });
        const r = await chamar('GET', 'rv', db);
        expect(r.situacao).toBe('parcial');
        const venda = r.pessoas[0].indicadores.find((i) => i.indicador === 'venda_cents');
        expect(venda.atingimento_pbp).toBe(2000);
        expect(venda.projetado_pbp).toBeGreaterThan(venda.atingimento_pbp);
    });
    it('RN-CORE-30: sem plano cadastrado a lista é vazia', async () => {
        const r = await chamar('GET', 'rv', fakeDb({ usuarios, info }).db, { query: { periodo: '2026-10' } });
        expect(r).toMatchObject({ plano_id: null, pessoas: [] });
    });
    it('RN-CORE-04: equipe fora do escopo do supervisor devolve lista vazia', async () => {
        const { db, chamadas } = fakeDb({ planos: plano, membros: [{ id: V1 }], usuarios: [], info: [] });
        const r = await chamar('GET', 'rv', db, { visiveis: new Set([V2]), query: { periodo: '2026-10', equipe_id: '0e000000-0000-4000-8000-000000000001' } });
        expect(r.pessoas).toEqual([]);
        expect(chamadas.find((c) => c.sql.includes('select id, nome from core.usuario')).valores[0]).toEqual([]);
    });
    it('RN-CORE-04: o escopo do supervisor vira filtro dos usuários', async () => {
        const { db, chamadas } = fakeDb({ planos: plano, usuarios: [usuarios[0]], info });
        await chamar('GET', 'rv', db, { visiveis: new Set([V1]), query: { periodo: '2026-10' } });
        expect(chamadas.find((c) => c.sql.includes('select id, nome from core.usuario')).valores[0]).toEqual([V1]);
    });
});
