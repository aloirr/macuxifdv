import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// as telas e o hook importam react-native/React e não rodam no Node: confere no fonte (mesmo padrão de telas-t0101.test.ts)
const fonte = (arquivo: string) => readFileSync(join(__dirname, arquivo), 'utf8').replace(/\r\n/g, '\n');

describe('T-0130 (RN-VEN-30, RF-VEN-04, RN-CORE-23 item 2, RN-VEN-33): salvar pela fila', () => {
  const hook = fonte('../state/use-vendedor.ts');
  const tela = fonte('new-order-screen.tsx');
  const bloco = hook.slice(hook.indexOf('const enviarPedido = useCallback('), hook.indexOf('const unidadesTransportadoras'));

  it('RN-VEN-30: salvar grava na fila com o UUID do aparelho e devolve na hora, sem esperar o envio (com ou sem sinal)', () => {
    expect(bloco).toContain('const id = ambiente.novoId()');
    expect(bloco).toContain("motor.enfileirar({ id, entidade: 'pedido'");
    expect(bloco).not.toContain('await motor.enviar()');
    expect(bloco).toContain('return { kind: \'queued\', id, message: avisoDoSalvar(!ambiente.online()) }');
  });

  it('RN-CORE-23 item 2: com sinal o envio sobe sozinho, em segundo plano, pela fila comum do motor', () => {
    expect(bloco).toContain('if (ambiente.online()) void seguirEnvioEmSegundoPlano(id)');
    expect(hook).toContain('(await motor.enviar()).find((x) => x.id === id)');
  });

  it('RN-VEN-30: a recusa da API não descarta o pedido: ele fica na fila como não aceito, para corrigir', () => {
    const fundo = hook.slice(hook.indexOf('const seguirEnvioEmSegundoPlano'), hook.indexOf('const enviarPedido = useCallback('));
    expect(fundo).not.toContain('motor.descartar');
  });

  it('RN-VEN-33: o reenvio usa o mesmo id da fila (o servidor e o motor não duplicam)', () => {
    expect(bloco.match(/ambiente\.novoId\(\)/g)).toHaveLength(1);
    expect(hook).toContain("motor.enviar({ incluirFalhos: true })");
  });

  it('RN-VEN-30: a tela fecha na hora (replace para o detalhe) com "Pedido salvo · enviando", sem o botão girando', () => {
    const envio = tela.slice(tela.indexOf('const send = async'), tela.indexOf('const rotuloEdicao'));
    expect(envio).toContain('router.replace(hrefPedido(destino) as never)');
    expect(envio).toContain('avisoDoSalvar(offline)');
    expect(envio.indexOf('router.replace')).toBeLessThan(envio.indexOf('setSent('));
  });

  it('RF-VEN-04: o detalhe na fila é só de leitura (faixa "Pedido salvo · enviando", sem Editar); o recusado mostra "Corrigir pedido"', () => {
    const d = fonte('order-detail-screen.tsx');
    expect(d).toContain('estadoNaFila(');
    // T-0138: quem decide é acoesDoDetalhe (detalhe-pedido.ts): na fila só PDF; o recusado volta com "Corrigir pedido"
    expect(d).toContain('acoesDoDetalhe({');
    expect(d).toContain('recusado: Boolean(queued?.failed)');
  });

  it('RN-VEN-30: a lista Pedidos mostra "Não aceito" e abre o rascunho "Salvo" no editor', () => {
    const l = fonte('orders-screen.tsx');
    expect(l).toContain('statusBadgeDaLinha(o)');
    expect(l).toContain('clienteDoRascunho(o.id)');
    expect(hook).toContain('rascunhosSalvosComoPedidos(dados.rascunhos');
  });
});

describe('T-0130: um componente só para o desconto do item e do pedido', () => {
  it('RN-VEN-02: o item usa o DescontoCompacto do kit, não o CampoAjuste', () => {
    const itens = fonte('../components/novo-pedido-itens.tsx');
    expect(itens).toContain('<DescontoCompacto');
    expect(itens).not.toContain('<CampoAjuste');
  });
});
