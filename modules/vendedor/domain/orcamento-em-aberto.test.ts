import { describe, expect, it } from 'vitest';
import { orcamentosEmAberto, TEXTO_SEM_ORCAMENTO_EM_ABERTO, type DocumentoParaEscolha } from './orcamento-em-aberto';

const base: DocumentoParaEscolha = { id: 'o1', tipo: 'orcamento', status: 'received', convertido_pedido_id: null, vendedor_id: 'v1', numero: 'ORC-1', cliente_nome: 'Atacadinho', criado_em: '2026-11-10T12:00:00.000Z' };

describe('Adicionar ao orçamento: quais orçamentos estão em aberto (RN-VEN-18, RN-VEN-30)', () => {
  it('RN-VEN-30: só o orçamento aberto entra (aberto → convertido ou cancelado)', () => {
    const docs = [
      base,
      { ...base, id: 'o2', convertido_pedido_id: 'p9' },
      { ...base, id: 'o3', status: 'cancelled' },
    ];
    expect(orcamentosEmAberto(docs, 'v1').map((o) => o.id)).toEqual(['o1']);
  });
  it('RN-VEN-18: pedido nunca entra, mesmo na fila', () => {
    expect(orcamentosEmAberto([{ ...base, tipo: 'pedido' }, { ...base, id: 'p2', tipo: undefined }], 'v1')).toEqual([]);
  });
  it('RN-VEN-18: o orçamento não vence: o mais antigo continua em aberto', () => {
    expect(orcamentosEmAberto([{ ...base, criado_em: '2025-01-01T00:00:00.000Z' }], 'v1')).toHaveLength(1);
  });
  it('RN-VEN-18: só os orçamentos do próprio vendedor (a Gestão não edita orçamento de outro vendedor)', () => {
    expect(orcamentosEmAberto([base, { ...base, id: 'o2', vendedor_id: 'v2' }], 'v1').map((o) => o.id)).toEqual(['o1']);
  });
  it('ordena do mais novo ao mais antigo e entrega número, cliente e data', () => {
    const r = orcamentosEmAberto([base, { ...base, id: 'o2', numero: 'ORC-2', criado_em: '2026-11-12T12:00:00.000Z' }], 'v1');
    expect(r.map((o) => o.id)).toEqual(['o2', 'o1']);
    expect(r[0]).toEqual({ id: 'o2', numero: 'ORC-2', cliente_nome: 'Atacadinho', criado_em: '2026-11-12T12:00:00.000Z' });
  });
  it('orçamento ainda na fila (sem número do servidor) entra com número vazio para a tela dar o rótulo', () => {
    expect(orcamentosEmAberto([{ ...base, numero: '' }], 'v1')[0]?.numero).toBe('');
  });
  it('sem nenhum em aberto o texto é só "Nenhum orçamento em aberto."', () => {
    expect(orcamentosEmAberto([], 'v1')).toEqual([]);
    expect(TEXTO_SEM_ORCAMENTO_EM_ABERTO).toBe('Nenhum orçamento em aberto.');
  });
});
