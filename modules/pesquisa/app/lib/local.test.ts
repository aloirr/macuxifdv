import { describe, expect, it } from 'vitest';
import type { ItemSobreposicao, LinhaSync } from '@macuxi/platform-sdk';
import type { QuestionarioVersao, QuestionarioVersaoSync, RespostaEnvio } from '../../contracts';
import { publicada, sim_nao, u } from '../../domain/util-teste';
import { definirEstadoLocal, etapaConcluida, etapaDoCheckout, lerRetrato, respostasDaFila } from './local';

const AGORA = new Date('2026-10-31T13:00:00Z');
const obrig = publicada({ titulo: 'Gôndola do mês', modo: 'checkout_obrigatoria', perguntas: [sim_nao(1)] });
const linha = (v: QuestionarioVersao): QuestionarioVersaoSync => ({ id: v.id, updated_at: '2026-10-02T12:00:00.000000Z', deleted_at: null, questionario_id: v.questionario_id, numero: v.numero, status: v.status, arquivado_em: null, questionario_criado_em: '2026-10-01T00:00:00Z', versao: v });
const VISITA = u(61);
const CLIENTE = u(51);
const ctx = { clienteId: CLIENTE, visitaId: VISITA };
const envio: RespostaEnvio = { id: u(5000), questionario_id: obrig.questionario_id, versao_id: obrig.id, cliente_id: CLIENTE, visita_id: VISITA, respondida_em: '2026-10-31T12:59:00Z', itens: [{ pergunta_id: u(1), tipo: 'sim_nao', valor: true }] };
const naFila = (payload: unknown, entidade = 'resposta_pesquisa'): ItemSobreposicao => ({ id: u(5000), entidade, modulo: 'pesquisa', operacao: 'upsert', payload, rotulo: '', detalhe: '', criado_em: '', tentativas: 0, ultimo_erro: '', ultima_tentativa_em: null, situacao: 'pendente', codigo: null });

function leitor(linhas: Record<string, unknown[]>, fila: ItemSobreposicao[] = []) {
  return {
    linhas: async <L extends LinhaSync>(e: string) => (linhas[e] ?? []) as L[],
    sobreposicao: () => fila,
  };
}

async function carregar(fila: ItemSobreposicao[] = []) {
  const l = leitor({ questionario_versao: [linha(obrig)], cliente: [{ id: CLIENTE, segmento: 'Varejo', deleted_at: null }] }, fila);
  definirEstadoLocal({ retrato: await lerRetrato(l), leitor: l, usuario: { id: u(31), perfil: 'vendedor', equipe_ids: [] }, fuso: 'America/Manaus', agora: () => AGORA });
}

describe('RN-PES-03: etapa obrigatória do checkout no aparelho (offline)', () => {
  it('RN-PES-03: sem o retrato carregado a etapa fica pendente (falha fechada)', () => {
    definirEstadoLocal(null);
    expect(etapaConcluida(ctx)).toBe(false);
  });

  it('RN-CORE-14: cliente fechado dispensa a pesquisa mesmo sem retrato', () => {
    definirEstadoLocal(null);
    expect(etapaConcluida({ ...ctx, clienteFechado: true })).toBe(true);
    expect(etapaConcluida({ ...ctx, motivoClienteFechado: 'acesso_negado' })).toBe(true);
  });

  it('RN-PES-03: pesquisa obrigatória aplicável e não respondida nesta visita bloqueia o checkout', async () => {
    await carregar();
    expect(etapaConcluida(ctx)).toBe(false);
    expect(etapaDoCheckout(ctx)?.mensagem).toBe('Responda a pesquisa "Gôndola do mês" para concluir o checkout.');
  });

  it('RF-PES-04: a resposta ainda na fila do aparelho já libera o checkout (offline)', async () => {
    await carregar([naFila(envio)]);
    expect(etapaConcluida(ctx)).toBe(true);
  });

  it('item de outra entidade ou payload inválido na fila é ignorado', () => {
    expect(respostasDaFila([naFila(envio, 'pedido'), naFila({ id: 'x' })])).toEqual([]);
    expect(respostasDaFila([naFila(envio)])).toEqual([envio]);
  });

  it('RF-PES-02: o segmento do cliente vem das linhas do Core', async () => {
    const r = await lerRetrato(leitor({ cliente: [{ id: CLIENTE, segmento: 'Varejo', deleted_at: null }, { id: u(52), segmento: 'X', deleted_at: '2026-10-01T00:00:00Z' }] }));
    expect([...r.clientes.values()]).toEqual([{ id: CLIENTE, segmento: 'Varejo', regiao: null }]);
  });
});
