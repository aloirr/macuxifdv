/**
 * D-3 (ADR 0009 §3): item aceito pelo servidor sai da fila mas continua sobreposto (`estado.aceitos`,
 * `motor.sobreposicao()`) até um pull cobrir o aceite — `PaginaSync.horizonte` > `ResultadoItemPush.em` (relógio do
 * banco) ou, sem esses campos, o relógio do aparelho com `MARGEM_ACEITE_SEM_HORIZONTE_MS`. Sem isso o check-in aceito
 * sumia do aparelho (RN-CORE-11 deixava abrir outro) e a notificação lida voltava a "não lida" até o próximo pull.
 * Mesmos casos nos três adaptadores.
 */
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { defineModule } from './manifesto';
import { criarMotorSync, itensParaSobrepor, MARGEM_ACEITE_SEM_HORIZONTE_MS, type TransporteSync } from './motor-sync';
import { FABRICAS_ARMAZENAMENTO } from './motor-sync.fabricas';
import { criarServidorSyncSimulado, ErroRedeSimulada } from './sync-simulado';
import { criarRegistroSync, definirEntidadeSync } from './sync';

const manifestos = [
  defineModule({ id: 'core', versao: '1.0.0', perfis: ['vendedor'], sync: ['cliente', 'visita', 'visita_checkout'] }),
  defineModule({ id: 'vendedor', versao: '1.0.0', depende: ['core'], perfis: ['vendedor'], sync: ['pedido'] }),
];

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T0 = Date.parse('2026-10-31T14:00:00.000Z');

