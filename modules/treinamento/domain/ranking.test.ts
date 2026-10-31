import { describe, expect, it } from 'vitest';
import { calcularRanking, intervaloDoPeriodo, posicaoDoUsuario, type ConclusaoTrilha, type UsuarioRanking } from './ranking';
import type { LancamentoXp } from './xp';

const T = 'tenant-1';
const usuario = (id: string, nome: string, extra: Partial<UsuarioRanking> = {}): UsuarioRanking => ({
  id,
  tenant_id: T,
  nome,
  perfil: 'vendedor',
  equipe_id: 'norte',
  regional_id: 'amazonas',
  ativo: true,
  ...extra,
});
let seq = 0;
const lanc = (usuario_id: string, pontos: number, ocorrido_em: string, extra: Partial<LancamentoXp> = {}): LancamentoXp => ({
  id: `l-${++seq}`,
  tenant_id: T,
  usuario_id,
  origem: 'licao',
  referencia_id: `ref-${seq}`,
  pontos,
  pontos_base: pontos,
  limitado_pelo_teto: false,
  ocorrido_em,
  dia: ocorrido_em.slice(0, 10), // casos de teste ficam longe da meia-noite
  ...extra,
});
const conclusao = (usuario_id: string, concluida_em: string, trilha_id = 'T1'): ConclusaoTrilha => ({ tenant_id: T, usuario_id, trilha_id, concluida_em });

const base = {
  tenant_id: T,
  periodo: 'mensal' as const,
  data_ref: '2026-10-31',
  escopo: { tipo: 'geral' as const },
};

describe('RF-TRE-04: períodos do ranking', () => {
  it('RF-TRE-04: semanal = segunda a domingo da semana da data (31/10/2026 é sábado)', () => {
    expect(intervaloDoPeriodo('semanal', '2026-10-31')).toEqual({ tipo: 'semanal', inicio: '2026-10-26', fim: '2026-11-01' });
    expect(intervaloDoPeriodo('semanal', '2026-10-26')).toMatchObject({ inicio: '2026-10-26' });
    expect(intervaloDoPeriodo('semanal', '2026-11-01')).toMatchObject({ inicio: '2026-10-26', fim: '2026-11-01' });
  });
  it('RF-TRE-04: mensal = do dia 1 ao último dia do mês (fevereiro bissexto incluso)', () => {
    expect(intervaloDoPeriodo('mensal', '2026-10-31')).toEqual({ tipo: 'mensal', inicio: '2026-10-01', fim: '2026-10-31' });
    expect(intervaloDoPeriodo('mensal', '2028-02-10')).toMatchObject({ inicio: '2028-02-01', fim: '2028-02-29' });
  });
  it('RF-TRE-04: acumulado não tem limites', () => {
    expect(intervaloDoPeriodo('acumulado', '2026-10-31')).toEqual({ tipo: 'acumulado', inicio: null, fim: null });
  });
});

