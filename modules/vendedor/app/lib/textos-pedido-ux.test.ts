import { describe, expect, it } from 'vitest';

import { abasDoPedido, avisoSalvoNoAparelho, confirmacaoDoEnvio, folhaDoTransformar, linhaDoAjusteSomenteLeitura, TEXTO_PEDIDO_FORA_DO_APARELHO, estadoDoDetalheAusente, textoDoAviso, TEXTO_SEM_ITEM_NO_RESUMO, textoBuscaSemResultado, textoCancelarDocumento, textoEquivalente, textoNaoFoiAceito } from './textos-pedido';

const limpa = (s: string | undefined) => (s ?? '').replace(/\s/g, ' ');

describe('confirmacaoDoEnvio (T-0071, revisão de UX 🔴 2): orçamento nunca é confirmado como pedido', () => {
  it('RN-VEN-13: orçamento salvo diz "Orçamento 000012 salvo", com a validade e sem selo de status de pedido', () => {
    expect(confirmacaoDoEnvio({ tipo: 'orcamento', numero: '000012', status: 'received', validade_data: '2026-11-10' })).toEqual({ titulo: 'Orçamento 000012 salvo', nota: 'Válido até 10/11.', mostrarStatus: false, rodape: 'Ir para Pedidos' });
  });
  it('RN-VEN-13: orçamento sem validade conhecida não inventa data', () => {
    expect(confirmacaoDoEnvio({ tipo: 'orcamento', numero: '000012', status: 'received', validade_data: null }).nota).toBe('');
  });
  it('RN-VEN-10: pedido recebido segue com "Pedido N recebido", selo de status e a nota da alçada', () => {
    expect(confirmacaoDoEnvio({ tipo: 'pedido', numero: '000013', status: 'pending_approval', pending_reason: 'Desconto de 8% acima da alçada.' })).toEqual({ titulo: 'Pedido 000013 recebido', nota: 'Desconto de 8% acima da alçada.', mostrarStatus: true, rodape: 'Ir para Pedidos' });
    expect(confirmacaoDoEnvio({ tipo: 'pedido', numero: '000013', status: 'approved' }).nota).toBe('Dentro da alçada: aprovado na hora.');
    expect(confirmacaoDoEnvio({ tipo: 'pedido', numero: '000013', status: 'received' }).nota).toBe('');
  });
  it('RN-VEN-13: sem sinal, o aviso do aparelho fala do documento certo', () => {
    expect(avisoSalvoNoAparelho('orcamento')).toEqual({ titulo: 'Orçamento salvo no aparelho.', nota: 'Envia quando o sinal voltar.' });
    expect(avisoSalvoNoAparelho('pedido')).toEqual({ titulo: 'Pedido salvo no aparelho.', nota: 'Envia quando o sinal voltar.' });
  });
});

describe('folhaDoTransformar (RN-VEN-18, desenho §1.5, revisão de UX 🔴 3)', () => {
  it('RN-VEN-18: nada mudou, a folha abre mesmo assim com a alçada e o Enviar pedido', () => {
    const f = folhaDoTransformar({ mudancas: [], bloqueio: null, nivel: null, total_cents: null });
    expect(f.titulo).toBe('Transformar em pedido');
    expect(f.subtitulo).toBe('Vai direto ao ERP.');
    expect(f.podeEnviar).toBe(true);
    expect(f.mostrarTotal).toBe(false);
  });
  it('RN-VEN-10: a alçada recalculada vira o subtítulo', () => {
    expect(folhaDoTransformar({ mudancas: [], bloqueio: null, nivel: 'supervisor', total_cents: null }).subtitulo).toBe('Vai para o supervisor.');
    expect(folhaDoTransformar({ mudancas: [], bloqueio: null, nivel: 'gerente', total_cents: null }).subtitulo).toBe('Vai para o gerente.');
  });
  it('RN-VEN-18: com mudança o título é "Mudou desde o orçamento" e mostra o total novo', () => {
    const f = folhaDoTransformar({ mudancas: ['Preço do café subiu'], bloqueio: null, nivel: null, total_cents: 37979 });
    expect(f.titulo).toBe('Mudou desde o orçamento');
    expect(f.mostrarTotal).toBe(true);
    expect(f.podeEnviar).toBe(true);
  });
  it('RN-VEN-13: bloqueio (cliente bloqueado) não deixa enviar', () => {
    const f = folhaDoTransformar({ mudancas: [], bloqueio: 'Cliente bloqueado.', nivel: null, total_cents: null });
    expect(f.titulo).toBe('Mudou desde o orçamento');
    expect(f.podeEnviar).toBe(false);
  });
  it('RN-VEN-18: sem tabela no aparelho para conferir, a folha ainda abre e diz que a conferência é no envio', () => {
    const f = folhaDoTransformar(null);
    expect(f.titulo).toBe('Transformar em pedido');
    expect(f.subtitulo).toBe('Confere preço e alçada ao enviar.');
    expect(f.podeEnviar).toBe(true);
  });
});

