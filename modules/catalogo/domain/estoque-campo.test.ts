import { describe, expect, it } from 'vitest';
import type { Perfil } from '@macuxi/platform-sdk';
import { corDoEstoque, filiaisDaFolha, filiaisDoEstoque, linhasDaFolhaEstoque, rotuloChipFiliais, textoEstoqueCartao, type UsuarioFiliais } from './estoque-campo';

// docs/design/catalogo-campo-v2/spec.md §3 e §4 (estoque na hora, valor de N e quem vê); RN-CAT-05 (estoque do promotor), RN-CORE-39 (filial)
const BV = 'f-boa-vista';
const BEL = 'f-belem';
const MAN = 'f-manaus';
const TODAS = [BV, BEL, MAN];

const usuario = (perfil: Perfil, filiaisVenda: string[], semFilial = false): UsuarioFiliais => ({ perfil, filiaisVenda, semFilial });
const sem = { filialDoCliente: null, filtro: null } as const;

describe('Catálogo v2: filiaisDoEstoque, as filiais cuja soma é o N (só filiais de venda)', () => {
  it('RN-CORE-39 / spec §3: sem filtro e sem cliente, o N soma as filiais de venda, de qualquer perfil', () => {
    for (const perfil of ['vendedor', 'promotor', 'supervisor', 'gerente', 'admin', 'analista'] as const) {
      expect(filiaisDoEstoque(usuario(perfil, [BV, BEL]), sem)).toEqual([BV, BEL]);
    }
  });
  it('spec §3: "Todas as filiais" (Suas filiais) soma as de venda, nunca o tenant inteiro', () => {
    expect(filiaisDoEstoque(usuario('vendedor', [BV]), { filialDoCliente: null, filtro: 'todas' })).toEqual([BV]);
    expect(filiaisDoEstoque(usuario('gerente', [BV, BEL]), { filialDoCliente: null, filtro: 'todas' })).toEqual([BV, BEL]);
  });
  it('spec §3: filtro com uma filial mostra só aquela', () => {
    expect(filiaisDoEstoque(usuario('supervisor', TODAS), { filialDoCliente: null, filtro: MAN })).toEqual([MAN]);
  });
  it('RN-CAT-05: ninguém vê filial que não é de venda dele, nem escolhendo-a', () => {
    expect(filiaisDoEstoque(usuario('vendedor', [BV]), { filialDoCliente: null, filtro: MAN })).toEqual([]);
    expect(filiaisDoEstoque(usuario('promotor', [BV]), { filialDoCliente: null, filtro: MAN })).toEqual([]);
  });
  it('RN-CORE-39 / spec §3: com cliente vale a filial do cliente (se é de venda); o filtro não vale', () => {
    expect(filiaisDoEstoque(usuario('vendedor', [BV, BEL]), { filialDoCliente: BEL, filtro: MAN })).toEqual([BEL]);
  });
  it('RN-CAT-05: com cliente de filial que não é de venda do usuário, o N não soma nada', () => {
    expect(filiaisDoEstoque(usuario('supervisor', [BV]), { filialDoCliente: BEL, filtro: null })).toEqual([]);
  });
  it('RN-CORE-39: sem_filial (bloqueado) não soma filial nenhuma, mesmo com lista', () => {
    expect(filiaisDoEstoque(usuario('vendedor', [BV], true), sem)).toEqual([]);
    expect(filiaisDoEstoque(usuario('admin', [], true), { filialDoCliente: BV, filtro: BV })).toEqual([]);
  });
  it('RN-CORE-39: a folha lista as filiais de venda de todo perfil (não mais "todas" para o vendedor); sem_filial = nenhuma', () => {
    expect(filiaisDaFolha(usuario('vendedor', [BV, BEL]))).toEqual([BV, BEL]);
    expect(filiaisDaFolha(usuario('promotor', [BV]))).toEqual([BV]);
    expect(filiaisDaFolha(usuario('vendedor', [BV], true))).toEqual([]);
  });
  it('RN-CAT-05 (alternativa em simulação): o N e a folha saem de funções separadas, então "cadastro no cartão e soma só na folha" troca só filiaisDoEstoque', () => {
    const u = usuario('vendedor', [BV, BEL, MAN]);
    // hoje o cartão soma as de venda; a folha lista as de venda. Mudar o que o cartão soma não mexe na folha:
    expect(filiaisDoEstoque(u, sem)).toEqual(filiaisDaFolha(u));
    const alternativa = (x: UsuarioFiliais): readonly string[] => x.filiaisVenda.slice(0, 1); // ex.: só uma filial no cartão
    expect(alternativa(u)).toEqual([BV]);
    expect(filiaisDaFolha(u)).toEqual(TODAS);
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
  it('spec §4: chip "Suas filiais (N)" sem ✕ para quem tem várias; a única sem ✕ e sem contagem (todo perfil)', () => {
    expect(rotuloChipFiliais({ nomesProprias: ['A', 'B', 'C'], escolhida: null })).toEqual({ texto: 'Suas filiais (3)', removivel: false });
    expect(rotuloChipFiliais({ nomesProprias: ['Boa Vista'], escolhida: null })).toEqual({ texto: 'Filial Boa Vista', removivel: false });
    expect(rotuloChipFiliais({ nomesProprias: ['A', 'B'], escolhida: 'todas' })).toEqual({ texto: 'Suas filiais (2)', removivel: false });
  });
  it('spec §4: uma filial escolhida vira "Filial X" com ✕ (o ✕ volta a "Suas filiais")', () => {
    expect(rotuloChipFiliais({ nomesProprias: ['A', 'B'], escolhida: 'Manaus' })).toEqual({ texto: 'Filial Manaus', removivel: true });
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
