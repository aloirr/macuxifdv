/**
 * Tradução dos erros de integridade do banco para erros de negócio (sem Postgres) e nova tentativa do push quando duas
 * entregas do mesmo UUID chegam juntas (RF-PES-04, RN-PES-01). O comportamento contra o banco real está em
 * `repositorio-postgres.db.test.ts`.
 */
import { criarRelogio } from '@macuxi/comum/relogio';
import { ErroHttpModulo } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { criarAmbienteDeTeste, uu } from './apoio-teste';
import { RESPOSTA_JA_EXISTE } from './comum';
import { traduzirErroBanco } from './repositorio-postgres';
import { provedoresSync } from './sync';
const erroPg = (code, constraint) => Object.assign(new Error('erro do pg'), { code, ...(constraint ? { constraint } : {}) });
const traduzir = (e) => {
    try {
        traduzirErroBanco(e);
    }
    catch (x) {
        return x;
    }
    throw new Error('não lançou');
};
describe('RN-PES-01 / RF-PES-04: erro do banco vira erro de negócio (nunca 500)', () => {
    it('RN-PES-01: 23514 do gatilho de imutabilidade = 422 VERSAO_PUBLICADA_IMUTAVEL com a RN em detalhes', () => {
        const e = traduzir(erroPg('23514', 'questionario_versao_publicada_imutavel'));
        expect(e).toMatchObject({ status: 422, codigo: 'VERSAO_PUBLICADA_IMUTAVEL', detalhes: { rn: 'RN-PES-01' } });
        expect(e.message).toMatch(/nova versão/);
    });
    it('RN-PES-01: 23514 do gatilho de resposta = 422 VERSAO_NAO_PUBLICADA', () => {
        expect(traduzir(erroPg('23514', 'resposta_versao_publicada'))).toMatchObject({ status: 422, codigo: 'VERSAO_NAO_PUBLICADA' });
    });
    it('outros CHECKs: rascunho, resposta e genérico, sempre 422 com texto em português', () => {
        expect(traduzir(erroPg('23514', 'questionario_versao_vigencia_ordem'))).toMatchObject({ status: 422, codigo: 'RASCUNHO_INVALIDO' });
        expect(traduzir(erroPg('23514', 'resposta_itens_lista'))).toMatchObject({ status: 422, codigo: 'RESPOSTA_INVALIDA' });
        expect(traduzir(erroPg('23514', 'questionario_arquivado_depois_de_criado'))).toMatchObject({ status: 422, codigo: 'DADO_INVALIDO' });
    });
    it('23505: outro rascunho aberto ou número repetido = 409 VERSAO_EM_EDICAO; resposta repetida = 409 RESPOSTA_JA_EXISTE; resto = 409 JA_EXISTE', () => {
        expect(traduzir(erroPg('23505', 'questionario_versao_rascunho_uk'))).toMatchObject({ status: 409, codigo: 'VERSAO_EM_EDICAO' });
        expect(traduzir(erroPg('23505', 'questionario_versao_numero_uk'))).toMatchObject({ status: 409, codigo: 'VERSAO_EM_EDICAO' });
        expect(traduzir(erroPg('23505', 'resposta_pkey'))).toMatchObject({ status: 409, codigo: RESPOSTA_JA_EXISTE });
        expect(traduzir(erroPg('23505', 'questionario_pkey'))).toMatchObject({ status: 409, codigo: 'JA_EXISTE' });
    });
    it('23503: versão fora do questionário = 422 VERSAO_INEXISTENTE; questionário inexistente = 404; foto sem arquivo = 422 RESPOSTA_INVALIDA', () => {
        expect(traduzir(erroPg('23503', 'resposta_versao_fk'))).toMatchObject({ status: 422, codigo: 'VERSAO_INEXISTENTE' });
        expect(traduzir(erroPg('23503', 'questionario_versao_questionario_fk'))).toMatchObject({ status: 404, codigo: 'QUESTIONARIO_NAO_ENCONTRADO' });
        expect(traduzir(erroPg('23503', 'resposta_questionario_fk'))).toMatchObject({ status: 404 });
        expect(traduzir(erroPg('23503', 'resposta_foto_arquivo_fk'))).toMatchObject({ status: 422, codigo: 'RESPOSTA_INVALIDA' });
        expect(traduzir(erroPg('23503', 'outra_fk'))).toMatchObject({ status: 422, codigo: 'REFERENCIA_INVALIDA' });
    });
    it('falha de infraestrutura (conexão, permissão) segue como veio: é 500 com log, não erro de negócio', () => {
        const queda = erroPg('57P01');
        expect(() => traduzirErroBanco(queda)).toThrow(queda);
        const permissao = erroPg('42501');
        expect(() => traduzirErroBanco(permissao)).toThrow(permissao);
    });
    it('erro de negócio já traduzido passa direto (não é traduzido duas vezes)', () => {
        const ja = new ErroHttpModulo(409, 'X', 'já');
        expect(() => traduzirErroBanco(ja)).toThrow(ja);
    });
});
describe('RF-PES-04: duas entregas simultâneas do mesmo UUID', () => {
    const Q = uu(800);
    const P1 = uu(101);
    const VENDEDOR = uu(31);
    const ANALISTA = uu(1);
    const base = criarRelogio().agora(); // uma linha do tempo só: o relógio do teste, congelado aqui
    const agora = () => base;
    async function preparar() {
        const amb = criarAmbienteDeTeste();
        const a = amb.contexto({ id: ANALISTA, perfil: 'analista', agora });
        await amb.chamar(a, 'POST', 'questionarios', { corpo: { id: Q, titulo: 'Concorrência' } });
        await amb.chamar(a, 'PUT', 'questionarios/:id/rascunho', {
            params: { id: Q },
            corpo: { perguntas: [{ id: P1, tipo: 'sim_nao', enunciado: 'Tem?', obrigatoria: true }], vigencia: { inicio: new Date(base.getTime() - 86_400_000).toISOString(), fim: null } },
        });
        await amb.chamar(a, 'POST', 'questionarios/:id/publicar', { params: { id: Q } });
        const versao = (await amb.fabrica(a.usuario.tenant_id, { query: async () => ({ rows: [], rowCount: 0 }) }).carregar(Q)).versoes[0];
        const envio = { id: uu(5000), questionario_id: Q, versao_id: versao.id, cliente_id: null, visita_id: null, respondida_em: new Date(base.getTime() - 600_000).toISOString(), itens: [{ pergunta_id: P1, tipo: 'sim_nao', valor: true }] };
        return { amb, envio, ctx: amb.contexto({ id: VENDEDOR, perfil: 'vendedor', agora, carteira: 'tenant' }) };
    }
    const item = (e) => ({ entidade: 'resposta_pesquisa', id: e.id, operacao: 'upsert', payload: e });
    /** Repositório cuja primeira inserção "perde a corrida": a outra transação grava o mesmo conteúdo e o banco responde 23505. */
    function perdedora(amb, quem) {
        let tentativas = 0;
        const fabrica = (tenant, db) => {
            const repo = amb.fabrica(tenant, db);
            return {
                ...repo,
                async inserirResposta(r, agora) {
                    tentativas++;
                    if (tentativas === 1) {
                        const vencedora = quem === 'igual' ? r : { ...r, itens: [{ pergunta_id: P1, tipo: 'sim_nao', valor: false }] };
                        await repo.inserirResposta(vencedora, agora);
                        throw new ErroHttpModulo(409, RESPOSTA_JA_EXISTE, 'Esta resposta já foi recebida.');
                    }
                    return repo.inserirResposta(r, agora);
                },
            };
        };
        return { fabrica, tentativas: () => tentativas };
    }
    it('a perdedora refaz uma vez, enxerga a vencedora e devolve "aceito" (mesmo conteúdo): 1 resposta só', async () => {
        const { amb, envio, ctx } = await preparar();
        const { fabrica, tentativas } = perdedora(amb, 'igual');
        const [r] = await provedoresSync(fabrica).find((p) => p.entidade.nome === 'resposta_pesquisa').receber(ctx, [item(envio)]);
        expect(r).toMatchObject({ id: envio.id, status: 'aceito' });
        expect(tentativas()).toBe(1); // a segunda tentativa viu a existente e nem tentou inserir
        expect(await amb.fabrica(ctx.usuario.tenant_id, { query: async () => ({ rows: [], rowCount: 0 }) }).contarRespostas(Q)).toBe(1);
    });
    it('a perdedora com conteúdo diferente da vencedora recebe "conflito" e a resposta da vencedora fica como estava', async () => {
        const { amb, envio, ctx } = await preparar();
        const { fabrica } = perdedora(amb, 'diferente');
        const [r] = await provedoresSync(fabrica).find((p) => p.entidade.nome === 'resposta_pesquisa').receber(ctx, [item(envio)]);
        expect(r).toMatchObject({ id: envio.id, status: 'conflito' });
        const gravada = await amb.fabrica(ctx.usuario.tenant_id, { query: async () => ({ rows: [], rowCount: 0 }) }).obterResposta(envio.id);
        expect(gravada.itens).toEqual([{ pergunta_id: P1, tipo: 'sim_nao', valor: false }]);
    });
});
