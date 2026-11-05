/**
 * D-T0039d (T-0039, R-20261105-152330): o estado em memória do motor segue o DISCO. Toda mudança da fila de itens, dos
 * aceitos, da fila de arquivos e dos módulos grava primeiro e só depois muda o estado; gravação que falha (disco cheio,
 * SQLite travado) deixa memória e disco como estavam — sem item "fantasma" que a tela mostra, o envio manda e some ao
 * fechar o app. As mudanças rodam uma por vez sobre o estado da vez: ordem da fila e idempotência pelo UUID do aparelho
 * valem também com chamadas simultâneas (`enfileirar` durante o push). Mesmos casos nos três adaptadores.
 */
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { defineModule } from './manifesto';
import { criarMotorSync, type ArmazenamentoSync, type ItemOutbox, type TransporteSync } from './motor-sync';
import { FABRICAS_ARMAZENAMENTO } from './motor-sync.fabricas';
import { criarServidorSyncSimulado } from './sync-simulado';
import { criarRegistroSync, definirEntidadeSync } from './sync';

const manifestos = [
  defineModule({ id: 'core', versao: '1.0.0', perfis: ['vendedor'], sync: ['cliente', 'visita'] }),
  defineModule({ id: 'vendedor', versao: '1.0.0', depende: ['core'], perfis: ['vendedor'], sync: ['pedido'] }),
];
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T0 = Date.parse('2026-11-05T12:00:00.000Z');
const G1 = '11111111-1111-4111-8111-111111111111';
const G2 = '22222222-2222-4222-8222-222222222222';

class DiscoCheio extends Error {
  constructor() {
    super('database or disk is full');
  }
}

/**
 * O adaptador da fábrica com `gravar` que falha nas chaves de `cheias` (todas, com `'*'`). As extensões (`linhas`,
 * `emTransacao`, `busca`…) seguem as do adaptador.
 */
function comDisco(base: ArmazenamentoSync) {
  const cheias = new Set<string>();
  const armazenamento: ArmazenamentoSync = {
    ...base,
    async gravar(chave, valor) {
      if (cheias.has('*') || cheias.has(chave)) throw new DiscoCheio();
      await base.gravar(chave, valor);
    },
  };
  return { armazenamento, cheias };
}

