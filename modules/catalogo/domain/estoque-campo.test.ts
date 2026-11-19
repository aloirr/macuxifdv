import { describe, expect, it } from 'vitest';
import { chipDoEstoque, corDoEstoque, filiaisDaFolha, filiaisDoEstoque, linhasDaFolhaEstoque, rotuloCargaEstoque, lerFiliaisDoUsuario, rotuloChipFiliais, textoEstoqueCartao, type FiliaisDoUsuario } from './estoque-campo';

// docs/design/catalogo-campo-v2/spec.md §3 e §4 (estoque na hora, valor de N e quem vê); RN-CAT-05 (estoque do promotor), RN-CORE-39 (filial)
const BV = 'f-boa-vista';
const BEL = 'f-belem';
const MAN = 'f-manaus';
const TODAS = [BV, BEL, MAN];

const usuario = (filiaisVenda: string[], semFilial = false): FiliaisDoUsuario => ({ filiaisVenda, filialCadastro: filiaisVenda[0] ?? null, semFilial });
const sem = { filialDoCliente: null, filtro: null } as const;

describe('Catálogo v2: filiaisDoEstoque, as filiais cuja soma é o N (só filiais de venda)', () => {
  it('RN-CORE-39 / spec §3: sem filtro e sem cliente, o N soma as filiais de venda', () => {
    expect(filiaisDoEstoque(usuario([BV, BEL]), sem)).toEqual([BV, BEL]);
  });
  it('spec §3: "Todas as filiais" (Suas filiais) soma as de venda, nunca o tenant inteiro', () => {
    expect(filiaisDoEstoque(usuario([BV]), { filialDoCliente: null, filtro: 'todas' })).toEqual([BV]);
    expect(filiaisDoEstoque(usuario([BV, BEL]), { filialDoCliente: null, filtro: 'todas' })).toEqual([BV, BEL]);
  });
  it('spec §3: filtro com uma filial mostra só aquela', () => {
    expect(filiaisDoEstoque(usuario(TODAS), { filialDoCliente: null, filtro: MAN })).toEqual([MAN]);
  });
  it('RN-CAT-05: ninguém vê filial que não é de venda dele, nem escolhendo-a', () => {
    expect(filiaisDoEstoque(usuario([BV]), { filialDoCliente: null, filtro: MAN })).toEqual([]);
  });
  it('RN-CORE-39 / spec §3: com cliente vale a filial do cliente (se é de venda); o filtro não vale', () => {
    expect(filiaisDoEstoque(usuario([BV, BEL]), { filialDoCliente: BEL, filtro: MAN })).toEqual([BEL]);
  });
  it('RN-CAT-05: com cliente de filial que não é de venda do usuário, o N não soma nada', () => {
    expect(filiaisDoEstoque(usuario([BV]), { filialDoCliente: BEL, filtro: null })).toEqual([]);
  });
  it('RN-CORE-39: sem_filial (bloqueado) não soma filial nenhuma, mesmo com lista', () => {
    expect(filiaisDoEstoque(usuario([BV], true), sem)).toEqual([]);
    expect(filiaisDoEstoque(usuario([], true), { filialDoCliente: BV, filtro: BV })).toEqual([]);
  });
  it('R-20261115-104500 (item 4) e RN-CORE-39: a folha lista as filiais de venda de todo perfil (não mais "todas" para o vendedor); sem_filial = nenhuma', () => {
    expect(filiaisDaFolha(usuario([BV, BEL]))).toEqual([BV, BEL]);
    expect(filiaisDaFolha(usuario([BV], true))).toEqual([]);
  });
});

