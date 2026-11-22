/** T-0087/T-0093: partes puras das telas do portal (passo Empresa com o administrador inicial, entrada, aba Integração). */
import { describe, expect, it } from 'vitest';
import { mensagemBloqueioPorTentativas, mensagemMuitasTentativas } from '@macuxi/core/contracts';
import { CriarEmpresaSchema } from '@macuxi/platform-sdk';

import {
  corpoDaEmpresa,
  errosDaEmpresa,
  sugerirCodigo,
  TEXTOS_ADMIN,
  textoDoAdminNoResultado,
} from '@/components/portal/passo-empresa-legado';
import { abaDoEndereco } from '@/components/portal/tela-empresa';
import { celulaDoPlano } from '@/components/portal/tela-empresas';
import { rotuloDoStatus } from '@/lib/portal-empresa-acoes';
import { mensagemDoLoginPortal, TEXTOS_ENTRAR } from '@/components/portal/tela-entrar';
import { ErroPortal, MENSAGEM_PORTAL_SEM_SEGREDOS, MENSAGEM_SEM_CONEXAO } from './portal-api';

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
  it('sugestão do código', () => {
    expect(sugerirCodigo('Distribuidora São João Ltda.')).toBe('distribuidora-sao-joao');
    expect(sugerirCodigo('ACME S/A')).toBe('acme');
  });
});

describe('passo Empresa: administrador inicial (RN-CORE-34, RN-CORE-32; spec portal-entrar §6)', () => {
  const admin = { nome: 'Ana Souza', email: 'Ana@Empresa.com.br', senha: 'Norte#2026' };
  it('empresa nova leva o admin no corpo (senha sem trim) e passa no CriarEmpresaSchema', () => {
    const c = corpoDaEmpresa({ ...form, admin: { ...admin, senha: ' Norte#2026 ' } }, false) as { admin: { email: string; nome: string; senha: string } };
    expect(c.admin).toEqual({ nome: 'Ana Souza', email: 'Ana@Empresa.com.br', senha: ' Norte#2026 ' });
    expect(CriarEmpresaSchema.parse(c).admin?.email).toBe('ana@empresa.com.br');
    expect(errosDaEmpresa(c)).toEqual({});
  });
  it('empresa existente (sem bloco do admin) não manda admin', () => {
    expect(corpoDaEmpresa(form, false)).not.toHaveProperty('admin');
  });
  it('resultado: criado com o e-mail; existente sem trocar a senha; sem admin no pedido = nada', () => {
    expect(textoDoAdminNoResultado({ admin: 'criado', simulado: false }, 'ana@empresa.com.br')).toBe('Administrador criado: ana@empresa.com.br.');
    expect(textoDoAdminNoResultado({ admin: 'existente', simulado: false }, 'ana@empresa.com.br')).toBe('Administrador mantido: a senha não mudou.');
    // no Conferir nada foi gravado (R-20261107-174216 🟡 6)
    expect(textoDoAdminNoResultado({ admin: 'existente', simulado: true }, null)).toBe('Administrador mantido: a senha não muda.');
    expect(textoDoAdminNoResultado({ admin: null, simulado: false }, null)).toBeNull();
  });
});

