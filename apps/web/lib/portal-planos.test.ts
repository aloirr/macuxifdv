/**
 * Spec portal-config-enxuto §4, §11.2, §11.3 e §11.4: planos (catálogo do modo falso = a tabela da spec), CNPJ pela Receita e o corpo
 * da Nova empresa. Valores conferidos contra a tabela do dono do produto (R-20261114-132600) e o `valorDaAssinatura` (RN-PLA-06).
 */
import { describe, expect, it } from 'vitest';
import { CriarEmpresaComPlanoSchema, type ConsultaCnpjResposta, type FichaAssinatura } from '@macuxi/platform-sdk';

import { ErroPortal } from './portal-api';
import {
  camposDaConsulta,
  cnaeDaConsulta,
  cnpjLiberaCriar,
  estadoDaConsulta,
  estadoDoErroCnpj,
  estadoLocalDoCnpj,
  preencherCampos,
  textoDoEstadoCnpj,
  TEXTOS_CNPJ,
  type CamposDaReceita,
} from './portal-cnpj';
import { PLANOS_FALSOS } from './portal-falso';
import {
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
import {
  adicionaisAVenda,
  corpoDaTroca,
  ESCOLHA_VAZIA,
  errosDaEscolha,
  escolhaDaFicha,
  licencasDoPlano,
  licencasDoPlanoEmDuasLinhas,
  linhasDaFicha,
  mudouDaFicha,
  partesDoPrecoDoPlano,
  precoDoAdicional,
  problemasDaTroca,
  totalDaEscolha,
  type EscolhaDaTela,
} from './portal-planos';

const [light, pme, enterprise, corporate] = PLANOS_FALSOS;
if (!light || !pme || !enterprise || !corporate) throw new Error('catálogo falso incompleto');

describe('planos (§11.3)', () => {
  it('preço por ciclo: mensal e anual = (12 − 2 meses grátis) × mensal', () => {
    expect(PLANOS_FALSOS.map((p) => Object.values(partesDoPrecoDoPlano(p, 'mensal')).join(''))).toEqual(['R$ 610,00/mês', 'R$ 1.197,00/mês', 'R$ 1.719,00/mês', 'R$ 2.592,50/mês']);
    expect(PLANOS_FALSOS.map((p) => Object.values(partesDoPrecoDoPlano(p, 'anual')).join(''))).toEqual(['R$ 6.100,00/ano', 'R$ 11.970,00/ano', 'R$ 17.190,00/ano', 'R$ 25.925,00/ano']);
  });
  it('licenças: singular com 1, BKO invariável, promotor 0 não aparece, null = sem limite', () => {
    expect(PLANOS_FALSOS.map(licencasDoPlano)).toEqual([
      '10 vendedores · 1 gestor · 1 BKO',
      '20 vendedores · 2 gestores · 3 BKO',
      '30 vendedores · 3 gestores · 5 BKO',
      '50 vendedores · 5 gestores · 5 BKO',
    ]);
    expect(licencasDoPlano({ ...light, licencas: { ...light.licencas, vendedor: null } })).toBe('vendedores sem limite · 1 gestor · 1 BKO');
  });
  it('adicionais: os três em todos os planos; preço segue o ciclo; fora do plano não aparece', () => {
    expect(adicionaisAVenda(pme)).toEqual(['promotor', 'pesquisa', 'treinamento']);
    expect(precoDoAdicional(pme, 'promotor', 'mensal')).toBe('R$ 80,00 por licença/mês');
    expect(precoDoAdicional(pme, 'pesquisa', 'mensal')).toBe('R$ 10,00 por usuário/mês');
    expect(precoDoAdicional(pme, 'promotor', 'anual')).toBe('R$ 800,00 por licença/ano');
    expect(precoDoAdicional(pme, 'treinamento', 'anual')).toBe('R$ 100,00 por usuário/ano');
    expect(adicionaisAVenda({ ...pme, adicionais: pme.adicionais.filter((a) => a.adicional !== 'treinamento') })).toEqual(['promotor', 'pesquisa']);
  });
  it('total: PME + 3 Promotor Avulso + 10 Pesquisa = R$ 1.537,00/mês; R$ 15.370,00/ano; some sem plano', () => {
    const e: EscolhaDaTela = { plano: 'pme', ciclo: 'mensal', adicionais: { promotor: '3', pesquisa: '10' }, teste: false };
    expect(totalDaEscolha(PLANOS_FALSOS, e)).toBe('Total: R$ 1.537,00/mês');
    expect(totalDaEscolha(PLANOS_FALSOS, { ...e, ciclo: 'anual' })).toBe('Total: R$ 15.370,00/ano');
    expect(totalDaEscolha(PLANOS_FALSOS, ESCOLHA_VAZIA)).toBeNull();
  });
  it('escolha: começa sem plano, Mensal e sem teste (decidido em 14/11); erros "Escolha o plano." e "Informe a quantidade."', () => {
    expect(ESCOLHA_VAZIA).toEqual({ plano: null, ciclo: 'mensal', adicionais: {}, teste: false });
    expect(errosDaEscolha({ ...ESCOLHA_VAZIA, adicionais: { promotor: '', pesquisa: '0', treinamento: '2' } })).toEqual({
      plano: 'Escolha o plano.',
      'adicional-promotor': 'Informe a quantidade.',
      'adicional-pesquisa': 'Informe a quantidade.',
    });
  });
});

describe('ficha da assinatura (§11.4)', () => {
  const ficha = (licencas: FichaAssinatura['licencas']): Pick<FichaAssinatura, 'licencas'> => ({ licencas });
  it('blocos "{em uso} de {contratadas}": Vendedor, Gestor e BKO sempre; adicional só contratado; no limite = selo; null = sem limite', () => {
    const linhas = linhasDaFicha(
      ficha([
        { item: 'vendedor', contratadas: 20, em_uso: 14 },
        { item: 'gestor', contratadas: 2, em_uso: 2 },
        { item: 'bko', contratadas: null, em_uso: 1 },
        { item: 'promotor', contratadas: 3, em_uso: 3 },
        { item: 'pesquisa', contratadas: 10, em_uso: 6 },
        { item: 'treinamento', contratadas: 0, em_uso: 0 },
      ]),
    );
    expect(linhas.map((l) => [l.rotulo, l.emUso, l.complemento, l.noLimite, l.adicional])).toEqual([
      ['Vendedor', 14, 'de 20', false, false],
      ['Gestor', 2, 'de 2', true, false],
      ['BKO', 1, '· sem limite', false, false],
      ['Promotor Avulso', 3, 'de 3', true, true],
      ['Pesquisa', 6, 'de 10', false, true],
    ]);
  });
});

describe('trocar de plano (§11.4)', () => {
  const licencas: FichaAssinatura['licencas'] = [
    { item: 'vendedor', contratadas: 20, em_uso: 14 },
    { item: 'gestor', contratadas: 2, em_uso: 2 },
    { item: 'bko', contratadas: 3, em_uso: 1 },
    { item: 'promotor', contratadas: 3, em_uso: 3 },
    { item: 'pesquisa', contratadas: 10, em_uso: 6 },
    { item: 'treinamento', contratadas: 0, em_uso: 0 },
  ];
  const ficha = { plano: pme, ciclo: 'mensal' as const, adicionais: [{ adicional: 'promotor' as const, quantidade: 3 }, { adicional: 'pesquisa' as const, quantidade: 10 }], licencas };

  it('abre com o plano, o ciclo e os adicionais de hoje; sem mudança não troca', () => {
    const e = escolhaDaFicha(ficha);
    expect(e).toEqual({ plano: 'pme', ciclo: 'mensal', adicionais: { promotor: '3', pesquisa: '10' }, teste: false });
    expect(mudouDaFicha(ficha, e)).toBe(false);
    expect(mudouDaFicha(ficha, { ...e, ciclo: 'anual' })).toBe(true);
    expect(mudouDaFicha(ficha, { ...e, plano: 'enterprise' })).toBe(true);
    expect(mudouDaFicha(ficha, { ...e, adicionais: { promotor: '3' } })).toBe(true);
  });

  it('Enterprise no Anual com Promotor Avulso 3 e Pesquisa 10 = R$ 20.590,00/ano (simulação 06d)', () => {
    const e: EscolhaDaTela = { ...escolhaDaFicha(ficha), plano: 'enterprise', ciclo: 'anual' };
    expect(totalDaEscolha(PLANOS_FALSOS, e)).toBe('Total: R$ 20.590,00/ano');
    expect(problemasDaTroca(PLANOS_FALSOS, ficha, e)).toEqual([]);
    expect(corpoDaTroca(e, '9b1c2d3e-0000-4000-8000-000000000001')).toEqual({
      plano: 'enterprise',
      ciclo: 'anual',
      adicionais: [{ adicional: 'promotor', quantidade: 3 }, { adicional: 'pesquisa', quantidade: 10 }],
      pedido_id: '9b1c2d3e-0000-4000-8000-000000000001',
    });
  });

  it('plano abaixo do uso: uma frase por item, do contrato (RN-PLA-05)', () => {
    const e: EscolhaDaTela = { ...escolhaDaFicha(ficha), plano: 'light' };
    expect(problemasDaTroca(PLANOS_FALSOS, ficha, e)).toEqual([
      'O plano Light tem 10 licenças de vendedor e a empresa usa 14.',
      'O plano Light tem 1 licença de gestor e a empresa usa 2.',
    ]);
  });

  it('licenças do plano em duas linhas no diálogo', () => {
    expect(licencasDoPlanoEmDuasLinhas(enterprise)).toEqual(['30 vendedores', '3 gestores · 5 BKO']);
  });
});

describe('CNPJ pela Receita (§11.2)', () => {
  const resposta: ConsultaCnpjResposta = {
    cnpj: '11222333000181',
    razao_social: 'Distribuidora Uma Ltda',
    nome_fantasia: 'Distribuidora Uma',
    endereco: { logradouro: 'Rua Fictícia', numero: '100', complemento: null, bairro: 'Bairro Teste' },
    municipio: 'Manaus',
    uf: 'AM',
    cep: '69000000',
    situacao_cadastral: 'ativa',
    cnae_principal: { codigo: '4639701', descricao: 'Comércio atacadista de alimentos' },
    telefone: '9200000000',
    email: 'contato@distribuidorauma.invalid',
    fonte: 'brasilapi',
  };
  it('antes de buscar: vazio, inválido (menos de 14 ou dígito errado) ou pronto', () => {
    expect(estadoLocalDoCnpj('')).toBe('vazio');
    expect(estadoLocalDoCnpj('11.222.333/0001')).toBe('invalido');
    expect(estadoLocalDoCnpj('11.222.333/0001-82')).toBe('invalido');
    expect(estadoLocalDoCnpj('11.222.333/0001-81')).toBe('pronto');
  });
  it('textos dos estados (uma frase; o encontrado não tem texto); só o encontrado libera o Criar', () => {
    expect(textoDoEstadoCnpj('buscando', null)).toBe('Buscando na Receita…');
    expect(textoDoEstadoCnpj('encontrado', 'ativa')).toBeNull();
    expect(TEXTOS_CNPJ.encontrado).toBe('CNPJ encontrado');
    expect(textoDoEstadoCnpj('invalido', null)).toBe('CNPJ inválido. Confira os 14 dígitos.');
    expect(textoDoEstadoCnpj('nao-encontrado', null)).toBe('CNPJ não encontrado na Receita.');
    expect(textoDoEstadoCnpj('receita-fora', null)).toBe('A Receita não respondeu.');
    expect((['baixada', 'suspensa', 'inapta', 'nula'] as const).map((s) => textoDoEstadoCnpj('nao-ativa', s))).toEqual([
      'CNPJ baixado na Receita. Use um CNPJ ativo.',
      'CNPJ suspenso na Receita. Use um CNPJ ativo.',
      'CNPJ inapto na Receita. Use um CNPJ ativo.',
      'CNPJ nulo na Receita. Use um CNPJ ativo.',
    ]);
    expect((['vazio', 'buscando', 'invalido', 'nao-encontrado', 'receita-fora', 'nao-ativa'] as const).some(cnpjLiberaCriar)).toBe(false);
    expect(cnpjLiberaCriar('encontrado')).toBe(true);
  });
  it('consulta → estado e campos; o CNAE vem formatado; o que foi editado à mão fica', () => {
    expect(estadoDaConsulta(resposta)).toBe('encontrado');
    expect(estadoDaConsulta({ situacao_cadastral: 'baixada' })).toBe('nao-ativa');
    const c = camposDaConsulta(resposta);
    expect(c).toEqual({
      razao_social: 'Distribuidora Uma Ltda',
      nome_fantasia: 'Distribuidora Uma',
      endereco: 'Rua Fictícia, 100 · Bairro Teste · 69000-000',
      municipio: 'Manaus',
      uf: 'AM',
      telefone: '(92) 0000-0000',
      email: 'contato@distribuidorauma.invalid',
    });
    expect(cnaeDaConsulta(resposta)).toBe('4639-7/01 · Comércio atacadista de alimentos');
    const atuais: CamposDaReceita = { ...c, razao_social: 'Digitada', nome_fantasia: '' };
    const r = preencherCampos(atuais, { ...c, razao_social: 'Outra', nome_fantasia: 'Fantasia' }, new Set(['razao_social', 'nome_fantasia']));
    expect([r.razao_social, r.nome_fantasia]).toEqual(['Digitada', 'Fantasia']);
  });
  it('erros da API → estado do campo (a rota ainda ausente conta como Receita fora: não cria)', () => {
    expect(estadoDoErroCnpj(new ErroPortal(400, 'CNPJ_INVALIDO', 'x'))).toBe('invalido');
    expect(estadoDoErroCnpj(new ErroPortal(404, 'CNPJ_NAO_ENCONTRADO', 'x'))).toBe('nao-encontrado');
    expect(estadoDoErroCnpj(new ErroPortal(422, 'CNPJ_INATIVO', 'x'))).toBe('nao-ativa');
    expect(estadoDoErroCnpj(new ErroPortal(503, 'CNPJ_FONTE_FORA', 'x'))).toBe('receita-fora');
    expect(estadoDoErroCnpj(new ErroPortal(429, 'CNPJ_LIMITE', 'x'))).toBe('receita-fora');
    expect(estadoDoErroCnpj(new ErroPortal(404, 'NAO_ENCONTRADO', 'x'))).toBe('receita-fora');
    expect(estadoDoErroCnpj(new ErroPortal(422, 'RN-CORE-32', 'x'))).toBeNull();
  });
});

describe('Nova empresa (§4 e §11)', () => {
  const form: FormNovaEmpresa = {
    cnpj: '11.222.333/0001-81',
    razao_social: ' Distribuidora Uma Ltda ',
    uf: 'AM',
    fuso: 'America/Manaus',
    escolha: { plano: 'pme', ciclo: 'mensal', adicionais: { promotor: '3', pesquisa: '10' }, teste: false },
    admin: { nome: 'Ana Exemplo', email: 'Ana@Uma.com.br', senha: 'Norte#2026' },
    pedido_id: '3f1c2b4a-1d2e-4f5a-8b6c-7d8e9f0a1b2c',
  };
  it('corpo: UF sem código (o servidor sorteia UF + 4), sem parâmetros nem módulos, com a assinatura; passa no contrato', () => {
    const c = corpoDaNovaEmpresa(form) as Record<string, unknown>;
    expect(c).not.toHaveProperty('codigo');
    expect(c).not.toHaveProperty('parametros');
    expect(c).not.toHaveProperty('modulos');
    expect(c.uf).toBe('AM');
    expect(c.assinatura).toEqual({ plano: 'pme', ciclo: 'mensal', adicionais: [{ adicional: 'promotor', quantidade: 3 }, { adicional: 'pesquisa', quantidade: 10 }], com_teste: false, pedido_id: form.pedido_id });
    const p = CriarEmpresaComPlanoSchema.omit({ codigo: true }).parse(c);
    expect([p.cnpj, p.razao_social, p.admin?.email]).toEqual(['11222333000181', 'Distribuidora Uma Ltda', 'ana@uma.com.br']);
    expect(errosDaNovaEmpresa(form)).toEqual({});
  });
  it('erros: UF, razão social, plano, quantidade e administrador, em pt-BR', () => {
    const e = errosDaNovaEmpresa({ ...form, uf: '', razao_social: 'A', escolha: { ...form.escolha, plano: null, adicionais: { promotor: '' } }, admin: { nome: '', email: '', senha: '' } });
    expect(e).toEqual({
      uf: 'Escolha a UF.',
      razao_social: 'Informe a razão social, de 2 a 200 caracteres.',
      plano: 'Escolha o plano.',
      'adicional-promotor': 'Informe a quantidade.',
      'admin.nome': 'Informe o nome.',
      'admin.email': 'Informe o e-mail.',
      'admin.senha': 'Informe a senha inicial.',
    });
    expect(Object.values(e).join(' ')).not.toMatch(/must|String|Number/);
  });
  it('administrador: RN-CORE-32 pela mensagem do Core; nome curto e e-mail inválido; 422 da API', () => {
    expect(errosDoAdmin({ ...form.admin, senha: 'Norte2026' })['admin.senha']).toBe('Falta um caractere especial.');
    expect(errosDoAdmin({ nome: 'A', email: 'ana@', senha: 'Norte#2026' })).toEqual({ 'admin.nome': TEXTOS_ADMIN.nomeCurto, 'admin.email': TEXTOS_ADMIN.emailInvalido });
    expect(erroDoAdminNaApi(new ErroPortal(422, 'RN-CORE-34', 'x'), '')).toEqual({ bloco: 'Informe o administrador da empresa.' });
    expect(erroDoAdminNaApi(new ErroPortal(422, 'RN-CORE-32', 'x', { faltas: ['numero', 'especial'] }), 'Senhaforte')).toEqual({ senha: 'Faltam um número e um caractere especial.' });
    expect(erroDoAdminNaApi(new ErroPortal(422, 'CNPJ_INATIVO', 'x'), '')).toBeNull();
  });
  it('422 do plano: uma linha por problema, do contrato', () => {
    const e = new ErroPortal(422, 'PLANO_ABAIXO_DO_USO', 'x', { problemas: [{ mensagem: 'O plano Light tem 10 licenças de vendedor e a empresa usa 14.' }] });
    expect(problemasDoPlano(e)).toEqual(['O plano Light tem 10 licenças de vendedor e a empresa usa 14.']);
    expect(problemasDoPlano(new ErroPortal(422, 'RN-CORE-32', 'x'))).toBeNull();
  });
  it('aviso de sucesso uma vez, com o código em maiúsculas', () => {
    guardarEmpresaCriada('t1', 'AM4821');
    expect(retirarEmpresaCriada('t1')).toBe('AM4821');
    expect(retirarEmpresaCriada('t1')).toBeNull();
    expect(TEXTOS_NOVA_EMPRESA.criada('am4821')).toBe('Empresa criada. Código da empresa: AM4821.');
  });
});
