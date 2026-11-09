import { describe, expect, it } from 'vitest';
import { RASCUNHO_VALIDADE_HORAS, limparRascunhosExpirados, rascunhoExpirou, rascunhosParaLista, type RascunhoMinimo } from './rascunhos';

const HORA = 3_600_000;
const T0 = '2026-11-09T10:00:00.000Z';
const depois = (iso: string, ms: number) => new Date(Date.parse(iso) + ms);
const r = (extra: Partial<RascunhoMinimo> = {}): RascunhoMinimo => ({ customer_id: 'c1', lines: { p1: 2 }, updated_at: T0, ...extra });

describe('RN-VEN-39: rascunho some 24 h depois da última alteração', () => {
  it('RN-VEN-39: a validade é de 24 horas', () => {
    expect(RASCUNHO_VALIDADE_HORAS).toBe(24);
  });

  it('RN-VEN-39: com 23 h 59 min ainda existe; com 24 h + 1 min some (relógio injetado)', () => {
    expect(rascunhoExpirou(r(), depois(T0, 24 * HORA - 60_000))).toBe(false);
    expect(rascunhoExpirou(r(), depois(T0, 24 * HORA))).toBe(true);
    expect(rascunhoExpirou(r(), depois(T0, 24 * HORA + 60_000))).toBe(true);
  });

  it('RN-VEN-39: cada alteração renova as 24 h (conta a partir do updated_at)', () => {
    const alterado = r({ updated_at: '2026-11-10T09:00:00.000Z' });
    expect(rascunhoExpirou(alterado, depois(T0, 24 * HORA + 60_000))).toBe(false);
  });

  it('RN-VEN-39: a lista mostra cliente, itens e hora da última alteração, do mais recente ao mais antigo, só os vivos', () => {
    const lista = rascunhosParaLista(
      {
        a: r({ customer_id: 'c1', updated_at: '2026-11-09T10:00:00.000Z', lines: { p1: 2, p2: 1 } }),
        b: r({ customer_id: 'c2', updated_at: '2026-11-09T12:00:00.000Z' }),
        velho: r({ customer_id: 'c3', updated_at: '2026-11-07T12:00:00.000Z' }),
      },
      new Date('2026-11-09T13:00:00.000Z'),
    );
    expect(lista).toEqual([
      { chave: 'b', customer_id: 'c2', itens: 1, atualizado_em: '2026-11-09T12:00:00.000Z' },
      { chave: 'a', customer_id: 'c1', itens: 2, atualizado_em: '2026-11-09T10:00:00.000Z' },
    ]);
  });

  it('RN-VEN-38: a saída sem a pergunta (Voltar do Android, troca de aba, app em segundo plano) deixa o pedido gravado e ele aparece em Rascunhos para retomar', () => {
    // o app grava o rascunho a cada alteração; sair sem escolher na folha não apaga nem marca nada: só o relógio das 24 h corre
    const saiuSemPergunta = r({ updated_at: '2026-11-09T09:50:00.000Z', lines: { p1: 2, p2: 5 } });
    const lista = rascunhosParaLista({ c5007: saiuSemPergunta }, new Date('2026-11-09T09:52:00.000Z'));
    expect(lista).toEqual([{ chave: 'c5007', customer_id: 'c1', itens: 2, atualizado_em: '2026-11-09T09:50:00.000Z' }]);
    expect(limparRascunhosExpirados({ c5007: saiuSemPergunta }, new Date('2026-11-09T09:52:00.000Z')).mantidos).toHaveProperty('c5007');
  });

  it('RN-VEN-39: rascunho vazio e edição de pedido já salvo não entram na lista', () => {
    const lista = rascunhosParaLista({ vazio: r({ lines: {} }), zero: r({ lines: { p1: 0 } }), 'edit:x': r({ edit_order_id: 'x' }) }, depois(T0, HORA));
    expect(lista).toEqual([]);
  });

  it('RN-VEN-39: a limpeza apaga só os vencidos e devolve o que ficou; quem virou orçamento ou pedido já saiu do mapa e não volta', () => {
    const { mantidos, removidos } = limparRascunhosExpirados({ novo: r({ updated_at: '2026-11-09T12:00:00.000Z' }), velho: r({ updated_at: '2026-11-08T09:00:00.000Z' }) }, new Date('2026-11-09T13:00:00.000Z'));
    expect(Object.keys(mantidos)).toEqual(['novo']);
    expect(removidos).toEqual(['velho']);
  });

  it('RN-VEN-39: a limpeza não mexe na edição de pedido salvo (essa chave não é rascunho de 24 h)', () => {
    const { mantidos, removidos } = limparRascunhosExpirados({ 'edit:p9': r({ edit_order_id: 'p9', updated_at: '2026-10-01T00:00:00.000Z' }) }, new Date('2026-11-09T13:00:00.000Z'));
    expect(Object.keys(mantidos)).toEqual(['edit:p9']);
    expect(removidos).toEqual([]);
  });
});
