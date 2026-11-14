import { ehConsultaIndisponivel } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { RespostaLocalEntradaSchema as Entrada, RespostaLocalSaidaSchema } from '../contracts/consulta-tarefa';
import { QUEST, TENANT, u } from '../domain/util-teste';
import { criarConsultaRespostaLocalApi } from './consulta-resposta-local';
import { criarRepositorioEmMemoria } from './repositorio-memoria';
const AGORA = '2026-10-31T15:00:00.000Z';
const db = { query: async () => ({ rows: [], rowCount: 0 }) };
const ctx = (modulos = ['core', 'pesquisa'], tenant = TENANT, id = u(1)) => ({ db, usuario: { id, tenant_id: tenant, perfil: 'promotor', modulos }, requestId: 'r', agora: () => new Date(AGORA), fuso: () => 'America/Manaus', parametros: () => ({}), log: { debug() { }, info() { }, warn() { }, error() { } } });
const resposta = (extra = {}) => ({
    id: u(900), tenant_id: TENANT, questionario_id: QUEST, versao_id: u(700), cliente_id: u(60), visita_id: null,
    respondida_em: '2026-10-31T14:00:00.000Z', itens: [{ pergunta_id: u(1), tipo: 'sim_nao', valor: true }],
    usuario_id: u(1), equipe_id: null, recebida_em: '2026-10-31T14:00:01.000Z', suspeita: false, motivos_suspeita: [], ...extra,
});
const entrada = (extra = {}) => Entrada.parse({ questionario_id: QUEST, cliente_id: u(60), desde: '2026-10-31T00:00:00.000Z', ...extra });
async function ambiente(...rs) {
    const fabrica = criarRepositorioEmMemoria();
    const repo = fabrica(TENANT, db);
    for (const r of rs)
        await repo.inserirResposta(r, AGORA);
    return criarConsultaRespostaLocalApi(fabrica);
}
describe('pesquisa.resposta_local@1 na API (RN-PES-02)', () => {
    it('RN-PES-02: devolve a resposta sincronizada mais recente do próprio usuário, conforme o contrato', async () => {
        const c = await ambiente(resposta({ id: u(900) }), resposta({ id: u(901), respondida_em: '2026-10-31T14:30:00.000Z' }));
        expect(RespostaLocalSaidaSchema.parse(await c.executar(entrada(), ctx()))).toEqual({ resposta_id: u(901) });
    });
    it('RN-PES-02: resposta de outro usuário não conta', async () => {
        const c = await ambiente(resposta({ usuario_id: u(2) }));
        expect(await c.executar(entrada(), ctx())).toEqual({ resposta_id: null });
    });
    it('RN-PES-02: respostas antes de desde ficam de fora', async () => {
        const c = await ambiente(resposta({ respondida_em: '2026-10-30T23:59:59.000Z' }));
        expect(await c.executar(entrada(), ctx())).toEqual({ resposta_id: null });
    });
    it('RN-PES-02: cliente informado filtra; cliente nulo aceita qualquer', async () => {
        const c = await ambiente(resposta({ cliente_id: u(61) }));
        expect(await c.executar(entrada(), ctx())).toEqual({ resposta_id: null });
        expect(await c.executar(entrada({ cliente_id: null }), ctx())).toEqual({ resposta_id: u(900) });
    });
    it('RN-PES-01: isolamento por tenant', async () => {
        const c = await ambiente(resposta());
        expect(await c.executar(entrada(), ctx(['core', 'pesquisa'], u(9999)))).toEqual({ resposta_id: null });
    });
    it('RN-CORE-03: sem a licença da Pesquisa a consulta fica indisponível', async () => {
        const c = await ambiente(resposta());
        const erro = await c.executar(entrada(), ctx(['core'])).catch((e) => e);
        expect(ehConsultaIndisponivel(erro)).toBe(true);
    });
});
