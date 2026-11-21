/**
 * T-0191 × Postgres real (fixture dois-tenants, papel macuxi_app, RLS): endereço da casa e base do vendedor (RN-CORE-75),
 * prévia e lote da rota criada por proximidade (RN-CORE-76) e "Gerar coordenada" do cliente com geocodificador falso, sem rede
 * (RN-CORE-77). Cobre permissões (a ação de cada rota; sem ela o perfil não passa), vendedor fora do escopo (404), isolamento
 * entre tenants, idempotência do lote, rotas protegidas e a origem da coordenada (ERP e check-in). Pula sem Postgres.
 */
import { ehFeriado } from '@macuxi/comum/calendar';
import { comTenant, definirTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import { ErroNaoEncontrado, ErroRegraNegocio, matrizDeFabrica, perfilDeFabrica, pode, resolverPerfil, type AcessoBanco, type ClienteBanco, type ConsumidorEvento, type ContextoBase, type ContextoConsumo, type Geocodificador, type ModuloId, type RotaModulo, type UsuarioAutenticado } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CoordenadasSugeridasSchema, RotasListaSchema } from '../contracts';
import { manifest } from '../manifest';
import { carteiraDoUsuario } from './carteira';
import { consumidoresDoErp } from './consumidores-erp';
import { rotasDeCriarRotaEBase } from './rotas-criar';
import { rotasDeMetasProdutividade } from './metas-produtividade';
import { rotasDeRotasEVisitas } from './rotas';
import { usuariosVisiveisDoUsuario } from './usuarios-visiveis';