describe('Resumo somente leitura (revisão de UX 🔴 1)', () => {
  it('RN-VEN-02: desconto do pedido vira a linha "Desconto do pedido (1,0%)" · "− R$ 3,84"', () => {
    const l = linhaDoAjusteSomenteLeitura({ sentido: 'desconto', cents: 384, pct_exibicao: 1 });
    expect(limpa(l?.rotulo)).toBe('Desconto do pedido (1,0%)');
    expect(limpa(l?.valor)).toBe('− R$ 3,84');
  });
  it('RN-VEN-02: acréscimo do pedido leva o sinal de mais', () => {
    const l = linhaDoAjusteSomenteLeitura({ sentido: 'acrescimo', cents: 100, pct_exibicao: 2.5 });
    expect(limpa(l?.rotulo)).toBe('Acréscimo do pedido (2,5%)');
    expect(limpa(l?.valor)).toBe('+ R$ 1,00');
  });
  it('RN-VEN-02: sem ajuste, nenhuma linha', () => {
    expect(linhaDoAjusteSomenteLeitura(null)).toBeNull();
    expect(linhaDoAjusteSomenteLeitura({ sentido: 'desconto', cents: 0, pct_exibicao: 0 })).toBeNull();
  });
});

describe('Cancelar documento (revisão de UX 🟡 8)', () => {
  it('RF-VEN-03: orçamento diz "Cancelar", nunca "Excluir pedido"', () => {
    const x = textoCancelarDocumento({ ehOrcamento: true, naFila: false, titulo: 'Orçamento 000012' });
    expect(x.titulo).toBe('Cancelar este orçamento?');
    expect(x.confirmar).toBe('Cancelar orçamento');
    expect(x.ocupado).toBe('Cancelando…');
    expect(x.rotuloAcessivel).toBe('Cancelar orçamento');
    expect(x.descricao).not.toMatch(/pedido/i);
  });
  it('RF-VEN-04: pedido mantém "Excluir pedido 000013?"', () => {
    const x = textoCancelarDocumento({ ehOrcamento: false, naFila: false, titulo: 'Pedido 000013' });
    expect(x.titulo).toBe('Excluir pedido 000013?');
    expect(x.confirmar).toBe('Excluir pedido');
  });
  it('RF-VEN-04: pedido na fila do aparelho explica que sai da fila', () => {
    expect(textoCancelarDocumento({ ehOrcamento: false, naFila: true, titulo: 'Pedido no aparelho' }).descricao).toBe('O pedido sai da fila do aparelho e não será enviado.');
  });
});

describe('Textos sem jargão e estados vazios (revisão de UX 🟡 10, 15, 16)', () => {
  it('RN-CORE-23: sem "servidor" nem "cache" nos textos da tela', () => {
    expect(textoNaoFoiAceito('estoque insuficiente')).toBe('Não foi aceito: estoque insuficiente');
    expect(TEXTO_PEDIDO_FORA_DO_APARELHO).toEqual({ titulo: 'Este pedido não está no aparelho', texto: 'Conecte-se e puxe a tela para baixo para sincronizar.' });
    expect(JSON.stringify([TEXTO_PEDIDO_FORA_DO_APARELHO, textoNaoFoiAceito('x')])).not.toMatch(/servidor|cache/i);
  });
  it('RF-VEN-01: busca sem resultado cita o termo e diz o que fazer', () => {
    expect(textoBuscaSemResultado('  cafe ')).toEqual({ titulo: 'Nenhum produto com “cafe”', texto: 'Confira o código ou a descrição.' });
  });
  it('RF-VEN-01: Resumo sem item diz onde adicionar', () => {
    expect(TEXTO_SEM_ITEM_NO_RESUMO).toBe('Adicione um item na aba Itens.');
  });
});

describe('abasDoPedido com pendência (revisão de UX 🟡 14)', () => {
  it('RN-VEN-16: a aba Itens fica marcada quando há pendência de frete ou de item', () => {
    expect(abasDoPedido(2, true).find((a) => a.id === 'itens')?.pendente).toBe(true);
    expect(abasDoPedido(2, false).find((a) => a.id === 'itens')?.pendente).toBe(false);
    expect(abasDoPedido(2).find((a) => a.id === 'detalhes')?.pendente).toBeUndefined();
  });
});

describe('textoEquivalente do acréscimo (guia §7.1)', () => {
  it('RN-VEN-02: digitou R$, o equivalente é "= 5,3%" no desconto e no acréscimo', () => {
    expect(textoEquivalente({ ajuste_em: 'valor', equivalente: { sentido: 'acrescimo', cents: 100, pct_exibicao: 5.3 } })).toBe('= 5,3%');
    expect(textoEquivalente({ ajuste_em: 'valor', equivalente: { sentido: 'desconto', cents: 100, pct_exibicao: 5.3 } })).toBe('= 5,3%');
  });
});

describe('detalhe sem pedido e avisos (T-0071, revisão de UX 23, 25 e 26)', () => {
  it('RN-CORE-23: com sinal, a carga que termina sem o pedido mostra erro com "Tentar de novo", não spinner eterno', () => {
    expect(estadoDoDetalheAusente({ offline: false, carregando: true })).toEqual({ tipo: 'carregando' });
    const fim = estadoDoDetalheAusente({ offline: false, carregando: false });
    expect(fim).toMatchObject({ tipo: 'vazio', tentarDeNovo: true });
  });
  it('RN-CORE-23: sem sinal, o vazio pede conexão e não oferece nova tentativa', () => {
    expect(estadoDoDetalheAusente({ offline: true, carregando: true })).toMatchObject({ tipo: 'vazio', titulo: 'Este pedido não está no aparelho', tentarDeNovo: false });
  });
  it('aviso de rodapé sai sem ponto final e mantém pontos do meio', () => {
    expect(textoDoAviso('Pedido 000013 aprovado.')).toBe('Pedido 000013 aprovado');
    expect(textoDoAviso('Pedido da fila atualizado no aparelho. Será enviado quando o sinal voltar.')).toBe('Pedido da fila atualizado no aparelho. Será enviado quando o sinal voltar');
  });
});
