/**
 * ADR 0021 (T-0079): o motor percebe a base recriada ou restaurada pela `geracao_base` do pull e das novidades.
 * Critérios: geração igual → nada muda; diferente → a cópia local some e a fila sobrevive (reenviada primeiro);
 * servidor/app sem o campo → nada quebra; dois aparelhos de tenants diferentes não se afetam.
 * Caso do teste de campo de 04/11 (R-20261104-195513): pedido 000011 que só existe no aparelho depois do `--recriar`.
 */
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { defineModule } from './manifesto';
import { criarMotorSync, type EtapaSync } from './motor-sync';
import { FABRICAS_ARMAZENAMENTO } from './motor-sync.fabricas';
import { criarServidorSyncSimulado } from './sync-simulado';
import { criarRegistroSync, definirEntidadeSync, type LinhaSync } from './sync';

const manifestos = [
  defineModule({ id: 'core', versao: '1.0.0', perfis: ['vendedor'], sync: ['cliente'] }),
  defineModule({ id: 'vendedor', versao: '1.0.0', depende: ['core'], perfis: ['vendedor'], sync: ['pedido'] }),
];
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T0 = Date.parse('2026-11-04T12:00:00Z');
const MIN = 60_000;
const G1 = '11111111-1111-4111-8111-111111111111';
const G2 = '22222222-2222-4222-8222-222222222222';
const G3 = '33333333-3333-4333-8333-333333333333';

type LinhaPedido = LinhaSync & { numero: string | null; cliente: string };

