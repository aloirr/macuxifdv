import { describe, expect, it } from 'vitest';
import { alternarVenda, avisoSemFilial, corpoDaFilial, descricaoParaLeitor, erroDaFilialCadastro, escolherCadastro, filiaisDoUsuario, filiaisEmOrdem, filtrarPorFilial, mostraColunaFilial, nomeDaFilialDe, vendaTravada } from './filial-usuario';

const BV = 'b0000000-0000-4000-8000-000000000001';
const MN = 'b0000000-0000-4000-8000-000000000002';
const vazio = { filial_cadastro_id: '', filial_venda_ids: [] as string[] };

describe('RN-CORE-39: filial de cadastro e filiais de venda na gaveta', () => {
  it('RN-CORE-39: escolher a filial de cadastro marca e trava a nova', () => {
    const f = escolherCadastro(vazio, BV);
    expect(f.filial_venda_ids).toEqual([BV]);
    expect(vendaTravada(f, BV)).toBe(true);
    expect(vendaTravada(f, MN)).toBe(false);
  });
  it('RN-CORE-39: trocar a filial de cadastro mantém a antiga marcada (destravada)', () => {
    const f = escolherCadastro(escolherCadastro(vazio, BV), MN);
    expect(f.filial_venda_ids).toEqual([BV, MN]);
    expect(vendaTravada(f, BV)).toBe(false);
    expect(alternarVenda(f, BV).filial_venda_ids).toEqual([MN]);
  });
  it('RN-CORE-39: a filial de cadastro não se desmarca; as outras alternam', () => {
    const f = escolherCadastro(vazio, BV);
    expect(alternarVenda(f, BV)).toBe(f);
    expect(alternarVenda(f, MN).filial_venda_ids).toEqual([BV, MN]);
    expect(alternarVenda(alternarVenda(f, MN), MN).filial_venda_ids).toEqual([BV]);
  });
  it('RN-CORE-39: a lista de filiais fica em ordem alfabética, sem distinguir acento', () => {
    const nomes = filiaisEmOrdem([{ id: '1', nome: 'Santarém' }, { id: '2', nome: 'Belém' }, { id: '3', nome: 'Boa Vista' }, { id: '4', nome: 'Macapá' }]).map((x) => x.nome);
    expect(nomes).toEqual(['Belém', 'Boa Vista', 'Macapá', 'Santarém']);
  });
  it('RN-CORE-39: nomes iguais (inclusive só na caixa ou no acento) desempatam pelo id, sem depender da ordem de chegada', () => {
    const ids = (l: { id: string; nome: string }[]) => filiaisEmOrdem(l).map((x) => x.id);
    const l = [{ id: 'b', nome: 'Manaus' }, { id: 'a', nome: 'manaus' }, { id: 'c', nome: 'Belém' }];
    expect(ids(l)).toEqual(['c', 'a', 'b']);
    expect(ids([...l].reverse())).toEqual(['c', 'a', 'b']);
  });
  it('RN-CORE-39: o leitor de tela ouve "Boa Vista, filial de cadastro, marcada, indisponível"', () => {
    const f = escolherCadastro(vazio, BV);
    expect(descricaoParaLeitor('Boa Vista', f, BV)).toBe('Boa Vista, filial de cadastro, marcada, indisponível');
    expect(descricaoParaLeitor('Manaus', f, MN)).toBe('Manaus, desmarcada');
  });
  it('RN-CORE-39: sem filial de cadastro o Salvar mostra o erro; sem a ação, o campo não se aplica', () => {
    expect(erroDaFilialCadastro(vazio, true)).toBe('Escolha a filial de cadastro.');
    expect(erroDaFilialCadastro({ filial_cadastro_id: BV }, true)).toBeUndefined();
    expect(erroDaFilialCadastro(vazio, false)).toBeUndefined();
  });
  it('RN-CORE-39: só quem tem usuario.filial_editar envia os campos da filial', () => {
    const f = escolherCadastro(vazio, BV);
    expect(corpoDaFilial(f, true)).toEqual({ filial_cadastro_id: BV, filial_venda_ids: [BV] });
    expect(corpoDaFilial(f, false)).toEqual({});
    expect(corpoDaFilial(vazio, true)).toEqual({});
  });
  it('RN-CORE-39: o usuário sem filial abre a gaveta com os dois campos vazios', () => {
    expect(filiaisDoUsuario({ filial_cadastro_id: null, filial_venda_ids: [] })).toEqual(vazio);
    expect(filiaisDoUsuario({ filial_cadastro_id: BV, filial_venda_ids: [MN] }).filial_venda_ids).toEqual([MN, BV]);
  });
});

describe('RN-CORE-39: lista de usuários, filtro e aviso', () => {
  const itens = [
    { id: 'a', filial_cadastro_id: BV, sem_filial: false },
    { id: 'b', filial_cadastro_id: null, sem_filial: true },
    { id: 'c', filial_cadastro_id: MN, sem_filial: false },
    { id: 'd', filial_cadastro_id: null, sem_filial: true },
  ];
  it('RN-CORE-39: o filtro tem Todas, Sem filial e cada filial', () => {
    expect(filtrarPorFilial(itens, '')).toHaveLength(4);
    expect(filtrarPorFilial(itens, 'sem').map((x) => x.id)).toEqual(['b', 'd']);
    expect(filtrarPorFilial(itens, BV).map((x) => x.id)).toEqual(['a']);
  });
  it('RN-CORE-39: com o filtro Sem filial a coluna Filial sai', () => {
    expect(mostraColunaFilial('sem')).toBe(false);
    expect(mostraColunaFilial('')).toBe(true);
    expect(mostraColunaFilial(BV)).toBe(true);
  });
  it('RN-CORE-39: a coluna mostra o nome da filial, ou nada (o selo Sem filial) quando não há', () => {
    const filiais = [{ id: BV, nome: 'Boa Vista' }];
    expect(nomeDaFilialDe(itens[0]!, filiais)).toBe('Boa Vista');
    expect(nomeDaFilialDe(itens[1]!, filiais)).toBeNull();
  });
  it('RN-CORE-39: o aviso traz o total e o botão, e some com o filtro Sem filial ou sem ocorrência', () => {
    expect(avisoSemFilial(2, '')).toEqual({ texto: '2 usuários sem filial de cadastro não entram no app.', botao: 'Ver os 2' });
    expect(avisoSemFilial(1, BV)?.texto).toBe('1 usuário sem filial de cadastro não entra no app.');
    expect(avisoSemFilial(2, 'sem')).toBeNull();
    expect(avisoSemFilial(0, '')).toBeNull();
  });
});
