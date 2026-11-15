import { describe, expect, it } from 'vitest';
import { corDoEstoque, filiaisDaFolha, filiaisDoCartao, linhasDaFolhaEstoque, rotuloChipFiliais, textoEstoqueCartao, veSoSuasFiliais } from './estoque-campo';

// docs/design/catalogo-campo-v2/spec.md §3 e §4 (estoque na hora, valor de N e quem vê); RN-CAT-05 (estoque do promotor), RN-CORE-39 (filial)
const BV = 'f-boa-vista';
const BEL = 'f-belem';
const MAN = 'f-manaus';
const TODAS = [BV, BEL, MAN];

describe('Catálogo v2: valor de N por perfil e filtro', () => {
  it('spec §3: vendedor sem filtro vê a filial dele', () => {
    expect(filiaisDoCartao({ perfil: 'vendedor', proprias: [BV], filialDoCliente: null, filtro: null, escopoCarteira: [BV, BEL] })).toEqual([BV]);
  });
  it('spec §3: vendedor com "Todas as filiais" soma todas (null)', () => {
    expect(filiaisDoCartao({ perfil: 'vendedor', proprias: [BV], filialDoCliente: null, filtro: 'todas', escopoCarteira: null })).toBeNull();
  });
  it('spec §3: promotor, supervisor e gerente somam as filiais deles', () => {
    for (const perfil of ['promotor', 'supervisor', 'gerente'] as const) {
      expect(filiaisDoCartao({ perfil, proprias: [BV, BEL, MAN], filialDoCliente: null, filtro: null, escopoCarteira: null })).toEqual([BV, BEL, MAN]);
    }
  });
  it('spec §3: filtro com uma filial mostra só aquela', () => {
    expect(filiaisDoCartao({ perfil: 'supervisor', proprias: TODAS, filialDoCliente: null, filtro: MAN, escopoCarteira: null })).toEqual([MAN]);
    expect(filiaisDoCartao({ perfil: 'vendedor', proprias: [BV], filialDoCliente: null, filtro: BEL, escopoCarteira: null })).toEqual([BEL]);
  });
  it('RN-CAT-05 / spec §4: promotor, supervisor e gerente não veem filial que não é deles, nem escolhendo-a', () => {
    expect(filiaisDoCartao({ perfil: 'promotor', proprias: [BV], filialDoCliente: null, filtro: MAN, escopoCarteira: null })).toEqual([]);
    expect(filiaisDoCartao({ perfil: 'gerente', proprias: [BV], filialDoCliente: null, filtro: 'todas', escopoCarteira: null })).toEqual([BV]);
  });
  it('RN-CORE-39 / spec §3: com cliente vale a filial do cliente; o filtro não vale', () => {
    expect(filiaisDoCartao({ perfil: 'vendedor', proprias: [BV], filialDoCliente: BEL, filtro: MAN, escopoCarteira: null })).toEqual([BEL]);
  });
  it('RN-CAT-05: com cliente, quem só vê as suas filiais não vê a filial do cliente se ela não for dele', () => {
    expect(filiaisDoCartao({ perfil: 'supervisor', proprias: [BV], filialDoCliente: BEL, filtro: null, escopoCarteira: null })).toEqual([]);
    expect(filiaisDoCartao({ perfil: 'supervisor', proprias: [BV, BEL], filialDoCliente: BEL, filtro: null, escopoCarteira: null })).toEqual([BEL]);
  });
  it('RN-CORE-04: perfil administrativo mantém o escopo do tenant (todas) ou a carteira', () => {
    expect(filiaisDoCartao({ perfil: 'admin', proprias: [], filialDoCliente: null, filtro: null, escopoCarteira: null })).toBeNull();
    expect(filiaisDoCartao({ perfil: 'analista', proprias: [], filialDoCliente: null, filtro: null, escopoCarteira: [BV] })).toEqual([BV]);
  });
  it('spec §4: só promotor, supervisor e gerente ficam restritos às suas filiais', () => {
    expect(['vendedor', 'promotor', 'supervisor', 'gerente', 'admin'].map((p) => veSoSuasFiliais(p as never))).toEqual([false, true, true, true, false]);
  });
  it('spec §4: a folha do vendedor lista todas as filiais; as dos outros, só as próprias', () => {
    expect(filiaisDaFolha({ perfil: 'vendedor', proprias: [BV] })).toBeNull();
    expect(filiaisDaFolha({ perfil: 'promotor', proprias: [BV, BEL] })).toEqual([BV, BEL]);
  });
});

