/**
 * T-0189 — Início do BKO (`GET /v1/core/inicio-bko`, `core.inicio_bko@1`) e horário esperado da carga (`GET|PUT
 * /v1/core/parametros/horario-carga`), com o `createApp` REAL × Postgres como `macuxi_app` (RLS) e a fixture dois-tenants.
 * PRECISA DE BANCO: pula sem Postgres; no CI (MACUXI_PG_EXIGIR=1) roda. Matriz: docs/testes/T-0189.md (IB-a..IB-h).
 *
 * Valor × regra (R-20261108-135639): o esperado sai da RN, calculado aqui a partir do banco (RN-CORE-66: clientes ativos do
 * escopo × lista `cliente.campos_obrigatorios`; RN-CORE-65: instante 06:00 no fuso do tenant, calculado à mão com o UTC−4 de
 * Manaus, × a última carga de cada entidade do Monitor) ou da mesma conta do Início do app (`GET /v1/core/inicio`, "Hoje"),
 * nunca do número que a rota devolve.
 * Defeitos achados ficam em `it.fails` (DEFEITO Dn, docs/testes/T-0189.md): viram `it` quando o dono corrigir. D0 a D3 do r1 corrigidos no
 * core r3 (D0 pela RN-CORE-33: o supervisor fica fora do BKO; a t2 é o escopo de carteira do gerente).
 */
import { localIsoDate } from '@macuxi/comum/fuso';
import { InicioBkoSchema, InicioSchema, type HorarioCarga, type Inicio, type InicioBko } from '@macuxi/core/contracts';
import { semBanco } from '@macuxi/db/teste/estado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cadastroCompleto, camposExigidos, ROTULO_CAMPO_CADASTRO, type CampoCadastroCliente } from '../../../modules/core/domain/cadastro';
import { aprovacoesSolicitadasHoje, cargasAtrasadas, montarAlertasInicio, pedidosDeHoje, type AlertaInicio } from '../../../modules/core/domain/inicio-bko';
import { manifest as manifestCore } from '../../../modules/core/manifest';
import { AprovacoesParaInicioSchema, MonitorParaInicioSchema } from '../../../modules/core/web/lib/inicio-bko';
import { EMITIDO_EM_SQL } from '../../../modules/vendedor/api/consulta-pedidos-da-meta';
import { STATUS_QUE_CONTAM_NA_META } from '../../../modules/vendedor/domain/pedidos-da-meta';
import { A, B, erroDe, licenca, subirApi, type ApiDeTeste, type Tenant } from '../apoio/api';

const U = A.usuarios;
const VENDEDOR = 'vendedor@exemplo.com.br'; // e-mail repetido: vendedor-1 em A e vendedor Beta em B
const URL_INICIO = '/v1/core/inicio-bko';
const URL_HORARIO = '/v1/core/parametros/horario-carga';
const PADRAO_HORARIO: HorarioCarga = { padrao: '06:00', entidades: {} };
/** Manaus não tem horário de verão: 06:00 local = 10:00Z (a conta da regra feita à mão, sem a função do domain). */
const OFFSET_MANAUS_H = 4;
const manausUtc = (dia: string, hora: number, minuto = 0) => {
  const [y, m, d] = dia.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, hora + OFFSET_MANAUS_H, minuto));
};
/** O relógio real só fixa o "hoje" de cada tenant: a fixture grava as datas relativas a ele; os instantes de RN-CORE-65 partem dele. */
// hora-fixa-ok: o "hoje" real do tenant é a base da fixture (datas relativas) e do relógio das rotas
const agoraReal = () => new Date();
const hojeDe = (t: Tenant) => localIsoDate(agoraReal(), t.fuso);

