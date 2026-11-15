import { describe, expect, it } from 'vitest';
import { TrilhaEdicao, type Trilha } from '../../contracts';
import {
  adicionarQuestao,
  alterarLicao,
  alternarQuiz,
  deTrilha,
  editavel,
  errosDoFormulario,
  lerListaDeIds,
  marcarCorreta,
  minutosParaSegundos,
  mover,
  novaTrilha,
  paraEdicao,
  problemasDoFormulario,
  remover,
  removerQuestao,
  segundosParaMinutos,
} from './editor';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const geradorDeIds = () => {
  let n = 100;
  return () => uuid(++n);
};

const gravada: Trilha = {
  id: uuid(1),
  tenant_id: uuid(90),
  titulo: 'Boas-vindas',
  descricao: null,
  obrigatoria: true,
  sequencial: true,
  prazo: '2026-11-30',
  publico_alvo: { perfis: ['vendedor'], equipes: [uuid(80)] },
  status: 'rascunho',
  publicada_em: null,
  arquivada_em: null,
  created_at: '2026-11-01T12:00:00Z',
  updated_at: '2026-11-01T12:00:00Z',
  modulos: [
    {
      id: uuid(2),
      ordem: 2,
      titulo: 'Segundo',
      pre_requisitos: [],
      licoes: [{ id: uuid(5), ordem: 1, titulo: 'L B', tipo: 'texto', texto: 'b', midia_url: null, duracao_estimada_seg: null, pre_requisitos: [uuid(4)], quiz: null }],
    },
    {
      id: uuid(3),
      ordem: 1,
      titulo: 'Primeiro',
      pre_requisitos: [],
      licoes: [
        {
          id: uuid(4),
          ordem: 1,
          titulo: 'L A',
          tipo: 'video',
          texto: null,
          midia_url: 'https://exemplo.com.br/v.mp4',
          duracao_estimada_seg: 150,
          pre_requisitos: [],
          quiz: { id: uuid(6), questoes: [{ id: uuid(7), ordem: 1, enunciado: '2+2?', alternativas: [{ id: uuid(8), texto: '4', correta: true }, { id: uuid(9), texto: '5', correta: false }] }] },
        },
      ],
    },
  ],
};

