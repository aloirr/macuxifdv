/**
 * T-0059 (R-20261102-090915 item 3): a etapa técnica em que a carga parou vai para o Diagnóstico, não para a tela.
 */
import { describe, expect, it } from 'vitest';

import { observarFalhasDeSync, type FalhaSync } from './diagnostico-sync';

const QUANDO = new Date('2026-11-02T13:00:00.000Z');

describe('observarFalhasDeSync', () => {
  it('guarda a etapa em que estava quando o motor zerou a etapa e registrou o erro', () => {
    const falhas: FalhaSync[] = [];
    const ouvir = observarFalhasDeSync((f) => falhas.push(f), () => QUANDO);
    ouvir({ sincronizando: true, etapa: 'Enviando a fila', erro: null });
    ouvir({ sincronizando: true, etapa: 'cliente_condicao', erro: null });
    ouvir({ sincronizando: false, etapa: '', erro: 'HTTP 500 em /v1/sync/pull' });
    // a mesma falha notificada de novo (outra mudança de estado) não duplica
    ouvir({ sincronizando: false, etapa: '', erro: 'HTTP 500 em /v1/sync/pull' });
    expect(falhas).toEqual([{ quando: QUANDO.toISOString(), etapa: 'cliente_condicao', mensagem: 'HTTP 500 em /v1/sync/pull' }]);
  });

  it('nova tentativa com o mesmo erro registra de novo; erro sem carga em andamento fica sem etapa', () => {
    const falhas: FalhaSync[] = [];
    const ouvir = observarFalhasDeSync((f) => falhas.push(f), () => QUANDO);
    ouvir({ sincronizando: false, etapa: '', erro: 'Sem sinal' });
    ouvir({ sincronizando: true, etapa: 'pedido', erro: null });
    ouvir({ sincronizando: false, etapa: '', erro: 'Sem sinal' });
    expect(falhas.map((f) => f.etapa)).toEqual([null, 'pedido']);
  });
});
