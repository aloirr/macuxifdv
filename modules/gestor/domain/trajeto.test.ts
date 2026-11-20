import { describe, expect, it } from 'vitest';
import { formatarDistancia, projetarPontos } from '@macuxi/core/contracts';
import { formatHHMM } from '@macuxi/comum/fuso';
import type { MembroEquipe } from '../contracts';
import { desenharTrajeto, pessoasDoTrajeto, TEXTO_SEM_TRAJETO } from './trajeto';

const p = (capturado_em: string, latitude: number, longitude: number) => ({ capturado_em, latitude, longitude, precisao_m: 10 });
const TAM = { largura: 300, altura: 200, margem: 10, fuso: 'America/Manaus' };

describe('desenharTrajeto: pontos do dia prontos para o desenho no aparelho (RN-CORE-13, tracking §9)', () => {
  it('RN-CORE-13: sem pontos devolve vazio (o tracking vem desligado de fábrica) e nenhum marcador', () => {
    expect(desenharTrajeto([], TAM)).toEqual({ vazio: true, linha: [], primeiro: null, ultimo: null, total: 0 });
  });

  it('ordena por capturado_em, mesmo que a lista chegue embaralhada', () => {
    const r = desenharTrajeto([p('2026-11-03T14:00:00Z', -3.12, -60), p('2026-11-03T12:00:00Z', -3.1, -60.02), p('2026-11-03T13:00:00Z', -3.11, -60.01)], TAM);
    expect(r.total).toBe(3);
    expect(r.primeiro?.hora).toBe('08:00');
    expect(r.ultimo?.hora).toBe('10:00');
  });

  it('mostra a hora no fuso do tenant, não em UTC (Manaus é UTC-4)', () => {
    const r = desenharTrajeto([p('2026-11-03T12:05:00Z', -3.1, -60), p('2026-11-03T21:30:00Z', -3.12, -60.01)], TAM);
    expect([r.primeiro?.hora, r.ultimo?.hora]).toEqual(['08:05', '17:30']);
    expect(desenharTrajeto([p('2026-11-03T12:05:00Z', -3.1, -60)], { ...TAM, fuso: 'UTC' }).primeiro?.hora).toBe('12:05');
  });

  it('a linha cabe na área com a margem e o norte fica em cima (y cresce para o sul)', () => {
    const r = desenharTrajeto([p('2026-11-03T12:00:00Z', -3.1, -60.02), p('2026-11-03T13:00:00Z', -3.12, -60.0)], TAM);
    for (const q of r.linha) {
      expect(q.x).toBeGreaterThanOrEqual(10 - 1e-9);
      expect(q.x).toBeLessThanOrEqual(290 + 1e-9);
      expect(q.y).toBeGreaterThanOrEqual(10 - 1e-9);
      expect(q.y).toBeLessThanOrEqual(190 + 1e-9);
    }
    expect(r.linha[0]!.y).toBeLessThan(r.linha[1]!.y);
    expect(r.linha[0]!.x).toBeLessThan(r.linha[1]!.x);
  });

  it('pontos todos no mesmo lugar não geram NaN nem divisão por zero', () => {
    const r = desenharTrajeto([p('2026-11-03T12:00:00Z', -3.1, -60), p('2026-11-03T13:00:00Z', -3.1, -60)], TAM);
    expect(r.linha.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y))).toBe(true);
  });

  it('não distorce: no equador a escala é a mesma nos dois eixos', () => {
    const r = desenharTrajeto([p('2026-11-03T12:00:00Z', 0, 0), p('2026-11-03T13:00:00Z', 0.01, 0.01)], { largura: 200, altura: 200, margem: 0, fuso: 'UTC' });
    expect(Math.abs(r.linha[1]!.x - r.linha[0]!.x)).toBeCloseTo(Math.abs(r.linha[1]!.y - r.linha[0]!.y), 5);
  });

  it('RD-2299: o trajeto é desenhado pelas funções do Core (mesma projeção e mesma hora do Campo)', () => {
    const pts = [p('2026-11-03T12:00:00Z', -3.1, -60.02), p('2026-11-03T13:00:00Z', -3.12, -60.0)];
    const r = desenharTrajeto(pts, TAM);
    expect(r.linha).toEqual(projetarPontos(pts, TAM.largura, TAM.altura, TAM.margem));
    expect(r.primeiro?.hora).toBe(formatHHMM(pts[0]!.capturado_em, TAM.fuso));
  });

  it('RD-2299: o percorrido sai como no Campo ("850 m" abaixo de 1 km, "18,6 km" acima)', () => {
    expect(formatarDistancia(850)).toBe('850 m');
    expect(formatarDistancia(18600)).toBe('18,6 km');
  });

  it('RD-2300: dia sem pontos mostra "Nada registrado" no app e no BKO, e dia com pontos não mostra', () => {
    expect(TEXTO_SEM_TRAJETO).toBe('Nada registrado');
    expect(desenharTrajeto([], TAM).vazio).toBe(true);
    expect(desenharTrajeto([p('2026-11-03T12:00:00Z', -3.1, -60)], TAM).vazio).toBe(false);
  });
});

describe('pessoasDoTrajeto: quem aparece na escolha do trajeto do dia (RN-CORE-13, T-0187)', () => {
  const m = (id: string, nome: string, perfil: MembroEquipe['perfil'], ativo = true): MembroEquipe => ({ id, nome, perfil, superior_id: null, ativo });
  const TODOS = [m('g', 'Gil', 'gerente'), m('s1', 'Bia', 'supervisor'), m('v1', 'Zeca', 'vendedor'), m('p1', 'Ana', 'promotor'), m('v2', 'Inativo', 'vendedor', false), m('a1', 'Analista', 'analista')];

  it('RN-CORE-13: o supervisor vê vendedores e promotores ativos, em ordem de nome, e nunca a si mesmo', () => {
    const r = pessoasDoTrajeto({ viewer: { id: 's1', perfil: 'supervisor' }, membros: [...TODOS, m('s2', 'Outro supervisor', 'supervisor')] });
    expect(r.map((x) => x.id)).toEqual(['p1', 'v1']);
  });

  it('RN-CORE-13 / T-0187: o gerente vê também os supervisores das equipes abaixo, e nunca o próprio trajeto', () => {
    const r = pessoasDoTrajeto({ viewer: { id: 'g', perfil: 'gerente' }, membros: TODOS });
    expect(r.map((x) => x.id)).toEqual(['p1', 's1', 'v1']);
    expect(r.some((x) => x.id === 'g')).toBe(false);
  });

  it('RN-CORE-13: o usuário da sessão sai mesmo quando o escopo o traz (admin com a permissão)', () => {
    const r = pessoasDoTrajeto({ viewer: { id: 'v1', perfil: 'admin' }, membros: TODOS });
    expect(r.map((x) => x.id)).toEqual(['p1']);
  });
});
