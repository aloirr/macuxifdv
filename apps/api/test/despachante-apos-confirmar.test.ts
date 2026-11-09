/**
 * T-0121 (N2): `ctx.aposConfirmar` no consumidor de evento, sem banco (worker e app falsos). O efeito fora do banco
 * (push do Expo) roda DEPOIS do commit da transação do consumo, sem transação do `macuxi_app` aberta (não segura o
 * horizonte do pull de nenhum tenant); a gravação do resultado usa uma transação curta nova do mesmo tenant; efeito que
 * lança desfaz o registro do consumo e o evento volta com espera; handler que lança não roda o efeito.
 */
import {
  defineModule,
  definirConsumidor,
  definirEvento,
  definirModuloApi,
  type AcessoBanco,
  type ClienteBanco,
} from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { criarDespachante } from '../src/despachante';

const TENANT = '11111111-1111-4111-8111-111111111111';
const EVENTO_ID = '22222222-2222-4222-8222-222222222222';
const NOME = 'core.despacho_efeito.ocorrido@1';
const EVENTO = definirEvento(NOME, z.object({ chave: z.string() }));

type Passo = string;

function montar(op: { efeito: (passos: Passo[]) => Promise<void>; handlerFalha?: boolean; desfazerFalha?: boolean }) {
  const passos: Passo[] = [];
  const updatesWorker: string[] = [];
  let abertas = 0;
  let nTx = 0;
  let lido = false;
  const worker = {
    connect: async () => ({
      query: async (sql: string) => {
        if (sql.includes('from plataforma.evento')) {
          const rows = lido
            ? []
            : [{ id: EVENTO_ID, tenant_id: TENANT, nome: NOME, modulo: 'core', payload: { chave: 'C-1' }, ocorrido_em: new Date('2026-11-08T12:00:00Z'), tentativas: 0, usuario_id: null, request_id: 'req-1' }];
          lido = true;
          return { rows, rowCount: rows.length };
        }
        if (sql.startsWith('update')) {
          updatesWorker.push(sql);
          return { rows: [{ tentativas: 1 }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
      release: () => undefined,
    }),
  };
  const app: AcessoBanco = {
    comTenant: async (tenant, fn) => {
      expect(tenant).toBe(TENANT);
      const id = (nTx += 1);
      abertas += 1;
      passos.push(`begin ${id}`);
      const db: ClienteBanco = {
        query: async (sql: string) => {
          if (sql.startsWith('delete from plataforma.evento_consumo')) {
            passos.push(`desfaz consumo tx ${id}`);
            if (op.desfazerFalha) throw new Error('banco fora');
          } else if (sql.startsWith('insert into plataforma.evento_consumo')) passos.push(`consumo tx ${id}`);
          else passos.push(`sql tx ${id}`);
          return { rows: [], rowCount: 1 };
        },
      };
      try {
        const r = await fn(db);
        passos.push(`commit ${id}`);
        return r;
      } catch (e) {
        passos.push(`rollback ${id}`);
        throw e;
      } finally {
        abertas -= 1;
      }
    },
    semTenant: async () => {
      throw new Error('não usado');
    },
  };
  const modulo = definirModuloApi({
    manifesto: defineModule({ id: 'core', versao: '1.0.0', perfis: ['admin'], consome: [NOME] }),
    consumidores: [
      definirConsumidor({
        evento: EVENTO,
        async executar(_p, ctx) {
          await ctx.db.query('select 1');
          ctx.aposConfirmar(async (c) => {
            passos.push(`efeito (transações abertas: ${abertas})`);
            await op.efeito(passos);
            await c.comTenant((db) => db.query('update core.notificacao set push_enviado_em = now()'));
          });
          if (op.handlerFalha) throw new Error('handler falhou');
        },
      }),
    ],
  });
  const d = criarDespachante({
    worker: worker as unknown as Parameters<typeof criarDespachante>[0]['worker'],
    app,
    modulos: [modulo],
    licencasNoTenant: async () => ({ ativosNoTenant: ['core'], parametros: {}, fuso: 'America/Manaus' }),
    agora: () => new Date('2026-11-08T12:00:05Z'),
  });
  return { d, passos, updatesWorker };
}

describe('T-0121 N2: efeito do consumidor depois do commit (ctx.aposConfirmar)', () => {
  it('o push roda depois do commit, sem transação do macuxi_app aberta, e grava o resultado numa transação curta nova', async () => {
    const { d, passos, updatesWorker } = montar({ efeito: async (p) => void p.push('rede') });
    const resumo = await d.ciclo();
    expect(resumo).toMatchObject({ lidos: 1, publicados: 1, comFalha: 0, entregas: 1 });
    expect(passos).toEqual([
      'begin 1',
      'consumo tx 1',
      'sql tx 1',
      'commit 1',
      'efeito (transações abertas: 0)',
      'rede',
      'begin 2',
      'sql tx 2',
      'commit 2',
    ]);
    expect(updatesWorker[0]).toContain('publicado_em = now()');
  });

  it('efeito que lança desfaz o registro do consumo e o evento volta com espera (no mínimo uma vez)', async () => {
    const { d, passos, updatesWorker } = montar({
      efeito: async () => {
        throw new Error('Push Expo recusado (HTTP 503).');
      },
    });
    const resumo = await d.ciclo();
    expect(resumo).toMatchObject({ lidos: 1, publicados: 0, comFalha: 1, entregas: 1 });
    expect(passos).toEqual(['begin 1', 'consumo tx 1', 'sql tx 1', 'commit 1', 'efeito (transações abertas: 0)', 'begin 2', 'desfaz consumo tx 2', 'commit 2']);
    expect(updatesWorker[0]).toContain('ultimo_erro = $2');
    expect(d.emEspera().has(EVENTO_ID)).toBe(true);
  });

  it('falha ao desfazer o consumo também conta como falha (fica no log; o evento volta com espera)', async () => {
    const { d, passos } = montar({
      efeito: async () => {
        throw new Error('rede fora');
      },
      desfazerFalha: true,
    });
    const resumo = await d.ciclo();
    expect(resumo).toMatchObject({ publicados: 0, comFalha: 1 });
    expect(passos.slice(-2)).toEqual(['desfaz consumo tx 2', 'rollback 2']);
  });

  it('handler que lança não roda o efeito agendado (a transação desfaz tudo)', async () => {
    const { d, passos } = montar({ efeito: async (p) => void p.push('rede'), handlerFalha: true });
    const resumo = await d.ciclo();
    expect(resumo).toMatchObject({ publicados: 0, comFalha: 1, entregas: 0 });
    expect(passos).toEqual(['begin 1', 'consumo tx 1', 'sql tx 1', 'rollback 1']);
  });
});
