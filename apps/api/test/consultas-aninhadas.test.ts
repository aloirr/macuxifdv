/**
 * T-0149 (complemento da ADR 0012): `ContextoConsulta.consultar` — uma consulta pública chama outra. O caso real:
 * `catalogo.precos_cliente@1` (pedida pelo Vendedor) lê `core.filiais@1` para achar a filial do cliente (RN-CORE-39).
 * O consumidor da consulta aninhada é o DONO da consulta em execução (o Catálogo declara `core.filiais@1` em `usaConsultas`;
 * o Vendedor não precisa). Mesmo `db`, mesmo usuário, sem elevação; ciclo e cadeia longa = erro de programação.
 * Sem banco: cliente falso que responde por padrão de SQL. A prova contra o Postgres fica nos `*.db.test.ts` do Catálogo (CI).
 */
import { CONSULTA_PRECOS_CLIENTE } from '@macuxi/catalogo/contracts';
import { manifest as catalogo } from '@macuxi/catalogo/manifest';
import { CONSULTA_FILIAIS } from '@macuxi/core/contracts';
import { manifest as core } from '@macuxi/core/manifest';
import { manifest as vendedor } from '@macuxi/vendedor/manifest';
import {
  ConsultaIndisponivel,
  defineModule,
  definirConsulta,
  implementarConsulta,
  type ClienteBanco,
  type ImplementacaoConsulta,
  type ModuloId,
  type UsuarioDaRequisicao,
} from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MODULOS_API } from '../src/modulos';
import { PROFUNDIDADE_MAXIMA_CONSULTAS, registroDeConsultas, transacaoTenant, type OrigemTransacao } from '../src/outbox';

const TENANT = '0a000000-0000-4000-8000-000000000001';
const CLIENTE = '0c000000-0000-4000-8000-000000000001';
const PRODUTO = '0e000000-0000-4000-8000-000000000001';
const TABELA = '0f000000-0000-4000-8000-000000000001';
const F_PADRAO = '1f000000-0000-4000-8000-000000000001';
const F_BVB = '1f000000-0000-4000-8000-000000000002';

/** Consultas de teste que chamam outras, alternando Catálogo e Core (consulta é sempre ENTRE módulos): cadeia e ciclo. */
const vazio = z.object({}).strict();
const ELOS = Array.from({ length: PROFUNDIDADE_MAXIMA_CONSULTAS + 2 }, (_, i) =>
  definirConsulta({ nome: `${i % 2 === 0 ? 'catalogo' : 'core'}.elo_${i}@1`, entrada: vazio, saida: z.object({ nivel: z.number() }).strict() }),
);
const CICLO_CAT = definirConsulta({ nome: 'catalogo.ciclo@1', entrada: vazio, saida: vazio });
const CICLO_CORE = definirConsulta({ nome: 'core.ciclo@1', entrada: vazio, saida: vazio });
/** Do Catálogo; chama `core.nao_declarada@1`, que o Catálogo NÃO declara em usaConsultas. */
const FORA = definirConsulta({ nome: 'catalogo.fora@1', entrada: vazio, saida: vazio });
const NAO_DECLARADA = definirConsulta({ nome: 'core.nao_declarada@1', entrada: vazio, saida: vazio });

const doModulo = (m: string, nomes: readonly string[]) => nomes.filter((n) => n.startsWith(`${m}.`));
const nomesElos = ELOS.map((e) => e.nome);
const manifestos = [
  defineModule({
    ...core,
    ofereceConsultas: [...(core.ofereceConsultas ?? []), ...doModulo('core', nomesElos), CICLO_CORE.nome, NAO_DECLARADA.nome],
    usaConsultasOpcionais: [...(core.usaConsultasOpcionais ?? []), ...doModulo('catalogo', nomesElos), CICLO_CAT.nome],
  }),
  defineModule({
    ...catalogo,
    ofereceConsultas: [...(catalogo.ofereceConsultas ?? []), ...doModulo('catalogo', nomesElos), CICLO_CAT.nome, FORA.nome],
    usaConsultas: [...(catalogo.usaConsultas ?? []), ...doModulo('core', nomesElos), CICLO_CORE.nome],
  }),
  defineModule({ ...vendedor, usaConsultas: [...(vendedor.usaConsultas ?? []), ELOS[0]!.nome, CICLO_CAT.nome, FORA.nome] }),
];

