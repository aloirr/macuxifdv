import { MAX_ITENS_PUSH, type ItemPush, type ResultadoItemPush } from '@macuxi/platform-sdk';
import { describe, expect, it, vi } from 'vitest';
import { ENTIDADE_PONTO_TRAJETO, PontoTrajetoSchema } from '../../contracts';
import { enviarPontosDoTrajeto, type BancoDoTrajeto } from './enviar-pontos-trajeto';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const AGORA = new Date('2026-11-19T15:00:00.000Z');
const DIA = 86_400_000;
const haDias = (d: number) => new Date(AGORA.getTime() - d * DIA).toISOString();

interface Linha {
  id: string;
  capturado_em: string;
  latitude: number;
  longitude: number;
  precisao_m: number | null;
  velocidade_ms: number | null;
  enviado_em: string | null;
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

/** SQLite falso: entende só os três comandos da rotina. */
function bancoFalso(linhas: Linha[], semTabela = false) {
  const rodar = vi.fn(async (sql: string, params: readonly unknown[] = []) => {
    if (semTabela) throw new Error('no such table: core__ponto_trajeto');
    if (/^DELETE FROM core__ponto_trajeto WHERE enviado_em IS NOT NULL AND enviado_em < \?/.test(sql)) {
      const limite = params[0] as string;
      const antes = linhas.length;
      for (let i = linhas.length - 1; i >= 0; i--) {
        const e = linhas[i]!.enviado_em;
        if (e !== null && e < limite) linhas.splice(i, 1);
      }
      return { alteradas: antes - linhas.length };
    }
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
      .map(({ enviado_em: _x, ...resto }) => resto);
  });
  return { db: { rodar, todas } as unknown as BancoDoTrajeto, rodar, todas };
}

const aceitar = async (itens: ItemPush[]): Promise<ResultadoItemPush[]> =>
  itens.map((i) => ({ id: i.id, status: 'aceito' as const }));

function montar(linhas: Linha[], push: (i: ItemPush[]) => Promise<ResultadoItemPush[]> = aceitar, semTabela = false) {
  const b = bancoFalso(linhas, semTabela);
  const p = vi.fn(push);
  const registrar = vi.fn();
  return { ...b, push: p, registrar, dep: { db: b.db, push: p, agora: () => AGORA, registrar } };
}

describe('enviarPontosDoTrajeto (RN-CORE-13: o ponto capturado dentro do portão chega ao servidor)', () => {
  it('RN-CORE-13: ponto aceito é enviado como ponto_trajeto e marcado com enviado_em', async () => {
    const linhas = [ponto(2), ponto(1)];
    const m = montar(linhas);
    const r = await enviarPontosDoTrajeto(m.dep);
    expect(r).toEqual({ enviados: 2, rejeitados: 0, invalidos: 0, podados: 0, erro: false });
    const itens = m.push.mock.calls[0]![0];
    expect(itens.map((i) => i.id)).toEqual([U(1), U(2)]);
    expect(itens[0]).toMatchObject({ entidade: ENTIDADE_PONTO_TRAJETO, operacao: 'upsert' });
    expect(linhas.every((l) => l.enviado_em === AGORA.toISOString())).toBe(true);
  });

  it('RN-CORE-13: ponto que o servidor já tinha (conflito pelo id) é marcado e não se repete', async () => {
    const linhas = [ponto(1)];
    const m = montar(linhas, async (i) => i.map((x) => ({ id: x.id, status: 'conflito' as const, mensagem: 'já existe' })));
    const r = await enviarPontosDoTrajeto(m.dep);
    expect(r).toMatchObject({ enviados: 1, rejeitados: 0, erro: false });
    expect(linhas[0]!.enviado_em).not.toBeNull();
    await enviarPontosDoTrajeto(m.dep);
    expect(m.push).toHaveBeenCalledTimes(1);
  });

  it('RN-CORE-13: ponto rejeitado é marcado e contado, sem ficar em laço', async () => {
    const linhas = [ponto(1), ponto(2)];
    const m = montar(linhas, async (i) =>
      i.map((x) =>
        x.id === U(1)
          ? { id: x.id, status: 'rejeitado' as const, codigo: 'PAYLOAD_INVALIDO', mensagem: 'não aceito' }
          : { id: x.id, status: 'aceito' as const },
      ),
    );
    const r = await enviarPontosDoTrajeto(m.dep);
    expect(r).toMatchObject({ enviados: 1, rejeitados: 1, erro: false });
    expect(linhas.every((l) => l.enviado_em !== null)).toBe(true);
    expect(m.push).toHaveBeenCalledTimes(1);
  });

  it('RN-CORE-13: falha de transporte para, deixa pendentes, marca erro e não vaza coordenada', async () => {
    const linhas = [ponto(1), ponto(2)];
    const m = montar(linhas, async () => {
      throw new Error('sem rede em -3.1,-60.02');
    });
    const r = await enviarPontosDoTrajeto(m.dep);
    expect(r).toMatchObject({ enviados: 0, erro: true });
    expect(linhas.every((l) => l.enviado_em === null)).toBe(true);
    expect(m.push).toHaveBeenCalledTimes(1);
    const logado = JSON.stringify(m.registrar.mock.calls);
    expect(logado).not.toMatch(/-3\.1|-60\.02/);
  });

  it('RN-CORE-13: mais de 500 pendentes saem em várias chamadas de push com no máximo 500', async () => {
    const linhas = Array.from({ length: 1203 }, (_, i) => ponto(i + 1));
    const m = montar(linhas);
    const r = await enviarPontosDoTrajeto(m.dep);
    expect(r.enviados).toBe(1203);
    expect(m.push).toHaveBeenCalledTimes(3);
    expect(m.push.mock.calls.every((c) => c[0].length <= MAX_ITENS_PUSH)).toBe(true);
    expect(m.todas.mock.calls.every((c) => c[1]![0] === MAX_ITENS_PUSH)).toBe(true);
    expect(linhas.every((l) => l.enviado_em !== null)).toBe(true);
  });

  it('RN-CORE-13: ponto inválido no schema é marcado e não é enviado', async () => {
    const linhas = [ponto(1, { precisao_m: null }), ponto(2)];
    const m = montar(linhas);
    const r = await enviarPontosDoTrajeto(m.dep);
    expect(r).toMatchObject({ enviados: 1, invalidos: 1, erro: false });
    expect(m.push.mock.calls[0]![0]).toHaveLength(1);
    expect(linhas[0]!.enviado_em).not.toBeNull();
  });

  it('RN-CORE-13: poda apaga o enviado há mais de 90 dias e mantém o de 89 dias e o pendente', async () => {
    const linhas = [
      ponto(1, { enviado_em: haDias(91) }),
      ponto(2, { enviado_em: haDias(89) }),
      ponto(3),
    ];
    const m = montar(linhas);
    const r = await enviarPontosDoTrajeto(m.dep);
    expect(r.podados).toBe(1);
    expect(linhas.map((l) => l.id)).toEqual([U(2), U(3)]);
  });

  it('RN-CORE-13: a poda roda mesmo com falha de transporte', async () => {
    const linhas = [ponto(1, { enviado_em: haDias(120) }), ponto(2)];
    const m = montar(linhas, async () => {
      throw new Error('sem rede');
    });
    const r = await enviarPontosDoTrajeto(m.dep);
    expect(r).toMatchObject({ erro: true, podados: 1 });
    expect(linhas).toHaveLength(1);
  });

  it('RN-CORE-13: sem a tabela, não faz nada e não lança', async () => {
    const m = montar([], aceitar, true);
    const r = await enviarPontosDoTrajeto(m.dep);
    expect(r).toEqual({ enviados: 0, rejeitados: 0, invalidos: 0, podados: 0, erro: false });
    expect(m.push).not.toHaveBeenCalled();
    expect(m.registrar).not.toHaveBeenCalled();
  });

  it('RN-CORE-13: erro do banco que não seja tabela ausente também não lança', async () => {
    const m = montar([ponto(1)]);
    m.todas.mockRejectedValueOnce(new Error('disk I/O error'));
    const r = await enviarPontosDoTrajeto(m.dep);
    expect(r.erro).toBe(true);
  });

  it('RN-CORE-13: o payload tem só os campos do PontoTrajetoSchema', async () => {
    const m = montar([ponto(1, { velocidade_ms: 3.5 })]);
    await enviarPontosDoTrajeto(m.dep);
    const payload = m.push.mock.calls[0]![0][0]!.payload as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['capturado_em', 'id', 'latitude', 'longitude', 'precisao_m', 'velocidade_ms']);
    expect(PontoTrajetoSchema.safeParse(payload).success).toBe(true);
  });
});
