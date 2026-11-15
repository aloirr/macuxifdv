/**
 * `catalogo.precos_cliente@1` no aparelho: criarShell + motor com armazenamento em memória (adaptador de teste do SDK),
 * lendo as linhas locais de pull. Mesmos casos da API (api/precos.db.test.ts): o resultado tem de ser igual.
 */
import { ambienteIndisponivel, criarArmazenamentoEmMemoria, criarMotorSync, criarShell, defineModule, definirEntidadeSync, definirModuloShell } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { ClienteSyncSchema, FilialSyncSchema } from '@macuxi/core/contracts';
import { CONSULTA_PRECOS_CLIENTE, ENTIDADES_PRECO } from '../contracts';
import { manifest } from '../manifest';
import { consultaPrecosClienteAparelho } from './consultas';
/** A parte do `moduloApp` que a consulta usa (o índice importa as telas React Native, que não rodam no Node). */
const moduloApp = definirModuloShell({ manifesto: manifest, entidadesSync: ENTIDADES_PRECO, consultas: [consultaPrecosClienteAparelho] });
const id = (n) => `0ca00000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TAB_ATACADO = id(2);
const TAB_INATIVA = id(3);
const C1 = id(101);
const C2 = id(102);
const C3 = id(103);
const P_COM = id(11);
const P_FORA = id(12);
const P_VIGENCIA = id(13);
// RN-CORE-39 (T-0149): 3 filiais (Manaus padrão, Boa Vista, Santarém sem item na tabela) e um cliente em cada uma
const F_MAO = id(301);
const F_BVB = id(302);
const F_STM = id(303);
const C4 = id(104);
const C5 = id(105);
const C6 = id(106);
const P_FIL = id(14);
const P_SO_MAO = id(15);
const AGORA = new Date('2026-11-01T12:00:00.000Z');
const iso = (dias) => new Date(AGORA.getTime() + dias * 86_400_000).toISOString();
const base = { deleted_at: null, external_id: null, updated_at: '2026-10-01T00:00:00.000000Z' };
const linhas = {
    'ent:tabela_preco': {
        [TAB_ATACADO]: { id: TAB_ATACADO, ...base, codigo: 'ATACADO', nome: 'Atacado', ativo: true },
        [TAB_INATIVA]: { id: TAB_INATIVA, ...base, codigo: 'INATIVA', nome: 'Inativa', ativo: false },
    },
    'ent:tabela_preco_item': {
        a: { id: 'a', ...base, tabela_preco_id: TAB_ATACADO, produto_id: P_COM, preco_cents: 930, vigencia_inicio: null, vigencia_fim: null },
        b: { id: 'b', ...base, tabela_preco_id: id(1), produto_id: P_FORA, preco_cents: 500, vigencia_inicio: null, vigencia_fim: null },
        c: { id: 'c', ...base, tabela_preco_id: TAB_ATACADO, produto_id: P_VIGENCIA, preco_cents: 800, vigencia_inicio: null, vigencia_fim: iso(-10) },
        d: { id: 'd', ...base, tabela_preco_id: TAB_ATACADO, produto_id: P_VIGENCIA, preco_cents: 900, vigencia_inicio: iso(-10), vigencia_fim: null },
        f1: { id: 'f1', ...base, tabela_preco_id: TAB_ATACADO, produto_id: P_FIL, preco_cents: 1000, vigencia_inicio: null, vigencia_fim: null, filial_id: F_MAO },
        f2: { id: 'f2', ...base, tabela_preco_id: TAB_ATACADO, produto_id: P_FIL, preco_cents: 1050, vigencia_inicio: null, vigencia_fim: null, filial_id: F_BVB },
        f3: { id: 'f3', ...base, tabela_preco_id: TAB_ATACADO, produto_id: P_SO_MAO, preco_cents: 700, vigencia_inicio: null, vigencia_fim: null, filial_id: F_MAO },
    },
    // RN-VEN-23: faixas do P_COM — geral de 10 un (R$ 8,50), da tabela Atacado de 10 un (R$ 8,80, vence a geral), de 50 un geral,
    // uma da tabela inativa, uma futura, uma vencida, uma em FD e uma inativa
    'ent:tabela_escalonada': {
        e1: { id: 'e1', ...base, produto_id: P_COM, medida: null, quantidade_minima: 10, preco_unidade_cents: 850, vigencia_inicio: '2026-10-01', vigencia_fim: null, tabela_preco_id: null, ativo: true },
        e2: { id: 'e2', ...base, produto_id: P_COM, medida: null, quantidade_minima: 10, preco_unidade_cents: 880, vigencia_inicio: '2026-10-01', vigencia_fim: null, tabela_preco_id: TAB_ATACADO, ativo: true },
        e3: { id: 'e3', ...base, produto_id: P_COM, medida: null, quantidade_minima: 50, preco_unidade_cents: 800, vigencia_inicio: '2026-11-01', vigencia_fim: '2026-11-01', tabela_preco_id: null, ativo: true },
        e4: { id: 'e4', ...base, produto_id: P_COM, medida: null, quantidade_minima: 20, preco_unidade_cents: 700, vigencia_inicio: '2026-10-01', vigencia_fim: null, tabela_preco_id: TAB_INATIVA, ativo: true },
        e5: { id: 'e5', ...base, produto_id: P_COM, medida: null, quantidade_minima: 30, preco_unidade_cents: 700, vigencia_inicio: '2026-11-02', vigencia_fim: null, tabela_preco_id: null, ativo: true },
        e6: { id: 'e6', ...base, produto_id: P_COM, medida: null, quantidade_minima: 40, preco_unidade_cents: 700, vigencia_inicio: '2026-09-01', vigencia_fim: '2026-10-31', tabela_preco_id: null, ativo: true },
        e7: { id: 'e7', ...base, produto_id: P_COM, medida: 'FD', quantidade_minima: 5, preco_unidade_cents: 860, vigencia_inicio: '2026-10-01', vigencia_fim: null, tabela_preco_id: null, ativo: true },
        e8: { id: 'e8', ...base, produto_id: P_COM, medida: null, quantidade_minima: 60, preco_unidade_cents: 700, vigencia_inicio: '2026-10-01', vigencia_fim: null, tabela_preco_id: null, ativo: false },
        e9: { id: 'e9', ...base, produto_id: P_FORA, medida: null, quantidade_minima: 10, preco_unidade_cents: 400, vigencia_inicio: '2026-10-01', vigencia_fim: null, tabela_preco_id: null, ativo: true },
    },
    'ent:cliente_tabela_preco': {
        v1: { id: 'v1', ...base, cliente_id: C1, tabela_preco_id: TAB_ATACADO },
        v2: { id: 'v2', ...base, cliente_id: C2, tabela_preco_id: TAB_INATIVA },
        v4: { id: 'v4', ...base, cliente_id: C4, tabela_preco_id: TAB_ATACADO },
        v5: { id: 'v5', ...base, cliente_id: C5, tabela_preco_id: TAB_ATACADO },
        v6: { id: 'v6', ...base, cliente_id: C6, tabela_preco_id: TAB_ATACADO },
    },
    'ent:filial': {
        [F_MAO]: { id: F_MAO, ...base, codigo: '0001', nome: 'Manaus', cidade: 'Manaus', uf: 'AM', padrao: true, ativo: true },
        [F_BVB]: { id: F_BVB, ...base, codigo: '0002', nome: 'Boa Vista', cidade: 'Boa Vista', uf: 'RR', padrao: false, ativo: true },
        [F_STM]: { id: F_STM, ...base, codigo: '0003', nome: 'Santarém', cidade: 'Santarém', uf: 'PA', padrao: false, ativo: true },
    },
    'ent:cliente': {
        [C4]: { id: C4, ...base, filial_id: F_BVB },
        [C5]: { id: C5, ...base, filial_id: F_MAO },
        [C6]: { id: C6, ...base, filial_id: F_STM },
    },
};
// o Core oferece core.cadastro_resumo@1 (o Catálogo usa na API desde a T-0052; o shell confere o conjunto)
// entidades do Core que o Catálogo lê no aparelho (RN-CORE-39: filial do cliente e filiais)
const entidadesCore = [
    definirEntidadeSync({ nome: 'cliente', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: ClienteSyncSchema }),
    definirEntidadeSync({ nome: 'filial', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: FilialSyncSchema }),
];
const mCore = defineModule({ id: 'core', versao: '1.0.0', perfis: ['vendedor', 'promotor'], apps: { campo: { abas: [] } }, ofereceConsultas: ['core.cadastro_resumo@1', 'core.filiais@1'], sync: ['cliente', 'filial'] });
// consumidor mínimo (o Vendedor real declara o mesmo em usaConsultas)
const mConsumidor = defineModule({
    id: 'vendedor',
    versao: '1.0.0',
    depende: ['core', 'catalogo'],
    perfis: ['vendedor'],
    apps: { campo: { abas: ['Pedidos'] } },
    usaConsultas: ['catalogo.precos_cliente@1'],
});
async function motorDo(perfil, parametros = {}) {
    const shell = criarShell('campo', [definirModuloShell({ manifesto: mCore, entidadesSync: entidadesCore }), moduloApp, definirModuloShell({ manifesto: mConsumidor })]);
    const ambiente = { ...ambienteIndisponivel(), usuario: () => (perfil ? { id: id(900), nome: 'Teste', perfil } : null) };
    const motor = criarMotorSync({
        registro: shell.registroSync,
        armazenamento: criarArmazenamentoEmMemoria(linhas),
        transporte: { push: async () => [], pull: async () => ({ itens: [], proximo_cursor: null }) },
        consultas: shell.consultas,
        ambiente,
        agora: () => AGORA,
    });
    await motor.carregar();
    await motor.aplicarModulosAtivos(['core', 'catalogo', 'vendedor'], { catalogo: parametros });
    return motor;
}
const consultar = async (motor, produtos, cliente = C1, em = AGORA.toISOString()) => motor.ambiente.consultar(CONSULTA_PRECOS_CLIENTE, { cliente_id: cliente, produto_ids: produtos, em });
describe('Catálogo no aparelho: catalogo.precos_cliente@1', () => {
    it('o manifesto oferece a consulta e sincroniza o vínculo cliente × tabela', () => {
        expect(manifest.ofereceConsultas).toContain('catalogo.precos_cliente@1');
        expect(manifest.sync).toContain('cliente_tabela_preco');
    });
    it('RN-CAT-06: preço vem da tabela do cliente, offline', async () => {
        const r = await consultar(await motorDo('vendedor'), [P_COM]);
        expect(r).toMatchObject({ tabela_preco_id: TAB_ATACADO, tabela_preco_nome: 'Atacado', itens: [{ produto_id: P_COM, preco_cents: 930, motivo_sem_preco: null }] });
    });
    it('RN-CORE-39: cada cliente vê o preço da sua filial, offline (a mesma tabela de preço, preço por filial)', async () => {
        const motor = await motorDo('vendedor');
        expect(await consultar(motor, [P_FIL], C5)).toMatchObject({ filial_id: F_MAO, filial_origem: 'cliente', itens: [{ preco_cents: 1000 }] });
        expect(await consultar(motor, [P_FIL], C4)).toMatchObject({ filial_id: F_BVB, filial_origem: 'cliente', itens: [{ preco_cents: 1050 }] });
    });
    it('RN-CORE-39: tabela sem nenhum item na filial do cliente usa os itens da MESMA tabela na filial padrão (fallback por tabela)', async () => {
        const r = await consultar(await motorDo('vendedor'), [P_FIL], C6);
        expect(r).toMatchObject({ tabela_preco_id: TAB_ATACADO, filial_id: F_MAO, filial_origem: 'padrao', itens: [{ preco_cents: 1000 }] });
    });
    it('RN-CAT-06: na filial escolhida, produto sem item continua "Sem preço para este cliente" (o fallback é por tabela, não por item)', async () => {
        const r = await consultar(await motorDo('vendedor'), [P_SO_MAO], C4);
        expect(r.itens[0]).toEqual({ produto_id: P_SO_MAO, preco_cents: null, motivo_sem_preco: 'Sem preço para este cliente.' });
    });
    it('RN-CAT-06: produto fora da tabela do cliente = sem preço (não cai na outra tabela)', async () => {
        const r = await consultar(await motorDo('vendedor'), [P_COM, P_FORA]);
        expect(r.itens[1]).toEqual({ produto_id: P_FORA, preco_cents: null, motivo_sem_preco: 'Sem preço para este cliente.' });
    });
    it('RN-CAT-06: cliente sem tabela, ou com tabela inativa, fica sem preço', async () => {
        const motor = await motorDo('vendedor');
        for (const cliente of [C3, C2]) {
            expect(await consultar(motor, [P_COM], cliente)).toEqual({ tabela_preco_id: null, itens: [{ produto_id: P_COM, preco_cents: null, motivo_sem_preco: 'Sem preço para este cliente.' }] });
        }
    });
    it('RN-CAT-05: promotor não recebe preço; com o parâmetro ligado recebe; sem usuário, falha fechada', async () => {
        expect(await consultar(await motorDo('promotor'), [P_COM])).toEqual({
            tabela_preco_id: null,
            itens: [{ produto_id: P_COM, preco_cents: null, motivo_sem_preco: 'Preço não disponível para o seu perfil.' }],
        });
        expect((await consultar(await motorDo('promotor', { promotor_ve_preco_estoque: true }), [P_COM])).itens[0].preco_cents).toBe(930);
        expect((await consultar(await motorDo(null), [P_COM])).itens[0].preco_cents).toBeNull();
    });
    it('P-4: preço pela data informada, até 7 dias para trás e nunca no futuro', async () => {
        const motor = await motorDo('vendedor');
        expect((await consultar(motor, [P_VIGENCIA], C1, iso(-10))).itens[0].preco_cents).toBe(900);
        expect((await consultar(motor, [P_VIGENCIA], C1, iso(-8))).itens[0].preco_cents).toBe(900);
        expect((await consultar(motor, [P_VIGENCIA], C1, iso(5))).itens[0].preco_cents).toBe(900);
    });
    it('RN-VEN-23: o item leva as faixas vigentes da tabela do cliente e gerais; a da tabela do cliente vence a geral, offline', async () => {
        const r = await consultar(await motorDo('vendedor'), [P_COM]);
        expect(r.itens[0].faixas).toEqual([
            { medida: null, quantidade_minima: 10, preco_unidade_cents: 880 },
            { medida: null, quantidade_minima: 50, preco_unidade_cents: 800 },
            { medida: 'FD', quantidade_minima: 5, preco_unidade_cents: 860 },
        ]);
        expect(r.itens[0].preco_cents).toBe(930);
        expect(r.itens[0]).not.toHaveProperty('embalagens');
    });
    it('RN-CAT-06: item sem preço na tabela do cliente não recebe faixa, mesmo com faixa geral cadastrada', async () => {
        const r = await consultar(await motorDo('vendedor'), [P_FORA]);
        expect(r.itens[0]).toEqual({ produto_id: P_FORA, preco_cents: null, motivo_sem_preco: 'Sem preço para este cliente.' });
    });
    it('RN-CAT-05: promotor (sem o parâmetro) não recebe faixa nenhuma; com o parâmetro ligado recebe', async () => {
        expect((await consultar(await motorDo('promotor'), [P_COM])).itens[0]).not.toHaveProperty('faixas');
        expect((await consultar(await motorDo('promotor', { promotor_ve_preco_estoque: true }), [P_COM])).itens[0].faixas).toHaveLength(3);
    });
    it('RN-VEN-23: a vigência segue a data do preço (`em`): em 31/10 as faixas que começam em 01/11 e 02/11 ainda não valem e a que termina em 31/10 ainda vale', async () => {
        const r = await consultar(await motorDo('vendedor'), [P_COM], C1, '2026-10-31T12:00:00.000Z');
        expect(r.itens[0].faixas.map((f) => [f.medida, f.quantidade_minima])).toEqual([
            [null, 10],
            [null, 40],
            ['FD', 5],
        ]);
    });
    it('ADR 0012: mais de 500 produtos é recusado pelo contrato', async () => {
        const motor = await motorDo('vendedor');
        await expect(consultar(motor, Array.from({ length: 501 }, (_, i) => id(1000 + i)))).rejects.toThrow('entrada inválida');
    });
});
