/**
 * R-20261115-100000 (aprovada em R-20261115-104500): toque do Sincronizar = parcial (fila + pedidos e clientes); segurar 10 s
 * = completa (fila + módulos + tudo), com o popup que fecha sozinho, mostra o erro com "Tentar de novo" e "Fechar" e deixa a
 * tela acesa só enquanto roda. Uma sincronização por vez.
 */
import { describe, expect, it, vi } from 'vitest';

import type { EtapaEntrada } from '@macuxi/core/contracts';

import {
  completaVisivel,
  criarPopupCompleta,
  decidirPedidoSync,
  desenhoPopupCompleta,
  entradaDoProgressoCompleta,
  pedidoDoAgendador,
  rodarSync,
  telaAcesaNaCompleta,
  type FaseCompleta,
  type MotorDoSync,
} from './sync-completa';
import { ESPERA_PRONTO_MS } from './entrada';

function motorFalso(ok = true) {
  const chamadas: string[] = [];
  const m: MotorDoSync = {
    enviar: vi.fn(async (o?: { incluirFalhos?: boolean }) => {
      chamadas.push(`enviar${o?.incluirFalhos ? '+falhos' : ''}`);
      return [];
    }),
    sincronizar: vi.fn(async (o?: { modo?: 'parcial' | 'completa' }) => {
      chamadas.push(o?.modo ? `sincronizar:${o.modo}` : 'sincronizar');
      return ok;
    }),
    sincronizarNovidades: vi.fn(async (o?: { entidades?: readonly string[] }) => {
      chamadas.push(o?.entidades ? `novidades:${o.entidades.join(',')}` : 'novidades');
      return ok;
    }),
  };
  return { m, chamadas };
}

const modulosOk = () => Promise.resolve();

describe('parcial e completa no motor (R-20261115-100000)', () => {
  it('o `manual` do agendador (botão, puxar para baixo, selo) vira a parcial; os outros, a leve', () => {
    expect(pedidoDoAgendador('manual')).toEqual({ tipo: 'parcial' });
    expect(pedidoDoAgendador('periodico')).toEqual({ tipo: 'leve' });
    expect(pedidoDoAgendador('aviso', ['pedido'])).toEqual({ tipo: 'leve', entidades: ['pedido'] });
  });

  it('parcial (v1): envia a fila com os que falharam e chama o motor no modo parcial, sem módulos', async () => {
    const { m, chamadas } = motorFalso();
    const atualizarModulos = vi.fn(modulosOk);
    expect(await rodarSync({ tipo: 'parcial' }, m, { modo: 'v1', offline: false, atualizarModulos })).toBe(
      true,
    );
    expect(chamadas).toEqual(['enviar+falhos', 'sincronizar:parcial']);
    expect(atualizarModulos).not.toHaveBeenCalled();
    expect(m.sincronizarNovidades).not.toHaveBeenCalled();
  });

  it('completa: envio com os falhos, módulos efetivos e o motor no modo completa (tudo do zero)', async () => {
    const { m, chamadas } = motorFalso();
    const atualizarModulos = vi.fn(async () => {
      chamadas.push('modulos');
    });
    expect(await rodarSync({ tipo: 'completa' }, m, { modo: 'v1', offline: false, atualizarModulos })).toBe(
      true,
    );
    expect(chamadas).toEqual(['enviar+falhos', 'modulos', 'sincronizar:completa']);
  });

  it('completa sem rede nos módulos: segue para o sincronizar (o motor registra o erro)', async () => {
    const { m, chamadas } = motorFalso(false);
    const atualizarModulos = () => Promise.reject(new Error('sem rede'));
    expect(await rodarSync({ tipo: 'completa' }, m, { modo: 'v1', offline: false, atualizarModulos })).toBe(
      false,
    );
    expect(chamadas).toEqual(['enviar+falhos', 'sincronizar:completa']);
  });

  it('leve (automática e aviso): novidades, como antes', async () => {
    const { m, chamadas } = motorFalso();
    await rodarSync({ tipo: 'leve' }, m, { modo: 'v1', offline: false, atualizarModulos: modulosOk });
    await rodarSync({ tipo: 'leve', entidades: ['pedido'] }, m, {
      modo: 'v1',
      offline: false,
      atualizarModulos: modulosOk,
    });
    expect(chamadas).toEqual(['novidades', 'novidades:pedido']);
  });

  it('demonstração: a parcial continua sendo a completa de antes (a Fase M não tem novidades)', async () => {
    const { m, chamadas } = motorFalso();
    await rodarSync({ tipo: 'parcial' }, m, { modo: 'demo', offline: false, atualizarModulos: modulosOk });
    expect(chamadas).toEqual(['enviar+falhos', 'sincronizar']);
  });

  it('modo sem sinal: só o sincronizar (o motor registra a falta de sinal), como antes', async () => {
    const { m, chamadas } = motorFalso(false);
    await rodarSync({ tipo: 'parcial' }, m, { modo: 'v1', offline: true, atualizarModulos: modulosOk });
    await rodarSync({ tipo: 'completa' }, m, { modo: 'v1', offline: true, atualizarModulos: modulosOk });
    expect(chamadas).toEqual(['sincronizar', 'sincronizar']);
  });
});

