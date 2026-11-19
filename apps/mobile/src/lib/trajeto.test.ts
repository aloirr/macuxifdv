/**
 * T-0156 (docs/desenho/tracking.md §3 e §9; RN-CORE-13 e RN-CORE-37): regras do shell para a tarefa `macuxi-trajeto`.
 * A condição de negócio é o `podeRastrear` do Core (§3.2); aqui só o que o shell faz com ela.
 */
import { PARAMETROS_RASTREAMENTO_PADRAO, PontoTrajetoSchema } from '@macuxi/core/contracts';
import { describe, expect, it } from 'vitest';

import {
  acaoDoTrajeto,
  erroSemCoordenada,
  frequenciaDasLinhas,
  mesmosIntervalos,
  opcoesDoTrajeto,
  pontoDaLeitura,
  pontosDoLote,
  TAREFA_TRAJETO,
} from './trajeto';

const ID = '0b9a4c1e-7f3d-4a2b-9c8d-1e2f3a4b5c6d';

describe('tarefa macuxi-trajeto: captura (§3.1)', () => {
  it('nome da tarefa, parâmetros e notificação fixa sem ação', () => {
    expect(TAREFA_TRAJETO).toBe('macuxi-trajeto');
    const opcoes = opcoesDoTrajeto();
    expect(opcoes).toMatchObject({ accuracy: 4, distanceInterval: 200, timeInterval: 300_000, deferredUpdatesInterval: 300_000 });
    expect(opcoes.foregroundService.killServiceOnDestroy).toBe(false);
  });

  it('rastreamento interno (dono do produto, 19/11): a notificação fixa só diz "Macuxi Campo ativo", sem corpo e sem citar localização', () => {
    const { notificationTitle, notificationBody } = opcoesDoTrajeto().foregroundService;
    expect(notificationTitle).toBe('Macuxi Campo ativo');
    expect(notificationBody).toBe('');
    expect(`${notificationTitle} ${notificationBody}`).not.toMatch(/locali|trajeto|rastre|gps|expediente/i);
  });

  it('§3.1 e §3.3: a captura segue a frequência do parâmetro do BKO (metros e minutos)', () => {
    expect(opcoesDoTrajeto({ distancia_m: 100, intervalo_min: 2, lote_min: 10 })).toMatchObject({ distanceInterval: 100, timeInterval: 120_000, deferredUpdatesInterval: 600_000 });
    expect(opcoesDoTrajeto(PARAMETROS_RASTREAMENTO_PADRAO.frequencia)).toEqual(opcoesDoTrajeto());
  });

  it('frequência das linhas do pull parametro: a do core/rastreamento; ausente, removida, de outro módulo ou inválida, a do padrão', () => {
    const valor = { ...PARAMETROS_RASTREAMENTO_PADRAO, ativo: true, frequencia: { distancia_m: 500, intervalo_min: 10, lote_min: 15 } };
    const linha = { modulo: 'core', chave: 'rastreamento', valor, deleted_at: null };
    const padrao = PARAMETROS_RASTREAMENTO_PADRAO.frequencia;
    expect(frequenciaDasLinhas([{ modulo: 'core', chave: 'checkin.raio_m', valor: 150 }, linha])).toEqual({ distancia_m: 500, intervalo_min: 10, lote_min: 15 });
    expect(frequenciaDasLinhas([])).toEqual(padrao);
    expect(frequenciaDasLinhas([{ ...linha, deleted_at: '2026-11-19T12:00:00.000Z' }])).toEqual(padrao);
    expect(frequenciaDasLinhas([{ ...linha, modulo: 'vendedor' }])).toEqual(padrao);
    expect(frequenciaDasLinhas([{ ...linha, valor: { ...valor, frequencia: { distancia_m: 10, intervalo_min: 5, lote_min: 5 } } }])).toEqual(padrao);
  });

  it('mesmos intervalos: compara distância e intervalos; sem o que comparar, não', () => {
    const o = opcoesDoTrajeto();
    expect(mesmosIntervalos(o, { distanceInterval: 200, timeInterval: 300_000, deferredUpdatesInterval: 300_000 })).toBe(true);
    expect(mesmosIntervalos(o, { distanceInterval: 100, timeInterval: 300_000, deferredUpdatesInterval: 300_000 })).toBe(false);
    expect(mesmosIntervalos(o, {})).toBe(false);
    expect(mesmosIntervalos(o, null)).toBe(false);
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

  it('reinicia se pode, está ativa e a frequência mudou; parada ou sem poder, a frequência não conta', () => {
    expect(acaoDoTrajeto({ pode: true }, true, true)).toBe('reiniciar');
    expect(acaoDoTrajeto({ pode: true }, false, true)).toBe('ligar');
    expect(acaoDoTrajeto({ pode: false, motivo: 'ausencia' }, true, true)).toBe('desligar');
    expect(acaoDoTrajeto({ pode: false, motivo: 'ausencia' }, false, true)).toBe('manter');
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
