/**
 * Spec docs/design/telas/portal-config-enxuto.md §11.3 e §11.4 (ADR 0047): partes puras dos planos no portal `config.`, contra o
 * catálogo de exemplo da tabela da spec (§11.3/§11.9). Números só do catálogo; contas do SDK (RN-PLA-05, RN-PLA-06).
 */
import { describe, expect, it } from 'vitest';
import { TrocarPlanoSchema } from '@macuxi/platform-sdk';

import { fichaExemplo, planoExemplo, PLANOS_EXEMPLO } from './portal-planos.fixture';
import {
  adicionaisDaEscolha,
  blocosDaFicha,
  comAdicional,
  corpoDaTroca,
  emTeste,
  errosDaEscolha,
  ESCOLHA_VAZIA,
  escolhaDaFicha,
  licencasDoPlano,
  licencasDoPlanoEmDuasLinhas,
  mensagensDosProblemas,
  mudouDaFicha,
  planosVisiveis,
  precoDoAdicional,
  precoDoPlano,
  problemasDaTroca,
  quantidadeValida,
  rotuloDoItem,
  TEXTOS_PLANO,
  totalDaEscolha,
  valorPorCiclo,
} from './portal-planos';

const TENANT = '0b6f1a52-5c1e-4c4e-9a43-000000000001';

describe('cartões do plano (§11.3)', () => {
  it('RN-PLA-06: preço no ciclo, do catálogo (anual = 10 × mensal com 2 meses grátis)', () => {
    expect(PLANOS_EXEMPLO.map((p) => precoDoPlano(p, 'mensal'))).toEqual(['R$ 610,00/mês', 'R$ 1.197,00/mês', 'R$ 1.719,00/mês', 'R$ 2.592,50/mês']);
    expect(PLANOS_EXEMPLO.map((p) => precoDoPlano(p, 'anual'))).toEqual(['R$ 6.100,00/ano', 'R$ 11.970,00/ano', 'R$ 17.190,00/ano', 'R$ 25.925,00/ano']);
  });
  it('licenças: singular com 1, "BKO" invariável, tipo com 0 fora, `null` = sem limite', () => {
    expect(licencasDoPlano(planoExemplo('light'))).toBe('10 vendedores · 1 gestor · 1 BKO');
    expect(licencasDoPlano(planoExemplo('corporate'))).toBe('50 vendedores · 5 gestores · 5 BKO');
    expect(licencasDoPlanoEmDuasLinhas(planoExemplo('enterprise'))).toEqual(['30 vendedores', '3 gestores · 5 BKO']);
    const semLimite = { ...planoExemplo('pme'), licencas: { vendedor: null, gestor: 2, bko: 3, promotor: 0 } };
    expect(licencasDoPlano(semLimite)).toBe('vendedores sem limite · 2 gestores · 3 BKO');
  });
  it('só os ativos, na ordem do catálogo; o atual fica mesmo fora de venda', () => {
    const inativo = { ...planoExemplo('light'), ativo: false };
    const lista = [planoExemplo('corporate'), inativo, planoExemplo('pme')];
    expect(planosVisiveis(lista).map((p) => p.codigo)).toEqual(['pme', 'corporate']);
    expect(planosVisiveis(lista, 'light').map((p) => p.codigo)).toEqual(['light', 'pme', 'corporate']);
  });
  it('P5: preço do adicional segue o ciclo', () => {
    const pme = planoExemplo('pme');
    expect(precoDoAdicional(pme, 'promotor', 'mensal')).toBe('R$ 80,00 por licença avulsa/mês');
    expect(precoDoAdicional(pme, 'pesquisa', 'mensal')).toBe('R$ 10,00 por usuário/mês');
    expect(precoDoAdicional(pme, 'treinamento', 'anual')).toBe('R$ 100,00 por usuário/ano');
    expect(precoDoAdicional(pme, 'promotor', 'anual')).toBe('R$ 800,00 por licença avulsa/ano');
  });
});

describe('escolha do Criar empresa (§11.3)', () => {
  it('sem plano: "Escolha o plano." e o Total some', () => {
    expect(errosDaEscolha(ESCOLHA_VAZIA)).toEqual({ plano: 'Escolha o plano.' });
    expect(totalDaEscolha(PLANOS_EXEMPLO, ESCOLHA_VAZIA)).toBeNull();
  });
  it('quantidade: inteiro de 1 a 100.000; vazio ou 0 = "Informe a quantidade."', () => {
    expect(quantidadeValida('3')).toBe(3);
    expect(quantidadeValida(' 100000 ')).toBe(100_000);
    for (const q of ['', '0', '100001', '2,5', 'a']) expect(quantidadeValida(q)).toBeNull();
    const e = comAdicional({ ...ESCOLHA_VAZIA, plano: 'pme' }, 'promotor', '');
    expect(errosDaEscolha(e)).toEqual({ 'adicional-promotor': TEXTOS_PLANO.informeQuantidade });
    expect(adicionaisDaEscolha(e)).toEqual([]);
  });
  it('total da simulação: PME + 3 Promotor + 10 Pesquisa = R$ 1.537,00/mês ou R$ 15.370,00/ano', () => {
    let e = comAdicional({ ...ESCOLHA_VAZIA, plano: 'pme' }, 'promotor', '3');
    e = comAdicional(e, 'pesquisa', '10');
    expect(totalDaEscolha(PLANOS_EXEMPLO, e)).toBe('Total: R$ 1.537,00/mês');
    expect(totalDaEscolha(PLANOS_EXEMPLO, { ...e, ciclo: 'anual' })).toBe('Total: R$ 15.370,00/ano');
    expect(comAdicional(e, 'pesquisa', undefined).adicionais).toEqual({ promotor: '3' });
  });
});

