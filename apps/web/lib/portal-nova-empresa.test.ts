/**
 * Spec docs/design/telas/portal-config-enxuto.md §4 e §11 (ADR 0047): corpo e erros da "Nova empresa" com plano, contra o
 * `CriarEmpresaComPlanoSchema` do SDK; código da licença UF + 4 dígitos; formatos do portal num lugar só (RD-0263).
 */
import { describe, expect, it } from 'vitest';
import { CriarEmpresaComPlanoSchema, valorDaAssinatura } from '@macuxi/platform-sdk';

import { ErroPortal } from './portal-api';
import { codigoDaLicenca, diaCivil, FUSO_DA_UF, formatarTelefone, mascararCnpj, rotuloCurtoDoFuso, rotuloDoFuso } from './portal-formato';
import {
  codigoDaUf,
  codigoLivre,
  corpoDaNovaEmpresa,
  erroDoAdminNaApi,
  errosDaNovaEmpresa,
  errosDoAdmin,
  guardarEmpresaCriada,
  problemasDoPlano,
  retirarEmpresaCriada,
  TEXTOS_ADMIN,
  TEXTOS_NOVA_EMPRESA,
  type FormNovaEmpresa,
} from './portal-nova-empresa';
import { planoExemplo } from './portal-planos.fixture';

const form: FormNovaEmpresa = {
  cnpj: '11.222.333/0001-81',
  razao_social: 'Distribuidora Uma Ltda',
  uf: 'AM',
  fuso: 'America/Manaus',
  escolha: { plano: 'pme', ciclo: 'mensal', adicionais: { promotor: '3', pesquisa: '10' }, teste: false },
  admin: { nome: 'Ana Souza', email: 'Ana@Uma.com.br', senha: 'Norte#2026' },
  pedido_id: '9a0c1e52-5c1e-4c4e-9a43-0000000000bb',
};

describe('formatos do portal (RD-0263)', () => {
  it('CNPJ, fuso longo e curto, código em maiúsculas, telefone e dia civil', () => {
    expect(mascararCnpj('11222333000181')).toBe('11.222.333/0001-81');
    expect(mascararCnpj('112223')).toBe('11.222.3');
    expect(rotuloDoFuso('America/Manaus')).toBe('Manaus (AM, RR, RO) — UTC−4');
    expect(rotuloDoFuso('Europe/Lisbon')).toBe('Europe/Lisbon');
    expect(rotuloCurtoDoFuso('America/Manaus')).toBe('Manaus (UTC−4)');
    expect(rotuloCurtoDoFuso('America/Sao_Paulo')).toBe('São Paulo (UTC−3)');
    expect(rotuloCurtoDoFuso('Europe/Lisbon')).toBe('Europe/Lisbon');
    expect(FUSO_DA_UF.AM).toBe('America/Manaus');
    expect(FUSO_DA_UF.AC).toBe('America/Rio_Branco');
    expect(codigoDaLicenca('am4821')).toBe('AM4821');
    expect(formatarTelefone('92991234567')).toBe('(92) 99123-4567');
    expect(formatarTelefone(null)).toBe('');
    expect(diaCivil('2026-11-27')).toBe('27/11/2026');
  });
});

describe('código da licença (UF + 4 dígitos; migração 0068)', () => {
  it('sigla da UF e 4 dígitos com zeros à esquerda; passa no contrato', () => {
    expect(codigoDaUf('AM', 4821)).toBe('am4821');
    expect(codigoDaUf('rr', 7)).toBe('rr0007');
    expect(() => codigoDaUf('XX', 1)).toThrow(RangeError);
    expect(() => codigoDaUf('AM', 10_000)).toThrow(RangeError);
    expect(CriarEmpresaComPlanoSchema.parse(corpoDaNovaEmpresa(form, codigoDaUf('AM', 4821), true)).codigo).toBe('am4821');
  });
  it('o simular só libera o código com "criado" (outro = empresa que já existe)', () => {
    expect(codigoLivre({ resultado: 'criado' })).toBe(true);
    expect(codigoLivre({ resultado: 'atualizado' })).toBe(false);
    expect(codigoLivre({ resultado: 'sem_mudanca' })).toBe(false);
  });
});