describe.skipIf(semBanco())('T-0189 — Início do BKO e horário da carga (createApp real × Postgres)', () => {
  let api: ApiDeTeste;
  /** Relógio das rotas (`ctx.agora()`); null = o real. O JWT segue o relógio real. */
  let relogio: Date | null = null;
  const tk: Record<string, string> = {};

  const chamar = (quem: string, url: string, metodo: 'GET' | 'PUT' = 'GET', payload?: unknown) =>
    api.chamar(tk[quem]!, { method: metodo, url, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });
  const inicio = async (quem: string): Promise<InicioBko> => {
    const r = await chamar(quem, URL_INICIO);
    expect(r.statusCode, `${quem}: ${r.body}`).toBe(200);
    return InicioBkoSchema.parse(r.json());
  };
  const inicioApp = async (quem: string): Promise<Inicio> => {
    const r = await chamar(quem, '/v1/core/inicio');
    expect(r.statusCode, `${quem}: ${r.body}`).toBe(200);
    return InicioSchema.parse(r.json());
  };
  /** Grava (ou apaga, com `undefined`) um parâmetro do Core pelo papel administrador do banco de teste. */
  const parametro = async (t: Tenant, chave: string, valor: unknown) => {
    if (valor === undefined) {
      await api.admin.query("delete from plataforma.parametro where tenant_id = $1 and modulo = 'core' and chave = $2", [t.tenantId, chave]);
      return;
    }
    await api.admin.query(
      `insert into plataforma.parametro (tenant_id, modulo, chave, valor) values ($1, 'core', $2, $3::jsonb)
         on conflict (tenant_id, modulo, chave) where deleted_at is null do update set valor = excluded.valor`,
      [t.tenantId, chave, JSON.stringify(valor)],
    );
  };
  const lerParametro = async (t: Tenant, chave: string): Promise<unknown> =>
    (await api.admin.query<{ valor: unknown }>("select valor from plataforma.parametro where tenant_id = $1 and modulo = 'core' and chave = $2 and deleted_at is null", [t.tenantId, chave])).rows[0]?.valor;
  /** Liga/desliga a Integração no tenant e no perfil admin (e analista, quando pedido) pela rota real de licenças. */
  const integracao = async (t: Tenant, ativo: boolean, perfis: readonly string[] = ['admin']) => {
    const token = t === A ? tk.admin! : tk.adminB!;
    if (ativo) {
      const r = await licenca(api, token, 'tenant', 'integracao', true);
      expect(r.statusCode, r.body).toBe(200);
      for (const p of perfis) expect((await licenca(api, token, 'perfil', 'integracao', true, p)).statusCode).toBe(200);
    } else {
      for (const p of perfis) expect((await licenca(api, token, 'perfil', 'integracao', false, p)).statusCode).toBe(200);
      expect((await licenca(api, token, 'tenant', 'integracao', false)).statusCode).toBe(200);
    }
  };
  const auditoriasHorario = async (t: Tenant): Promise<number> =>
    (await api.admin.query<{ n: number }>("select count(*)::int as n from plataforma.auditoria where tenant_id = $1 and acao = 'parametro.inicio' and depois ? 'horario_carga'", [t.tenantId])).rows[0]!.n;

  /** RN-CORE-66 pela regra: clientes ATIVOS e vivos `ids` (null = tenant) × lista efetiva da RN-CORE-16; o campo que mais falta (empate: ordem canônica). */
  const cadastroEsperado = async (t: Tenant, ids: readonly string[] | null) => {
    const lista = await lerParametro(t, 'cliente.campos_obrigatorios');
    const exigidos = camposExigidos(lista).filter((c) => c !== 'complemento');
    const { rows } = await api.admin.query(
      `select razao_social, nome_fantasia, documento, inscricao_estadual, telefone, email, logradouro, numero, bairro, cidade, uf, cep,
              latitude::float8 as latitude, longitude::float8 as longitude
         from core.cliente where tenant_id = $1 and deleted_at is null and ativo and ($2::uuid[] is null or id = any($2::uuid[]))`,
      [t.tenantId, ids],
    );
    const falta = new Map<CampoCadastroCliente, number>();
    let quantidade = 0;
    for (const c of rows) {
      const r = cadastroCompleto(c, exigidos);
      if (r.completo) continue;
      quantidade += 1;
      for (const f of r.campos_faltantes) falta.set(f, (falta.get(f) ?? 0) + 1);
    }
    const maior = Math.max(0, ...falta.values());
    const ordem: readonly CampoCadastroCliente[] = ['razao_social', 'documento', 'inscricao_estadual', 'logradouro', 'numero', 'bairro', 'cidade', 'uf', 'cep', 'nome_fantasia', 'telefone', 'email', 'complemento', 'geolocalizacao'];
    const codigo = ordem.find((c) => (falta.get(c) ?? 0) === maior && maior > 0) ?? null;
    return { quantidade, campo: codigo ? ROTULO_CAMPO_CADASTRO[codigo] : null };
  };
  /** Clientes da carteira de um conjunto de usuários (o escopo de quem vê as equipes deles). */
  const carteiraDe = async (usuarios: readonly string[]) =>
    (await api.admin.query<{ cliente_id: string }>('select distinct cliente_id from core.carteira where deleted_at is null and usuario_id = any($1::uuid[])', [usuarios])).rows.map((r) => r.cliente_id);

  beforeAll(async () => {
    api = await subirApi({ relogio: () => relogio ?? agoraReal() });
    const entrar = async (chave: string, email: string, t: Tenant = A) => {
      tk[chave] = (await api.sessao(email, t)).access_token;
    };
    await entrar('vendedor1', VENDEDOR);
    await entrar('promotor', 'promotor@exemplo.com.br');
    await entrar('supervisor', 'supervisor@exemplo.com.br');
    await entrar('gerente', 'gerente@exemplo.com.br');
    await entrar('analista', 'analista@exemplo.com.br');
    await entrar('assistente', 'assistente@exemplo.com.br');
    await entrar('admin', 'admin@exemplo.com.br');
    await entrar('adminB', 'admin.b@exemplo.com.br', B);
    await entrar('vendedorB', VENDEDOR, B);
  });
  afterAll(async () => {
    await api?.fechar();
  });

  // ---------------- (a) perfil ----------------
  describe('IB-a — perfil (ação inicio_bko.ver, rota com superficie bko)', () => {
    it('IB-a1 vendedor e promotor (A) e vendedor Beta (B): 403 já no portão do BKO (PERFIL_SEM_BKO, RN-CORE-33), sem corpo de dados; sem token: 401', async () => {
      for (const quem of ['vendedor1', 'promotor', 'vendedorB']) {
        const r = await chamar(quem, URL_INICIO);
        expect(r.statusCode, quem).toBe(403);
        expect(erroDe(r).codigo, quem).toBe('PERFIL_SEM_BKO');
        expect(r.body).not.toContain('cadastro_incompleto');
      }
      expect((await api.chamar(null, { method: 'GET', url: URL_INICIO })).statusCode).toBe(401);
    });

    it('IB-a2 gerente, analista, assistente e admin (A) e admin (B): 200 no contrato estrito core.inicio_bko@1, saudação com o primeiro nome', async () => {
      const nomes: Record<string, string> = { gerente: 'Gerente', analista: 'Analista', assistente: 'Assistente', admin: 'Admin', adminB: 'Admin' };
      for (const quem of Object.keys(nomes)) {
        const r = await inicio(quem);
        expect(r.saudacao, quem).toMatch(new RegExp(`^(Bom dia|Boa tarde|Boa noite), ${nomes[quem]}\\.$`));
      }
    });

    it('IB-a3 D0 corrigido (RN-CORE-33 sobre a RN-CORE-64): supervisor fora do BKO — a ação inicio_bko.ver não o lista e a rota recusa com 403 PERFIL_SEM_BKO', async () => {
      expect(manifestCore.acoes?.['inicio_bko.ver']?.perfis).toEqual(['gerente', 'analista', 'assistente', 'admin']);
      const r = await chamar('supervisor', URL_INICIO);
      expect(r.statusCode, r.body).toBe(403);
      expect(erroDe(r).codigo).toBe('PERFIL_SEM_BKO');
      expect(r.body).not.toContain('cadastro_incompleto');
    });
  });

  // ---------------- (b) escopo t2 ----------------
  // O supervisor não entra no BKO (RN-CORE-33, D0 decidido); o perfil do BKO recortado pela carteira é o gerente (equipes abaixo). Para a t2,
  // a Equipe 2 (vendedor-2, cliente c2) sai de baixo da Regional Alfa: o gerente passa a ver só a Equipe 1 (vendedor-1, promotor,
  // supervisor; clientes c1 e c3) e o admin segue com o tenant.
  describe('IB-b — escopo da carteira (t2, RN-CORE-04)', () => {
    const EQUIPE1 = [U.vendedor1, U.promotor, U.supervisor, U.gerente];
    beforeAll(async () => {
      await api.admin.query('update core.equipe set equipe_pai_id = null where id = $1', [A.equipes.equipe2]);
    });
    afterAll(async () => {
      await api.admin.query('update core.equipe set equipe_pai_id = $2 where id = $1', [A.equipes.equipe2, A.equipes.regional]);
    });

    it('IB-b1 gerente (t2): cadastro incompleto só dos clientes da carteira do escopo (c1 e c3), valor × RN-CORE-66; admin = tenant (c1, c2, c3)', async () => {
      const daCarteira = await carteiraDe(EQUIPE1);
      expect(daCarteira.sort()).toEqual([A.clientes.c1, A.clientes.c3].sort());
      const ger = await inicio('gerente');
      expect(ger.cadastro_incompleto).toEqual(await cadastroEsperado(A, daCarteira));
      expect(ger.cadastro_incompleto.quantidade).toBe(2);
      const adm = await inicio('admin');
      expect(adm.cadastro_incompleto).toEqual(await cadastroEsperado(A, null));
      expect(adm.cadastro_incompleto.quantidade).toBe(3);
    });

    it('IB-b2 visitas de hoje: gerente (t2) só o escopo (3 paradas, 2 feitas, 1 ainda na rota); admin o tenant (4, 3, 1); nada do tenant B', async () => {
      expect((await inicio('gerente')).hoje.visitas).toEqual({ feitas: 2, planejadas: 3, na_rota: 1 });
      expect((await inicio('admin')).hoje.visitas).toEqual({ feitas: 3, planejadas: 4, na_rota: 1 });
    });

    it('IB-b3 senha temporária vencida: gerente conta só o escopo, admin o tenant, analista (sem usuario.ver) = null; temporária ainda válida não conta', async () => {
      const marcar = (id: string, trocar: boolean, expira: string) =>
        api.admin.query('update core.usuario set trocar_senha = $2, senha_expira_em = $3::timestamptz where id = $1', [id, trocar, expira]);
      const passado = new Date(agoraReal().getTime() - 3_600_000).toISOString();
      const futuro = new Date(agoraReal().getTime() + 86_400_000).toISOString();
      const marcados = [U.vendedor1, U.vendedor2, U.analista, U.supervisor, B.usuarios.vendedor];
      try {
        await marcar(U.vendedor1, true, passado); // no escopo do gerente
        await marcar(U.vendedor2, true, passado); // fora do escopo do gerente (Equipe 2 solta)
        await marcar(U.analista, true, passado); // fora do escopo do gerente
        await marcar(U.supervisor, true, futuro); // temporária ainda válida: não conta
        await marcar(B.usuarios.vendedor, true, passado); // outro tenant
        expect((await inicio('gerente')).usuarios_senha_vencida).toBe(1);
        expect((await inicio('admin')).usuarios_senha_vencida).toBe(3);
        expect((await inicio('adminB')).usuarios_senha_vencida).toBe(1);
        expect((await inicio('analista')).usuarios_senha_vencida).toBeNull();
      } finally {
        await api.admin.query('update core.usuario set trocar_senha = false, senha_expira_em = null where id = any($1::uuid[])', [marcados]);
      }
    });

    it('IB-b4 "Hoje" do gerente (t2) × a mesma conta do Início do app (valor × regra): Vendas = Σ venda de hoje do escopo, % = venda ÷ meta do dia; Positivação = positivados ÷ clientes ativos da carteira', async () => {
      const bko = await inicio('gerente');
      const app = await inicioApp('gerente');
      expect(app.usuarios.map((u) => u.usuario_id).sort()).toEqual([U.vendedor1, U.promotor].sort());
      const comVenda = app.usuarios.filter((u) => u.venda_cents);
      expect(comVenda.length).toBeGreaterThan(0);
      const cents = comVenda.reduce((s, u) => s + u.venda_cents!.hoje, 0);
      const metaDia = app.metas_do_dia.find((m) => m.indicador === 'venda_cents')?.meta_dia ?? null;
      expect(bko.hoje.vendas).toEqual({ cents, pct: metaDia && metaDia > 0 ? Math.round((cents / metaDia) * 100) : null });
      const clientes = (await carteiraDe(EQUIPE1)).length;
      const positivados = app.usuarios.reduce((s, u) => s + (u.positivacao ? u.positivacao.ate_ontem + u.positivacao.hoje : 0), 0);
      const metaPos = app.metas_do_dia.find((m) => m.indicador === 'positivacao');
      expect(bko.hoje.positivacao).toEqual({ pct: Math.round((positivados / clientes) * 100), meta_pct: metaPos ? Math.round((metaPos.meta_mes / clientes) * 100) : null });
    });

    it('IB-b5 Pedidos de hoje do gerente (t2) = pedidos do escopo que contam na meta, emitidos hoje no fuso do tenant (contado no banco pela regra); analista (tenant) ≥ gerente', async () => {
      const app = await inicioApp('gerente');
      const ids = app.usuarios.map((u) => u.usuario_id);
      const hoje = hojeDe(A);
      const { rows } = await api.admin.query<{ n: number }>(
        `select count(*)::int as n from vendedor.pedido p
          where p.tenant_id = $1 and p.deleted_at is null and p.tipo = 'pedido' and p.vendedor_id = any($2::uuid[]) and p.status = any($3::text[])
            and (${EMITIDO_EM_SQL} at time zone $4)::date = $5::date`,
        [A.tenantId, ids, [...STATUS_QUE_CONTAM_NA_META], A.fuso, hoje],
      );
      const ger = await inicio('gerente');
      expect(ger.hoje.pedidos).toBe(rows[0]!.n);
      expect((await inicio('analista')).hoje.pedidos!).toBeGreaterThanOrEqual(ger.hoje.pedidos!);
    });

    it('IB-b6 cartão Pedidos (como a tela monta): total = aprovados de hoje (API) + os de hoje em aprovação (fila do Gestor); "N em aprovação" é subconjunto e nenhum pedido conta duas vezes (status no banco)', async () => {
      const ger = await inicio('gerente');
      // a fixture não licencia o Gestor: liga no tenant e no perfil gerente só para ler a fila como a tela lê
      expect((await licenca(api, tk.admin!, 'tenant', 'gestor', true)).statusCode).toBe(200);
      expect((await licenca(api, tk.admin!, 'perfil', 'gestor', true, 'gerente')).statusCode).toBe(200);
      let ra: Awaited<ReturnType<typeof chamar>>;
      try {
        ra = await chamar('gerente', '/v1/gestor/aprovacoes');
      } finally {
        await licenca(api, tk.admin!, 'perfil', 'gestor', false, 'gerente');
        await licenca(api, tk.admin!, 'tenant', 'gestor', false);
      }
      expect(ra.statusCode, ra.body).toBe(200);
      const fila = AprovacoesParaInicioSchema.parse(ra.json());
      const agora = new Date(ger.agora);
      const emAprovacao = aprovacoesSolicitadasHoje(fila.itens, agora, ger.fuso);
      // a regra feita à mão: pedidos distintos da fila solicitados hoje no fuso do tenant
      const hoje = hojeDe(A);
      const daFilaHoje = [...new Set(fila.itens.filter((i) => localIsoDate(new Date(i.solicitada_em), A.fuso) === hoje).map((i) => i.pedido_id))];
      expect(emAprovacao).toBe(daFilaHoje.length);
      const cartao = pedidosDeHoje(ger.hoje.pedidos!, emAprovacao);
      expect(cartao).toEqual({ total: ger.hoje.pedidos! + daFilaHoje.length, em_aprovacao: daFilaHoje.length });
      expect(cartao.em_aprovacao).toBeLessThanOrEqual(cartao.total);
      if (daFilaHoje.length > 0) {
        const { rows } = await api.admin.query<{ status: string }>('select status from vendedor.pedido where id = any($1::uuid[])', [daFilaHoje]);
        for (const r of rows) expect(STATUS_QUE_CONTAM_NA_META as readonly string[]).not.toContain(r.status);
      }
    });
  });


  // ---------------- (c) multi-tenant ----------------
  describe('IB-c — multi-tenant (RLS)', () => {
    it('IB-c1 admin Beta: só o cliente e a visita do tenant B, no fuso de São Paulo; nada de A', async () => {
      const r = await inicio('adminB');
      expect(r.fuso).toBe(B.fuso);
      expect(r.cadastro_incompleto).toEqual(await cadastroEsperado(B, null));
      expect(r.cadastro_incompleto.quantidade).toBe(1);
      expect(r.hoje.visitas).toEqual({ feitas: 1, planejadas: 1, na_rota: 0 });
    });

    it('IB-c2 o horário da carga gravado em A não aparece em B (GET e Início), e vice-versa', async () => {
      try {
        await integracao(B, true);
        const r = await chamar('admin', URL_HORARIO, 'PUT', { padrao: '07:15', entidades: { cliente: '05:00' } });
        expect(r.statusCode, r.body).toBe(200);
        const b = await chamar('adminB', URL_HORARIO);
        expect(b.json()).toEqual(PADRAO_HORARIO);
        expect((await inicio('adminB')).carga?.horario).toEqual(PADRAO_HORARIO);
      } finally {
        await chamar('admin', URL_HORARIO, 'PUT', PADRAO_HORARIO);
        await integracao(B, false);
      }
    });
  });

  // ---------------- (d) licença ----------------
  describe('IB-d — licença dos módulos', () => {
    it('IB-d1 tenant sem Integração (fixture): carga = null para todos; ligada só no perfil admin: o admin recebe, o analista (perfil sem Integração) não, o tenant B não', async () => {
      for (const quem of ['admin', 'analista', 'gerente', 'adminB']) expect((await inicio(quem)).carga, quem).toBeNull();
      try {
        await integracao(A, true);
        expect((await inicio('admin')).carga).toMatchObject({ horario: PADRAO_HORARIO });
        expect((await inicio('analista')).carga).toBeNull();
        expect((await inicio('adminB')).carga).toBeNull();
      } finally {
        await integracao(A, false);
      }
      expect((await inicio('admin')).carga).toBeNull();
    });

    it('IB-d2 sem Vendedor: o admin (perfil só com Core) e o gerente com o Vendedor desligado no tenant não recebem Vendas, Pedidos nem Positivação; Visitas ficam', async () => {
      const adm = await inicio('admin');
      expect(adm.hoje).toMatchObject({ vendas: null, pedidos: null, positivacao: null });
      expect((await inicio('gerente')).hoje.pedidos).not.toBeNull();
      expect((await licenca(api, tk.admin!, 'tenant', 'vendedor', false)).statusCode).toBe(200);
      try {
        const ger = await inicio('gerente');
        expect(ger.hoje).toMatchObject({ vendas: null, pedidos: null, positivacao: null });
        expect(ger.hoje.visitas.planejadas).toBe(4);
      } finally {
        expect((await licenca(api, tk.admin!, 'tenant', 'vendedor', true)).statusCode).toBe(200);
      }
      expect((await inicio('gerente')).hoje.pedidos).not.toBeNull();
    });
  });

  // ---------------- (e) RN-CORE-65 ----------------
  describe('IB-e — RN-CORE-65 carga que não ocorreu (valor × regra)', () => {
    let diasUteisAntes: unknown;
    let feriadosAntes: unknown;
    beforeAll(async () => {
      diasUteisAntes = await lerParametro(A, 'metas.dias_uteis_semana');
      feriadosAntes = await lerParametro(A, 'metas.feriados');
      await integracao(A, true);
      await integracao(B, true);
    });
    afterAll(async () => {
      relogio = null;
      await parametro(A, 'metas.dias_uteis_semana', diasUteisAntes);
      await parametro(A, 'metas.feriados', feriadosAntes);
      await chamar('admin', URL_HORARIO, 'PUT', PADRAO_HORARIO);
      await integracao(A, false);
      await integracao(B, false);
    });

    /** Alertas de carga como a tela monta: Monitor real (`ultima_carga_por_entidade`) × configuração do Início × domain. */
    const alertasDeCarga = async (): Promise<{ alertas: AlertaInicio[]; ultimas: { entidade: string; recebido_em: string }[]; d: InicioBko }> => {
      const d = await inicio('admin');
      const rm = await chamar('admin', '/v1/integracao/monitor');
      expect(rm.statusCode, rm.body).toBe(200);
      const ultimas = MonitorParaInicioSchema.parse(rm.json()).ultima_carga_por_entidade;
      const agora = new Date(d.agora);
      const atrasadas = d.carga ? cargasAtrasadas({ agora, fuso: d.fuso, dia_util: d.carga.dia_util, horario: d.carga.horario, ultimas }) : [];
      const alertas = montarAlertasInicio({ agora, fuso: d.fuso, licencas: { integracao: d.carga !== null, gestor: false, vendedor: false }, cargas_atrasadas: atrasadas }).filter((a) => a.id.startsWith('carga_atrasada:'));
      return { alertas, ultimas, d };
    };
    /** A regra feita à mão: dia útil, horário da entidade (override, null = sem horário, ausente = padrão) e agora ≥ HH:MM de hoje > última carga. */
    const esperadas = (agora: Date, diaUtil: boolean, hoje: string, horario: HorarioCarga, ultimas: readonly { entidade: string; recebido_em: string }[]) =>
      diaUtil
        ? ultimas
            .filter((u) => {
              const proprios: Record<string, string | null | undefined> = horario.entidades;
              const h = u.entidade in proprios ? proprios[u.entidade] : horario.padrao;
              if (!h) return false;
              const [hh, mm] = h.split(':').map(Number) as [number, number];
              const limite = manausUtc(hoje, hh, mm);
              return agora.getTime() >= limite.getTime() && new Date(u.recebido_em).getTime() < limite.getTime();
            })
            .map((u) => `carga_atrasada:${u.entidade}`)
            .sort()
        : [];

    it('IB-e1 dia útil pelo calendário do tenant: segunda (Manaus) = útil; domingo = não útil; sábado útil no padrão (seg–sáb) e não útil com dias_uteis_semana = seg–sex', async () => {
      relogio = new Date('2026-11-23T10:00:00Z');
      expect((await inicio('admin')).carga).toEqual({ dia_util: true, horario: PADRAO_HORARIO });
      relogio = new Date('2026-11-22T14:00:00Z');
      expect((await inicio('admin')).carga?.dia_util).toBe(false);
      relogio = new Date('2026-11-21T14:00:00Z');
      await parametro(A, 'metas.dias_uteis_semana', undefined);
      expect((await inicio('admin')).carga?.dia_util).toBe(true);
      await parametro(A, 'metas.dias_uteis_semana', [1, 2, 3, 4, 5]);
      expect((await inicio('admin')).carga?.dia_util).toBe(false);
      await parametro(A, 'metas.dias_uteis_semana', diasUteisAntes);
    });

    it('IB-e2 virada de dia e fuso do tenant: 2026-11-23T03:30Z é domingo 23:30 em Manaus (A: não útil, dia 22) e segunda 00:30 em São Paulo (B: útil, dia 23)', async () => {
      relogio = new Date('2026-11-23T03:30:00Z');
      const a = await inicio('admin');
      expect(a.data_extenso).toBe('Domingo, 22 de novembro');
      expect(a.carga?.dia_util).toBe(false);
      const b = await inicio('adminB');
      expect(b.carga?.dia_util).toBe(true);
      expect(b.data_extenso).toBe('Segunda, 23 de novembro');
    });

    it('IB-e3 às 06:00 de dia útil a entidade com carga anterior gera alerta (Monitor real × regra); às 05:59, nenhum', async () => {
      const hoje = hojeDe(A);
      await parametro(A, 'metas.dias_uteis_semana', [0, 1, 2, 3, 4, 5, 6]);
      relogio = manausUtc(hoje, 6, 0);
      const r = await alertasDeCarga();
      expect(r.ultimas.length).toBeGreaterThan(0);
      const esperado = esperadas(relogio, true, hoje, PADRAO_HORARIO, r.ultimas);
      expect(esperado.length).toBeGreaterThan(0); // a fixture tem cargas de dias anteriores (cliente e produto)
      expect(r.alertas.map((a) => a.id).sort()).toEqual(esperado);
      relogio = manausUtc(hoje, 5, 59);
      expect((await alertasDeCarga()).alertas).toEqual([]);
    });

    it('IB-e4 o texto cita a entidade e a data e hora da última carga no fuso do tenant (Manaus, UTC−4) e leva ao Monitor', async () => {
      const hoje = hojeDe(A);
      await parametro(A, 'metas.dias_uteis_semana', [0, 1, 2, 3, 4, 5, 6]);
      relogio = manausUtc(hoje, 7, 0);
      const r = await alertasDeCarga();
      const cliente = r.ultimas.find((u) => u.entidade === 'cliente')!;
      const local = new Date(new Date(cliente.recebido_em).getTime() - OFFSET_MANAUS_H * 3_600_000);
      const dois = (n: number) => String(n).padStart(2, '0');
      const quando = `${dois(local.getUTCDate())}/${dois(local.getUTCMonth() + 1)} às ${dois(local.getUTCHours())}:${dois(local.getUTCMinutes())}`;
      const a = r.alertas.find((x) => x.id === 'carga_atrasada:cliente')!;
      expect(a.partes.map((p) => p.texto).join('')).toBe(`Carga de Clientes não chegou hoje — a última foi em ${quando}`);
      expect(a.partes.find((p) => p.negrito)?.texto).toBe('Clientes');
      expect(a.acao).toEqual({ rotulo: 'Integração ERP', caminho: '/integracao' });
    });

    it('IB-e5 dia não útil do tenant: nenhum alerta de carga, mesmo depois do horário', async () => {
      const hoje = hojeDe(A);
      const dow = new Date(`${hoje}T12:00:00Z`).getUTCDay();
      await parametro(A, 'metas.dias_uteis_semana', [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== dow));
      relogio = manausUtc(hoje, 11, 0);
      const r = await alertasDeCarga();
      expect(r.d.carga?.dia_util).toBe(false);
      expect(r.alertas).toEqual([]);
    });

    it('IB-e6 override por entidade (PUT real): produto "sem horário" (null) nunca alerta; cliente às 08:00 só alerta a partir das 08:00', async () => {
      const hoje = hojeDe(A);
      await parametro(A, 'metas.dias_uteis_semana', [0, 1, 2, 3, 4, 5, 6]);
      const cfg: HorarioCarga = { padrao: '06:00', entidades: { cliente: '08:00', produto: null } };
      expect((await chamar('admin', URL_HORARIO, 'PUT', cfg)).statusCode).toBe(200);
      relogio = manausUtc(hoje, 7, 59);
      let r = await alertasDeCarga();
      expect(r.d.carga?.horario).toEqual(cfg);
      expect(r.alertas.map((a) => a.id)).toEqual(esperadas(relogio, true, hoje, cfg, r.ultimas));
      expect(r.alertas.map((a) => a.id)).not.toContain('carga_atrasada:cliente');
      expect(r.alertas.map((a) => a.id)).not.toContain('carga_atrasada:produto');
      relogio = manausUtc(hoje, 8, 0);
      r = await alertasDeCarga();
      expect(r.alertas.map((a) => a.id)).toContain('carga_atrasada:cliente');
      expect(r.alertas.map((a) => a.id)).not.toContain('carga_atrasada:produto');
      expect(r.alertas.map((a) => a.id).sort()).toEqual(esperadas(relogio, true, hoje, cfg, r.ultimas));
      await chamar('admin', URL_HORARIO, 'PUT', PADRAO_HORARIO);
    });

    it('IB-e7 D1 corrigido: RN-CORE-65 diz "alerta de ATENÇÃO" — a carga atrasada é amarela (atencao), nunca falha', async () => {
      const hoje = hojeDe(A);
      await parametro(A, 'metas.dias_uteis_semana', [0, 1, 2, 3, 4, 5, 6]);
      relogio = manausUtc(hoje, 7, 0);
      const r = await alertasDeCarga();
      expect(r.alertas.length).toBeGreaterThan(0);
      for (const a of r.alertas) expect(a.gravidade).toBe('atencao');
    });

    it('IB-e8 D2 corrigido: feriado do tenant (metas.feriados) não é dia útil — segunda 23/11 feriado = dia_util false e nenhum alerta; a terça segue útil', async () => {
      relogio = new Date('2026-11-23T12:00:00Z'); // segunda 08:00 em Manaus, depois do padrão 06:00
      await parametro(A, 'metas.dias_uteis_semana', diasUteisAntes);
      await parametro(A, 'metas.feriados', ['2026-11-23']);
      try {
        const r = await alertasDeCarga();
        expect(r.d.carga?.dia_util).toBe(false);
        expect(r.alertas).toEqual([]);
        relogio = new Date('2026-11-24T12:00:00Z');
        expect((await inicio('admin')).carga?.dia_util).toBe(true);
      } finally {
        await parametro(A, 'metas.feriados', feriadosAntes);
      }
    });

    it('IB-e9 D3 corrigido: a última carga vem do resumo do Monitor (ultima_carga_por_entidade), sem a janela de 100 lotes; com 120 lotes de Estoque hoje, Cliente e Produto (atrasadas) seguem no alerta', async () => {
      const hoje = hojeDe(A);
      await parametro(A, 'metas.dias_uteis_semana', [0, 1, 2, 3, 4, 5, 6]);
      relogio = manausUtc(hoje, 7, 0);
      const antes = await alertasDeCarga();
      const atrasadas = antes.alertas.map((a) => a.id).sort();
      expect(atrasadas).toEqual(expect.arrayContaining(['carga_atrasada:cliente', 'carga_atrasada:produto']));
      const molde = (await api.admin.query<{ id: string }>("select id from integracao.lote where tenant_id = $1 and modo = 'delta' and deleted_at is null limit 1", [A.tenantId])).rows[0]!.id;
      const { rows: novos } = await api.admin.query<{ id: string }>(
        `insert into integracao.lote
         select (jsonb_populate_record(null::integracao.lote, to_jsonb(l) || jsonb_build_object(
                  'id', gen_random_uuid(), 'entidade', 'estoque', 'status', 'concluido',
                  'chave_idempotencia', encode(sha256(('flood-t0189-' || g)::bytea), 'hex'),
                  'hash_conteudo', encode(sha256(('flood-conteudo-t0189-' || g)::bytea), 'hex'),
                  'recebido_em', $2::timestamptz + make_interval(secs => g)))).*
           from integracao.lote l, generate_series(1, 120) g where l.id = $1
         returning id`,
        [molde, manausUtc(hoje, 6, 30).toISOString()],
      );
      try {
        const depois = await alertasDeCarga();
        const rm = MonitorParaInicioSchema.parse((await chamar('admin', '/v1/integracao/monitor')).json());
        expect(rm.lotes_recentes.every((l) => l.entidade === 'estoque')).toBe(true); // a janela dos lotes recentes só tem Estoque
        expect(depois.ultimas.find((u) => u.entidade === 'estoque')?.recebido_em).toBe(new Date(manausUtc(hoje, 6, 30).getTime() + 120_000).toISOString());
        // Estoque chegou às 06:30 (depois do horário): sai do alerta; as outras seguem, com a mesma última carga de antes
        expect(depois.alertas.map((a) => a.id).sort()).toEqual(atrasadas.filter((id) => id !== 'carga_atrasada:estoque'));
        for (const e of ['cliente', 'produto']) expect(depois.ultimas.find((u) => u.entidade === e)).toEqual(antes.ultimas.find((u) => u.entidade === e));
      } finally {
        await api.admin.query('delete from integracao.lote where id = any($1::uuid[])', [novos.map((n) => n.id)]);
      }
    });
  });

  // ---------------- (f) RN-CORE-66 ----------------
  describe('IB-f — RN-CORE-66 cadastro incompleto × lista cliente.campos_obrigatorios (valor × regra)', () => {
    let listaAntes: unknown;
    beforeAll(async () => {
      listaAntes = await lerParametro(A, 'cliente.campos_obrigatorios');
    });
    afterAll(async () => {
      await parametro(A, 'cliente.campos_obrigatorios', listaAntes);
    });
    const conferir = async (quem: 'admin' | 'gerente', ids: readonly string[] | null) => {
      const r = (await inicio(quem)).cadastro_incompleto;
      expect(r, quem).toEqual(await cadastroEsperado(A, ids));
      return r;
    };

    it('IB-f1 lista padrão (RN-CORE-16): os três clientes de A sem IE, endereço e CEP; o campo que mais falta é o 1º da ordem canônica no empate (inscrição estadual)', async () => {
      await parametro(A, 'cliente.campos_obrigatorios', undefined);
      const r = await conferir('admin', null);
      expect(r).toEqual({ quantidade: 3, campo: 'inscrição estadual' });
    });

    it('IB-f2 lista só com geolocalização: conta só o c3 (sem coordenada), no admin e no gerente (c3 é da carteira das equipes dele)', async () => {
      await parametro(A, 'cliente.campos_obrigatorios', ['razao_social', 'documento', 'geolocalizacao']);
      const esperado = { quantidade: 1, campo: 'geolocalização' };
      expect(await conferir('admin', null)).toEqual(esperado);
      expect(await conferir('gerente', await carteiraDe([U.vendedor1, U.vendedor2, U.promotor, U.supervisor, U.gerente]))).toEqual(esperado);
    });

    it('IB-f3 lista com telefone (campo extra): todos sem telefone; mudar a lista muda a conta sem código (lida a cada requisição)', async () => {
      await parametro(A, 'cliente.campos_obrigatorios', ['razao_social', 'documento', 'telefone']);
      expect(await conferir('admin', null)).toEqual({ quantidade: 3, campo: 'telefone' });
      await api.admin.query("update core.cliente set telefone = '92999990000' where id = $1", [A.clientes.c1]);
      try {
        expect((await conferir('admin', null)).quantidade).toBe(2);
      } finally {
        await api.admin.query('update core.cliente set telefone = null where id = $1', [A.clientes.c1]);
      }
    });

    it('IB-f4 cliente inativo ou apagado não conta (só clientes ativos do escopo)', async () => {
      await parametro(A, 'cliente.campos_obrigatorios', ['razao_social', 'documento', 'telefone']);
      try {
        await api.admin.query('update core.cliente set ativo = false where id = $1', [A.clientes.c2]);
        await api.admin.query('update core.cliente set deleted_at = $2::timestamptz where id = $1', [A.clientes.c3, agoraReal().toISOString()]);
        expect(await conferir('admin', null)).toEqual({ quantidade: 1, campo: 'telefone' });
      } finally {
        await api.admin.query('update core.cliente set ativo = true, deleted_at = null where id = any($1::uuid[])', [[A.clientes.c2, A.clientes.c3]]);
      }
    });

    it('IB-f5 a lista de A não muda a conta de B (parâmetro por tenant)', async () => {
      await parametro(A, 'cliente.campos_obrigatorios', ['razao_social', 'documento', 'geolocalizacao']);
      const b = (await inicio('adminB')).cadastro_incompleto;
      expect(b).toEqual(await cadastroEsperado(B, null));
      expect(b.campo).not.toBe('geolocalização');
    });
  });

  // ---------------- (g) t3 ----------------
  describe('IB-g — t3: sem pendências', () => {
    it('IB-g1 sem senha vencida, cadastro completo pela lista e sem Integração: a resposta não gera nenhum alerta ("Nada pendente.")', async () => {
      const antes = await lerParametro(A, 'cliente.campos_obrigatorios');
      await parametro(A, 'cliente.campos_obrigatorios', ['razao_social', 'documento']);
      try {
        const d = await inicio('admin');
        expect(d.usuarios_senha_vencida).toBe(0);
        expect(d.cadastro_incompleto).toEqual({ quantidade: 0, campo: null });
        expect(d.carga).toBeNull();
        const alertas = montarAlertasInicio({
          agora: new Date(d.agora),
          fuso: d.fuso,
          licencas: { integracao: false, gestor: false, vendedor: false },
          usuarios_senha_vencida: d.usuarios_senha_vencida,
          cadastro_incompleto: d.cadastro_incompleto,
        });
        expect(alertas).toEqual([]);
      } finally {
        await parametro(A, 'cliente.campos_obrigatorios', antes);
      }
    });

    it('IB-g2 com Integração e antes do horário esperado: nenhuma carga atrasada vira alerta', async () => {
      const hoje = hojeDe(A);
      await integracao(A, true);
      try {
        relogio = manausUtc(hoje, 5, 0);
        const d = await inicio('admin');
        expect(d.carga).not.toBeNull();
        const rm = await chamar('admin', '/v1/integracao/monitor');
        const ultimas = MonitorParaInicioSchema.parse(rm.json()).ultima_carga_por_entidade;
        expect(cargasAtrasadas({ agora: new Date(d.agora), fuso: d.fuso, dia_util: d.carga!.dia_util, horario: d.carga!.horario, ultimas })).toEqual([]);
      } finally {
        relogio = null;
        await integracao(A, false);
      }
    });
  });

  // ---------------- (h) PUT do parâmetro ----------------
  describe('IB-h — PUT /v1/core/parametros/horario-carga', () => {
    afterAll(async () => {
      await chamar('admin', URL_HORARIO, 'PUT', PADRAO_HORARIO);
    });

    it('IB-h1 HH:MM inválido (6:00, 24:00, 06:60, "5h" na entidade) e entidade fora do formato: 422 RN-CORE-65; nada gravado nem auditado', async () => {
      const antes = await auditoriasHorario(A);
      const invalidos = [
        { padrao: '6:00', entidades: {} },
        { padrao: '24:00', entidades: {} },
        { padrao: '06:60', entidades: {} },
        { padrao: '06:00', entidades: { cliente: '5h' } },
        { padrao: '06:00', entidades: { Cliente: '05:00' } },
      ];
      for (const corpo of invalidos) {
        const r = await chamar('admin', URL_HORARIO, 'PUT', corpo);
        expect(r.statusCode, JSON.stringify(corpo)).toBe(422);
        expect(erroDe(r).codigo).toBe('RN-CORE-65');
      }
      const extra = await chamar('admin', URL_HORARIO, 'PUT', { padrao: '06:00', entidades: {}, outro: 1 });
      expect(extra.statusCode).toBe(400);
      expect((await chamar('admin', URL_HORARIO)).json()).toEqual(PADRAO_HORARIO);
      expect(await auditoriasHorario(A)).toBe(antes);
    });

    it('IB-h2 grava, audita uma vez (antes e depois) e é idempotente: repetir, mesmo com as entidades em outra ordem, não grava nem audita de novo', async () => {
      const antes = await auditoriasHorario(A);
      const novo = { padrao: '05:30', entidades: { preco: null, cliente: '04:45' } };
      const r1 = await chamar('analista', URL_HORARIO, 'PUT', novo);
      expect(r1.statusCode, r1.body).toBe(200);
      expect(r1.json()).toEqual({ padrao: '05:30', entidades: { cliente: '04:45', preco: null } });
      expect(await auditoriasHorario(A)).toBe(antes + 1);
      const { rows } = await api.admin.query(
        "select usuario_id, antes, depois from plataforma.auditoria where tenant_id = $1 and acao = 'parametro.inicio' and depois ? 'horario_carga' order by ocorrido_em desc, id desc limit 1",
        [A.tenantId],
      );
      expect(rows[0]).toMatchObject({ usuario_id: U.analista, antes: { horario_carga: PADRAO_HORARIO }, depois: { horario_carga: { padrao: '05:30', entidades: { cliente: '04:45', preco: null } } } });
      const r2 = await chamar('admin', URL_HORARIO, 'PUT', { padrao: '05:30', entidades: { cliente: '04:45', preco: null } });
      expect(r2.statusCode).toBe(200);
      expect(await auditoriasHorario(A)).toBe(antes + 1);
      expect((await chamar('admin', URL_HORARIO)).json()).toEqual(r1.json());
    });

    it('IB-h3 perfil sem parametro.inicio: gerente e assistente 403 PERFIL_SEM_ACESSO; supervisor, vendedor e promotor 403 PERFIL_SEM_BKO (GET e PUT); valor intacto', async () => {
      const atual = (await chamar('admin', URL_HORARIO)).json();
      const codigo: Record<string, string> = { gerente: 'PERFIL_SEM_ACESSO', assistente: 'PERFIL_SEM_ACESSO', supervisor: 'PERFIL_SEM_BKO', vendedor1: 'PERFIL_SEM_BKO', promotor: 'PERFIL_SEM_BKO' };
      for (const quem of Object.keys(codigo)) {
        for (const metodo of ['GET', 'PUT'] as const) {
          const r = await chamar(quem, URL_HORARIO, metodo, metodo === 'PUT' ? { padrao: '09:00', entidades: {} } : undefined);
          expect(r.statusCode, `${quem} ${metodo}`).toBe(403);
          expect(erroDe(r).codigo, `${quem} ${metodo}`).toBe(codigo[quem]);
        }
      }
      expect((await chamar('admin', URL_HORARIO)).json()).toEqual(atual);
    });
  });
});
