/**
 * RD-0088: visor de foto comum do shell — o pedido do módulo (arquivo da plataforma OU endereço já resolvido), a ida e a
 * volta da rota, o estado sem sinal ("Sem sinal para abrir a foto.") e a matemática do zoom (pinça, arraste, toque duplo).
 */
import { describe, expect, it } from 'vitest';

import { TEXTO_SEM_SINAL_FOTO } from './foto-pdv';
import {
  distancia,
  ehToqueDuplo,
  escalaDaPinca,
  escalaDoToqueDuplo,
  ESCALA_MAX,
  ESCALA_TOQUE_DUPLO,
  estadoDoEndereco,
  limitarDeslocamento,
  limitarEscala,
  MAX_TAMANHO_URI,
  pedidoDoVisor,
  ROTA_VISOR_FOTO,
  rotaDoVisor,
  TOQUE_DUPLO_MS,
  uriAceita,
} from './visor-foto';

const ID = '0b9f6c3e-6a7d-4c1e-9f0a-2b3c4d5e6f70';

describe('rota do visor', () => {
  it('foto do PDV (arquivo): ida e volta com título e subtítulo; o id vai em minúsculas', () => {
    const rota = rotaDoVisor({ arquivo_id: ID.toUpperCase(), titulo: 'Atacadinho Cachoeirinha', subtitulo: 'Fachada · 08/11/2026' });
    expect(rota.pathname).toBe(ROTA_VISOR_FOTO);
    expect(pedidoDoVisor(rota.params)).toEqual({ arquivo_id: ID, titulo: 'Atacadinho Cachoeirinha', subtitulo: 'Fachada · 08/11/2026' });
  });

  it('foto do produto (endereço do cache): ida e volta sem mexer no endereço', () => {
    const uri = 'file:///data/user/0/br.com.macuxi.campo/cache/miniaturas/abc-v2.jpg';
    const rota = rotaDoVisor({ uri, titulo: 'Filtro de óleo PSL 55' });
    expect(rota.params).toEqual({ uri, titulo: 'Filtro de óleo PSL 55' });
    expect(pedidoDoVisor(rota.params)).toEqual({ uri, titulo: 'Filtro de óleo PSL 55' });
  });

  it('fonte inválida: a porta recusa e a rota não abre', () => {
    expect(() => rotaDoVisor({ arquivo_id: '../segredo' })).toThrow();
    expect(() => rotaDoVisor({ uri: 'javascript:alert(1)' })).toThrow();
    expect(() => rotaDoVisor({ uri: 'data:image/jpeg;base64,AAAA' })).toThrow();
    expect(pedidoDoVisor({ arquivo: '../segredo' })).toBeNull();
    expect(pedidoDoVisor({ uri: 'ftp://x/y.jpg' })).toBeNull();
    expect(pedidoDoVisor({})).toBeNull();
  });

  it('endereços aceitos: local e de rede; recusa espaços e o que passa do teto', () => {
    expect(uriAceita('file:///a.jpg')).toBe(true);
    expect(uriAceita('content://media/1')).toBe(true);
    expect(uriAceita('https://cdn.exemplo.com/a.jpg')).toBe(true);
    expect(uriAceita('file:///a b.jpg')).toBe(false);
    expect(uriAceita(`https://x/${'a'.repeat(MAX_TAMANHO_URI)}`)).toBe(false);
    expect(uriAceita('')).toBe(false);
  });
});

describe('estado do endereço', () => {
  it('local abre sem sinal; de rede sem sinal mostra a mensagem aprovada', () => {
    expect(estadoDoEndereco('file:///a.jpg', false)).toEqual({ tipo: 'ok', uri: 'file:///a.jpg' });
    expect(estadoDoEndereco('https://x/a.jpg', true)).toEqual({ tipo: 'ok', uri: 'https://x/a.jpg' });
    expect(estadoDoEndereco('https://x/a.jpg', false)).toEqual({ tipo: 'erro', mensagem: TEXTO_SEM_SINAL_FOTO });
    expect(TEXTO_SEM_SINAL_FOTO).toBe('Sem sinal para abrir a foto.');
  });
});

describe('zoom', () => {
  it('escala entre 1 e 4; valor estranho volta à foto inteira', () => {
    expect(limitarEscala(0.3)).toBe(1);
    expect(limitarEscala(9)).toBe(ESCALA_MAX);
    expect(limitarEscala(2.2)).toBe(2.2);
    expect(limitarEscala(Number.NaN)).toBe(1);
  });

  it('pinça: dedos se afastando o dobro dobram a escala, nos limites', () => {
    expect(distancia({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(escalaDaPinca(1, 100, 200)).toBe(2);
    expect(escalaDaPinca(2, 100, 50)).toBe(1);
    expect(escalaDaPinca(3, 100, 400)).toBe(ESCALA_MAX);
    expect(escalaDaPinca(1, 0, 50)).toBe(ESCALA_MAX); // distância inicial nula não divide por zero
  });

  it('arraste: a borda da foto não passa da borda da área; na foto inteira não há arraste', () => {
    const area = { largura: 400, altura: 600 };
    expect(limitarDeslocamento({ x: 500, y: -900 }, 2, area)).toEqual({ x: 200, y: -300 });
    expect(limitarDeslocamento({ x: 50, y: 20 }, 2, area)).toEqual({ x: 50, y: 20 });
    expect(limitarDeslocamento({ x: 50, y: 20 }, 1, area)).toEqual({ x: 0, y: 0 });
  });

  it('toque duplo: perto no tempo e no lugar; aproxima a inteira e volta a aproximada', () => {
    const a = { x: 100, y: 100, t: 1000 };
    expect(ehToqueDuplo(null, a)).toBe(false);
    expect(ehToqueDuplo(a, { x: 110, y: 105, t: 1000 + TOQUE_DUPLO_MS })).toBe(true);
    expect(ehToqueDuplo(a, { x: 110, y: 105, t: 1001 + TOQUE_DUPLO_MS })).toBe(false);
    expect(ehToqueDuplo(a, { x: 200, y: 100, t: 1100 })).toBe(false);
    expect(escalaDoToqueDuplo(1)).toBe(ESCALA_TOQUE_DUPLO);
    expect(escalaDoToqueDuplo(3)).toBe(1);
  });
});