describe('corpo da Nova empresa (§4, §11.3)', () => {
  it('sem módulos nem parâmetros; plano, ciclo, adicionais, teste e pedido_id; senha sem trim', () => {
    const c = CriarEmpresaComPlanoSchema.parse(corpoDaNovaEmpresa({ ...form, admin: { ...form.admin, senha: ' Norte#2026 ' } }, 'am4821', false));
    expect(c).toMatchObject({
      codigo: 'am4821',
      cnpj: '11222333000181',
      fuso: 'America/Manaus',
      simular: false,
      admin: { nome: 'Ana Souza', email: 'ana@uma.com.br', senha: ' Norte#2026 ' },
      assinatura: {
        plano: 'pme',
        ciclo: 'mensal',
        adicionais: [
          { adicional: 'promotor', quantidade: 3 },
          { adicional: 'pesquisa', quantidade: 10 },
        ],
        com_teste: false,
        pedido_id: form.pedido_id,
      },
    });
    expect(c).not.toHaveProperty('modulos');
    // o "Total" da tela é o mesmo que a API devolve em `valor` (RN-PLA-06)
    expect(valorDaAssinatura(planoExemplo('pme'), c.assinatura.adicionais, 'mensal').por_ciclo_centavos).toBe(153_700);
    expect(errosDaNovaEmpresa(form)).toEqual({});
  });
  it('erros por campo: UF, razão social, plano, quantidade e o administrador', () => {
    const e = errosDaNovaEmpresa({
      ...form,
      uf: '',
      razao_social: 'A',
      escolha: { plano: null, ciclo: 'mensal', adicionais: { promotor: '0' }, teste: false },
      admin: { nome: '', email: '', senha: '' },
    });
    expect(e).toEqual({
      uf: 'Escolha a UF.',
      razao_social: 'Informe a razão social, de 2 a 200 caracteres.',
      plano: 'Escolha o plano.',
      'adicional-promotor': 'Informe a quantidade.',
      'admin.nome': 'Informe o nome.',
      'admin.email': 'Informe o e-mail.',
      'admin.senha': 'Informe a senha inicial.',
    });
  });
  it('administrador: RN-CORE-32 pela regra do Core; nome curto e e-mail inválido em pt-BR', () => {
    expect(errosDoAdmin({ ...form.admin, senha: 'Norte2026' })['admin.senha']).toBe('Falta um caractere especial.');
    expect(errosDoAdmin({ nome: 'A', email: 'ana@', senha: 'Norte#2026' })).toEqual({ 'admin.nome': TEXTOS_ADMIN.nomeCurto, 'admin.email': TEXTOS_ADMIN.emailInvalido });
    expect(TEXTOS_ADMIN.passeASenha).toBe('Passe esta senha ao administrador.');
  });
  it('422: administrador (RN-CORE-34 no bloco, RN-CORE-32 no campo) e problemas do plano', () => {
    expect(erroDoAdminNaApi(new ErroPortal(422, 'RN-CORE-34', 'x'), '')).toEqual({ bloco: 'Informe o administrador da empresa.' });
    expect(erroDoAdminNaApi(new ErroPortal(422, 'RN-CORE-32', 'x', { faltas: ['numero', 'especial'] }), 'Senhaforte')).toEqual({ senha: 'Faltam um número e um caractere especial.' });
    expect(erroDoAdminNaApi(new ErroPortal(422, 'PLANO_INATIVO', 'x'), '')).toBeNull();
    expect(problemasDoPlano(new ErroPortal(422, 'PLANO_INATIVO', 'O plano Light não está mais à venda.', { problemas: [{ codigo: 'PLANO_INATIVO', mensagem: 'O plano Light não está mais à venda.' }] }))).toEqual([
      'O plano Light não está mais à venda.',
    ]);
    expect(problemasDoPlano(new ErroPortal(422, 'RN-CORE-31', 'x'))).toBeNull();
  });
  it('sucesso: aviso uma vez, com o código em maiúsculas', () => {
    expect(TEXTOS_NOVA_EMPRESA.criada('am4821')).toBe('Empresa criada. Código da empresa: AM4821.');
    guardarEmpresaCriada('t1', 'am4821');
    expect(retirarEmpresaCriada('t1')).toBe('am4821');
    expect(retirarEmpresaCriada('t1')).toBeNull();
  });
});
