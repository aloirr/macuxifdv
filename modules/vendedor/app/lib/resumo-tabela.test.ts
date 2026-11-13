import { describe, expect, it } from 'vitest';

import { dividirPagamentoPrazo, itensDoResumoEmTabela, textoDoFrete } from './resumo-tabela';
import type { LinhaDoPedido } from './novo-pedido';

describe('RN-VEN-42 (T-0150): Resumo em tabela', () => {
  it('RN-VEN-24: pagamento e prazo saem em duas linhas da tabela Venda', () => {
    expect(dividirPagamentoPrazo('Boleto · 28/56 dias')).toEqual({ pagamento: 'Boleto', prazo: '28/56 dias' });
    expect(dividirPagamentoPrazo('Pix')).toEqual({ pagamento: 'Pix', prazo: '—' });
    expect(dividirPagamentoPrazo('  ')).toEqual({ pagamento: '—', prazo: '—' });
  });

  it('RN-VEN-16: frete CIF sem transportadora; FOB com o nome', () => {
    expect(textoDoFrete('CIF', 'Rio Negro')).toBe('CIF');
    expect(textoDoFrete('FOB', ' Transportes Rio Negro ')).toBe('FOB · Transportes Rio Negro');
    expect(textoDoFrete('FOB', null)).toBe('FOB');
  });

  it('RN-VEN-42: item do Resumo mostra a embalagem vendida, o preço de tabela e o % do item (também no ajuste em R$)', () => {
    const l = {
      chave: 'a', product_id: 'p1', unidade_sigla: 'FD', quantity: 2, preco_tabela_cents: 3_600, total_cents: 6_480,
      equivalente: { sentido: 'desconto', cents: 720, pct_exibicao: 10 },
    } as unknown as LinhaDoPedido;
    const [i] = itensDoResumoEmTabela([l], () => 'Açúcar cristal 1 kg', () => 'ACU-1K');
    expect(i).toMatchObject({ key: 'a', codigo: 'ACU-1K', ajuste: '−10,0%' });
    expect(i!.valorTabela).not.toContain('R$');
  });
});
