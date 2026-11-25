/**
 * RN-VEN-49 (R-20261124-110151; revoga a regra do T-0141, RN-VEN-38): o Novo pedido volta a abrir o Catálogo, por um botão "Catálogo" na
 * linha da busca da aba Itens, e o "+" do produto grava no rascunho do aparelho. Varre o código do app: o botão, o gatilho (Campo,
 * permissão e licença do Catálogo), a gravação antes de navegar e a ação do slot `produto.acoes`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = join(__dirname, '..');
const ler = (rel: string) => readFileSync(join(APP, rel), 'utf8');

describe('RN-VEN-49: Catálogo dentro do Novo pedido', () => {
  const tela = ler('screens/new-order-screen.tsx');

  it('RN-VEN-49: a aba Itens tem o botão "Catálogo" (itens-catalogo) que abre hrefCatalogoNoPedido com a chave do rascunho', () => {
    expect(tela).toMatch(/testID="itens-catalogo"/);
    expect(tela).toMatch(/hrefCatalogoNoPedido\(\{ clienteId: customerId, pedidoEmCurso: draftKey \}\)/);
  });

  it('RN-VEN-49: o botão só aparece no Campo, com produto.consultar e o Catálogo entre os módulos efetivos (licença)', () => {
    expect(tela).toMatch(/visao\.app === 'campo' && podeConsultarProduto && visao\.modulosAtivos\.includes\('catalogo'\)/);
    expect(tela).toMatch(/usePode\('produto\.consultar'\)/);
  });

  it('RN-VEN-49: antes de navegar, o rascunho e a aba Itens ficam gravados no aparelho (nada se perde na ida e volta)', () => {
    const corpo = tela.slice(tela.indexOf('const abrirCatalogo'), tela.indexOf('router.push(hrefCatalogoNoPedido'));
    expect(corpo).toMatch(/await app\.atualizarRascunho\(draftKey, customerId, \(d\) => \(\{ \.\.\.d, aba: 'itens' \}\)/);
    expect(corpo).toMatch(/deixarArmazenamentoDoPedido/);
  });

  it('RN-VEN-49: o "+" é uma ação onde:"pedido" do slot produto.acoes, só do Campo, com pedido.criar (promotor nunca vê), e grava no rascunho', () => {
    const idx = ler('index.ts');
    const bloco = idx.slice(idx.indexOf("id: 'adicionar-ao-pedido'"), idx.indexOf("slot: 'pedido.criar_em_nome'"));
    expect(bloco).toMatch(/acao: 'pedido\.criar'/);
    expect(bloco).toMatch(/apps: \['campo'\]/);
    expect(bloco).toMatch(/onde: 'pedido'/);
    expect(bloco).toMatch(/adicionarAoPedidoEmCurso\(ctx\.pedidoEmCurso, ctx\.produtoId\)/);
  });

  it('RN-VEN-49: "Adicionar ao orçamento" fica só na consulta (onde:"consulta")', () => {
    const idx = ler('index.ts');
    const bloco = idx.slice(idx.indexOf("id: 'adicionar-ao-orcamento'"), idx.indexOf("id: 'adicionar-ao-pedido'"));
    expect(bloco).toMatch(/onde: 'consulta'/);
  });

  it('RN-VEN-49: a ação do "+" não depende de estado nem de callback da tela', () => {
    const lib = ler('lib/pedido-em-curso.ts');
    expect(lib).not.toMatch(/from 'react'|useState|useRef/);
  });
});

describe('RN-VEN-49: Catálogo dentro do Novo pedido (carga e digitação)', () => {
  const tela = ler('screens/new-order-screen.tsx');
  it('a aba é acertada quando o aparelho termina de carregar (o rascunho chega depois da primeira montagem)', () => {
    expect(tela).toMatch(/if \(!app\.carregado \|\| abaAcertada\.current\) return;[\s\S]{0,80}setAba\(abaInicialDoRascunho\(draft\)\)/);
  });
  it('R-20261123-201347: o número digitado vale antes de gravar e abrir o Catálogo', () => {
    const corpo = tela.slice(tela.indexOf('const abrirCatalogo'), tela.indexOf('router.push(hrefCatalogoNoPedido'));
    expect(corpo.indexOf('aplicarValorPendente()')).toBeGreaterThan(-1);
    expect(corpo.indexOf('aplicarValorPendente()')).toBeLessThan(corpo.indexOf('atualizarRascunho'));
  });
});
