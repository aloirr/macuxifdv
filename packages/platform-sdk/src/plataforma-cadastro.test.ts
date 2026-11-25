/** Contratos do cadastro da empresa, do usuário da sessão e da troca de senha no portal (ADR 0075). Dados fictícios. */
import { describe, expect, it } from 'vitest';
import {
  DadosCadastraisEmpresaSchema,
  GravarDadosCadastraisEmpresaSchema,
  rotaCadastroEmpresa,
  ROTA_PORTAL_CADASTRO_EMPRESA,
  ROTA_PORTAL_TROCAR_SENHA,
  SessaoPortalSchema,
  TrocarSenhaPortalSchema,
  UsuarioDoPortalSchema,
} from './plataforma';

const T = '11111111-1111-4111-8111-111111111111';
const vazio = {
  razao_social: 'Distribuidora Exemplo Ltda',
  logradouro: null,
  numero: null,
  complemento: null,
  bairro: null,
  municipio: null,
  uf: null,
  cep: null,
  telefone: null,
  email: null,
  inscricao_estadual: null,
};

describe('GravarDadosCadastraisEmpresaSchema', () => {
  it('normaliza: apara, vazio = null, CEP/telefone/IE só dígitos, UF e e-mail na caixa certa', () => {
    expect(
      GravarDadosCadastraisEmpresaSchema.parse({
        razao_social: '  Distribuidora Exemplo Ltda ',
        logradouro: ' Av. Djalma Batista ',
        numero: '1000',
        complemento: '',
        bairro: 'Chapada',
        municipio: 'Manaus',
        uf: 'am',
        cep: '69050-010',
        telefone: '(92) 3333-4444',
        email: ' Contato@Exemplo.COM ',
        inscricao_estadual: '04.123.456-7',
      }),
    ).toEqual({
      razao_social: 'Distribuidora Exemplo Ltda',
      logradouro: 'Av. Djalma Batista',
      numero: '1000',
      complemento: null,
      bairro: 'Chapada',
      municipio: 'Manaus',
      uf: 'AM',
      cep: '69050010',
      telefone: '9233334444',
      email: 'contato@exemplo.com',
      inscricao_estadual: '041234567',
    });
    expect(GravarDadosCadastraisEmpresaSchema.parse({ ...vazio, inscricao_estadual: 'isento' }).inscricao_estadual).toBe('ISENTO');
  });

  it('exige as 11 chaves e nenhuma a mais: CNPJ e nome fantasia não entram', () => {
    expect(GravarDadosCadastraisEmpresaSchema.safeParse(vazio).success).toBe(true);
    const { uf: _uf, ...semUf } = vazio;
    expect(GravarDadosCadastraisEmpresaSchema.safeParse(semUf).success).toBe(false);
    expect(GravarDadosCadastraisEmpresaSchema.safeParse({ ...vazio, cnpj: '11222333000181' }).success).toBe(false);
    expect(GravarDadosCadastraisEmpresaSchema.safeParse({ ...vazio, nome_fantasia: 'Exemplo' }).success).toBe(false);
  });

  it.each([
    ['razão social vazia', { razao_social: ' ' }],
    ['UF fora da lista', { uf: 'XX' }],
    ['CEP com 7 dígitos', { cep: '6905001' }],
    ['CEP zerado', { cep: '00000-000' }],
    ['telefone sem DDD', { telefone: '33334444' }],
    ['e-mail sem domínio', { email: 'contato@' }],
    ['IE com letra', { inscricao_estadual: '12AB' }],
    ['número longo demais', { numero: '1'.repeat(21) }],
  ])('recusa %s', (_caso, campo) => {
    expect(GravarDadosCadastraisEmpresaSchema.safeParse({ ...vazio, ...campo }).success).toBe(false);
  });
});

describe('DadosCadastraisEmpresaSchema', () => {
  it('CNPJ com 14 dígitos (nulo só na empresa antiga), razão social sempre e o resto pode faltar', () => {
    const base = { ...vazio, tenant_id: T, cnpj: '11222333000181', nome_fantasia: null, atualizado_em: '2026-11-24T22:00:00.000Z' };
    expect(DadosCadastraisEmpresaSchema.safeParse(base).success).toBe(true);
    expect(DadosCadastraisEmpresaSchema.safeParse({ ...base, cnpj: null }).success).toBe(true);
    expect(DadosCadastraisEmpresaSchema.safeParse({ ...base, cnpj: '11.222.333/0001-81' }).success).toBe(false);
    expect(DadosCadastraisEmpresaSchema.safeParse({ ...base, razao_social: null }).success).toBe(false);
  });
});

describe('sessão e senha do portal', () => {
  const tempo = { token: 'x'.repeat(40), expira_em: '2026-11-24T18:15:00.000Z', sessao_expira_em: '2026-11-25T02:00:00.000Z' };
  const sa = { ...tempo, tipo: 'super_admin', empresa: null, empresas: [] };

  it('usuario é aditivo: ausente, nulo ou com nome, perfil e cargo', () => {
    expect(SessaoPortalSchema.safeParse(sa).success).toBe(true);
    expect(SessaoPortalSchema.safeParse({ ...sa, usuario: null }).success).toBe(true);
    const usuario = { nome: 'Ana Souza', perfil: null, cargo: null };
    expect(SessaoPortalSchema.parse({ ...sa, usuario }).usuario).toEqual(usuario);
    expect(UsuarioDoPortalSchema.safeParse({ nome: '', perfil: null, cargo: null }).success).toBe(false);
  });

  it('troca de senha: só a atual e a nova', () => {
    expect(TrocarSenhaPortalSchema.safeParse({ senha_atual: 'a', senha_nova: 'b' }).success).toBe(true);
    expect(TrocarSenhaPortalSchema.safeParse({ senha_atual: 'a', senha_nova: 'b', totp: '123456' }).success).toBe(false);
    expect(TrocarSenhaPortalSchema.safeParse({ senha_atual: '', senha_nova: 'b' }).success).toBe(false);
  });

  it('rotas', () => {
    expect(ROTA_PORTAL_TROCAR_SENHA).toBe('/v1/plataforma/auth/senha');
    expect(ROTA_PORTAL_CADASTRO_EMPRESA).toBe('/v1/plataforma/empresas/:tenant_id/cadastro');
    expect(rotaCadastroEmpresa(T)).toBe(`/v1/plataforma/empresas/${T}/cadastro`);
  });
});
