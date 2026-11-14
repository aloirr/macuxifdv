import { describe, expect, it, vi } from 'vitest';

import type { NotificacaoSync } from '../../contracts';
import { montarRecadosETarefas } from '../../domain/tarefas/recados-e-tarefas';
import { contarSino } from '../telas/inicio/inicio-campo';
import { criarLeiturasLocais, leiturasDoMotor } from './leituras-locais';
import { montarCaixa } from './notificacoes';

const U = '0e400000-0000-4000-8000-000000000001';
const recado: NotificacaoSync = {
  id: '0e400000-0000-4000-8000-000000000011',
  updated_at: '2030-01-01T10:00:00.000000Z',
  deleted_at: null,
  external_id: null,
  usuario_id: U,
  tipo: 'recado',
  titulo: 't11',
  corpo: 'c',
  origem_modulo: 'core',
  prioridade: 'normal',
  lida_em: null,
  expira_em: null,
};
const AGORA = new Date('2030-02-01T00:00:00Z');
const LEITURA = { entidade: 'notificacao_leitura', payload: { id: U, notificacao_id: recado.id, lida_em: '2030-01-31T09:00:00.000Z' } };
const sino = (caixa: ReturnType<typeof montarCaixa>) =>
  contarSino(montarRecadosETarefas(caixa, [], [], { agora: AGORA, fuso: 'America/Manaus' })).total;

describe('RF-CORE-09: o sino zera na primeira abertura do recado', () => {
  it('reproduz o defeito: sem a leitura local, o aceito solto com a linha antiga volta o sino a 1', () => {
    expect(sino(montarCaixa([recado], [LEITURA], AGORA))).toBe(0);
    expect(sino(montarCaixa([recado], [], AGORA))).toBe(1);
  });

  it('com a leitura registrada no aparelho: 0 antes da fila, na fila e no intervalo do aceito solto', () => {
    const l = criarLeiturasLocais();
    l.registrar(recado.id, '2030-01-31T09:00:00.000Z');
    expect(sino(montarCaixa([recado], [], AGORA, l.lidas()))).toBe(0);
    expect(sino(montarCaixa([recado], [LEITURA], AGORA, l.lidas()))).toBe(0);
    const [x] = montarCaixa([recado], [], AGORA, l.lidas());
    expect(x).toMatchObject({ lida_em: '2030-01-31T09:00:00.000Z', leituraPendente: true });
  });

  it('quando a linha volta com lida_em do servidor, vale a hora do servidor e não há pendência', () => {
    const l = criarLeiturasLocais();
    l.registrar(recado.id, '2030-01-31T09:00:00.000Z');
    const [x] = montarCaixa([{ ...recado, lida_em: '2030-01-31T09:00:05.000Z' }], [], AGORA, l.lidas());
    expect(x).toMatchObject({ lida_em: '2030-01-31T09:00:05.000Z', leituraPendente: false });
  });

  it('desfazer (a fila não gravou) devolve o recado a não lido', () => {
    const l = criarLeiturasLocais();
    l.registrar(recado.id, '2030-01-31T09:00:00.000Z');
    l.desfazer(recado.id);
    expect(sino(montarCaixa([recado], [], AGORA, l.lidas()))).toBe(1);
  });

  it('assinar avisa uma vez mesmo com registrar repetido (primeira hora vale) e não avisa depois de sair', () => {
    const l = criarLeiturasLocais();
    const fn = vi.fn();
    const sair = l.assinar(fn);
    l.registrar(recado.id, 'a');
    l.registrar(recado.id, 'b');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(l.lidas().get(recado.id)).toBe('a');
    sair();
    l.desfazer(recado.id);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('a lista é por motor: outro motor (outro usuário) começa vazio', () => {
    const m1 = {};
    leiturasDoMotor(m1).registrar(recado.id, 'a');
    expect(leiturasDoMotor(m1).lidas().size).toBe(1);
    expect(leiturasDoMotor({}).lidas().size).toBe(0);
  });
});
