import { describe, expect, it } from 'vitest';
import { receberResposta } from './recebimento';
import { envio, item, publicada, QUEST, sim_nao, TENANT, texto, u, versao } from './util-teste';
const quest = { id: QUEST, tenant_id: TENANT, criado_em: '2026-10-01T00:00:00Z', arquivado_em: null };
const v1 = publicada({ perguntas: [sim_nao(1, { obrigatoria: true }), texto(2)] });
const USUARIO = { id: u(31), perfil: 'vendedor', equipe_id: u(41) };
const RECEBIDA = '2026-10-31T14:00:00Z';
const entrada = (extra = {}) => ({
    questionario: quest,
    versoes: [v1],
    envio: envio([item.simNao(1, true)], { cliente_id: u(51), visita_id: u(61) }),
    existente: null,
    usuario: USUARIO,
    tenant_id: TENANT,
    recebida_em: RECEBIDA,
    ...extra,
});
describe('RF-PES-04 / RN-PES-04: recebimento da resposta no servidor', () => {
    it('RF-PES-04: resposta nova válida é inserida com tenant, usuário, equipe e recebida_em do servidor', () => {
        const r = receberResposta(entrada());
        expect(r.ok).toBe(true);
        if (!r.ok || r.valor.resultado !== 'inserir')
            throw new Error('esperava inserir');
        expect(r.valor.resposta).toMatchObject({ id: u(5000), tenant_id: TENANT, usuario_id: USUARIO.id, equipe_id: u(41), recebida_em: RECEBIDA, suspeita: false, motivos_suspeita: [] });
    });
    it('doc 02: monta o payload de pesquisa.resposta.registrada@1 sem o conteúdo das respostas (LGPD)', () => {
        const r = receberResposta(entrada());
        if (!r.ok || r.valor.resultado !== 'inserir')
            throw new Error('esperava inserir');
        expect(r.valor.evento).toEqual({
            resposta_id: u(5000),
            tenant_id: TENANT,
            questionario_id: QUEST,
            versao_id: v1.id,
            usuario_id: USUARIO.id,
            equipe_id: u(41),
            cliente_id: u(51),
            visita_id: u(61),
            modo: 'avulsa',
            respondida_em: '2026-10-31T13:00:00Z',
            recebida_em: RECEBIDA,
            total_itens: 1,
            suspeita: false,
        });
        expect(r.valor.evento).not.toHaveProperty('itens');
    });
    it('RF-PES-04: reenvio com o mesmo id e o mesmo conteúdo é duplicado (no-op, sem evento novo)', () => {
        const primeira = receberResposta(entrada());
        if (!primeira.ok || primeira.valor.resultado !== 'inserir')
            throw new Error('esperava inserir');
        const r = receberResposta(entrada({ existente: primeira.valor.resposta }));
        expect(r).toEqual({ ok: true, valor: { resultado: 'duplicada', resposta: primeira.valor.resposta } });
    });
    it('RF-PES-04: o mesmo id com conteúdo diferente é conflito e nunca sobrescreve', () => {
        const primeira = receberResposta(entrada());
        if (!primeira.ok || primeira.valor.resultado !== 'inserir')
            throw new Error('esperava inserir');
        const r = receberResposta(entrada({ existente: primeira.valor.resposta, envio: envio([item.simNao(1, false)], { cliente_id: u(51), visita_id: u(61) }) }));
        expect(r).toMatchObject({ ok: false, codigo: 'CONFLITO_DE_CONTEUDO' });
    });
    it('RN-PES-01: a resposta é validada contra a versão que cita; versão inexistente ou rascunho é recusada', () => {
        expect(receberResposta(entrada({ envio: envio([item.simNao(1, true)], { versao_id: u(999) }) }))).toMatchObject({ ok: false, codigo: 'VERSAO_INEXISTENTE' });
        const rascunho = versao({ id: u(701), numero: 2 });
        expect(receberResposta(entrada({ versoes: [v1, rascunho], envio: envio([item.simNao(1, true)], { versao_id: u(701) }) }))).toMatchObject({ ok: false, codigo: 'VERSAO_NAO_PUBLICADA' });
    });
    it('RN-PES-01: resposta feita offline na v1 continua aceita depois da v2 publicada', () => {
        const v2 = publicada({ id: u(702), numero: 2, perguntas: [sim_nao(1, { obrigatoria: true }), texto(2, { obrigatoria: true })] });
        const r = receberResposta(entrada({ versoes: [v1, v2] }));
        expect(r).toMatchObject({ ok: true, valor: { resultado: 'inserir' } });
    });
    it('RF-PES-01: resposta inválida (obrigatória faltando) é recusada com a lista de erros', () => {
        const r = receberResposta(entrada({ envio: envio([item.texto(2, 'ok')]) }));
        expect(r).toMatchObject({ ok: false, codigo: 'RESPOSTA_INVALIDA' });
        if (!r.ok)
            expect(r.detalhes?.map((d) => d.codigo)).toEqual(['OBRIGATORIA']);
    });
    it('RF-PES-02 / doc 03 §2: perfil fora do público da versão respondida é recusado', () => {
        const soPromotor = publicada({ perguntas: [sim_nao(1)], publico_alvo: { perfis: ['promotor'], equipes: [], segmentos: [], regioes: [], canais: [], clientes: [] } });
        const r = receberResposta(entrada({ versoes: [soPromotor] }));
        expect(r).toMatchObject({ ok: false, codigo: 'PERFIL_FORA_DO_PUBLICO' });
    });
    it('RN-PES-04: resposta fora da vigência ou com relógio adiantado é aceita e sinalizada, nunca recusada', () => {
        const encerrada = publicada({ perguntas: [sim_nao(1)], vigencia: { inicio: '2026-10-01T00:00:00Z', fim: '2026-10-10T00:00:00Z' } });
        const r = receberResposta(entrada({ versoes: [encerrada] }));
        if (!r.ok || r.valor.resultado !== 'inserir')
            throw new Error('esperava inserir');
        expect(r.valor.resposta).toMatchObject({ suspeita: true, motivos_suspeita: ['APOS_A_VIGENCIA'] });
        expect(r.valor.evento.suspeita).toBe(true);
        const adiantado = receberResposta(entrada({ envio: envio([item.simNao(1, true)], { respondida_em: '2026-11-02T15:00:00Z' }) }));
        if (!adiantado.ok || adiantado.valor.resultado !== 'inserir')
            throw new Error('esperava inserir');
        expect(adiantado.valor.resposta.motivos_suspeita).toContain('RELOGIO_ADIANTADO');
    });
    it('RN-PES-04: a tolerância vem dos parâmetros do tenant', () => {
        const encerrada = publicada({ perguntas: [sim_nao(1)], vigencia: { inicio: '2026-10-01T00:00:00Z', fim: '2026-10-31T12:00:00Z' } });
        const comPadrao = receberResposta(entrada({ versoes: [encerrada] }));
        const semTolerancia = receberResposta(entrada({ versoes: [encerrada], parametros: { tolerancia_vigencia_h: 0 } }));
        expect(comPadrao.ok && comPadrao.valor.resultado === 'inserir' && comPadrao.valor.resposta.suspeita).toBe(false);
        expect(semTolerancia.ok && semTolerancia.valor.resultado === 'inserir' && semTolerancia.valor.resposta.suspeita).toBe(true);
    });
    it('RN-PES-04: questionário arquivado depois da resposta offline não recusa a resposta', () => {
        const r = receberResposta(entrada({ questionario: { ...quest, arquivado_em: '2026-10-31T13:30:00Z' } }));
        expect(r).toMatchObject({ ok: true, valor: { resultado: 'inserir' } });
    });
    it('RF-PES-03: o modo do evento é o da versão respondida (checkout obrigatória)', () => {
        const obrig = publicada({ perguntas: [sim_nao(1)], modo: 'checkout_obrigatoria' });
        const r = receberResposta(entrada({ versoes: [obrig] }));
        expect(r.ok && r.valor.resultado === 'inserir' && r.valor.evento.modo).toBe('checkout_obrigatoria');
    });
    it('RF-PES-04: os avisos de GS1 (RN-PES-06) acompanham a inserção sem bloquear', () => {
        const v = publicada({ perguntas: [{ id: u(1), tipo: 'codigo_barras', enunciado: 'EAN', obrigatoria: true }] });
        const r = receberResposta(entrada({ versoes: [v], envio: envio([item.codigo(1, '4006381333932')]) }));
        expect(r.ok && r.valor.resultado === 'inserir' && r.valor.avisos.map((a) => a.codigo)).toEqual(['CODIGO_GS1_INVALIDO']);
    });
    it('a resposta gravada passa no contrato RespostaPesquisa', async () => {
        const { RespostaPesquisa } = await import('../contracts');
        const r = receberResposta(entrada());
        if (!r.ok || r.valor.resultado !== 'inserir')
            throw new Error('esperava inserir');
        expect(RespostaPesquisa.safeParse(r.valor.resposta).success).toBe(true);
    });
});
