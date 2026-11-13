import { describe, expect, it } from 'vitest';
import { ConclusaoTarefaSchema, CriarTarefaSchema, TarefaSyncSchema } from './tarefa';

const id = (n: number) => `0a100000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('RF-CORE-18: contratos da tarefa', () => {
  const base = { id: id(1), titulo: ' Conferir validade ', prazo: '2026-11-14', tipo: 'simples', destino: { alvo: 'todos' } };
  it('RN-CORE-TAR-03: questionário só (e sempre) na tarefa de pesquisa', () => {
    expect(CriarTarefaSchema.parse(base)).toMatchObject({ titulo: 'Conferir validade', descricao: null, cliente_id: null, questionario_id: null });
    expect(CriarTarefaSchema.safeParse({ ...base, tipo: 'pesquisa' }).success).toBe(false);
    expect(CriarTarefaSchema.safeParse({ ...base, tipo: 'pesquisa', questionario_id: id(9) }).success).toBe(true);
    expect(CriarTarefaSchema.safeParse({ ...base, questionario_id: id(9) }).success).toBe(false);
  });
  it('RN-CORE-TAR-02: prazo é data civil válida', () => {
    expect(CriarTarefaSchema.safeParse({ ...base, prazo: '2026-02-30' }).success).toBe(false);
    expect(CriarTarefaSchema.safeParse({ ...base, prazo: '14/11/2026' }).success).toBe(false);
  });
  it('RN-CORE-TAR-01: destino é um de pessoas, equipe ou todos', () => {
    expect(CriarTarefaSchema.safeParse({ ...base, destino: { alvo: 'usuarios', usuario_ids: [] } }).success).toBe(false);
    expect(CriarTarefaSchema.safeParse({ ...base, destino: { alvo: 'equipe', equipe_id: id(5) } }).success).toBe(true);
    expect(CriarTarefaSchema.safeParse({ ...base, destino: { alvo: 'equipe' } }).success).toBe(false);
  });
  it('RN-CORE-TAR-05: a conclusão leva no máximo 5 fotos', () => {
    const c = { id: id(1), tarefa_destinatario_id: id(2), concluida_em: '2026-11-13T12:00:00.000Z' };
    expect(ConclusaoTarefaSchema.parse(c)).toMatchObject({ foto_ids: [], observacao: null });
    expect(ConclusaoTarefaSchema.safeParse({ ...c, foto_ids: [1, 2, 3, 4, 5, 6].map(id) }).success).toBe(false);
  });
  it('RF-CORE-18: linha do pull `tarefa` é estrita', () => {
    const l = {
      id: id(1),
      updated_at: '2026-11-13T12:00:00Z',
      deleted_at: null,
      external_id: null,
      tarefa_id: id(2),
      usuario_id: id(3),
      titulo: 'T',
      descricao: null,
      prazo: '2026-11-14',
      tipo: 'foto',
      cliente_id: null,
      cliente_nome: null,
      questionario_id: null,
      autor_nome: null,
      autor_perfil: 'gerente',
      concluida_em: null,
      cancelada_em: null,
    };
    expect(TarefaSyncSchema.safeParse(l).success).toBe(true);
    expect(TarefaSyncSchema.safeParse({ ...l, extra: 1 }).success).toBe(false);
  });
});
