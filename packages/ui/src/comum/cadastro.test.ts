/**
 * T-0060 (RN-CORE-17): bloco Observações e etiqueta do cadastro incompleto.
 */
import { describe, expect, it } from 'vitest';

import { blocosDeObservacao, DESCRICAO_CADASTRO_INCOMPLETO, ROTULO_CADASTRO_INCOMPLETO } from './cadastro';

const LINHA = 'Cadastro incompleto: falta CEP. Pedido só como orçamento até o cadastro ser completado no ERP.';

describe('blocosDeObservacao', () => {
  it('cadastro incompleto + texto do ERP: linha automática em destaque e o texto intacto', () => {
    expect(blocosDeObservacao(LINHA, 'Entregar pela manhã.\nPortão lateral.')).toEqual({
      automatica: LINHA,
      texto: 'Entregar pela manhã.\nPortão lateral.',
      vazio: false,
    });
  });

  it('texto já montado pelo Core (observacaoComCadastro): a linha não se repete', () => {
    expect(blocosDeObservacao(LINHA, `${LINHA}\nEntregar pela manhã.`)).toEqual({ automatica: LINHA, texto: 'Entregar pela manhã.', vazio: false });
    expect(blocosDeObservacao(LINHA, LINHA)).toEqual({ automatica: LINHA, texto: null, vazio: false });
  });

  it('cadastro completo: só o texto do ERP; a linha some sozinha', () => {
    expect(blocosDeObservacao(null, 'Cliente paga no boleto.')).toEqual({ automatica: null, texto: 'Cliente paga no boleto.', vazio: false });
  });

  it('nada para mostrar: vazio (texto só com espaços também)', () => {
    expect(blocosDeObservacao(null, null).vazio).toBe(true);
    expect(blocosDeObservacao('  ', ' \n ').vazio).toBe(true);
    expect(blocosDeObservacao(undefined, undefined).vazio).toBe(true);
  });

  it('textos da etiqueta em português, sem nome técnico', () => {
    expect(ROTULO_CADASTRO_INCOMPLETO).toBe('Cadastro incompleto');
    expect(DESCRICAO_CADASTRO_INCOMPLETO).toMatch(/orçamento/);
    expect(DESCRICAO_CADASTRO_INCOMPLETO).not.toMatch(/cadastro_incompleto|_/);
  });
});
