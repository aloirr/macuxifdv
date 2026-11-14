import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { defineModule } from './manifesto';
import {
  comLinhasEmChaveJson,
  criarArmazenamentoEmMemoria,
  criarMotorSync,
  type ArmazenamentoSync,
  type EtapaSync,
} from './motor-sync';
import { FABRICAS_ARMAZENAMENTO } from './motor-sync.fabricas';
import { criarServidorSyncSimulado } from './sync-simulado';
import { criarRegistroSync, definirEntidadeSync } from './sync';

const manifestos = [
  defineModule({ id: 'core', versao: '1.0.0', perfis: ['vendedor'], sync: ['cliente', 'visita'] }),
  defineModule({
    id: 'vendedor',
    versao: '1.0.0',
    depende: ['core'],
    perfis: ['vendedor'],
    sync: ['pedido'],
  }),
];

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const AGORA = new Date('2026-10-12T14:00:00Z');

describe.each(FABRICAS_ARMAZENAMENTO)('motor de sync do aparelho [%s]', (_nome, fabrica) => {
  function montar(opcoes: { online?: () => boolean; etapas?: EtapaSync[] } = {}) {
    const registro = criarRegistroSync(manifestos);
    registro.registrar(
      definirEntidadeSync({
        nome: 'cliente',
        modulo: 'core',
        direcao: 'pull',
        conflito: 'servidor_vence',
        schema: z.object({ nome: z.string() }),
      }),
    );
    registro.registrar(
      definirEntidadeSync({
        nome: 'visita',
        modulo: 'core',
        direcao: 'ambos',
        conflito: 'somente_insercao',
        schema: z.object({ cliente_id: z.string() }),
      }),
    );
    registro.registrar(
      definirEntidadeSync({
        nome: 'pedido',
        modulo: 'vendedor',
        direcao: 'ambos',
        conflito: 'app_edita_ate_status',
        schema: z.object({ total_cents: z.number().int() }),
      }),
    );
    const servidor = criarServidorSyncSimulado(registro, { modulosAtivos: ['core', 'vendedor'] });
    const armazenamento = fabrica();
    const motor = criarMotorSync({
      registro,
      armazenamento,
      transporte: servidor,
      agora: () => AGORA,
      ...opcoes,
    });
    return { motor, servidor, armazenamento };
  }

  const pedido = (n: number, total = 1000) => ({
    id: uuid(n),
    entidade: 'pedido',
    payload: { total_cents: total },
    rotulo: `Pedido ${n}`,
  });

  it('fila FIFO persistida; mesmo UUID não entra duas vezes; payload inválido é erro do app', async () => {
    const { motor, armazenamento } = montar();
    await motor.enfileirar(pedido(1));
    await motor.enfileirar({ id: uuid(2), entidade: 'visita', payload: { cliente_id: 'c1' } });
    await motor.enfileirar(pedido(1));
    expect(motor.estado().fila.map((i) => [i.id, i.modulo])).toEqual([
      [uuid(1), 'vendedor'],
      [uuid(2), 'core'],
    ]);
    await expect(
      motor.enfileirar({ id: uuid(3), entidade: 'cliente', payload: { nome: 'x' } }),
    ).rejects.toThrow(/não aceita envio/);
    await expect(
      motor.enfileirar({ id: uuid(4), entidade: 'pedido', payload: { total_cents: 1.5 } }),
    ).rejects.toThrow(/Payload inválido/);
    // outra instância (app reaberto) lê a mesma fila
    const reaberto = criarMotorSync({
      registro: criarRegistroSync([]),
      armazenamento,
      transporte: { push: async () => [], pull: async () => ({ itens: [], proximo_cursor: null }) },
    });
    await reaberto.carregar();
    expect(reaberto.estado().fila).toHaveLength(2);
  });

  it('envio aceito tira da fila; reenvio do mesmo UUID não duplica no servidor', async () => {
    const { motor, servidor } = montar();
    await motor.enfileirar(pedido(1));
    await motor.enviar();
    expect(motor.estado().fila).toEqual([]);
    await motor.enfileirar(pedido(1));
    await motor.enviar();
    expect(servidor.recebidos.size).toBe(1);
  });

  it('sem rede: conta tentativa, mantém a ordem e envia quando a rede volta', async () => {
    const { motor, servidor } = montar();
    await motor.enfileirar(pedido(1));
    await motor.enfileirar(pedido(2));
    servidor.online = false;
    await motor.enviar();
    expect(motor.estado().fila.map((i) => [i.situacao, i.tentativas, i.ultimo_erro])).toEqual([
      ['pendente', 1, 'Sem conexão com o servidor.'],
      ['pendente', 1, 'Sem conexão com o servidor.'],
    ]);
    servidor.online = true;
    await motor.enviar();
    expect(motor.estado().fila).toEqual([]);
    expect([...servidor.recebidos.keys()]).toEqual([uuid(1), uuid(2)]);
  });

  it('modo sem sinal: nada sai do aparelho e o sync completo avisa', async () => {
    const { motor, servidor } = montar({ online: () => false });
    await motor.enfileirar(pedido(1));
    await motor.enviar();
    expect(await motor.sincronizar()).toBe(false);
    expect(servidor.chamadas).toEqual({ push: 0, pull: 0 });
    expect(motor.estado().erro).toMatch(/Sem sinal/);
  });

  it('rejeição de regra vira "falhou" com o código; o usuário reenvia ou descarta', async () => {
    const { motor, servidor } = montar();
    servidor.rejeitar.set(uuid(1), { codigo: 'RN-VEN-10', mensagem: 'Desconto acima da alçada máxima.' });
    await motor.enfileirar(pedido(1));
    await motor.enfileirar(pedido(2));
    await motor.enviar();
    expect(motor.estado().fila).toMatchObject([{ id: uuid(1), situacao: 'falhou', codigo: 'RN-VEN-10' }]);
    await motor.enviar();
    expect(motor.estado().fila[0]!.tentativas).toBe(1); // falhou não vai sozinho
    servidor.rejeitar.clear();
    await motor.enviar({ incluirFalhos: true });
    expect(motor.estado().fila).toEqual([]);
  });

  it('pull por entidade de módulo efetivo com cursor, inclui removidos e roda as etapas do módulo', async () => {
    const etapas: EtapaSync[] = [
      {
        id: 'politica',
        rotulo: 'Alçadas',
        modulo: 'vendedor',
        executar: async (ctx) => ctx.armazenamento.gravar('politica', { max: 5 }),
      },
    ];
    const { motor, servidor, armazenamento } = montar({ etapas });
    servidor.tamanhoPagina = 2;
    const l = (id: string, t: string, deleted_at: string | null = null, nome = id) => ({
      id,
      updated_at: t,
      deleted_at,
      nome,
    });
    servidor.linhas.cliente = [
      l('c1', '2026-10-01T00:00:00Z'),
      l('c2', '2026-10-02T00:00:00Z'),
      l('c3', '2026-10-03T00:00:00Z'),
    ];
    await motor.aplicarModulosAtivos(['core', 'vendedor']);
    expect(await motor.sincronizar()).toBe(true);
    expect((await motor.linhas('cliente')).map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect(await armazenamento.ler('mod:vendedor:politica')).toEqual({ max: 5 });
    servidor.linhas.cliente.push(
      l('c2', '2026-10-04T00:00:00Z', '2026-10-04T00:00:00Z'),
      l('c1', '2026-10-05T00:00:00Z', null, 'novo nome'),
    );
    await motor.sincronizar();
    expect(await motor.linhas('cliente')).toEqual([
      { id: 'c1', updated_at: '2026-10-05T00:00:00Z', deleted_at: null, nome: 'novo nome' },
      expect.objectContaining({ id: 'c3' }),
    ]);
    expect(motor.estado()).toMatchObject({ sincronizado_em: AGORA.toISOString(), progresso: 1, erro: null });
  });

  it('RN-CORE-02: módulo desativado sem fila é apagado na hora; com fila, tenta enviar, mostra "módulo desativado" e só apaga com confirmação', async () => {
    const { motor, servidor, armazenamento } = montar();
    await motor.aplicarModulosAtivos(['core', 'vendedor']);
    await armazenamento.gravar('ent:pedido', { p1: { id: 'p1' } });
    await armazenamento.gravar('mod:vendedor:politica', { max: 5 });
    servidor.online = false;
    await motor.enfileirar(pedido(1));
    servidor.online = true;
    servidor.modulosAtivos = ['core'];
    await motor.aplicarModulosAtivos(['core']);
    expect(motor.estado().limpezaPendente).toEqual(['vendedor']);
    expect(motor.estado().fila).toMatchObject([
      { id: uuid(1), situacao: 'modulo_inativo', codigo: 'MODULO_INATIVO' },
    ]);
    expect(await armazenamento.ler('ent:pedido')).not.toBeNull(); // nada some em silêncio
    await motor.confirmarLimpeza('vendedor');
    expect(motor.estado().fila).toEqual([]);
    expect(motor.estado().limpezaPendente).toEqual([]);
    expect(await armazenamento.chaves('mod:vendedor:')).toEqual([]);
    expect(await armazenamento.ler('ent:pedido')).toBeNull();

    // core sem fila: sai sem perguntar (caso hipotético de módulo qualquer)
    await armazenamento.gravar('ent:visita', { v1: { id: 'v1' } });
    await motor.aplicarModulosAtivos([]);
    expect(motor.estado().limpezaPendente).toEqual([]);
    expect(await armazenamento.ler('ent:visita')).toBeNull();
  });

  it('módulo reativado antes da confirmação: itens voltam para a fila e são enviados', async () => {
    const { motor, servidor } = montar();
    await motor.aplicarModulosAtivos(['core', 'vendedor']);
    servidor.online = false;
    await motor.enfileirar(pedido(1));
    servidor.online = true;
    servidor.modulosAtivos = ['core'];
    await motor.aplicarModulosAtivos(['core']);
    servidor.modulosAtivos = ['core', 'vendedor'];
    await motor.aplicarModulosAtivos(['core', 'vendedor']);
    expect(motor.estado().limpezaPendente).toEqual([]);
    await motor.enviar();
    expect(motor.estado().fila).toEqual([]);
  });

  it('uma passada por vez: chamadas no meio de um envio esperam e compartilham UMA passada seguinte (sem push repetido)', async () => {
    const { motor, servidor } = montar();
    await motor.enfileirar(pedido(1));
    const [a, b, c] = [motor.enviar(), motor.enviar(), motor.enviar()];
    expect(b).not.toBe(a);
    expect(c).toBe(b);
    expect(motor.estado().enviando).toBe(true);
    await b;
    expect(servidor.chamadas.push, 'a passada seguinte não tem mais nada pendente').toBe(1);
    expect(motor.estado()).toMatchObject({ fila: [], enviando: false });
    await a;
    expect(motor.enviar()).not.toBe(b);
  });

  // ---------- ADR 0009 (D-2, escopo, sobreposição) ----------
  const linha = (id: string, t: string, deleted_at: string | null = null, nome = id) => ({
    id,
    updated_at: t,
    deleted_at,
    nome,
  });

  it('D-2 / ADR 0009 §7: pull 501 SYNC_NAO_IMPLEMENTADO pula a entidade com aviso, sem mexer no cursor, e o sync termina true', async () => {
    const { motor, servidor, armazenamento } = montar();
    servidor.semProvedor.add('visita');
    servidor.semProvedor.add('pedido');
    servidor.linhas.cliente = [linha('c1', '2026-10-01T00:00:00Z')];
    await motor.aplicarModulosAtivos(['core', 'vendedor']);
    expect(await motor.sincronizar()).toBe(true);
    expect(motor.estado()).toMatchObject({ erro: null, progresso: 1 });
    expect(motor.estado().avisos).toEqual([
      {
        entidade: 'pedido',
        codigo: 'SYNC_NAO_IMPLEMENTADO',
        mensagem: expect.stringMatching(/não disponível no servidor/),
      },
      {
        entidade: 'visita',
        codigo: 'SYNC_NAO_IMPLEMENTADO',
        mensagem: expect.stringMatching(/não disponível no servidor/),
      },
    ]);
    expect((await motor.linhas('cliente')).map((c) => c.id)).toEqual(['c1']);
    expect(await armazenamento.ler('sync:cursor:visita')).toBeNull();
    // o provedor chegou: o aviso some e a entidade vem desde o início
    servidor.semProvedor.clear();
    servidor.linhas.visita = [linha('v1', '2026-10-02T00:00:00Z')];
    expect(await motor.sincronizar()).toBe(true);
    expect(motor.estado().avisos).toEqual([]);
    expect((await motor.linhas('visita')).map((v) => v.id)).toEqual(['v1']);
  });

  it('ADR 0009 §7: outro erro de pull (500, 403) continua derrubando o sync', async () => {
    const { motor, servidor } = montar();
    await motor.aplicarModulosAtivos(['core']);
    servidor.pull = async () => {
      throw Object.assign(new Error('Erro interno.'), { status: 500, codigo: 'ERRO_INTERNO' });
    };
    expect(await motor.sincronizar()).toBe(false);
    expect(motor.estado().erro).toBe('Erro interno.');
  });

  it('D-2 / ADR 0009 §7: push rejeitado com SYNC_NAO_IMPLEMENTADO fica pendente (retentável) e não bloqueia o resto do lote', async () => {
    const { motor, servidor } = montar();
    servidor.semReceptor.add('pedido');
    await motor.enfileirar(pedido(1));
    await motor.enfileirar({ id: uuid(2), entidade: 'visita', payload: { cliente_id: 'c1' } });
    await motor.enviar();
    expect(motor.estado().fila).toMatchObject([
      { id: uuid(1), situacao: 'pendente', codigo: 'SYNC_NAO_IMPLEMENTADO', tentativas: 1 },
    ]);
    expect([...servidor.recebidos.keys()]).toEqual([uuid(2)]);
    // vai sozinho no próximo envio, quando o servidor passar a receber
    servidor.semReceptor.clear();
    await motor.enviar();
    expect(motor.estado().fila).toEqual([]);
    expect([...servidor.recebidos.keys()]).toEqual([uuid(2), uuid(1)]);
  });

  it('ADR 0009 §3: o pull nunca mexe na fila; pendentes(entidade) devolve o que ainda não foi aceito, na ordem', async () => {
    const { motor, servidor } = montar();
    await motor.aplicarModulosAtivos(['core', 'vendedor']);
    servidor.online = false;
    await motor.enfileirar({ id: uuid(1), entidade: 'visita', payload: { cliente_id: 'c1' } });
    await motor.enfileirar(pedido(2));
    await motor.enfileirar({ id: uuid(3), entidade: 'visita', payload: { cliente_id: 'c2' } });
    servidor.online = true;
    servidor.semReceptor.add('visita');
    servidor.linhas.visita = [{ id: uuid(1), updated_at: '2026-10-01T00:00:00Z', deleted_at: null }];
    expect(await motor.sincronizar()).toBe(true);
    expect(motor.pendentes('visita').map((i) => i.id)).toEqual([uuid(1), uuid(3)]);
    expect(motor.pendentes('pedido')).toEqual([]);
    expect((await motor.linhas('visita')).map((v) => v.id)).toEqual([uuid(1)]);
  });

  it('ADR 0009 §4 / RN-CORE-04: cliente que entra na carteira traz as linhas antigas; o que sai some do aparelho', async () => {
    const { motor, servidor, armazenamento } = montar();
    await motor.aplicarModulosAtivos(['core']);
    servidor.tamanhoPagina = 2;
    servidor.versoesEscopo.cliente = 'v1';
    servidor.linhas.cliente = [
      linha('c1', '2026-10-01T00:00:00Z'),
      linha('c2', '2026-10-02T00:00:00Z'),
      linha('c3', '2026-10-03T00:00:00Z'),
    ];
    expect(await motor.sincronizar()).toBe(true);
    expect(await armazenamento.ler('sync:escopo:cliente')).toBe('v1');
    // mesma versão: só o que mudou depois do cursor
    servidor.linhas.cliente.push(linha('c4', '2026-10-04T00:00:00Z'));
    const antes = servidor.chamadas.pull;
    await motor.sincronizar();
    expect(servidor.chamadas.pull - antes).toBe(2); // cliente + visita (sem página extra)
    // carteira mudou: c0 (antigo, atrás do cursor) entrou; c2 saiu (o servidor não manda remoção)
    servidor.versoesEscopo.cliente = 'v2';
    servidor.linhas.cliente = [
      linha('c0', '2026-09-01T00:00:00Z'),
      linha('c1', '2026-10-01T00:00:00Z'),
      linha('c3', '2026-10-03T00:00:00Z'),
      linha('c4', '2026-10-04T00:00:00Z'),
    ];
    expect(await motor.sincronizar()).toBe(true);
    expect((await motor.linhas('cliente')).map((c) => c.id).sort()).toEqual(['c0', 'c1', 'c3', 'c4']);
    expect(await armazenamento.ler('sync:escopo:cliente')).toBe('v2');
    expect(await armazenamento.ler('sync:cursor:cliente')).toBe('2026-10-04T00:00:00Z|c4');
  });

  it('ADR 0009 §4: ressincronização interrompida (queda de rede) recomeça na próxima passada, sem apagar nada antes do fim', async () => {
    const { motor, servidor } = montar();
    await motor.aplicarModulosAtivos(['core']);
    servidor.tamanhoPagina = 1;
    servidor.versoesEscopo.cliente = 'v1';
    servidor.linhas.cliente = [linha('c1', '2026-10-01T00:00:00Z'), linha('c2', '2026-10-02T00:00:00Z')];
    await motor.sincronizar();
    servidor.versoesEscopo.cliente = 'v2';
    servidor.linhas.cliente = [linha('c2', '2026-10-02T00:00:00Z'), linha('c3', '2026-10-03T00:00:00Z')];
    const pull = servidor.pull;
    let chamadas = 0;
    servidor.pull = async (e, c) => {
      if (e === 'cliente' && ++chamadas === 3) throw new Error('Sem conexão com o servidor.');
      return pull(e, c);
    };
    expect(await motor.sincronizar()).toBe(false);
    expect((await motor.linhas('cliente')).map((c) => c.id).sort()).toEqual(['c1', 'c2']); // nada apagado no meio
    servidor.pull = pull;
    expect(await motor.sincronizar()).toBe(true);
    expect((await motor.linhas('cliente')).map((c) => c.id).sort()).toEqual(['c2', 'c3']);
  });

  it('T-0008 P1: linhasPorIds devolve na ordem pedida e ignora ids ausentes', async () => {
    const { motor, servidor } = montar();
    await motor.aplicarModulosAtivos(['core']);
    servidor.linhas.cliente = [linha('c1', '2026-10-01T00:00:00Z'), linha('c2', '2026-10-02T00:00:00Z')];
    await motor.sincronizar();
    expect((await motor.linhasPorIds('cliente', ['c2', 'x', 'c1'])).map((c) => c.id)).toEqual(['c2', 'c1']);
  });

  it('RN-CORE-02: módulo desativado também perde a versão do escopo das entidades', async () => {
    const { motor, servidor, armazenamento } = montar();
    await motor.aplicarModulosAtivos(['core', 'vendedor']);
    servidor.versoesEscopo.pedido = 'v1';
    servidor.linhas.pedido = [linha('p1', '2026-10-01T00:00:00Z')];
    await motor.sincronizar();
    expect(await armazenamento.ler('sync:escopo:pedido')).toBe('v1');
    await motor.aplicarModulosAtivos(['core']);
    expect(await armazenamento.ler('sync:escopo:pedido')).toBeNull();
    expect(await motor.linhas('pedido')).toEqual([]);
  });
});

describe('T-0008 P1: extensões opcionais do armazenamento', () => {
  const pedido = (n: number) => ({ id: uuid(n), entidade: 'pedido', payload: { total_cents: 1000 } });
  const registro = () => {
    const r = criarRegistroSync(manifestos);
    r.registrar(
      definirEntidadeSync({
        nome: 'pedido',
        modulo: 'vendedor',
        direcao: 'ambos',
        conflito: 'app_edita_ate_status',
        schema: z.object({ total_cents: z.number().int() }),
      }),
    );
    return r;
  };

  it('RN-CORE-02: limpeza do módulo roda em emTransacao (com o tx) e chama removerModulo', async () => {
    const base = comLinhasEmChaveJson(criarArmazenamentoEmMemoria());
    const chamadas: string[] = [];
    const armazenamento: ArmazenamentoSync = {
      ...base,
      async emTransacao(fn) {
        chamadas.push('inicio');
        const tx: ArmazenamentoSync = {
          ...base,
          removerModulo: async (m) => void chamadas.push(`remover:${m}`),
        };
        const r = await fn(tx);
        chamadas.push('fim');
        return r;
      },
    };
    const reg = registro();
    const servidor = criarServidorSyncSimulado(reg, { modulosAtivos: ['core', 'vendedor'] });
    const motor = criarMotorSync({ registro: reg, armazenamento, transporte: servidor, agora: () => AGORA });
    await motor.aplicarModulosAtivos(['core', 'vendedor']);
    servidor.online = false;
    await motor.enfileirar(pedido(1));
    servidor.online = true;
    servidor.modulosAtivos = ['core'];
    await motor.aplicarModulosAtivos(['core']);
    expect(chamadas).toEqual([]); // com fila: espera a confirmação do usuário
    await motor.confirmarLimpeza('vendedor');
    expect(chamadas).toEqual(['inicio', 'remover:vendedor', 'fim']);
    expect(motor.estado()).toMatchObject({ fila: [], limpezaPendente: [] });
    expect(await armazenamento.ler('sync:fila')).toEqual([]);
  });

  it('comLinhasEmChaveJson: aplicar é idempotente, remove as com deleted_at e cursor null mantém o atual', async () => {
    const a = comLinhasEmChaveJson(criarArmazenamentoEmMemoria());
    const l = { id: 'x', updated_at: '2026-10-01T00:00:00Z', deleted_at: null };
    await a.linhas!.aplicar('cliente', [l], 'c1');
    await a.linhas!.aplicar('cliente', [l], null);
    expect(await a.linhas!.contar('cliente')).toBe(1);
    expect(await a.ler('sync:cursor:cliente')).toBe('c1');
    await a.linhas!.aplicar('cliente', [{ ...l, deleted_at: '2026-10-02T00:00:00Z' }], 'c2');
    expect(await a.linhas!.ids('cliente')).toEqual([]);
    await a.linhas!.limpar('cliente');
    expect(await a.ler('sync:cursor:cliente')).toBeNull();
  });
});
