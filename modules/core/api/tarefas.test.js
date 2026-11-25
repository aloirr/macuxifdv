/**
 * Tarefas do consultor (T-0170) sem banco: contrato das rotas (ação, superfície, escopo de carteira, corpo) e o `receber` do push
 * `tarefa_conclusao` com um banco falso (as decisões de RN-CORE-TAR-05/06/08 e a idempotência). O comportamento sobre dados reais
 * está em `tarefas.db.test.ts`.
 */
import { ErroHttpModulo } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { CriarTarefaSchema } from '../contracts/tarefa';
import { receberConclusoesTarefa, rotasDeTarefas } from './tarefas';
const U1 = '0e100000-0000-4000-8000-000000000001';
const U2 = '0e100000-0000-4000-8000-000000000002';
const D1 = '0e100000-0000-4000-8000-0000000000d1';
const T1 = '0e100000-0000-4000-8000-0000000000a1';
const CMD = '0e100000-0000-4000-8000-0000000000c1';
const FOTO1 = '0e100000-0000-4000-8000-0000000000f1';
const FOTO2 = '0e100000-0000-4000-8000-0000000000f2';
const AGORA = new Date('2026-11-13T15:00:00.000Z');
const linhaPadrao = { id: D1, usuario_id: U1, tipo: 'simples', concluida_em: null, cancelada_em: null, tarefa_id: T1, cliente_id: null, prazo: '2026-11-20' };
/** Contexto com banco falso: devolve a linha pedida e anota o SQL, os eventos e os arquivos. */
function ambiente(linha, opcoes = {}) {
    const chamadas = [];
    const eventos = [];
    const arquivos = [];
    let transacoes = 0;
    const ctx = {
        usuario: { id: U1, tenant_id: 't', perfil: 'vendedor' },
        agora: () => AGORA,
        fuso: () => 'America/Manaus',
        comTenant: async (fn) => {
            transacoes += 1;
            const db = {
                query: async (sql, valores = []) => {
                    chamadas.push({ sql, valores });
                    if (/from core\.tarefa_destinatario d join core\.tarefa t/.test(sql))
                        return { rows: linha ? [linha] : [], rowCount: linha ? 1 : 0 };
                    if (/^update core\.tarefa_destinatario/.test(sql))
                        return { rows: [], rowCount: opcoes.rowCount ?? 1 };
                    return { rows: [], rowCount: 0 };
                },
            };
            const tx = {
                publicar: async (def, payload) => {
                    eventos.push({ nome: def.nome, payload });
                    return {};
                },
                registrarArquivo: async (a) => {
                    if (opcoes.arquivoFalha)
                        throw opcoes.arquivoFalha;
                    arquivos.push(a);
                    return { criado: true };
                },
            };
            return fn(db, tx);
        },
    };
    return { ctx, chamadas, eventos, arquivos, transacoes: () => transacoes };
}
const item = (payload, extra = {}) => ({ id: payload.id ?? CMD, operacao: 'criar', payload, ...extra });
const comando = (extra = {}) => ({ id: CMD, tarefa_destinatario_id: D1, concluida_em: '2026-11-13T14:00:00.000Z', foto_ids: [], observacao: null, ...extra });
const atualizacoes = (c) => c.filter((x) => /^update core\.tarefa_destinatario/.test(x.sql));
describe('rotas de tarefas (RF-CORE-18)', () => {
    const resumo = rotasDeTarefas.map((r) => `${r.metodo} ${r.caminho} ${r.acao} ${r.superficie}`);
    it('cada rota exige a ação do desenho §6.1 e é só do BKO (superfície bko)', () => {
        expect(resumo).toEqual([
            'POST tarefas tarefa.criar bko',
            'GET tarefas tarefa.acompanhar bko',
            'GET tarefas/por-consultor tarefa.acompanhar bko',
            'GET tarefas/questionarios tarefa.criar bko',
            'GET tarefas/:id tarefa.acompanhar bko',
            'PATCH tarefas/:id tarefa.editar bko',
            'POST tarefas/:id/cancelar tarefa.cancelar bko',
        ]);
    });
    it('RN-CORE-04: a criação confere a carteira do cliente de quem cria (função do corpo); as leituras filtram no domínio', () => {
        const criar = rotasDeTarefas[0];
        const cliente = '0e100000-0000-4000-8000-0000000000c0';
        expect(criar.carteira({ corpo: { cliente_id: cliente }, query: {}, params: {} })).toBe(cliente);
        expect(criar.carteira({ corpo: { cliente_id: null }, query: {}, params: {} })).toBeNull();
        expect(rotasDeTarefas.slice(1).filter((r) => r.metodo === 'GET' && r.caminho !== 'tarefas/questionarios').every((r) => r.carteira === 'filtrar_no_dominio')).toBe(true);
        expect(criar.status).toBe(201);
    });
    it('o corpo do POST é o do contrato: só a pesquisa leva questionário; o id vem do cliente (idempotência); campo estranho é recusado', () => {
        const base = { id: CMD, titulo: 'Tarefa', prazo: '2026-11-20', tipo: 'simples', destino: { alvo: 'todos' } };
        expect(CriarTarefaSchema.safeParse(base).success).toBe(true);
        expect(CriarTarefaSchema.safeParse({ ...base, tipo: 'pesquisa' }).success).toBe(false);
        expect(CriarTarefaSchema.safeParse({ ...base, questionario_id: T1 }).success).toBe(false);
        expect(CriarTarefaSchema.safeParse({ ...base, pedido_id: T1 }).success).toBe(false); // RN-PRO-01: nenhum tipo de tarefa carrega pedido
        expect(CriarTarefaSchema.safeParse({ ...base, id: undefined }).success).toBe(false);
    });
});
describe('receberConclusoesTarefa (push tarefa_conclusao)', () => {
    it('comando inválido ou id da fila diferente do payload é rejeitado sem tocar o banco', async () => {
        const a = ambiente(linhaPadrao);
        const r = await receberConclusoesTarefa(a.ctx, [
            item(comando(), { id: '0e100000-0000-4000-8000-0000000000c9' }),
            item({ id: CMD }),
            item(comando({ foto_ids: [1] })),
            item(comando(), { operacao: 'remover' }),
        ]);
        expect(r.map((x) => (x.status === 'rejeitado' ? x.codigo : x.status))).toEqual(['PAYLOAD_INVALIDO', 'PAYLOAD_INVALIDO', 'PAYLOAD_INVALIDO', 'OPERACAO_NAO_SUPORTADA']);
        expect(a.transacoes()).toBe(0);
    });
    it('RN-CORE-TAR-06: tarefa simples concluída grava a hora do aparelho e a do servidor, o id do comando e publica o evento sem título', async () => {
        const a = ambiente(linhaPadrao);
        expect(await receberConclusoesTarefa(a.ctx, [item(comando({ observacao: 'Feito' }))])).toEqual([{ id: CMD, status: 'aceito' }]);
        const [u] = atualizacoes(a.chamadas);
        expect(u.valores).toEqual([D1, '2026-11-13T14:00:00.000Z', AGORA.toISOString(), CMD, 'Feito', false]);
        expect(a.eventos).toHaveLength(1);
        expect(a.eventos[0].nome).toBe('core.tarefa.concluida@1');
        expect(a.eventos[0].payload).toMatchObject({ tarefa_id: T1, tarefa_destinatario_id: D1, usuario_id: U1, tipo: 'simples', no_prazo: true, fotos_total: 0, resposta_id: null, suspeita: false });
        expect(Object.keys(a.eventos[0].payload)).not.toContain('titulo');
    });
    it('RN-CORE-TAR-06: relógio mais de 24 h adiantado grava suspeita; o prazo conta pelo dia do tenant (fim do dia em Manaus)', async () => {
        const a = ambiente(linhaPadrao);
        await receberConclusoesTarefa(a.ctx, [item(comando({ concluida_em: '2026-11-15T14:00:00.000Z' }))]);
        expect(atualizacoes(a.chamadas)[0].valores[5]).toBe(true);
        const b = ambiente({ ...linhaPadrao, prazo: '2026-11-13' });
        await receberConclusoesTarefa(b.ctx, [item(comando({ concluida_em: '2026-11-14T02:00:00.000Z' }))]); // 22h de 13/11 em Manaus
        expect(b.eventos[0].payload.no_prazo).toBe(true);
        const c = ambiente({ ...linhaPadrao, prazo: '2026-11-13' });
        await receberConclusoesTarefa(c.ctx, [item(comando({ concluida_em: '2026-11-14T05:00:00.000Z' }))]); // 01h de 14/11 em Manaus
        expect(c.eventos[0].payload.no_prazo).toBe(false);
    });
    it('idempotência: linha já concluída responde aceito sem gravar nem publicar; corrida em que o update não pega nada também não publica', async () => {
        const a = ambiente({ ...linhaPadrao, concluida_em: '2026-11-13T10:00:00.000Z' });
        expect(await receberConclusoesTarefa(a.ctx, [item(comando())])).toEqual([{ id: CMD, status: 'aceito' }]);
        expect(atualizacoes(a.chamadas)).toHaveLength(0);
        expect(a.eventos).toHaveLength(0);
        const b = ambiente(linhaPadrao, { rowCount: 0 });
        expect(await receberConclusoesTarefa(b.ctx, [item(comando())])).toEqual([{ id: CMD, status: 'aceito' }]);
        expect(b.eventos).toHaveLength(0);
    });
    it('linha de outro usuário ou inexistente: TAREFA_NAO_ENCONTRADA (a mesma resposta para as duas)', async () => {
        for (const linha of [{ ...linhaPadrao, usuario_id: U2 }, null]) {
            const a = ambiente(linha);
            const [r] = await receberConclusoesTarefa(a.ctx, [item(comando())]);
            expect(r).toMatchObject({ status: 'rejeitado', codigo: 'TAREFA_NAO_ENCONTRADA' });
            expect(atualizacoes(a.chamadas)).toHaveLength(0);
        }
    });
    it('RN-CORE-TAR-05: foto exige de 1 a 5 fotos sem repetir e registra cada arquivo; as outras tarefas não levam foto', async () => {
        const foto = { ...linhaPadrao, tipo: 'foto', cliente_id: T1 };
        const sem = ambiente(foto);
        expect((await receberConclusoesTarefa(sem.ctx, [item(comando())]))[0]).toMatchObject({ status: 'rejeitado', codigo: 'RN-CORE-TAR-05' });
        const repetida = ambiente(foto);
        expect((await receberConclusoesTarefa(repetida.ctx, [item(comando({ foto_ids: [FOTO1, FOTO1] }))]))[0]).toMatchObject({ codigo: 'RN-CORE-TAR-05' });
        const ok = ambiente(foto);
        expect(await receberConclusoesTarefa(ok.ctx, [item(comando({ foto_ids: [FOTO1, FOTO2] }))])).toEqual([{ id: CMD, status: 'aceito' }]);
        expect(ok.arquivos).toEqual([
            { id: FOTO1, finalidade: 'tarefa', entidade: 'tarefa_destinatario', entidade_id: D1, cliente_id: T1, tipo: 'image/jpeg' },
            { id: FOTO2, finalidade: 'tarefa', entidade: 'tarefa_destinatario', entidade_id: D1, cliente_id: T1, tipo: 'image/jpeg' },
        ]);
        expect(ok.eventos[0].payload.fotos_total).toBe(2);
        const simplesComFoto = ambiente(linhaPadrao);
        expect((await receberConclusoesTarefa(simplesComFoto.ctx, [item(comando({ foto_ids: [FOTO1] }))]))[0]).toMatchObject({ codigo: 'RN-CORE-TAR-05' });
    });
    it('o arquivo já ligado a outra entidade (409 da plataforma) rejeita só este item, com o código', async () => {
        const a = ambiente({ ...linhaPadrao, tipo: 'foto' }, { arquivoFalha: new ErroHttpModulo(409, 'ARQUIVO_JA_REFERENCIADO', 'Esta foto já foi usada.') });
        expect((await receberConclusoesTarefa(a.ctx, [item(comando({ foto_ids: [FOTO1] }))]))[0]).toMatchObject({ status: 'rejeitado', codigo: 'ARQUIVO_JA_REFERENCIADO' });
        expect(a.eventos).toHaveLength(0);
    });
    it('RN-CORE-TAR-03: a tarefa de pesquisa se conclui pela resposta; o comando do aparelho é recusado', async () => {
        const a = ambiente({ ...linhaPadrao, tipo: 'pesquisa' });
        expect((await receberConclusoesTarefa(a.ctx, [item(comando())]))[0]).toMatchObject({ status: 'rejeitado', codigo: 'RN-CORE-TAR-03' });
    });
    it('RN-CORE-TAR-08: tarefa cancelada antes da conclusão chegar é aceita (não trava a fila), mas sem evento', async () => {
        const a = ambiente({ ...linhaPadrao, cancelada_em: '2026-11-13T13:00:00.000Z' });
        expect(await receberConclusoesTarefa(a.ctx, [item(comando())])).toEqual([{ id: CMD, status: 'aceito' }]);
        expect(atualizacoes(a.chamadas)).toHaveLength(1);
        expect(a.eventos).toHaveLength(0);
    });
    it('um item que falha não derruba os outros do lote', async () => {
        const a = ambiente(linhaPadrao);
        const r = await receberConclusoesTarefa(a.ctx, [item(comando({ foto_ids: [FOTO1] })), item(comando({ id: '0e100000-0000-4000-8000-0000000000c2' }))]);
        expect(r.map((x) => x.status)).toEqual(['rejeitado', 'aceito']);
    });
});
