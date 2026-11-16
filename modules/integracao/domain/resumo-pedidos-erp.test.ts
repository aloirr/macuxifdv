import { describe, expect, it } from 'vitest';
import { ResumoPedidosErp } from '../contracts';
import { resumoPedidosErp } from './resumo-pedidos-erp';

describe('RN-INT-08: números dos cards de pedidos no ERP', () => {
  it('RN-INT-08: Na fila = pendente, Entregue ao Conector = enviado, Rejeitado = rejeitado_erp; presos e retidos à parte', () => {
    const r = resumoPedidosErp({ por_estado: { pendente: 4, enviado: 2, rejeitado_erp: 1, integrado: 50 }, presos: 3, retidos: 5 });
    expect(r).toEqual({ na_fila: 4, entregue_ao_conector: 2, rejeitado_pelo_erp: 1, presos_sem_retorno: 3, retidos_sem_mapeamento: 5 });
    expect(ResumoPedidosErp.safeParse(r).success).toBe(true);
  });

  it('RN-INT-08: estado ausente conta zero', () => {
    expect(resumoPedidosErp({ por_estado: {}, presos: 0, retidos: 0 })).toEqual({ na_fila: 0, entregue_ao_conector: 0, rejeitado_pelo_erp: 0, presos_sem_retorno: 0, retidos_sem_mapeamento: 0 });
  });
});
