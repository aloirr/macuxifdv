/**
 * T-0056 — migração 0015 (schema `promotor`): visita de loja, coletas e cadastros de trade. Pedido
 * R-20261102-131328-2-modulo-promotor; desenho em docs/modulos/promotor/coletas.md §4; dicionário em docs/banco/promotor.md.
 * - Estático (sempre roda): listas fechadas do banco = código do Promotor, RN-PRO-01 (nada de "pedido"), fronteira (FK só
 *   para plataforma.tenant e dentro do schema), grants (sem DELETE; coletas só leitura e inserção; visita só troca o
 *   payload), gatilhos de derivação = chaves do contrato, down e a parte promotor da fixture (payloads = contratos).
 * - Postgres (papel macuxi_app, transações desfeitas): RLS entre A e B nas 20 tabelas, idempotência, CHECKs do payload,
 *   FK composta da coleta, unicidade de versão, privilégios, checkout por UPDATE e a consulta de visitas do período.
 * Datas: tudo derivado do "hoje" da fixture (hojeDaFixture), nunca do relógio.
 */
import { randomUUID } from 'node:crypto';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AcaoConcorrencia, ChecklistResposta, ColetaPreco, FotoColeta, GondolaRegistro, MedicaoShare, PontoExtra, RupturaItem, TarefaExecucao, TIPOS_FOTO,
  TipoOcorrenciaValidade, ValidadeItem, VisitaLoja,
} from '../../modules/promotor/contracts/coletas';
import { DESFECHOS_VISITA } from '../../modules/promotor/domain/checklist';
import { CONFORMIDADES } from '../../modules/promotor/domain/gondola';
import { TIPOS_PONTO_EXTRA } from '../../modules/promotor/domain/pontos-extras';
import * as nuvemPromotor from '../../modules/promotor/db/nuvem';
import { STATUS_PRESENCA } from '../../modules/promotor/domain/ruptura';
import { dadosDoisTenants, DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { COLETAS_PROMOTOR, ORDEM_PROMOTOR, PROMOTOR_FIXTURE } from '../seeds/fixtures/promotor';
import { hojeNoFuso, instante, somarDias } from '../src/datas';
import { idFixo } from '../src/ids';
import { lerMigracoes } from '../src/migrador';
import { agoraDaFixture, banco, hojeDaFixture, semBanco } from './estado';
import { emTransacao, erroDe } from './util';

const m15 = lerMigracoes().find((m) => m.versao === '0015')!;
const semComentarios = (sql: string) => sql.replace(/--.*$/gm, '');
const up = semComentarios(m15.up);

/** Corpo de `create table promotor.x ( ... );` na 0015. */
function corpo(tabela: string): string {
  const m = new RegExp(`create table ${tabela.replace('.', '\\.')} \\(([\\s\\S]*?)\\n\\);`).exec(m15.up);
  return m?.[1] ?? '';
}
/** Colunas declaradas (sem as constraints). */
const colunas = (tabela: string) => [...corpo(tabela).matchAll(/^ {2}([a-z_][a-z0-9_]*) +[a-z]/gm)].map((x) => x[1]!).filter((c) => c !== 'constraint');
/** Valores de `check (col in (...))` / `check (col is null or col in (...))`. */
function valoresDoCheck(tabela: string, coluna: string): string[] {
  const m = new RegExp(`check \\((?:${coluna} is null or )?${coluna} in \\(([^)]*)\\)\\)`).exec(corpo(tabela));
  return m ? [...m[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!) : [];
}
/** Atribuições `new.col := expr;` do gatilho promotor.derivar_<tabela>(). */
function derivadas(tabela: string): Array<{ coluna: string; chave: string | null }> {
  const nome = tabela.split('.')[1]!;
  const m = new RegExp(`create function promotor\\.derivar_${nome}\\(\\) returns trigger[\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$;`).exec(m15.up);
  return [...(m?.[1] ?? '').matchAll(/new\.([a-z_]+)\s*:= (.*);/g)].map((x) => ({ coluna: x[1]!, chave: /new\.payload ->> '([a-z_]+)'/.exec(x[2]!)?.[1] ?? null }));
}
/** Chaves de um contrato Zod (objeto, com ou sem superRefine). */
function chaves(contrato: unknown): string[] {
  let x = contrato as { shape?: Record<string, unknown>; innerType?: () => unknown };
  while (!x.shape && x.innerType) x = x.innerType() as typeof x;
  return Object.keys(x.shape ?? {});
}

const CONTRATO_DA_COLETA: Record<(typeof COLETAS_PROMOTOR)[number], unknown> = {
  'promotor.visita_loja': VisitaLoja,
  'promotor.foto_coleta': FotoColeta,
  'promotor.checklist_resposta': ChecklistResposta,
  'promotor.gondola_registro': GondolaRegistro,
  'promotor.medicao_share': MedicaoShare,
  'promotor.coleta_preco': ColetaPreco,
  'promotor.ruptura_item': RupturaItem,
  'promotor.validade_item': ValidadeItem,
  'promotor.ponto_extra': PontoExtra,
  'promotor.acao_concorrencia': AcaoConcorrencia,
  'promotor.tarefa_execucao': TarefaExecucao,
};
const CADASTROS = ORDEM_PROMOTOR.filter((t) => !(COLETAS_PROMOTOR as readonly string[]).includes(t));
const BASE_COLETA = ['id', 'tenant_id', 'promotor_id', 'cliente_id', 'payload', 'recebido_em', 'created_at', 'updated_at', 'deleted_at', 'external_id'];

describe('0015 promotor (estático)', () => {
  it('cria as 20 tabelas do schema promotor: 9 cadastros de trade e 11 coletas', () => {
    const criadas = [...m15.up.matchAll(/^create table ([a-z_]+\.[a-z_]+) \(/gm)].map((x) => x[1]!);
    expect(criadas.sort()).toEqual([...ORDEM_PROMOTOR].sort());
    expect(CADASTROS).toHaveLength(9);
    expect(COLETAS_PROMOTOR).toHaveLength(11);
  });

  it('listas fechadas do banco = código do Promotor (desfecho, tipo de foto, conformidade, presença, ponto extra, validade, concorrência)', () => {
    expect(valoresDoCheck('promotor.visita_loja', 'desfecho')).toEqual([...DESFECHOS_VISITA]);
    expect(valoresDoCheck('promotor.foto_coleta', 'tipo')).toEqual([...TIPOS_FOTO]);
    expect(valoresDoCheck('promotor.gondola_registro', 'conformidade')).toEqual([...CONFORMIDADES]);
    expect(valoresDoCheck('promotor.ruptura_item', 'status')).toEqual([...STATUS_PRESENCA]);
    expect(valoresDoCheck('promotor.ponto_extra', 'tipo')).toEqual([...TIPOS_PONTO_EXTRA]);
    expect(valoresDoCheck('promotor.ponto_extra_negociado', 'tipo')).toEqual([...TIPOS_PONTO_EXTRA]);
    expect(valoresDoCheck('promotor.validade_item', 'tipo')).toEqual([...TipoOcorrenciaValidade.options]);
    expect(valoresDoCheck('promotor.acao_concorrencia', 'tipo')).toEqual([...AcaoConcorrencia.shape.tipo.options]);
  });

  it('espelho Drizzle (modules/promotor/db/nuvem.ts, T-0070): listas fechadas = CHECKs da 0015 e as 20 tabelas no schema promotor', () => {
    expect([...nuvemPromotor.DESFECHOS_VISITA_BANCO]).toEqual(valoresDoCheck('promotor.visita_loja', 'desfecho'));
    expect([...nuvemPromotor.TIPOS_FOTO_BANCO]).toEqual(valoresDoCheck('promotor.foto_coleta', 'tipo'));
    expect([...nuvemPromotor.CONFORMIDADES_BANCO]).toEqual(valoresDoCheck('promotor.gondola_registro', 'conformidade'));
    expect([...nuvemPromotor.STATUS_PRESENCA_BANCO]).toEqual(valoresDoCheck('promotor.ruptura_item', 'status'));
    expect([...nuvemPromotor.TIPOS_PONTO_EXTRA_BANCO]).toEqual(valoresDoCheck('promotor.ponto_extra', 'tipo'));
    expect([...nuvemPromotor.TIPOS_PONTO_EXTRA_BANCO]).toEqual(valoresDoCheck('promotor.ponto_extra_negociado', 'tipo'));
    expect([...nuvemPromotor.TIPOS_VALIDADE_BANCO]).toEqual(valoresDoCheck('promotor.validade_item', 'tipo'));
    expect([...nuvemPromotor.TIPOS_ACAO_CONCORRENCIA_BANCO]).toEqual(valoresDoCheck('promotor.acao_concorrencia', 'tipo'));
    const tabelas = (Object.values(nuvemPromotor) as unknown[]).filter((v): v is PgTable => v instanceof PgTable).map((t) => getTableConfig(t));
    expect(tabelas.every((t) => t.schema === 'promotor')).toBe(true);
    expect(tabelas.map((t) => `promotor.${t.name}`).sort()).toEqual([...ORDEM_PROMOTOR].sort());
  });

  it('RN-PRO-01: nenhuma tabela, coluna, índice ou função da 0015 fala de pedido', () => {
    expect(up).not.toMatch(/pedido/i);
    expect(semComentarios(m15.down)).not.toMatch(/pedido/i);
  });

  it('fronteira (ADR 0012): FK só para plataforma.tenant e dentro do schema promotor; nada de core.*, catalogo.*, vendedor.*', () => {
    const alvos = [...up.matchAll(/references ([a-z_]+)\.([a-z_]+)/g)].map((x) => `${x[1]}.${x[2]}`);
    expect(alvos.length).toBeGreaterThan(20);
    for (const alvo of alvos) expect(alvo === 'plataforma.tenant' || alvo.startsWith('promotor.'), alvo).toBe(true);
    // a coleta não aponta para cadastro de trade (RN-PRO-10: versão vigente guardada, sem FK)
    for (const t of COLETAS_PROMOTOR.filter((x) => x !== 'promotor.visita_loja')) {
      expect(corpo(t).match(/references [a-z_.]+/g), t).toEqual(['references plataforma.tenant', 'references promotor.visita_loja']);
    }
  });

  it('coleta presa à visita: FK composta (tenant_id, visita_loja_id, promotor_id, cliente_id) e índice (tenant_id, visita_loja_id)', () => {
    expect(corpo('promotor.visita_loja')).toContain('constraint visita_loja_dono_uk unique (tenant_id, id, promotor_id, cliente_id)');
    for (const t of COLETAS_PROMOTOR.filter((x) => x !== 'promotor.visita_loja')) {
      const n = t.split('.')[1]!;
      expect(corpo(t)).toContain(
        `constraint ${n}_visita_fk foreign key (tenant_id, visita_loja_id, promotor_id, cliente_id) references promotor.visita_loja (tenant_id, id, promotor_id, cliente_id)`,
      );
      expect(up).toContain(`create index ${n}_visita_ix on ${t} (tenant_id, visita_loja_id);`);
    }
    expect(up).toContain('create index visita_loja_checkin_ix on promotor.visita_loja (tenant_id, checkin_em);');
    expect(up).toContain('create index visita_loja_cliente_ix on promotor.visita_loja (tenant_id, cliente_id, checkin_em desc);');
  });

  it('idempotência e payload: toda coleta guarda o payload jsonb com payload.id = id (CHECK)', () => {
    for (const t of COLETAS_PROMOTOR) {
      const n = t.split('.')[1]!;
      expect(corpo(t)).toMatch(/^ {2}payload +jsonb not null,$/m);
      expect(corpo(t)).toContain(`constraint ${n}_payload_valido check (jsonb_typeof(payload) = 'object' and coalesce((payload ->> 'id')::uuid = id, false))`);
    }
  });

  it('colunas tipadas = DERIVADAS do payload pelo gatilho (sem GENERATED: o INSERT de cópia dos testes de vazamento passa); chave do payload = nome da coluna = chave do contrato', () => {
    expect(up).not.toMatch(/generated always/);
    for (const t of COLETAS_PROMOTOR) {
      const n = t.split('.')[1]!;
      const d = derivadas(t);
      // o gatilho preenche exatamente as colunas que não são de base (id, tenant, promotor, cliente, payload, recebido, comuns)
      expect(d.map((x) => x.coluna).sort(), t).toEqual(colunas(t).filter((c) => !BASE_COLETA.includes(c) || (t === 'promotor.visita_loja' && c === 'cliente_id')).sort());
      for (const x of d) {
        expect(x.chave, `${t}.${x.coluna}`).toBe(x.coluna);
        expect(chaves(CONTRATO_DA_COLETA[t]), `${t}: ${x.coluna} no contrato`).toContain(x.coluna);
      }
      expect(up).toContain(`create trigger ${n}_derivar before insert or update on ${t}\n  for each row execute function promotor.derivar_${n}();`);
    }
    // instantes passam pelo formato travado (ISO UTC "…Z"); a data civil da validade por data_iso
    const instantes = up.match(/new\.[a-z_]+_em\s*:= .*/g) ?? [];
    expect(instantes.length).toBeGreaterThan(10);
    for (const linha of instantes) expect(linha).toContain('promotor.instante_iso(new.payload ->> ');
    expect(up).toMatch(/new\.validade\s*:= promotor\.data_iso\(new\.payload ->> 'validade'\);/);
    expect(up).toMatch(/create function promotor\.instante_iso\(p text\) returns timestamptz\s+language sql immutable strict parallel safe/);
    expect(up).toMatch(/create function promotor\.data_iso\(p text\) returns date\s+language sql immutable strict parallel safe/);
    expect(up).toContain('revoke all on function promotor.instante_iso(text) from public;');
  });

  it('grants: sem DELETE em nada; coletas só select/insert; visita_loja só troca o payload; cadastros select/insert/update; worker sem nada', () => {
    const grants = [...up.matchAll(/^grant (.*) on (promotor\.[a-z_]+) to ([a-z_]+);$/gm)].map((g) => ({ priv: g[1]!, tabela: g[2]!, papel: g[3]! }));
    expect(grants.every((g) => g.papel === 'macuxi_app')).toBe(true);
    expect(up).not.toMatch(/macuxi_worker/);
    expect(grants.filter((g) => /delete|truncate|references|trigger|all/.test(g.priv))).toEqual([]);
    for (const t of CADASTROS) expect(grants.filter((g) => g.tabela === t).map((g) => g.priv), t).toEqual(['select, insert, update']);
    for (const t of COLETAS_PROMOTOR.filter((x) => x !== 'promotor.visita_loja')) expect(grants.filter((g) => g.tabela === t).map((g) => g.priv), t).toEqual(['select, insert']);
    // as colunas derivadas nunca entram num grant de escrita: o UPDATE da visita é só do payload
    expect(grants.filter((g) => g.tabela === 'promotor.visita_loja').map((g) => g.priv)).toEqual(['select, insert', 'update (payload)']);
  });

  it('cadastros: unicidade de versão (nulls not distinct) para checklist, mix e meta; alvo loja OU segmento; vigência coerente', () => {
    expect(up).toContain('create unique index checklist_loja_versao_uk on promotor.checklist_loja (tenant_id, cliente_id, lower(segmento), vigencia_inicio) nulls not distinct where deleted_at is null;');
    expect(up).toContain('create unique index mix_obrigatorio_versao_uk on promotor.mix_obrigatorio (tenant_id, produto_id, cliente_id, lower(segmento), vigencia_inicio) nulls not distinct where deleted_at is null;');
    expect(up).toContain('create unique index meta_share_versao_uk on promotor.meta_share (tenant_id, categoria_gondola_id, cliente_id, lower(segmento), vigencia_inicio) nulls not distinct where deleted_at is null;');
    for (const t of ['checklist_loja', 'mix_obrigatorio', 'meta_share', 'foto_referencia', 'tarefa_trade']) {
      expect(corpo(`promotor.${t}`)).toContain(`constraint ${t}_alvo_unico check (cliente_id is null or segmento is null)`);
      expect(corpo(`promotor.${t}`)).toContain(`constraint ${t}_vigencia check (vigencia_fim is null or vigencia_fim >= vigencia_inicio)`);
    }
  });

  it('down remove o schema inteiro (funções e gatilhos juntos)', () => {
    expect(m15.down).toContain('drop schema if exists promotor cascade;');
    expect(m15.up).toMatch(/^create schema promotor;$/m);
  });

  describe('fixture dois-tenants: parte promotor', () => {
    const dados = dadosDoisTenants('$argon2id$v=19$m=1,t=1,p=1$c2Fs$aGFzaA', { agora: agoraDaFixture() });
    const tA = DOIS_TENANTS.A.tenantId;
    const tB = DOIS_TENANTS.B.tenantId;

    it('payloads = contratos (parse com defaults devolve o mesmo objeto) e payload.id = id', () => {
      for (const t of COLETAS_PROMOTOR) {
        const contrato = CONTRATO_DA_COLETA[t] as { parse(x: unknown): unknown };
        for (const l of dados[t]) {
          const p = l.payload as Record<string, unknown>;
          expect(p.id, t).toBe(l.id);
          expect(contrato.parse(p), `${t} ${String(l.id)}`).toEqual(p);
        }
      }
    });

    it('coleta da visita: mesmo tenant, promotor e loja da visita de loja, instante dentro da janela (RN-PRO-02)', () => {
      const visitas = new Map(dados['promotor.visita_loja'].map((v) => [v.id, v]));
      for (const t of COLETAS_PROMOTOR.filter((x) => x !== 'promotor.visita_loja')) {
        for (const l of dados[t]) {
          const p = l.payload as Record<string, string>;
          const v = visitas.get(p.visita_loja_id)!;
          const pv = v.payload as Record<string, string>;
          expect([l.tenant_id, l.promotor_id, l.cliente_id], t).toEqual([v.tenant_id, v.promotor_id, pv.cliente_id]);
          const quando = Object.entries(p).find(([k]) => /_em$/.test(k) && k !== 'enviada_em')![1];
          expect(Date.parse(quando) >= Date.parse(pv.checkin_em!) && Date.parse(quando) <= Date.parse(pv.checkout_em!), `${t} ${quando}`).toBe(true);
        }
      }
    });

    it('a visita de loja de A é a visita do promotor no Core (mesmo check-in/checkout); A e B no "hoje" de cada fuso', () => {
      const vA = dados['promotor.visita_loja'].find((v) => v.tenant_id === tA)!.payload as Record<string, string>;
      const core = dados['core.visita'].find((v) => v.id === DOIS_TENANTS.A.visitas.promotorC1Hoje)!;
      expect([vA.visita_id, vA.cliente_id, vA.checkin_em, vA.checkout_em]).toEqual([core.id, core.cliente_id, core.checkin_em, core.checkout_em]);
      expect(vA.checkin_em!.slice(0, 10)).toBe(hojeNoFuso(DOIS_TENANTS.A.fuso, agoraDaFixture()));
      const vB = dados['promotor.visita_loja'].find((v) => v.tenant_id === tB)!.payload as Record<string, string>;
      expect(vB.visita_id).toBe(DOIS_TENANTS.B.visitas.c1Hoje);
    });
  });
});

describe.skipIf(semBanco())('0015 promotor (Postgres, papel macuxi_app)', () => {
  const A = DOIS_TENANTS.A;
  const tA = A.tenantId;
  const tB = DOIS_TENANTS.B.tenantId;
  const PA = PROMOTOR_FIXTURE.A;
  const PB = PROMOTOR_FIXTURE.B;
  let app: pg.Client;
  let hoje: string;

  beforeAll(async () => {
    hoje = hojeDaFixture(A.fuso);
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });

  const comA = <T>(fn: () => Promise<T>) => emTransacao(app, tA, fn);
  /** erroDe dentro de um SAVEPOINT: o erro esperado não aborta a transação do teste. */
  const tentar = async (fn: () => Promise<unknown>) => {
    await app.query('savepoint t');
    const e = await erroDe(fn());
    await app.query(e ? 'rollback to savepoint t' : 'release savepoint t');
    return e;
  };
  const visitaPayload = (id: string, extra: Record<string, unknown> = {}) => ({
    id, visita_id: randomUUID(), cliente_id: A.clientes.c1, checklist_modelo_id: null, checkin_em: instante(hoje, '16:00'), checkout_em: null,
    permanencia_min: null, desfecho: null, foto_fachada_id: null, observacao: null, ...extra,
  });
  const inserirVisita = (id: string, payload: object, promotor = A.usuarios.promotor) =>
    app.query('insert into promotor.visita_loja (id, tenant_id, promotor_id, payload) values ($1, $2, $3, $4)', [id, tA, promotor, JSON.stringify(payload)]);
  const fotoPayload = (id: string, visita_loja_id: string, tirada_em: string) => ({
    id, visita_loja_id, tipo: 'gondola_antes', origem: 'camera', tirada_em, latitude: null, longitude: null, sem_gps: true, arquivo_ref: null, enviada_em: null,
  });
  const inserirFoto = (id: string, visita_loja_id: string, promotor = A.usuarios.promotor, cliente = A.clientes.c1) =>
    app.query('insert into promotor.foto_coleta (id, tenant_id, promotor_id, cliente_id, payload) values ($1, $2, $3, $4, $5)', [
      id, tA, promotor, cliente, JSON.stringify(fotoPayload(id, visita_loja_id, instante(hoje, '16:05'))),
    ]);

  it('RLS nas 20 tabelas: A vê só A (e B só B); por tenant_id ou id de B, nada; INSERT de cópia com tenant B recusado (42501)', async () => {
    for (const [tenant, outro] of [[tA, tB], [tB, tA]] as const) {
      await emTransacao(app, tenant, async () => {
        for (const t of ORDEM_PROMOTOR) {
          const r = await app.query<{ total: number; alheias: number }>(`select count(*)::int as total, count(*) filter (where tenant_id <> $1)::int as alheias from ${t}`, [tenant]);
          expect(r.rows[0], t).toEqual({ total: expect.any(Number), alheias: 0 });
          expect(r.rows[0]!.total, `${t}: fixture com linha do tenant`).toBeGreaterThan(0);
          const porTenant = await app.query<{ n: number }>(`select count(*)::int as n from ${t} where tenant_id = $1`, [outro]);
          expect(porTenant.rows[0]!.n, t).toBe(0);
        }
      });
    }
    await comA(async () => {
      for (const id of [PB.visitaLoja, PB.categoria, PB.fotos.antes]) {
        for (const t of ['promotor.visita_loja', 'promotor.categoria_gondola', 'promotor.foto_coleta']) {
          expect((await app.query(`select 1 from ${t} where id = $1`, [id])).rowCount).toBe(0);
        }
      }
      for (const t of ORDEM_PROMOTOR) {
        const e = await tentar(() =>
          app.query(
            `insert into ${t} select (jsonb_populate_record(null::${t}, to_jsonb(r) || jsonb_build_object('id', gen_random_uuid(), 'tenant_id', $2::uuid))).*
               from ${t} r where r.tenant_id = $1 limit 1`,
            [tA, tB],
          ),
        );
        expect(e?.code, `${t}: ${e?.message ?? 'INSERT passou!'}`).toBe('42501');
      }
    });
  });

  it('idempotência: o mesmo id 2× = 23505 (a API lê antes e decide repetido/conflito pelo payload)', async () => {
    await comA(async () => {
      const id = randomUUID();
      await inserirVisita(id, visitaPayload(id));
      expect((await tentar(() => inserirVisita(id, visitaPayload(id))))?.code).toBe('23505');
      const f = randomUUID();
      await inserirFoto(f, id);
      expect((await tentar(() => inserirFoto(f, id)))?.code).toBe('23505');
    });
  });

  it('payload: id do payload diferente do id da linha = 23514; instante sem "Z" (ou com fuso) = 23514', async () => {
    await comA(async () => {
      const id = randomUUID();
      expect((await tentar(() => inserirVisita(id, visitaPayload(randomUUID()))))?.code).toBe('23514');
      expect((await tentar(() => inserirVisita(id, visitaPayload(id, { checkin_em: `${hoje}T16:00:00` }))))?.code).toBe('23514');
      expect((await tentar(() => inserirVisita(id, visitaPayload(id, { checkin_em: `${hoje}T12:00:00-04:00` }))))?.code).toBe('23514');
      await inserirVisita(id, visitaPayload(id));
      const f = randomUUID();
      const semZ = { ...fotoPayload(f, id, instante(hoje, '16:05')), tirada_em: `${hoje} 16:05:00` };
      const e = await tentar(() =>
        app.query('insert into promotor.foto_coleta (id, tenant_id, promotor_id, cliente_id, payload) values ($1, $2, $3, $4, $5)', [f, tA, A.usuarios.promotor, A.clientes.c1, JSON.stringify(semZ)]),
      );
      expect(e?.code).toBe('23514');
      // data civil fora do formato vira nula: validade sem data = 23514
      const v = randomUUID();
      const validade = { id: v, visita_loja_id: id, produto_id: randomUUID(), tipo: 'validade', validade: '05/11/2026', lote: null, quantidade: 1, motivo_avaria: null, foto_id: null, registrado_em: instante(hoje, '16:06') };
      const ev = await tentar(() =>
        app.query('insert into promotor.validade_item (id, tenant_id, promotor_id, cliente_id, payload) values ($1, $2, $3, $4, $5)', [v, tA, A.usuarios.promotor, A.clientes.c1, JSON.stringify(validade)]),
      );
      expect(ev?.code).toBe('23514');
    });
  });

  it('FK composta: coleta numa visita de outro promotor, de outra loja ou de outro tenant = 23503', async () => {
    await comA(async () => {
      const id = randomUUID();
      await inserirVisita(id, visitaPayload(id));
      expect((await tentar(() => inserirFoto(randomUUID(), id, A.usuarios.vendedor1)))?.code).toBe('23503');
      expect((await tentar(() => inserirFoto(randomUUID(), id, A.usuarios.promotor, A.clientes.c2)))?.code).toBe('23503');
      expect((await tentar(() => inserirFoto(randomUUID(), PB.visitaLoja, DOIS_TENANTS.B.usuarios.vendedor, DOIS_TENANTS.B.clientes.c1)))?.code).toBe('23503');
      expect((await tentar(() => inserirFoto(randomUUID(), randomUUID())))?.code).toBe('23503');
      await inserirFoto(randomUUID(), id);
    });
  });

  it('checkout incompleto (sem desfecho ou sem permanência) e loja fechada sem foto da fachada = 23514 (RN-PRO-06/07)', async () => {
    await comA(async () => {
      const fechada = { checkout_em: instante(hoje, '16:30'), permanencia_min: 30, desfecho: 'realizada' };
      for (const extra of [
        { ...fechada, desfecho: null },
        { ...fechada, permanencia_min: null },
        { ...fechada, desfecho: 'loja_fechada' },
        { ...fechada, desfecho: 'acesso_negado' },
        { ...fechada, checkout_em: instante(hoje, '15:59') },
        { ...fechada, desfecho: 'desconhecido' },
      ]) {
        const id = randomUUID();
        expect((await tentar(() => inserirVisita(id, visitaPayload(id, extra))))?.code, JSON.stringify(extra)).toBe('23514');
      }
      const ok = randomUUID();
      await inserirVisita(ok, visitaPayload(ok, { ...fechada, desfecho: 'loja_fechada', foto_fachada_id: randomUUID() }));
    });
  });

  it('cadastros: versão duplicada de meta de share, mix e checklist (alvo nulo, nulls not distinct) = 23505; outra loja passa', async () => {
    await comA(async () => {
      const vig = somarDias(hoje, -30);
      const meta = (id: string, cliente: string | null) =>
        app.query('insert into promotor.meta_share (id, tenant_id, cliente_id, vigencia_inicio, categoria_gondola_id, meta_pct) values ($1, $2, $3, $4, $5, 50)', [id, tA, cliente, vig, PA.categorias.freios]);
      expect((await tentar(() => meta(randomUUID(), null)))?.code).toBe('23505');
      await meta(randomUUID(), A.clientes.c2);
      expect((await tentar(() => meta(randomUUID(), A.clientes.c2)))?.code).toBe('23505');
      const mix = () =>
        app.query('insert into promotor.mix_obrigatorio (tenant_id, vigencia_inicio, produto_id, categoria_gondola_id) values ($1, $2, $3, $4)', [tA, vig, idFixo('aaaaaaaa', 0x03, 1), PA.categorias.freios]);
      expect((await tentar(mix))?.code).toBe('23505');
      const checklist = () => app.query("insert into promotor.checklist_loja (tenant_id, vigencia_inicio, nome) values ($1, $2, 'Outro')", [tA, vig]);
      expect((await tentar(checklist))?.code).toBe('23505');
      // categoria de outro tenant na FK composta: 23503
      expect((await tentar(() => app.query('insert into promotor.meta_share (tenant_id, vigencia_inicio, categoria_gondola_id, meta_pct) values ($1, $2, $3, 10)', [tA, somarDias(hoje, 1), PB.categoria])))?.code).toBe('23503');
    });
  });

  it('privilégios: sem DELETE nas 20 tabelas; sem UPDATE nas coletas; na visita só o payload (42501)', async () => {
    await comA(async () => {
      for (const t of ORDEM_PROMOTOR) expect((await tentar(() => app.query(`delete from ${t} where tenant_id = $1`, [tA])))?.code, t).toBe('42501');
      for (const t of COLETAS_PROMOTOR.filter((x) => x !== 'promotor.visita_loja')) {
        expect((await tentar(() => app.query(`update ${t} set payload = payload where tenant_id = $1`, [tA])))?.code, t).toBe('42501');
      }
      for (const set of ['promotor_id = promotor_id', 'external_id = external_id', 'checkout_em = checkout_em', 'deleted_at = deleted_at']) {
        expect((await tentar(() => app.query(`update promotor.visita_loja set ${set} where id = $1`, [PA.visitaLoja])))?.code, set).toBe('42501');
      }
      // cadastro: UPDATE permitido (o BKO edita; removido = deleted_at)
      const r = await app.query('update promotor.categoria_gondola set ordem = ordem where id = $1', [PA.categorias.freios]);
      expect(r.rowCount).toBe(1);
    });
  });

  it('checkout: o upsert da API (on conflict do update set payload, só se aberta) fecha a visita e as colunas derivadas acompanham; fechada não muda mais', async () => {
    await comA(async () => {
      const id = randomUUID();
      const aberta = visitaPayload(id);
      const gravar = (p: object) =>
        app.query(
          `insert into promotor.visita_loja as v (id, tenant_id, promotor_id, payload) values ($1, $2, $3, $4)
           on conflict (id) do update set payload = excluded.payload where v.checkout_em is null and v.promotor_id = excluded.promotor_id`,
          [id, tA, A.usuarios.promotor, JSON.stringify(p)],
        );
      expect((await gravar(aberta)).rowCount).toBe(1);
      const lida = await app.query('select checkout_em, desfecho, permanencia_min, cliente_id, checkin_em from promotor.visita_loja where id = $1 for update', [id]);
      expect(lida.rows[0]).toMatchObject({ checkout_em: null, desfecho: null, permanencia_min: null, cliente_id: A.clientes.c1 });
      expect((lida.rows[0].checkin_em as Date).toISOString()).toBe(new Date(aberta.checkin_em).toISOString());
      const fechada = { ...aberta, checkout_em: instante(hoje, '16:45'), permanencia_min: 45, desfecho: 'realizada' };
      expect((await gravar(fechada)).rowCount).toBe(1);
      const depois = await app.query<{ checkout_em: Date; desfecho: string; permanencia_min: string; payload: unknown }>(
        'select checkout_em, desfecho, permanencia_min, payload from promotor.visita_loja where id = $1',
        [id],
      );
      expect(depois.rows[0]!.checkout_em.toISOString()).toBe(new Date(fechada.checkout_em).toISOString());
      expect([depois.rows[0]!.desfecho, Number(depois.rows[0]!.permanencia_min)]).toEqual(['realizada', 45]);
      expect(depois.rows[0]!.payload).toEqual(fechada);
      // fechada: o mesmo upsert não altera nada (a API trata repetido/conflito pelo domain)
      expect((await gravar({ ...fechada, observacao: 'mudou' })).rowCount).toBe(0);
      // UPDATE direto do payload (o caminho alternativo da API) também rederiva: valor enviado na coluna é ignorado
      const id2 = randomUUID();
      await app.query('insert into promotor.visita_loja (id, tenant_id, promotor_id, payload, checkin_em, desfecho) values ($1, $2, $3, $4, $5, $6)', [
        id2, tA, A.usuarios.promotor, JSON.stringify(visitaPayload(id2)), instante(somarDias(hoje, -9), '10:00'), 'loja_fechada',
      ]);
      const r2 = await app.query<{ checkin_em: Date; desfecho: string | null }>('select checkin_em, desfecho from promotor.visita_loja where id = $1', [id2]);
      expect([r2.rows[0]!.checkin_em.toISOString(), r2.rows[0]!.desfecho]).toEqual([new Date(instante(hoje, '16:00')).toISOString(), null]);
      const up2 = await app.query('update promotor.visita_loja set payload = $2 where id = $1 and checkout_em is null', [
        id2, JSON.stringify(visitaPayload(id2, { checkout_em: instante(hoje, '16:20'), permanencia_min: 20, desfecho: 'realizada' })),
      ]);
      expect(up2.rowCount).toBe(1);
    });
  });

  it('visitas do período pela data local do check-in no fuso do tenant (limites do dia em Manaus), pelo índice (tenant_id, checkin_em)', async () => {
    await comA(async () => {
      const amanha = somarDias(hoje, 1);
      // 23:59 de hoje em Manaus = 03:59Z de amanhã (entra); 00:00 de amanhã em Manaus = 04:00Z (fica de fora)
      const dentro = randomUUID();
      const fora = randomUUID();
      await inserirVisita(dentro, visitaPayload(dentro, { checkin_em: instante(amanha, '03:59') }));
      await inserirVisita(fora, visitaPayload(fora, { checkin_em: instante(amanha, '04:00') }));
      const sql = `select id from promotor.visita_loja
                    where tenant_id = $1 and checkin_em >= ($2::date)::timestamp at time zone $4
                      and checkin_em < ($3::date + 1)::timestamp at time zone $4 and deleted_at is null
                    order by checkin_em, id`;
      const r = await app.query<{ id: string }>(sql, [tA, hoje, hoje, A.fuso]);
      expect(r.rows.map((x) => x.id)).toEqual(expect.arrayContaining([PA.visitaLoja, dentro]));
      expect(r.rows.map((x) => x.id)).not.toContain(fora);
      await app.query('set local enable_seqscan = off');
      const plano = await app.query<{ 'QUERY PLAN': unknown }>(`explain (format json) ${sql}`, [tA, hoje, hoje, A.fuso]);
      expect(JSON.stringify(plano.rows[0]!['QUERY PLAN'])).toContain('visita_loja_checkin_ix');
      // coletasDasVisitas: fotos da visita da fixture, por (tenant_id, visita_loja_id)
      const fotos = await app.query<{ id: string }>('select id from promotor.foto_coleta where tenant_id = $1 and visita_loja_id = any($2::uuid[]) order by id', [tA, [PA.visitaLoja]]);
      expect(fotos.rows.map((x) => x.id)).toEqual(Object.values(PA.fotos).sort());
      // nomesDasCategorias
      const cats = await app.query<{ id: string; nome: string }>('select id, nome from promotor.categoria_gondola where tenant_id = $1 and id = any($2::uuid[]) order by nome', [tA, [PA.categorias.freios, PB.categoria]]);
      expect(cats.rows).toEqual([{ id: PA.categorias.freios, nome: 'Freios' }]);
    });
  });
});
