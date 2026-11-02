import { describe, expect, it } from 'vitest';
import { criarRelogio } from '@macuxi/comum/relogio';
import { criarArmazenamentoEmMemoria, ErroHttp, ErroSemConexao, type ClienteHttp } from '@macuxi/platform-sdk';
import { ROTAS_GESTOR } from '../../contracts';
import { atualizarCache, criarCache, DADOS_VAZIOS, mensagemDeErro } from './cache';

const relogio = criarRelogio({ agora: '2026-11-03T15:00:00Z' });
const agora = relogio.iso();
const resumo = { gestor_id: '00000000-0000-4000-8000-000000000300', membros: 0, sem_checkin: 0, em_rota: 0, em_visita: 0, vendas_cents: null, pedidos: null, meta_cents: null, atingimento_pct: null, visitas_realizadas: 0, visitas_planejadas: 0, visitas_planejadas_realizadas: 0, visitas_extras: null, cobertura_pct: null, vendido_cents: null, faturado_cents: null, a_faturar_cents: null };
const RESPOSTAS: Record<string, unknown> = {
  [ROTAS_GESTOR.equipe]: { data: relogio.hoje(), resumo, equipes: [], membros: [], calculado_em: agora },
  [ROTAS_GESTOR.aprovacoes]: { itens: [], resumo: { total: 0, vencidos: 0, vencendo: 0, para_mim: 0 }, calculado_em: agora },
  [ROTAS_GESTOR.alertas]: { itens: [], calculado_em: agora },
};
const http = (f: (caminho: string) => unknown): ClienteHttp => ({
  get: async <T,>(c: string) => f(c) as T,
  requisitar: async () => {
    throw new Error('não usado');
  },
});
const novoCache = () => criarCache(criarArmazenamentoEmMemoria());

describe('cache offline do Gestor (offline-first, RN-CORE-02)', () => {
  it('com sinal: grava visão, fila e alertas validados no contrato e o carimbo da sincronização', async () => {
    const cache = novoCache();
    const r = await atualizarCache(http((c) => RESPOSTAS[c]), cache, () => relogio.agora());
    expect(r).toEqual({ atualizados: ['visao', 'fila', 'alertas'], semConexao: false, erro: null });
    const d = await cache.carregar();
    expect(d.visao?.data).toBe(relogio.hoje());
    expect(d.sincronizado_em).toBe(agora);
  });

  it('sem sinal: nada muda no aparelho e a tela segue com o que tinha', async () => {
    const cache = novoCache();
    await atualizarCache(http((c) => RESPOSTAS[c]), cache, () => relogio.agora());
    const antes = await cache.carregar();
    const r = await atualizarCache(
      http(() => {
        throw new ErroSemConexao();
      }),
      cache,
      () => relogio.relativo({ horas: 1 }),
    );
    expect(r).toMatchObject({ semConexao: true, atualizados: [] });
    expect(await cache.carregar()).toEqual(antes);
  });

  it('resposta fora do contrato ou erro da API não sobrescreve o cache; a mensagem é em português', async () => {
    const cache = novoCache();
    const r = await atualizarCache(
      http((c) => {
        if (c === ROTAS_GESTOR.equipe) return { lixo: true };
        if (c === ROTAS_GESTOR.alertas) throw new ErroHttp(403, 'MODULO_INATIVO', 'x');
        return RESPOSTAS[c];
      }),
      cache,
      () => relogio.agora(),
    );
    expect(r.atualizados).toEqual(['fila']);
    expect(r.erro).toMatch(/formato inesperado/);
    expect((await cache.carregar()).visao).toBeNull();
    expect(mensagemDeErro(new ErroHttp(403, 'MODULO_INATIVO', 'x'))).toMatch(/não está ativo/);
    expect(mensagemDeErro(new ErroHttp(503, 'X', 'x'))).toMatch(/guardados/);
  });

  it('cache vazio devolve os padrões', async () => {
    expect(await novoCache().carregar()).toEqual(DADOS_VAZIOS);
  });
});
