/**
 * T-0078: observabilidade mínima — contagem de respostas por janela (5xx), resumo da outbox e alertas simples, e
 * `GET /v1/saude` com as dependências (banco e outbox) sem segredo.
 */
import { SaudeRespostaSchema } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type { BancoApp } from '../src/banco';
import { nomesConsumidos } from '../src/despachante';
import { MODULOS_API } from '../src/modulos';
import { avaliarAlertas, criarMetricasApi, LIMITES_ALERTA_PADRAO, linhaDeMetricas } from '../src/observabilidade';
import { bancoFalso } from './apoio';

const T0 = Date.parse('2026-11-04T12:00:00.000Z');
const MIN = 60_000;

describe('criarMetricasApi (janela deslizante por minuto)', () => {
  it('conta requisições, 4xx e 5xx na janela e esquece o que saiu dela', () => {
    let agora = T0;
    const m = criarMetricasApi({ relogio: () => new Date(agora), janelaMin: 15 });
    for (const s of [200, 201, 404, 500, 503]) m.registrar(s);
    expect(m.janela()).toEqual({ janela_min: 15, requisicoes: 5, erros_4xx: 1, erros_5xx: 2 });
    agora += 10 * MIN;
    m.registrar(502);
    expect(m.janela().erros_5xx).toBe(3);
    agora += 6 * MIN; // o primeiro minuto saiu da janela de 15
    expect(m.janela()).toEqual({ janela_min: 15, requisicoes: 1, erros_4xx: 0, erros_5xx: 1 });
    expect(m.total()).toEqual({ desde: new Date(T0).toISOString(), requisicoes: 6, erros_5xx: 3 });
  });
});

describe('avaliarAlertas (alerta simples)', () => {
  const ok = { banco: 'ok' as const, outbox: { pendentes: 3, parados: 0, mais_antigo_s: 4 }, erros_5xx: 0 };
  it('tudo dentro do limite = sem alerta', () => {
    expect(avaliarAlertas(ok)).toEqual([]);
  });
  it('banco fora, 5xx acima do limite, outbox atrasada e evento parado viram códigos de alerta', () => {
    expect(avaliarAlertas({ ...ok, banco: 'falha' })).toEqual(['BANCO_FALHA']);
    expect(avaliarAlertas({ ...ok, erros_5xx: LIMITES_ALERTA_PADRAO.erros5xxJanela })).toEqual(['ERROS_5XX']);
    expect(avaliarAlertas({ ...ok, outbox: { pendentes: 40, parados: 0, mais_antigo_s: LIMITES_ALERTA_PADRAO.outboxAtrasoS + 1 } })).toEqual(['OUTBOX_ATRASADA']);
    expect(avaliarAlertas({ ...ok, outbox: { pendentes: 0, parados: 2, mais_antigo_s: null } })).toEqual(['OUTBOX_PARADA']);
  });
  it('sem banco configurado (testes, BKO local) ou sem o resumo da outbox: não alerta por isso', () => {
    expect(avaliarAlertas({ banco: 'ausente', outbox: null, erros_5xx: 0 })).toEqual([]);
  });
  it('linha de log das métricas: só números e códigos (sem tenant, usuário ou URL)', () => {
    const linha = linhaDeMetricas({ janela_min: 15, requisicoes: 9, erros_4xx: 1, erros_5xx: 0 }, { pendentes: 1, parados: 0, mais_antigo_s: 2 }, []);
    expect(linha).toEqual({ tipo: 'metricas', janela_min: 15, requisicoes: 9, erros_4xx: 1, erros_5xx: 0, outbox_pendentes: 1, outbox_parados: 0, outbox_mais_antigo_s: 2, alertas: [] });
  });
});

describe('GET /v1/saude com dependências (T-0078)', () => {
  it('sem banco: continua 200 e válido no contrato do app, com banco "ausente" e sem alerta', async () => {
    const r = await createApp({}).inject({ method: 'GET', url: '/v1/saude' });
    expect(r.statusCode).toBe(200);
    const corpo = SaudeRespostaSchema.parse(r.json());
    expect(corpo.servico).toBe('macuxi-api');
    expect(r.json()).toMatchObject({ dependencias: { banco: 'ausente', outbox: null }, alertas: [] });
    expect(r.json().metricas).toMatchObject({ janela_min: 15 });
  });

  it('banco ok e outbox resumida (só contagens); o resumo pede os eventos que têm consumidor', async () => {
    const { banco: base } = bancoFalso();
    const pedidos: unknown[] = [];
    const banco: BancoApp = {
      ...base,
      resumoOutbox: async (nomes, max) => {
        pedidos.push({ nomes, max });
        return { pendentes: 2, parados: 0, mais_antigo_s: 1 };
      },
    };
    const r = await createApp({ banco }).inject({ method: 'GET', url: '/v1/saude' });
    expect(r.statusCode).toBe(200);
    expect(r.json().dependencias).toEqual({ banco: 'ok', outbox: { pendentes: 2, parados: 0, mais_antigo_s: 1 } });
    expect(pedidos).toEqual([{ nomes: nomesConsumidos(MODULOS_API), max: 10 }]);
    expect(JSON.stringify(r.json())).not.toMatch(/senha|password|postgres:\/\//i);
  });

  it('banco fora: 200 (o app ainda identifica o servidor), banco "falha" e alerta BANCO_FALHA', async () => {
    const { banco: base } = bancoFalso();
    const banco: BancoApp = { ...base, instanteSync: async () => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.5:5432')) };
    const r = await createApp({ banco }).inject({ method: 'GET', url: '/v1/saude' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ dependencias: { banco: 'falha' }, alertas: ['BANCO_FALHA'] });
    expect(JSON.stringify(r.json())).not.toContain('10.0.0.5');
  });

  it('5xx entram na contagem da janela', async () => {
    const app = createApp({});
    app.get('/v1/teste-falha', async () => {
      throw new Error('boom');
    });
    expect((await app.inject({ method: 'GET', url: '/v1/teste-falha' })).statusCode).toBe(500);
    expect((await app.inject({ method: 'GET', url: '/v1/saude' })).json().metricas.erros_5xx).toBe(1);
  });
});
