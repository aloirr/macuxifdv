import { describe, expect, it } from 'vitest';
import { EDICAO_CADASTRO } from '../../contracts';
import { ACAO_MARCAS, avisoMarcas, cadastroCsv, corpoDoForm, errosDoForm, formDaLinha, formVazio, lerAbaCadastro, lerPercentual, paraBuscaAba, problemasDoForm, rotuloAlvo, textosDoCadastro } from './cadastros';

const ID = '00000000-0000-4000-8000-000000000001';
const CAT = '00000000-0000-4000-8000-0000000000e1';
let n = 0;
const novoId = () => `00000000-0000-4000-8000-${(++n).toString(16).padStart(12, '0')}`;
const vazio = () => formVazio('2026-11-03', novoId);

describe('aba e filtros na URL', () => {
  it('ida e volta; aba desconhecida cai em checklists', () => {
    expect(lerAbaCadastro('?aba=metas')).toBe('metas');
    expect(lerAbaCadastro('?aba=xx')).toBe('checklists');
    expect(paraBuscaAba('mix', true)).toBe('?aba=mix&desativados=1');
    expect(paraBuscaAba('checklists', false)).toBe('');
  });
});

describe('formulário → corpo da API', () => {
  it('RN-PRO-03: meta digitada com vírgula vira número; fora de 0–100 é barrada antes de enviar', () => {
    expect(lerPercentual('40,5')).toBe(40.5);
    expect(Number.isNaN(lerPercentual(''))).toBe(true);
    const f = { ...vazio(), categoria_gondola_id: CAT, meta_pct: '40,5' };
    expect(problemasDoForm('meta_share', f, ID)).toEqual([]);
    expect(corpoDoForm('meta_share', f, ID)).toMatchObject({ meta_pct: 40.5, cliente_id: null, segmento: null });
    expect(problemasDoForm('meta_share', { ...f, meta_pct: '100,5' }, ID)[0]).toMatch(/entre 0 e 100/);
    expect(problemasDoForm('meta_share', { ...f, meta_pct: '' }, ID).length).toBeGreaterThan(0);
  });

  it('RN-PRO-06: checklist exige nome e ao menos uma etapa; a ordem segue a lista', () => {
    const f = { ...vazio(), nome: 'Rotina', etapas: [{ id: novoId(), rotulo: 'Medir share', tipo: 'share', obrigatoria: true }, { id: novoId(), rotulo: 'Foto', tipo: 'foto', obrigatoria: false }] };
    expect(problemasDoForm('checklist_loja', f, ID)).toEqual([]);
    const corpo = corpoDoForm('checklist_loja', f, ID) as { itens: { ordem: number; obrigatoria: boolean }[] };
    expect(corpo.itens.map((i) => [i.ordem, i.obrigatoria])).toEqual([[1, true], [2, false]]);
    expect(problemasDoForm('checklist_loja', { ...f, etapas: [] }, ID)[0]).toMatch(/ao menos uma etapa/);
    expect(problemasDoForm('checklist_loja', { ...f, nome: ' ' }, ID).length).toBeGreaterThan(0);
  });

  it('RN-PRO-10: o alvo vira loja, segmento ou todas; a vigência invertida é barrada', () => {
    const base = { ...vazio(), produto_id: ID };
    expect(corpoDoForm('mix_obrigatorio', { ...base, alvo_tipo: 'segmento', alvo_valor: ' Atacado ' }, ID)).toMatchObject({ cliente_id: null, segmento: 'Atacado' });
    expect(corpoDoForm('mix_obrigatorio', { ...base, alvo_tipo: 'loja', alvo_valor: CAT }, ID)).toMatchObject({ cliente_id: CAT, segmento: null });
    expect(problemasDoForm('mix_obrigatorio', { ...base, vigencia_fim: '2026-10-01' }, ID)[0]).toMatch(/anterior/);
    expect(problemasDoForm('mix_obrigatorio', { ...base, alvo_tipo: 'loja', alvo_valor: 'abc' }, ID)[0]).toMatch(/loja/);
  });

  it('todo corpo montado pelo formulário válido passa no contrato da API', () => {
    expect(EDICAO_CADASTRO.categoria_gondola.safeParse(corpoDoForm('categoria_gondola', { ...vazio(), nome: 'Massas' }, ID)).success).toBe(true);
    expect(EDICAO_CADASTRO.produto_concorrente.safeParse(corpoDoForm('produto_concorrente', { ...vazio(), nome: 'Macarrão', concorrente_id: CAT }, ID)).success).toBe(true);
  });

  it('editar: a linha do servidor volta ao formulário e gera o mesmo corpo', () => {
    const linha = { id: ID, categoria_gondola_id: CAT, meta_pct: 42.5, cliente_id: null, segmento: 'Atacado', vigencia_inicio: '2026-11-01', vigencia_fim: null, updated_at: 'x', deleted_at: null, external_id: null };
    const f = formDaLinha(linha);
    expect(f).toMatchObject({ meta_pct: '42,5', alvo_tipo: 'segmento', alvo_valor: 'Atacado' });
    expect(corpoDoForm('meta_share', f, ID)).toEqual({ id: ID, categoria_gondola_id: CAT, meta_pct: 42.5, cliente_id: null, segmento: 'Atacado', vigencia_inicio: '2026-11-01', vigencia_fim: null });
    expect(rotuloAlvo(linha)).toBe('Segmento Atacado');
  });
});