type Visto = { consulta: string; usuario: string; perfil: string; db: ClienteBanco };
const vistos: Visto[] = [];
const filiais = implementarConsulta(CONSULTA_FILIAIS, async (e, ctx) => {
  vistos.push({ consulta: 'core.filiais@1', usuario: ctx.usuario.id, perfil: ctx.usuario.perfil, db: ctx.db });
  return {
    padrao_id: F_PADRAO,
    filiais: [],
    clientes: e.cliente_ids.map((c) => ({ cliente_id: c, filial_id: F_BVB })),
    por_external_id: [],
    da_carteira: null,
  };
});
const elos: ImplementacaoConsulta[] = ELOS.map((def, i) =>
  implementarConsulta(def, async (_e, ctx) => {
    const prox = ELOS[i + 1];
    return prox ? ctx.consultar!(prox, {}) : { nivel: i };
  }),
);
const ciclos = [implementarConsulta(CICLO_CAT, async (_e, ctx) => ctx.consultar!(CICLO_CORE, {})), implementarConsulta(CICLO_CORE, async (_e, ctx) => ctx.consultar!(CICLO_CAT, {}))];
const fora = [implementarConsulta(FORA, async (_e, ctx) => ctx.consultar!(NAO_DECLARADA, {})), implementarConsulta(NAO_DECLARADA, async () => ({}))];

const precosReal = MODULOS_API.find((m) => m.manifesto.id === 'catalogo')!.consultas!.find((c) => c.consulta.nome === CONSULTA_PRECOS_CLIENTE.nome)!;
const registro = registroDeConsultas([{ consultas: [precosReal, filiais, ...elos, ...ciclos, ...fora] }]);

const sql: string[] = [];
const db: ClienteBanco = {
  query: async <R>(q: string) => {
    sql.push(q);
    const linhas = (rows: unknown[]) => ({ rows: rows as R[], rowCount: rows.length });
    if (q.includes('from catalogo.cliente_tabela_preco')) return linhas([{ tabela_preco_id: TABELA, nome: 'Tabela BV' }]);
    if (q.includes('select exists')) return linhas([{ tem: true }]);
    if (q.includes('preco_cents::float8 as preco_cents'))
      return linhas([{ produto_id: PRODUTO, preco_cents: 1050, vigencia_inicio: null, vigencia_fim: null, unidade: null }]);
    return linhas([]);
  },
};

const usuario = (modulos: readonly ModuloId[]): UsuarioDaRequisicao =>
  ({ id: '0b000000-0000-4000-8000-000000000001', tenant_id: TENANT, perfil: 'vendedor', modulos }) as unknown as UsuarioDaRequisicao;
const origem = (o: Partial<OrigemTransacao> = {}): OrigemTransacao => ({
  manifestos,
  modulo: 'vendedor',
  tenantId: TENANT,
  usuarioId: '0b000000-0000-4000-8000-000000000001',
  requestId: 'req-1',
  agora: () => new Date('2026-11-10T15:00:00Z'),
  usuario: usuario(['core', 'catalogo', 'vendedor']),
  consultas: registro,
  ...o,
});

