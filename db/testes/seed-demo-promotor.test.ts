/**
 * Base de demonstração — parte do Promotor (db/seeds/demo/promotor.ts, T-0056). Estático: payloads = contratos, só o
 * tenant demo, ids únicos, datas relativas ao "hoje" dado, licença sem Vendedor para o promotor (RN-PRO-01) e coerência
 * com o demo.ts (carteira, rota e visitas da Joana). Postgres: carregarDemo + gravarDemoPromotor numa transação,
 * idempotência, outro dia, isolamento pelo macuxi_app e a recusa sem a 0015.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AcaoConcorrencia, ChecklistResposta, ColetaPreco, FotoColeta, GondolaRegistro, MedicaoShare, PontoExtra, RupturaItem, TarefaExecucao, ValidadeItem,
  VisitaLoja,
} from '../../modules/promotor/contracts/coletas';
import { carregarDemo, dadosDemo, diasUteisAtras, idClienteDemo, idUsuarioDemo, TENANT_DEMO } from '../seeds/demo/demo';
import {
  CARTEIRA_PROMOTOR_DEMO, dadosDemoPromotor, gravarDemoPromotor, MIX_DEMO, ORDEM_DEMO_PROMOTOR, PERFIS_PROMOTOR_DEMO, ROTA_HOJE_PROMOTOR_DEMO,
  VISITAS_LOJA_DEMO,
} from '../seeds/demo/promotor';
import { carregarDoisTenants, DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { COLETAS_PROMOTOR } from '../seeds/fixtures/promotor';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { comTenant } from '../src/contexto';
import { somarDias } from '../src/datas';
import { idDeterministico } from '../src/ids';
import { migrarUp } from '../src/migrador';
import { hojeDaFixture, semBanco } from './estado';
import { semMarcaDeAmbiente } from './util';

const SENHA = 'senha-do-teste-demo-promotor';
const HASH_FALSO = '$argon2id$v=19$m=1,t=1,p=1$c2Fs$aGFzaA';
const CONTRATO: Record<(typeof COLETAS_PROMOTOR)[number], { parse(x: unknown): unknown }> = {
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

describe('base de demo: Promotor (estático)', () => {
  const hoje = hojeDaFixture('America/Manaus');
  const d = dadosDemoPromotor({ hoje });
  const demo = dadosDemo(HASH_FALSO, { hoje });
  const joana = idUsuarioDemo('promotor');

  it('todo payload de coleta = contrato (parse com defaults devolve o mesmo objeto), payload.id = id, coleta da Joana na loja da visita', () => {
    const visitas = new Map(d['promotor.visita_loja'].map((v) => [v.id, v.payload as Record<string, string>]));
    for (const t of COLETAS_PROMOTOR) {
      for (const l of d[t]) {
        const p = l.payload as Record<string, string>;
        expect(p.id, t).toBe(l.id);
        expect(CONTRATO[t].parse(p), `${t} ${String(l.id)}`).toEqual(p);
        expect(l.promotor_id).toBe(joana);
        if (t !== 'promotor.visita_loja') {
          const v = visitas.get(p.visita_loja_id)!;
          expect(l.cliente_id).toBe(v.cliente_id);
          const quando = Object.entries(p).find(([k]) => /_em$/.test(k) && k !== 'enviada_em')![1];
          expect(Date.parse(quando) >= Date.parse(v.checkin_em!) && Date.parse(quando) <= Date.parse(v.checkout_em!), `${t} ${quando}`).toBe(true);
        }
      }
    }
  });

  it('só o tenant demo; ids únicos; os únicos ids em comum com o demo.ts são os da licença (mesma linha)', () => {
    const linhas = ORDEM_DEMO_PROMOTOR.flatMap((t) => d[t]);
    expect(linhas.every((l) => l.tenant_id === TENANT_DEMO)).toBe(true);
    const ids = linhas.map((l) => String(l.id));
    expect(new Set(ids).size).toBe(ids.length);
    const doDemo = new Map(Object.values(demo).flat().map((l) => [String(l.id), l]));
    const comuns = ids.filter((x) => doDemo.has(x));
    expect(comuns.sort()).toEqual([...d['plataforma.tenant_modulo'], ...d['plataforma.perfil_modulo']].map((l) => String(l.id)).sort());
    for (const l of [...d['plataforma.tenant_modulo'], ...d['plataforma.perfil_modulo']]) expect(l).toEqual(doDemo.get(String(l.id)));
  });

  it('licença: Promotor ativo no tenant e para promotor, supervisor, gerente, analista e admin; nada de Vendedor nem de pedido (RN-PRO-01)', () => {
    expect(d['plataforma.tenant_modulo']).toEqual([expect.objectContaining({ id: idDeterministico('demo:tenant_modulo:promotor'), modulo: 'promotor', ativo: true })]);
    expect(d['plataforma.perfil_modulo'].map((p) => `${p.perfil}:${p.modulo}`)).toEqual(PERFIS_PROMOTOR_DEMO.map((p) => `${p}:promotor`));
    expect(d['plataforma.perfil_modulo'].every((p) => p.id === idDeterministico(`demo:perfil_modulo:${p.perfil}:promotor`))).toBe(true);
    expect(JSON.stringify(d)).not.toMatch(/pedido|vendedor/i);
  });

  it('coerente com o demo.ts: carteira de promotor e rota de hoje da Joana; visitas de loja = visitas v-pr1/v-pr2 do Core (mesmo check-in/checkout)', () => {
    const carteira = demo['core.carteira'].filter((x) => x.papel === 'promotor').map((x) => x.cliente_id);
    expect(carteira).toEqual(CARTEIRA_PROMOTOR_DEMO.map((n) => idClienteDemo(n)));
    const rota = demo['core.rota_parada'].filter((x) => x.usuario_id === joana).sort((x, y) => Number(x.sequencia) - Number(y.sequencia)).map((x) => x.cliente_id);
    expect(rota).toEqual(ROTA_HOJE_PROMOTOR_DEMO.map((n) => idClienteDemo(n)));
    for (const [chave, loja] of VISITAS_LOJA_DEMO) {
      const core = demo['core.visita'].find((v) => v.id === idDeterministico(`demo:visita:${chave}`))!;
      const vl = d['promotor.visita_loja'].find((v) => (v.payload as Record<string, unknown>).visita_id === core.id)!.payload as Record<string, unknown>;
      expect(vl).toMatchObject({ cliente_id: idClienteDemo(loja), checkin_em: core.checkin_em, checkout_em: core.checkout_em, desfecho: 'realizada', permanencia_min: 60 });
      expect(CARTEIRA_PROMOTOR_DEMO as readonly number[]).toContain(loja);
    }
  });

  it('datas relativas ao "hoje" dado: visitas 2 e 1 dia útil atrás; cadastros vigentes hoje; nada no futuro', () => {
    const datas = d['promotor.visita_loja'].map((v) => String((v.payload as Record<string, string>).checkin_em).slice(0, 10)).sort();
    // 15:20 em Manaus = 19:20Z (mesmo dia civil)
    expect(datas).toEqual([diasUteisAtras(hoje, 2), diasUteisAtras(hoje, 1)]);
    for (const t of ['promotor.checklist_loja', 'promotor.mix_obrigatorio', 'promotor.meta_share', 'promotor.tarefa_trade', 'promotor.ponto_extra_negociado'] as const) {
      for (const l of d[t]) {
        expect(String(l.vigencia_inicio) <= diasUteisAtras(hoje, 2), t).toBe(true);
        expect(l.vigencia_fim === null || String(l.vigencia_fim) >= hoje, t).toBe(true);
      }
    }
    const fimDeHoje = Date.parse(`${somarDias(hoje, 1)}T04:00:00Z`); // hora-fixa-ok: 00:00 de amanhã em Manaus (UTC−4), derivado do hoje dado
    for (const t of COLETAS_PROMOTOR) for (const l of d[t]) expect(Date.parse(String(l.recebido_em))).toBeLessThan(fimDeHoje);
    // outro "hoje": mesmos ids, datas andam
    const amanha = dadosDemoPromotor({ hoje: somarDias(hoje, 1) });
    expect(ORDEM_DEMO_PROMOTOR.flatMap((t) => amanha[t].map((l) => l.id))).toEqual(ORDEM_DEMO_PROMOTOR.flatMap((t) => d[t].map((l) => l.id)));
  });

  it('conteúdo para o BKO de trade: 3 categorias, mix de 5, metas gerais + loja 0, checklist com 5 etapas (2 obrigatórias), 2 concorrentes, 4 produtos (um por categoria), tarefa e ponto extra', () => {
    expect(d['promotor.categoria_gondola'].map((c) => c.nome)).toEqual(['Mercearia', 'Bebidas', 'Limpeza']);
    const categoriasDoDemo = new Set(demo['core.produto'].map((p) => p.categoria));
    for (const c of d['promotor.categoria_gondola']) expect(categoriasDoDemo.has(c.nome)).toBe(true);
    const produtosDemo = new Set(demo['core.produto'].map((p) => p.id));
    expect(d['promotor.mix_obrigatorio']).toHaveLength(5);
    for (const m of d['promotor.mix_obrigatorio']) expect(produtosDemo.has(m.produto_id)).toBe(true);
    expect(MIX_DEMO).toHaveLength(5);
    expect(d['promotor.meta_share'].map((m) => m.cliente_id)).toEqual([null, null, null, idClienteDemo(0)]);
    const itens = d['promotor.checklist_loja'][0]!.itens as Array<{ obrigatoria: boolean }>;
    expect([d['promotor.checklist_loja'].length, itens.length, itens.filter((i) => i.obrigatoria).length]).toEqual([1, 5, 2]);
    expect([d['promotor.concorrente'].length, d['promotor.produto_concorrente'].length, d['promotor.tarefa_trade'].length]).toEqual([2, 4, 1]);
    expect(new Set(d['promotor.produto_concorrente'].map((p) => p.categoria_gondola_id)).size).toBe(3);
    expect(d['promotor.ponto_extra_negociado']).toEqual([expect.objectContaining({ cliente_id: idClienteDemo(0) })]);
    for (const p of d['promotor.produto_concorrente']) expect(produtosDemo.has(p.produto_id)).toBe(true);
    // ruptura: 1 item na v-pr1 e 2 na v-pr2; share das 3 categorias em cada visita
    const emRuptura = d['promotor.ruptura_item'].filter((r) => (r.payload as Record<string, string>).status !== 'presente');
    expect(emRuptura.map((r) => r.cliente_id).sort()).toEqual([idClienteDemo(0), idClienteDemo(4), idClienteDemo(4)].sort());
    expect(d['promotor.medicao_share']).toHaveLength(6);
    // a meta específica da loja 0 vence a geral (RN-PRO-10)
    const loja0 = d['promotor.medicao_share'].find((m) => m.cliente_id === idClienteDemo(0) && (m.payload as Record<string, unknown>).meta_pct === 40);
    expect(loja0).toBeDefined();
  });

  it('recusa banco que não é local, antes de qualquer consulta', async () => {
    let consultou = false;
    const remoto = { host: 'db.homologacao.exemplo.com', query: async () => { consultou = true; return { rows: [] }; } };
    await semMarcaDeAmbiente(() => expect(gravarDemoPromotor(remoto as unknown as pg.Client, { hoje })).rejects.toThrow(/recusado: banco fora do ambiente local/));
    expect(consultou).toBe(false);
  });
});

describe.skipIf(semBanco())('base de demo: Promotor (Postgres)', () => {
  let b: BancoDeTeste;
  let pool: pg.Pool;
  let hoje: string;

  const gravarNaTransacao = (dia: string) =>
    comAdmin(b.nome, async (c) => {
      await c.query('begin');
      try {
        await gravarDemoPromotor(c, { hoje: dia });
        await c.query('commit');
      } catch (e) {
        await c.query('rollback');
        throw e;
      }
    });
  const contar = () =>
    comAdmin(b.nome, async (c) => {
      const out: Record<string, number> = {};
      for (const t of ORDEM_DEMO_PROMOTOR) out[t] = (await c.query<{ n: number }>(`select count(*)::int as n from ${t} where tenant_id = $1`, [TENANT_DEMO])).rows[0]!.n;
      return out;
    });

  beforeAll(async () => {
    hoje = hojeDaFixture('America/Manaus');
    b = await criarBancoDeTeste({ preparar: (c) => carregarDoisTenants(c).then(() => undefined) });
    await comAdmin(b.nome, (c) => carregarDemo(c, { senha: SENHA, hoje }));
    await gravarNaTransacao(hoje);
    pool = new pg.Pool({ connectionString: b.urlApp });
  });
  afterAll(async () => {
    await pool?.end();
    await b?.apagar();
  });

  it('grava tudo do dadosDemoPromotor; as colunas derivadas batem com a visita do Core (check-in, checkout, loja)', async () => {
    const d = dadosDemoPromotor({ hoje });
    expect(await contar()).toEqual(Object.fromEntries(ORDEM_DEMO_PROMOTOR.map((t) => [t, t.startsWith('plataforma.') ? expect.any(Number) : d[t].length])));
    const r = await comAdmin(b.nome, (c) =>
      c.query<{ ok: boolean }>(
        `select bool_and(vl.checkin_em = v.checkin_em and vl.checkout_em = v.checkout_em and vl.cliente_id = v.cliente_id and vl.promotor_id = v.usuario_id) as ok, count(*)::int as n
           from promotor.visita_loja vl join core.visita v on v.id = vl.visita_id where vl.tenant_id = $1`,
        [TENANT_DEMO],
      ),
    );
    expect(r.rows[0]).toEqual({ ok: true, n: 2 });
  });

  it('idempotente: rodar 2× (no mesmo dia) não duplica nada; em outro dia (demo + promotor) só move datas', async () => {
    const antes = await contar();
    await gravarNaTransacao(hoje);
    expect(await contar()).toEqual(antes);
    const outro = somarDias(hoje, 1);
    await comAdmin(b.nome, (c) => carregarDemo(c, { senha: SENHA, hoje: outro }));
    await gravarNaTransacao(outro);
    expect(await contar()).toEqual(antes);
    const v = await comAdmin(b.nome, (c) => c.query<{ d: string }>("select to_char(checkin_em at time zone 'UTC', 'YYYY-MM-DD') as d from promotor.visita_loja where tenant_id = $1 order by checkin_em", [TENANT_DEMO]));
    expect(v.rows.map((x) => x.d)).toEqual([diasUteisAtras(outro, 2), diasUteisAtras(outro, 1)]);
    // volta ao dia da carga para os demais casos
    await comAdmin(b.nome, (c) => carregarDemo(c, { senha: SENHA, hoje }));
    await gravarNaTransacao(hoje);
  });

  it('licença ativa: Promotor no tenant e nos 5 perfis; o promotor sem Vendedor (RN-PRO-01)', async () => {
    const r = await comTenant(pool, TENANT_DEMO, async (c) => ({
      tenant: (await c.query("select ativo from plataforma.tenant_modulo where modulo = 'promotor' and deleted_at is null")).rows,
      perfis: (await c.query<{ perfil: string }>("select perfil from plataforma.perfil_modulo where modulo = 'promotor' and deleted_at is null order by perfil")).rows.map((x) => x.perfil),
      vendedorDoPromotor: (await c.query("select 1 from plataforma.perfil_modulo where perfil = 'promotor' and modulo = 'vendedor' and deleted_at is null")).rowCount,
    }));
    expect(r).toEqual({ tenant: [{ ativo: true }], perfis: [...PERFIS_PROMOTOR_DEMO].sort(), vendedorDoPromotor: 0 });
  });

  it('isolamento pelo macuxi_app: o tenant A não vê nada do Promotor da demo; o demo vê só o dele', async () => {
    for (const t of [...COLETAS_PROMOTOR, 'promotor.categoria_gondola', 'promotor.meta_share']) {
      const deA = await comTenant(pool, DOIS_TENANTS.A.tenantId, (c) => c.query<{ n: number }>(`select count(*)::int as n from ${t} where tenant_id = $1`, [TENANT_DEMO]));
      expect(deA.rows[0]!.n, t).toBe(0);
      const doDemo = await comTenant(pool, TENANT_DEMO, (c) => c.query<{ tenant_id: string }>(`select distinct tenant_id from ${t}`));
      expect(doDemo.rows, t).toEqual([{ tenant_id: TENANT_DEMO }]);
    }
  });

  it('sem a 0015: erro claro pedindo migrar até a 0015 (nada gravado)', async () => {
    const vazio = await criarBancoDeTeste({ migrar: false });
    try {
      await comAdmin(vazio.nome, async (c) => {
        await migrarUp(c, { ate: '0012' });
        await expect(gravarDemoPromotor(c, { hoje })).rejects.toThrow(/até a 0015/);
      });
    } finally {
      await vazio.apagar();
    }
  });
});