describe('entrada só com e-mail e senha (T-0093; spec portal-entrar §1 e §4)', () => {
  it('401: a mesma frase para e-mail inexistente, senha errada e conta sem empresa (nunca a da API)', () => {
    expect(mensagemDoLoginPortal(new ErroPortal(401, 'CREDENCIAIS_INVALIDAS', 'E-mail ou senha incorretos. Confira e tente de novo.'))).toBe('E-mail ou senha incorretos.');
    expect(mensagemDoLoginPortal(new ErroPortal(401, 'CREDENCIAIS_INVALIDAS', 'qualquer'))).toBe(TEXTOS_ENTRAR.credenciais);
  });
  it('423 (também para e-mail inexistente), 429, 503 e sem rede', () => {
    // RN-CORE-01 (T-0185): os textos do contrato do Core; 423 sem `minutos_restantes` = 15 min; 429 com a espera real
    expect(mensagemDoLoginPortal(new ErroPortal(423, 'BLOQUEADO', 'x'))).toBe(mensagemBloqueioPorTentativas(15));
    expect(mensagemDoLoginPortal(new ErroPortal(423, 'BLOQUEADO', 'x', { minutos_restantes: 4 }))).toBe(mensagemBloqueioPorTentativas(4));
    expect(mensagemDoLoginPortal(new ErroPortal(400, 'BLOQUEADO', 'x'))).toBe(mensagemBloqueioPorTentativas());
    expect(mensagemDoLoginPortal(new ErroPortal(429, 'MUITAS_TENTATIVAS', 'x', { retry_after_s: 240 }))).toBe('Muitas tentativas. Tente de novo em 4 minutos.');
    expect(mensagemDoLoginPortal(new ErroPortal(429, 'MUITAS_TENTATIVAS', 'x'))).toBe(mensagemMuitasTentativas());
    expect(mensagemDoLoginPortal(new ErroPortal(503, 'PORTAL_INDISPONIVEL', 'x'))).toBe(MENSAGEM_PORTAL_SEM_SEGREDOS);
    expect(mensagemDoLoginPortal(new ErroPortal(0, 'sem_conexao', MENSAGEM_SEM_CONEXAO))).toBe(MENSAGEM_SEM_CONEXAO);
  });
  it('textos da tela, sem convite, código de verificação, TOTP nem super-admin', () => {
    expect(TEXTOS_ENTRAR.esqueceu).toBe('Esqueceu a senha? Use "Esqueci a senha" no backoffice.');
    expect(TEXTOS_ENTRAR.vazio).toBe('Informe o e-mail e a senha.');
    for (const t of Object.values(TEXTOS_ENTRAR)) expect(t).not.toMatch(/convite|código de|6 dígitos|TOTP|autenticador|super-admin|2º fator/i);
  });
  it('T-0094: 403 SENHA_A_TROCAR manda criar a senha no backoffice (spec ciclo-de-senha §7), nunca a frase da API', () => {
    const e = new ErroPortal(403, 'SENHA_A_TROCAR', 'Antes de entrar no portal, crie a sua senha no backoffice com o código da empresa.');
    expect(mensagemDoLoginPortal(e)).toBe('Crie a sua senha no backoffice antes de entrar aqui.');
    expect(TEXTOS_ADMIN.passeASenha).toBe('Passe esta senha ao administrador. No primeiro acesso ao backoffice, ele cria a dele.');
  });
});

describe('textos do portal (revisão de UX R-20261106-023316)', () => {
  it('situação da empresa em rótulo', () => {
    expect(rotuloDoStatus('ativo')).toBe('Ativa');
    expect(rotuloDoStatus('suspenso')).toBe('Inativa');
    expect(rotuloDoStatus('encerrado')).toBe('Em exclusão');
    expect(rotuloDoStatus('novo')).toBe('Novo');
  });
  it('coluna Plano da lista de empresas (§11.5): nome, selo "teste" só em teste e "—" sem plano', () => {
    expect(celulaDoPlano({ plano: 'PME', em_teste: false })).toEqual({ nome: 'PME', teste: false });
    expect(celulaDoPlano({ plano: 'Enterprise', em_teste: true })).toEqual({ nome: 'Enterprise', teste: true });
    expect(celulaDoPlano({ plano: null, em_teste: true })).toEqual({ nome: '—', teste: false });
    expect(celulaDoPlano({})).toEqual({ nome: '—', teste: false });
    expect(celulaDoPlano({ plano: '  ' })).toEqual({ nome: '—', teste: false });
  });
});

describe('aba Integração', () => {
  it('abas Integração · Empresa: a Integração abre por padrão; o `#bases` antigo e `#` desconhecido caem nela (spec §10.1)', () => {
    expect(abaDoEndereco('')).toBe('integracao');
    expect(abaDoEndereco('#integracao')).toBe('integracao');
    expect(abaDoEndereco('#empresa')).toBe('empresa');
    expect(abaDoEndereco('#bases')).toBe('integracao');
    expect(abaDoEndereco('#qualquer')).toBe('integracao');
  });
});
