import { describe, expect, it } from 'vitest';
import type { ConclusaoTarefa } from '../../contracts/tarefa';
import { decidirConclusao, desmarcarTarefa, type LinhaParaConcluir } from './conclusao';

const U = '0d000000-0000-4000-8000-000000000001';
const OUTRO = '0d000000-0000-4000-8000-000000000002';
const DEST = '0d000000-0000-4000-8000-0000000000d1';
const CMD = '0d000000-0000-4000-8000-0000000000c1';
const CMD2 = '0d000000-0000-4000-8000-0000000000c2';
const foto = (n: number) => `0d000000-0000-4000-8000-0000000000f${n}`;
const AGORA = new Date('2026-11-13T12:00:00Z');
const ctx = { usuario_id: U, agora: AGORA };

const linha = (p: Partial<LinhaParaConcluir> = {}): LinhaParaConcluir => ({ id: DEST, usuario_id: U, tipo: 'simples', concluida_em: null, cancelada_em: null, ...p });
const cmd = (p: Partial<ConclusaoTarefa> = {}): ConclusaoTarefa => ({ id: CMD, tarefa_destinatario_id: DEST, concluida_em: '2026-11-13T11:00:00.000Z', foto_ids: [], observacao: null, ...p });

describe('RN-CORE-TAR-03/05/06/08: decidirConclusao (receber de tarefa_conclusao)', () => {
  it('RN-CORE-TAR-01 (D3): cada um conclui a sua — a linha é do consultor da sessão', () => {
    expect(decidirConclusao(linha(), cmd(), ctx)).toEqual({ acao: 'gravar', suspeita: false, conta: true });
  });
  it('RN-CORE-TAR-01: linha de outro consultor recebe a mesma resposta de linha inexistente', () => {
    expect(decidirConclusao(linha({ usuario_id: OUTRO }), cmd(), ctx)).toEqual({ acao: 'recusar', codigo: 'TAREFA_NAO_ENCONTRADA' });
    expect(decidirConclusao(null, cmd(), ctx)).toEqual({ acao: 'recusar', codigo: 'TAREFA_NAO_ENCONTRADA' });
  });
  it('RN-CORE-TAR-05 (D5): tarefa de foto conclui com 1 a 5 fotos, sem exigir check-in no cliente', () => {
    expect(decidirConclusao(linha({ tipo: 'foto' }), cmd({ foto_ids: [foto(1)] }), ctx).acao).toBe('gravar');
    expect(decidirConclusao(linha({ tipo: 'foto' }), cmd({ foto_ids: [1, 2, 3, 4, 5].map(foto) }), ctx).acao).toBe('gravar');
  });
  it('RN-CORE-TAR-05: foto sem foto, com mais de 5 ou repetida = recusa; simples com foto = recusa', () => {
    expect(decidirConclusao(linha({ tipo: 'foto' }), cmd(), ctx)).toEqual({ acao: 'recusar', codigo: 'RN-CORE-TAR-05' });
    expect(decidirConclusao(linha({ tipo: 'foto' }), cmd({ foto_ids: [1, 2, 3, 4, 5, 6].map(foto) }), ctx)).toEqual({ acao: 'recusar', codigo: 'RN-CORE-TAR-05' });
    expect(decidirConclusao(linha({ tipo: 'foto' }), cmd({ foto_ids: [foto(1), foto(1)] }), ctx)).toEqual({ acao: 'recusar', codigo: 'RN-CORE-TAR-05' });
    expect(decidirConclusao(linha(), cmd({ foto_ids: [foto(1)] }), ctx)).toEqual({ acao: 'recusar', codigo: 'RN-CORE-TAR-05' });
  });
  it('RN-CORE-TAR-03: pesquisa não tem comando de conclusão (conclui pela resposta)', () => {
    expect(decidirConclusao(linha({ tipo: 'pesquisa' }), cmd(), ctx)).toEqual({ acao: 'recusar', codigo: 'RN-CORE-TAR-03' });
  });
  it('RN-CORE-TAR-06: reenvio do mesmo comando = aceito sem gravar; outro comando para linha já concluída = vale a primeira', () => {
    expect(decidirConclusao(linha({ concluida_em: '2026-11-13T11:00:00Z' }), cmd(), ctx)).toEqual({ acao: 'nada' });
    expect(decidirConclusao(linha({ concluida_em: '2026-11-13T11:00:00Z' }), cmd({ id: CMD2 }), ctx)).toEqual({ acao: 'nada' });
  });
  it('RN-CORE-TAR-06: relógio adiantado mais de 24 h é aceito e sinalizado como suspeito, nunca recusado', () => {
    expect(decidirConclusao(linha(), cmd({ concluida_em: '2026-11-14T12:00:01.000Z' }), ctx)).toEqual({ acao: 'gravar', suspeita: true, conta: true });
    expect(decidirConclusao(linha(), cmd({ concluida_em: '2026-11-14T12:00:00.000Z' }), ctx)).toMatchObject({ suspeita: false });
  });
  it('RN-CORE-TAR-08: conclusão que chega depois do cancelamento é aceita e gravada, mas não conta', () => {
    expect(decidirConclusao(linha({ cancelada_em: '2026-11-13T10:00:00Z' }), cmd(), ctx)).toEqual({ acao: 'gravar', suspeita: false, conta: false });
  });
});

describe('RN-CORE-TAR-02 (D4): desmarcar só antes de sincronizar', () => {
  const item = (p: Record<string, unknown> = {}) => ({ id: CMD, entidade: 'tarefa_conclusao', payload: cmd(), situacao: 'pendente', ...p });
  it('D4: com a conclusão ainda na fila, desmarcar descarta o(s) comando(s) dessa linha', () => {
    const fila = [item(), item({ id: CMD2, situacao: 'falhou' }), { id: 'x', entidade: 'notificacao_leitura', payload: {}, situacao: 'pendente' }];
    expect(desmarcarTarefa(linha(), fila)).toEqual({ ok: true, descartar: [CMD, CMD2] });
  });
  it('D4: não mexe em conclusão de outra tarefa', () => {
    const outra = item({ payload: cmd({ tarefa_destinatario_id: '0d000000-0000-4000-8000-0000000000d2' }) });
    expect(desmarcarTarefa(linha(), [outra])).toEqual({ ok: false, motivo: 'nao_marcada' });
  });
  it('D4: depois que o servidor aceitou (ou o pull trouxe a conclusão), não há desfazer no app', () => {
    expect(desmarcarTarefa(linha(), [item({ situacao: 'aceito' })])).toEqual({ ok: false, motivo: 'ja_sincronizada' });
    expect(desmarcarTarefa(linha({ concluida_em: '2026-11-13T11:00:00Z' }), [])).toEqual({ ok: false, motivo: 'ja_sincronizada' });
  });
});
