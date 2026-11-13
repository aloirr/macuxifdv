import { describe, expect, it } from 'vitest';
import type { TarefaSync } from '../../contracts/tarefa';
import { montarRecadosETarefas, type NotificacaoDaLista } from './recados-e-tarefas';

const U = '0b000000-0000-4000-8000-000000000001';
const id = (p: string, n: number) => `0b000000-0000-4000-8000-${p}${String(n).padStart(12 - p.length, '0')}`;
const FUSO = 'America/Manaus';
const AGORA = new Date('2026-11-13T15:00:00Z'); // 11h de 13/11 em Manaus

const tarefa = (n: number, p: Partial<TarefaSync> = {}): TarefaSync => ({
  id: id('d', n),
  updated_at: `2026-11-1${n}T10:00:00Z`,
  deleted_at: null,
  external_id: null,
  tarefa_id: id('a', n),
  usuario_id: U,
  titulo: `Tarefa ${n}`,
  descricao: null,
  prazo: '2026-11-14',
  tipo: 'simples',
  cliente_id: null,
  cliente_nome: null,
  questionario_id: null,
  autor_nome: 'Gerente',
  autor_perfil: 'gerente',
  concluida_em: null,
  cancelada_em: null,
  ...p,
});
const recado = (n: number, p: Partial<NotificacaoDaLista> = {}): NotificacaoDaLista => ({ id: id('e', n), updated_at: `2026-11-1${n}T09:00:00Z`, lida_em: null, subtipo: null, ...p });
const avisoDe = (t: TarefaSync, p: Partial<NotificacaoDaLista> = {}): NotificacaoDaLista => ({
  id: id('f', Number(t.tarefa_id.slice(-1))),
  updated_at: t.updated_at,
  lida_em: null,
  subtipo: 'tarefa',
  tarefa_id: t.tarefa_id,
  ...p,
});
const conclusaoNaFila = (t: TarefaSync, situacao = 'pendente') => ({
  id: id('c', Number(t.id.slice(-1))),
  entidade: 'tarefa_conclusao',
  situacao,
  payload: { id: id('c', 1), tarefa_destinatario_id: t.id, concluida_em: '2026-11-13T14:00:00.000Z', foto_ids: [], observacao: null },
});
const opcoes = { agora: AGORA, fuso: FUSO };

describe('RN-CORE-TAR-07: montarRecadosETarefas (uma lista só)', () => {
  it('RN-CORE-TAR-07: cada tarefa vira um item; o aviso dela (subtipo tarefa) não aparece, só marca a tarefa como nova', () => {
    const t = tarefa(1);
    const itens = montarRecadosETarefas([avisoDe(t), recado(2)], [t], [], opcoes);
    expect(itens.map((i) => [i.tipo, i.id])).toEqual([
      ['recado', id('e', 2)],
      ['tarefa', t.id],
    ]);
    expect(itens[1]).toMatchObject({ tipo: 'tarefa', situacao: 'aberta', nova: true, aviso_id: id('f', 1), conclusao_pendente: false });
  });
  it('RN-CORE-TAR-07: aviso lido = tarefa não é mais nova; tarefa sem aviso no aparelho também não', () => {
    const t = tarefa(1);
    expect(montarRecadosETarefas([avisoDe(t, { lida_em: '2026-11-13T12:00:00Z' })], [t], [], opcoes)[0]).toMatchObject({ nova: false });
    expect(montarRecadosETarefas([], [t], [], opcoes)[0]).toMatchObject({ nova: false, aviso_id: null });
  });
  it('RN-CORE-TAR-07: aviso de tarefa que ainda não chegou pelo pull não vira item', () => {
    expect(montarRecadosETarefas([avisoDe(tarefa(1))], [], [], opcoes)).toEqual([]);
  });
  it('RN-CORE-TAR-02: atraso calculado offline, com o relógio do aparelho no fuso do tenant', () => {
    const itens = montarRecadosETarefas([], [tarefa(1, { prazo: '2026-11-12' }), tarefa(2, { prazo: '2026-11-13' })], [], opcoes);
    expect(Object.fromEntries(itens.map((i) => [i.id, i.tipo === 'tarefa' && i.situacao]))).toEqual({ [id('d', 1)]: 'atrasada', [id('d', 2)]: 'aberta' });
  });
  it('ADR 0009 §3: conclusão na fila aparece feita antes de sincronizar (e deixa de ser nova)', () => {
    const t = tarefa(1);
    const [item] = montarRecadosETarefas([avisoDe(t)], [t], [conclusaoNaFila(t)], opcoes);
    expect(item).toMatchObject({ situacao: 'feita_no_prazo', conclusao_pendente: true, nova: false });
    expect(item?.tipo === 'tarefa' && item.tarefa.concluida_em).toBe('2026-11-13T14:00:00.000Z');
  });
  it('ADR 0009 §3: conclusão aceita e ainda não trazida pelo pull aparece feita, sem pendência', () => {
    const t = tarefa(1);
    expect(montarRecadosETarefas([], [t], [conclusaoNaFila(t, 'aceito')], opcoes)[0]).toMatchObject({ situacao: 'feita_no_prazo', conclusao_pendente: false });
  });
  it('RN-CORE-TAR-11: tarefa de pesquisa com a Pesquisa desligada = sem módulo', () => {
    const t = tarefa(1, { tipo: 'pesquisa', questionario_id: id('b', 1), prazo: '2026-11-01' });
    expect(montarRecadosETarefas([], [t], [], { ...opcoes, pesquisa_ativa: false })[0]).toMatchObject({ situacao: 'sem_modulo' });
    expect(montarRecadosETarefas([], [t], [], opcoes)[0]).toMatchObject({ situacao: 'atrasada' });
  });
  it('ordem: abertas e não lidas do mais novo para o mais antigo; recados lidos depois; feitas e canceladas no fim', () => {
    const aberta1 = tarefa(1);
    const aberta3 = tarefa(3);
    const feitaAntiga = tarefa(4, { concluida_em: '2026-11-10T12:00:00Z' });
    const feitaNova = tarefa(5, { concluida_em: '2026-11-12T12:00:00Z' });
    const cancelada = tarefa(6, { cancelada_em: '2026-11-12T12:00:00Z' });
    const naoLido = recado(2);
    const lido = recado(7, { lida_em: '2026-11-17T10:00:00Z' });
    const removida = tarefa(8, { deleted_at: '2026-11-13T00:00:00Z' });
    const itens = montarRecadosETarefas([lido, naoLido], [cancelada, feitaAntiga, aberta1, feitaNova, aberta3, removida], [], opcoes);
    expect(itens.map((i) => i.id)).toEqual([aberta3.id, naoLido.id, aberta1.id, lido.id, feitaNova.id, feitaAntiga.id, cancelada.id]);
  });
});
