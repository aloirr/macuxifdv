/**
 * R-20261115-125500-alexandre (ADR 0057 "Limite por usuário"): o motor informa o modo pedido pelo usuário ao servidor
 * (`transporte.pull(..., { modo })`, cabeçalho `x-macuxi-sync-modo` no HTTP) e trata a página `limitado` em silêncio:
 * nada muda no aparelho, nenhum erro, e a `completa` segurada não deixa ressincronização pendente.
 */
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { defineModule } from './manifesto';
import { criarMotorSync, type ModoSincronizacao } from './motor-sync';
import { FABRICAS_ARMAZENAMENTO } from './motor-sync.fabricas';
import { criarServidorSyncSimulado } from './sync-simulado';
import { criarRegistroSync, definirEntidadeSync, type DefinicaoEntidadeSync, type LinhaSync, type PaginaSync } from './sync';

const manifestos = [defineModule({ id: 'core', versao: '1.0.0', perfis: ['vendedor'], sync: ['cliente', 'visita'] })];
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const MIN = 60_000;
const T0 = Date.parse('2026-11-16T11:00:00Z');
const qualquer = z.object({}).passthrough();
const ent = (nome: string, extra: Partial<DefinicaoEntidadeSync> = {}) =>
  definirEntidadeSync({ nome, modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: qualquer, ...extra });

describe.each(FABRICAS_ARMAZENAMENTO)('limite silencioso da sincronização [%s] (R-20261115-125500-alexandre)', (_nome, fabrica) => {
  async function montar() {
    let agora = T0;
    const registro = criarRegistroSync(manifestos);
    registro.registrar(ent('cliente', { parcial: true }));
    registro.registrar(ent('visita'));
    const servidor = criarServidorSyncSimulado(registro, { modulosAtivos: ['core'], tamanhoPagina: 1 });
    servidor.relogio = () => new Date(agora);
    const linha = (n: number, quando: number) => ({ id: uuid(n), updated_at: new Date(quando).toISOString(), deleted_at: null });
    servidor.linhas = {
      cliente: [linha(1, T0 - 60 * MIN), linha(2, T0 - 59 * MIN)],
      visita: [linha(3, T0 - 50 * MIN)],
    };
    const chamadas: Array<{ entidade: string; cursor: string | null; modo: ModoSincronizacao | null; args: number }> = [];
    /** Entidades (e modo) a responder `limitado` na próxima chamada sem cursor ou com o cursor guardado. */
    const limitar = new Set<string>();
    const original = servidor.pull.bind(servidor);
    servidor.pull = async (...args: [string, string | null, { modo: ModoSincronizacao }?]): Promise<PaginaSync<LinhaSync>> => {
      const [entidade, cursor, opcoes] = args;
      const modo = opcoes?.modo ?? null;
      chamadas.push({ entidade, cursor, modo, args: args.length });
      if (modo && limitar.has(`${entidade}:${modo}`)) return { itens: [], proximo_cursor: null, limitado: true };
      return original(entidade, cursor);
    };
    const motor = criarMotorSync({ registro, armazenamento: fabrica(), transporte: servidor, agora: () => new Date(agora) });
    await motor.carregar();
    await motor.aplicarModulosAtivos(['core']);
    const ids = async (e: string) => (await motor.linhas(e)).map((l) => l.id).sort();
    const zerar = () => (chamadas.length = 0);
    return { motor, servidor, linha, chamadas, limitar, ids, zerar, avancar: (ms: number) => (agora += ms) };
  }

  it('automática não manda modo (mesma chamada de antes); parcial manda `parcial` em todas as páginas', async () => {
    const t = await montar();
    expect(await t.motor.sincronizar()).toBe(true);
    expect(t.chamadas.every((c) => c.modo === null && c.args === 2)).toBe(true);
    t.servidor.linhas.cliente!.push(t.linha(4, T0 - MIN), t.linha(5, T0 - MIN + 1));
    t.zerar();
    expect(await t.motor.sincronizar({ modo: 'parcial' })).toBe(true);
    expect(t.chamadas.length).toBeGreaterThan(1);
    expect(t.chamadas.every((c) => c.entidade === 'cliente' && c.modo === 'parcial')).toBe(true);
    t.zerar();
    await t.motor.sincronizarNovidades();
    expect(t.chamadas.every((c) => c.modo === null)).toBe(true);
  });

  it('completa manda `completa` (primeira página com cursor nulo, seguintes com o cursor da passada)', async () => {
    const t = await montar();
    await t.motor.sincronizar();
    t.zerar();
    expect(await t.motor.sincronizar({ modo: 'completa' })).toBe(true);
    const cliente = t.chamadas.filter((c) => c.entidade === 'cliente');
    expect(cliente.map((c) => c.modo)).toEqual(['completa', 'completa']);
    expect(cliente[0]!.cursor).toBeNull();
    expect(cliente[1]!.cursor).not.toBeNull();
  });

  it('parcial limitada: sem erro, nada muda no aparelho e a próxima continua do mesmo cursor', async () => {
    const t = await montar();
    await t.motor.sincronizar();
    t.servidor.linhas.cliente!.push(t.linha(4, T0 - MIN));
    t.limitar.add('cliente:parcial');
    t.zerar();
    expect(await t.motor.sincronizar({ modo: 'parcial' })).toBe(true);
    expect(t.motor.estado().erro).toBeNull();
    expect(await t.ids('cliente')).toEqual([uuid(1), uuid(2)]);
    const cursor = t.chamadas[0]!.cursor;
    t.limitar.clear();
    t.zerar();
    expect(await t.motor.sincronizar({ modo: 'parcial' })).toBe(true);
    expect(t.chamadas[0]!.cursor).toBe(cursor);
    expect(await t.ids('cliente')).toEqual([uuid(1), uuid(2), uuid(4)]);
  });

  it('completa limitada: nada é apagado, sem erro, e a automática seguinte não refaz do zero', async () => {
    const t = await montar();
    await t.motor.sincronizar();
    t.limitar.add('cliente:completa').add('visita:completa');
    t.zerar();
    expect(await t.motor.sincronizar({ modo: 'completa' })).toBe(true);
    expect(t.motor.estado().erro).toBeNull();
    expect(await t.ids('cliente')).toEqual([uuid(1), uuid(2)]);
    expect(await t.ids('visita')).toEqual([uuid(3)]);
    t.limitar.clear();
    t.zerar();
    expect(await t.motor.sincronizar()).toBe(true);
    // do cursor guardado (não do zero) e sem modo
    expect(t.chamadas.every((c) => c.cursor !== null && c.modo === null)).toBe(true);
    expect(await t.ids('cliente')).toEqual([uuid(1), uuid(2)]);
  });
});
