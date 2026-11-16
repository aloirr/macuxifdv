/**
 * RN-CORE-48 (pedido do dono do produto, 14/11): a tela de entrada mostra a carga "n de N" em sequência. O motor aceita
 * `ordemDaCarga` (chave de ordenação) e roda entidades e etapas extras numa sequência única, estável; sem ela, a ordem de
 * sempre (entidades do registro, depois etapas). Retomada, avisos e contagem da carga seguem iguais.
 */
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { defineModule } from './manifesto';
import { criarMotorSync } from './motor-sync';
import { FABRICAS_ARMAZENAMENTO } from './motor-sync.fabricas';
import { criarServidorSyncSimulado } from './sync-simulado';
import { criarRegistroSync, definirEntidadeSync } from './sync';
const manifestos = [
    defineModule({ id: 'core', versao: '1.0.0', perfis: ['vendedor'], sync: ['cliente', 'meta'] }),
    defineModule({ id: 'catalogo', versao: '1.0.0', depende: ['core'], perfis: ['vendedor'], sync: ['produto'] }),
];
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T0 = Date.parse('2026-11-14T10:00:00Z'); // hora-fixa-ok: relógio injetado do motor, nunca comparado ao relógio real
/** Posição de cada item na tela de entrada (simplificada): menor roda antes. */
const POSICAO = { cliente: 2, produto: 3, meta: 4, 'core-inicio': 4, fotos: 5 };
const porPosicao = (i) => POSICAO[i.chave] ?? 99;
describe.each(FABRICAS_ARMAZENAMENTO)('motor: ordem da carga configurável [%s] (RN-CORE-48)', (_nome, fabrica) => {
    function montar(o = {}) {
        const relogio = { agora: T0 };
        const registro = criarRegistroSync(manifestos);
        // registrados fora da ordem: o registro devolve em ordem alfabética (a de hoje): cliente, meta, produto
        registro.registrar(definirEntidadeSync({ nome: 'meta', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: z.object({}).passthrough() }));
        registro.registrar(definirEntidadeSync({ nome: 'cliente', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: z.object({}).passthrough() }));
        registro.registrar(definirEntidadeSync({ nome: 'produto', modulo: 'catalogo', direcao: 'pull', conflito: 'servidor_vence', schema: z.object({}).passthrough() }));
        const servidor = criarServidorSyncSimulado(registro, { modulosAtivos: ['core', 'catalogo'], comNovidades: true });
        servidor.relogio = () => new Date(relogio.agora);
        const linha = (n) => ({ id: uuid(n), updated_at: new Date(T0 - 60_000).toISOString(), deleted_at: null });
        servidor.linhas = { meta: [linha(1)], cliente: [linha(2)], produto: [linha(3)] };
        const sequencia = [];
        let falhar = o.falharEm ?? null;
        const transporte = {
            ...servidor,
            pull: async (entidade, cursor) => {
                sequencia.push(entidade);
                if (entidade === falhar) {
                    falhar = null;
                    throw new Error('processo encerrado (simulado)');
                }
                return servidor.pull(entidade, cursor);
            },
        };
        const etapa = (id, modulo) => ({
            id,
            rotulo: id,
            modulo,
            executar: async () => {
                sequencia.push(`etapa:${id}`);
            },
        });
        // ordem das etapas (a de hoje): fotos, core-inicio
        const etapas = [etapa('fotos', 'catalogo'), etapa('core-inicio', 'core')];
        const armazenamento = fabrica();
        const abrir = async (ordem = o.ordemDaCarga) => {
            const motor = criarMotorSync({ registro, armazenamento, transporte, agora: () => new Date(relogio.agora), etapas, ordemDaCarga: ordem });
            await motor.carregar();
            if (motor.estado().modulosAtivos.length === 0)
                await motor.aplicarModulosAtivos(['core', 'catalogo']);
            return motor;
        };
        return { abrir, sequencia, servidor, linha, relogio };
    }
    it('sem o parâmetro: entidades na ordem do registro e depois as etapas (comportamento de antes)', async () => {
        const t = montar();
        const motor = await t.abrir();
        expect(await motor.sincronizar()).toBe(true);
        expect(t.sequencia).toEqual(['cliente', 'meta', 'produto', 'etapa:fotos', 'etapa:core-inicio']);
        expect(motor.estado().carga).toMatchObject({ concluidas: 6, total: 6, entidade: null });
    });
    it('com o parâmetro: sequência única pela chave, misturando entidades e etapas; empate mantém a ordem de hoje', async () => {
        const t = montar({ ordemDaCarga: porPosicao });
        const motor = await t.abrir();
        const vistos = [];
        const concluidas = [];
        motor.assinar((e) => {
            if (e.carga.entidade !== vistos.at(-1))
                vistos.push(e.carga.entidade);
            concluidas.push(e.carga.concluidas);
        });
        expect(await motor.sincronizar()).toBe(true);
        // meta (entidade) e core-inicio (etapa) empatam em 4: a entidade vem antes, como hoje
        expect(t.sequencia).toEqual(['cliente', 'produto', 'meta', 'etapa:core-inicio', 'etapa:fotos']);
        expect(vistos.filter((v) => v !== null)).toEqual(['cliente', 'produto', 'meta', 'core-inicio', 'fotos']);
        // a contagem só sobe (nunca volta)
        expect(concluidas).toEqual([...concluidas].sort((a, b) => a - b));
        expect(motor.estado().carga).toMatchObject({ concluidas: 6, total: 6 });
        expect(motor.estado().sincronizado_em).not.toBeNull();
    });
    it('recebe chave, módulo e tipo de cada item; chave não finita ou função que lança = ordem padrão', async () => {
        const recebidos = [];
        const t = montar({
            ordemDaCarga: (i) => {
                recebidos.push(i);
                return Number.NaN;
            },
        });
        const motor = await t.abrir();
        expect(await motor.sincronizar()).toBe(true);
        expect(recebidos).toEqual([
            { chave: 'cliente', modulo: 'core', tipo: 'entidade' },
            { chave: 'meta', modulo: 'core', tipo: 'entidade' },
            { chave: 'produto', modulo: 'catalogo', tipo: 'entidade' },
            { chave: 'fotos', modulo: 'catalogo', tipo: 'etapa' },
            { chave: 'core-inicio', modulo: 'core', tipo: 'etapa' },
        ]);
        expect(t.sequencia).toEqual(['cliente', 'meta', 'produto', 'etapa:fotos', 'etapa:core-inicio']);
        const t2 = montar({
            ordemDaCarga: () => {
                throw new Error('ordem quebrada');
            },
        });
        const m2 = await t2.abrir();
        expect(await m2.sincronizar()).toBe(true);
        expect(t2.sequencia).toEqual(['cliente', 'meta', 'produto', 'etapa:fotos', 'etapa:core-inicio']);
    });
    it('retomada com o parâmetro: pula o que já foi concluído e segue a mesma sequência, contando de onde parou', async () => {
        const t = montar({ ordemDaCarga: porPosicao, falharEm: 'meta' });
        const m1 = await t.abrir();
        expect(await m1.sincronizar()).toBe(false);
        expect(t.sequencia).toEqual(['cliente', 'produto', 'meta']);
        t.sequencia.length = 0;
        const m2 = await t.abrir();
        const concluidas = [];
        m2.assinar((e) => concluidas.push(e.carga.concluidas));
        expect(await m2.sincronizar()).toBe(true);
        expect(t.sequencia).toEqual(['meta', 'etapa:core-inicio', 'etapa:fotos']);
        expect(concluidas[0]).toBe(2);
        expect(Math.min(...concluidas)).toBeGreaterThanOrEqual(2);
        expect(m2.estado().carga).toMatchObject({ retomada: true, concluidas: 6, total: 6 });
    });
    it('novidades: sem o parâmetro, ordem alfabética; com ele, pela chave', async () => {
        for (const [ordem, esperado] of [
            [undefined, ['cliente', 'meta', 'produto']],
            [porPosicao, ['cliente', 'produto', 'meta']],
        ]) {
            const t = montar({ ordemDaCarga: ordem });
            const motor = await t.abrir();
            expect(await motor.sincronizar()).toBe(true);
            // o relógio anda 1 min: as linhas novas (em T0) ficam entre o horizonte da carga e o novo
            t.relogio.agora = T0 + 60_000;
            const nova = (n) => ({ ...t.linha(n), updated_at: new Date(T0).toISOString() });
            t.servidor.linhas = { meta: [nova(11)], cliente: [nova(12)], produto: [nova(13)] };
            t.sequencia.length = 0;
            expect(await motor.sincronizarNovidades()).toBe(true);
            expect(t.sequencia).toEqual(esperado);
        }
    });
});