describe('Catálogo v2: texto e cor do estoque', () => {
  it('spec §3: "Estoque: N", sem saldo = 0', () => {
    expect(textoEstoqueCartao(28, true)).toBe('Estoque: 28');
    expect(textoEstoqueCartao(null, true)).toBe('Estoque: 0');
    expect(textoEstoqueCartao(0, true)).toBe('Estoque: 0');
  });
  it('spec §3: no cartão, acima de 999 vira "999+"; a folha e a ficha trazem o exato', () => {
    expect(textoEstoqueCartao(999, true)).toBe('Estoque: 999');
    expect(textoEstoqueCartao(1000, true)).toBe('Estoque: 999+');
    expect(textoEstoqueCartao(1284, false)).toBe('Estoque: 1.284');
  });
  it('spec §3: negativo aparece com o sinal de menos; abaixo de -999 não cabe no cartão', () => {
    expect(textoEstoqueCartao(-2, true)).toBe('Estoque: −2');
    expect(textoEstoqueCartao(-1500, true)).toBe('Estoque: −999+');
  });
  it('spec §3: tenant que esconde a quantidade mostra "Em estoque" ou "Sem estoque"', () => {
    expect(textoEstoqueCartao(12, true, false)).toBe('Em estoque');
    expect(textoEstoqueCartao(0, true, false)).toBe('Sem estoque');
  });
  it('catalogo-grade §4: verde acima de 0; vermelho em 0, negativo ou sem saldo; nunca laranja', () => {
    expect([corDoEstoque(84), corDoEstoque(1), corDoEstoque(0), corDoEstoque(-2), corDoEstoque(null)]).toEqual(['sucesso', 'sucesso', 'erro', 'erro', 'erro']);
  });
});

describe('Catálogo v2: chip da filial e linhas da folha', () => {
  it('spec §4: chip "Suas filiais (N)" sem ✕ para quem tem várias; a única sem ✕ e sem contagem', () => {
    expect(rotuloChipFiliais({ perfil: 'supervisor', nomesProprias: ['A', 'B', 'C'], escolhida: null })).toEqual({ texto: 'Suas filiais (3)', removivel: false });
    expect(rotuloChipFiliais({ perfil: 'promotor', nomesProprias: ['Boa Vista'], escolhida: null })).toEqual({ texto: 'Filial Boa Vista', removivel: false });
  });
  it('spec §4: uma filial escolhida vira "Filial X" com ✕ (o ✕ volta ao padrão do perfil)', () => {
    expect(rotuloChipFiliais({ perfil: 'gerente', nomesProprias: ['A', 'B'], escolhida: 'Manaus' })).toEqual({ texto: 'Filial Manaus', removivel: true });
    expect(rotuloChipFiliais({ perfil: 'vendedor', nomesProprias: ['Boa Vista'], escolhida: null })).toEqual({ texto: 'Filial Boa Vista', removivel: true });
    expect(rotuloChipFiliais({ perfil: 'vendedor', nomesProprias: ['Boa Vista'], escolhida: 'todas' })).toBeNull();
  });
  it('spec §2.1: folha com as filiais do usuário primeiro, cada grupo em ordem alfabética, negativo com menos', () => {
    const l = linhasDaFolhaEstoque(
      [
        { branch_id: 'm', branch_name: 'Manaus', quantity: 12 },
        { branch_id: 'b', branch_name: 'Belém', quantity: -2 },
        { branch_id: 'v', branch_name: 'Boa Vista', quantity: 0 },
      ],
      { proprias: ['v'], mostrarQuantidade: true, marcarPropria: true },
    );
    expect(l.map((x) => [x.nome, x.valor, x.propria, x.tom])).toEqual([
      ['Boa Vista', '0', true, 'erro'],
      ['Belém', '−2', false, 'erro'],
      ['Manaus', '12', false, 'sucesso'],
    ]);
  });
  it('spec §2.1: sem marcar a própria (quem só vê as suas), nenhuma linha leva "sua filial"; tenant que esconde a quantidade mostra Em estoque/Sem estoque', () => {
    const l = linhasDaFolhaEstoque([{ branch_id: 'v', branch_name: 'Boa Vista', quantity: null, band: 'disponivel' }], { proprias: ['v'], mostrarQuantidade: false, marcarPropria: false });
    expect(l).toEqual([{ id: 'v', nome: 'Boa Vista', valor: 'Em estoque', propria: false, tom: 'sucesso' }]);
  });
});
