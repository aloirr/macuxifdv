/**
 * T-0210 (decisão "1 A") — "Vendas do mês" hoje × pelas RN, na base demo (`carregarDemo`) × `createApp` real × Postgres.
 * Compara o que o gestor recebe na tela com um ORÁCULO escrito aqui a partir do texto da RN (nunca a função testada):
 *  - app Gestão e BKO (módulo gestor): ficha `GET /v1/gestor/equipe/:id` (painel.mes), resumo da equipe `GET /v1/gestor/equipe`
 *    e Ranking mensal `GET /v1/gestor/ranking` (vendas_cents e positivados);
 *  - BKO Indicadores e Metas (módulo core): `GET /v1/core/indicadores` (realizado de venda_cents e positivados).
 * Regras:
 *  - RN-CORE-21: o realizado depende do TIPO DA META (core.meta.tipo), não de parâmetro do tenant. Meta de pedido = Σ pedidos
 *    aprovados (aprovado, integrado, faturado) na data de EMISSÃO (fuso do tenant). Meta de faturamento = Σ do VALOR FATURADO
 *    (notas), na data do faturamento, líquido de cancelamentos e devoluções (faturado parcial = só o que foi faturado).
 *  - RN-CORE-20: positivado = cliente com ≥ 1 pedido APROVADO emitido no período, qualquer que seja o tipo da meta.
 * Cenários (o banco é alterado entre eles pelo admin, como o BKO faria):
 *  S0 base demo como está (metas.base_apuracao = aprovado; metas tipo pedido);
 *  S1 parâmetro do tenant = faturado, metas continuam tipo pedido (ponto 1 e 3);
 *  S2 parâmetro = aprovado, metas de venda dos 2 vendedores tipo faturamento (ponto 1);
 *  S3 parâmetro = faturado e metas tipo faturamento (ponto 2: p08 da Camila é faturado parcial; ponto 3).
 * Os casos que divergem da RN hoje ficam em `it.fails` (viram `it` no commit da correção do modulo-gestor / modulo-core).
 * Matriz: docs/testes/T-0210.md.
 */
import { semBanco } from '@macuxi/db/teste/estado';
import { localDate } from '@macuxi/comum';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO, subirApiDemo, TENANT_DEMO, type ApiDemo } from '../apoio/demo';

const FUSO = 'America/Manaus';
const APROVADOS = ['approved', 'sent_to_erp', 'integrated', 'invoiced_partial', 'invoiced']; // RN-CORE-21: aprovado, integrado, faturado
type Cenario = 'S0' | 'S1' | 'S2' | 'S3' | 'S4' | 'S5';
type TipoMeta = 'pedido' | 'faturamento';

interface Numeros { vendas_cents: number; pedidos: number | null; positivados: number | null; atingimento_pct: number | null }
interface Linha { cenario: Cenario; tela: string; quem: string; tipo: TipoMeta; base_param: string; hoje: Numeros; rn: Numeros }

