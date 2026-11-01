/**
 * Base de demonstração (db/seeds/demo) — demo com o gestor externo (R-20261031-233442, item 1).
 * Idempotência (rodar 2× não duplica nem troca o hash), --recriar (zera o ensaio), isolamento do tenant (não toca
 * linha de outro tenant; pelo papel macuxi_app só o contexto demo enxerga a base) e a trava de banco local.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { carregarDoisTenants, DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { carregarDemo, CODIGO_DEMO, dadosDemo, diasUteisAtras, MODULOS_DEMO, TENANT_DEMO, USUARIOS_DEMO } from '../seeds/demo/demo';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { comTenant } from '../src/contexto';
import { anoMes, hojeNoFuso } from '../src/datas';
import { verificarSenha } from '../src/senha';
import { semBanco } from './estado';
import { tabelasComTenant } from './util';

const SENHA = 'senha-do-teste-demo';
const HASH_FALSO = '$argon2id$v=19$m=1,t=1,p=1$c2Fs$aGFzaA';

describe('base de demo (estático)', () => {
  const hoje = '2026-11-04';
  const d = dadosDemo(HASH_FALSO, { hoje });
  const vendedor = d['core.usuario'].find((u) => u.email === USUARIOS_DEMO.vendedor.email)!;

  it('tenant "Distribuidora Exemplo", código curto, fuso de Manaus e os 4 módulos', () => {
    expect(d['plataforma.tenant']).toEqual([expect.objectContaining({ id: TENANT_DEMO, codigo: CODIGO_DEMO, nome: 'Distribuidora Exemplo', fuso: 'America/Manaus' })]);
    expect(CODIGO_DEMO).toMatch(/^[a-z]{3,8}$/);
    expect(d['plataforma.tenant_modulo'].map((m) => m.modulo).sort()).toEqual([...MODULOS_DEMO].sort());
  });

  it('logins: vendedor, supervisor, promotor, analista e admin, só e-mails fictícios', () => {
    const perfis = new Set(d['core.usuario'].map((u) => u.perfil));
    for (const p of ['vendedor', 'supervisor', 'promotor', 'analista', 'admin']) expect(perfis.has(p)).toBe(true);
    expect(d['core.usuario'].every((u) => String(u.email).endsWith('@exemplo.com.br'))).toBe(true);
    // RN-PRO-01: o perfil promotor não ganha o módulo Vendedor
    expect(d['plataforma.perfil_modulo'].some((p) => p.perfil === 'promotor' && p.modulo === 'vendedor')).toBe(false);
  });

  it('30 clientes em Manaus, com coordenadas na cidade, contato com telefone fictício e financeiro', () => {
    const cs = d['core.cliente'];
    expect(cs).toHaveLength(30);
    for (const c of cs) {
      expect(c.cidade).toBe('Manaus');
      expect(c.uf).toBe('AM');
      expect(Number(c.latitude)).toBeGreaterThan(-3.2);
      expect(Number(c.latitude)).toBeLessThan(-2.95);
      expect(Number(c.longitude)).toBeGreaterThan(-60.15);
      expect(Number(c.longitude)).toBeLessThan(-59.9);
      expect(c.logradouro).toBeTruthy();
    }
    // prefixos não atribuídos (fixo 3000-0xxx, celular 9 0000-xxxx): nunca é número real
    expect(d['core.cliente_contato'].every((x) => /^9230000\d{3}$/.test(String(x.telefone)) && /^9290000\d{4}$/.test(String(x.whatsapp)))).toBe(true);
    expect(d['core.cliente_financeiro']).toHaveLength(30);
    const vencidos = d['core.titulo'].filter((t) => t.situacao === 'aberto' && String(t.vencimento) < hoje);
    expect(new Set(vencidos.map((t) => t.cliente_id)).size).toBe(8);
    expect(d['core.cliente_financeiro'].filter((f) => f.bloqueado)).toHaveLength(1);
  });

  it('rota de hoje do vendedor com 6 paradas da carteira dele, na data dada', () => {
    const rota = d['core.rota'].find((r) => r.usuario_id === vendedor.id)!;
    expect(rota.data).toBe(hoje);
    const paradas = d['core.rota_parada'].filter((p) => p.rota_id === rota.id);
    expect(paradas.map((p) => p.sequencia)).toEqual([1, 2, 3, 4, 5, 6]);
    const carteira = new Set(d['core.carteira'].filter((c) => c.usuario_id === vendedor.id).map((c) => c.cliente_id));
    expect(paradas.every((p) => carteira.has(p.cliente_id) && p.data === hoje)).toBe(true);
  });

  it('metas do mês, pedidos e visitas só no passado, diário coerente com os pedidos', () => {
    expect(d['core.meta'].every((m) => m.periodo === anoMes(hoje))).toBe(true);
    expect(d['core.meta'].filter((m) => m.usuario_id === vendedor.id).map((m) => m.indicador).sort()).toEqual(['cobertura_pct', 'positivacao', 'venda_cents', 'visitas']);
    expect(d['core.visita'].every((v) => String(v.data_local) < hoje)).toBe(true);
    const status = new Set(d['vendedor.pedido'].map((p) => p.status));
    for (const s of ['pending_approval', 'approved', 'invoiced', 'cancelled']) expect(status.has(s)).toBe(true);
    const vendido = d['vendedor.pedido'].filter((p) => ['approved', 'sent_to_erp', 'invoiced', 'cancelled'].includes(String(p.status))).reduce((s, p) => s + Number(p.total_cents), 0);
    expect(d['core.indicador_diario'].reduce((s, x) => s + Number(x.vendido_cents), 0)).toBe(vendido);
    for (const p of d['vendedor.pedido']) {
      const itens = d['vendedor.pedido_item'].filter((i) => i.pedido_id === p.id);
      expect(itens.reduce((s, i) => s + Number(i.total_cents), 0)).toBe(p.total_cents);
    }
  });

  it('dias úteis pulam o domingo', () => {
    expect(diasUteisAtras('2026-11-02', 1)).toBe('2026-10-31'); // segunda -> sábado
    expect(diasUteisAtras('2026-11-03', 2)).toBe('2026-10-31');
  });

  it('recusa banco que não é local, antes de qualquer consulta', async () => {
    let consultou = false;
    const remoto = { host: 'db.homologacao.exemplo.com', query: async () => { consultou = true; return { rows: [] }; } };
    await expect(carregarDemo(remoto as unknown as pg.Client, { senha: SENHA })).rejects.toThrow(/recusado: banco fora do ambiente local/);
    expect(consultou).toBe(false);
  });
});

describe.skipIf(semBanco())('base de demo (Postgres)', () => {
  let b: BancoDeTeste;
  let pool: pg.Pool;

  /** Contagem por tabela e "impressão digital" (md5 das linhas) de tudo que NÃO é do tenant demo. */
  async function outrosTenants(): Promise<Record<string, string>> {
    return comAdmin(b.nome, async (c) => {
      const out: Record<string, string> = {};
      for (const t of await tabelasComTenant(c)) {
        const r = await c.query<{ n: number; h: string | null }>(
          `select count(*)::int as n, md5(string_agg(x::text, '|' order by x::text)) as h from ${t.schema}.${t.tabela} x where tenant_id <> $1`,
          [TENANT_DEMO],
        );
        out[t.nome] = `${r.rows[0]!.n}:${r.rows[0]!.h ?? ''}`;
      }
      const tn = await c.query<{ h: string }>('select md5(string_agg(x::text, \'|\' order by x.id)) as h from plataforma.tenant x where id <> $1', [TENANT_DEMO]);
      out['plataforma.tenant'] = tn.rows[0]!.h;
      return out;
    });
  }

  async function contarDemo(): Promise<Record<string, number>> {
    return comAdmin(b.nome, async (c) => {
      const out: Record<string, number> = {};
      for (const t of await tabelasComTenant(c)) {
        const r = await c.query<{ n: number }>(`select count(*)::int as n from ${t.schema}.${t.tabela} where tenant_id = $1`, [TENANT_DEMO]);
        out[t.nome] = r.rows[0]!.n;
      }
      return out;
    });
  }

  let antesOutros: Record<string, string>;
  /** "Hoje" da 1ª carga (padrão do seed: data de Manaus no relógio); as recargas fixam o mesmo dia (sem corrida na virada). */
  let hojeCarga: string;
  let hojesPossiveis: string[];

  beforeAll(async () => {
    b = await criarBancoDeTeste({ preparar: (c) => carregarDoisTenants(c).then(() => undefined) });
    antesOutros = await outrosTenants();
    const antes = hojeNoFuso('America/Manaus');
    hojeCarga = (await comAdmin(b.nome, (c) => carregarDemo(c, { senha: SENHA }))).hoje;
    hojesPossiveis = [...new Set([antes, hojeNoFuso('America/Manaus')])];
    pool = new pg.Pool({ connectionString: b.urlApp });
  });
  afterAll(async () => {
    await pool?.end();
    await b?.apagar();
  });

  it('carrega 30 clientes, rota de hoje (fuso do tenant) com 6 paradas e os motivos padrão do gatilho', async () => {
    // padrão do seed = hoje em Manaus no momento da carga (se a carga cruzou a meia-noite, vale qualquer dos dois)
    expect(hojesPossiveis).toContain(hojeCarga);
    const hoje = hojeCarga;
    const r = await comTenant(pool, TENANT_DEMO, async (c) => ({
      clientes: (await c.query<{ n: number }>('select count(*)::int as n from core.cliente')).rows[0]!.n,
      paradas: (await c.query<{ n: number }>(
        "select count(*)::int as n from core.rota_parada p join core.usuario u on u.id = p.usuario_id where u.email = $1 and p.data = $2::date and p.deleted_at is null",
        [USUARIOS_DEMO.vendedor.email, hoje],
      )).rows[0]!.n,
      motivos: (await c.query<{ codigo: string }>("select codigo from core.motivo where tipo = 'cliente_fechado' order by codigo")).rows.map((x) => x.codigo),
      modulos: (await c.query<{ modulo: string }>('select modulo from plataforma.tenant_modulo where ativo order by modulo')).rows.map((x) => x.modulo),
    }));
    expect(r).toEqual({ clientes: 30, paradas: 6, motivos: ['acesso_negado', 'loja_fechada'], modulos: [...MODULOS_DEMO].sort() });
  });

  it('login: o código "demo" resolve o tenant e as senhas são argon2id que conferem', async () => {
    const t = await pool.query<{ id: string; nome: string }>('select id, nome from plataforma.tenant_por_codigo($1)', ['DEMO']);
    expect(t.rows).toEqual([{ id: TENANT_DEMO, nome: 'Distribuidora Exemplo' }]);
    const us = await comAdmin(b.nome, (c) => c.query<{ senha_hash: string }>('select senha_hash from core.usuario where tenant_id = $1', [TENANT_DEMO]));
    expect(us.rows).toHaveLength(Object.keys(USUARIOS_DEMO).length);
    for (const u of us.rows) {
      expect(u.senha_hash.startsWith('$argon2id$')).toBe(true);
      expect(u.senha_hash).not.toContain(SENHA);
    }
    expect(verificarSenha(SENHA, us.rows[0]!.senha_hash)).toBe(true);
  });

  it('idempotente: rodar de novo não duplica nada nem troca o hash da senha', async () => {
    const antes = await contarDemo();
    const hash = () => comAdmin(b.nome, (c) => c.query('select id, senha_hash from core.usuario where tenant_id = $1 order by id', [TENANT_DEMO]));
    const hashAntes = (await hash()).rows;
    await comAdmin(b.nome, (c) => carregarDemo(c, { senha: SENHA, hoje: hojeCarga }));
    expect(await contarDemo()).toEqual(antes);
    expect((await hash()).rows).toEqual(hashAntes);
  });

  it('outro dia: só a rota do novo dia entra; o diário anda junto (realizado não duplica)', async () => {
    const somaDiario = () =>
      comAdmin(b.nome, (c) => c.query<{ s: string }>('select coalesce(sum(vendido_cents), 0)::text as s from core.indicador_diario where tenant_id = $1', [TENANT_DEMO]));
    const antes = (await somaDiario()).rows[0]!.s;
    const contagem = await contarDemo();
    const dia = '2027-03-10';
    await comAdmin(b.nome, (c) => carregarDemo(c, { senha: SENHA, hoje: dia }));
    const depois = await contarDemo();
    expect(depois['core.rota']).toBe(contagem['core.rota']! + 3);
    expect(depois['core.rota_parada']).toBe(contagem['core.rota_parada']! + 14);
    expect(depois['core.indicador_diario']).toBe(contagem['core.indicador_diario']);
    expect((await somaDiario()).rows[0]!.s).toBe(antes);
    expect(depois['core.cliente']).toBe(30);
  });

  it('--recriar zera o ensaio: visita aberta e senha bloqueada somem, a base volta ao tamanho de uma carga só', async () => {
    const vendedorId = (await comAdmin(b.nome, (c) => c.query<{ id: string }>('select id from core.usuario where tenant_id = $1 and email = $2', [TENANT_DEMO, USUARIOS_DEMO.vendedor.email]))).rows[0]!.id;
    await comTenant(pool, TENANT_DEMO, async (c) => {
      const cli = (await c.query<{ id: string }>('select id from core.cliente limit 1')).rows[0]!.id;
      await c.query(
        "insert into core.visita (tenant_id, usuario_id, cliente_id, data_local, checkin_em) values (plataforma.tenant_atual(), $1, $2, $3::date, $4::timestamptz)",
        [vendedorId, cli, hojeCarga, `${hojeCarga}T14:00:00Z`],
      );
    });
    await comAdmin(b.nome, (c) => c.query('update core.usuario set tentativas_falhas = 5, bloqueio_ate = now() + interval \'1 hour\' where id = $1', [vendedorId]));
    await comAdmin(b.nome, (c) => carregarDemo(c, { senha: SENHA, recriar: true, hoje: hojeCarga }));
    const n = await contarDemo();
    const limpo = await (async () => {
      const outro = await criarBancoDeTeste({ preparar: (c) => carregarDemo(c, { senha: SENHA, hoje: hojeCarga }).then(() => undefined) });
      try {
        return await comAdmin(outro.nome, async (c) => {
          const out: Record<string, number> = {};
          for (const t of await tabelasComTenant(c)) {
            out[t.nome] = (await c.query<{ n: number }>(`select count(*)::int as n from ${t.schema}.${t.tabela} where tenant_id = $1`, [TENANT_DEMO])).rows[0]!.n;
          }
          return out;
        });
      } finally {
        await outro.apagar();
      }
    })();
    expect(n).toEqual(limpo);
    const u = await comAdmin(b.nome, (c) => c.query<{ tentativas_falhas: number; bloqueio_ate: Date | null }>('select tentativas_falhas, bloqueio_ate from core.usuario where id = $1', [vendedorId]));
    expect(u.rows[0]).toEqual({ tentativas_falhas: 0, bloqueio_ate: null });
  }, 300_000); // cria e migra um 2º banco dentro do teste: ~30 s sozinho, passa de 60 s com as outras suítes em paralelo

  it('isolamento: carga, recarga e --recriar não mudam nenhuma linha de outro tenant', async () => {
    expect(await outrosTenants()).toEqual(antesOutros);
  });

  it('isolamento pelo papel macuxi_app: o tenant A não vê a base demo e o demo não vê o A', async () => {
    const demoClientes = new Set(dadosDemo(HASH_FALSO)['core.cliente'].map((c) => String(c.id)));
    const vistosPorA = await comTenant(pool, DOIS_TENANTS.A.tenantId, (c) => c.query<{ id: string; tenant_id: string }>('select id, tenant_id from core.cliente'));
    expect(vistosPorA.rows.length).toBeGreaterThan(0);
    expect(vistosPorA.rows.some((r) => demoClientes.has(r.id) || r.tenant_id === TENANT_DEMO)).toBe(false);
    const vistosPeloDemo = await comTenant(pool, TENANT_DEMO, (c) => c.query<{ tenant_id: string }>('select distinct tenant_id from core.usuario'));
    expect(vistosPeloDemo.rows).toEqual([{ tenant_id: TENANT_DEMO }]);
  });
});
