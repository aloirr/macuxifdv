import { describe, expect, it } from 'vitest';
import { conclusoesDeTrilhas, painelDeAdesao } from './painel';
import type { TrilhaDef } from './trilha';

const trilha = (id: string, licoes: string[], extra: Partial<TrilhaDef> = {}): TrilhaDef => ({
  id,
  status: 'publicada',
  obrigatoria: true,
  sequencial: true,
  prazo: null,
  publico_alvo: { perfis: [], equipes: [] },
  modulos: [{ id: `M-${id}`, ordem: 1, licoes: licoes.map((l, i) => ({ id: l, ordem: i + 1 })) }],
  ...extra,
});
const usuarios = [
  { id: 'U1', nome: 'Ana', perfil: 'vendedor', equipe_id: 'EQ1', ativo: true },
  { id: 'U2', nome: 'Bruno', perfil: 'vendedor', equipe_id: 'EQ1', ativo: true },
  { id: 'U3', nome: 'Carla', perfil: 'promotor', equipe_id: 'EQ2', ativo: true },
  { id: 'U4', nome: 'Davi', perfil: 'vendedor', equipe_id: 'EQ1', ativo: false },
];
const c = (usuario_id: string, trilha_id: string, licao_id: string, concluida_em: string) => ({ usuario_id, trilha_id, licao_id, concluida_em });

describe('conclusoesDeTrilhas — base do ranking (RN-TRE-03)', () => {
  it('RN-TRE-03: a trilha conta como concluída no instante da última lição que a fechou', () => {
    const t = trilha('TR1', ['L1', 'L2']);
    const r = conclusoesDeTrilhas('T', [t], [c('U1', 'TR1', 'L2', '2026-11-02T15:00:00Z'), c('U1', 'TR1', 'L1', '2026-11-01T15:00:00Z'), c('U2', 'TR1', 'L1', '2026-11-01T15:00:00Z')]);
    expect(r).toEqual([{ tenant_id: 'T', usuario_id: 'U1', trilha_id: 'TR1', concluida_em: '2026-11-02T15:00:00Z' }]);
  });
});

describe('painelDeAdesao — RF-TRE-05', () => {
  const tA = trilha('TR1', ['L1', 'L2']);
  const tB = trilha('TR2', ['L9'], { publico_alvo: { perfis: ['promotor'], equipes: [] } });
  const conclusoes = [c('U1', 'TR1', 'L1', '2026-11-01T15:00:00Z'), c('U1', 'TR1', 'L2', '2026-11-02T15:00:00Z'), c('U2', 'TR1', 'L1', '2026-10-30T15:00:00Z'), c('U3', 'TR2', 'L9', '2026-11-03T03:30:00Z')];
  const tentativas = [
    { usuario_id: 'U1', quiz_id: 'Z1', realizada_em: '2026-11-01T15:00:00Z', nota_pct: 50, aprovada: false },
    { usuario_id: 'U1', quiz_id: 'Z1', realizada_em: '2026-11-01T16:00:00Z', nota_pct: 100, aprovada: true },
    { usuario_id: 'U2', quiz_id: 'Z1', realizada_em: '2026-10-30T15:00:00Z', nota_pct: 70, aprovada: true },
  ];
  const quizzes = [{ id: 'Z1', trilha_id: 'TR1', licao_id: 'L2', questoes: [] }];

  it('RF-TRE-05: adesão do mês, conclusão por trilha e pessoas, só com usuários ativos do escopo', () => {
    const p = painelDeAdesao({ usuarios, trilhas: [tA, tB], quizzes, conclusoes, tentativas, mes: '2026-11', fuso: 'America/Manaus', nota_que_vale: 'melhor' });
    // público do tenant = 3 ativos; ativos em novembro (Manaus): U1 e U3 (03/11 03:30Z = 02/11 em Manaus)
    expect(p.adesao).toEqual({ mes: '2026-11', publico: 3, ativos_no_mes: 2, adesao_pct: 66.67 });
    expect(p.trilhas).toEqual([
      { trilha_id: 'TR1', publico: 3, concluiram: 1, conclusao_pct: 33.33, nota_media_pct: 85 },
      { trilha_id: 'TR2', publico: 1, concluiram: 1, conclusao_pct: 100, nota_media_pct: null },
    ]);
    expect(p.pessoas).toEqual([
      { usuario_id: 'U1', nome: 'Ana', perfil: 'vendedor', equipe_id: 'EQ1', licoes_no_mes: 2, trilhas_concluidas: 1, obrigatorias_pendentes: 0, nota_media_pct: 100, ultima_atividade_em: '2026-11-02T15:00:00Z' },
      { usuario_id: 'U2', nome: 'Bruno', perfil: 'vendedor', equipe_id: 'EQ1', licoes_no_mes: 0, trilhas_concluidas: 0, obrigatorias_pendentes: 1, nota_media_pct: 70, ultima_atividade_em: '2026-10-30T15:00:00Z' },
      { usuario_id: 'U3', nome: 'Carla', perfil: 'promotor', equipe_id: 'EQ2', licoes_no_mes: 1, trilhas_concluidas: 1, obrigatorias_pendentes: 1, nota_media_pct: null, ultima_atividade_em: '2026-11-03T03:30:00Z' },
    ]);
  });

  it('RF-TRE-05: nota que vale = última tentativa quando o tenant escolhe "ultima"', () => {
    const t2 = [...tentativas, { usuario_id: 'U1', quiz_id: 'Z1', realizada_em: '2026-11-02T10:00:00Z', nota_pct: 60, aprovada: false }];
    const p = painelDeAdesao({ usuarios, trilhas: [tA], quizzes, conclusoes, tentativas: t2, mes: '2026-11', fuso: 'America/Manaus', nota_que_vale: 'ultima' });
    expect(p.pessoas.find((x) => x.usuario_id === 'U1')!.nota_media_pct).toBe(60);
  });

  it('RF-TRE-05: escopo vazio = sem dados (null), nunca divide por zero', () => {
    const p = painelDeAdesao({ usuarios: [], trilhas: [tA], quizzes, conclusoes, tentativas, mes: '2026-11', fuso: 'America/Manaus', nota_que_vale: 'melhor' });
    expect(p.adesao.adesao_pct).toBeNull();
    expect(p.trilhas[0]).toMatchObject({ publico: 0, conclusao_pct: null, nota_media_pct: null });
    expect(p.pessoas).toEqual([]);
  });

  it('RF-TRE-05: trilha em rascunho não entra no painel', () => {
    const p = painelDeAdesao({ usuarios, trilhas: [tA, trilha('TR3', ['L5'], { status: 'rascunho' })], quizzes, conclusoes, tentativas, mes: '2026-11', fuso: 'America/Manaus', nota_que_vale: 'melhor' });
    expect(p.trilhas.map((t) => t.trilha_id)).toEqual(['TR1']);
  });
});