describe.skipIf(semBanco())('T-0210 — Vendas do mês: número de hoje × número pelas RN-CORE-20/21 (base demo)', () => {
  let api: ApiDemo;
  const token: Record<'supervisor' | 'gerente', string> = { supervisor: '', gerente: '' };
  const uid: Record<'vendedor' | 'vendedor2', string> = { vendedor: '', vendedor2: '' };
  const NOME = { vendedor: 'Lucas', vendedor2: 'Camila' } as const;
  const tabela: Linha[] = [];
  let periodo = '';

  const sql = async <T extends Record<string, unknown>>(q: string, p: unknown[] = []) => (await api.admin.query<T>(q, p)).rows;
  const diaDe = (iso: string) => localDate(new Date(iso), FUSO);

  /** Oráculo pelo texto da RN (fatos lidos do banco, sem passar pelo domínio de nenhum módulo). */
  async function oraculo(vendedorId: string, tipo: TipoMeta, meta: number | null): Promise<Numeros> {
    const noMes = (iso: string) => diaDe(iso).slice(0, 7) === periodo && diaDe(iso) <= api.hoje;
    const ped = await sql<{ cliente_id: string; status: string; total_cents: number; emitido_em: string }>(
      `select cliente_id, status, total_cents::float8 as total_cents,
              to_char(coalesce(criado_no_aparelho_em, created_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as emitido_em
         from vendedor.pedido where tenant_id = $1 and deleted_at is null and tipo = 'pedido' and vendedor_id = $2`,
      [TENANT_DEMO, vendedorId],
    );
    const aprovados = ped.filter((p) => APROVADOS.includes(p.status) && noMes(p.emitido_em));
    // RN-CORE-20: positivado sempre por pedido aprovado emitido no período
    const positivados = new Set(aprovados.map((p) => p.cliente_id)).size;
    let vendas = 0;
    let pedidos: number | null = aprovados.length;
    if (tipo === 'pedido') vendas = aprovados.reduce((s, p) => s + Number(p.total_cents), 0);
    else {
      // RN-CORE-21 faturamento: Σ valor das notas (parcial = só a nota), na data do faturamento, − cancelado − devolvido
      const fat = await sql<{ pedido_id: string; faturado_em: string; valor: number; cancelado: boolean }>(
        `select f.pedido_id, to_char(f.faturado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as faturado_em,
                coalesce(f.nota_total_cents, (select coalesce(sum((i->>'total_cents')::bigint), 0) from jsonb_array_elements(f.itens) i))::float8 as valor,
                (p.status = 'cancelled') as cancelado
           from vendedor.pedido_faturamento f join vendedor.pedido p on p.tenant_id = f.tenant_id and p.id = f.pedido_id
          where f.tenant_id = $1 and f.deleted_at is null and p.vendedor_id = $2`,
        [TENANT_DEMO, vendedorId],
      );
      const dev = await sql<{ emitida_em: string; total_cents: number }>(
        `select to_char(n.emitida_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as emitida_em, n.total_cents::float8 as total_cents
           from vendedor.pedido_devolucao n join vendedor.pedido p on p.tenant_id = n.tenant_id and p.id = n.pedido_id
          where n.tenant_id = $1 and n.deleted_at is null and p.vendedor_id = $2`,
        [TENANT_DEMO, vendedorId],
      );
      vendas = fat.filter((f) => !f.cancelado && noMes(f.faturado_em)).reduce((s, f) => s + Number(f.valor), 0) - dev.filter((d) => noMes(d.emitida_em)).reduce((s, d) => s + Number(d.total_cents), 0);
      pedidos = null; // a meta de faturamento não define "pedidos"; fica fora da comparação
    }
    return { vendas_cents: vendas, pedidos, positivados, atingimento_pct: meta ? Math.round((vendas / meta) * 10_000) / 100 : null };
  }

  async function metaDe(vendedorId: string): Promise<{ valor: number; tipo: TipoMeta }> {
    const r = await sql<{ valor: number; tipo: TipoMeta }>("select valor::float8 as valor, tipo from core.meta where tenant_id = $1 and usuario_id = $2 and periodo = $3 and indicador = 'venda_cents' and deleted_at is null", [TENANT_DEMO, vendedorId, periodo]);
    return { valor: Number(r[0]!.valor), tipo: r[0]!.tipo };
  }
  async function baseParam(): Promise<string> {
    const r = await sql<{ modulo: string; valor: string }>(
      "select modulo, valor #>> '{}' as valor from plataforma.parametro where tenant_id = $1 and ((modulo = 'core' and chave = 'metas.base_apuracao') or (modulo = 'gestor' and chave = 'base_apuracao')) and deleted_at is null order by modulo",
      [TENANT_DEMO],
    );
    return r.map((x) => `${x.modulo}:${x.valor}`).join(',') || '(ausente)';
  }
  const CENARIOS: Record<Cenario, { core: 'aprovado' | 'faturado'; gestor: 'faturado' | null; tipo: TipoMeta }> = {
    S0: { core: 'aprovado', gestor: null, tipo: 'pedido' },
    S1: { core: 'faturado', gestor: null, tipo: 'pedido' },
    S2: { core: 'aprovado', gestor: null, tipo: 'faturamento' },
    S3: { core: 'faturado', gestor: null, tipo: 'faturamento' },
    S4: { core: 'aprovado', gestor: 'faturado', tipo: 'pedido' },
    S5: { core: 'aprovado', gestor: 'faturado', tipo: 'faturamento' },
  };
  async function aplicar(c: Cenario) {
    const { core, gestor, tipo } = CENARIOS[c];
    await api.admin.query("update plataforma.parametro set valor = to_jsonb($2::text) where tenant_id = $1 and modulo = 'core' and chave = 'metas.base_apuracao'", [TENANT_DEMO, core]);
    await api.admin.query("update plataforma.parametro set deleted_at = now() where tenant_id = $1 and modulo = 'gestor' and chave = 'base_apuracao' and deleted_at is null", [TENANT_DEMO]);
    if (gestor) await api.admin.query("insert into plataforma.parametro (tenant_id, modulo, chave, valor) values ($1, 'gestor', 'base_apuracao', to_jsonb($2::text))", [TENANT_DEMO, gestor]);
    await api.admin.query("update core.meta set tipo = $3 where tenant_id = $1 and periodo = $2 and indicador = 'venda_cents'", [TENANT_DEMO, periodo, tipo]);
  }

  async function telas(c: Cenario) {
    const base_param = await baseParam();
    const core = await api.get(token.supervisor, `/v1/core/indicadores?periodo=${periodo}`);
    expect(core.status).toBe(200);
    const equipe = await api.get(token.supervisor, `/v1/gestor/equipe?data=${api.hoje}`);
    expect(equipe.status).toBe(200);
    const rkV = await api.get(token.supervisor, `/v1/gestor/ranking?indicador=vendas_cents&periodo=mensal&data=${api.hoje}`);
    const rkP = await api.get(token.supervisor, `/v1/gestor/ranking?indicador=positivados&periodo=mensal&data=${api.hoje}`);
    expect([rkV.status, rkP.status]).toEqual([200, 200]);
    const somaRn: Numeros = { vendas_cents: 0, pedidos: 0, positivados: 0, atingimento_pct: null };
    let metaEquipe = 0;
    for (const k of ['vendedor', 'vendedor2'] as const) {
      const meta = await metaDe(uid[k]);
      const rn = await oraculo(uid[k], meta.tipo, meta.valor);
      somaRn.vendas_cents += rn.vendas_cents;
      somaRn.pedidos = rn.pedidos === null || somaRn.pedidos === null ? null : somaRn.pedidos + rn.pedidos;
      metaEquipe += meta.valor;
      const ficha = await api.get(token.supervisor, `/v1/gestor/equipe/${uid[k]}?data=${api.hoje}`);
      expect(ficha.status).toBe(200);
      const mes = (ficha.corpo.painel as { mes: { vendas_cents: number; pedidos: number; clientes_positivados: number; atingimento_pct: number | null } }).mes;
      tabela.push({ cenario: c, tela: 'Gestão/BKO ficha: Vendas do mês', quem: NOME[k], tipo: meta.tipo, base_param, hoje: { vendas_cents: mes.vendas_cents, pedidos: mes.pedidos, positivados: mes.clientes_positivados, atingimento_pct: mes.atingimento_pct }, rn });
      const linhaV = (rkV.corpo.linhas as Array<{ usuario_id: string; valor: number | null }>).find((l) => l.usuario_id === uid[k]);
      const linhaP = (rkP.corpo.linhas as Array<{ usuario_id: string; valor: number | null }>).find((l) => l.usuario_id === uid[k]);
      tabela.push({ cenario: c, tela: 'Gestão/BKO Ranking mensal', quem: NOME[k], tipo: meta.tipo, base_param, hoje: { vendas_cents: Number(linhaV?.valor ?? 0), pedidos: null, positivados: Number(linhaP?.valor ?? 0), atingimento_pct: null }, rn: { ...rn, pedidos: null, atingimento_pct: null } });
      const item = (core.corpo.itens as Array<{ usuario_id: string; indicadores: { realizado_cents: number | null; positivados: number | null } }>).find((i) => i.usuario_id === uid[k]);
      tabela.push({ cenario: c, tela: `BKO Indicadores (${String(core.corpo.base_apuracao)})`, quem: NOME[k], tipo: meta.tipo, base_param, hoje: { vendas_cents: Number(item?.indicadores.realizado_cents ?? -1), pedidos: null, positivados: item?.indicadores.positivados ?? null, atingimento_pct: null }, rn: { ...rn, pedidos: null, atingimento_pct: null } });
    }
    const resumo = equipe.corpo.resumo as { vendas_cents: number | null; pedidos: number | null; atingimento_pct: number | null };
    somaRn.atingimento_pct = Math.round((somaRn.vendas_cents / metaEquipe) * 10_000) / 100;
    // vendas e pedidos do resumo são do DIA (RN-GES-06): do resumo só o atingimento do mês entra na comparação
    const so = { vendas_cents: 0, pedidos: null, positivados: null };
    tabela.push({ cenario: c, tela: 'Gestão/BKO Equipe (resumo, atingimento do mês)', quem: 'Equipe Renata', tipo: (await metaDe(uid.vendedor)).tipo, base_param, hoje: { ...so, atingimento_pct: resumo.atingimento_pct }, rn: { ...so, atingimento_pct: somaRn.atingimento_pct } });
  }

  const linhasDe = (c: Cenario, tela: RegExp) => tabela.filter((l) => l.cenario === c && tela.test(l.tela));
  const iguais = (l: Linha) => {
    expect.soft(l.hoje.vendas_cents, `${l.cenario} ${l.tela} ${l.quem}: vendas`).toBe(l.rn.vendas_cents);
    if (l.rn.atingimento_pct !== null && l.hoje.atingimento_pct !== null) expect.soft(l.hoje.atingimento_pct, `${l.cenario} ${l.tela} ${l.quem}: atingimento`).toBeCloseTo(l.rn.atingimento_pct, 1);
    if (l.rn.positivados !== null) expect.soft(l.hoje.positivados, `${l.cenario} ${l.tela} ${l.quem}: positivados`).toBe(l.rn.positivados);
    if (l.rn.pedidos !== null && l.hoje.pedidos !== null) expect.soft(l.hoje.pedidos, `${l.cenario} ${l.tela} ${l.quem}: pedidos`).toBe(l.rn.pedidos);
  };

  beforeAll(async () => {
    api = await subirApiDemo();
    periodo = api.hoje.slice(0, 7);
    token.supervisor = (await api.sessao(DEMO.supervisor)).access_token;
    token.gerente = (await api.sessao(DEMO.gerente)).access_token;
    for (const k of ['vendedor', 'vendedor2'] as const) uid[k] = (await api.sessao(DEMO[k])).usuario.id;
    for (const c of Object.keys(CENARIOS) as Cenario[]) {
      await aplicar(c);
      await telas(c);
    }
    await aplicar('S0');
    const fmt = (n: Numeros) => `R$ ${(n.vendas_cents / 100).toFixed(2)} | ped ${n.pedidos ?? '-'} | pos ${n.positivados ?? '-'} | at ${n.atingimento_pct ?? '-'}`;
    console.log(`[T-0210] hoje=${api.hoje}\n` + tabela.map((l) => `${l.cenario} | base=${l.base_param} tipo=${l.tipo} | ${l.tela} | ${l.quem} || HOJE ${fmt(l.hoje)} || RN ${fmt(l.rn)}`).join('\n'));
  }, 300_000);
  afterAll(async () => {
    await api?.fechar();
  });

  it('V0. S0 (base demo: parâmetro do core "aprovado", metas de pedido): gestor e core já mostram o número da RN-CORE-20/21', () => {
    for (const l of linhasDe('S0', /./)) iguais(l);
  });

  it('V1. S1: parâmetro do CORE em "faturado" com meta de pedido: gestor e core apuram por pedido aprovado (o gestor não lê a chave do core)', () => {
    for (const l of linhasDe('S1', /./)) iguais(l);
  });

  it.fails('V1r. RN-CORE-21 rótulo × valor: com meta de pedido, o BKO Indicadores não diz "base: notas faturadas" (a base do rótulo vem do parâmetro do core, não do tipo da meta)', () => {
    expect(linhasDe('S1', /BKO Indicadores/)[0]!.tela).toContain('(aprovado)');
  });

  it.fails('V2. RN-CORE-21 (ponto 1): meta de FATURAMENTO: o gestor (ficha, ranking, atingimento da equipe) apura pelo valor faturado na data do faturamento', () => {
    for (const l of [...linhasDe('S2', /Gestão/), ...linhasDe('S3', /Gestão/)]) iguais(l);
  });

  it.fails('V4. RN-CORE-21 (ponto 1) e RN-CORE-20 (ponto 3): parâmetro do GESTOR "faturado" com meta de PEDIDO: o gestor apura por pedido aprovado na emissão e positiva por aprovado', () => {
    for (const l of linhasDe('S4', /Gestão/)) iguais(l);
  });

  it.fails('V5. RN-CORE-21 (ponto 2) e RN-CORE-20 (ponto 3): parâmetro do gestor "faturado" com meta de faturamento: parcial soma só o faturado (p08) e positivados por aprovado', () => {
    for (const l of linhasDe('S5', /Gestão/)) iguais(l);
  });

  it('V6. Core (BKO Indicadores e Metas) segue a RN-CORE-20/21 pelo tipo da meta com meta de pedido (S0, S1, S4)', () => {
    for (const l of tabela.filter((x) => /BKO Indicadores/.test(x.tela) && x.tipo === 'pedido')) iguais(l);
  });

  it.fails('V7. RN-CORE-21 "líquido de devoluções": meta de faturamento no core desconta a devolução do p02 do Lucas (a consulta vendedor.pedidos_da_meta@1 manda devolvido_cents nulo)', () => {
    for (const l of tabela.filter((x) => /BKO Indicadores/.test(x.tela) && x.tipo === 'faturamento')) iguais(l);
  });
});
