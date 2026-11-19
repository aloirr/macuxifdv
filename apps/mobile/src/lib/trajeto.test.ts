/**
 * T-0156 (docs/desenho/tracking.md §3 e §9; RN-CORE-13 e RN-CORE-37): regras do shell para a tarefa `macuxi-trajeto`.
 * A condição de negócio (`podeRastrear`, §3.2) é do Core e entra pronta; aqui só o que o shell faz com ela.
 */
import { MOTIVOS_SEM_RASTREIO, PontoTrajetoSchema } from '@macuxi/core/contracts';
import { describe, expect, it } from 'vitest';

import {
  acaoDoTrajeto,
  erroSemCoordenada,
  estadoDoTrajeto,
  OPCOES_TRAJETO,
  pontoDaLeitura,
  pontosDoLote,
  TAREFA_TRAJETO,
  TEXTOS_TRAJETO,
  textoDoEstadoDoTrajeto,
} from './trajeto';

const ID = '0b9a4c1e-7f3d-4a2b-9c8d-1e2f3a4b5c6d';

describe('tarefa macuxi-trajeto: captura (§3.1)', () => {
  it('nome da tarefa, parâmetros e notificação fixa sem ação', () => {
    expect(TAREFA_TRAJETO).toBe('macuxi-trajeto');
    expect(OPCOES_TRAJETO).toMatchObject({ distanceInterval: 200, timeInterval: 300_000, deferredUpdatesInterval: 300_000 });
    expect(OPCOES_TRAJETO.foregroundService.notificationTitle).toBe('Macuxi Campo — localização ativa no expediente');
    expect(OPCOES_TRAJETO.foregroundService.killServiceOnDestroy).toBe(false);
  });

  it('ponto só com os campos do §3.1: 6 casas, precisão e velocidade (nula se o aparelho não der)', () => {
    const p = pontoDaLeitura({ timestamp: Date.parse('2026-11-19T13:00:00.000Z'), coords: { latitude: -3.1190275, longitude: -60.0217314, accuracy: 12.4, speed: -1, altitude: 40, heading: 90 } }, () => ID);
    expect(p).toEqual({ id: ID, capturado_em: '2026-11-19T13:00:00.000Z', latitude: -3.119028, longitude: -60.021731, precisao_m: 12.4, velocidade_ms: null });
    expect(PontoTrajetoSchema.parse(p)).toEqual(p);
    expect(pontoDaLeitura({ timestamp: Date.parse('2026-11-19T13:00:00.000Z'), coords: { latitude: 1, longitude: 2, accuracy: 8, speed: 3.5 } }, () => ID)).toMatchObject({ precisao_m: 8, velocidade_ms: 3.5 });
  });

  it('o ponto passa pelo PontoTrajetoSchema do contrato: sem precisão, ou com id que não é UUID, fica de fora', () => {
    const agora = Date.parse('2026-11-19T13:00:00.000Z');
    expect(pontoDaLeitura({ timestamp: agora, coords: { latitude: 1, longitude: 2, accuracy: null } }, () => ID)).toBeNull();
    expect(pontoDaLeitura({ timestamp: agora, coords: { latitude: 1, longitude: 2, accuracy: -1 } }, () => ID)).toBeNull();
    expect(pontoDaLeitura({ timestamp: agora, coords: { latitude: 1, longitude: 2, accuracy: 5 } }, () => 'x')).toBeNull();
  });

  it('leitura inválida vira nada (coordenada fora da faixa ou instante ruim)', () => {
    expect(pontoDaLeitura({ timestamp: Number.NaN, coords: { latitude: 1, longitude: 2 } }, () => ID)).toBeNull();
    expect(pontoDaLeitura({ timestamp: 0, coords: { latitude: 91, longitude: 2 } }, () => ID)).toBeNull();
    expect(pontoDaLeitura({ timestamp: 0, coords: { latitude: 1, longitude: -181 } }, () => ID)).toBeNull();
  });
});