describe('RN-CORE-39: lerFiliaisDoUsuario, o único leitor de core.filiais_do_usuario@1 e da linha usuario do sync', () => {
  const A = '0f000000-0000-4000-8000-00000000000a';
  const B = '0f000000-0000-4000-8000-00000000000b';
  const C = '0f000000-0000-4000-8000-00000000000c';
  it('RN-CORE-39: lê as filiais de venda (ordenadas) e a de cadastro; o resto da linha é ignorado', () => {
    expect(lerFiliaisDoUsuario({ id: 'u', filial_cadastro_id: C, filial_venda_ids: [B, A, C], sem_filial: false })).toEqual({ filiaisVenda: [A, B, C], filialCadastro: C, semFilial: false });
  });
  it('RN-CORE-39: sem_filial verdadeiro ou lista vazia = sem filial', () => {
    expect(lerFiliaisDoUsuario({ filial_cadastro_id: null, filial_venda_ids: [], sem_filial: true })?.semFilial).toBe(true);
    expect(lerFiliaisDoUsuario({ filial_cadastro_id: A, filial_venda_ids: [A], sem_filial: true })?.semFilial).toBe(true);
  });
  it('RN-CORE-39: fora do contrato (inclusive o nome antigo filial_ids) = null', () => {
    expect(lerFiliaisDoUsuario(undefined)).toBeNull();
    expect(lerFiliaisDoUsuario({ filial_ids: [A], sem_filial: false })).toBeNull();
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

describe('Catálogo v2: chipDoEstoque, texto e cor do "Estoque: N" (spec §3)', () => {
  it('spec §3: número exato na ficha, "999+" no cartão, cor pelo número', () => {
    expect(chipDoEstoque({ quantity: 1284, band: 'disponivel' }, true)).toEqual({ texto: 'Estoque: 999+', tom: 'sucesso' });
    expect(chipDoEstoque({ quantity: 1284, band: 'disponivel' }, false)).toEqual({ texto: 'Estoque: 1.284', tom: 'sucesso' });
    expect(chipDoEstoque({ quantity: -2, band: 'sem_estoque' }, true)).toEqual({ texto: 'Estoque: −2', tom: 'erro' });
    expect(chipDoEstoque({ quantity: 0, band: 'sem_estoque' }, true)).toEqual({ texto: 'Estoque: 0', tom: 'erro' });
  });
  it('spec §3: tenant que esconde a quantidade decide pela faixa: "Em estoque" verde ou "Sem estoque" vermelho', () => {
    expect(chipDoEstoque({ quantity: null, band: 'baixo' }, true)).toEqual({ texto: 'Em estoque', tom: 'sucesso' });
    expect(chipDoEstoque({ quantity: null, band: 'sem_estoque' }, true)).toEqual({ texto: 'Sem estoque', tom: 'erro' });
  });
});

describe('Catálogo v2: chip da filial e linhas da folha', () => {
  it('spec §4: chip "Suas filiais (N)" sem ✕ para quem tem várias; a única sem ✕ e sem contagem (todo perfil)', () => {
    expect(rotuloChipFiliais({ nomesProprias: ['A', 'B', 'C'], escolhida: null })).toEqual({ texto: 'Suas filiais (3)', removivel: false });
    expect(rotuloChipFiliais({ nomesProprias: ['A', 'B'], escolhida: 'todas' })).toEqual({ texto: 'Suas filiais (2)', removivel: false });
  });
  it('spec §4: uma filial escolhida vira "Filial X" com ✕ (o ✕ volta a "Suas filiais")', () => {
    expect(rotuloChipFiliais({ nomesProprias: ['A', 'B'], escolhida: 'Manaus' })).toEqual({ texto: 'Filial Manaus', removivel: true });
  });
  it('spec §2.1: folha mantém a ordem recebida, marca só a de cadastro, negativo com menos', () => {
    const l = linhasDaFolhaEstoque(
      [
        { branch_id: 'v', branch_name: 'Boa Vista', quantity: 0 },
        { branch_id: 'b', branch_name: 'Belém', quantity: -2 },
        { branch_id: 'm', branch_name: 'Manaus', quantity: 12 },
      ],
      { filialCadastro: 'v', mostrarQuantidade: true },
    );
    expect(l.map((x) => [x.nome, x.valor, x.propria, x.tom])).toEqual([
      ['Boa Vista', '0', true, 'erro'],
      ['Belém', '−2', false, 'erro'],
      ['Manaus', '12', false, 'sucesso'],
    ]);
  });
  it('spec §2.1: sem filial de cadastro nenhuma linha leva "sua filial"; tenant que esconde a quantidade mostra Em estoque/Sem estoque', () => {
    const l = linhasDaFolhaEstoque([{ branch_id: 'v', branch_name: 'Boa Vista', quantity: null, band: 'disponivel' }], { filialCadastro: null, mostrarQuantidade: false });
    expect(l).toEqual([{ id: 'v', nome: 'Boa Vista', valor: 'Em estoque', propria: false, tom: 'sucesso' }]);
  });
});

// decisão 5 do R-20261115-100000: "Atualizado" é a hora da carga do estoque no aparelho, no fuso do tenant
describe('rotuloCargaEstoque (decisão 5 do R-20261115-100000)', () => {
  const MANAUS = 'America/Manaus';
  const agora = '2026-11-15T20:00:00Z'; // 16:00 em Manaus
  it('decisão 5: hoje só a hora; ontem diz "ontem"; mais antigo, data curta; sempre no fuso do tenant', () => {
    expect(rotuloCargaEstoque('2026-11-15T10:12:00Z', agora, MANAUS)).toBe('Atualizado às 06:12');
    expect(rotuloCargaEstoque('2026-11-14T10:12:00Z', agora, MANAUS)).toBe('Atualizado ontem às 06:12');
    expect(rotuloCargaEstoque('2026-11-12T10:12:00Z', agora, MANAUS)).toBe('Atualizado em 12/11 às 06:12');
  });
  it('decisão 5: o dia é o do tenant (03:00 UTC ainda é a noite anterior em Manaus) e sem carimbo diz "Sem hora de atualização"', () => {
    expect(rotuloCargaEstoque('2026-11-15T03:00:00Z', agora, MANAUS)).toBe('Atualizado ontem às 23:00');
    expect(rotuloCargaEstoque(null, agora, MANAUS)).toBe('Sem hora de atualização');
    expect(rotuloCargaEstoque('lixo', agora, MANAUS)).toBe('Sem hora de atualização');
  });
});
