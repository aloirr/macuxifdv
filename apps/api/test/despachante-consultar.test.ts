/**
 * `ctx.consultar`, `ctx.parametros()` e `ctx.fuso()` no consumidor de evento (ADR 0012; T-0060, RN-INT-14), sem banco:
 * worker e app falsos. Confere que a consulta roda na MESMA transação do consumo (mesmo `ClienteBanco`), só com as
 * `usaConsultas` do módulo consumidor, com o usuário de sistema, os parâmetros do tenant para o DONO e o `request_id`
 * do evento; e que a licença do tenant (efetivos) decide quem recebe.
 */
import { manifest as core } from '@macuxi/core/manifest';
import { CONSULTA_CADASTRO_CLIENTE } from '@macuxi/core/contracts';
import {
  defineModule,
  definirConsumidor,
  definirEvento,
  definirModuloApi,
  implementarConsulta,
  USUARIO_SISTEMA_ID,
  type AcessoBanco,
  type ClienteBanco,
  type ContextoConsulta,
  type ContextoConsumo,
  type ModuloId,
} from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { criarDespachante } from '../src/despachante';
import type { LicencasTenant } from '../src/licencas';

const TENANT = '11111111-1111-4111-8111-111111111111';
const NOME = 'core.despacho_consulta.ocorrido@1';
const EVENTO = definirEvento(NOME, z.object({ chave: z.string() }));
const CAMPOS_TEXTO = ['razao_social', 'nome_fantasia', 'documento', 'inscricao_estadual', 'telefone', 'email', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'cep'];
/** Cliente do lote sem nenhum dado além da chave (todos os campos do contrato presentes, nulos). */
const clienteVazio = (chave: string) => ({ chave, ...Object.fromEntries(CAMPOS_TEXTO.map((c) => [c, null])), latitude: null, longitude: null });

interface Rodada {
  consultas: { ctx: ContextoConsulta; entrada: unknown }[];
  consumos: { modulo: ModuloId; ctx: ContextoConsumo; resultado?: unknown; erro?: unknown }[];
  updates: unknown[][];
}

