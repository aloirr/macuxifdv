import { describe, expect, it } from 'vitest';
import { corpoDasMedidasDoProduto, erroDoFormularioDeMedida, opcoesDeMedida, rotuloMedidaDoProduto } from './medidas';

const medidas = [
  { sigla: 'UN', descricao: 'Unidade', ativo: true },
  { sigla: 'CX', descricao: 'Caixa', ativo: true },
  { sigla: 'DP', descricao: 'Display', ativo: false },
];

describe('RN-CORE-19: tela de medidas do BKO', () => {
  it('RN-CORE-19: o rótulo mostra a unidade e, se houver, a embalagem com a quantidade', () => {
    expect(rotuloMedidaDoProduto({ unidade: 'UN', embalagem_medida: null, embalagem_quantidade: null })).toBe('UN');
    expect(rotuloMedidaDoProduto({ unidade: 'UN', embalagem_medida: 'CX', embalagem_quantidade: 12 })).toBe('UN · CX c/ 12');
  });
  it('RN-CORE-19: o formulário do produto oferece só medida ativa, mantendo a que o produto já usa', () => {
    expect(opcoesDeMedida(medidas).map((m) => m.sigla)).toEqual(['CX', 'UN']);
    expect(opcoesDeMedida(medidas, ['DP']).map((m) => m.sigla)).toEqual(['CX', 'DP', 'UN']);
  });
  it('RN-CORE-19: o formulário da medida usa a mesma regra da API', () => {
    expect(erroDoFormularioDeMedida('cx', 'Caixa')).toBeNull();
    expect(erroDoFormularioDeMedida('CAIXA', 'Caixa')).toMatch(/1 a 4 letras/);
    expect(erroDoFormularioDeMedida('CX', '')).toMatch(/descrição/);
  });
  it('RN-CORE-19: monta o corpo do produto com embalagem tudo-ou-nada e quantidade inteira > 1', () => {
    expect(corpoDasMedidasDoProduto({ unidade: 'UN', embalagem_medida: '', embalagem_quantidade: '' }, medidas)).toEqual({
      ok: true,
      corpo: { unidade: 'UN', embalagem_medida: null, embalagem_quantidade: null },
    });
    expect(corpoDasMedidasDoProduto({ unidade: 'UN', embalagem_medida: 'CX', embalagem_quantidade: '12' }, medidas)).toMatchObject({ ok: true, corpo: { embalagem_medida: 'CX', embalagem_quantidade: 12 } });
    expect(corpoDasMedidasDoProduto({ unidade: 'UN', embalagem_medida: 'CX', embalagem_quantidade: '' }, medidas)).toMatchObject({ ok: false });
    expect(corpoDasMedidasDoProduto({ unidade: 'UN', embalagem_medida: 'CX', embalagem_quantidade: '1' }, medidas)).toMatchObject({ ok: false });
    expect(corpoDasMedidasDoProduto({ unidade: 'DP', embalagem_medida: '', embalagem_quantidade: '' }, medidas)).toMatchObject({ ok: false });
    expect(corpoDasMedidasDoProduto({ unidade: 'DP', embalagem_medida: '', embalagem_quantidade: '' }, medidas, { unidade: 'DP' })).toMatchObject({ ok: true });
  });
});
