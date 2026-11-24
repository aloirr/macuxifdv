/**
 * ADR 0072 (RN-VEN-24, RN-INT-09): `versao_contrato: "v2"` do prazo de pagamento. O prazo médio é digitado no ERP e o Macuxi usa o
 * recebido; cada campo com problema vira UM erro de linha com o código de sempre; a v1 segue como era (descrição gerada, média
 * calculada, aviso quando diverge).
 */
import { describe, expect, it } from 'vitest';
import { validarLinhas } from './idempotencia';

const ok = {
  external_id: 'PRZ-1',
  alterado_em: '2026-11-24T12:00:00Z',
  forma_external_id: 'F1',
  codigo: '28-56',
  descricao: 'Boleto 28/56',
  parcelas_dias: [28, 56],
  prazo_medio_dias: 42,
};
const v2 = (r: Record<string, unknown>) => validarLinhas('prazo_pagamento', [r], 'v2');

describe('RN-VEN-24: prazo_pagamento na v2', () => {
  it('RN-VEN-24: v2 completo é aceito, sem aviso, e leva a descrição e o prazo médio recebidos (não os calculados)', () => {
    const r = v2({ ...ok, prazo_medio_dias: 40, descricao: 'Boleto 28/56' });
    expect(r.erros).toEqual([]);
    expect(r.avisos).toEqual([]);
    expect(r.validas[0]?.registro).toMatchObject({ descricao: 'Boleto 28/56', prazo_medio_dias: 40, parcelas_dias: [28, 56] });
  });

  it('RN-VEN-24: à vista [0] com prazo médio 0 vale', () => {
    expect(v2({ ...ok, parcelas_dias: [0], prazo_medio_dias: 0, descricao: 'À vista' }).erros).toEqual([]);
  });

  it.each([['descricao'], ['prazo_medio_dias'], ['parcelas_dias'], ['codigo'], ['forma_external_id']])(
    'RN-VEN-24: sem %s a linha é recusada com campo_obrigatorio no campo certo (um erro só)',
    (campo) => {
      const resto: Record<string, unknown> = { ...ok };
      delete resto[campo];
      const r = v2(resto);
      expect(r.validas).toEqual([]);
      expect(r.erros).toHaveLength(1);
      expect(r.erros[0]).toMatchObject({ campo, codigo: 'campo_obrigatorio', reprocessavel: false });
    },
  );

  it('RN-VEN-24: campo nulo ou vazio vale como ausente (campo_obrigatorio)', () => {
    expect(v2({ ...ok, prazo_medio_dias: null }).erros[0]).toMatchObject({ campo: 'prazo_medio_dias', codigo: 'campo_obrigatorio' });
    expect(v2({ ...ok, descricao: '   ' }).erros[0]).toMatchObject({ campo: 'descricao', codigo: 'campo_obrigatorio' });
  });

  it('RN-VEN-24: o texto "28/56" em parcelas_dias é tipo_invalido (a lista vem como inteiros)', () => {
    expect(v2({ ...ok, parcelas_dias: '28/56' }).erros[0]).toMatchObject({ campo: 'parcelas_dias', codigo: 'tipo_invalido' });
  });

  it('RN-VEN-24: tipo errado e fora da faixa', () => {
    expect(v2({ ...ok, prazo_medio_dias: '42' }).erros[0]).toMatchObject({ campo: 'prazo_medio_dias', codigo: 'tipo_invalido' });
    expect(v2({ ...ok, prazo_medio_dias: 41.5 }).erros[0]).toMatchObject({ campo: 'prazo_medio_dias', codigo: 'tipo_invalido' });
    expect(v2({ ...ok, prazo_medio_dias: 400 }).erros[0]).toMatchObject({ campo: 'prazo_medio_dias', codigo: 'valor_fora_da_faixa' });
    expect(v2({ ...ok, prazo_medio_dias: -1 }).erros[0]).toMatchObject({ campo: 'prazo_medio_dias', codigo: 'valor_fora_da_faixa' });
    expect(v2({ ...ok, descricao: 'x'.repeat(61) }).erros[0]).toMatchObject({ campo: 'descricao', codigo: 'valor_fora_da_faixa' });
    expect(v2({ ...ok, parcelas_dias: [366] }).erros[0]).toMatchObject({ campo: 'parcelas_dias[0]', codigo: 'valor_fora_da_faixa' });
    expect(v2({ ...ok, parcelas_dias: Array.from({ length: 25 }, (_, i) => i) }).erros[0]).toMatchObject({ campo: 'parcelas_dias', codigo: 'valor_fora_da_faixa' });
  });

  it('RN-VEN-24: parcelas decrescentes e prazo médio fora da faixa das parcelas são regra_invalida, cada um no seu campo', () => {
    expect(v2({ ...ok, parcelas_dias: [56, 28], prazo_medio_dias: 42 }).erros).toMatchObject([{ campo: 'parcelas_dias', codigo: 'regra_invalida' }]);
    expect(v2({ ...ok, prazo_medio_dias: 27 }).erros).toMatchObject([{ campo: 'prazo_medio_dias', codigo: 'regra_invalida' }]);
    expect(v2({ ...ok, prazo_medio_dias: 57 }).erros).toMatchObject([{ campo: 'prazo_medio_dias', codigo: 'regra_invalida' }]);
    expect(v2({ ...ok, prazo_medio_dias: 28 }).erros).toEqual([]);
    expect(v2({ ...ok, prazo_medio_dias: 56 }).erros).toEqual([]);
  });
});

