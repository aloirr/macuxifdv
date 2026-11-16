/**
 * ADR 0057 (RN-CORE-63, RN-CORE-23 item 1): estoque carregado uma vez por dia e o botão "Sincronizar" em dois modos.
 * - entidades `cadencia: 'diaria'` só vêm na carga diária (`cargaDiariaDevida` injetada), na carga inicial e na `completa`;
 * - `sincronizar({ modo: 'parcial' })` = envio + entidades `parcial` (pedidos e clientes);
 * - `sincronizar({ modo: 'completa' })` = tudo do zero, diárias inclusive, com o progresso da carga e `carga_diaria_em`.
 * Sem as peças novas, o motor faz o de sempre.
 */
import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import { defineModule } from './manifesto';
import { criarMotorSync } from './motor-sync';
import { FABRICAS_ARMAZENAMENTO } from './motor-sync.fabricas';
import { criarServidorSyncSimulado } from './sync-simulado';
import { criarRegistroSync, definirEntidadeSync } from './sync';
// Cada cenário roda nos 3 armazenamentos com SQLite; o runner do CI é bem mais lento que a máquina local.
vi.setConfig({ testTimeout: 30_000 });
const manifestos = [
    defineModule({ id: 'core', versao: '1.0.0', perfis: ['vendedor'], sync: ['cliente', 'visita'] }),
    defineModule({ id: 'vendedor', versao: '1.0.0', depende: ['core'], perfis: ['vendedor'], sync: ['pedido'] }),
    defineModule({ id: 'catalogo', versao: '1.0.0', depende: ['core'], perfis: ['vendedor'], sync: ['deposito', 'estoque_saldo'] }),
];
const MODULOS = ['core', 'vendedor', 'catalogo'];
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;
/** 16/11/2026 07:00 em Manaus (UTC−4). */
const T0 = Date.parse('2026-11-16T11:00:00Z');
/**
 * Espelho de teste da regra do Core (RN-CORE-63): devida quando a última carga é anterior ao último "06:00 de Manaus" já
 * passado (antes das 06:00, vale a de ontem). A função real é do modulo-core; o motor só a recebe.
 */