describe.each(FABRICAS_ARMAZENAMENTO)('D-T0039d: memória segue o disco [%s]', (_nome, fabrica) => {
  async function montar() {
    let agora = T0;
    const registro = criarRegistroSync(manifestos);
    const def = (nome: string, modulo: 'core' | 'vendedor', direcao: 'pull' | 'push' | 'ambos') =>
      registro.registrar(definirEntidadeSync({ nome, modulo, direcao, conflito: 'servidor_vence', schema: z.object({}).passthrough() }));
    def('cliente', 'core', 'pull');
    def('visita', 'core', 'ambos');
    def('pedido', 'vendedor', 'ambos');
    const servidor = criarServidorSyncSimulado(registro, { modulosAtivos: ['core', 'vendedor'] });
    servidor.relogio = () => new Date(agora);
    servidor.geracao_base = G1;
    /** Push que espera `liberar()` (para mexer na fila com o push em voo). */
    let segurar: Promise<void> | null = null;
    let liberar = () => {};
    const transporte: TransporteSync = {
      push: async (itens) => {
        if (segurar) await segurar;
        return servidor.push(itens);
      },
      pull: (e, c) => servidor.pull(e, c),
    };
    const segurarPush = () => {
      segurar = new Promise<void>((r) => (liberar = r));
      return () => {
        segurar = null;
        liberar();
      };
    };
    const disco = comDisco(fabrica());
    const criar = () => criarMotorSync({ registro, armazenamento: disco.armazenamento, transporte, agora: () => new Date(agora) });
    const motor = criar();
    await motor.carregar();
    await motor.aplicarModulosAtivos(['core', 'vendedor']);
    const filaNoDisco = async () => (await disco.armazenamento.ler<ItemOutbox[]>('sync:fila')) ?? [];
    const aceitosNoDisco = async () => (await disco.armazenamento.ler<ItemOutbox[]>('sync:aceitos')) ?? [];
    const ids = (l: readonly { id: string }[]) => l.map((i) => i.id);
    /** O invariante do D-T0039d: fila e aceitos em memória iguais aos do disco. */
    const conferir = async () => {
      expect(motor.estado().fila, 'fila em memória = disco').toEqual(await filaNoDisco());
      expect(motor.estado().aceitos, 'aceitos em memória = disco').toEqual(await aceitosNoDisco());
    };
    const passar = (ms: number) => (agora += ms);
    return { motor, criar, servidor, disco, filaNoDisco, aceitosNoDisco, ids, conferir, segurarPush, passar };
  }

  const pedido = (n: number, extra: Record<string, unknown> = {}) => ({
    id: uuid(n),
    entidade: 'pedido',
    payload: { cliente: 'c1', ...extra },
    rotulo: `Pedido ${n}`,
  });

  it('enfileirar com disco cheio: rejeita e o item não aparece na memória, no disco nem para os ouvintes; depois entra uma vez só', async () => {
    const t = await montar();
    await t.motor.enfileirar(pedido(1));
    const vistos: string[][] = [];
    t.motor.assinar((e) => vistos.push(t.ids(e.fila)));
    t.disco.cheias.add('sync:fila');
    await expect(t.motor.enfileirar(pedido(2))).rejects.toBeInstanceOf(DiscoCheio);
    expect(t.ids(t.motor.estado().fila)).toEqual([uuid(1)]);
    expect(vistos, 'nenhum ouvinte viu o item que não foi gravado').toEqual([]);
    await t.conferir();
    // disco livre: o envio não manda o que não foi gravado
    t.disco.cheias.clear();
    await t.motor.enviar();
    expect(t.servidor.recebidos.has(uuid(1))).toBe(true);
    expect(t.servidor.recebidos.has(uuid(2))).toBe(false);
    // o mesmo UUID entra uma vez e um app reaberto vê a mesma fila
    await t.motor.enfileirar(pedido(3));
    await t.motor.enfileirar(pedido(2));
    await t.motor.enfileirar(pedido(2));
    expect(t.ids(t.motor.estado().fila)).toEqual([uuid(3), uuid(2)]);
    await t.conferir();
    const reaberto = t.criar();
    await reaberto.carregar();
    expect(reaberto.estado().fila).toEqual(t.motor.estado().fila);
  });

  it('alterar e descartar com disco cheio: a memória fica com o payload e o item de antes (iguais ao disco)', async () => {
    const t = await montar();
    await t.motor.enfileirar(pedido(1));
    await t.motor.enfileirar(pedido(2));
    t.disco.cheias.add('sync:fila');
    await expect(t.motor.alterar(uuid(1), { payload: { cliente: 'c2' } })).rejects.toBeInstanceOf(DiscoCheio);
    await expect(t.motor.descartar(uuid(2))).rejects.toBeInstanceOf(DiscoCheio);
    expect(t.motor.estado().fila.map((i) => i.payload)).toEqual([{ cliente: 'c1' }, { cliente: 'c1' }]);
    await t.conferir();
    t.disco.cheias.clear();
    expect(await t.motor.alterar(uuid(1), { payload: { cliente: 'c2' } })).toBe(true);
    await t.motor.descartar(uuid(2));
    expect(t.motor.estado().fila.map((i) => [i.id, i.payload])).toEqual([[uuid(1), { cliente: 'c2' }]]);
    expect(await t.motor.alterar(uuid(2), { payload: {} }), 'descartado não volta pelo alterar').toBe(false);
    await t.conferir();
  });

  it('simultâneos: ordem de chamada (FIFO), mesmo UUID uma vez só, e uma falha no meio não leva nem desfaz as outras', async () => {
    const t = await montar();
    const p1 = t.motor.enfileirar(pedido(1));
    const p2 = t.motor.enfileirar(pedido(2));
    const p2b = t.motor.enfileirar(pedido(2, { cliente: 'outro' }));
    const p3 = t.motor.enfileirar(pedido(3));
    const [a, , b] = await Promise.all([p1, p2, p2b, p3]);
    expect(a.id).toBe(uuid(1));
    expect(b.payload, 'o segundo do mesmo UUID devolve o que já estava').toEqual({ cliente: 'c1' });
    expect(t.ids(t.motor.estado().fila)).toEqual([uuid(1), uuid(2), uuid(3)]);
    await t.conferir();
    // falha só na vez do 5: 4 e 6 entram, 5 não
    let n = 0;
    const gravarOriginal = t.disco.armazenamento.gravar;
    t.disco.armazenamento.gravar = async (k, v) => {
      if (k === 'sync:fila' && ++n === 2) throw new DiscoCheio();
      return gravarOriginal(k, v);
    };
    const r = await Promise.allSettled([t.motor.enfileirar(pedido(4)), t.motor.enfileirar(pedido(5)), t.motor.enfileirar(pedido(6))]);
    expect(r.map((x) => x.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
    expect(t.ids(t.motor.estado().fila)).toEqual([uuid(1), uuid(2), uuid(3), uuid(4), uuid(6)]);
    await t.conferir();
  });

  it('enfileirar, alterar e descartar durante o push em voo: nada se perde e o resultado do push vale sobre a fila da vez', async () => {
    const t = await montar();
    await t.motor.enfileirar(pedido(1));
    await t.motor.enfileirar(pedido(2));
    const soltar = t.segurarPush();
    const envio = t.motor.enviar();
    await new Promise((r) => setTimeout(r, 0));
    await t.motor.enfileirar(pedido(3));
    await t.motor.descartar(uuid(2));
    soltar();
    await envio;
    // 1 aceito (sobreposto); 2 já tinha ido no lote (o servidor recebeu) e o descarte vale; 3 entrou durante o push e espera o próximo
    expect(t.servidor.recebidos.has(uuid(2))).toBe(true);
    expect(t.ids(t.motor.estado().aceitos)).toEqual([uuid(1)]);
    expect(t.ids(t.motor.estado().fila)).toEqual([uuid(3)]);
    await t.conferir();
    await t.motor.enviar();
    expect(t.servidor.recebidos.has(uuid(3))).toBe(true);
    await t.conferir();
  });

  it('alterar durante o push em voo: a versão nova fica pendente na fila e vai no próximo push (a edição não se perde)', async () => {
    const t = await montar();
    await t.motor.enfileirar(pedido(1));
    await t.motor.enfileirar(pedido(2));
    const soltar = t.segurarPush();
    const envio = t.motor.enviar();
    await new Promise((r) => setTimeout(r, 0));
    expect(await t.motor.alterar(uuid(1), { payload: { cliente: 'c9' } })).toBe(true);
    soltar();
    await envio;
    expect(t.servidor.recebidos.get(uuid(1))?.payload, 'o servidor recebeu a versão de antes').toEqual({ cliente: 'c1' });
    expect(t.motor.estado().fila.map((i) => [i.id, i.situacao, i.payload])).toEqual([[uuid(1), 'pendente', { cliente: 'c9' }]]);
    expect(t.ids(t.motor.estado().aceitos), 'só o não alterado vai para a sobreposição').toEqual([uuid(2)]);
    await t.conferir();
    await t.motor.enviar();
    expect(t.servidor.recebidos.get(uuid(1))?.payload).toEqual({ cliente: 'c9' });
    expect(t.motor.estado().fila).toEqual([]);
    expect(t.ids(t.motor.estado().aceitos)).toEqual([uuid(2), uuid(1)]);
    await t.conferir();
  });

  it('push aceito e disco cheio na fila (aceitos já gravados): o item fica na fila E nos aceitos, na memória e no disco; o reenvio é idempotente', async () => {
    const t = await montar();
    await t.motor.enfileirar(pedido(1));
    t.disco.cheias.add('sync:fila');
    await expect(t.motor.enviar()).rejects.toBeInstanceOf(DiscoCheio);
    expect(t.servidor.recebidos.has(uuid(1))).toBe(true);
    expect(t.ids(t.motor.estado().fila), 'nunca some dos dois').toEqual([uuid(1)]);
    expect(t.ids(t.motor.estado().aceitos)).toEqual([uuid(1)]);
    expect(t.motor.estado().enviando).toBe(false);
    await t.conferir();
    t.disco.cheias.clear();
    await t.motor.enviar();
    expect(t.motor.estado().fila).toEqual([]);
    expect(t.ids(t.motor.estado().aceitos), 'reenviado sem duplicar a sobreposição').toEqual([uuid(1)]);
    expect(t.servidor.recebidos.size).toBe(1);
    await t.conferir();
  });

  it('push aceito e disco cheio já nos aceitos: nada muda (o item continua pendente na fila, igual ao disco)', async () => {
    const t = await montar();
    await t.motor.enfileirar(pedido(1));
    t.disco.cheias.add('sync:aceitos');
    await expect(t.motor.enviar()).rejects.toBeInstanceOf(DiscoCheio);
    expect(t.motor.estado().fila.map((i) => [i.id, i.situacao, i.tentativas])).toEqual([[uuid(1), 'pendente', 0]]);
    expect(t.motor.estado().aceitos).toEqual([]);
    await t.conferir();
  });

  it('marcar a falha de rede com disco cheio: tentativas e erro ficam como no disco', async () => {
    const t = await montar();
    await t.motor.enfileirar(pedido(1));
    t.servidor.online = false;
    await t.motor.enviar();
    expect(t.motor.estado().fila[0]?.tentativas).toBe(1);
    t.disco.cheias.add('sync:fila');
    await expect(t.motor.enviar()).rejects.toBeInstanceOf(DiscoCheio);
    expect(t.motor.estado().fila[0]?.tentativas).toBe(1);
    await t.conferir();
  });

  it('troca de geração com disco cheio nos aceitos: o aceito já voltou para a fila no disco (a fila vai primeiro) e nunca some', async () => {
    const t = await montar();
    await t.motor.sincronizar();
    t.passar(60_000);
    await t.motor.enfileirar(pedido(70));
    await t.motor.enviar();
    expect(t.ids(t.motor.estado().aceitos)).toEqual([uuid(70)]);
    t.servidor.geracao_base = G2;
    t.servidor.recebidos.clear();
    t.disco.cheias.add('sync:aceitos');
    expect(await t.motor.sincronizar()).toBe(false);
    expect(t.ids(t.motor.estado().fila)).toEqual([uuid(70)]);
    expect(t.ids(t.motor.estado().aceitos)).toEqual([uuid(70)]);
    await t.conferir();
    t.disco.cheias.clear();
    expect(await t.motor.sincronizar()).toBe(true);
    expect(t.servidor.recebidos.has(uuid(70))).toBe(true);
    expect(t.motor.estado().fila).toEqual([]);
    await t.conferir();
  });

  it('fila de arquivos e módulos ativos com disco cheio: a memória fica como o disco', async () => {
    const t = await montar();
    t.disco.cheias.add('sync:arquivos');
    await expect(t.motor.enfileirarArquivo({ id: uuid(9), modulo: 'core' })).rejects.toBeInstanceOf(DiscoCheio);
    expect(t.motor.estado().arquivos).toEqual([]);
    t.disco.cheias.clear();
    await t.motor.enfileirarArquivo({ id: uuid(9), modulo: 'core' });
    t.disco.cheias.add('sync:arquivos');
    await expect(t.motor.descartarArquivo(uuid(9))).rejects.toBeInstanceOf(DiscoCheio);
    expect(t.motor.estado().arquivos.map((a) => a.id)).toEqual([uuid(9)]);
    expect(t.motor.estado().arquivos).toEqual(await t.disco.armazenamento.ler('sync:arquivos'));
    t.disco.cheias.clear();
    t.disco.cheias.add('sync:modulos');
    await expect(t.motor.aplicarModulosAtivos(['core'])).rejects.toBeInstanceOf(DiscoCheio);
    expect(t.motor.estado().modulosAtivos).toEqual(await t.disco.armazenamento.ler('sync:modulos'));
    expect(t.motor.estado().modulosAtivos).toEqual(['core', 'vendedor']);
  });
});