describe('uma sincronização por vez', () => {
  it('sem nada em curso, roda', () => {
    expect(decidirPedidoSync('parcial', null)).toBe('rodar');
    expect(decidirPedidoSync('completa', null)).toBe('rodar');
  });
  it('completa durante a parcial ou a leve: roda (não vira a parcial; espera a em curso)', () => {
    expect(decidirPedidoSync('completa', 'parcial')).toBe('rodar');
    expect(decidirPedidoSync('completa', 'leve')).toBe('rodar');
  });
  it('o resto junta-se à que está rodando (mesma promessa)', () => {
    expect(decidirPedidoSync('completa', 'completa')).toBe('juntar');
    expect(decidirPedidoSync('parcial', 'completa')).toBe('juntar');
    expect(decidirPedidoSync('parcial', 'parcial')).toBe('juntar');
    expect(decidirPedidoSync('leve', 'parcial')).toBe('juntar');
  });
  it('completa durante a parcial em curso: envio e módulos só depois de a parcial terminar (mesmo com falha)', async () => {
    const { m, chamadas } = motorFalso();
    const atualizarModulos = vi.fn(async () => {
      chamadas.push('modulos');
    });
    let terminar!: (ok: boolean) => void;
    const parcial = new Promise<boolean>((_r, rejeitar) => {
      terminar = () => {
        chamadas.push('fim-parcial');
        rejeitar(new Error('sem rede'));
      };
    });
    const completa = rodarSync({ tipo: 'completa' }, m, {
      modo: 'v1',
      offline: false,
      atualizarModulos,
      emCurso: parcial,
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(chamadas).toEqual([]);
    terminar(false);
    expect(await completa).toBe(true);
    expect(chamadas).toEqual(['fim-parcial', 'enviar+falhos', 'modulos', 'sincronizar:completa']);
  });
});

// ---------- popup ----------

function relogio() {
  const tarefas: { fn: () => void; ms: number; id: number }[] = [];
  let n = 0;
  return {
    definirTempo: (fn: () => void, ms: number) => {
      tarefas.push({ fn, ms, id: ++n });
      return n;
    },
    limparTempo: (id: unknown) => {
      const i = tarefas.findIndex((t) => t.id === id);
      if (i >= 0) tarefas.splice(i, 1);
    },
    avancar() {
      const t = tarefas.shift();
      t?.fn();
      return t?.ms;
    },
    pendentes: () => tarefas.length,
  };
}

function popupCom(resultados: boolean[]) {
  const fases: FaseCompleta[] = [];
  const r = relogio();
  let resolver: ((ok: boolean) => void) | null = null;
  const executar = vi.fn(
    () =>
      new Promise<boolean>((res) => {
        resolver = res;
      }),
  );
  const p = criarPopupCompleta({ executar, aoMudar: (f) => fases.push(f), ...r });
  const terminar = async () => {
    resolver?.(resultados.shift() ?? true);
    await Promise.resolve();
    await Promise.resolve();
  };
  return { p, fases, r, executar, terminar };
}

describe('popup da completa', () => {
  it('abre rodando, mostra "Pronto" e fecha sozinho depois de ESPERA_PRONTO_MS (600 ms)', async () => {
    const { p, fases, r, executar, terminar } = popupCom([true]);
    p.abrir();
    expect(p.fase()).toBe('rodando');
    expect(executar).toHaveBeenCalledTimes(1);
    // segurar de novo com o popup aberto não roda outra
    p.abrir();
    expect(executar).toHaveBeenCalledTimes(1);
    await terminar();
    expect(p.fase()).toBe('pronto');
    expect(r.avancar()).toBe(ESPERA_PRONTO_MS);
    expect(ESPERA_PRONTO_MS).toBe(600);
    expect(p.fase()).toBe('fechado');
    expect(fases).toEqual(['rodando', 'pronto', 'fechado']);
  });

  it('rodando: Fechar e Voltar não fecham', () => {
    const { p } = popupCom([true]);
    p.abrir();
    p.fechar();
    expect(p.fase()).toBe('rodando');
  });

  it('com erro: "Tentar de novo" refaz a completa; "Fechar" (e o Voltar) fecha', async () => {
    const { p, executar, terminar } = popupCom([false, false]);
    p.abrir();
    await terminar();
    expect(p.fase()).toBe('erro');
    p.tentarDeNovo();
    expect(p.fase()).toBe('rodando');
    expect(executar).toHaveBeenCalledTimes(2);
    await terminar();
    expect(p.fase()).toBe('erro');
    p.fechar();
    expect(p.fase()).toBe('fechado');
  });

  it('a promessa que rejeita também vira erro', async () => {
    const p = criarPopupCompleta({
      executar: () => Promise.reject(new Error('x')),
      aoMudar: () => undefined,
    });
    p.abrir();
    await Promise.resolve();
    await Promise.resolve();
    expect(p.fase()).toBe('erro');
  });

  it('desligado (troca de usuário): o resultado atrasado não muda nada', async () => {
    const { p, fases, terminar } = popupCom([true]);
    p.abrir();
    p.desligar();
    await terminar();
    expect(fases).toEqual(['rodando']);
  });

  it('tela acesa só enquanto roda; botão ocupado em toda fase aberta', () => {
    expect(telaAcesaNaCompleta('rodando')).toBe(true);
    for (const f of ['fechado', 'pronto', 'erro'] as const) expect(telaAcesaNaCompleta(f)).toBe(false);
    expect(completaVisivel('fechado')).toBe(false);
    for (const f of ['rodando', 'pronto', 'erro'] as const) expect(completaVisivel(f)).toBe(true);
  });
});

describe('desenho do popup', () => {
  const etapa = (numero: number, nome: string): EtapaEntrada => ({
    id: 'catalogo_precos',
    numero,
    nome,
    situacao: 'atual',
  });
  const prog = (o: Partial<{ pronta: boolean; percentual: number; parou: boolean }> = {}) => ({
    atual: etapa(3, 'Catálogo e preços'),
    total: 5,
    pronta: o.pronta ?? false,
    percentual: o.percentual ?? 42,
    parou_em: o.parou ? etapa(3, 'Catálogo e preços') : null,
  });

  it('rodando: Voltar bloqueado, sem botões, "Etapa n de N · nome" e o percentual', () => {
    expect(desenhoPopupCompleta('rodando', prog(), false)).toEqual({
      visivel: true,
      bloqueado: true,
      barra: { rotulo: 'Etapa 3 de 5 · Catálogo e preços', pct: 42 },
      erro: null,
      botoes: false,
    });
  });

  it('pronto: "Pronto" e 100%', () => {
    expect(desenhoPopupCompleta('pronto', prog({ pronta: true, percentual: 100 }), false).barra).toEqual({
      rotulo: 'Pronto',
      pct: 100,
    });
  });

  it('erro: a linha da carga, botões e o Voltar fecha', () => {
    const d = desenhoPopupCompleta('erro', prog({ parou: true }), false);
    expect(d).toMatchObject({
      visivel: true,
      bloqueado: false,
      barra: null,
      erro: 'Parou na etapa 3 de 5',
      botoes: true,
    });
    expect(desenhoPopupCompleta('erro', prog({ parou: true }), true).erro).toBe(
      'Sem internet na etapa 3 de 5',
    );
  });

  it('fechado: invisível', () => {
    expect(desenhoPopupCompleta('fechado', prog(), false).visivel).toBe(false);
  });

  it('progresso: só conta com o motor sincronizando; pronto = 1; erro leva a mensagem do motor', () => {
    expect(entradaDoProgressoCompleta('rodando', { sincronizando: false, erro: null }, 99).progresso).toBe(0);
    expect(entradaDoProgressoCompleta('rodando', { sincronizando: true, erro: null }, 40)).toEqual({
      progresso: 0.4,
      sincronizando: true,
      erro: null,
      sincronizado: false,
    });
    expect(entradaDoProgressoCompleta('pronto', { sincronizando: false, erro: null }, 0)).toMatchObject({
      progresso: 1,
      sincronizado: true,
    });
    expect(entradaDoProgressoCompleta('erro', { sincronizando: false, erro: 'Sem sinal' }, 0)).toMatchObject({
      erro: 'Sem sinal',
      sincronizando: false,
    });
  });
});
