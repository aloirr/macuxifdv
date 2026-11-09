import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { alturaMaximaDaFolha, coberturaDoTeclado, FOLGA_CAMPO_FOLHA, FOLGA_TOPO_FOLHA, rolagemAteCampo, rotuloDoVoltar, tocarNoVoltar } from './componentes';

const ler = (arq: string) => readFileSync(new URL(arq, import.meta.url), 'utf8');

describe('rótulo do voltar (T-0072, R-20261105-132419): ProvedorVoltar do shell × label do módulo', () => {
  it('sem provedor (null/undefined), vale o label do módulo, como antes', () => {
    expect(rotuloDoVoltar('Pedidos', null)).toEqual({ visivel: 'Pedidos', acessivel: 'Voltar para Pedidos' });
    expect(rotuloDoVoltar('Treinar', undefined)).toEqual({ visivel: 'Treinar', acessivel: 'Voltar para Treinar' });
  });

  it('raiz de pilha aberta pelo Início: "‹ Início", lido "Voltar para Início"', () => {
    expect(rotuloDoVoltar('Pedidos', { rotulo: 'Início' })).toEqual({ visivel: 'Início', acessivel: 'Voltar para Início' });
  });

  it('origem Mais e qualquer outro texto do shell valem sem caso especial', () => {
    expect(rotuloDoVoltar('Treinar', { rotulo: 'Mais' })).toEqual({ visivel: 'Mais', acessivel: 'Voltar para Mais' });
    expect(rotuloDoVoltar('Pedidos', { rotulo: '  Clientes ' }).visivel).toBe('Clientes');
  });

  it('rótulo do shell em branco não apaga o voltar: cai no label', () => {
    expect(rotuloDoVoltar('Pedidos', { rotulo: '' }).visivel).toBe('Pedidos');
    expect(rotuloDoVoltar('Pedidos', { rotulo: '   ' }).acessivel).toBe('Voltar para Pedidos');
  });

  it('o kit exporta ProvedorVoltar (contexto opcional, padrão null) e o BackLink lê dele', () => {
    expect(ler('./index.ts')).toContain("export * from './voltar'");
    const voltar = ler('./voltar.tsx');
    expect(voltar).toMatch(/createContext<VoltarDaTela \| null>\(null\)/);
    expect(voltar).toMatch(/export const ProvedorVoltar = VoltarCtx\.Provider;/);
    expect(voltar).toMatch(/export function useVoltarDaTela\(\)/);
    const ui = ler('./ui.tsx');
    expect(ui).toContain('rotuloDoVoltar(label, useVoltarDaTela())');
    expect(ui).toContain('accessibilityLabel={rotulo.acessivel}');
    expect(ui).toContain('{rotulo.visivel}');
    // a navegação do BackLink não muda: o shell só troca o rótulo
    expect(ui).toContain('router.canGoBack() ? router.back() : router.replace(fallback as never)');
  });
});