describe('editor de trilha do BKO (RF-TRE-01)', () => {
  it('RF-TRE-01: trilha nova sai com os padrões do contrato e passa no schema depois de ganhar título', () => {
    const e = novaTrilha(geradorDeIds());
    expect(e).toMatchObject({ obrigatoria: false, sequencial: true, prazo: '', perfis: [], equipes: '' });
    expect(e.modulos).toHaveLength(1);
    expect(problemasDoFormulario(e).length).toBeGreaterThan(0);
    const ok = alterarLicao({ ...e, titulo: 'Nova', modulos: [{ ...e.modulos[0]!, titulo: 'M' }] }, 0, 0, (l) => ({ ...l, titulo: 'L' }));
    expect(problemasDoFormulario(ok)).toEqual([]);
  });

  it('RF-TRE-01: ida e volta API → editor → API preserva o conteúdo e renumera a ordem pela posição', () => {
    const corpo = TrilhaEdicao.parse(paraEdicao(deTrilha(gravada)));
    expect(corpo.modulos.map((m) => [m.titulo, m.ordem])).toEqual([
      ['Primeiro', 1],
      ['Segundo', 2],
    ]);
    expect(corpo.modulos[0]!.licoes[0]).toMatchObject({ duracao_estimada_seg: 150, midia_url: 'https://exemplo.com.br/v.mp4', texto: null });
    expect(corpo.modulos[1]!.licoes[0]!.pre_requisitos).toEqual([uuid(4)]);
    expect(corpo.publico_alvo).toEqual({ perfis: ['vendedor'], equipes: [uuid(80)] });
    expect(corpo.prazo).toBe('2026-11-30');
  });

  it('RN-TRE-04: duração em minutos vira segundos (base do tempo mínimo); vazio ou inválido = sem duração', () => {
    expect(minutosParaSegundos('2,5')).toBe(150);
    expect(minutosParaSegundos('10')).toBe(600);
    expect(minutosParaSegundos('')).toBeNull();
    expect(minutosParaSegundos('abc')).toBeNull();
    expect(minutosParaSegundos('0')).toBeNull();
    expect(segundosParaMinutos(150)).toBe('2,5');
    expect(segundosParaMinutos(null)).toBe('');
  });

  it('RF-TRE-01: pré-requisito que aponta para lição removida é descartado ao salvar', () => {
    const e = deTrilha(gravada);
    const semPrimeiro = { ...e, modulos: remover(e.modulos, 0) };
    expect(paraEdicao(semPrimeiro).modulos![0]!.licoes[0]!.pre_requisitos).toEqual([]);
  });

  it('RF-TRE-01: subir, descer e remover módulos e lições; fora da lista não muda nada', () => {
    expect(mover(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(mover(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(mover(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(mover(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
    expect(remover(['a', 'b', 'c'], 1)).toEqual(['a', 'c']);
  });

  it('RN-TRE-02: liga o quiz com uma questão de 2 alternativas, aceita múltipla escolha e desliga', () => {
    const ids = geradorDeIds();
    let e = alternarQuiz(novaTrilha(ids), 0, 0, ids);
    expect(e.modulos[0]!.licoes[0]!.quiz!.questoes[0]!.alternativas.map((a) => a.correta)).toEqual([true, false]);
    e = marcarCorreta(e, 0, 0, 0, 1);
    expect(e.modulos[0]!.licoes[0]!.quiz!.questoes[0]!.alternativas.map((a) => a.correta)).toEqual([true, true]);
    e = adicionarQuestao(e, 0, 0, ids);
    expect(e.modulos[0]!.licoes[0]!.quiz!.questoes).toHaveLength(2);
    e = removerQuestao(e, 0, 0, 0);
    expect(e.modulos[0]!.licoes[0]!.quiz!.questoes).toHaveLength(1);
    e = alternarQuiz(e, 0, 0, ids);
    expect(e.modulos[0]!.licoes[0]!.quiz).toBeNull();
  });

  it('RN-TRE-07: equipes digitadas viram ids sem repetição; id inválido aparece como problema do formulário', () => {
    expect(lerListaDeIds(` ${uuid(80)}, ${uuid(81)}\n${uuid(80)} `)).toEqual([uuid(80), uuid(81)]);
    const e = { ...deTrilha(gravada), equipes: 'norte' };
    expect(problemasDoFormulario(e).join(' ')).toMatch(/Equipes do público/);
  });

  it('RF-TRE-01: aponta onde está o problema (módulo e lição)', () => {
    const e = alterarLicao(deTrilha(gravada), 1, 0, (l) => ({ ...l, titulo: ' ' }));
    expect(problemasDoFormulario(e)).toEqual(['Módulo 2 › Lição 1 › Título: Informe o título.']);
  });

  it('RF-TRE-01: só rascunho (ou trilha nova) abre para edição', () => {
    expect(editavel(undefined)).toBe(true);
    expect(editavel('rascunho')).toBe(true);
    expect(editavel('publicada')).toBe(false);
    expect(editavel('arquivada')).toBe(false);
  });

  it('RF-TRE-01: sem erro, o formulário não tem mensagem por campo nem avisos gerais', () => {
    expect(errosDoFormulario(deTrilha(gravada))).toEqual({ campos: {}, outros: [] });
  });

  it('RF-TRE-01: erro de campo vai embaixo do campo, pelo caminho do contrato (trilha e lição 1 do módulo 2)', () => {
    let e = alterarLicao(deTrilha(gravada), 1, 0, (l) => ({ ...l, titulo: ' ' }));
    e = { ...e, titulo: '' };
    const r = errosDoFormulario(e);
    expect(r.campos['titulo']).toBe('Informe o título.');
    expect(r.campos['modulos.1.licoes.0.titulo']).toBe('Informe o título.');
    expect(r.outros).toEqual([]);
  });

  it('RN-TRE-07: equipes inválidas não são de um campo só e vão na lista geral, com o lugar', () => {
    const r = errosDoFormulario({ ...deTrilha(gravada), equipes: 'norte' });
    expect(r.campos).toEqual({});
    expect(r.outros.join(' ')).toMatch(/Equipes do público/);
  });
});