const A = DOIS_TENANTS.A;
const B = DOIS_TENANTS.B;
const U = A.usuarios;
const DIA_MS = 86_400_000;
const somarDias = (data: string, n: number) => new Date(Date.parse(`${data}T12:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);
const AGORA = new Date();
const HOJE = new Date(AGORA.getTime() - 4 * 3_600_000).toISOString().slice(0, 10);
/** Segunda-feira a mais de 400 dias de hoje, de uma semana (seg a sáb) sem feriado nacional: o calendário não muda o resultado. */
const SEMANA = (() => {
  let seg = somarDias(HOJE, 400);
  seg = somarDias(seg, (8 - new Date(`${seg}T12:00:00Z`).getUTCDay()) % 7);
  while (Array.from({ length: 6 }, (_, i) => somarDias(seg, i)).some((d) => ehFeriado(d))) seg = somarDias(seg, 7);
  return seg;
})();
const DIA = (n: number) => somarDias(SEMANA, n); // 0 = segunda … 5 = sábado
const ATE = DIA(5);
const idc = (n: number) => `0e3b0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
/** Base e clientes em Manaus (o ponto fixo antigo do web não entra em nenhuma conta). */
const BASE = { lat: -3.1, lng: -60.0 };
const ENDERECO_CASA = { cep: '69053000', logradouro: 'Rua das Palmeiras', numero: '100', bairro: 'Centro', cidade: 'Manaus', uf: 'AM', lat: BASE.lat, lng: BASE.lng };
const ENDERECO_OUTRO = { cep: '69010000', logradouro: 'Avenida Eduardo Ribeiro', numero: '5', bairro: 'Centro', cidade: 'Manaus', uf: 'AM', lat: -3.13, lng: -60.02 };
const TEXTOS_DO_ENDERECO = ['Palmeiras', 'Eduardo Ribeiro', '69053', '69010'];

describe.skipIf(semBanco())('Core T-0191 × Postgres: base, prévia, lote e Gerar coordenada', () => {
  let pool: pg.Pool;
  let acesso: AcessoBanco;
  const eventos: Array<{ nome: string; payload: Record<string, unknown> }> = [];
  const chamadasGeocodificador: unknown[] = [];
  let respostaGeocodificador: () => Promise<{ lat: number; lng: number; precisao: 'numero' | 'rua' | 'cep' } | null> = async () => null;
  const geocodificador: Geocodificador = {
    disponivel: () => true,
    localizar: async (e) => {
      chamadasGeocodificador.push(e);
      return respostaGeocodificador();
    },
  };

  const usuario = (uid: string, perfil: UsuarioAutenticado['perfil'], tenant = A.tenantId): UsuarioAutenticado => ({ id: uid, tenant_id: tenant, perfil });
  const vendedor1 = usuario(U.vendedor1, 'vendedor');
  const supervisor = usuario(U.supervisor, 'supervisor');
  const gerente = usuario(U.gerente, 'gerente');
  const analista = usuario(U.analista, 'analista');
  const admin = usuario(U.admin, 'admin');
  const adminB = usuario(B.usuarios.admin, 'admin', B.tenantId);

  const perfilDoTeste = (u: UsuarioAutenticado) => resolverPerfil(perfilDeFabrica(u.perfil), matrizDeFabrica([manifest]));
  function ctx(u: UsuarioAutenticado, modulos: ModuloId[] = ['core', 'vendedor']): ContextoBase {
    return {
      usuario: { ...u, modulos, perfis: [perfilDoTeste(u)] },
      requestId: 'req-teste',
      agora: () => AGORA,
      fuso: () => 'America/Manaus',
      geocodificador,
      comTenant: (fn: (db: pg.ClientBase, t: unknown) => Promise<unknown>) =>
        comTenant(pool, u.tenant_id, (c) =>
          fn(c, {
            publicar: async (def: { nome: string }, payload: Record<string, unknown>) => {
              eventos.push({ nome: def.nome, payload });
              return {};
            },
          }),
        ),
      carteira: () => carteiraDoUsuario(u, acesso),
      usuariosVisiveis: () => usuariosVisiveisDoUsuario(u, acesso),
    } as unknown as ContextoBase;
  }
  const todas: RotaModulo[] = [...rotasDeCriarRotaEBase, ...rotasDeRotasEVisitas, ...rotasDeMetasProdutividade];
  const rota = (metodo: string, caminho: string): RotaModulo => todas.find((r) => r.metodo === metodo && r.caminho === caminho)!;
  const chamar = (metodo: string, caminho: string, u: UsuarioAutenticado, extra: { corpo?: unknown; query?: unknown; params?: unknown } = {}) => {
    const r = rota(metodo, caminho);
    return r.executar({ ...ctx(u), corpo: r.corpo ? r.corpo.parse(extra.corpo ?? {}) : {}, query: r.query ? r.query.parse(extra.query ?? {}) : {}, params: r.params ? r.params.parse(extra.params ?? {}) : {} } as never) as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const sql = <R = Record<string, unknown>>(texto: string, v: unknown[] = [], tenant = A.tenantId) => comTenant(pool, tenant, async (c) => (await c.query(texto, v)).rows as R[]);
  const rejeita = async (p: Promise<unknown>, tipo: typeof ErroRegraNegocio | typeof ErroNaoEncontrado, codigo: string) => {
    const erro = await p.then(() => null, (e: unknown) => e);
    expect(erro, `esperava ${codigo}`).toBeInstanceOf(tipo);
    expect((erro as { codigo: string }).codigo).toBe(codigo);
  };

  // clientes de teste: 8 com coordenada em volta da base (carteira do vendedor1); G e H sem coordenada, com endereço
  const CLIENTES = Array.from({ length: 8 }, (_, i) => ({ id: idc(10 + i), lat: -3.1 - i * 0.01, lng: -60.0 - (i % 2) * 0.01 }));
  const G = idc(30);
  const H = idc(31);
  const SEM_ENDERECO = idc(32);
  const DE_OUTRO_VENDEDOR = idc(33);

  const limpar = async () => {
    await sql("delete from core.visita where id::text like '0e3b0000%'");
    await sql('delete from core.rota_parada where data >= $1', [SEMANA]);
    await sql('delete from core.rota where data >= $1', [SEMANA]);
    await sql("delete from core.carteira where id::text like '0e3b0000%'");
    await sql("delete from core.cliente where id::text like '0e3b0000%'");
    await sql("delete from core.cliente where external_id like 'C-T189%'");
    await sql("update core.usuario set casa_cep = null, casa_logradouro = null, casa_numero = null, casa_bairro = null, casa_cidade = null, casa_uf = null, casa_lat = null, casa_lng = null, base_tipo = null, base_cep = null, base_logradouro = null, base_numero = null, base_bairro = null, base_cidade = null, base_uf = null, base_lat = null, base_lng = null, base_alterada_em = null where id = any($1::uuid[])", [[U.vendedor1, U.vendedor2, U.promotor, U.supervisor]]);
  };

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: banco().urlApp, max: 6 });
    acesso = {
      comTenant: (tenantId, fn) => comTenant(pool, tenantId, (c) => fn(c as unknown as ClienteBanco)),
      semTenant: (fn) => fn({ query: async () => ({ rows: [], rowCount: 0 }) } as unknown as ClienteBanco),
    };
    await limpar();
    for (const c of CLIENTES) {
      await sql("insert into core.cliente (id, tenant_id, razao_social, nome_fantasia, cidade, uf, latitude, longitude, coordenada_origem) values ($1, $2, $3, $3, 'Manaus', 'AM', $4, $5, 'erp')", [c.id, A.tenantId, `Cliente T189 ${c.id.slice(-2)}`, c.lat, c.lng]);
      await sql("insert into core.carteira (id, tenant_id, cliente_id, usuario_id, papel) values ($1, $2, $3, $4, 'vendedor')", [idc(100 + Number(c.id.slice(-2))), A.tenantId, c.id, U.vendedor1]);
    }
    const semCoordenada = (cid: string, nome: string, logradouro: string | null, cep: string | null, dono: string, n: number) =>
      sql(
        `with c as (insert into core.cliente (id, tenant_id, razao_social, nome_fantasia, logradouro, numero, bairro, cidade, uf, cep) values ($1, $2, $3, $3, $4, '10', 'Centro', 'Manaus', 'AM', $5) returning id)
         insert into core.carteira (id, tenant_id, cliente_id, usuario_id, papel) select $6, $2, id, $7, 'vendedor' from c`,
        [cid, A.tenantId, nome, logradouro, cep, idc(n), dono],
      );
    await semCoordenada(G, 'Cliente T189 G', 'Rua Quinze de Novembro', '69005110', U.vendedor1, 140);
    await semCoordenada(H, 'Cliente T189 H', 'Rua Sem Resultado', '69005120', U.vendedor1, 141);
    await semCoordenada(SEM_ENDERECO, 'Cliente T189 sem endereço', null, null, U.vendedor1, 142);
    await semCoordenada(DE_OUTRO_VENDEDOR, 'Cliente T189 do vendedor 2', 'Rua Longe', '69005130', U.vendedor2, 143);
  });
  afterAll(async () => {
    if (pool) await limpar();
    await pool?.end();
  });

  describe('permissões', () => {
    it('cada rota nova declara a ação do catálogo e o perfil sem ela não passa (403 pela plataforma)', () => {
      const esperado: Array<[string, string, string]> = [
        ['GET', 'usuarios/:id/endereco', 'usuario.ver'],
        ['PUT', 'usuarios/:id/endereco', 'usuario.editar'],
        ['GET', 'usuarios/:id/base', 'rota.editar'],
        ['PUT', 'usuarios/:id/base', 'rota.editar'],
        ['POST', 'rotas/previa', 'rota.editar'],
        ['POST', 'rotas/lote', 'rota.editar'],
        ['POST', 'clientes/:id/coordenada/gerar', 'cliente.aprovar_coordenada'],
      ];
      for (const [m, c, acao] of esperado) {
        expect(rota(m, c).acao, `${m} ${c}`).toBe(acao);
        expect(rota(m, c).carteira, `${m} ${c}`).toBeTruthy();
        // quem tem a ação passa; o vendedor, que não edita rota nem coordenada, é barrado
        if (acao === 'rota.editar' || acao === 'cliente.aprovar_coordenada') {
          expect(pode([perfilDoTeste(vendedor1)], acao), `vendedor ${acao}`).toBe(false);
          expect(pode([perfilDoTeste(supervisor)], 'cliente.aprovar_coordenada')).toBe(false);
          expect(pode([perfilDoTeste(analista)], acao), `analista ${acao}`).toBe(true);
        }
      }
      expect(pode([perfilDoTeste(vendedor1)], 'usuario.editar')).toBe(false);
      expect(pode([perfilDoTeste(analista)], 'usuario.editar')).toBe(false);
      expect(pode([perfilDoTeste(admin)], 'usuario.editar')).toBe(true);
    });
  });

  describe('endereço da casa e base (RN-CORE-75)', () => {
    it('RN-CORE-75: a casa se grava e se lê (CEP normalizado), o vendedor só vê a casa de quem o escopo deixa e não há endereço na auditoria', async () => {
      const salvo = await chamar('PUT', 'usuarios/:id/endereco', admin, { params: { id: U.vendedor1 }, corpo: { endereco: { ...ENDERECO_CASA, cep: '69053-000' } } });
      expect(salvo.endereco).toMatchObject({ cep: '69053000', logradouro: 'Rua das Palmeiras', uf: 'AM', lat: BASE.lat, lng: BASE.lng });
      expect((await chamar('GET', 'usuarios/:id/endereco', admin, { params: { id: U.vendedor1 } })).endereco).toMatchObject({ cidade: 'Manaus' });
      expect((await chamar('GET', 'usuarios/:id/endereco', supervisor, { params: { id: U.vendedor1 } })).endereco).toMatchObject({ cep: '69053000' });
      const aud = await sql<{ antes: unknown; depois: unknown }>("select antes, depois from plataforma.auditoria where acao = 'usuario.endereco_editar' and entidade_id = $1 order by created_at desc limit 1", [U.vendedor1]);
      expect(aud[0]!.depois).toEqual({ definido: true, ponto_marcado: true });
      for (const t of TEXTOS_DO_ENDERECO) expect(JSON.stringify(aud)).not.toContain(t);
    });

    it('RN-CORE-75: o corpo recusa CEP e UF inválidos e ponto só com a latitude; só vendedor e promotor têm casa (422)', async () => {
      const put = rota('PUT', 'usuarios/:id/endereco');
      expect(put.corpo!.safeParse({ endereco: { ...ENDERECO_CASA, cep: '123' } }).success).toBe(false);
      expect(put.corpo!.safeParse({ endereco: { ...ENDERECO_CASA, uf: 'XX' } }).success).toBe(false);
      expect(put.corpo!.safeParse({ endereco: { ...ENDERECO_CASA, lng: null } }).success).toBe(false);
      expect(put.corpo!.safeParse({ endereco: { ...ENDERECO_CASA, lat: null, lng: null } }).success).toBe(true);
      await rejeita(chamar('PUT', 'usuarios/:id/endereco', admin, { params: { id: U.supervisor }, corpo: { endereco: ENDERECO_CASA } }), ErroRegraNegocio, 'USUARIO_SEM_ENDERECO');
    });

    it('RN-CORE-04: usuário de outra equipe é 404 na casa e na base (supervisor); gerente alcança as duas equipes', async () => {
      for (const [m, c, corpo] of [['GET', 'usuarios/:id/endereco', undefined], ['PUT', 'usuarios/:id/endereco', { endereco: ENDERECO_CASA }], ['GET', 'usuarios/:id/base', undefined], ['PUT', 'usuarios/:id/base', { tipo: 'casa' }]] as const) {
        await rejeita(chamar(m, c, supervisor, { params: { id: U.vendedor2 }, corpo }), ErroNaoEncontrado, 'USUARIO_NAO_ENCONTRADO');
      }
      expect((await chamar('GET', 'usuarios/:id/base', gerente, { params: { id: U.vendedor2 } })).base).toBeNull();
    });

    it('RN-AUD-01 e isolamento: o admin do outro tenant não enxerga nem grava o usuário (404, RLS) e nada vaza', async () => {
      await rejeita(chamar('GET', 'usuarios/:id/endereco', adminB, { params: { id: U.vendedor1 } }), ErroNaoEncontrado, 'USUARIO_NAO_ENCONTRADO');
      await rejeita(chamar('PUT', 'usuarios/:id/base', adminB, { params: { id: U.vendedor1 }, corpo: { tipo: 'outro', endereco: ENDERECO_OUTRO } }), ErroNaoEncontrado, 'USUARIO_NAO_ENCONTRADO');
      const idsDoA = new Set(Object.values(U));
      expect(Object.keys((await chamar('GET', 'rotas', adminB)).bases).filter((id) => idsDoA.has(id))).toEqual([]);
    });

    it('RN-CORE-75: base Casa sem o ponto da casa marcado é 422 BASE_SEM_PONTO; com o ponto usa a casa; Outro endereço usa o ponto próprio; troca grava base_alterada_em e audita', async () => {
      await chamar('PUT', 'usuarios/:id/endereco', admin, { params: { id: U.promotor }, corpo: { endereco: { ...ENDERECO_CASA, lat: null, lng: null } } });
      await rejeita(chamar('PUT', 'usuarios/:id/base', analista, { params: { id: U.promotor }, corpo: { tipo: 'casa' } }), ErroRegraNegocio, 'BASE_SEM_PONTO');
      expect((await sql('select base_tipo, base_alterada_em from core.usuario where id = $1', [U.promotor]))[0]).toEqual({ base_tipo: null, base_alterada_em: null });

      const casa = await chamar('PUT', 'usuarios/:id/base', analista, { params: { id: U.vendedor1 }, corpo: { tipo: 'casa' } });
      expect(casa).toMatchObject({ tipo: 'casa', logradouro: 'Rua das Palmeiras', lat: BASE.lat, lng: BASE.lng });
      const t1 = (await sql<{ base_alterada_em: Date }>('select base_alterada_em from core.usuario where id = $1', [U.vendedor1]))[0]!.base_alterada_em;
      expect(t1).toBeInstanceOf(Date);

      const outro = await chamar('PUT', 'usuarios/:id/base', analista, { params: { id: U.vendedor1 }, corpo: { tipo: 'outro', endereco: ENDERECO_OUTRO } });
      expect(outro).toMatchObject({ tipo: 'outro', logradouro: 'Avenida Eduardo Ribeiro', lat: -3.13, lng: -60.02 });
      expect((await chamar('GET', 'usuarios/:id/base', analista, { params: { id: U.vendedor1 } }))).toMatchObject({ casa: { cep: '69053000' }, base: { tipo: 'outro' } });
      const aud = await sql<{ antes: unknown; depois: unknown }>("select antes, depois from plataforma.auditoria where acao = 'usuario.base_editar' and entidade_id = $1 order by created_at", [U.vendedor1]);
      expect(aud.map((a) => a.depois)).toEqual([{ base_tipo: 'casa' }, { base_tipo: 'outro' }]);
      for (const t of TEXTOS_DO_ENDERECO) expect(JSON.stringify(aud)).not.toContain(t);
      // só vendedor e promotor têm base (supervisor é 422)
      await rejeita(chamar('PUT', 'usuarios/:id/base', analista, { params: { id: U.supervisor }, corpo: { tipo: 'outro', endereco: ENDERECO_OUTRO } }), ErroRegraNegocio, 'USUARIO_SEM_ENDERECO');
      // Outro exige o ponto marcado
      expect(rota('PUT', 'usuarios/:id/base').corpo!.safeParse({ tipo: 'outro', endereco: { ...ENDERECO_OUTRO, lat: null, lng: null } }).success).toBe(false);
      await chamar('PUT', 'usuarios/:id/base', analista, { params: { id: U.vendedor1 }, corpo: { tipo: 'casa' } }); // volta para a casa nos próximos casos
    });
  });

  describe('prévia (RN-CORE-76)', () => {
    const previa = (u: UsuarioAutenticado, extra: Record<string, unknown> = {}, usuarioId = U.vendedor1) => chamar('POST', 'rotas/previa', u, { corpo: { usuario_id: usuarioId, de: SEMANA, ate: ATE, ...extra } });

    it('RN-CORE-76: monta os dias a partir da base, não grava nada e devolve a base e os clientes fora', async () => {
      const antes = await sql<{ n: string }>('select count(*) as n from core.rota where data >= $1', [SEMANA]);
      const p = await previa(analista);
      expect((await sql<{ n: string }>('select count(*) as n from core.rota where data >= $1', [SEMANA]))[0]).toEqual(antes[0]);
      expect(p.base).toMatchObject({ tipo: 'casa', lat: BASE.lat });
      expect(p.dias.length).toBeGreaterThan(0);
      expect(p.totais).toMatchObject({ rotas: p.dias.length, visitas: p.dias.reduce((s: number, d: { visitas: number }) => s + d.visitas, 0) });
      expect(p.totais.km).toBeGreaterThan(0);
      // cada cliente com coordenada da carteira aparece uma vez na semana (semanal) e nenhum passa do limite
      const idsDosDias: string[] = p.dias.flatMap((d: { paradas: Array<{ cliente_id: string }> }) => d.paradas.map((x) => x.cliente_id));
      for (const c of CLIENTES) expect(idsDosDias.filter((x) => x === c.id)).toHaveLength(1);
      expect(p.dias.every((d: { paradas: unknown[] }) => d.paradas.length <= 11)).toBe(true);
      // sem coordenada: G, H e o sem endereço ficam fora, com o endereço para "Ver clientes"; o de outro vendedor não aparece
      const fora: Array<{ cliente_id: string; ja_tentado: boolean; logradouro: string | null }> = p.fora_sem_coordenada;
      expect(fora.map((f) => f.cliente_id)).toEqual(expect.arrayContaining([G, H, SEM_ENDERECO]));
      expect(fora.map((f) => f.cliente_id)).not.toContain(DE_OUTRO_VENDEDOR);
      expect(fora.find((f) => f.cliente_id === G)).toMatchObject({ logradouro: 'Rua Quinze de Novembro', ja_tentado: false });
      expect(p.fora_limite).toEqual([]);
      expect(p.mantidas).toEqual([]);
    });

    it('RN-CORE-76: sem base não há base na resposta e o km conta do 1º cliente (menor que o km saindo de um ponto distante)', async () => {
      const comBase = await previa(analista);
      await sql('update core.usuario set base_tipo = null where id = $1', [U.vendedor1]);
      const semBase = await previa(analista);
      expect(semBase.base).toBeNull();
      expect(semBase.totais.km).toBeLessThanOrEqual(comBase.totais.km);
      await sql("update core.usuario set base_tipo = 'casa' where id = $1", [U.vendedor1]);
    });

    it('RN-CORE-76: o limite visitas_dia da empresa vale e o excedente vai para "não couberam"', async () => {
      const meta = await chamar('PUT', 'metas-produtividade', admin, { corpo: { escopo: 'usuario', usuario_id: U.vendedor1, vigencia_inicio: HOJE.slice(0, 7), metas: [{ indicador: 'visitas_dia', valor: 10 }] } });
      try {
        const p = await previa(analista, { de: DIA(0), ate: DIA(0) });
        expect(p.dias.every((d: { paradas: unknown[] }) => d.paradas.length <= 1)).toBe(true);
        expect(p.dias.flatMap((d: { paradas: unknown[] }) => d.paradas)).toHaveLength(p.dias.length);
        expect(p.fora_limite.length).toBeGreaterThan(0);
      } finally {
        for (const m of meta.itens) await chamar('DELETE', 'metas-produtividade/:id', admin, { params: { id: m.id } });
      }
      expect((await previa(analista, { de: DIA(0), ate: DIA(0) })).fora_limite).toEqual([]);
    });

    it('RN-CORE-04: supervisor não monta prévia de vendedor de outra equipe (404) e o admin do outro tenant não vê o vendedor (404)', async () => {
      await rejeita(previa(supervisor, {}, U.vendedor2), ErroNaoEncontrado, 'USUARIO_NAO_ENCONTRADO');
      await rejeita(previa(adminB), ErroNaoEncontrado, 'USUARIO_NAO_ENCONTRADO');
      expect((await previa(supervisor)).totais.rotas).toBeGreaterThan(0); // a própria equipe passa
    });

    it('RN-CORE-76: o pedido recusa período maior que 62 dias e data final antes da inicial', () => {
      const corpo = rota('POST', 'rotas/previa').corpo!;
      expect(corpo.safeParse({ usuario_id: U.vendedor1, de: SEMANA, ate: somarDias(SEMANA, 63) }).success).toBe(false);
      expect(corpo.safeParse({ usuario_id: U.vendedor1, de: ATE, ate: SEMANA }).success).toBe(false);
      expect(corpo.parse({ usuario_id: U.vendedor1, de: SEMANA, ate: ATE }).modo).toBe('so_vazios');
    });
  });

  describe('lote (RN-CORE-76)', () => {
    let n = 0;
    const doLote = (p: { dias: Array<{ data: string; paradas: Array<{ cliente_id: string }> }> }, ids?: string[]) =>
      p.dias.map((d, i) => ({ id: ids?.[i] ?? idc(500 + n++), data: d.data, paradas: d.paradas.map((x) => ({ cliente_id: x.cliente_id })) }));
    const salvarLote = (u: UsuarioAutenticado, rotas: unknown[], modo = 'so_vazios', usuarioId = U.vendedor1) => chamar('POST', 'rotas/lote', u, { corpo: { usuario_id: usuarioId, modo, rotas } });
    const rotasDoPeriodo = () => sql<{ id: string; data: string; origem: string; paradas: number }>("select r.id, to_char(r.data, 'YYYY-MM-DD') as data, r.origem, (select count(*)::int from core.rota_parada p where p.rota_id = r.id and p.deleted_at is null) as paradas from core.rota r where r.usuario_id = $1 and r.data between $2 and $3 and r.deleted_at is null order by r.data", [U.vendedor1, SEMANA, ATE]);

    it('RN-CORE-76: salva o lote como origem bko; salvar duas vezes o mesmo lote não duplica rotas nem paradas e audita', async () => {
      const p = await chamar('POST', 'rotas/previa', analista, { corpo: { usuario_id: U.vendedor1, de: SEMANA, ate: ATE } });
      const rotas = doLote(p);
      expect(await salvarLote(analista, rotas)).toEqual({ salvas: rotas.length, repetidas: 0 });
      const depois1 = await rotasDoPeriodo();
      expect(depois1).toHaveLength(rotas.length);
      expect(depois1.every((r) => r.origem === 'bko')).toBe(true);
      expect(depois1.reduce((s, r) => s + r.paradas, 0)).toBe(p.totais.visitas);
      expect(await salvarLote(analista, rotas)).toEqual({ salvas: rotas.length, repetidas: rotas.length });
      expect(await rotasDoPeriodo()).toEqual(depois1);
      const aud = await sql<{ depois: { salvas: string[]; repetidas: number } }>("select depois from plataforma.auditoria where acao = 'rota.lote' order by created_at");
      expect(aud.at(-1)!.depois).toMatchObject({ usuario_id: U.vendedor1, modo: 'so_vazios', repetidas: rotas.length });
      // a rota gravada aparece em GET rotas com a base do vendedor e o calendário do tenant
      const lista = await chamar('GET', 'rotas', analista, { query: { usuario_id: U.vendedor1, de: SEMANA, ate: ATE } });
      expect(lista.itens).toHaveLength(rotas.length);
      expect(lista.bases[U.vendedor1]).toEqual({ tipo: 'casa', lat: BASE.lat, lng: BASE.lng });
      // a base da lista não leva o endereço (pode ser a casa): só tipo e ponto; passa no contrato
      expect(RotasListaSchema.safeParse(lista).success).toBe(true);
      expect(lista.calendario.dias_uteis_semana).toEqual(expect.arrayContaining([1, 2, 3]));
      // a prévia seguinte, só nos dias sem rota, mantém todos
      const p2 = await chamar('POST', 'rotas/previa', analista, { corpo: { usuario_id: U.vendedor1, de: SEMANA, ate: ATE } });
      expect(p2.dias).toEqual([]);
      expect(p2.mantidas.map((m: { data: string }) => m.data)).toEqual(rotas.map((r) => r.data));
      // o supervisor de outra equipe e o outro tenant não gravam
      await rejeita(salvarLote(supervisor, [{ id: idc(990), data: DIA(0), paradas: [{ cliente_id: CLIENTES[0]!.id }] }], 'so_vazios', U.vendedor2), ErroNaoEncontrado, 'USUARIO_NAO_ENCONTRADO');
      await rejeita(salvarLote(adminB, [{ id: idc(991), data: DIA(0), paradas: [{ cliente_id: CLIENTES[0]!.id }] }]), ErroNaoEncontrado, 'USUARIO_NAO_ENCONTRADO');
      expect(await rotasDoPeriodo()).toEqual(depois1);
    });

    it('RN-CORE-76: com rota existente, "só nos dias sem rota" recusa o dia (ROTA_EXISTENTE) e o id de outro dia não é reaproveitado', async () => {
      const existente = (await rotasDoPeriodo())[0]!;
      await rejeita(salvarLote(analista, [{ id: idc(960), data: existente.data, paradas: [{ cliente_id: CLIENTES[0]!.id }] }]), ErroRegraNegocio, 'ROTA_EXISTENTE');
      await rejeita(salvarLote(analista, [{ id: existente.id, data: DIA(5), paradas: [{ cliente_id: CLIENTES[0]!.id }] }]), ErroRegraNegocio, 'ROTA_EXISTENTE');
    });

    it('RN-CORE-76: substituir troca só a rota do BKO sem visita; a do ERP e a com visita são protegidas (ROTA_PROTEGIDA) e a prévia conta só as trocadas', async () => {
      const dias = (await rotasDoPeriodo()).map((r) => r.data);
      const [d1, d2, d3] = [dias[0]!, dias[1]!, dias[2]!];
      await sql("update core.rota set origem = 'erp' where usuario_id = $1 and data = $2", [U.vendedor1, d2]);
      await sql("insert into core.visita (id, tenant_id, usuario_id, cliente_id, data_local, checkin_em, checkout_em, resultado, fechada_por, motivo_texto) values ($1, $2, $3, $4, $5, $6, $6, 'sem_pedido', 'usuario', 'teste')", [idc(700), A.tenantId, U.vendedor1, CLIENTES[0]!.id, d3, AGORA.toISOString()]);

      const p = await chamar('POST', 'rotas/previa', analista, { corpo: { usuario_id: U.vendedor1, de: SEMANA, ate: ATE, modo: 'substituir' } });
      expect(p.mantidas).toEqual(expect.arrayContaining([expect.objectContaining({ data: d2, protegida: true }), expect.objectContaining({ data: d3, protegida: true })]));
      expect(p.dias.map((d: { data: string }) => d.data)).toEqual(expect.arrayContaining([d1]));
      expect(p.dias.map((d: { data: string }) => d.data)).not.toContain(d2);
      expect(p.dias.map((d: { data: string }) => d.data)).not.toContain(d3);

      const antes = await rotasDoPeriodo();
      await rejeita(salvarLote(analista, [{ id: idc(961), data: d2, paradas: [{ cliente_id: CLIENTES[1]!.id }] }], 'substituir'), ErroRegraNegocio, 'ROTA_PROTEGIDA');
      await rejeita(salvarLote(analista, [{ id: idc(962), data: d3, paradas: [{ cliente_id: CLIENTES[1]!.id }] }], 'substituir'), ErroRegraNegocio, 'ROTA_PROTEGIDA');
      expect(await rotasDoPeriodo()).toEqual(antes);

      // o dia sem proteção é trocado: mesma rota, paradas novas, origem bko
      const id1 = antes.find((r) => r.data === d1)!.id;
      expect(await salvarLote(analista, [{ id: idc(963), data: d1, paradas: [{ cliente_id: CLIENTES[1]!.id }] }], 'substituir')).toEqual({ salvas: 1, repetidas: 0 });
      const depois = await rotasDoPeriodo();
      expect(depois.find((r) => r.data === d1)).toEqual({ id: id1, data: d1, origem: 'bko', paradas: 1 });
      expect(depois.find((r) => r.data === d2)).toEqual(antes.find((r) => r.data === d2));
      expect(depois.find((r) => r.data === d3)).toEqual(antes.find((r) => r.data === d3));
      // repetir o mesmo lote não duplica
      await salvarLote(analista, [{ id: idc(963), data: d1, paradas: [{ cliente_id: CLIENTES[1]!.id }] }], 'substituir');
      expect(await rotasDoPeriodo()).toHaveLength(depois.length);
    });

    it('RN-CORE-76: Substituir reenviado idêntico conta como repetidas e não audita de novo', async () => {
      const auditorias = async () => Number((await sql<{ n: number }>("select count(*)::int as n from plataforma.auditoria where acao = 'rota.lote'"))[0]!.n);
      const d1 = (await rotasDoPeriodo())[0]!.data;
      const lote = [{ id: idc(964), data: d1, paradas: [{ cliente_id: CLIENTES[1]!.id }] }];
      await salvarLote(analista, lote, 'substituir');
      const antes = await auditorias();
      expect(await salvarLote(analista, lote, 'substituir')).toEqual({ salvas: 1, repetidas: 1 });
      expect(await auditorias()).toBe(antes);
    });

    it('RN-CORE-76 e RN-CORE-04: o servidor recusa dia de feriado, dia passado e cliente fora da carteira do vendedor', async () => {
      const natal = `${new Date(Date.parse(`${HOJE}T12:00:00Z`) + 800 * DIA_MS).getUTCFullYear()}-12-25`;
      await rejeita(salvarLote(analista, [{ id: idc(970), data: natal, paradas: [{ cliente_id: CLIENTES[0]!.id }] }]), ErroRegraNegocio, 'ROTA_DIA_INVALIDO');
      await rejeita(salvarLote(analista, [{ id: idc(971), data: somarDias(HOJE, -3), paradas: [{ cliente_id: CLIENTES[0]!.id }] }]), ErroRegraNegocio, 'ROTA_DIA_INVALIDO');
      await sql('delete from core.rota_parada where data >= $1 and usuario_id = $2', [DIA(5), U.vendedor1]);
      await sql('delete from core.rota where data = $1 and usuario_id = $2', [DIA(5), U.vendedor1]);
      await rejeita(salvarLote(analista, [{ id: idc(972), data: DIA(5), paradas: [{ cliente_id: DE_OUTRO_VENDEDOR }] }]), ErroRegraNegocio, 'RN-CORE-04');
    });

    it('o corpo do lote recusa dia repetido e cliente repetido na mesma rota', () => {
      const corpo = rota('POST', 'rotas/lote').corpo!;
      const r = (data: string, ids: string[]) => ({ id: idc(980 + Math.floor(Math.random() * 1000)), data, paradas: ids.map((cliente_id) => ({ cliente_id })) });
      expect(corpo.safeParse({ usuario_id: U.vendedor1, rotas: [r(DIA(0), [CLIENTES[0]!.id]), r(DIA(0), [CLIENTES[1]!.id])] }).success).toBe(false);
      expect(corpo.safeParse({ usuario_id: U.vendedor1, rotas: [r(DIA(0), [CLIENTES[0]!.id, CLIENTES[0]!.id])] }).success).toBe(false);
      expect(corpo.safeParse({ usuario_id: U.vendedor1, rotas: [] }).success).toBe(false);
    });

    it('RN-CORE-76 (D1): o mesmo lote enviado ao mesmo tempo grava uma vez e o reenvio devolve repetidas, sem 500 por chave duplicada', async () => {
      await sql('delete from core.rota_parada where rota_id in (select id from core.rota where usuario_id = $1 and data between $2 and $3)', [U.vendedor1, SEMANA, ATE]);
      await sql('delete from core.rota where usuario_id = $1 and data between $2 and $3', [U.vendedor1, SEMANA, ATE]);
      const p = await chamar('POST', 'rotas/previa', analista, { corpo: { usuario_id: U.vendedor1, de: SEMANA, ate: ATE } });
      const rotas = doLote(p);
      const [a, b] = await Promise.all([salvarLote(analista, rotas), salvarLote(analista, rotas)]);
      expect(a.salvas + b.salvas).toBe(rotas.length * 2);
      expect(a.repetidas + b.repetidas).toBe(rotas.length);
      expect(await rotasDoPeriodo()).toHaveLength(rotas.length);
    });
  });

  describe('Gerar coordenada (RN-CORE-77)', () => {
    const gerar = (u: UsuarioAutenticado, cid: string) => chamar('POST', 'clientes/:id/coordenada/gerar', u, { params: { id: cid } });
    const cliente = async (cid: string) => (await sql<Record<string, unknown>>('select latitude::float8 as lat, longitude::float8 as lng, coordenada_origem, coordenada_precisao, geocodificacao_tentada_em, geocodificacao_chave from core.cliente where id = $1', [cid]))[0]!;

    it('RN-CORE-77: localizado grava a coordenada (6 casas), a origem geocodificacao, a precisão e a tentativa; audita sem endereço; publica o evento', async () => {
      respostaGeocodificador = async () => ({ lat: -3.1234567, lng: -60.1234567, precisao: 'rua' });
      chamadasGeocodificador.length = 0;
      expect(await gerar(analista, G)).toEqual({ cliente_id: G, lat: -3.123457, lng: -60.123457, precisao: 'rua' });
      expect(chamadasGeocodificador).toEqual([expect.objectContaining({ logradouro: 'Rua Quinze de Novembro', cep: '69005110' })]);
      const c = await cliente(G);
      expect(c).toMatchObject({ lat: -3.123457, lng: -60.123457, coordenada_origem: 'geocodificacao', coordenada_precisao: 'rua' });
      expect(c.geocodificacao_tentada_em).toBeInstanceOf(Date);
      expect(c.geocodificacao_chave).toMatch(/^[0-9a-f]{64}$/);
      const aud = await sql<{ depois: unknown }>("select depois from plataforma.auditoria where acao = 'cliente.gerar_coordenada' and entidade_id = $1", [G]);
      expect(aud.map((a) => a.depois)).toEqual([{ resultado: 'localizado', precisao: 'rua' }]);
      expect(JSON.stringify(aud)).not.toContain('Quinze');
      expect(eventos.some((e) => e.nome === 'core.cliente.atualizado@1' && e.payload.cliente_id === G && e.payload.origem === 'bko')).toBe(true);
    });

    it('RN-CORE-77: nunca sobrescreve coordenada que o cliente já tem (gerada, do ERP): 422 JA_TEM_COORDENADA e o serviço não é chamado', async () => {
      chamadasGeocodificador.length = 0;
      await rejeita(gerar(analista, G), ErroRegraNegocio, 'JA_TEM_COORDENADA');
      await rejeita(gerar(analista, CLIENTES[0]!.id), ErroRegraNegocio, 'JA_TEM_COORDENADA');
      expect(chamadasGeocodificador).toEqual([]);
      expect(await cliente(CLIENTES[0]!.id)).toMatchObject({ coordenada_origem: 'erp', lat: CLIENTES[0]!.lat });
    });

    it('RN-CORE-77: não localizado grava a tentativa; o mesmo endereço não é tentado de novo (JA_TENTADO); mudou o endereço ou o CEP, tenta de novo', async () => {
      respostaGeocodificador = async () => null;
      chamadasGeocodificador.length = 0;
      await rejeita(gerar(analista, H), ErroRegraNegocio, 'NAO_LOCALIZADO');
      expect(await cliente(H)).toMatchObject({ lat: null, lng: null, coordenada_origem: null, coordenada_precisao: null });
      expect((await cliente(H)).geocodificacao_chave).toMatch(/^[0-9a-f]{64}$/);
      await rejeita(gerar(analista, H), ErroRegraNegocio, 'JA_TENTADO');
      expect(chamadasGeocodificador).toHaveLength(1);
      // a prévia mostra o cliente como já tentado (a tela desabilita o botão)
      const p = await chamar('POST', 'rotas/previa', analista, { corpo: { usuario_id: U.vendedor1, de: SEMANA, ate: ATE } });
      expect(p.fora_sem_coordenada.find((f: { cliente_id: string }) => f.cliente_id === H)).toMatchObject({ ja_tentado: true });
      await sql("update core.cliente set cep = '69005999' where id = $1", [H]);
      await rejeita(gerar(analista, H), ErroRegraNegocio, 'NAO_LOCALIZADO');
      expect(chamadasGeocodificador).toHaveLength(2);
    });

    it('RN-CORE-77: cliente sem endereço nem CEP é 422 sem chamar o serviço; serviço fora do ar (503) não grava a tentativa', async () => {
      chamadasGeocodificador.length = 0;
      await rejeita(gerar(analista, SEM_ENDERECO), ErroRegraNegocio, 'NAO_LOCALIZADO');
      expect(chamadasGeocodificador).toEqual([]);
      const { erroGeocodificadorIndisponivel } = await import('@macuxi/platform-sdk');
      respostaGeocodificador = async () => {
        throw erroGeocodificadorIndisponivel();
      };
      await sql("update core.cliente set cep = '69005888', geocodificacao_chave = null where id = $1", [H]);
      const erro = await gerar(analista, H).then(() => null, (e: unknown) => e);
      expect((erro as { status: number; codigo: string }).status).toBe(503);
      expect((erro as { codigo: string }).codigo).toBe('GEOCODIFICADOR_INDISPONIVEL');
      expect((await cliente(H)).geocodificacao_chave).toBeNull();
    });

    it('RN-CORE-77 e multi-tenant: o cliente de outro tenant é 404 (RLS) e nada é gravado', async () => {
      chamadasGeocodificador.length = 0;
      await rejeita(gerar(adminB, DE_OUTRO_VENDEDOR), ErroNaoEncontrado, 'CLIENTE_NAO_ENCONTRADO');
      expect(chamadasGeocodificador).toEqual([]);
      expect((await cliente(DE_OUTRO_VENDEDOR)).geocodificacao_tentada_em).toBeNull();
    });

    it('RN-CORE-77: o check-in aprovado substitui a coordenada gerada pelo endereço (origem checkin, sem precisão); a coordenada do ERP não é substituída', async () => {
      await sql(`insert into core.visita (id, tenant_id, usuario_id, cliente_id, data_local, checkin_em, checkout_em, resultado, fechada_por, motivo_texto, checkin_lat, checkin_lng, sugere_coordenada)
           values ($1, $2, $3, $4, $5, $8, $8, 'sem_pedido', 'usuario', 'teste', -3.2, -60.2, true), ($6, $2, $3, $7, $5, $8, $8, 'sem_pedido', 'usuario', 'teste', -3.3, -60.3, true), ($9, $2, $3, $10, $5, $8, $8, 'sem_pedido', 'usuario', 'teste', -3.4, -60.4, true)`, [idc(701), A.tenantId, U.vendedor1, G, HOJE, idc(702), CLIENTES[0]!.id, AGORA.toISOString(), idc(703), H]);
      const lista = await chamar('GET', 'coordenadas-sugeridas', analista);
      // D4: cliente sem origem de coordenada (H) devolve `geocodificada: false`, nunca null: a resposta passa no contrato
      expect(lista.itens.find((i: { cliente_id: string }) => i.cliente_id === H)).toMatchObject({ geocodificada: false });
      expect(CoordenadasSugeridasSchema.safeParse(lista).success).toBe(true);
      // D7: `pode_gerar` segue `enderecoPermiteGerar`: com rua ou CEP é true; sem os dois, false (a tela mostra o aviso no lugar do botão)
      const antes = await sql<{ logradouro: string | null; cep: string | null }>('select logradouro, cep from core.cliente where id = $1', [H]);
      await sql('update core.cliente set logradouro = null, cep = null where id = $1', [H]);
      const semEndereco = await chamar('GET', 'coordenadas-sugeridas', analista);
      expect(semEndereco.itens.find((i: { cliente_id: string }) => i.cliente_id === H)).toMatchObject({ pode_gerar: false });
      await sql('update core.cliente set logradouro = $2, cep = $3 where id = $1', [H, antes[0]?.logradouro ?? null, antes[0]?.cep ?? null]);
      expect(lista.itens.find((i: { cliente_id: string }) => i.cliente_id === H)).toMatchObject({ pode_gerar: true });
      // D8: `ja_tentado` na lista: endereço igual ao da última tentativa é true; mudou o endereço, volta a false
      respostaGeocodificador = async () => null;
      await rejeita(gerar(analista, H), ErroRegraNegocio, 'NAO_LOCALIZADO');
      expect((await chamar('GET', 'coordenadas-sugeridas', analista)).itens.find((i: { cliente_id: string }) => i.cliente_id === H)).toMatchObject({ ja_tentado: true });
      await sql("update core.cliente set cep = '69005111' where id = $1", [H]);
      expect((await chamar('GET', 'coordenadas-sugeridas', analista)).itens.find((i: { cliente_id: string }) => i.cliente_id === H)).toMatchObject({ ja_tentado: false });
      expect(lista.itens.find((i: { cliente_id: string }) => i.cliente_id === G)).toMatchObject({ geocodificada: true });
      expect(lista.itens.map((i: { cliente_id: string }) => i.cliente_id)).not.toContain(CLIENTES[0]!.id);
      await chamar('PUT', 'clientes/:id/coordenada', analista, { params: { id: G }, corpo: { visita_id: idc(701) } });
      expect(await cliente(G)).toMatchObject({ lat: -3.2, lng: -60.2, coordenada_origem: 'checkin', coordenada_precisao: null });
      await rejeita(chamar('PUT', 'clientes/:id/coordenada', analista, { params: { id: CLIENTES[0]!.id }, corpo: { visita_id: idc(702) } }), ErroRegraNegocio, 'RN-CORE-10');
      expect(await cliente(CLIENTES[0]!.id)).toMatchObject({ lat: CLIENTES[0]!.lat, coordenada_origem: 'erp' });
    });
  });

  describe('consumidor do ERP e a origem da coordenada (RN-CORE-77)', () => {
    const consumidor = (): ConsumidorEvento => consumidoresDoErp.find((x) => x.evento.nome === 'integracao.cliente.atualizado@1')!;
    const evento = (extra: Record<string, unknown>) => ({
      lote_id: '0e500000-0000-4000-8000-000000000001',
      entidade: 'cliente',
      external_id: 'C-T189',
      acao: 'atualizado' as const,
      hash: 'h',
      registro: { external_id: 'C-T189', alterado_em: AGORA.toISOString(), ativo: true, razao_social: 'Mercado T189', endereco: { logradouro: 'Rua A', numero: '1', bairro: 'Centro', cidade: 'Manaus', uf: 'AM', cep: '69005110' }, ...extra },
      ocorrido_em: AGORA.toISOString(),
    });
    async function entregar(extra: Record<string, unknown>, depoisDe: (q: <R>(texto: string) => Promise<R[]>) => Promise<void>, antes?: (c: pg.PoolClient) => Promise<void>) {
      const c = await pool.connect();
      try {
        await c.query('begin');
        await definirTenant(c, A.tenantId);
        if (antes) await antes(c);
        const cons = consumidor();
        const ctxConsumo = { db: c, agora: () => AGORA, fuso: () => 'America/Manaus', parametros: () => ({}), envelope: { evento_id: 'x', tenant_id: A.tenantId }, publicar: vi.fn(async () => ({})), consultar: vi.fn(), log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } as unknown as ContextoConsumo;
        await cons.executar(cons.evento.schema.parse(evento(extra)), ctxConsumo);
        await depoisDe(async (texto) => (await c.query(texto)).rows as never[]);
      } finally {
        await c.query('rollback').catch(() => undefined);
        c.release();
      }
    }
    const linha = "select latitude::float8 as lat, longitude::float8 as lng, coordenada_origem, coordenada_precisao from core.cliente where external_id = 'C-T189'";

    it('RN-CORE-77: a coordenada que o ERP manda grava origem erp; sem coordenada no payload, a gerada ou aprovada por check-in fica e a do ERP segue o ERP', async () => {
      await entregar({ latitude: -3.5, longitude: -60.5 }, async (q) => {
        expect((await q(linha))[0]).toEqual({ lat: -3.5, lng: -60.5, coordenada_origem: 'erp', coordenada_precisao: null });
      });
      // cliente com coordenada gerada: o ERP sem coordenada não a apaga
      await entregar(
        {},
        async (q) => {
          expect((await q(linha))[0]).toEqual({ lat: -3.7, lng: -60.7, coordenada_origem: 'geocodificacao', coordenada_precisao: 'rua' });
        },
        async (c) => {
          await c.query("insert into core.cliente (tenant_id, external_id, razao_social, latitude, longitude, coordenada_origem, coordenada_precisao) values ($1, 'C-T189', 'Mercado T189', -3.7, -60.7, 'geocodificacao', 'rua')", [A.tenantId]);
        },
      );
      // o ERP que manda coordenada nova vence a gerada
      await entregar(
        { latitude: -3.9, longitude: -60.9 },
        async (q) => {
          expect((await q(linha))[0]).toEqual({ lat: -3.9, lng: -60.9, coordenada_origem: 'erp', coordenada_precisao: null });
        },
        async (c) => {
          await c.query("insert into core.cliente (tenant_id, external_id, razao_social, latitude, longitude, coordenada_origem, coordenada_precisao) values ($1, 'C-T189', 'Mercado T189', -3.7, -60.7, 'geocodificacao', 'rua')", [A.tenantId]);
        },
      );
      // a coordenada que veio do ERP e sumiu do payload some também (o ERP é a fonte)
      await entregar(
        {},
        async (q) => {
          expect((await q(linha))[0]).toEqual({ lat: null, lng: null, coordenada_origem: null, coordenada_precisao: null });
        },
        async (c) => {
          await c.query("insert into core.cliente (tenant_id, external_id, razao_social, latitude, longitude, coordenada_origem) values ($1, 'C-T189', 'Mercado T189', -3.5, -60.5, 'erp')", [A.tenantId]);
        },
      );
    });
  });
});
