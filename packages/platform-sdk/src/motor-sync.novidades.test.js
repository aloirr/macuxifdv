/**
 * RN-CORE-23 (ADR 0018; T-0065): atualização leve do motor — `sincronizarNovidades()`.
 * Critério da tarefa: sem nada mudado, 1 requisição; com 1 entidade mudada, 2.
 */
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { defineModule } from './manifesto';
import { criarMotorSync } from './motor-sync';
import { FABRICAS_ARMAZENAMENTO } from './motor-sync.fabricas';
import { codificarCursorNovidades, decodificarCursorNovidades } from './novidades';
import { criarServidorSyncSimulado } from './sync-simulado';
import { criarRegistroSync, definirEntidadeSync } from './sync';
const manifestos = [
    defineModule({ id: 'core', versao: '1.0.0', perfis: ['vendedor'], sync: ['cliente', 'visita'] }),
    defineModule({ id: 'vendedor', versao: '1.0.0', depende: ['core'], perfis: ['vendedor'], sync: ['pedido'] }),
];
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T0 = Date.parse('2026-11-02T12:00:00Z');
const MIN = 60_000;
describe('cursor de novidades', () => {
    it('ida e volta; outra versão, ausente ou ilegível = null (todas as entidades)', () => {
        const c = { horizonte: '2026-11-02T12:00:00.000Z', licencas: 'abc', escopo: null };
        expect(decodificarCursorNovidades(codificarCursorNovidades(c))).toEqual(c);
        expect(decodificarCursorNovidades(codificarCursorNovidades({ ...c, escopo: 'f00' }))?.escopo).toBe('f00');
        expect(decodificarCursorNovidades(null)).toBeNull();
        expect(decodificarCursorNovidades('n2|2026-11-02T12:00:00Z|a|-')).toBeNull();
        expect(decodificarCursorNovidades('n1|ontem|a|-')).toBeNull();
        expect(decodificarCursorNovidades('lixo')).toBeNull();
    });
});
describe.each(FABRICAS_ARMAZENAMENTO)('motor.sincronizarNovidades [%s] (RN-CORE-23)', (_nome, fabrica) => {
    async function montar(opcoes = { comNovidades: true }) {
        let agora = T0;
        const registro = criarRegistroSync(manifestos);
        registro.registrar(definirEntidadeSync({ nome: 'cliente', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: z.object({}).passthrough() }));
        registro.registrar(definirEntidadeSync({ nome: 'visita', modulo: 'core', direcao: 'ambos', conflito: 'somente_insercao', schema: z.object({}).passthrough() }));
        registro.registrar(definirEntidadeSync({ nome: 'pedido', modulo: 'vendedor', direcao: 'ambos', conflito: 'app_edita_ate_status', schema: z.object({}).passthrough() }));
        const servidor = criarServidorSyncSimulado(registro, { modulosAtivos: ['core', 'vendedor'], comNovidades: opcoes.comNovidades });
        servidor.relogio = () => new Date(agora);
        const linha = (n, quando) => ({ id: uuid(n), updated_at: new Date(quando).toISOString(), deleted_at: null });
        servidor.linhas = { cliente: [linha(1, T0 - 60 * MIN)], visita: [linha(2, T0 - 50 * MIN)], pedido: [linha(3, T0 - 40 * MIN)] };
        const motor = criarMotorSync({ registro, armazenamento: fabrica(), transporte: servidor, agora: () => new Date(agora) });
        await motor.carregar();
        await motor.aplicarModulosAtivos(['core', 'vendedor']);
        const zerar = () => Object.assign(servidor.chamadas, opcoes.comNovidades ? { push: 0, pull: 0, novidades: 0 } : { push: 0, pull: 0 });
        const total = () => servidor.chamadas.push + servidor.chamadas.pull + (servidor.chamadas.novidades ?? 0);
        const avancar = (ms) => (agora += ms);
        return { motor, servidor, linha, zerar, total, avancar, agora: () => agora };
    }
    it('antes da 1ª sincronização completa, faz a completa; a completa grava o cursor-base', async () => {
        const t = await montar();
        expect(await t.motor.sincronizarNovidades()).toBe(true);
        expect(t.servidor.chamadas.pull).toBe(3);
        expect(t.servidor.chamadas.novidades).toBe(1); // o cursor-base
        expect(await t.motor.linhas('cliente')).toHaveLength(1);
    });
    it('sem nada mudado = 1 requisição; 1 entidade mudada = 2; o cursor anda', async () => {
        const t = await montar();
        await t.motor.sincronizar();
        t.zerar();
        t.avancar(30 * MIN);
        expect(await t.motor.sincronizarNovidades()).toBe(true);
        expect(t.total()).toBe(1);
        expect(t.motor.estado().sincronizado_em).toBe(new Date(t.agora()).toISOString());
        t.servidor.linhas.pedido.push(t.linha(4, t.agora()));
        t.avancar(MIN);
        t.zerar();
        expect(await t.motor.sincronizarNovidades()).toBe(true);
        expect(t.servidor.chamadas).toEqual({ push: 0, pull: 1, novidades: 1 });
        expect((await t.motor.linhas('pedido')).map((l) => l.id).sort()).toEqual([uuid(3), uuid(4)]);
        t.avancar(30 * MIN);
        t.zerar();
        await t.motor.sincronizarNovidades();
        expect(t.total()).toBe(1);
    });
    it('push silencioso com a lista: puxa só as entidades ativas da lista, sem consultar novidades', async () => {
        const t = await montar();
        await t.motor.sincronizar();
        t.zerar();
        await t.motor.sincronizarNovidades({ entidades: ['pedido', 'pedido', 'nao_existe'] });
        expect(t.servidor.chamadas).toEqual({ push: 0, pull: 1, novidades: 0 });
    });
    it('pull que falha não avança o cursor: a próxima consulta aponta a mesma entidade', async () => {
        const t = await montar();
        await t.motor.sincronizar();
        t.servidor.linhas.cliente.push(t.linha(5, t.agora()));
        t.avancar(MIN);
        const pullOriginal = t.servidor.pull;
        t.servidor.pull = async () => {
            throw new Error('queda no meio');
        };
        expect(await t.motor.sincronizarNovidades()).toBe(false);
        expect(t.motor.estado().erro).toBe('queda no meio');
        t.servidor.pull = pullOriginal;
        t.zerar();
        expect(await t.motor.sincronizarNovidades()).toBe(true);
        expect(t.servidor.chamadas).toEqual({ push: 0, pull: 1, novidades: 1 });
        expect(await t.motor.linhas('cliente')).toHaveLength(2);
    });
    it('módulos efetivos mudaram: aplica a lista e os parâmetros da própria resposta e puxa as entidades ativas', async () => {
        const t = await montar();
        await t.motor.sincronizar();
        t.servidor.modulosAtivos = ['core'];
        t.servidor.parametros = { core: { sync_auto_min: 20 } };
        t.zerar();
        t.avancar(MIN);
        expect(await t.motor.sincronizarNovidades()).toBe(true);
        expect(t.motor.estado().modulosAtivos).toEqual(['core']);
        expect(t.motor.parametros('core')).toEqual({ sync_auto_min: 20 });
        expect(t.servidor.chamadas).toEqual({ push: 0, pull: 2, novidades: 1 }); // cliente e visita
        expect(await t.motor.linhas('pedido')).toEqual([]); // RN-CORE-02: o módulo que saiu some do aparelho
    });
    it('item na fila sobe antes da consulta; sem sinal não sai nada', async () => {
        const t = await montar();
        await t.motor.sincronizar();
        await t.motor.enfileirar({ id: uuid(9), entidade: 'visita', payload: { cliente_id: uuid(1) } });
        t.zerar();
        await t.motor.sincronizarNovidades();
        expect(t.servidor.chamadas.push).toBe(1);
        expect(t.servidor.chamadas.novidades).toBe(1);
        t.servidor.online = false;
        expect(await t.motor.sincronizarNovidades()).toBe(false);
    });
    it('servidor sem a rota de novidades: vira a sincronização completa', async () => {
        const t = await montar({ comNovidades: false });
        await t.motor.sincronizar();
        t.zerar();
        expect(await t.motor.sincronizarNovidades()).toBe(true);
        expect(t.servidor.chamadas.pull).toBe(3);
    });
});
