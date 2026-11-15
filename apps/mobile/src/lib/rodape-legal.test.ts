/**
 * Rodapé legal da tela Entrar (docs/design/telas/rodape-legal.md §2): campo em branco não aparece, máscara do CNPJ com
 * espaço sem quebra, só um dos dois, site padrão e normalizado, versão ausente. Dados fictícios.
 */
import { describe, expect, it } from 'vitest';

import { linhasDoRodapeLegal, mascaraCnpj, siteDoRodape } from './rodape-legal';

const NBSP = ' ';
const preenchido = { razao_social: 'Empresa Teste Ltda.', cnpj: '11444777000161', site: 'macuxifdv.com.br' };

describe('linhasDoRodapeLegal', () => {
  it('preenchido: empresa, direitos, versão e site', () => {
    const l = linhasDoRodapeLegal({ dados: preenchido, versao: '1.0.9', ano: 2026 });
    expect(l.empresa).toEqual({ razaoSocial: 'Empresa Teste Ltda.', cnpj: `CNPJ${NBSP}11.444.777/0001-61`, leitor: 'Empresa Teste Ltda., CNPJ 11.444.777/0001-61' });
    expect(l.direitos).toEqual({ texto: '© 2026 · Todos os direitos reservados', leitor: 'Copyright 2026. Todos os direitos reservados.' });
    expect(l.versao).toBe('Versão 1.0.9');
    expect(l.site).toBe('macuxifdv.com.br');
    expect(l.url).toBe('https://macuxifdv.com.br');
  });
  it('razão social e CNPJ em branco: a linha 1 some', () => {
    expect(linhasDoRodapeLegal({ dados: { ...preenchido, razao_social: null, cnpj: null }, versao: '1.0.9', ano: 2026 }).empresa).toBeNull();
    expect(linhasDoRodapeLegal({ dados: { ...preenchido, razao_social: '  ', cnpj: '' }, versao: '1.0.9', ano: 2026 }).empresa).toBeNull();
  });
  it('só um dos dois: só ele, sem o separador', () => {
    expect(linhasDoRodapeLegal({ dados: { ...preenchido, cnpj: null }, versao: null, ano: 2026 }).empresa).toEqual({ razaoSocial: 'Empresa Teste Ltda.', cnpj: null, leitor: 'Empresa Teste Ltda.' });
    expect(linhasDoRodapeLegal({ dados: { ...preenchido, razao_social: null }, versao: null, ano: 2026 }).empresa?.razaoSocial).toBeNull();
  });
  it('sem dados (primeira abertura sem rede): linhas 2 e 3 com o site padrão', () => {
    const l = linhasDoRodapeLegal({ dados: null, versao: '1.0.9', ano: 2027 });
    expect(l.empresa).toBeNull();
    expect(l.direitos.texto).toBe('© 2027 · Todos os direitos reservados');
    expect(l.site).toBe('macuxifdv.com.br');
  });
  it('sem versão: a linha 3 fica só com o site (nunca "Versão ?")', () => {
    expect(linhasDoRodapeLegal({ dados: preenchido, versao: undefined, ano: 2026 }).versao).toBeNull();
    expect(linhasDoRodapeLegal({ dados: preenchido, versao: ' ', ano: 2026 }).versao).toBeNull();
  });
});

describe('site e CNPJ', () => {
  it('site sem https, www e barra; vazio ou inválido vira o padrão', () => {
    expect(siteDoRodape('https://www.Exemplo.com.br/')).toBe('exemplo.com.br');
    expect(siteDoRodape('')).toBe('macuxifdv.com.br');
    expect(siteDoRodape('não é site')).toBe('macuxifdv.com.br');
  });
  it('máscara só com 14 dígitos', () => {
    expect(mascaraCnpj('11444777000161')).toBe('11.444.777/0001-61');
    expect(mascaraCnpj('123')).toBe('123');
  });
});
