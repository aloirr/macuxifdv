/** T-0087: partes puras das telas do portal (passo Empresa, primeiro acesso, aba Integração). */
import { describe, expect, it } from 'vitest';
import { ENTIDADES } from '@macuxi/integracao/contracts';
import { CriarEmpresaSchema } from '@macuxi/platform-sdk';

import { entidadesLivres } from '@/components/portal/aba-integracao';
import { textoCodigosRestantes } from '@/components/portal/base';
import { apenasDigitos } from '@/components/portal/cadastro-totp';
import { resumoDoArquivo, TEXTO_COMPLETO_COM_ERROS } from '@/components/portal/cartao-base';
import { corpoDaEmpresa, errosDaEmpresa, mascararCnpj, rotuloDoFuso, sugerirCodigo } from '@/components/portal/passo-empresa';
import { rotuloDoStatus } from '@/components/portal/tela-empresas';
import { validarPrimeiroAcesso } from '@/components/portal/tela-primeiro-acesso';
import { mensagemDoCodigoPortal, mensagemDoLoginPortal } from '@/components/portal/tela-entrar';
import { AJUDA_CONVITE_SUPER_ADMIN, ErroPortal, MENSAGEM_CONVITE_SUPER_ADMIN_INCORRETO, MENSAGEM_PORTAL_SEM_SEGREDOS, MENSAGEM_RECUPERACAO_INCORRETA, MENSAGEM_TOTP_INCORRETO } from './portal-api';

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
    expect(mensagemDoLoginPortal(new ErroPortal(503, 'PORTAL_INDISPONIVEL', 'x'))).toBe(MENSAGEM_PORTAL_SEM_SEGREDOS);
  });
  it('mensagem do 2º passo: recuperação fala do código usado; TOTP fala da hora do celular (R-20261106-023316 🟡 3)', () => {
    const errado = new ErroPortal(401, 'CODIGO_INVALIDO', 'Código incorreto. Confira o aplicativo autenticador e tente de novo.');
    expect(mensagemDoCodigoPortal(errado, true)).toBe(MENSAGEM_RECUPERACAO_INCORRETA);
    expect(mensagemDoCodigoPortal(errado, false)).toBe(MENSAGEM_TOTP_INCORRETO);
    expect(MENSAGEM_TOTP_INCORRETO).toMatch(/hora do celular/);
    expect(mensagemDoCodigoPortal(new ErroPortal(423, 'BLOQUEADO', 'Acesso bloqueado.'), true)).toBe('Acesso bloqueado.');
    expect(mensagemDoCodigoPortal(new ErroPortal(503, 'PORTAL_INDISPONIVEL', 'x'), false)).toBe(MENSAGEM_PORTAL_SEM_SEGREDOS);
  });
  it('T-0091: textos do convite e dos segredos valem na produção e na demo (nomes dos secrets, nunca valor)', () => {
    expect(AJUDA_CONVITE_SUPER_ADMIN).toMatch(/PROD_SUPERADMIN_CONVITE na produção/);
    expect(AJUDA_CONVITE_SUPER_ADMIN).toMatch(/DEMO_SUPERADMIN_CONVITE na demo/);
    for (const t of [MENSAGEM_CONVITE_SUPER_ADMIN_INCORRETO, MENSAGEM_PORTAL_SEM_SEGREDOS]) {
      expect(t).not.toMatch(/PRODUCAO|PROD_|DEMO_/);
    }
  });
});

describe('textos do portal (revisão de UX R-20261106-023316)', () => {
  it('selo dos códigos de recuperação restantes', () => {
    expect(textoCodigosRestantes(3)).toBe('Restam 3 códigos de recuperação');
    expect(textoCodigosRestantes(1)).toBe('Resta 1 código de recuperação');
    expect(textoCodigosRestantes(0)).toBe('Nenhum código de recuperação');
  });
  it('fuso e situação da empresa em rótulo', () => {
    expect(rotuloDoFuso('America/Manaus')).toBe('Manaus (AM, RR, RO) — UTC−4');
    expect(rotuloDoFuso('Europe/Lisbon')).toBe('Europe/Lisbon');
    expect(rotuloDoStatus('ativo')).toBe('Ativa');
    expect(rotuloDoStatus('suspenso')).toBe('Suspensa');
    expect(rotuloDoStatus('encerrado')).toBe('Encerrada');
    expect(rotuloDoStatus('novo')).toBe('Novo');
  });
  it('modo completo: arquivo e tamanho no diálogo; linhas com erro não inativam (RN-INT-06, R-20261106-030101)', () => {
    expect(resumoDoArquivo('produtos.csv', 20000, 4)).toBe('produtos.csv, 20.000 linhas em 4 partes');
    expect(resumoDoArquivo('rotas.csv', 1, 1)).toBe('rotas.csv, 1 linha');
    expect(resumoDoArquivo(null, 30, 1)).toBe('30 linhas');
    expect(TEXTO_COMPLETO_COM_ERROS).toMatch(/nada é inativado/);
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