describe('ContextoConsulta.consultar (T-0149): consulta pública chamando outra', () => {
  it('RN-CORE-39: precos_cliente@1 (do Vendedor) lê core.filiais@1 e devolve o preço da filial do cliente, no mesmo db e com o mesmo usuário', async () => {
    vistos.length = 0;
    sql.length = 0;
    const tx = transacaoTenant(db, origem());
    const r = await tx.consultar(CONSULTA_PRECOS_CLIENTE, { cliente_id: CLIENTE, produto_ids: [PRODUTO], em: '2026-11-10T15:00:00.000Z' });
    expect(r).toMatchObject({ tabela_preco_id: TABELA, filial_id: F_BVB, filial_origem: 'cliente' });
    expect(r.itens).toHaveLength(1);
    expect(r.itens[0]).toMatchObject({ produto_id: PRODUTO, preco_cents: 1050 });
    // a consulta do Core rodou na MESMA transação e com o usuário da requisição (sem usuário de sistema, sem elevação)
    expect(vistos).toEqual([{ consulta: 'core.filiais@1', usuario: '0b000000-0000-4000-8000-000000000001', perfil: 'vendedor', db }]);
    expect(sql.some((q) => q.includes('filial_id = $3::uuid'))).toBe(true);
  });

  it('o consumidor da aninhada é o DONO da consulta: o Vendedor não declara core.filiais@1 e mesmo assim funciona', async () => {
    // O Vendedor real declara core.filiais@1 para uso PRÓPRIO (receber.ts grava a filial do pedido, RN-CORE-39); aqui ele é tirado
    // de propósito para provar que a aninhada dentro de precos_cliente@1 é autorizada pelo manifesto do Catálogo, não pelo do Vendedor.
    expect(catalogo.usaConsultas).toContain(CONSULTA_FILIAIS.nome);
    const semFiliais = manifestos.map((m) =>
      m.id === 'vendedor' ? defineModule({ ...m, usaConsultas: (m.usaConsultas ?? []).filter((n) => n !== CONSULTA_FILIAIS.nome) }) : m,
    );
    expect(semFiliais.find((m) => m.id === 'vendedor')!.usaConsultas).not.toContain(CONSULTA_FILIAIS.nome);
    vistos.length = 0;
    const tx = transacaoTenant(db, origem({ manifestos: semFiliais }));
    const r = await tx.consultar(CONSULTA_PRECOS_CLIENTE, { cliente_id: CLIENTE, produto_ids: [PRODUTO], em: '2026-11-10T15:00:00.000Z' });
    expect(r).toMatchObject({ filial_id: F_BVB, filial_origem: 'cliente' });
    expect(vistos.map((v) => v.consulta)).toEqual(['core.filiais@1']);
    // e o próprio Vendedor, sem declarar, não chama core.filiais@1 direto
    await expect(tx.consultar(CONSULTA_FILIAIS, { cliente_ids: [CLIENTE], external_ids: [], escopo: 'tenant' })).rejects.toThrow();
  });

  it('consulta que o dono não declara em usaConsultas = erro de programação', async () => {
    const tx = transacaoTenant(db, origem());
    await expect(tx.consultar(FORA, {})).rejects.toThrow('catalogo não a declara em usaConsultas');
  });

  it('dono da aninhada inativo para o usuário = ConsultaIndisponivel (a mesma regra de tx.consultar)', async () => {
    const tx = transacaoTenant(db, origem({ usuario: usuario(['catalogo', 'vendedor']) }));
    await expect(tx.consultar(CONSULTA_PRECOS_CLIENTE, { cliente_id: CLIENTE, produto_ids: [PRODUTO], em: '2026-11-10T15:00:00.000Z' })).rejects.toBeInstanceOf(
      ConsultaIndisponivel,
    );
  });

  it('ciclo (a consulta reaparece na cadeia) = erro de programação', async () => {
    const tx = transacaoTenant(db, origem());
    await expect(tx.consultar(CICLO_CAT, {})).rejects.toThrow('ciclo entre consultas (catalogo.ciclo@1 -> core.ciclo@1 -> catalogo.ciclo@1');
  });

  it(`cadeia até ${PROFUNDIDADE_MAXIMA_CONSULTAS} níveis responde; acima disso = erro de programação`, async () => {
    const tx = transacaoTenant(db, origem());
    await expect(tx.consultar(ELOS[0]!, {})).rejects.toThrow(`passou de ${PROFUNDIDADE_MAXIMA_CONSULTAS} níveis`);
    // começando mais adiante, a cadeia cabe no limite: elo_2 → elo_3 → elo_4 → elo_5 (4 níveis)
    const curto = transacaoTenant(db, origem({ modulo: 'core' }));
    await expect(curto.consultar(ELOS[2]!, {})).resolves.toEqual({ nivel: ELOS.length - 1 });
  });
});