describe('CSV dos cadastros', () => {
  it('meta de share com o nome da categoria, vírgula decimal e situação', () => {
    const csv = cadastroCsv('meta_share', [{ categoria_gondola_id: CAT, meta_pct: 42.5, cliente_id: null, segmento: null, vigencia_inicio: '2026-11-01', vigencia_fim: null, deleted_at: null }], new Map([[CAT, 'Massas']]));
    expect(csv).toContain('Categoria;Meta de share (%);Alvo;Vigência;Situação');
    expect(csv).toContain('Massas;42,5;Todas as lojas;desde 01/11/2026;Ativo');
  });
  it('desativado aparece como tal', () => {
    expect(cadastroCsv('categoria_gondola', [{ nome: 'Rival', ordem: 1, ativo: false, deleted_at: '2026-11-03T10:00:00.000Z' }])).toContain('Rival;1;Desativado');
  });
});

describe('aviso das marcas concorrentes (ADR 0034)', () => {
  it('ADR 0033: o link para o Catálogo aparece só com a permissão marca.gerenciar', () => {
    expect(ACAO_MARCAS).toBe('marca.gerenciar');
    expect(avisoMarcas(true).link).toBe(true);
    expect(avisoMarcas(false).link).toBe(false);
  });
});

describe('revisão do BKO (§P7, §P8)', () => {
  it('§P8.3: o erro de um campo vai para o campo do formulário, não para o topo', () => {
    const f = { ...vazio(), categoria_gondola_id: CAT, meta_pct: '' };
    const e = errosDoForm('meta_share', f, ID);
    expect(e.campos.meta_pct).toBeTruthy();
    expect(e.gerais).toEqual([]);
  });

  it('RN-PRO-10: loja inválida cai no campo do alvo; vigência invertida vai no topo (sem campo)', () => {
    const base = { ...vazio(), produto_id: ID };
    expect(errosDoForm('mix_obrigatorio', { ...base, alvo_tipo: 'loja', alvo_valor: 'abc' }, ID).campos.alvo_valor).toMatch(/loja/);
    expect(errosDoForm('mix_obrigatorio', { ...base, vigencia_fim: '2026-10-01' }, ID).gerais[0]).toMatch(/anterior/);
  });

  it('§P8.3: a mensagem do domain sobre o nome vai embaixo do campo, sem repetir no topo', () => {
    const e = errosDoForm('categoria_gondola', { ...vazio(), nome: '' }, ID);
    expect(e.campos.nome).toMatch(/nome/i);
    expect(e.gerais).toEqual([]);
  });

  it('formulário válido não tem erro', () => {
    expect(errosDoForm('categoria_gondola', { ...vazio(), nome: 'Massas' }, ID)).toEqual({ campos: {}, gerais: [] });
  });

  it('§P7: textos no gênero certo de cada cadastro', () => {
    expect(textosDoCadastro('categoria_gondola')).toMatchObject({ novo: 'Nova categoria', salvo: 'Categoria salva.', desativado: 'Categoria desativada.', vazio: 'Nenhuma categoria cadastrada.' });
    expect(textosDoCadastro('checklist_loja')).toMatchObject({ novo: 'Novo checklist', editar: 'Editar checklist', salvo: 'Checklist salvo.', vazio: 'Nenhum checklist cadastrado.' });
    expect(textosDoCadastro('meta_share')).toMatchObject({ desativar: 'Desativar meta de share?', vazio: 'Nenhuma meta de share cadastrada.' });
  });
});
