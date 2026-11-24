/**
 * v1.0.34 (R-20261124-093521, AM2808: "tirei a foto e a linha continua Falta"): a volta da câmera não perde a foto quando o
 * Android destrói a atividade com a câmera aberta (resultado no `getPendingResultAsync`) e diz por que não há foto.
 */
import { describe, expect, it } from 'vitest';

import { esperarRetornoSeletor, ESPERA_PENDENTE_MS, LIMITE_SEM_RETORNO_MS, lerRetornoSeletor, type RetornoSeletor } from './retorno-camera';

const FOTO = { uri: 'file:///cache/camera.jpg', width: 1200, height: 1600 };
const COM_FOTO: RetornoSeletor = { canceled: false, assets: [FOTO] };

/** Portas falsas: `voltar()` dispara a volta do app; `esperas` guarda as esperas pedidas; o pendente vem da fila. */
function portas(pendentes: RetornoSeletor[] = []) {
  let ouvinte: (() => void) | null = null;
  const esperas: number[] = [];
  const estado = { desfeito: false, perguntas: 0 };
  return {
    estado,
    esperas,
    voltar: () => ouvinte?.(),
    p: {
      pendente: async () => {
        estado.perguntas += 1;
        return pendentes.shift() ?? null;
      },
      aoVoltar: (fn: () => void) => {
        ouvinte = fn;
        return () => {
          estado.desfeito = true;
          ouvinte = null;
        };
      },
      esperar: async (ms: number) => {
        esperas.push(ms);
      },
    },
  };
}

const nunca = () => new Promise<RetornoSeletor>(() => undefined);
const tique = () => new Promise((ok) => setTimeout(ok, 0));

describe('lerRetornoSeletor', () => {
  it('foto, cancelada, erro do pendente e nada voltou', () => {
    expect(lerRetornoSeletor(COM_FOTO)).toEqual({ tipo: 'foto', foto: FOTO });
    expect(lerRetornoSeletor({ canceled: true })).toEqual({ tipo: 'cancelada' });
    expect(lerRetornoSeletor({ canceled: false, assets: [] })).toEqual({ tipo: 'cancelada' });
    expect(lerRetornoSeletor({ code: 'ERR_CAMERA', message: 'falhou' })).toEqual({ tipo: 'erro' });
    expect(lerRetornoSeletor(null)).toEqual({ tipo: 'cancelada' });
    expect(lerRetornoSeletor(undefined)).toEqual({ tipo: 'cancelada' });
  });
});

describe('esperarRetornoSeletor', () => {
  it('retorno normal: vale a promessa do seletor e a assinatura da volta é desfeita', async () => {
    const t = portas();
    expect(await esperarRetornoSeletor(async () => COM_FOTO, t.p)).toEqual(COM_FOTO);
    expect(t.estado).toEqual({ desfeito: true, perguntas: 0 });
  });

  it('atividade destruída com a câmera aberta: a promessa nunca volta e a foto vem do pendente na volta do app', async () => {
    const t = portas([COM_FOTO]);
    const r = esperarRetornoSeletor(nunca, t.p);
    t.voltar();
    expect(await r).toEqual(COM_FOTO);
    expect(t.esperas).toEqual([ESPERA_PENDENTE_MS]);
    expect(t.estado.desfeito).toBe(true);
  });

  it('pendente vazio na volta: segue esperando a promessa, que ainda vale', async () => {
    const t = portas();
    let entregar: (r: RetornoSeletor) => void = () => undefined;
    // o limite não chega neste caso: a promessa volta antes
    const esperar = (ms: number) => (ms === LIMITE_SEM_RETORNO_MS ? new Promise<void>(() => undefined) : Promise.resolve());
    const r = esperarRetornoSeletor(() => new Promise((ok) => (entregar = ok)), { ...t.p, esperar });
    t.voltar();
    await tique();
    entregar(COM_FOTO);
    expect(await r).toEqual(COM_FOTO);
    expect(t.estado.perguntas).toBe(1);
  });

  it('sem retorno nem pendente até o limite: termina sem foto (a folha não fica presa)', async () => {
    const t = portas();
    const r = esperarRetornoSeletor(nunca, t.p);
    t.voltar();
    expect(lerRetornoSeletor(await r)).toEqual({ tipo: 'cancelada' });
    expect(t.esperas).toEqual([ESPERA_PENDENTE_MS, LIMITE_SEM_RETORNO_MS]);
    expect(t.estado.perguntas).toBe(2);
  });

  it('promessa rejeitada: vale o pendente; pendente que falha conta como nada pendente', async () => {
    const t = portas([COM_FOTO]);
    expect(await esperarRetornoSeletor(() => Promise.reject(new Error('atividade destruída')), t.p)).toEqual(COM_FOTO);
    const falha = portas();
    expect(await esperarRetornoSeletor(() => Promise.reject(new Error('x')), { ...falha.p, pendente: () => Promise.reject(new Error('y')) })).toBeNull();
  });

  it('erro guardado no pendente volta como erro', async () => {
    const t = portas([{ code: 'ERR_CAMERA', message: 'falhou' }]);
    const r = esperarRetornoSeletor(nunca, t.p);
    t.voltar();
    expect(lerRetornoSeletor(await r)).toEqual({ tipo: 'erro' });
  });
});
