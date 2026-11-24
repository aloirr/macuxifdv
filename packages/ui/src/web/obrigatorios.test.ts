import { describe, expect, it } from 'vitest';
import { campoVazio, camposObrigatoriosVazios, mostraAvisoObrigatorio, TEXTO_AVISO_OBRIGATORIO, validacaoMudou, type CampoDaGaveta, type MudancaNaGaveta } from './obrigatorios';

// R-20261124-092046 (item 07): aviso vermelho no rodapé da gaveta quando há obrigatório vazio ao salvar.
const campo = (p: Partial<CampoDaGaveta> = {}): CampoDaGaveta => ({
  valor: '',
  tipo: 'text',
  declarado: false,
  rotuloObrigatorio: false,
  marcadoComErro: false,
  ignorado: false,
  ...p,
});

describe('aviso de obrigatório da gaveta', () => {
  it('texto literal do dono do produto', () => {
    expect(TEXTO_AVISO_OBRIGATORIO).toBe('Campos obrigatórios não preenchido. Preencha e salve novamente');
  });

  it('só espaços conta como vazio', () => {
    expect(campoVazio({ valor: '   ' })).toBe(true);
    expect(campoVazio({ valor: 'a' })).toBe(false);
  });

  it('required/aria-required vazio avisa direto', () => {
    expect(mostraAvisoObrigatorio([campo({ declarado: true })])).toBe(true);
    expect(mostraAvisoObrigatorio([campo({ declarado: true, valor: 'x' })])).toBe(false);
  });

  it('rótulo sem "(opcional)" vazio avisa só quando o módulo marcou o erro', () => {
    expect(mostraAvisoObrigatorio([campo({ rotuloObrigatorio: true })])).toBe(false);
    expect(mostraAvisoObrigatorio([campo({ rotuloObrigatorio: true, marcadoComErro: true })])).toBe(true);
  });

  it('erro de formato em campo preenchido não é obrigatório vazio', () => {
    expect(mostraAvisoObrigatorio([campo({ rotuloObrigatorio: true, marcadoComErro: true, valor: '12.345' })])).toBe(false);
  });

  it('campo opcional com erro, desabilitado, oculto ou sem valor de texto não conta', () => {
    expect(mostraAvisoObrigatorio([campo({ marcadoComErro: true })])).toBe(false);
    expect(mostraAvisoObrigatorio([campo({ declarado: true, ignorado: true })])).toBe(false);
    expect(mostraAvisoObrigatorio([campo({ declarado: true, tipo: 'hidden' })])).toBe(false);
    expect(mostraAvisoObrigatorio([campo({ declarado: true, tipo: 'radio' })])).toBe(false);
  });

  it('caixa de marcar só conta quando declarada', () => {
    expect(mostraAvisoObrigatorio([campo({ tipo: 'checkbox', rotuloObrigatorio: true, marcadoComErro: true })])).toBe(false);
    expect(mostraAvisoObrigatorio([campo({ tipo: 'checkbox', declarado: true })])).toBe(true);
  });

  it('devolve só os obrigatórios vazios', () => {
    const a = campo({ declarado: true });
    const b = campo({ declarado: true, valor: 'ok' });
    expect(camposObrigatoriosVazios([a, b])).toEqual([a]);
  });

  it('validação assíncrona: reavalia só quando aria-invalid muda ou o erro do campo entra/sai', () => {
    const mud = (p: Partial<MudancaNaGaveta>): MudancaNaGaveta => ({ type: 'childList', addedNodes: [], removedNodes: [], ...p });
    const erro = { matches: (s: string) => s === '[data-erro-do-campo]' };
    const blocoComErro = { matches: () => false, querySelector: (s: string) => (s === '[data-erro-do-campo]' ? {} : null) };
    const outro = { matches: () => false, querySelector: () => null };
    expect(validacaoMudou([mud({ type: 'attributes', attributeName: 'aria-invalid' })])).toBe(true);
    expect(validacaoMudou([mud({ type: 'attributes', attributeName: 'class' })])).toBe(false);
    expect(validacaoMudou([mud({ addedNodes: [erro] })])).toBe(true);
    expect(validacaoMudou([mud({ addedNodes: [blocoComErro] })])).toBe(true);
    expect(validacaoMudou([mud({ removedNodes: [erro] })])).toBe(true);
    expect(validacaoMudou([mud({ addedNodes: [outro, 'texto'] })])).toBe(false);
  });
});