describe('RN-TRE-03: ranking por XP no período', () => {
  const usuarios = [usuario('u1', 'Ana'), usuario('u2', 'Bruno'), usuario('u3', 'Carla')];

  it('RN-TRE-03: ordena por XP do período, do maior para o menor, e numera as posições', () => {
    const r = calcularRanking({
      ...base,
      usuarios,
      lancamentos: [lanc('u1', 30, '2026-10-10T13:00:00Z'), lanc('u2', 80, '2026-10-11T13:00:00Z'), lanc('u3', 50, '2026-10-12T13:00:00Z')],
      conclusoes: [],
    });
    expect(r.map((l) => [l.posicao, l.usuario_id, l.pontos])).toEqual([[1, 'u2', 80], [2, 'u3', 50], [3, 'u1', 30]]);
  });

  it('RN-TRE-03: só conta o XP dentro do período (semanal exclui o mês anterior e a semana passada)', () => {
    const r = calcularRanking({
      ...base,
      periodo: 'semanal',
      usuarios,
      lancamentos: [lanc('u1', 100, '2026-10-20T13:00:00Z'), lanc('u1', 10, '2026-10-27T13:00:00Z'), lanc('u2', 20, '2026-10-30T13:00:00Z')],
      conclusoes: [],
    });
    expect(r.map((l) => [l.usuario_id, l.pontos])).toEqual([['u2', 20], ['u1', 10], ['u3', 0]]);
  });

  it('RN-TRE-03: acumulado soma tudo', () => {
    const r = calcularRanking({ ...base, periodo: 'acumulado', usuarios, lancamentos: [lanc('u1', 100, '2026-01-20T13:00:00Z'), lanc('u1', 10, '2026-10-27T13:00:00Z')], conclusoes: [] });
    expect(r[0]).toMatchObject({ usuario_id: 'u1', pontos: 110 });
  });

  it('RN-TRE-03: empate em XP → quem atingiu primeiro (instante do último lançamento do período)', () => {
    const r = calcularRanking({
      ...base,
      usuarios,
      lancamentos: [
        lanc('u1', 40, '2026-10-10T13:00:00Z'),
        lanc('u1', 10, '2026-10-15T13:00:00Z'), // u1 chegou a 50 em 15/10
        lanc('u2', 50, '2026-10-12T13:00:00Z'), // u2 chegou a 50 em 12/10 → à frente
      ],
      conclusoes: [],
    });
    expect(r.slice(0, 2).map((l) => l.usuario_id)).toEqual(['u2', 'u1']);
    expect(r[0]!.atingiu_em).toBe('2026-10-12T13:00:00Z');
  });

  it('RN-TRE-03: empate em XP e no instante → mais trilhas concluídas no período', () => {
    const r = calcularRanking({
      ...base,
      usuarios,
      lancamentos: [lanc('u1', 50, '2026-10-12T13:00:00Z'), lanc('u2', 50, '2026-10-12T13:00:00Z')],
      conclusoes: [conclusao('u2', '2026-10-12T13:00:00Z'), conclusao('u2', '2026-10-12T13:00:00Z', 'T2'), conclusao('u1', '2026-10-12T13:00:00Z')],
    });
    expect(r.slice(0, 2).map((l) => [l.usuario_id, l.trilhas_concluidas])).toEqual([['u2', 2], ['u1', 1]]);
  });

  it('RN-TRE-03: último desempate é o nome (sem diferenciar maiúsculas e acentos), depois o id — a ordem é sempre total', () => {
    const us = [usuario('u9', 'Édson'), usuario('u2', 'ana'), usuario('u1', 'Ana')];
    const r = calcularRanking({ ...base, usuarios: us, lancamentos: [], conclusoes: [] });
    expect(r.map((l) => l.usuario_id)).toEqual(['u1', 'u2', 'u9']);
    expect(r.map((l) => l.posicao)).toEqual([1, 2, 3]);
  });

  it('RN-TRE-03: usuário sem XP no período aparece no fim, com 0 ponto e sem "atingiu_em"', () => {
    const r = calcularRanking({ ...base, usuarios, lancamentos: [lanc('u1', 5, '2026-10-12T13:00:00Z')], conclusoes: [] });
    expect(r[2]).toMatchObject({ pontos: 0, atingiu_em: null, trilhas_concluidas: 0 });
  });

  it('RN-TRE-03: lançamento de 0 ponto (teto diário) não define "atingiu_em"', () => {
    const r = calcularRanking({
      ...base,
      usuarios: [usuario('u1', 'Ana')],
      lancamentos: [lanc('u1', 20, '2026-10-10T13:00:00Z'), lanc('u1', 0, '2026-10-10T18:00:00Z', { pontos_base: 10, limitado_pelo_teto: true })],
      conclusoes: [],
    });
    expect(r[0]!.atingiu_em).toBe('2026-10-10T13:00:00Z');
  });
});

