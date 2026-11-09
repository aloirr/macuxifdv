import { describe, expect, it } from 'vitest';
import { mascararMensagemDoConector, tratarLinhasInvalidasConector } from './linhas-invalidas';

const linha = (n: number, extra = {}) => ({ external_id: `C${n}`, codigo: 'campo_obrigatorio' as const, campo: 'razao_social', mensagem: `razao_social ausente (${n})`, ...extra });

describe('RN-INT-03 (T-0025): linhas inválidas informadas pelo Conector', () => {
  it('RN-INT-03: vira erro por linha com origem conector, índice = posição em linhas_invalidas e nunca reprocessável', () => {
    const r = tratarLinhasInvalidasConector({ linhas_invalidas: [linha(1), linha(2, { external_id: null, campo: null })] });
    expect(r.erros).toHaveLength(2);
    expect(r.erros[0]).toMatchObject({ indice: 0, external_id: 'C1', codigo: 'campo_obrigatorio', campo: 'razao_social', reprocessavel: false, origem: 'conector' });
    expect(r.erros[1]).toMatchObject({ indice: 1, external_id: null, campo: null, origem: 'conector' });
  });

  it('RN-INT-03: limite de 500 por entidade/lote — o que passa disso entra só na contagem de omitidas (somando as que o Conector já omitiu)', () => {
    const muitas = Array.from({ length: 520 }, (_, i) => linha(i));
    const r = tratarLinhasInvalidasConector({ linhas_invalidas: muitas, linhas_invalidas_omitidas: 5 });
    expect(r.erros).toHaveLength(500);
    expect(r.omitidas).toBe(25);
    expect(r.totalComErro).toBe(525);
  });

  it('RN-INT-03: o limite é parâmetro do tenant', () => {
    const r = tratarLinhasInvalidasConector({ linhas_invalidas: [linha(1), linha(2), linha(3)] }, { limite: 2 });
    expect(r.erros).toHaveLength(2);
    expect(r.omitidas).toBe(1);
  });

  it('RN-INT-06: separa os external_id conhecidos (o registro existe no ERP) do que não dá para identificar (sem id + omitidas)', () => {
    const r = tratarLinhasInvalidasConector({ linhas_invalidas: [linha(1), linha(1), linha(2, { external_id: '  ' }), linha(3, { external_id: null })], linhas_invalidas_omitidas: 2 });
    expect(r.externalIds).toEqual(['C1']);
    expect(r.semIdentificacao).toBe(2 + 2);
  });

  it('RN-INT-03: sem linhas inválidas, tudo zerado', () => {
    expect(tratarLinhasInvalidasConector({})).toEqual({ erros: [], omitidas: 0, externalIds: [], semIdentificacao: 0, totalComErro: 0 });
  });

  it('RN-INT-03/privacidade: a mensagem do Conector é conferida de novo — CPF, CNPJ, e-mail e telefone viram ***', () => {
    const r = tratarLinhasInvalidasConector({
      linhas_invalidas: [linha(1, { mensagem: 'documento 123.456.789-09 inválido; contato ana@x.com.br; fone (95) 99999-1234; cnpj 12.345.678/0001-95' })],
    });
    const m = r.erros[0]?.mensagem ?? '';
    expect(m).not.toMatch(/123\.456|ana@|99999|12\.345/);
    expect(m).toContain('***');
    expect(m).toMatch(/inválido/);
  });

  it('RN-INT-03: mascararMensagemDoConector preserva texto comum e números curtos', () => {
    expect(mascararMensagemDoConector('o campo "limite" 1500 está fora da faixa')).toBe('o campo "limite" 1500 está fora da faixa');
    expect(mascararMensagemDoConector('11144477735')).toBe('***');
  });
});