describe('folha alta e teclado (T-0072): partes puras', () => {
  it('altura máxima = camada − área segura do topo − faixa de 24 do fundo − teclado', () => {
    expect(FOLGA_TOPO_FOLHA).toBe(24);
    expect(alturaMaximaDaFolha({ alturaCamada: 800 })).toBe(776);
    expect(alturaMaximaDaFolha({ alturaCamada: 800, topoSeguro: 32 })).toBe(744);
    expect(alturaMaximaDaFolha({ alturaCamada: 800, topoSeguro: 32, teclado: 300 })).toBe(444);
  });

  it('altura máxima nunca negativa nem NaN (camada ainda sem medida, teclado maior que a tela)', () => {
    expect(alturaMaximaDaFolha({ alturaCamada: 0 })).toBe(0);
    expect(alturaMaximaDaFolha({ alturaCamada: Number.NaN })).toBe(0);
    expect(alturaMaximaDaFolha({ alturaCamada: 400, teclado: 900 })).toBe(0);
    expect(alturaMaximaDaFolha({ alturaCamada: 800, teclado: -10, topoSeguro: Number.NaN })).toBe(776);
  });

  it('cobertura do teclado = base da camada − topo do teclado; fechado ou abaixo → 0', () => {
    expect(coberturaDoTeclado(800, 500)).toBe(300);
    expect(coberturaDoTeclado(800, 800)).toBe(0);
    expect(coberturaDoTeclado(800, 850)).toBe(0);
    expect(coberturaDoTeclado(800, null)).toBe(0);
    expect(coberturaDoTeclado(800, undefined)).toBe(0);
    expect(coberturaDoTeclado(Number.NaN, 500)).toBe(0);
  });

  it('rolagem até o campo: escondido embaixo rola para baixo, em cima para cima, à vista não rola', () => {
    expect(FOLGA_CAMPO_FOLHA).toBe(8);
    const area = { areaTopo: 300, areaBaixo: 500 };
    expect(rolagemAteCampo({ ...area, campoTopo: 480, campoBaixo: 528 })).toBe(36);
    expect(rolagemAteCampo({ ...area, campoTopo: 280, campoBaixo: 328 })).toBe(-28);
    expect(rolagemAteCampo({ ...area, campoTopo: 360, campoBaixo: 408 })).toBe(0);
    expect(rolagemAteCampo({ ...area, campoTopo: Number.NaN, campoBaixo: 408 })).toBe(0);
  });

  it('a folha só muda com as opções novas: rolagem e teclado atrás de rolavel/evitarTeclado', () => {
    const src = ler('./folha.tsx');
    expect(src).toMatch(/rolavel\?: boolean;/);
    expect(src).toMatch(/evitarTeclado\?: boolean;/);
    expect(src).toContain('const comRolagem = Boolean(rolavel || evitarTeclado);');
    expect(src).toContain('useTecladoNaFolha(Boolean(evitarTeclado) && montado)');
    expect(src).toContain("maxima !== undefined ? { maxHeight: maxima } : null");
    // sem teclado, o respiro de baixo é o de antes (22 + área segura)
    expect(src).toContain('teclado.cobertura > 0 ? 12 : 22 + insets.bottom');
    // toque num botão da folha com o teclado aberto vale no primeiro toque
    expect(src).toContain('keyboardShouldPersistTaps="handled"');
    // o ouvinte de teclado é removido ao fechar
    expect(src).toContain('subMostrar.remove()');
    expect(src).toContain('subEsconder.remove()');
  });
});

describe('BackLink pelo bloqueio de saída do shell (T-0128, RN-VEN-38)', () => {
  const montar = (bloqueia: boolean) => {
    const chamadas: string[] = [];
    const saida = {
      tentarSair: (seguir: () => void) => {
        chamadas.push('tentarSair');
        if (bloqueia) return true; // o shell guarda o seguir e pergunta "Sair…?"
        seguir();
        return false;
      },
    };
    const seguir = () => chamadas.push('seguir');
    return { chamadas, saida, seguir };
  };

  it('sem provedor, volta direto (como antes)', () => {
    const { chamadas, seguir } = montar(false);
    tocarNoVoltar({ saida: null, seguir });
    expect(chamadas).toEqual(['seguir']);
  });

  it('com provedor e formulário sem mudança, passa pelo shell e volta', () => {
    const { chamadas, saida, seguir } = montar(false);
    tocarNoVoltar({ saida, seguir });
    expect(chamadas).toEqual(['tentarSair', 'seguir']);
  });

  it('com provedor e formulário alterado, o shell segura: não volta na hora', () => {
    const { chamadas, saida, seguir } = montar(true);
    tocarNoVoltar({ saida, seguir });
    expect(chamadas).toEqual(['tentarSair']);
  });

  it('aoVoltar da tela vale mais que o provedor (o Novo pedido abre a própria folha)', () => {
    const { chamadas, saida, seguir } = montar(true);
    tocarNoVoltar({ aoVoltar: () => chamadas.push('aoVoltar'), saida, seguir });
    expect(chamadas).toEqual(['aoVoltar']);
  });

  it('o kit exporta ProvedorSaidaDaTela (padrão null) e o BackLink usa tocarNoVoltar com o seguir de sempre', () => {
    const voltar = ler('./voltar.tsx');
    expect(voltar).toMatch(/createContext<SaidaDaTela \| null>\(null\)/);
    expect(voltar).toMatch(/export const ProvedorSaidaDaTela = SaidaCtx\.Provider;/);
    expect(voltar).toMatch(/export function useSaidaDaTela\(\)/);
    const ui = ler('./ui.tsx');
    expect(ui).toContain('const saida = useSaidaDaTela();');
    expect(ui).toContain('onPress={() => tocarNoVoltar({ aoVoltar, saida, seguir })}');
    expect(ui).toContain('const seguir = () => (router.canGoBack() ? router.back() : router.replace(fallback as never));');
  });
});