describe('RN-TRE-03 / RF-TRE-04: quem entra no ranking', () => {
  it('RN-TRE-03: só usuários ativos entram (inativo some, mesmo com XP)', () => {
    const r = calcularRanking({
      ...base,
      usuarios: [usuario('u1', 'Ana'), usuario('u2', 'Bruno', { ativo: false })],
      lancamentos: [lanc('u2', 500, '2026-10-12T13:00:00Z')],
      conclusoes: [],
    });
    expect(r.map((l) => l.usuario_id)).toEqual(['u1']);
  });

  it('premissa T-0011: só perfis do público do ranking (vendedor e promotor por padrão)', () => {
    const us = [usuario('u1', 'Ana'), usuario('u2', 'Bruno', { perfil: 'promotor' }), usuario('u3', 'Carla', { perfil: 'supervisor' })];
    expect(calcularRanking({ ...base, usuarios: us, lancamentos: [], conclusoes: [] }).map((l) => l.usuario_id)).toEqual(['u1', 'u2']);
    const r = calcularRanking({ ...base, usuarios: us, lancamentos: [], conclusoes: [], perfis: ['supervisor'] });
    expect(r.map((l) => l.usuario_id)).toEqual(['u3']);
  });

  it('RN-TRE-03: ranking visível só dentro do tenant — usuário e lançamento de outro tenant são ignorados', () => {
    const r = calcularRanking({
      ...base,
      usuarios: [usuario('u1', 'Ana'), usuario('x1', 'Intruso', { tenant_id: 'tenant-2' })],
      lancamentos: [lanc('u1', 10, '2026-10-12T13:00:00Z'), lanc('x1', 999, '2026-10-12T13:00:00Z', { tenant_id: 'tenant-2' }), lanc('u1', 500, '2026-10-12T14:00:00Z', { tenant_id: 'tenant-2' })],
      conclusoes: [],
    });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ usuario_id: 'u1', pontos: 10 });
  });

  it('RF-TRE-04: ranking por equipe e por regional', () => {
    const us = [usuario('u1', 'Ana'), usuario('u2', 'Bruno', { equipe_id: 'sul', regional_id: 'amazonas' }), usuario('u3', 'Carla', { equipe_id: 'sul', regional_id: 'para' })];
    const lancamentos = [lanc('u1', 10, '2026-10-12T13:00:00Z'), lanc('u2', 20, '2026-10-12T13:00:00Z'), lanc('u3', 30, '2026-10-12T13:00:00Z')];
    const porEquipe = calcularRanking({ ...base, usuarios: us, lancamentos, conclusoes: [], escopo: { tipo: 'equipe', equipe_id: 'sul' } });
    expect(porEquipe.map((l) => l.usuario_id)).toEqual(['u3', 'u2']);
    const porRegional = calcularRanking({ ...base, usuarios: us, lancamentos, conclusoes: [], escopo: { tipo: 'regional', regional_id: 'amazonas' } });
    expect(porRegional.map((l) => l.usuario_id)).toEqual(['u2', 'u1']);
  });

  it('RF-TRE-04: o vendedor vê a própria posição e a dos colegas', () => {
    const us = [usuario('u1', 'Ana'), usuario('u2', 'Bruno')];
    const r = calcularRanking({ ...base, usuarios: us, lancamentos: [lanc('u2', 20, '2026-10-12T13:00:00Z')], conclusoes: [] });
    expect(posicaoDoUsuario(r, 'u1')).toMatchObject({ posicao: 2, pontos: 0 });
    expect(posicaoDoUsuario(r, 'u2')?.posicao).toBe(1);
    expect(posicaoDoUsuario(r, 'fora')).toBeNull();
  });

  it('RF-TRE-04: o "dia" do lançamento vem do campo dia (fuso do tenant), não do UTC do instante', () => {
    const r = calcularRanking({
      ...base,
      usuarios: [usuario('u1', 'Ana')],
      // 01/11 02:00Z é 31/10 22:00 em Manaus: pertence a outubro.
      lancamentos: [lanc('u1', 10, '2026-11-01T02:00:00Z', { dia: '2026-10-31' })],
      conclusoes: [],
    });
    expect(r[0]!.pontos).toBe(10);
  });
});
