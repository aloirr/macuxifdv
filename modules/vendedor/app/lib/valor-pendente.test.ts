import { describe, expect, it, vi } from 'vitest';

import { deslocamentoDoTeclado, rolagemParaCampo } from './teclado';
import { aplicarValorPendente, quantidadeAoConfirmar, quantidadeAoDigitar, quantidadeBaseDoPasso, registrarValorPendente, textoAposMudancaDoValor, valorPendentePct, valorPendenteQuantidade, valorPendenteReais } from './valor-pendente';

describe('valor pendente (T-0071 V2): o que está digitado vale no primeiro toque seguinte', () => {
  it('RN-VEN-02: a quantidade vale a cada dígito; campo vazio não zera nem tira o item', () => {
    expect(valorPendenteQuantidade('5')).toBe(5);
    expect(valorPendenteQuantidade('12')).toBe(12);
    expect(valorPendenteQuantidade('')).toBeNull();
    expect(valorPendenteQuantidade('abc')).toBeNull();
    expect(valorPendenteQuantidade('0')).toBe(0);
  });

  it('RN-VEN-02: o % vale a cada número válido ("5," vale 5 e "1,5" vale 1,5) e é limitado ao teto na hora', () => {
    expect(valorPendentePct('5,')).toBe(5);
    expect(valorPendentePct('1,5')).toBe(1.5);
    expect(valorPendentePct('1.5')).toBe(1.5);
    expect(valorPendentePct('')).toBeNull();
    expect(valorPendentePct(',')).toBeNull();
    expect(valorPendentePct('150')).toBe(100);
    expect(valorPendentePct('30', 25)).toBe(25);
    expect(valorPendentePct('5,555')).toBe(5.56);
  });

  it('RN-VEN-02: o R$ vale a cada número válido, em centavos, limitado ao teto (o desconto não passa do preço)', () => {
    expect(valorPendenteReais('0,89')).toBe(89);
    expect(valorPendenteReais('1,')).toBe(100);
    expect(valorPendenteReais('')).toBeNull();
    expect(valorPendenteReais(',')).toBeNull();
    expect(valorPendenteReais('20', 1790)).toBe(1790);
  });

  it('o texto digitado fica enquanto o campo tem foco e vale o mesmo que o valor gravado; sem foco mostra o valor formatado', () => {
    const base = { formatar: (n: number) => n.toFixed(1).replace('.', ','), pendente: (t: string) => valorPendentePct(t) };
    expect(textoAposMudancaDoValor({ ...base, texto: '5,', valor: 5, focado: true })).toBe('5,');
    expect(textoAposMudancaDoValor({ ...base, texto: '150', valor: 100, focado: true })).toBe('150');
    expect(textoAposMudancaDoValor({ ...base, texto: '', valor: 5, focado: true })).toBe('');
    expect(textoAposMudancaDoValor({ ...base, texto: '5,', valor: 7, focado: true })).toBe('7,0');
    expect(textoAposMudancaDoValor({ ...base, texto: '150', valor: 100, focado: false })).toBe('100,0');
  });
});

describe('teclado no Android edge-to-edge (T-0071 V1)', () => {
  it('o deslocamento do KeyboardAvoidingView é a faixa da barra de status no Android e zero no iOS', () => {
    expect(deslocamentoDoTeclado('android', 24)).toBe(24);
    expect(deslocamentoDoTeclado('android', undefined)).toBe(0);
    expect(deslocamentoDoTeclado('ios', 47)).toBe(0);
  });

  it('o campo com foco fica inteiro acima do teclado, com 8 dp de folga', () => {
    // campo termina em 700 e o teclado começa em 640: rola 68 (60 + 8 de folga)
    expect(rolagemParaCampo({ campoBaixo: 700, tecladoTopo: 640 })).toBe(68);
    // já está acima com folga: não rola
    expect(rolagemParaCampo({ campoBaixo: 600, tecladoTopo: 640 })).toBe(0);
    // dentro da folga de 8 dp: rola o que falta
    expect(rolagemParaCampo({ campoBaixo: 635, tecladoTopo: 640 })).toBe(3);
  });
});

describe('W1: zero no meio da digitação não tira o item', () => {
  it('"0" e vazio não gravam; "105" grava', async () => {
    const { quantidadeAoDigitar } = await import('./valor-pendente');
    expect(quantidadeAoDigitar('0')).toBeNull();
    expect(quantidadeAoDigitar('')).toBeNull();
    expect(quantidadeAoDigitar('105')).toBe(105);
  });
});

describe('V1: o valor pendente do campo em foco vale ao confirmar (Salvar, Avançar, aba, +/−)', () => {
  it('RN-VEN-02: "0" ou campo vazio tira o item; número válido grava', () => {
    expect(quantidadeAoConfirmar('0')).toBe(0);
    expect(quantidadeAoConfirmar('')).toBe(0);
    expect(quantidadeAoConfirmar('7')).toBe(7);
    expect(quantidadeAoConfirmar('105')).toBe(105);
  });

  it('W1 mantida: durante a digitação o "0" não tira o item, mas ao confirmar vale', () => {
    expect(quantidadeAoDigitar('0')).toBeNull();
    expect(quantidadeAoDigitar('10')).toBe(10);
    expect(quantidadeAoConfirmar('0')).toBe(0);
  });

  it('o passo +/− parte do digitado quando o campo tem foco ("0" + 1 = 1) e da quantidade gravada sem foco', () => {
    expect(quantidadeBaseDoPasso({ texto: '0', focado: true, qtd: 5 }) + 1).toBe(1);
    expect(quantidadeBaseDoPasso({ texto: '', focado: true, qtd: 5 }) - 1).toBe(-1);
    expect(quantidadeBaseDoPasso({ texto: '0', focado: false, qtd: 5 }) + 1).toBe(6);
  });

  it('o campo em foco aplica o pendente uma vez; depois de desregistrar (blur) nada é aplicado', () => {
    const aplicar = vi.fn();
    const desfazer = registrarValorPendente(aplicar);
    expect(aplicarValorPendente()).toBe(true);
    expect(aplicar).toHaveBeenCalledTimes(1);
    desfazer();
    expect(aplicarValorPendente()).toBe(false);
    expect(aplicar).toHaveBeenCalledTimes(1);
  });
});
