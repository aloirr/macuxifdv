/**
 * Sprint 1 — regras que o BANCO garante nas tabelas novas (0005–0007; desenho T-0016 §7; pedido
 * R-20261031-152927-engenheiro-software). Tudo como o papel de APLICAÇÃO (macuxi_app, sujeito a RLS) sobre a
 * fixture dois-tenants, em transações desfeitas no fim (não sujam a fixture). O vazamento entre tenants das
 * tabelas novas está em vazamento.test.ts (descoberta dinâmica de toda tabela com tenant_id).
 *
 * Nada aqui depende da hora do relógio (R-20261101-014652): sem now()/current_date em instante que se compara com
 * instante da fixture. Check-in criado pelo teste usa INSTANTE_FIXO (passado) ou o checkout + N min; checkout é
 * checkin_em + intervalo. O bloco "relógio simulado" roda a RN-CORE-11 com a fixture gerada às 08:00, 13:59, 14:01 e
 * 23:59 de Manaus (vi.setSystemTime); a suíte inteira aceita MACUXI_AGORA (global-setup).
 */
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { dadosDoisTenants, DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { agoraDosTestes, hojeNoFuso } from '../src/datas';
import { idDeChave, idMotivoPadrao } from '../src/ids';
import { banco, semBanco } from './estado';
import { comCliente, emTransacao, erroDe } from './util';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const tA = A.tenantId;
const NOVO = '9d0c2f4e-1a2b-4c3d-8e9f-0000000000aa';

/** Instante fixo do passado (e a data civil dele em Manaus) para check-ins criados pelo teste. */
const INSTANTE_FIXO = '2026-10-15T14:00:00.000Z';
const DATA_FIXA = '2026-10-15';

/** Visita aberta mínima (check-in) do usuário no cliente, no instante dado (padrão: INSTANTE_FIXO). */
const checkin = (id: string, usuario: string, cliente: string, em = INSTANTE_FIXO, dataLocal = DATA_FIXA) => ({
  text: `insert into core.visita (id, tenant_id, usuario_id, cliente_id, data_local, checkin_em)
         values ($1, $2, $3, $4, $5::date, $6::timestamptz)`,
  values: [id, tA, usuario, cliente, dataLocal, em],
});

const MIN = 60_000;

describe.skipIf(semBanco())('Sprint 1: regras garantidas pelo banco (papel de aplicação)', () => {
  let app: pg.Client;

  beforeAll(async () => {
    app = new pg.Client({ connectionString: banco().urlApp });
    await app.connect();
  });
  afterAll(async () => {
    await app?.end();
  });

  const comA = <T>(fn: () => Promise<T>) => emTransacao(app, tA, fn);

  /**
   * RN-CORE-11 a partir da visita aberta v2c2Aberta (dentro de comA): fecha (auto, nao_finalizado) em check-in + 30 min;
   * novo check-in 15 min depois do checkout passa; removido (deleted_at) não conta; outro check-in passa e um segundo
   * aberto é recusado. Instantes só relativos ao check-in da fixture.
   */
  const fluxoRnCore11 = async () => {
    const f = await app.query<{ checkout_em: Date; data_local: string }>(
      "update core.visita set checkout_em = checkin_em + interval '30 minutes', resultado = 'nao_finalizado', fechada_por = 'auto' where id = $1 returning checkout_em, data_local::text",
      [A.visitas.v2c2Aberta],
    );
    expect(f.rowCount).toBe(1);
    const { checkout_em, data_local } = f.rows[0]!;
    const depois = (min: number) => new Date(checkout_em.getTime() + min * MIN).toISOString();
    await app.query(checkin('aaaaaaaa-0027-4000-8000-000000000902', A.usuarios.vendedor2, A.clientes.c2, depois(15), data_local));
    await app.query('update core.visita set deleted_at = $2 where id = $1', ['aaaaaaaa-0027-4000-8000-000000000902', depois(16)]);
    await app.query(checkin('aaaaaaaa-0027-4000-8000-000000000903', A.usuarios.vendedor2, A.clientes.c2, depois(20), data_local));
    await app.query('savepoint segunda_aberta');
    const e = await erroDe(app.query(checkin('aaaaaaaa-0027-4000-8000-000000000905', A.usuarios.vendedor2, A.clientes.c2, depois(25), data_local)));
    await app.query('rollback to savepoint segunda_aberta');
    expect(e?.message).toMatch(/visita_aberta_uk/);
  };

  describe('RN-CORE-14: motivos de sistema em todo tenant', () => {
    it.each([
      ['A', A.tenantId],
      ['B', B.tenantId],
    ])('tenant %s tem loja_fechada e acesso_negado (cliente_fechado, sistema, exige_foto) com o id determinístico', async (_r, tenant) => {
      const r = await emTransacao(app, tenant, () =>
        app.query<{ id: string; codigo: string }>("select id, codigo from core.motivo where sistema and tipo = 'cliente_fechado' and exige_foto and ativo order by codigo"),
      );
      expect(r.rows).toEqual([
        { id: idMotivoPadrao(tenant, 'acesso_negado'), codigo: 'acesso_negado' },
        { id: idMotivoPadrao(tenant, 'loja_fechada'), codigo: 'loja_fechada' },
      ]);
    });

    it('tenant NOVO recebe os motivos e os parâmetros do Core no INSERT (gatilho), sem vazar o contexto de quem inseriu', async () => {
      await comCliente(banco().urlAdmin, async (admin) => {
        await admin.query('begin');
        try {
          await admin.query("select set_config('app.tenant_id', $1, true)", [tA]);
          await admin.query("insert into plataforma.tenant (id, codigo, nome) values ($1, 'novo-sprint1', 'Novo')", [NOVO]);
          const r = await admin.query<{ codigo: string; sistema: boolean }>('select codigo, sistema from core.motivo where tenant_id = $1 order by sistema desc, ordem, codigo', [NOVO]);
          expect(r.rows.filter((m) => m.sistema).map((m) => m.codigo)).toEqual(['loja_fechada', 'acesso_negado']);
          expect(r.rows.filter((m) => !m.sistema).map((m) => m.codigo)).toEqual(['estoque_alto', 'comprador_ausente', 'sem_limite_credito', 'preco_concorrente', 'outro']);
          const p = await admin.query<{ chave: string; valor: unknown }>('select chave, valor from plataforma.parametro where tenant_id = $1 order by chave', [NOVO]);
          expect(p.rows).toEqual([
            { chave: 'checkin.raio_m', valor: 200 },
            { chave: 'metas.base_apuracao', valor: 'aprovado' },
          ]);
          const ctx = await admin.query<{ ctx: string }>("select current_setting('app.tenant_id', true) as ctx");
          expect(ctx.rows[0]!.ctx).toBe(tA);
        } finally {
          await admin.query('rollback');
        }
      });
    });

    it('motivo de sistema não é removido, desativado nem muda de código (23514); o de não venda é editável', async () => {
      for (const sql of [
        // hora-fixa-ok: soft delete, o instante nunca é comparado
        'update core.motivo set deleted_at = now() where id = $1',
        'update core.motivo set ativo = false where id = $1',
        "update core.motivo set codigo = 'outro_codigo' where id = $1",
        'update core.motivo set exige_foto = false where id = $1',
      ]) {
        const e = await erroDe(comA(() => app.query(sql, [A.motivos.lojaFechada])));
        expect(e?.code, sql).toBe('23514');
      }
      const ok = await comA(() => app.query("update core.motivo set descricao = 'Estoque cheio', ativo = false where id = $1", [A.motivos.estoqueAlto]));
      expect(ok.rowCount).toBe(1);
    });

    it('plataforma.uuid_de_chave (SQL) = idDeChave (TS)', async () => {
      const r = await app.query<{ id: string }>('select plataforma.uuid_de_chave($1) as id', ['qualquer:chave']);
      expect(r.rows[0]!.id).toBe(idDeChave('qualquer:chave'));
    });
  });

  describe('RN-CORE-11: um atendimento aberto por usuário', () => {
    it('segunda visita aberta do mesmo usuário é recusada (23505 visita_aberta_uk)', async () => {
      // vendedor-2 já tem a visita aberta da fixture em c2
      const e = await erroDe(comA(() => app.query(checkin('aaaaaaaa-0027-4000-8000-000000000901', A.usuarios.vendedor2, A.clientes.c2))));
      expect(e?.code).toBe('23505');
      expect(e?.message).toMatch(/visita_aberta_uk/);
    });

    it('fechando a aberta (auto, nao_finalizado) o novo check-in passa; visita removida (deleted_at) não conta', async () => {
      await comA(async () => {
        // checkout relativo ao check-in da fixture (14:00Z de hoje): now() reprovava antes das 10:00 de Manaus
        await fluxoRnCore11();
      });
    });

    it('usuários diferentes podem ter uma aberta cada', async () => {
      const r = await comA(() => app.query(checkin('aaaaaaaa-0027-4000-8000-000000000904', A.usuarios.vendedor1, A.clientes.c1)));
      expect(r.rowCount).toBe(1);
    });

    it('checkout_id é único (idempotência do push visita_checkout)', async () => {
      const e = await erroDe(
        comA(() =>
          app.query(
            "update core.visita set checkout_id = $2, checkout_em = checkin_em + interval '5 minutes', resultado = 'atendido', fechada_por = 'usuario' where id = $1",
            [A.visitas.v2c2Aberta, A.checkouts.v1c1Hoje],
          ),
        ),
      );
      expect(e?.code).toBe('23505');
    });

    it('checkout antes do check-in e fechamento incompleto são recusados (23514, cada um pela sua regra)', async () => {
      for (const [sql, regra] of [
        ["update core.visita set checkout_em = checkin_em - interval '1 minute', resultado = 'atendido', fechada_por = 'usuario' where id = $1", 'visita_checkout_depois_do_checkin'],
        ["update core.visita set checkout_em = checkin_em + interval '1 minute' where id = $1", 'visita_fechamento_completo'],
        ["update core.visita set resultado = 'atendido' where id = $1", 'visita_fechamento_completo'],
        ["update core.visita set checkout_em = checkin_em + interval '1 minute', resultado = 'outro', fechada_por = 'usuario' where id = $1", 'visita_resultado_valido'],
      ] as const) {
        const e = await erroDe(comA(() => app.query(sql, [A.visitas.v2c2Aberta])));
        expect(e?.code, sql).toBe('23514');
        expect(e?.message, sql).toMatch(regra);
      }
    });
  });

  describe('RN-CORE-11 com o relógio simulado (fuso de Manaus): nada depende da hora do dia', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    // [hora em Manaus (UTC-4), instante UTC, "hoje" esperado em Manaus]; 23:59 já é o dia seguinte em UTC
    it.each([
      ['08:00', '2026-11-03T12:00:00.000Z', '2026-11-03'],
      ['13:59', '2026-11-03T17:59:00.000Z', '2026-11-03'],
      ['14:01', '2026-11-03T18:01:00.000Z', '2026-11-03'],
      ['23:59', '2026-11-04T03:59:00.000Z', '2026-11-03'],
    ])('%s: a fixture gerada nesse relógio passa no fluxo da RN-CORE-11', async (_hora, agora, hojeManaus) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(agora));
      const gerada = dadosDoisTenants('$argon2id$v=19$m=1,t=1,p=1$c2Fs$aGFzaA');
      const hojeNoRelogio = hojeNoFuso(A.fuso);
      vi.useRealTimers();
      const aberta = gerada['core.visita'].find((v) => v.id === A.visitas.v2c2Aberta)!;
      expect(hojeNoRelogio).toBe(hojeManaus);
      expect(aberta).toMatchObject({ data_local: hojeManaus, checkout_em: null });
      await comA(async () => {
        await app.query('update core.visita set data_local = $2::date, checkin_em = $3::timestamptz where id = $1', [A.visitas.v2c2Aberta, aberta.data_local, aberta.checkin_em]);
        await fluxoRnCore11();
      });
    });

    it('MACUXI_AGORA fixa o "agora" dos testes (global-setup); inválido é erro', () => {
      const virada = agoraDosTestes({ MACUXI_AGORA: '2026-11-04T03:59:00Z' });
      expect(virada.toISOString()).toBe('2026-11-04T03:59:00.000Z');
      expect(hojeNoFuso(A.fuso, virada)).toBe('2026-11-03');
      expect(() => agoraDosTestes({ MACUXI_AGORA: 'ontem' })).toThrow(/MACUXI_AGORA/);
    });
  });

  describe('RN-CORE-10: fora do raio exige justificativa', () => {
    it.each([
      ['sem justificativa', null],
      ['justificativa em branco', '   '],
    ])('%s => 23514', async (_r, justificativa) => {
      const e = await erroDe(
        comA(() =>
          app.query(
            `insert into core.visita (tenant_id, usuario_id, cliente_id, data_local, checkin_em, fora_do_raio, distancia_m, justificativa_fora_raio)
             values ($1, $2, $3, $5::date, $6::timestamptz, true, 900, $4)`,
            [tA, A.usuarios.vendedor1, A.clientes.c1, justificativa, DATA_FIXA, INSTANTE_FIXO],
          ),
        ),
      );
      expect(e?.code).toBe('23514');
      expect(e?.message).toMatch(/visita_fora_do_raio_justificado/);
    });

    it('com justificativa passa; cliente sem coordenada fica com sugere_coordenada (índice parcial)', async () => {
      const r = await comA(async () => {
        await app.query(
          `insert into core.visita (tenant_id, usuario_id, cliente_id, data_local, checkin_em, fora_do_raio, distancia_m, justificativa_fora_raio)
           values ($1, $2, $3, $4::date, $5::timestamptz, true, 900, 'Atendido na filial')`,
          [tA, A.usuarios.vendedor1, A.clientes.c1, DATA_FIXA, INSTANTE_FIXO],
        );
        return app.query<{ id: string }>('select id from core.visita where sugere_coordenada and deleted_at is null');
      });
      expect(r.rows.map((x) => x.id)).toEqual([A.visitas.v1c3Ontem]);
    });

    it('sem GPS não grava coordenada (23514)', async () => {
      const e = await erroDe(comA(() => app.query('update core.visita set sem_gps = true where id = $1', [A.visitas.v1c1Hoje])));
      expect(e?.code).toBe('23514');
    });
  });

  describe('RN-CORE-14: cliente fechado exige motivo e foto da fachada', () => {
    const fechar = (motivo: string | null, foto: string | null) =>
      erroDe(
        comA(() =>
          app.query(
            "update core.visita set checkout_em = checkin_em + interval '2 minutes', resultado = 'cliente_fechado', fechada_por = 'usuario', motivo_id = $2, foto_fachada_id = $3 where id = $1",
            [A.visitas.v2c2Aberta, motivo, foto],
          ),
        ),
      );

    it('sem foto => 23514; sem motivo => 23514', async () => {
      expect((await fechar(A.motivos.lojaFechada, null))?.code).toBe('23514');
      expect((await fechar(null, A.arquivos.fachadaV1))?.code).toBe('23514');
    });

    it('foto inexistente => 23503 (FK para plataforma.arquivo); foto de outro tenant => 23503', async () => {
      expect((await fechar(A.motivos.lojaFechada, 'aaaaaaaa-002c-4000-8000-000000000999'))?.code).toBe('23503');
      expect((await fechar(A.motivos.lojaFechada, B.arquivos.fachadaAguardando))?.code).toBe('23503');
    });

    it('com motivo e foto registrada ("aguardando") passa; a FK é adiável para registrar o arquivo depois do update', async () => {
      await comA(async () => {
        await app.query('set constraints core.visita_foto_fachada_fk deferred');
        await app.query(
          "update core.visita set checkout_em = checkin_em + interval '2 minutes', resultado = 'cliente_fechado', fechada_por = 'usuario', motivo_id = $2, foto_fachada_id = $3 where id = $1",
          [A.visitas.v2c2Aberta, A.motivos.acessoNegado, 'aaaaaaaa-002c-4000-8000-000000000777'],
        );
        await app.query(
          `insert into plataforma.arquivo (id, tenant_id, modulo, finalidade, entidade, entidade_id, cliente_id, enviado_por)
           values ('aaaaaaaa-002c-4000-8000-000000000777', $1, 'core', 'fachada', 'visita', $2, $3, $4)`,
          [tA, A.visitas.v2c2Aberta, A.clientes.c2, A.usuarios.vendedor2],
        );
        await app.query('set constraints all immediate');
      });
    });

    it('arquivo "recebido" exige sha256, tamanho, chave e recebido_em (23514); só image/jpeg até 2 MB', async () => {
      for (const sql of [
        'update plataforma.arquivo set sha256 = null where id = $1',
        'update plataforma.arquivo set chave_armazenamento = null where id = $1',
        'update plataforma.arquivo set tamanho_bytes = 2097153 where id = $1',
        "update plataforma.arquivo set tipo = 'image/png' where id = $1",
      ]) {
        const e = await erroDe(comA(() => app.query(sql, [A.arquivos.fachadaV1])));
        expect(e?.code, sql).toBe('23514');
      }
    });
  });

  describe('rota e paradas', () => {
    it('reordenar paradas numa transação passa (sequência única adiável); sequência repetida falha no commit (23P01)', async () => {
      await comA(async () => {
        await app.query('update core.rota_parada set sequencia = 2 where id = $1', [A.paradas.v1c1]);
        await app.query('update core.rota_parada set sequencia = 1 where id = $1', [A.paradas.v1c3]);
        await app.query('set constraints all immediate');
      });
      const e = await erroDe(
        comA(async () => {
          await app.query('update core.rota_parada set sequencia = 1 where id = $1', [A.paradas.v1c3]);
          await app.query('set constraints all immediate');
        }),
      );
      expect(e?.code).toBe('23P01');
    });

    it('parada com usuario_id ou data diferentes da rota => 23503; mudar a data da rota leva as paradas junto', async () => {
      const e = await erroDe(
        comA(() =>
          app.query(
            "insert into core.rota_parada (tenant_id, rota_id, usuario_id, data, cliente_id, sequencia) select tenant_id, id, $2, data, $3, 9 from core.rota where id = $1",
            [A.rotas.vendedor1, A.usuarios.vendedor2, A.clientes.c2],
          ),
        ),
      );
      expect(e?.code).toBe('23503');
      const r = await comA(async () => {
        await app.query("update core.rota set data = data + 1 where id = $1", [A.rotas.vendedor1]);
        return app.query<{ ok: boolean }>('select bool_and(p.data = r.data) as ok from core.rota_parada p join core.rota r on r.id = p.rota_id where r.id = $1', [A.rotas.vendedor1]);
      });
      expect(r.rows[0]!.ok).toBe(true);
    });

    it('uma rota viva por usuário e dia (23505); mesmo cliente duas vezes na rota (23505)', async () => {
      const e = await erroDe(comA(() => app.query("insert into core.rota (tenant_id, usuario_id, data) select tenant_id, usuario_id, data from core.rota where id = $1", [A.rotas.vendedor1])));
      expect(e?.code).toBe('23505');
      const e2 = await erroDe(
        comA(() =>
          app.query(
            'insert into core.rota_parada (tenant_id, rota_id, usuario_id, data, cliente_id, sequencia) select tenant_id, rota_id, usuario_id, data, cliente_id, 7 from core.rota_parada where id = $1',
            [A.paradas.v1c1],
          ),
        ),
      );
      expect(e2?.code).toBe('23505');
    });
  });

  describe('notificação, meta, financeiro e títulos', () => {
    it('envio_id e origem_evento_id únicos por usuário (idempotência)', async () => {
      const e = await erroDe(
        comA(() =>
          app.query(
            "insert into core.notificacao (tenant_id, usuario_id, tipo, titulo, corpo, envio_id) select tenant_id, usuario_id, 'recado', 'x', 'y', envio_id from core.notificacao where envio_id is not null limit 1",
          ),
        ),
      );
      expect(e?.code).toBe('23505');
    });

    it('meta única por usuário, período e indicador; cobertura em pontos-base até 10000', async () => {
      const e = await erroDe(comA(() => app.query('insert into core.meta (tenant_id, usuario_id, periodo, indicador, valor) select tenant_id, usuario_id, periodo, indicador, 1 from core.meta limit 1')));
      expect(e?.code).toBe('23505');
      const e2 = await erroDe(comA(() => app.query("update core.meta set valor = 10001 where indicador = 'cobertura_pct'")));
      expect(e2?.code).toBe('23514');
    });

    it('um financeiro vivo por cliente; títulos com situação fechada e valores não negativos', async () => {
      const e = await erroDe(comA(() => app.query('insert into core.cliente_financeiro (tenant_id, cliente_id) values ($1, $2)', [tA, A.clientes.c1])));
      expect(e?.code).toBe('23505');
      for (const sql of ["update core.titulo set situacao = 'pago'", 'update core.titulo set saldo_cents = -1']) {
        expect((await erroDe(comA(() => app.query(sql))))?.code, sql).toBe('23514');
      }
    });
  });

  describe('vendedor mínimo', () => {
    it('status fora da lista do contrato => 23514; cancelar (rota do Vendedor) grava "cancelled"', async () => {
      const e = await erroDe(comA(() => app.query("update vendedor.pedido set status = 'cancelado' where id = $1", [A.pedidos.p1])));
      expect(e?.code).toBe('23514');
      const r = await comA(() => app.query("update vendedor.pedido set status = 'cancelled' where id = $1 returning status", [A.pedidos.p1]));
      expect(r.rows).toEqual([{ status: 'cancelled' }]);
    });

    it('sequência única por pedido e quantidade > 0', async () => {
      const copia = `insert into vendedor.pedido_item
        select (jsonb_populate_record(null::vendedor.pedido_item, to_jsonb(i) || jsonb_build_object('id', gen_random_uuid()))).*
          from vendedor.pedido_item i where pedido_id = $1 limit 1`;
      const e = await erroDe(comA(() => app.query(copia, [A.pedidos.p1])));
      expect(e?.code).toBe('23505');
      const e2 = await erroDe(comA(() => app.query('update vendedor.pedido_item set quantidade = 0 where pedido_id = $1', [A.pedidos.p1])));
      expect(e2?.code).toBe('23514');
    });
  });
});
