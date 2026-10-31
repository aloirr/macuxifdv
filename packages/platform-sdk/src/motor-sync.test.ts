import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { defineModule } from './manifesto';
import { criarArmazenamentoEmMemoria, criarMotorSync, type EtapaSync } from './motor-sync';
import { criarServidorSyncSimulado } from './sync-simulado';
import { criarRegistroSync, definirEntidadeSync } from './sync';

const manifestos = [
  defineModule({ id: 'core', versao: '1.0.0', perfis: ['vendedor'], sync: ['cliente', 'visita'] }),
  defineModule({ id: 'vendedor', versao: '1.0.0', depende: ['core'], perfis: ['vendedor'], sync: ['pedido'] }),
];

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const AGORA = new Date('2026-10-12T14:00:00Z');

function montar(opcoes: { online?: () => boolean; etapas?: EtapaSync[] } = {}) {
  const registro = criarRegistroSync(manifestos);
  registro.registrar(definirEntidadeSync({ nome: 'cliente', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: z.object({ nome: z.string() }) }));
  registro.registrar(definirEntidadeSync({ nome: 'visita', modulo: 'core', direcao: 'ambos', conflito: 'somente_insercao', schema: z.object({ cliente_id: z.string() }) }));
  registro.registrar(definirEntidadeSync({ nome: 'pedido', modulo: 'vendedor', direcao: 'ambos', conflito: 'app_edita_ate_status', schema: z.object({ total_cents: z.number().int() }) }));
  const servidor = criarServidorSyncSimulado(registro, { modulosAtivos: ['core', 'vendedor'] });
  const armazenamento = criarArmazenamentoEmMemoria();
  const motor = criarMotorSync({ registro, armazenamento, transporte: servidor, agora: () => AGORA, ...opcoes });
  return { motor, servidor, armazenamento };
}

const pedido = (n: number, total = 1000) => ({ id: uuid(n), entidade: 'pedido', payload: { total_cents: total }, rotulo: `Pedido ${n}` });

describe('motor de sync do aparelho', () => {
  it('fila FIFO persistida; mesmo UUID não entra duas vezes; payload inválido é erro do app', async () => {
    const { motor, armazenamento } = montar();
    await motor.enfileirar(pedido(1));
    await motor.enfileirar({ id: uuid(2), entidade: 'visita', payload: { cliente_id: 'c1' } });
    await motor.enfileirar(pedido(1));
    expect(motor.estado().fila.map((i) => [i.id, i.modulo])).toEqual([
      [uuid(1), 'vendedor'],
      [uuid(2), 'core'],
    ]);
    await expect(motor.enfileirar({ id: uuid(3), entidade: 'cliente', payload: { nome: 'x' } })).rejects.toThrow(/não aceita envio/);
    await expect(motor.enfileirar({ id: uuid(4), entidade: 'pedido', payload: { total_cents: 1.5 } })).rejects.toThrow(/Payload inválido/);
    // outra instância (app reaberto) lê a mesma fila
    const reaberto = criarMotorSync({ registro: criarRegistroSync([]), armazenamento, transporte: { push: async () => [], pull: async () => ({ itens: [], proximo_cursor: null }) } });
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
    const etapas: EtapaSync[] = [{ id: 'politica', rotulo: 'Alçadas', modulo: 'vendedor', executar: async (ctx) => ctx.armazenamento.gravar('politica', { max: 5 }) }];
    const { motor, servidor, armazenamento } = montar({ etapas });
    servidor.tamanhoPagina = 2;
    const l = (id: string, t: string, deleted_at: string | null = null, nome = id) => ({ id, updated_at: t, deleted_at, nome });
    servidor.linhas.cliente = [l('c1', '2026-10-01T00:00:00Z'), l('c2', '2026-10-02T00:00:00Z'), l('c3', '2026-10-03T00:00:00Z')];
    await motor.aplicarModulosAtivos(['core', 'vendedor']);
    expect(await motor.sincronizar()).toBe(true);
    expect((await motor.linhas('cliente')).map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
    expect(await armazenamento.ler('mod:vendedor:politica')).toEqual({ max: 5 });
    servidor.linhas.cliente.push(l('c2', '2026-10-04T00:00:00Z', '2026-10-04T00:00:00Z'), l('c1', '2026-10-05T00:00:00Z', null, 'novo nome'));
    await motor.sincronizar();
    expect(await motor.linhas('cliente')).toEqual([{ id: 'c1', updated_at: '2026-10-05T00:00:00Z', deleted_at: null, nome: 'novo nome' }, expect.objectContaining({ id: 'c3' })]);
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
    expect(motor.estado().fila).toMatchObject([{ id: uuid(1), situacao: 'modulo_inativo', codigo: 'MODULO_INATIVO' }]);
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

  it('uma execução por vez: chamadas simultâneas de enviar compartilham a mesma promessa', async () => {
    const { motor, servidor } = montar();
    await motor.enfileirar(pedido(1));
    const [a, b] = [motor.enviar(), motor.enviar()];
    expect(a).toBe(b);
    await a;
    expect(servidor.chamadas.push).toBe(1);
  });
});