/** Banco falso: um `ClienteBanco` por transação (`comTenant`), para provar que a consulta usa o do consumo. */
function montar(op: { licencas: LicencasTenant; requestId?: string | null }) {
  const r: Rodada = { consultas: [], consumos: [], updates: [] };
  const linhas = [
    {
      id: '22222222-2222-4222-8222-222222222222',
      tenant_id: TENANT,
      nome: NOME,
      modulo: 'core',
      payload: { chave: 'C-1' },
      ocorrido_em: new Date('2026-11-02T12:00:00Z'),
      tentativas: 0,
      usuario_id: null,
      request_id: op.requestId === undefined ? 'req-1' : op.requestId,
    },
  ];
  let lido = false;
  const worker = {
    connect: async () => ({
      query: async (sql: string, valores?: unknown[]) => {
        if (sql.includes('from plataforma.evento')) {
          const rows = lido ? [] : linhas;
          lido = true;
          return { rows, rowCount: rows.length };
        }
        if (sql.startsWith('update')) {
          r.updates.push([sql, ...(valores ?? [])]);
          return { rows: [{ tentativas: 1 }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
      release: () => undefined,
    }),
  };
  const app: AcessoBanco = {
    comTenant: async (_t, fn) => {
      const db: ClienteBanco & { transacao: symbol } = {
        transacao: Symbol('tx'),
        query: async () => ({ rows: [], rowCount: 1 }),
      };
      return fn(db);
    },
    semTenant: async () => {
      throw new Error('não usado');
    },
  };

  const implementacao = implementarConsulta(CONSULTA_CADASTRO_CLIENTE, async (entrada, ctx) => {
    r.consultas.push({ ctx, entrada });
    return { resultados: entrada.clientes.map((c) => ({ chave: c.chave, completo: false, campos_faltantes: ['documento'] })) };
  });
  const consumidor = (id: 'integracao' | 'vendedor', usaConsultas: string[]) =>
    definirModuloApi({
      manifesto: defineModule({ id, versao: '1.0.0', depende: ['core'], perfis: ['admin'], consome: [NOME], usaConsultas }),
      consumidores: [
        definirConsumidor({
          evento: EVENTO,
          async executar(p: { chave: string }, ctx) {
            const reg: Rodada['consumos'][number] = { modulo: id, ctx };
            r.consumos.push(reg);
            try {
              reg.resultado = await ctx.consultar(CONSULTA_CADASTRO_CLIENTE, { clientes: [clienteVazio(p.chave) as never] });
            } catch (e) {
              reg.erro = e;
              throw e;
            }
          },
        }),
      ],
    });
  const modulos = [
    definirModuloApi({ manifesto: core, consultas: [implementacao] }),
    consumidor('integracao', ['core.cadastro_cliente@1']),
    consumidor('vendedor', []),
  ];
  const d = criarDespachante({
    worker: worker as unknown as Parameters<typeof criarDespachante>[0]['worker'],
    app,
    modulos,
    licencasNoTenant: async () => op.licencas,
    agora: () => new Date('2026-11-02T12:00:05Z'),
  });
  return { d, r };
}

const LICENCAS: LicencasTenant = {
  ativosNoTenant: ['core', 'integracao'],
  parametros: { core: { campos_obrigatorios: ['documento'] }, integracao: { lote_max: 10 } },
  fuso: 'America/Sao_Paulo',
};

describe('consumidor de evento: ctx.consultar, parametros e fuso (ADR 0012; RN-INT-14)', () => {
  it('RN-INT-14: o consumidor consulta o Core na mesma transação, com o usuário de sistema e os parâmetros do dono', async () => {
    const { d, r } = montar({ licencas: LICENCAS });
    const resumo = await d.ciclo();
    expect(resumo).toMatchObject({ lidos: 1, publicados: 1, comFalha: 0, entregas: 1 });
    // vendedor não está ativo no tenant: não recebe (RN-CORE-02/03)
    expect(r.consumos.map((c) => c.modulo)).toEqual(['integracao']);
    const consumo = r.consumos[0]!;
    expect(consumo.resultado).toEqual({ resultados: [{ chave: 'C-1', completo: false, campos_faltantes: ['documento'] }] });
    expect(consumo.ctx.parametros()).toEqual({ lote_max: 10 });
    expect(consumo.ctx.fuso()).toBe('America/Sao_Paulo');

    const consulta = r.consultas[0]!;
    expect(consulta.ctx.db).toBe(consumo.ctx.db);
    expect(consulta.ctx.usuario).toEqual({ id: USUARIO_SISTEMA_ID, tenant_id: TENANT, perfil: 'admin', modulos: ['core', 'integracao'] });
    expect(consulta.ctx.parametros()).toEqual({ campos_obrigatorios: ['documento'] });
    expect(consulta.ctx.requestId).toBe('req-1');
    // entrada validada pelo contrato antes da implementação
    expect((consulta.entrada as { clientes: { chave: string }[] }).clientes[0]!.chave).toBe('C-1');
  });

  it('sem request_id no envelope, a consulta usa o id do evento; fuso inválido = America/Manaus', async () => {
    const { d, r } = montar({ licencas: { ...LICENCAS, fuso: 'Lua/Base' }, requestId: null });
    await d.ciclo();
    expect(r.consultas[0]!.ctx.requestId).toBe('22222222-2222-4222-8222-222222222222');
    expect(r.consumos[0]!.ctx.fuso()).toBe('America/Manaus');
  });

  it('consulta fora de usaConsultas do consumidor = erro de programação: o consumo falha e o evento volta', async () => {
    const { d, r } = montar({ licencas: { ...LICENCAS, ativosNoTenant: ['core', 'vendedor'] } });
    const resumo = await d.ciclo();
    expect(resumo).toMatchObject({ lidos: 1, publicados: 0, comFalha: 1 });
    expect(r.consumos.map((c) => c.modulo)).toEqual(['vendedor']);
    expect(String(r.consumos[0]!.erro)).toMatch(/não a declara em usaConsultas/);
    expect(r.consultas).toHaveLength(0);
    expect(String(r.updates[0]![2])).toMatch(/^vendedor: /);
  });
});
