/** T-0087: partes puras das telas do portal (passo Empresa, primeiro acesso, aba Integração). */
import { describe, expect, it } from 'vitest';
import { ENTIDADES } from '@macuxi/integracao/contracts';
import { CriarEmpresaSchema } from '@macuxi/platform-sdk';

import { entidadesLivres } from '@/components/portal/aba-integracao';
import { apenasDigitos } from '@/components/portal/cadastro-totp';
import { corpoDaEmpresa, errosDaEmpresa, mascararCnpj, sugerirCodigo } from '@/components/portal/passo-empresa';
import { validarPrimeiroAcesso } from '@/components/portal/tela-primeiro-acesso';
import { mensagemDoLoginPortal } from '@/components/portal/tela-entrar';
import { ErroPortal } from './portal-api';

const form = {
  codigo: 'distribuidora-norte',
  razao_social: 'Distribuidora Norte Ltda',
  cnpj: '11.222.333/0001-81',
  fuso: 'America/Manaus',
  modulos: { vendedor: { marcado: true, licencas: '12' }, catalogo: { marcado: true, licencas: '' }, promotor: { marcado: false, licencas: '5' } },
  alcada_vendedor_pct: '5',
  alcada_supervisor_pct: '10,5',
  alcada_gerente_pct: '15',
  validade_orcamento_dias: '7',
  aplicacao_no_orcamento_padrao: true,
};

describe('passo Empresa', () => {
  it('corpo: core e integracao sempre; licença vazia = sem limite; vírgula decimal; passa no CriarEmpresaSchema', () => {
    const c = corpoDaEmpresa(form, true) as { modulos: { modulo: string; licencas: number | null }[]; parametros: Record<string, unknown>; simular: boolean };
    expect(c.modulos).toEqual([
      { modulo: 'core', licencas: null },
      { modulo: 'catalogo', licencas: null },
      { modulo: 'vendedor', licencas: 12 },
      { modulo: 'integracao', licencas: null },
    ]);
    expect(c.parametros.alcada_supervisor_pct).toBe(10.5);
    expect(c.simular).toBe(true);
    const p = CriarEmpresaSchema.parse(c);
    expect(p.cnpj).toBe('11222333000181');
    expect(errosDaEmpresa(c)).toEqual({});
  });
  it('erros por campo: CNPJ com dígito errado e alçadas fora de ordem', () => {
    const e = errosDaEmpresa(corpoDaEmpresa({ ...form, cnpj: '11.222.333/0001-82', alcada_supervisor_pct: '20', alcada_gerente_pct: '15' }, false));
    expect(Object.keys(e).sort()).toEqual(['cnpj', 'parametros.alcada_supervisor_pct']);
  });
  it('erros por campo em pt-BR: razão social curta, alçada acima de 100, validade fora de 1-90', () => {
    const e = errosDaEmpresa(corpoDaEmpresa({ ...form, razao_social: 'A', alcada_supervisor_pct: '10', alcada_gerente_pct: '150', validade_orcamento_dias: '91' }, false));
    expect(e.razao_social).toBe('Informe a razão social, de 2 a 200 caracteres.');
    expect(e['parametros.alcada_gerente_pct']).toBe('Informe um percentual de 0 a 100.');
    expect(e['parametros.validade_orcamento_dias']).toBe('Informe de 1 a 90 dias.');
    expect(Object.values(e).join(' ')).not.toMatch(/must|String|Number/);
    expect(errosDaEmpresa(corpoDaEmpresa({ ...form, validade_orcamento_dias: '0' }, false))['parametros.validade_orcamento_dias']).toBe('Informe de 1 a 90 dias.');
  });
  it('sugestão do código e máscara do CNPJ', () => {
    expect(sugerirCodigo('Distribuidora São João Ltda.')).toBe('distribuidora-sao-joao');
    expect(sugerirCodigo('ACME S/A')).toBe('acme');
    expect(mascararCnpj('11222333000181')).toBe('11.222.333/0001-81');
    expect(mascararCnpj('112223')).toBe('11.222.3');
  });
});

describe('primeiro acesso e entrada', () => {
  it('confere e-mail, nome, senha de 12+, confirmação e convite de 32+', () => {
    expect(validarPrimeiroAcesso({ email: 'a@b.com', nome: 'Alê', senha: 'x'.repeat(12), confirmacao: 'x'.repeat(12), convite: 'c'.repeat(32) })).toEqual({});
    expect(Object.keys(validarPrimeiroAcesso({ email: 'a', nome: '', senha: 'curta', confirmacao: 'outra', convite: 'c' })).sort()).toEqual(['confirmacao', 'convite', 'email', 'nome', 'senha']);
  });
  it('código só com dígitos, até 6', () => {
    expect(apenasDigitos('12 34-567')).toBe('123456');
  });
  it('mensagem do login: mesma frase para e-mail inexistente e senha errada', () => {
    expect(mensagemDoLoginPortal(new ErroPortal(401, 'CREDENCIAIS_INVALIDAS', 'qualquer'))).toBe('E-mail ou senha incorretos.');
    expect(mensagemDoLoginPortal(new ErroPortal(503, 'PORTAL_INDISPONIVEL', 'x'))).toMatch(/não está configurado/);
  });
});

describe('aba Integração', () => {
  it('bases livres: as que nenhum outro Conector ativo recebe', () => {
    const conectores = [
      { conector_id: 'implantacao-csv', ativo: true, entidades: ['vendedor', 'cliente'] as const },
      { conector_id: 'velho', ativo: false, entidades: ['produto'] as const },
    ].map((c) => ({ ...c, entidades: [...c.entidades] }));
    const livres = entidadesLivres(conectores);
    expect(livres).not.toContain('vendedor');
    expect(livres).not.toContain('cliente');
    expect(livres).toContain('produto');
    // T-0089: as bases de pagamento e a escalonada também ficam livres para o Conector do ERP
    for (const e of ['forma_pagamento', 'prazo_pagamento', 'tabela_escalonada'] as const) expect(livres).toContain(e);
    expect(livres).toEqual(ENTIDADES.filter((e) => e !== 'vendedor' && e !== 'cliente'));
    expect(livres).toHaveLength(13);
    expect(entidadesLivres(conectores, 'implantacao-csv')).toEqual([...ENTIDADES]);
    expect(entidadesLivres(conectores, 'implantacao-csv')).toHaveLength(15);
  });
});