describe('ligar e desligar (§3.2)', () => {
  it('liga só se pode e ainda não está ativa; desliga se não pode mais; senão mantém', () => {
    expect(acaoDoTrajeto({ pode: true }, false)).toBe('ligar');
    expect(acaoDoTrajeto({ pode: true }, true)).toBe('manter');
    expect(acaoDoTrajeto({ pode: false, motivo: 'fora_do_expediente' }, true)).toBe('desligar');
    expect(acaoDoTrajeto({ pode: false, motivo: 'desligado' }, false)).toBe('manter');
  });

  it('lote: descarta o ponto que a condição recusa no instante dele (o lote do Android cruza o fim do expediente)', () => {
    const pontos = [
      { timestamp: Date.parse('2026-11-19T21:55:00.000Z'), coords: { latitude: -3.1, longitude: -60, accuracy: 10 } },
      { timestamp: Date.parse('2026-11-19T22:05:00.000Z'), coords: { latitude: -3.2, longitude: -60, accuracy: 10 } },
    ];
    const fim = Date.parse('2026-11-19T22:00:00.000Z');
    const r = pontosDoLote(pontos, (instante) => (instante < fim ? { pode: true } : { pode: false, motivo: 'fora_do_expediente' }), () => ID);
    expect(r.pontos.map((p) => p.capturado_em)).toEqual(['2026-11-19T21:55:00.000Z']);
    expect(r.parar).toBe(true);
  });

  it('lote todo dentro: não para', () => {
    const r = pontosDoLote([{ timestamp: 0, coords: { latitude: 0, longitude: 0, accuracy: 10 } }], () => ({ pode: true }), () => ID);
    expect(r).toMatchObject({ parar: false, pontos: [expect.objectContaining({ id: ID })] });
  });
});

describe('Diagnóstico sem coordenada (§9)', () => {
  it('estado pelo motivo, sem lugar nenhum', () => {
    expect(estadoDoTrajeto({ pode: true }, true)).toBe('ativa');
    expect(estadoDoTrajeto({ pode: false, motivo: 'fora_do_expediente' }, false)).toBe('fora_do_expediente');
    expect(estadoDoTrajeto({ pode: false, motivo: 'feriado' }, false)).toBe('fora_do_expediente');
    expect(estadoDoTrajeto({ pode: false, motivo: 'ausencia' }, false)).toBe('fora_do_expediente');
    expect(estadoDoTrajeto({ pode: false, motivo: 'pausa' }, false)).toBe('pausada');
    expect(estadoDoTrajeto({ pode: false, motivo: 'sem_aceite' }, false)).toBe('sem_termo');
    expect(estadoDoTrajeto({ pode: false, motivo: 'desligado' }, false)).toBe('desligada');
    // §2, condição 1: a empresa só ligou de fato com o termo publicado; sem ele, o tracking está desligado
    expect(estadoDoTrajeto({ pode: false, motivo: 'sem_termo' }, false)).toBe('desligada');
    expect(estadoDoTrajeto({ pode: false, motivo: 'app' }, false)).toBe('desligada');
    expect(estadoDoTrajeto({ pode: false, motivo: 'cargo' }, false)).toBe('desligada');
    expect(estadoDoTrajeto({ pode: false, motivo: 'sem_permissao' }, false)).toBe('desligada');
    expect(estadoDoTrajeto({ pode: true }, false)).toBe('desligada');
  });

  it('todo motivo do contrato (MOTIVOS_SEM_RASTREIO) tem um estado com texto', () => {
    for (const motivo of MOTIVOS_SEM_RASTREIO) expect(TEXTOS_TRAJETO[estadoDoTrajeto({ pode: false, motivo }, false)]).toEqual(expect.any(String));
  });

  it('texto do Diagnóstico: o estado e a hora do último ponto no fuso do tenant', () => {
    expect(textoDoEstadoDoTrajeto('ativa', '2026-11-19T13:05:00.000Z', 'America/Manaus')).toBe(`${TEXTOS_TRAJETO.ativa} · último ponto às 09:05`);
    expect(textoDoEstadoDoTrajeto('pausada', null, 'America/Manaus')).toBe(TEXTOS_TRAJETO.pausada);
  });

  it('erro da tarefa vai ao Diagnóstico sem coordenada', () => {
    const limpo = erroSemCoordenada(new Error('falha ao gravar ponto -3.119027,-60.021731 (precisão 12 m)'));
    expect(limpo.message).not.toMatch(/3\.119|60\.021/);
    expect(limpo.message).toContain('falha ao gravar ponto');
    expect(erroSemCoordenada('lat=-3.1190 lon=-60.0217').message).not.toMatch(/\d\.\d{3}/);
  });

  it('o que o suporte precisa fica: hora ISO, versão e pilha', () => {
    const e = new Error('ponto -3.119027 às 2026-11-19T13:05:00.000Z no app 1.0.15');
    e.stack = `Error: ${e.message}\n    at gravar (index.bundle:1234:56789)`;
    const limpo = erroSemCoordenada(e);
    expect(limpo.message).toBe('ponto ‹coord› às 2026-11-19T13:05:00.000Z no app 1.0.15');
    expect(limpo.stack).not.toContain('3.119027');
    expect(limpo.stack).toContain('index.bundle:1234:56789');
  });
});
