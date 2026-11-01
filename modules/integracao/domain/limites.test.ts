import { describe, expect, it } from 'vitest';
import { classeDaRota, consumirToken, verificarTamanhoCorpo, type ConfigBalde } from './limites';

const t0 = '2026-11-01T10:00:00.000Z';
const mais = (iso: string, seg: number) => new Date(Date.parse(iso) + seg * 1000).toISOString();
const cfg: ConfigBalde = { capacidade: 5, reposicaoPorMin: 60 };

describe('RN-INT-12 (proposta): tamanho do corpo', () => {
  it('RN-INT-12: lote aceita até 8 MiB (o Conector envia até 4 MiB) e as demais rotas até 1 MiB', () => {
    expect(verificarTamanhoCorpo(8 * 1024 * 1024, 'lote')).toEqual({ ok: true });
    const r = verificarTamanhoCorpo(8 * 1024 * 1024 + 1, 'lote');
    expect(r).toMatchObject({ ok: false, status: 413, codigo: 'corpo_grande', limite_bytes: 8 * 1024 * 1024 });
    if (!r.ok) expect(r.mensagem).toMatch(/divida|menores/i);
    expect(verificarTamanhoCorpo(1024 * 1024 + 1, 'geral')).toMatchObject({ ok: false, status: 413 });
    expect(verificarTamanhoCorpo(1024 * 1024, 'geral').ok).toBe(true);
  });

  it('RN-INT-12: o limite é parâmetro do tenant', () => {
    expect(verificarTamanhoCorpo(2000, 'lote', { limiteCorpoLoteBytes: 1000 })).toMatchObject({ ok: false, limite_bytes: 1000 });
  });
});

describe('RN-INT-12 (proposta): taxa por Conector (token bucket com relógio injetado)', () => {
  it('RN-INT-12: balde novo começa cheio; esvazia e responde 429 com Retry-After inteiro', () => {
    let estado = null as ReturnType<typeof consumirToken>['estado'] | null;
    for (let i = 0; i < 5; i++) {
      const r = consumirToken(estado, t0, cfg);
      expect(r.permitido).toBe(true);
      estado = r.estado;
    }
    const negado = consumirToken(estado, t0, cfg);
    expect(negado.permitido).toBe(false);
    expect(negado.retryAfterSeg).toBe(1); // 60/min = 1 token/s
    expect(Number.isInteger(negado.retryAfterSeg)).toBe(true);
    expect(negado.estado).toEqual(estado); // negar não consome
  });

  it('RN-INT-12: repõe tokens com o tempo e nunca passa da capacidade', () => {
    let estado = null as ReturnType<typeof consumirToken>['estado'] | null;
    for (let i = 0; i < 5; i++) estado = consumirToken(estado, t0, cfg).estado;
    const depois3s = consumirToken(estado, mais(t0, 3), cfg);
    expect(depois3s.permitido).toBe(true);
    expect(depois3s.estado.tokens).toBeCloseTo(2, 5);
    const muito = consumirToken(estado, mais(t0, 3600), cfg);
    expect(muito.estado.tokens).toBe(4); // capacidade 5 - 1 consumido
  });

  it('RN-INT-12: relógio que anda para trás não repõe nem quebra (clamp)', () => {
    let estado = null as ReturnType<typeof consumirToken>['estado'] | null;
    estado = consumirToken(estado, t0, cfg).estado;
    const r = consumirToken(estado, mais(t0, -30), cfg);
    expect(r.permitido).toBe(true);
    expect(r.estado.tokens).toBeLessThanOrEqual(cfg.capacidade);
  });

  it('RN-INT-12: a espera cresce quando falta mais de um token (custo maior) e é calculada em segundos cheios', () => {
    const vazio = { tokens: 0, atualizadoEm: Date.parse(t0) };
    const r = consumirToken(vazio, t0, { capacidade: 10, reposicaoPorMin: 30 }, 3);
    expect(r.permitido).toBe(false);
    expect(r.retryAfterSeg).toBe(6); // 3 tokens a 0,5/s
  });

  it('RN-INT-12: custo acima da capacidade nunca passaria — é recusado como permanente (retryAfter 0)', () => {
    const r = consumirToken(null, t0, cfg, 6);
    expect(r).toMatchObject({ permitido: false, retryAfterSeg: 0 });
  });

  it('RN-INT-12: POST /lotes tem balde próprio (mais apertado) — as demais rotas usam o geral', () => {
    expect(classeDaRota('POST', '/lotes')).toBe('lote');
    expect(classeDaRota('GET', '/lotes/abc')).toBe('geral');
    expect(classeDaRota('POST', '/sinal')).toBe('geral');
  });
});