describe.each(FABRICAS_ARMAZENAMENTO)('motor: geração da base [%s] (ADR 0021)', (_nome, fabrica) => {
  async function montar(o: { geracao?: string | null; comNovidades?: boolean; etapas?: EtapaSync[] } = {}) {
    let agora = T0;
    const registro = criarRegistroSync(manifestos);
    registro.registrar(definirEntidadeSync({ nome: 'cliente', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: z.object({}).passthrough() }));
    registro.registrar(definirEntidadeSync({ nome: 'pedido', modulo: 'vendedor', direcao: 'ambos', conflito: 'app_edita_ate_status', schema: z.object({}).passthrough() }));
    const servidor = criarServidorSyncSimulado(registro, { modulosAtivos: ['core', 'vendedor'], comNovidades: o.comNovidades });
    servidor.relogio = () => new Date(agora);
    servidor.geracao_base = o.geracao === undefined ? G1 : o.geracao;
    const pedido = (n: number, numero: string | null, quando = agora - 30 * MIN, cliente = 'c1'): LinhaPedido => ({
      id: uuid(n),
      updated_at: new Date(quando).toISOString(),
      deleted_at: null,
      numero,
      cliente,
    });
    const cliente = (n: number): LinhaSync => ({ id: uuid(100 + n), updated_at: new Date(agora - 60 * MIN).toISOString(), deleted_at: null });
    // base antiga: o pedido do aparelho de 02/11 ganhou 000011 (o seed tinha 10)
    servidor.linhas = { cliente: [cliente(1)], pedido: [pedido(1, '000010'), pedido(2, '000011')] };
    const armazenamento = fabrica();
    const motor = criarMotorSync({ registro, armazenamento, transporte: servidor, agora: () => new Date(agora), etapas: o.etapas });
    await motor.carregar();
    await motor.aplicarModulosAtivos(['core', 'vendedor']);
    const avancar = (ms: number) => (agora += ms);
    /** `seed demo --recriar`: base nova, outra geração, contador de volta ao 11 (o p05 do seed) e nada recebido. */
    const recriarBase = (geracao: string | null = G2) => {
      servidor.geracao_base = geracao;
      servidor.recebidos.clear();
      servidor.linhas = { cliente: [cliente(1)], pedido: [pedido(10, '000010', agora - 5 * MIN), pedido(11, '000011', agora - 5 * MIN)] };
    };
    const numeros = async () => (await motor.linhas<LinhaPedido>('pedido')).map((l) => l.numero).sort();
    return { motor, servidor, armazenamento, avancar, recriarBase, numeros, pedido, agora: () => agora };
  }

  it('primeira sincronização: adota a geração e não apaga nada; depois, geração igual = pull incremental de sempre', async () => {
    const t = await montar();
    expect(await t.motor.sincronizar()).toBe(true);
    expect(await t.armazenamento.ler('sync:geracao_base')).toBe(G1);
    expect(await t.numeros()).toEqual(['000010', '000011']);
    t.avancar(10 * MIN);
    t.servidor.linhas.pedido!.push(t.pedido(3, '000012', t.agora() - MIN));
    Object.assign(t.servidor.chamadas, { push: 0, pull: 0 });
    expect(await t.motor.sincronizar()).toBe(true);
    expect(t.servidor.chamadas.pull).toBe(2); // uma página por entidade, do cursor guardado
    expect(await t.numeros()).toEqual(['000010', '000011', '000012']);
  });

  it('base recriada: o pedido que só existe no aparelho some e nenhum número aparece duas vezes', async () => {
    const t = await montar();
    await t.motor.sincronizar();
    t.avancar(MIN);
    t.recriarBase();
    expect(await t.motor.sincronizar()).toBe(true);
    const ids = (await t.motor.linhas('pedido')).map((l) => l.id).sort();
    expect(ids).toEqual([uuid(10), uuid(11)]);
    expect(await t.numeros()).toEqual(['000010', '000011']);
    expect(await t.armazenamento.ler('sync:geracao_base')).toBe(G2);
    expect(t.motor.estado().erro).toBeNull();
  });

  it('a fila sobrevive: é reenviada à base nova ANTES de apagar, e o que a base nova recusa fica visível', async () => {
    const t = await montar();
    await t.motor.sincronizar();
    t.avancar(MIN);
    t.servidor.online = false;
    await t.motor.enfileirar({ id: uuid(50), entidade: 'pedido', payload: { cliente: 'c1' }, rotulo: 'Pedido · Atacadinho' });
    await t.motor.enfileirar({ id: uuid(51), entidade: 'pedido', payload: { cliente: 'c-antigo' }, rotulo: 'Pedido · Cliente que não existe mais' });
    t.servidor.online = true;
    t.recriarBase();
    t.servidor.rejeitar.set(uuid(51), { codigo: 'CLIENTE_NAO_ENCONTRADO', mensagem: 'Cliente não encontrado.' });
    expect(await t.motor.sincronizar()).toBe(true);
    expect(t.servidor.recebidos.has(uuid(50))).toBe(true);
    const fila = t.motor.estado().fila;
    expect(fila.map((i) => [i.id, i.situacao, i.codigo])).toEqual([[uuid(51), 'falhou', 'CLIENTE_NAO_ENCONTRADO']]);
    expect(await t.armazenamento.ler<unknown[]>('sync:fila')).toHaveLength(1);
  });

  it('falha de rede no envio da troca: a fila fica inteira (pendente), a cópia local é trocada e o item vai no próximo envio', async () => {
    const t = await montar();
    await t.motor.sincronizar();
    t.servidor.online = false;
    await t.motor.enfileirar({ id: uuid(60), entidade: 'pedido', payload: { cliente: 'c1' } });
    t.servidor.online = true;
    t.recriarBase();
    // o push cai (rede) — o motor conta a tentativa e para; o pull segue e percebe a troca
    const push = t.servidor.push.bind(t.servidor);
    let falhar = true;
    t.servidor.push = async (itens) => {
      if (falhar) throw new Error('Sem conexão com o servidor.');
      return push(itens);
    };
    expect(await t.motor.sincronizar()).toBe(true);
    expect(t.motor.estado().fila.map((i) => [i.id, i.situacao])).toEqual([[uuid(60), 'pendente']]);
    expect(await t.numeros()).toEqual(['000010', '000011']);
    falhar = false;
    await t.motor.enviar();
    expect(t.servidor.recebidos.has(uuid(60))).toBe(true);
    expect(t.motor.estado().fila).toHaveLength(0);
  });

  it('aceito ainda sobreposto (a base antiga recebeu, a nova não) volta para a fila e é reenviado', async () => {
    const t = await montar();
    await t.motor.sincronizar();
    t.avancar(MIN);
    await t.motor.enfileirar({ id: uuid(70), entidade: 'pedido', payload: { cliente: 'c1' } });
    await t.motor.enviar();
    expect(t.motor.estado().aceitos.map((a) => a.id)).toEqual([uuid(70)]);
    t.recriarBase();
    expect(await t.motor.sincronizar()).toBe(true);
    expect(t.servidor.recebidos.has(uuid(70))).toBe(true);
    expect(t.motor.estado().fila).toHaveLength(0);
  });

  it('servidor sem o campo (antes da migração) e app que nunca viu geração: nada muda, nada é gravado', async () => {
    const t = await montar({ geracao: null });
    await t.motor.sincronizar();
    expect(await t.armazenamento.ler('sync:geracao_base')).toBeNull();
    t.recriarBase(null);
    await t.motor.sincronizar();
    // sem marcador o fantasma continua (o comportamento de antes): é o caso que a ADR 0021 resolve com a migração
    expect((await t.motor.linhas('pedido')).map((l) => l.id).sort()).toEqual([uuid(1), uuid(2), uuid(10), uuid(11)]);
  });

  it('servidor que deixa de mandar o campo (volta de versão) não apaga nada nem esquece a geração', async () => {
    const t = await montar();
    await t.motor.sincronizar();
    t.servidor.geracao_base = null;
    t.avancar(MIN);
    await t.motor.sincronizar();
    expect(await t.armazenamento.ler('sync:geracao_base')).toBe(G1);
    expect(await t.numeros()).toEqual(['000010', '000011']);
  });

  it('atualização leve (novidades) também percebe a troca e faz o pull completo', async () => {
    const t = await montar({ comNovidades: true });
    await t.motor.sincronizar();
    t.avancar(30 * MIN);
    t.recriarBase();
    expect(await t.motor.sincronizarNovidades()).toBe(true);
    expect(await t.numeros()).toEqual(['000010', '000011']);
    expect((await t.motor.linhas('pedido')).map((l) => l.id).sort()).toEqual([uuid(10), uuid(11)]);
    expect(await t.armazenamento.ler('sync:geracao_base')).toBe(G2);
    // a próxima leve volta ao normal: 1 requisição
    t.avancar(30 * MIN);
    Object.assign(t.servidor.chamadas, { push: 0, pull: 0, novidades: 0 });
    expect(await t.motor.sincronizarNovidades()).toBe(true);
    expect(t.servidor.chamadas).toEqual({ push: 0, pull: 0, novidades: 1 });
  });

  it('a etapa do módulo limpa o próprio cache (aoTrocarGeracao); o resto de mod:<m>: fica', async () => {
    const chamadas: string[] = [];
    const etapa: EtapaSync = {
      id: 'vendedor-carga',
      rotulo: 'Pedidos',
      modulo: 'vendedor',
      executar: async () => undefined,
      aoTrocarGeracao: async (ctx) => {
        chamadas.push('vendedor');
        await ctx.armazenamento.remover('pedidos');
      },
    };
    const t = await montar({ etapas: [etapa] });
    await t.motor.sincronizar();
    const mod = t.motor.armazenamentoDoModulo('vendedor');
    await mod.gravar('pedidos', [{ numero: '000011' }]);
    await mod.gravar('rascunhos', { r1: { cliente: 'c1' } });
    t.recriarBase();
    await t.motor.sincronizar();
    expect(chamadas).toEqual(['vendedor']);
    expect(await mod.ler('pedidos')).toBeNull();
    expect(await mod.ler('rascunhos')).toEqual({ r1: { cliente: 'c1' } });
  });

  it('geração que muda de novo na mesma passada: termina com erro, a fila fica e a próxima sincronização resolve', async () => {
    const t = await montar();
    await t.motor.sincronizar();
    t.recriarBase();
    const pull = t.servidor.pull.bind(t.servidor);
    let n = 0;
    t.servidor.pull = async (e, c) => {
      const p = await pull(e, c);
      n++;
      // a primeira página traz G2 (troca); depois, a base gira de novo no meio da passada
      return n >= 2 ? { ...p, geracao_base: G3 } : p;
    };
    expect(await t.motor.sincronizar()).toBe(false);
    expect(t.motor.estado().erro).toMatch(/base do servidor mudou/i);
    t.servidor.pull = pull;
    t.servidor.geracao_base = G3;
    expect(await t.motor.sincronizar()).toBe(true);
    expect(await t.armazenamento.ler('sync:geracao_base')).toBe(G3);
    expect(await t.numeros()).toEqual(['000010', '000011']);
  });

  it('dois aparelhos de tenants diferentes: a troca de um não mexe no outro', async () => {
    const a = await montar();
    const b = await montar({ geracao: G3 });
    await a.motor.sincronizar();
    await b.motor.sincronizar();
    a.recriarBase();
    await a.motor.sincronizar();
    await b.motor.sincronizar();
    expect(await a.armazenamento.ler('sync:geracao_base')).toBe(G2);
    expect(await b.armazenamento.ler('sync:geracao_base')).toBe(G3);
    expect((await b.motor.linhas('pedido')).map((l) => l.id).sort()).toEqual([uuid(1), uuid(2)]);
  });

  it('limparAparelho (RN-CORE-15) também esquece a geração', async () => {
    const t = await montar();
    await t.motor.sincronizar();
    await t.motor.limparAparelho();
    expect(await t.armazenamento.ler('sync:geracao_base')).toBeNull();
  });
});