describe('RN-INT-09: a v1 do prazo_pagamento segue igual (janela de 6 meses)', () => {
  it('RN-VEN-24: v1 sem descrição e sem prazo médio é aceito; média divergente gera aviso e a linha segue', () => {
    const semOpcionais: Record<string, unknown> = { ...ok };
    delete semOpcionais.descricao;
    delete semOpcionais.prazo_medio_dias;
    expect(validarLinhas('prazo_pagamento', [semOpcionais], 'v1').erros).toEqual([]);
    const r = validarLinhas('prazo_pagamento', [{ ...ok, prazo_medio_dias: 40 }], 'v1');
    expect(r.validas).toHaveLength(1);
    expect(r.avisos[0]).toMatchObject({ codigo: 'prazo_medio_divergente', external_id: 'PRZ-1' });
  });

  it('RN-INT-09: sem versão informada vale a v1; na v2 o mesmo prazo médio divergente não gera aviso', () => {
    expect(validarLinhas('prazo_pagamento', [{ ...ok, prazo_medio_dias: 40 }]).avisos).toHaveLength(1);
    expect(v2({ ...ok, prazo_medio_dias: 40 }).avisos).toHaveLength(0);
  });

  it('RN-VEN-24 / RN-INT-09: v1 sem descrição e sem média sai com ambos preenchidos (registro completo, ADR 0072)', () => {
    const semOpcionais: Record<string, unknown> = { ...ok };
    delete semOpcionais.descricao;
    delete semOpcionais.prazo_medio_dias;
    expect(validarLinhas('prazo_pagamento', [semOpcionais], 'v1').validas[0]?.registro).toMatchObject({ descricao: '28/56 dias', prazo_medio_dias: 42 });
    const avista = { ...semOpcionais, external_id: 'PRZ-0', parcelas_dias: [0] };
    expect(validarLinhas('prazo_pagamento', [avista], 'v1').validas[0]?.registro).toMatchObject({ descricao: 'À vista', prazo_medio_dias: 0 });
  });

  it('RN-VEN-24 / RN-INT-09: v1 com média divergente sai com a calculada, mais o aviso; descrição informada é mantida', () => {
    const r = validarLinhas('prazo_pagamento', [{ ...ok, prazo_medio_dias: 40, descricao: ' Boleto 28/56 ' }], 'v1');
    expect(r.validas[0]?.registro).toMatchObject({ descricao: 'Boleto 28/56', prazo_medio_dias: 42 });
    expect(r.avisos).toHaveLength(1);
  });

  it('RN-INT-09: reenvio idêntico da v1 continua com o mesmo hash (idempotente)', () => {
    const semOpcionais: Record<string, unknown> = { ...ok };
    delete semOpcionais.descricao;
    const a = validarLinhas('prazo_pagamento', [semOpcionais], 'v1').validas[0];
    const b = validarLinhas('prazo_pagamento', [{ ...semOpcionais }], 'v1').validas[0];
    expect(a?.hash).toBe(b?.hash);
    // o mesmo prazo enviado já completo (como o Hub entrega) tem o mesmo hash
    const c = validarLinhas('prazo_pagamento', [{ ...ok, descricao: '28/56 dias', prazo_medio_dias: 42 }], 'v1').validas[0];
    expect(c?.hash).toBe(a?.hash);
  });

  it('RN-INT-09: v2 sai intacto (descrição e prazo médio recebidos)', () => {
    expect(v2({ ...ok, prazo_medio_dias: 40 }).validas[0]?.registro).toMatchObject({ descricao: 'Boleto 28/56', prazo_medio_dias: 40 });
  });

  it('RN-INT-09: outras entidades não mudam com a versão v2', () => {
    const forma = { external_id: 'F1', alterado_em: ok.alterado_em, codigo: 'PIX', nome: 'PIX' };
    expect(validarLinhas('forma_pagamento', [forma], 'v2').erros).toEqual([]);
  });
});
