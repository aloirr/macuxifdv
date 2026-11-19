import { describe, expect, it, vi } from 'vitest';
import { ENTIDADE_PONTO_TRAJETO, PontoTrajetoSchema } from '../../contracts';
import { enfileirarPontosDoTrajeto, type BancoDoTrajeto } from './enviar-pontos-trajeto';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const AGORA = new Date('2026-11-19T15:00:00.000Z');

interface Linha {
  id: string;
  capturado_em: string;
  latitude: number;
  longitude: number;
  precisao_m: number | null;
  velocidade_ms: number | null;
  enviado_em: string | null;
  extra?: string;
}

function ponto(n: number, o: Partial<Linha> = {}): Linha {
  return {
    id: U(n),
    capturado_em: new Date(Date.UTC(2026, 10, 19, 12, 0, 0) + n * 1000).toISOString(),
    latitude: -3.1,
    longitude: -60.02,
    precisao_m: 12,
    velocidade_ms: null,
    enviado_em: null,
    ...o,
  };
}

/** SQLite falso: entende só os dois comandos da rotina. */
function bancoFalso(linhas: Linha[], semTabela = false) {
  const rodar = vi.fn(async (sql: string, params: readonly unknown[] = []) => {
    if (semTabela) throw new Error('no such table: core__ponto_trajeto');
    if (!/^UPDATE core__ponto_trajeto SET enviado_em = \? WHERE id IN/.test(sql)) throw new Error('sql inesperado');
    const [quando, ...ids] = params as string[];
    let alteradas = 0;
    for (const l of linhas) {
      if (!ids.includes(l.id)) continue;
      l.enviado_em = quando!;
      alteradas++;
    }
    return { alteradas };
  });
  const todas = vi.fn(async (sql: string, params: readonly unknown[] = []) => {
    if (semTabela) throw new Error('no such table: core__ponto_trajeto');
    if (!/WHERE enviado_em IS NULL ORDER BY capturado_em/.test(sql)) throw new Error('sql inesperado');
    const limite = params[0] as number;
    return linhas
      .filter((l) => l.enviado_em === null)
      .sort((a, b) => a.capturado_em.localeCompare(b.capturado_em))
      .slice(0, limite)
      .map(({ extra: _e, enviado_em: _x, ...resto }) => ({ ...resto, enviado_em: null }));
  });
  return { db: { rodar, todas } as unknown as BancoDoTrajeto, rodar, todas };
}

function montar(linhas: Linha[], semTabela = false) {
  const b = bancoFalso(linhas, semTabela);
  const enfileirar = vi.fn(async (_n: unknown) => ({}));
  const registrar = vi.fn();
  const dep = { db: b.db, enfileirar, agora: () => AGORA, registrar };
  return { ...b, enfileirar, registrar, dep };
}

