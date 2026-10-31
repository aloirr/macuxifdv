import { describe, expect, it } from 'vitest';
import { adesaoDoMes, conclusaoDaTrilha, publicoDaTrilha } from './adesao';
import type { TrilhaDef } from './trilha';

describe('RF-TRE-05: adesão do mês (painel do gestor)', () => {
  const publico = ['u1', 'u2', 'u3', 'u4'];

  it('RF-TRE-05: adesão = % do público com ao menos uma lição concluída no mês (1 de 4 = 25%)', () => {
    const r = adesaoDoMes({ publico, conclusoes: [{ usuario_id: 'u1', concluida_em: '2026-10-05T13:00:00Z' }], mes: '2026-10' });
    expect(r).toEqual({ mes: '2026-10', publico: 4, ativos_no_mes: 1, adesao_pct: 25 });
  });

  it('RF-TRE-05: várias lições do mesmo usuário contam uma vez', () => {
    const r = adesaoDoMes({
      publico,
      conclusoes: [
        { usuario_id: 'u1', concluida_em: '2026-10-05T13:00:00Z' },
        { usuario_id: 'u1', concluida_em: '2026-10-06T13:00:00Z' },
        { usuario_id: 'u2', concluida_em: '2026-10-06T13:00:00Z' },
      ],
      mes: '2026-10',
    });
    expect(r).toMatchObject({ ativos_no_mes: 2, adesao_pct: 50 });
  });

  it('RF-TRE-05: o mês é o do fuso do tenant — 01/11 02:00Z ainda é outubro em Manaus', () => {
    const c = [{ usuario_id: 'u1', concluida_em: '2026-11-01T02:00:00Z' }];
    expect(adesaoDoMes({ publico, conclusoes: c, mes: '2026-10' }).ativos_no_mes).toBe(1);
    expect(adesaoDoMes({ publico, conclusoes: c, mes: '2026-11' }).ativos_no_mes).toBe(0);
  });

  it('RF-TRE-05: quem não está no público (ou concluiu em outro mês) não entra na conta', () => {
    const r = adesaoDoMes({
      publico,
      conclusoes: [{ usuario_id: 'fora', concluida_em: '2026-10-05T13:00:00Z' }, { usuario_id: 'u1', concluida_em: '2026-09-30T13:00:00Z' }],
      mes: '2026-10',
    });
    expect(r).toMatchObject({ ativos_no_mes: 0, adesao_pct: 0 });
  });

  it('RF-TRE-05: público vazio devolve "sem dados" (null), nunca divide por zero', () => {
    expect(adesaoDoMes({ publico: [], conclusoes: [], mes: '2026-10' })).toEqual({ mes: '2026-10', publico: 0, ativos_no_mes: 0, adesao_pct: null });
  });

  it('RF-TRE-05: ids repetidos no público contam uma vez; mês inválido é erro', () => {
    expect(adesaoDoMes({ publico: ['u1', 'u1'], conclusoes: [], mes: '2026-10' }).publico).toBe(1);
    expect(() => adesaoDoMes({ publico, conclusoes: [], mes: '10/2026' })).toThrow(/AAAA-MM/);
  });
});

describe('RF-TRE-05: conclusão por trilha e público da trilha', () => {
  const trilha: TrilhaDef = {
    id: 'T1',
    status: 'publicada',
    obrigatoria: true,
    sequencial: true,
    prazo: null,
    publico_alvo: { perfis: ['vendedor'], equipes: ['norte'] },
    modulos: [],
  };
  const usuarios = [
    { id: 'u1', perfil: 'vendedor', equipe_id: 'norte', ativo: true },
    { id: 'u2', perfil: 'vendedor', equipe_id: 'sul', ativo: true },
    { id: 'u3', perfil: 'vendedor', equipe_id: 'norte', ativo: false },
    { id: 'u4', perfil: 'vendedor', equipe_id: 'norte', ativo: true },
  ];

  it('RF-TRE-05: público da trilha = usuários ativos dentro do público-alvo', () => {
    expect(publicoDaTrilha(trilha, usuarios)).toEqual(['u1', 'u4']);
  });

  it('RF-TRE-05: conclusão da trilha = % do público que concluiu (1 de 2 = 50%); público vazio = null', () => {
    expect(conclusaoDaTrilha(['u1', 'u4'], ['u1', 'fora'])).toEqual({ publico: 2, concluiram: 1, conclusao_pct: 50 });
    expect(conclusaoDaTrilha([], ['u1'])).toEqual({ publico: 0, concluiram: 0, conclusao_pct: null });
  });
});