describe('aba Empresa: cartão "Plano {nome}" (§11.4)', () => {
  const ficha = fichaExemplo({ tenant_id: TENANT });
  it('blocos: Vendedor, Gestor e BKO sempre; adicionais só contratados; "no limite" quando em uso = contratadas', () => {
    const b = blocosDaFicha(ficha);
    expect(b.map((x) => x.item)).toEqual(['vendedor', 'gestor', 'bko', 'promotor', 'pesquisa']);
    expect(b.map((x) => `${x.rotulo} ${x.emUso} ${x.complemento}${x.noLimite ? ' no limite' : ''}`)).toEqual([
      'Vendedor 14 de 20',
      'Gestor 2 de 2 no limite',
      'BKO 1 de 3',
      'Promotor 3 de 3 no limite',
      'Pesquisa 6 de 10',
    ]);
    expect(b.filter((x) => x.adicional).map((x) => x.item)).toEqual(['promotor', 'pesquisa']);
  });
  it('contratadas `null` = "· sem limite"; rótulos pelo mapa único', () => {
    const f = { licencas: [{ item: 'vendedor' as const, contratadas: null, em_uso: 7 }] };
    expect(blocosDaFicha(f)[0]).toMatchObject({ complemento: '· sem limite', noLimite: false });
    expect(['vendedor', 'gestor', 'bko', 'treinamento'].map((i) => rotuloDoItem(i as 'vendedor'))).toEqual(['Vendedor', 'Gestor', 'BKO', 'Treinamento']);
  });
  it('valor e teste: "/mês" já diz o ciclo; teste só sem pagamento', () => {
    expect(valorPorCiclo(ficha.valor.por_ciclo_centavos, ficha.valor.ciclo)).toBe('R$ 1.537,00/mês');
    expect(emTeste(ficha)).toBe(true);
    expect(emTeste({ teste_ate: '2026-11-27', paga: true })).toBe(false);
    expect(emTeste({ teste_ate: null, paga: false })).toBe(false);
  });
});

describe('diálogo "Trocar de plano" (§11.4; RN-PLA-05)', () => {
  const ficha = fichaExemplo({ tenant_id: TENANT });
  it('abre com o plano, o ciclo e os adicionais de hoje; sem mudança, nada a trocar', () => {
    const e = escolhaDaFicha(ficha);
    expect(e).toEqual({ plano: 'pme', ciclo: 'mensal', adicionais: { promotor: '3', pesquisa: '10' }, teste: false });
    expect(mudouDaFicha(ficha, e)).toBe(false);
    expect(mudouDaFicha(ficha, { ...e, ciclo: 'anual' })).toBe(true);
    expect(mudouDaFicha(ficha, comAdicional(e, 'pesquisa', '11'))).toBe(true);
  });
  it('Enterprise no anual: Total R$ 20.590,00/ano e corpo no TrocarPlanoSchema', () => {
    const e = { ...escolhaDaFicha(ficha), plano: 'enterprise', ciclo: 'anual' as const };
    expect(totalDaEscolha(PLANOS_EXEMPLO, e)).toBe('Total: R$ 20.590,00/ano');
    expect(problemasDaTroca(PLANOS_EXEMPLO, ficha, e)).toEqual([]);
    const corpo = corpoDaTroca(e, '9a0c1e52-5c1e-4c4e-9a43-0000000000aa');
    expect(TrocarPlanoSchema.parse(corpo)).toEqual({
      plano: 'enterprise',
      ciclo: 'anual',
      adicionais: [
        { adicional: 'promotor', quantidade: 3 },
        { adicional: 'pesquisa', quantidade: 10 },
      ],
      pedido_id: '9a0c1e52-5c1e-4c4e-9a43-0000000000aa',
    });
    expect(corpoDaTroca(ESCOLHA_VAZIA, 'x')).toBeNull();
  });
  it('plano abaixo do uso: o texto do contrato, uma linha por item', () => {
    const e = { ...escolhaDaFicha(ficha), plano: 'light' };
    expect(problemasDaTroca(PLANOS_EXEMPLO, ficha, e)).toEqual(['Vendedores: 14 em uso. Inative 4 antes de trocar.', 'Gestores: 2 em uso. Inative 1 antes de trocar.']);
  });
  it('plano atual fora de venda: a frase do contrato', () => {
    const inativo = { ...planoExemplo('pme'), ativo: false };
    expect(problemasDaTroca([inativo], ficha, escolhaDaFicha(ficha))).toEqual(['O plano PME não está mais à venda.']);
  });
  it('422: as mensagens de `detalhes.problemas`; sem lista, a mensagem do erro', () => {
    expect(mensagensDosProblemas({ problemas: [{ mensagem: 'Vendedores: 14 em uso. Inative 4 antes de trocar.' }, { codigo: 'x' }] }, 'p')).toEqual(['Vendedores: 14 em uso. Inative 4 antes de trocar.']);
    expect(mensagensDosProblemas(undefined, 'Plano inválido.')).toEqual(['Plano inválido.']);
  });
});
