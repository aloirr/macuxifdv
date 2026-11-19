/**
 * T-0186 (Cliente 360 v2) — virada de mês e fuso do tenant no período do Histórico (P8: padrão 90 dias, até 12 meses; P17),
 * com a API REAL (createApp × Postgres como macuxi_app × fixture dois-tenants: A = Manaus, UTC−4; B = São Paulo, UTC−3) e o
 * relógio das rotas congelado (`subirApi({ relogio })`; o login segue o relógio real).
 *
 * ORÁCULO (escrito aqui, sem chamar o domain): "hoje" é a data civil no fuso do tenant; a data da NF é `emitida_em` no fuso do
 * tenant; o padrão vai de hoje − 90 dias a hoje, inclusive; 12 meses = o mesmo dia do ano anterior (no dia que não existe,
 * 29/02, o último dia de fevereiro). O período não usa calendário de dias úteis (domingo conta igual).
 * Instantes: I1 = 01/12/2026 03h30 UTC (30/11 23h30 em Manaus; 01/12 00h30 em São Paulo); I2 = 01/12/2026 04h30 UTC.
 * Matriz: docs/testes/T-0186.md (P-01..P-06).
 */
import { semBanco } from '@macuxi/db/teste/estado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inicioDoPeriodoNf } from '../../../modules/core/domain';
import { A, B, erroDe, subirApi, type ApiDeTeste, type Tenant } from '../apoio/api';

const I1 = '2026-12-01T03:30:00Z';
const I2 = '2026-12-01T04:30:00Z';
const id = (n: number) => `0f186000-0000-4000-8000-${String(n).padStart(12, '0')}`;
/** Notas de faturamento (número → emissão UTC). */
const NOTAS_A = { '186001': '2026-12-01T03:00:00Z', '186002': '2026-09-01T03:30:00Z', '186003': '2026-09-01T04:30:00Z', '186004': '2025-11-30T15:00:00Z' } as const;
const NOTAS_B = { '186101': '2026-12-01T02:30:00Z', '186102': '2026-12-01T03:15:00Z' } as const;

/** Oráculo: soma dias a uma data civil (UTC puro, sem fuso). */
const somarDias = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const dataValida = (d: string) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

describe('T-0186 — período do Histórico sem banco (domain usado pela API e pelo aparelho)', () => {
  it('P-05 (dia útil e não útil): 90 dias = hoje − 90 na terça e no domingo (sem calendário de dias úteis)', () => {
    for (const hoje of ['2026-11-17', '2026-11-15']) expect(inicioDoPeriodoNf('90d', hoje), hoje).toBe(somarDias(hoje, -90));
    expect(inicioDoPeriodoNf('30d', '2026-03-01')).toBe('2026-01-30');
  });

  it('P-06 (P8, virada de ano bissexto): 12 meses a partir de 29/02/2028 começa numa data que existe (28/02/2027)', () => {
    const de = inicioDoPeriodoNf('12m', '2028-02-29');
    expect(dataValida(de), `início "${de}"`).toBe(true);
    expect(de).toBe('2027-02-28');
  });
});