function devidaManaus(ultima, agora) {
    const seisHorasHoje = Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate(), 10);
    const marco = agora.getTime() >= seisHorasHoje ? seisHorasHoje : seisHorasHoje - DIA;
    return ultima === null || Date.parse(ultima) < marco;
}
const qualquer = z.object({}).passthrough();
const ent = (nome, modulo, extra = {}) => definirEntidadeSync({ nome, modulo, direcao: 'pull', conflito: 'servidor_vence', schema: qualquer, ...extra });
describe.each(FABRICAS_ARMAZENAMENTO)('carga diária e sincronização parcial/completa [%s] (ADR 0057)', (_nome, fabrica) => {
    async function montar(m = {}) {
        let agora = T0;
        const marcas = m.marcas ?? true;
        const registro = criarRegistroSync(manifestos);
        registro.registrar(ent('cliente', 'core', marcas ? { parcial: true } : {}));
        registro.registrar(ent('visita', 'core'));
        registro.registrar(ent('pedido', 'vendedor', marcas ? { parcial: true } : {}));
        registro.registrar(ent('deposito', 'catalogo', marcas ? { cadencia: 'diaria' } : {}));
        registro.registrar(ent('estoque_saldo', 'catalogo', marcas ? { cadencia: 'diaria' } : {}));
        const servidor = criarServidorSyncSimulado(registro, {
            modulosAtivos: [...MODULOS],
            comNovidades: true,
            tamanhoPagina: m.tamanhoPagina ?? 1000,
        });
        servidor.relogio = () => new Date(agora);
        const linha = (n, quando) => ({ id: uuid(n), updated_at: new Date(quando).toISOString(), deleted_at: null });
        servidor.linhas = {
            cliente: [linha(1, T0 - 60 * MIN)],
            visita: [linha(2, T0 - 50 * MIN)],
            pedido: [linha(3, T0 - 40 * MIN)],
            deposito: [linha(4, T0 - 30 * MIN)],
            estoque_saldo: [linha(5, T0 - 20 * MIN)],
        };
        const pulls = [];
        const pullOriginal = servidor.pull.bind(servidor);
        servidor.pull = async (e, c) => {
            pulls.push([e, c]);
            return pullOriginal(e, c);
        };
        const armazenamento = fabrica();
        const opcoes = {
            registro,
            armazenamento,
            transporte: servidor,
            agora: () => new Date(agora),
            ...(m.devida === null ? {} : { cargaDiariaDevida: m.devida ?? devidaManaus }),
            ...(m.etapas ? { etapas: m.etapas } : {}),
        };
        const motor = criarMotorSync(opcoes);
        await motor.carregar();
        await motor.aplicarModulosAtivos([...MODULOS]);
        const entidadesPuxadas = () => [...new Set(pulls.map(([e]) => e))].sort();
        const zerar = () => {
            pulls.length = 0;
            Object.assign(servidor.chamadas, { push: 0, pull: 0, novidades: 0 });
        };
        const avancar = (ms) => (agora += ms);
        const ids = async (e) => (await motor.linhas(e)).map((l) => l.id).sort();
        return { motor, servidor, linha, pulls, entidadesPuxadas, zerar, avancar, ids, opcoes, armazenamento, agora: () => agora };
    }
    it('carga inicial traz as diárias e grava carga_diaria_em', async () => {
        const t = await montar();
        expect(t.motor.estado().carga_diaria_em).toBeNull();
        expect(await t.motor.sincronizar()).toBe(true);
        expect(t.entidadesPuxadas()).toEqual(['cliente', 'deposito', 'estoque_saldo', 'pedido', 'visita']);
        expect(t.motor.estado().carga_diaria_em).toBe(new Date(T0).toISOString());
        expect(await t.ids('estoque_saldo')).toEqual([uuid(5)]);
    });
    it('no mesmo dia, novidades, push silencioso e a sincronização padrão pulam as diárias; nada se perde no dia seguinte', async () => {
        const t = await montar();
        await t.motor.sincronizar();
        const primeira = t.motor.estado().carga_diaria_em;
        // ERP mudou o estoque e o cliente mudou
        t.servidor.linhas.estoque_saldo.push(t.linha(50, t.agora()));
        t.servidor.linhas.cliente.push(t.linha(10, t.agora()));
        t.avancar(30 * MIN);
        t.zerar();
        expect(await t.motor.sincronizarNovidades()).toBe(true);
        expect(t.entidadesPuxadas()).toEqual(['cliente']);
        t.zerar();
        expect(await t.motor.sincronizarNovidades({ entidades: ['estoque_saldo', 'deposito'] })).toBe(true);
        expect(t.pulls).toEqual([]);
        t.zerar();
        expect(await t.motor.sincronizar()).toBe(true);
        expect(t.entidadesPuxadas()).toEqual(['cliente', 'pedido', 'visita']);
        expect(await t.ids('estoque_saldo')).toEqual([uuid(5)]);
        expect(t.motor.estado().carga_diaria_em).toBe(primeira);
        // dia seguinte às 05:50 (Manaus): ainda vale a de ontem
        t.avancar(DIA - 30 * MIN - 70 * MIN);
        t.zerar();
        await t.motor.sincronizarNovidades();
        expect(t.entidadesPuxadas()).not.toContain('estoque_saldo');
        // 06:10: a primeira sincronização com sinal faz a carga, do cursor de cada diária
        t.avancar(20 * MIN);
        t.zerar();
        expect(await t.motor.sincronizarNovidades()).toBe(true);
        expect(t.entidadesPuxadas()).toEqual(['deposito', 'estoque_saldo']);
        expect(t.pulls.find(([e]) => e === 'estoque_saldo')?.[1]).not.toBeNull();
        expect(await t.ids('estoque_saldo')).toEqual([uuid(5), uuid(50)].sort());
        expect(t.motor.estado().carga_diaria_em).toBe(new Date(t.agora()).toISOString());
        // a segunda do dia não carrega de novo
        t.servidor.linhas.estoque_saldo.push(t.linha(51, t.agora()));
        t.avancar(MIN);
        t.zerar();
        await t.motor.sincronizarNovidades();
        expect(t.entidadesPuxadas()).not.toContain('estoque_saldo');
    });
    it('a sincronização padrão também faz a carga quando ela está devida', async () => {
        const t = await montar();
        await t.motor.sincronizar();
        t.avancar(DIA);
        t.zerar();
        expect(await t.motor.sincronizar()).toBe(true);
        expect(t.entidadesPuxadas()).toEqual(['cliente', 'deposito', 'estoque_saldo', 'pedido', 'visita']);
        expect(t.motor.estado().carga_diaria_em).toBe(new Date(t.agora()).toISOString());
    });
    it('queda no meio da carga não grava carga_diaria_em; a próxima sincronização tenta de novo', async () => {
        const t = await montar();
        await t.motor.sincronizar();
        const primeira = t.motor.estado().carga_diaria_em;
        t.avancar(DIA);
        const pull = t.servidor.pull;
        t.servidor.pull = async (e, c) => {
            if (e === 'estoque_saldo')
                throw new Error('queda no meio');
            return pull(e, c);
        };
        expect(await t.motor.sincronizarNovidades()).toBe(false);
        expect(t.motor.estado().carga_diaria_em).toBe(primeira);
        t.servidor.pull = pull;
        t.avancar(MIN);
        t.zerar();
        expect(await t.motor.sincronizarNovidades()).toBe(true);
        expect(t.entidadesPuxadas()).toContain('estoque_saldo');
        expect(t.motor.estado().carga_diaria_em).toBe(new Date(t.agora()).toISOString());
    });
    it('carregar() devolve carga_diaria_em ao estado (app reaberto)', async () => {
        const t = await montar();
        await t.motor.sincronizar();
        const outro = criarMotorSync(t.opcoes);
        await outro.carregar();
        expect(outro.estado().carga_diaria_em).toBe(new Date(T0).toISOString());
    });
    it('função de carga devida que lança = devida (na dúvida, o estoque vem)', async () => {
        const t = await montar({
            devida: () => {
                throw new Error('fuso inválido');
            },
        });
        await t.motor.sincronizar();
        t.zerar();
        await t.motor.sincronizarNovidades();
        expect(t.entidadesPuxadas()).toEqual(['deposito', 'estoque_saldo']);
    });
    it('sem cargaDiariaDevida: as diárias seguem contínuas e carga_diaria_em fica nulo (o de sempre)', async () => {
        const t = await montar({ devida: null });
        await t.motor.sincronizar();
        expect(t.motor.estado().carga_diaria_em).toBeNull();
        t.servidor.linhas.estoque_saldo.push(t.linha(50, t.agora()));
        t.avancar(MIN);
        t.zerar();
        await t.motor.sincronizarNovidades();
        expect(t.entidadesPuxadas()).toEqual(['estoque_saldo']);
        t.zerar();
        await t.motor.sincronizar({ modo: 'completa' });
        expect(t.motor.estado().carga_diaria_em).toBeNull();
    });
    it('troca de geração apaga carga_diaria_em e a passada de novo traz as diárias', async () => {
        const t = await montar();
        t.servidor.geracao_base = 'g1';
        await t.motor.sincronizar();
        t.avancar(30 * MIN);
        t.servidor.geracao_base = 'g2';
        t.zerar();
        expect(await t.motor.sincronizarNovidades()).toBe(true);
        expect(t.entidadesPuxadas()).toContain('estoque_saldo');
        expect(t.motor.estado().carga_diaria_em).toBe(new Date(t.agora()).toISOString());
    });
    describe('parcial (toque no "Sincronizar")', () => {
        it('envia a fila e puxa só pedidos e clientes, sem novidades nem etapas; cursor de novidades intacto', async () => {
            let etapa = 0;
            const t = await montar({ etapas: [{ id: 'extra', rotulo: 'Extra', modulo: 'core', executar: async () => void etapa++ }] });
            await t.motor.sincronizar();
            expect(etapa).toBe(1);
            const cursorNovidades = await t.armazenamento.ler('sync:novidades');
            const carga = t.motor.estado().carga_diaria_em;
            t.servidor.linhas.cliente.push(t.linha(10, t.agora()));
            t.servidor.linhas.visita.push(t.linha(11, t.agora()));
            t.avancar(DIA); // até com a carga diária devida, a parcial não leva estoque
            t.zerar();
            expect(await t.motor.sincronizar({ modo: 'parcial' })).toBe(true);
            expect(t.entidadesPuxadas()).toEqual(['cliente', 'pedido']);
            expect(t.servidor.chamadas.novidades).toBe(0);
            expect(etapa).toBe(1);
            expect(await t.ids('cliente')).toEqual([uuid(1), uuid(10)]);
            expect(await t.ids('visita')).toEqual([uuid(2)]);
            expect(await t.armazenamento.ler('sync:novidades')).toBe(cursorNovidades);
            expect(t.motor.estado().sincronizado_em).toBe(new Date(t.agora()).toISOString());
            expect(t.motor.estado().carga_diaria_em).toBe(carga);
        });
        it('antes da 1ª sincronização faz a carga inicial; sem sinal não sai nada', async () => {
            const t = await montar();
            expect(await t.motor.sincronizar({ modo: 'parcial' })).toBe(true);
            expect(t.entidadesPuxadas()).toEqual(['cliente', 'deposito', 'estoque_saldo', 'pedido', 'visita']);
            t.servidor.online = false;
            expect(await t.motor.sincronizar({ modo: 'parcial' })).toBe(false);
            expect(t.motor.estado().erro).toBeTruthy();
        });
        it('módulos sem entidade parcial: o toque faz a sincronização de sempre', async () => {
            const t = await montar({ marcas: false });
            await t.motor.sincronizar();
            t.zerar();
            expect(await t.motor.sincronizar({ modo: 'parcial' })).toBe(true);
            expect(t.entidadesPuxadas()).toEqual(['cliente', 'deposito', 'estoque_saldo', 'pedido', 'visita']);
        });
    });
    describe('completa (segurar 10 s)', () => {
        it('refaz tudo do zero (diárias inclusive), apaga o que não veio, roda as etapas, mostra o progresso e grava carga_diaria_em', async () => {
            let etapa = 0;
            const t = await montar({ etapas: [{ id: 'extra', rotulo: 'Extra', modulo: 'core', executar: async () => void etapa++ }] });
            await t.motor.sincronizar();
            // o servidor perdeu linhas sem lápide (o delta nunca as apagaria)
            t.servidor.linhas.cliente = [];
            t.servidor.linhas.estoque_saldo = [t.linha(60, t.agora())];
            t.avancar(30 * MIN); // mesmo dia: a completa é a única segunda carga
            t.zerar();
            const vistos = [];
            const sair = t.motor.assinar((e) => vistos.push({ concluidas: e.carga.concluidas, total: e.carga.total }));
            expect(await t.motor.sincronizar({ modo: 'completa' })).toBe(true);
            sair();
            expect(t.entidadesPuxadas()).toEqual(['cliente', 'deposito', 'estoque_saldo', 'pedido', 'visita']);
            expect(t.pulls.every(([, c]) => c === null)).toBe(true);
            expect(await t.ids('cliente')).toEqual([]);
            expect(await t.ids('estoque_saldo')).toEqual([uuid(60)]);
            expect(await t.ids('pedido')).toEqual([uuid(3)]);
            expect(etapa).toBe(2);
            // progresso igual ao da carga: 1 (fila) + 5 entidades + 1 etapa, até o fim
            expect(vistos.at(-1)).toEqual({ concluidas: 7, total: 7 });
            expect(t.motor.estado().progresso).toBe(1);
            expect(t.motor.estado().carga_diaria_em).toBe(new Date(t.agora()).toISOString());
            // depois dela, o delta continua normal (nada pendente de refazer)
            t.zerar();
            await t.motor.sincronizar();
            expect(t.pulls.every(([, c]) => c !== null)).toBe(true);
        });
        it('interrompida no meio: a próxima passada continua da página em curso e só então apaga o que não veio', async () => {
            const t = await montar({ tamanhoPagina: 1 });
            t.servidor.linhas.cliente = [t.linha(1, T0 - 60 * MIN), t.linha(6, T0 - 59 * MIN), t.linha(7, T0 - 58 * MIN)];
            await t.motor.sincronizar();
            expect(await t.ids('cliente')).toHaveLength(3);
            // o cliente 6 sumiu do servidor sem lápide e o 8 entrou
            t.servidor.linhas.cliente = [t.linha(1, T0 - 60 * MIN), t.linha(7, T0 - 58 * MIN), t.linha(8, T0 - 57 * MIN)];
            t.avancar(MIN);
            const pull = t.servidor.pull;
            let paginasCliente = 0;
            t.servidor.pull = async (e, c) => {
                if (e === 'cliente' && ++paginasCliente === 3)
                    throw new Error('queda no meio');
                return pull(e, c);
            };
            expect(await t.motor.sincronizar({ modo: 'completa' })).toBe(false);
            expect(await t.ids('cliente')).toHaveLength(3); // nada apagado no meio
            t.servidor.pull = pull;
            t.zerar();
            expect(await t.motor.sincronizar()).toBe(true);
            // retomou da última página registrada (a 2ª, cursor da 1ª linha; no máximo uma página repete), não do zero nem do
            // cursor antigo
            expect(t.pulls.find(([e]) => e === 'cliente')?.[1]).toContain(uuid(1));
            expect(await t.ids('cliente')).toEqual([uuid(1), uuid(7), uuid(8)]);
            expect(await t.armazenamento.ler('sync:ressinc:cliente')).toBeNull();
        });
        it('entidade sem provedor no servidor: aviso, nada apagado e nenhum registro pendente', async () => {
            const t = await montar();
            await t.motor.sincronizar();
            t.servidor.semProvedor.add('visita');
            t.zerar();
            expect(await t.motor.sincronizar({ modo: 'completa' })).toBe(true);
            expect(t.motor.estado().avisos.map((a) => a.entidade)).toEqual(['visita']);
            expect(await t.ids('visita')).toEqual([uuid(2)]);
            expect(await t.armazenamento.ler('sync:ressinc:visita')).toBeNull();
        });
        it('escopo mudou no meio da completa: recomeça do zero com a versão nova', async () => {
            const t = await montar({ tamanhoPagina: 1 });
            t.servidor.versoesEscopo.cliente = 'v1';
            t.servidor.linhas.cliente = [t.linha(1, T0 - 60 * MIN), t.linha(6, T0 - 59 * MIN)];
            await t.motor.sincronizar();
            t.avancar(MIN);
            const pull = t.servidor.pull;
            let paginasCliente = 0;
            t.servidor.pull = async (e, c) => {
                if (e === 'cliente' && ++paginasCliente === 2) {
                    t.servidor.versoesEscopo.cliente = 'v2';
                    t.servidor.linhas.cliente = [t.linha(7, T0 - 61 * MIN)];
                }
                return pull(e, c);
            };
            t.zerar();
            expect(await t.motor.sincronizar({ modo: 'completa' })).toBe(true);
            expect(t.pulls.filter(([e, c]) => e === 'cliente' && c === null)).toHaveLength(2);
            expect(await t.ids('cliente')).toEqual([uuid(7)]);
            expect(await t.armazenamento.ler('sync:escopo:cliente')).toBe('v2');
        });
        it('com outra sincronização em curso, espera ela terminar e roda depois; pedido repetido recebe a mesma', async () => {
            const t = await montar();
            await t.motor.sincronizar();
            t.zerar();
            const leve = t.motor.sincronizarNovidades();
            const completa = t.motor.sincronizar({ modo: 'completa' });
            expect(t.motor.sincronizar({ modo: 'completa' })).toBe(completa);
            expect(t.motor.sincronizar()).toBe(completa);
            expect(await leve).toBe(true);
            expect(await completa).toBe(true);
            expect(t.servidor.chamadas.novidades).toBeGreaterThanOrEqual(1);
            expect(t.entidadesPuxadas()).toEqual(['cliente', 'deposito', 'estoque_saldo', 'pedido', 'visita']);
        });
    });
});