describe.each(FABRICAS_ARMAZENAMENTO)('D-3: aceito sobreposto até o pull trazer a linha [%s]', (_nome, fabrica) => {
  function montar(o: { comRelogioNoServidor?: boolean } = {}) {
    const registro = criarRegistroSync(manifestos);
    const def = (nome: string, modulo: 'core' | 'vendedor', direcao: 'pull' | 'push' | 'ambos') =>
      registro.registrar(definirEntidadeSync({ nome, modulo, direcao, conflito: 'servidor_vence', schema: z.object({}).passthrough() }));
    def('cliente', 'core', 'pull');
    def('visita', 'core', 'ambos');
    def('visita_checkout', 'core', 'push');
    def('pedido', 'vendedor', 'ambos');
    let relogio = T0;
    const servidor = criarServidorSyncSimulado(registro, { modulosAtivos: ['core', 'vendedor'] });
    if (o.comRelogioNoServidor !== false) servidor.relogio = () => new Date(relogio);
    const armazenamento = fabrica();
    /** Entidades cujo pull cai por falta de rede (passada interrompida). */
    const falhar = new Set<string>();
    const transporte: TransporteSync = {
      push: (itens) => servidor.push(itens),
      pull: async (e, c) => {
        if (falhar.has(e)) throw new ErroRedeSimulada();
        return servidor.pull(e, c);
      },
    };
    const motor = criarMotorSync({ registro, armazenamento, transporte, agora: () => new Date(relogio) });
    const passar = (ms: number) => {
      relogio += ms;
    };
    /** A linha que o servidor grava ao aceitar (updated_at = instante do aceite). */
    const linhaDoServidor = (entidade: string, id: string, extra: Record<string, unknown> = {}) =>
      (servidor.linhas[entidade] ??= []).push({ id, updated_at: new Date(relogio).toISOString(), deleted_at: null, ...extra });
    return { motor, servidor, armazenamento, registro, passar, linhaDoServidor, falhar };
  }

  const checkin = (n: number) => ({ id: uuid(n), entidade: 'visita', payload: { cliente_id: 'c1' }, rotulo: 'Check-in' });

  it('aceito sai da fila, continua na sobreposição e persiste; o pull antes do horizonte não o solta', async () => {
    const { motor, armazenamento, registro, servidor, passar, linhaDoServidor } = montar();
    await motor.aplicarModulosAtivos(['core', 'vendedor']);
    await motor.enfileirar(checkin(1));
    const vistos: Array<[number, number]> = [];
    motor.assinar((e) => vistos.push([e.fila.length, e.aceitos.length]));
    const r = await motor.enviar();
    linhaDoServidor('visita', uuid(1), { cliente_id: 'c1' });
    expect(r[0]).toMatchObject({ status: 'aceito', em: new Date(T0).toISOString() });
    expect(motor.estado().fila).toEqual([]);
    expect(motor.estado().aceitos).toEqual([
      expect.objectContaining({ id: uuid(1), situacao: 'aceito', aceito_servidor_em: new Date(T0).toISOString() }),
    ]);
    // a tela nunca vê o item fora da fila E fora dos aceitos (fila e aceitos mudam juntos)
    expect(vistos.some(([f, a]) => f === 0 && a === 0)).toBe(false);
    expect(motor.sobreposicao(['visita']).map((i) => [i.id, i.situacao])).toEqual([[uuid(1), 'aceito']]);
    expect(motor.pendentes('visita')).toEqual([]);

    // app reaberto: os aceitos voltam do armazenamento
    const outro = criarMotorSync({ registro, armazenamento, transporte: servidor });
    await outro.carregar();
    expect(outro.estado().aceitos.map((i) => i.id)).toEqual([uuid(1)]);

    // pull logo em seguida: horizonte (agora − 2 s) ainda antes do aceite → a linha não veio e o aceito fica
    passar(1_000);
    expect(await motor.sincronizar()).toBe(true);
    expect(await motor.linhas('visita')).toEqual([]);
    expect(motor.sobreposicao(['visita']).map((i) => i.id)).toEqual([uuid(1)]);

    // depois do horizonte: a linha chega e o aceito sai da sobreposição na mesma passada
    passar(2_500);
    expect(await motor.sincronizar()).toBe(true);
    expect((await motor.linhas('visita')).map((l) => l.id)).toEqual([uuid(1)]);
    expect(motor.estado().aceitos).toEqual([]);
    expect(motor.sobreposicao()).toEqual([]);
    expect(await armazenamento.ler('sync:aceitos')).toEqual([]);
  });

  it('comando só de push (visita_checkout) espera todas as entidades de pull do módulo; 501 não segura', async () => {
    const { motor, servidor, passar, falhar } = montar();
    await motor.aplicarModulosAtivos(['core', 'vendedor']);
    await motor.enfileirar({ id: uuid(2), entidade: 'visita_checkout', payload: { visita_id: uuid(1) } });
    await motor.enviar();
    expect(motor.estado().aceitos.map((i) => i.entidade)).toEqual(['visita_checkout']);
    passar(3_000);
    // `visita` cai no meio: a passada falha e o checkout continua sobreposto (a linha pode não ter chegado)
    falhar.add('visita');
    expect(await motor.sincronizar()).toBe(false);
    expect(motor.estado().aceitos.map((i) => i.id)).toEqual([uuid(2)]);
    // `cliente` sem provedor no servidor (501): nada a esperar dela; `visita` cobre → sai
    falhar.clear();
    servidor.semProvedor.add('cliente');
    expect(await motor.sincronizar()).toBe(true);
    expect(motor.estado().aceitos).toEqual([]);
  });

  it('sem `em`/`horizonte` do servidor: relógio do aparelho com a margem', async () => {
    const { motor, passar } = montar({ comRelogioNoServidor: false });
    await motor.aplicarModulosAtivos(['core', 'vendedor']);
    await motor.enfileirar(checkin(3));
    await motor.enviar();
    expect(motor.estado().aceitos[0]).toMatchObject({ aceito_servidor_em: null });
    passar(MARGEM_ACEITE_SEM_HORIZONTE_MS);
    expect(await motor.sincronizar()).toBe(true);
    expect(motor.estado().aceitos.map((i) => i.id)).toEqual([uuid(3)]);
    passar(1);
    expect(await motor.sincronizar()).toBe(true);
    expect(motor.estado().aceitos).toEqual([]);
  });

  it('o mesmo id reenviado não duplica nos aceitos', async () => {
    const { motor } = montar();
    await motor.aplicarModulosAtivos(['core', 'vendedor']);
    await motor.enfileirar(checkin(4));
    await motor.enviar();
    await motor.enfileirar(checkin(4));
    await motor.enviar();
    expect(motor.estado().aceitos.map((i) => i.id)).toEqual([uuid(4)]);
  });

  it('RN-CORE-02 e RN-CORE-15: módulo desativado e aparelho limpo levam os aceitos junto', async () => {
    const { motor, armazenamento } = montar();
    await motor.aplicarModulosAtivos(['core', 'vendedor']);
    await motor.enfileirar({ id: uuid(5), entidade: 'pedido', payload: { total: 1 } });
    await motor.enfileirar(checkin(6));
    await motor.enviar();
    expect(motor.estado().aceitos.map((i) => i.modulo)).toEqual(['vendedor', 'core']);
    await motor.aplicarModulosAtivos(['core']);
    expect(motor.estado().aceitos.map((i) => i.modulo)).toEqual(['core']);
    await motor.limparAparelho();
    expect(motor.estado().aceitos).toEqual([]);
    expect(await armazenamento.ler('sync:aceitos')).toBeNull();
  });
});

describe('itensParaSobrepor (pura)', () => {
  it('aceitos e pendentes/falhou na ordem de criação; modulo_inativo fora; filtro por entidade', () => {
    const base = { modulo: 'core' as const, operacao: 'upsert' as const, payload: {}, rotulo: '', detalhe: '', tentativas: 1, ultimo_erro: '', ultima_tentativa_em: null, codigo: null };
    const r = itensParaSobrepor({
      aceitos: [{ ...base, id: 'a', entidade: 'visita', criado_em: '2026-10-31T10:00:00.000Z', situacao: 'aceito', aceito_em: 'x', aceito_servidor_em: null }],
      fila: [
        { ...base, id: 'b', entidade: 'visita_checkout', criado_em: '2026-10-31T10:05:00.000Z', situacao: 'pendente' },
        { ...base, id: 'c', entidade: 'visita', criado_em: '2026-10-31T09:00:00.000Z', situacao: 'falhou' },
        { ...base, id: 'd', entidade: 'visita', criado_em: '2026-10-31T09:30:00.000Z', situacao: 'modulo_inativo' },
        { ...base, id: 'e', entidade: 'pedido', criado_em: '2026-10-31T09:40:00.000Z', situacao: 'pendente' },
      ],
    }, ['visita', 'visita_checkout']);
    expect(r.map((i) => i.id)).toEqual(['c', 'a', 'b']);
  });
});