describe.skipIf(semBanco())('T-0186 — virada de mês e fuso do tenant no período do Histórico (createApp real × Postgres)', () => {
  let api: ApiDeTeste;
  let congelado: Date | null = null;
  const tk = { adminA: '', adminB: '' };

  async function notas(t: Tenant, instante: string, query = '') {
    congelado = new Date(instante);
    try {
      const r = await api.chamar(t === A ? tk.adminA : tk.adminB, { method: 'GET', url: `/v1/core/clientes/${t.clientes.c1}/notas${query}` });
      return r;
    } finally {
      congelado = null;
    }
  }
  const lista = async (t: Tenant, instante: string, query = '') => {
    const r = await notas(t, instante, query);
    expect(r.statusCode, r.body).toBe(200);
    const corpo = r.json() as { de: string; ate: string; itens: { numero_nf: string; data: string }[] };
    return { de: corpo.de, ate: corpo.ate, nfs: corpo.itens.filter((n) => n.numero_nf.startsWith('186')).map((n) => `${n.numero_nf}@${n.data}`) };
  };

  beforeAll(async () => {
    // hora-fixa-ok: login no relógio real (o JWT é verificado no real); só as chamadas de notas usam o instante fixo
    api = await subirApi({ relogio: () => (congelado ? new Date(congelado.getTime()) : new Date()) });
    tk.adminA = (await api.sessao('admin@exemplo.com.br', A)).access_token;
    tk.adminB = (await api.sessao('admin.b@exemplo.com.br', B)).access_token;
    let n = 0;
    for (const [t, lista_] of [[A, NOTAS_A], [B, NOTAS_B]] as const) {
      for (const [numero, emitida] of Object.entries(lista_)) {
        n += 1;
        await api.admin.query(
          `insert into core.nota_erp (id, tenant_id, external_id, cliente_id, tipo, numero, serie, emitida_em, ano_mes, total_cents, quantidade_itens, cancelada)
           values ($1, $2, $3, $4, 'faturamento', $5, '1', $6::timestamptz, to_char($6::timestamptz at time zone $7, 'YYYY-MM'), 10000, 1, false)`,
          [id(n), t.tenantId, `NF-T186-${numero}`, t.clientes.c1, numero, emitida, t === A ? 'America/Manaus' : 'America/Sao_Paulo'],
        );
      }
    }
  }, 120_000);

  afterAll(async () => {
    await api?.fechar();
  });

  it('P-01 (fuso de Manaus, I1 = 30/11 23h30): hoje = 30/11; a NF de 01/12 03h00 UTC é de 30/11; o padrão vai de 01/09 a 30/11', async () => {
    const r = await lista(A, I1);
    expect([r.de, r.ate]).toEqual([somarDias('2026-11-30', -90), '2026-11-30']);
    expect(r.de).toBe('2026-09-01');
    // 01/09 03h30 UTC = 31/08 23h30 em Manaus: fora; 01/09 04h30 UTC = 01/09 00h30: dentro
    expect(r.nfs).toEqual(['186001@2026-11-30', '186003@2026-09-01']);
  });

  it('P-02 (virada do dia em Manaus, I2 = 01/12 00h30): hoje = 01/12; o início anda um dia e a NF de 01/09 sai', async () => {
    const r = await lista(A, I2);
    expect([r.de, r.ate]).toEqual(['2026-09-02', '2026-12-01']);
    expect(r.nfs).toEqual(['186001@2026-11-30']);
  });

  it('P-03 (virada de mês): o filtro "novembro" (01/11 a 30/11) traz a NF emitida em 01/12 UTC, que é de 30/11 no fuso do tenant', async () => {
    const r = await lista(A, I2, '?de=2026-11-01&ate=2026-11-30');
    expect(r.nfs).toEqual(['186001@2026-11-30']);
    const dezembro = await lista(A, I2, '?de=2026-12-01&ate=2026-12-01');
    expect(dezembro.nfs).toEqual([]);
  });

  it('P-04 (fuso de São Paulo no mesmo instante I1): hoje = 01/12 em B; cada NF fica no dia de São Paulo', async () => {
    const r = await lista(B, I1);
    expect(r.ate).toBe('2026-12-01');
    expect(r.nfs).toEqual(['186102@2026-12-01', '186101@2026-11-30']);
    expect((await lista(B, I1, '?de=2026-12-01')).nfs).toEqual(['186102@2026-12-01']);
  });

  it('P-07 (P8, limite de 12 meses no fuso do tenant): em A no I1 (hoje 30/11) o início 30/11/2025 vale e 29/11/2025 é recusado', async () => {
    const ok = await lista(A, I1, '?de=2025-11-30');
    expect(ok.nfs).toContain('186004@2025-11-30');
    const r = await notas(A, I1, '?de=2025-11-29');
    expect(r.statusCode, r.body).toBe(422);
    expect(erroDe(r).codigo).toBe('PERIODO_INVALIDO');
  });
});
