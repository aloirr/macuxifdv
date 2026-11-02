/**
 * T-0059 (R-20261102-091519 item 2): o BKO nunca mostra JSON de validação cru.
 */
import { describe, expect, it } from 'vitest';

import { ehMensagemTecnica, MENSAGEM_ERRO_PADRAO, mensagemParaTela } from './erros';

/** O erro que o Alexandre viu no detalhe do pedido 000010 da demo (02/11). */
const ZOD_DO_PEDIDO = '[{"code":"invalid_type","expected":"string","received":"null","path":["cliente","documento"],"message":"Expected string, received null"}]';

describe('mensagemParaTela', () => {
  it('JSON de validação do Zod vira a mensagem padrão (ou a da tela) e vai para o console', () => {
    const log: string[] = [];
    expect(mensagemParaTela(ZOD_DO_PEDIDO, undefined, (m) => log.push(m))).toBe(MENSAGEM_ERRO_PADRAO);
    const daTela = 'Não foi possível carregar os itens deste pedido. Tente de novo; se continuar, avise o suporte.';
    expect(mensagemParaTela(ZOD_DO_PEDIDO, daTela, (m) => log.push(m))).toBe(daTela);
    expect(log).toEqual([ZOD_DO_PEDIDO, ZOD_DO_PEDIDO]);
  });

  it('JSON embutido numa frase também é técnico', () => {
    expect(ehMensagemTecnica(`Não deu para atualizar agora: ${ZOD_DO_PEDIDO}`)).toBe(true);
  });

  it.each([
    "TypeError: Cannot read properties of undefined (reading 'itens')",
    'x.map is not a function',
    'Unexpected token < in JSON at position 0',
    'Expected number, received string',
    '{"erro":"x"}',
    '',
  ])('técnica: %s', (m) => expect(ehMensagemTecnica(m)).toBe(true));

  it('mensagem em português da API passa como veio', () => {
    const log: string[] = [];
    const m = 'Sem conexão com o servidor. Confira se a API está rodando.';
    expect(mensagemParaTela(m, undefined, (x) => log.push(x))).toBe(m);
    expect(mensagemParaTela('Você não tem acesso a este pedido.', undefined, (x) => log.push(x))).toBe('Você não tem acesso a este pedido.');
    expect(log).toEqual([]);
  });
});