describe('enfileirarPontosDoTrajeto (RN-CORE-13: o ponto capturado dentro do portão chega ao servidor)', () => {
  it('RN-CORE-13: enfileira cada ponto pendente como ponto_trajeto e marca enviado_em', async () => {
    const linhas = [ponto(2), ponto(1)];
    const m = montar(linhas);
    const r = await enfileirarPontosDoTrajeto(m.dep);
    expect(r).toMatchObject({ enfileirados: 2, invalidos: 0, erro: false });
    expect(m.enfileirar).toHaveBeenCalledTimes(2);
    expect((m.enfileirar.mock.calls[0]![0] as { id: string }).id).toBe(U(1));
    expect(m.enfileirar.mock.calls[0]![0]).toMatchObject({ entidade: ENTIDADE_PONTO_TRAJETO, operacao: 'upsert' });
    expect(linhas.every((l) => l.enviado_em === AGORA.toISOString())).toBe(true);
  });

  it('RN-CORE-13: idempotência, rodar duas vezes não enfileira de novo', async () => {
    const m = montar([ponto(1), ponto(2)]);
    await enfileirarPontosDoTrajeto(m.dep);
    const r = await enfileirarPontosDoTrajeto(m.dep);
    expect(r.enfileirados).toBe(0);
    expect(m.enfileirar).toHaveBeenCalledTimes(2);
  });

  it('RN-CORE-13: mais de 500 pendentes saem em lotes de 500 até acabar', async () => {
    const linhas = Array.from({ length: 1203 }, (_, i) => ponto(i + 1));
    const m = montar(linhas);
    const r = await enfileirarPontosDoTrajeto(m.dep);
    expect(r.enfileirados).toBe(1203);
    expect(m.enfileirar).toHaveBeenCalledTimes(1203);
    expect(m.todas).toHaveBeenCalledTimes(4);
    expect(m.todas.mock.calls.every((c) => c[1]![0] === 500)).toBe(true);
    expect(linhas.every((l) => l.enviado_em !== null)).toBe(true);
  });

  it('RN-CORE-13: sem a tabela, não faz nada e não lança', async () => {
    const m = montar([], true);
    const r = await enfileirarPontosDoTrajeto(m.dep);
    expect(r).toEqual({ enfileirados: 0, invalidos: 0, erro: false });
    expect(m.enfileirar).not.toHaveBeenCalled();
    expect(m.registrar).not.toHaveBeenCalled();
  });

  it('RN-CORE-13: sem ponto pendente (rastreamento desligado), nada é enfileirado', async () => {
    const m = montar([ponto(1, { enviado_em: '2026-11-19T10:00:00.000Z' })]);
    const r = await enfileirarPontosDoTrajeto(m.dep);
    expect(r.enfileirados).toBe(0);
    expect(m.enfileirar).not.toHaveBeenCalled();
    expect(m.rodar).not.toHaveBeenCalled();
  });

  it('RN-CORE-13: o payload tem só os campos do PontoTrajetoSchema', async () => {
    const m = montar([ponto(1, { velocidade_ms: 3.5 })]);
    await enfileirarPontosDoTrajeto(m.dep);
    const payload = (m.enfileirar.mock.calls[0]![0] as { payload: Record<string, unknown> }).payload;
    expect(Object.keys(payload).sort()).toEqual(['capturado_em', 'id', 'latitude', 'longitude', 'precisao_m', 'velocidade_ms']);
    expect(PontoTrajetoSchema.safeParse(payload).success).toBe(true);
  });

  it('RN-CORE-13: ponto inválido no schema é marcado e não é enfileirado', async () => {
    const linhas = [ponto(1, { precisao_m: null }), ponto(2)];
    const m = montar(linhas);
    const r = await enfileirarPontosDoTrajeto(m.dep);
    expect(r).toMatchObject({ enfileirados: 1, invalidos: 1 });
    expect(m.enfileirar).toHaveBeenCalledTimes(1);
    expect(linhas[0]!.enviado_em).not.toBeNull();
  });

  it('RN-CORE-13: erro no enfileirar não derruba o sync, não marca o ponto e não vaza coordenada', async () => {
    const linhas = [ponto(1), ponto(2)];
    const m = montar(linhas);
    m.enfileirar.mockImplementationOnce(async () => ({})).mockImplementationOnce(async () => {
      throw new Error('falhou em -3.1,-60.02');
    });
    const r = await enfileirarPontosDoTrajeto(m.dep);
    expect(r).toMatchObject({ enfileirados: 1, erro: true });
    expect(linhas[0]!.enviado_em).not.toBeNull();
    expect(linhas[1]!.enviado_em).toBeNull();
    const logado = JSON.stringify(m.registrar.mock.calls);
    expect(logado).not.toMatch(/-3\.1|-60\.02/);
    expect(logado).toContain('1');
  });

  it('RN-CORE-13: erro do banco que não seja tabela ausente também não lança', async () => {
    const m = montar([ponto(1)]);
    m.todas.mockRejectedValueOnce(new Error('disk I/O error'));
    const r = await enfileirarPontosDoTrajeto(m.dep);
    expect(r.erro).toBe(true);
  });
});
