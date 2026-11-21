/**
 * T-0191 (v1.0.19) — Rotas do vendedor no BKO: endereço base, criar por proximidade (prévia e lote) e "Gerar coordenada",
 * com a API REAL (createApp × Postgres como macuxi_app × fixture dois-tenants; login, perfis, licenças e RLS de verdade).
 * O "Gerar coordenada" usa a implementação Nominatim REAL do platform-sdk (`geocodificadorDoAmbiente`, a mesma do `servidor.ts`)
 * apontada por `MACUXI_NOMINATIM_URL` para um servidor http LOCAL simulado (apoio/nominatim-falso.ts): fila de 1 req/s, cache,
 * User-Agent e log de verdade. O Nominatim público nunca é chamado.
 * Matriz: docs/testes/T-0191.md. Regras: RN-CORE-04, RN-CORE-75, RN-CORE-76, RN-CORE-77, RN-AUD-01.
 *
 * Convenção: `it` = vale hoje; `it.fails` = defeito aberto (o caso diz o que falta; quando corrigir, fica vermelho e vira `it`). D1, D4, D8 e o defeito c corrigidos em 21/11/2026.
 */
import { ehFeriado } from '@macuxi/comum/calendar';
import { CoordenadasSugeridasSchema, PreviaRotaRespostaSchema, RotasListaSchema, type PreviaRotaResposta, type SalvarRotasLote } from '@macuxi/core/contracts';
import { routeDistanceKm } from '../../../modules/core/domain';
import { semBanco } from '@macuxi/db/teste/estado';
import { geocodificadorDoAmbiente } from '@macuxi/platform-sdk/geocodificador-nominatim';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { A, B, erroDe, subirApi, type ApiDeTeste } from '../apoio/api';
import { itemCep, itemCidade, itemNumero, itemRua, subirNominatimFalso, type NominatimFalso, type RespostaNominatim } from '../apoio/nominatim-falso';

const U = A.usuarios;
const id = (n: number) => `0f191000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const DIA_MS = 86_400_000;
const somarDias = (data: string, n: number) => new Date(Date.parse(`${data}T12:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);
const dow = (data: string) => new Date(`${data}T12:00:00Z`).getUTCDay();
const HOJE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Manaus' }).format(new Date()); // hora-fixa-ok: a API data no relógio real; as semanas ficam a mais de 400 dias
/** Segunda-feira a partir de `inicio` cuja semana (seg a sáb) atende `ok`. */
function segunda(inicio: string, ok: (dias: string[]) => boolean): string {
  let seg = somarDias(inicio, (8 - dow(inicio)) % 7);
  while (!ok(Array.from({ length: 6 }, (_, i) => somarDias(seg, i)))) seg = somarDias(seg, 7);
  return seg;
}
/** Semana limpa (seg a sáb sem feriado nacional) a mais de 400 dias: o calendário não interfere. */
const SEMANA = segunda(somarDias(HOJE, 400), (d) => !d.some((x) => ehFeriado(x)));
const DIA = (n: number) => somarDias(SEMANA, n); // 0 = segunda … 5 = sábado
/** Outra semana limpa, só para o lote (a prévia da SEMANA continua sem rota). */
const SEMANA_LOTE = segunda(somarDias(SEMANA, 14), (d) => !d.some((x) => ehFeriado(x)));
const DL = (n: number) => somarDias(SEMANA_LOTE, n);
/** Semana com feriado NACIONAL de terça a quinta (calendário). */
const SEMANA_FERIADO = segunda(somarDias(HOJE, 400), (d) => d.slice(1, 4).some((x) => ehFeriado(x)) && !d.slice(4).some((x) => ehFeriado(x)) && !ehFeriado(d[0]!));

/** Base e clientes em Manaus. */
const CASA = { cep: '69053-000', logradouro: 'Rua das Palmeiras T191', numero: '100', bairro: 'Bairro Casa T191', cidade: 'Manaus', uf: 'am', lat: -3.1, lng: -60.0 };
const OUTRO = { cep: '69010000', logradouro: 'Avenida Outra Base T191', numero: '5', bairro: 'Centro', cidade: 'Manaus', uf: 'AM', lat: -3.3, lng: -60.3 };
/** 8 clientes com coordenada na carteira do vendedor-1 (perto da base). */
const COM = Array.from({ length: 8 }, (_, i) => ({ id: id(10 + i), lat: -3.1 - (i + 1) * 0.011, lng: -60.0 - (i % 3) * 0.013 }));
/** Clientes sem coordenada (carteira do vendedor-2), um endereço por caso do Gerar coordenada. */
const G = {
  numero: { id: id(40), logradouro: 'Rua Quinze T191', numero: '10', cep: '69005110' },
  mesmoEndereco: { id: id(41), logradouro: 'rua  quinze t191', numero: '10', cep: '69005-110' }, // mesmo endereço escrito de outro jeito
  semResultado: { id: id(42), logradouro: 'Rua Sem Resultado T191', numero: '20', cep: '69005120' },
  rua: { id: id(43), logradouro: 'Avenida Via Larga T191', numero: 'S/N', cep: '69005130' },
  cep: { id: id(44), logradouro: 'Rua Sem Resultado Dois T191', numero: '30', cep: '69005140' },
  cidade: { id: id(45), logradouro: 'Rua Cidade Apenas T191', numero: '40', cep: '69000000' },
  caiu: { id: id(46), logradouro: 'Rua Servico Fora T191', numero: '50', cep: '69005160' },
  outroTenant: { id: id(47), logradouro: 'Rua Do Outro Tenant T191', numero: '60', cep: '69005170' },
  doErp: { id: id(48), logradouro: 'Rua Com Coordenada T191', numero: '70', cep: '69005180' },
  /** Defeito c: sem rua e com CEP incompleto — a tela não mostra o botão e a API não chama o serviço. */
  cepIncompleto: { id: id(49), logradouro: null, numero: null, cep: '123' },
} as const;
/** Todo texto de endereço usado aqui: nenhum pode aparecer no log (RN-CORE-77). */
const TEXTOS_DE_ENDERECO = ['Palmeiras', 'Bairro Casa', 'Outra Base', 'Quinze', 'quinze', 'Sem Resultado', 'Via Larga', 'Cidade Apenas', 'Servico Fora', 'Do Outro Tenant', '69005', '69053', '69010', 'Rua+', 'Rua%20'];

function respostaDoSimulado(p: Record<string, string>): RespostaNominatim {
  const rua = (p.street ?? '').toLowerCase();
  if (rua.includes('quinze')) return { corpo: [itemNumero(-3.123456789, -60.0198766)] };
  if (rua.includes('via larga')) return { corpo: [itemRua(-3.14, -60.03)] };
  if (rua.includes('cidade apenas')) return { corpo: [itemCidade(-3.1, -60.02)] };
  if (rua.includes('servico fora')) return { status: 500 };
  if (p.postalcode === '69005-140') return { corpo: [itemCep(-3.15, -60.04)] };
  return { corpo: [] };
}

describe.skipIf(semBanco())('T-0191 — rotas por proximidade, base e Gerar coordenada (createApp real × Postgres × Nominatim simulado)', () => {
  let api: ApiDeTeste;
  let nominatim: NominatimFalso;
  const logs: string[] = [];
  /** `Date.now()` de cada requisição ao sair para o Nominatim simulado (o relógio da fila de produção). */
  const saidas: number[] = [];
  const tk = { admin: '', analista: '', gerente: '', supervisor: '', vendedor: '', promotor: '', adminB: '' };

  const chamar = (token: string, method: 'GET' | 'PUT' | 'POST', url: string, payload?: unknown) => api.chamar(token, { method, url: `/v1/core/${url}`, ...(payload !== undefined ? { payload: payload as object } : {}) });
  const previa = async (token: string, corpo: { usuario_id: string; de: string; ate: string; modo?: 'so_vazios' | 'substituir' }): Promise<PreviaRotaResposta> => {
    const r = await chamar(token, 'POST', 'rotas/previa', corpo);
    expect(r.statusCode, r.body).toBe(200);
    return PreviaRotaRespostaSchema.parse(r.json());
  };
  const loteDaPrevia = (p: PreviaRotaResposta, usuario_id: string, modo: 'so_vazios' | 'substituir', base: number): SalvarRotasLote => ({
    usuario_id,
    modo,
    rotas: p.dias.map((d, i) => ({ id: id(base + i), data: d.data, paradas: d.paradas.map((x) => ({ cliente_id: x.cliente_id })) })),
  });
  const q = async <R extends Record<string, unknown>>(sql: string, v: unknown[] = []) => (await api.admin.query<R>(sql, v)).rows;
  const rotasDe = (usuario: string, de: string, ate: string) =>
    q<{ id: string; data: string; origem: string; paradas: number }>(
      `select r.id::text, to_char(r.data, 'YYYY-MM-DD') as data, r.origem, (select count(*)::int from core.rota_parada p where p.rota_id = r.id and p.deleted_at is null) as paradas
         from core.rota r where r.usuario_id = $1 and r.deleted_at is null and r.data between $2::date and $3::date order by r.data`,
      [usuario, de, ate],
    );
  const cliente = async (cid: string) =>
    (
      await q<{ lat: number | null; lng: number | null; coordenada_origem: string | null; coordenada_precisao: string | null; geocodificacao_chave: string | null; geocodificacao_tentada_em: Date | null }>(
        'select latitude::float8 as lat, longitude::float8 as lng, coordenada_origem, coordenada_precisao, geocodificacao_chave, geocodificacao_tentada_em from core.cliente where id = $1',
        [cid],
      )
    )[0]!;
  /** Clientes da carteira do vendedor-1 com coordenada: os 8 daqui e os da fixture (c1). */
  const carteiraComPonto = async (usuario = U.vendedor1) =>
    (
      await q<{ id: string }>(
        'select distinct c.id::text from core.carteira k join core.cliente c on c.id = k.cliente_id where k.usuario_id = $1 and k.deleted_at is null and c.deleted_at is null and c.ativo and c.latitude is not null and c.longitude is not null order by 1',
        [usuario],
      )
    ).map((x) => x.id);
  const gerar = (token: string, cid: string) => chamar(token, 'POST', `clientes/${cid}/coordenada/gerar`);
  const parametro = (chave: string, valor: unknown, tenant = A.tenantId) =>
    q(
      `insert into plataforma.parametro (tenant_id, modulo, chave, valor) values ($1, 'core', $2, $3::jsonb)
       on conflict (tenant_id, modulo, chave) where deleted_at is null do update set valor = excluded.valor`,
      [tenant, chave, JSON.stringify(valor)],
    );
  const tirarParametro = (chave: string) => q("delete from plataforma.parametro where tenant_id = $1 and modulo = 'core' and chave = $2", [A.tenantId, chave]);

  beforeAll(async () => {
    nominatim = await subirNominatimFalso(respostaDoSimulado);
    // RN-CORE-77: intervalo medido na saída (ver `saidas`).
    const ambiente = geocodificadorDoAmbiente(
      { MACUXI_NOMINATIM_URL: nominatim.url },
      {
        buscar: (url, init) => {
          saidas.push(Date.now());
          return globalThis.fetch(url, init);
        },
      },
    );
    const destino = new Writable({
      write(pedaco, _c, fim) {
        logs.push(String(pedaco));
        fim();
      },
    });
    api = await subirApi({ logger: { level: 'info', stream: destino }, geocodificador: (log) => ambiente.criar(log) });
    tk.admin = (await api.sessao('admin@exemplo.com.br')).access_token;
    tk.analista = (await api.sessao('analista@exemplo.com.br')).access_token;
    tk.gerente = (await api.sessao('gerente@exemplo.com.br')).access_token;
    tk.supervisor = (await api.sessao('supervisor@exemplo.com.br')).access_token;
    tk.vendedor = (await api.sessao('vendedor@exemplo.com.br')).access_token;
    tk.promotor = (await api.sessao('promotor@exemplo.com.br')).access_token;
    tk.adminB = (await api.sessao('admin.b@exemplo.com.br', B)).access_token;

    for (const [i, c] of COM.entries()) {
      await q(
        "insert into core.cliente (id, tenant_id, razao_social, nome_fantasia, cidade, uf, latitude, longitude, coordenada_origem) values ($1, $2, $3, $3, 'Manaus', 'AM', $4, $5, 'erp')",
        [c.id, A.tenantId, `Cliente T191 ${i + 1}`, c.lat, c.lng],
      );
      await q("insert into core.carteira (id, tenant_id, cliente_id, usuario_id, papel) values ($1, $2, $3, $4, 'vendedor')", [id(100 + i), A.tenantId, c.id, U.vendedor1]);
    }
    for (const [k, g] of Object.entries(G)) {
      const tenant = k === 'outroTenant' ? B.tenantId : A.tenantId;
      const comCoordenada = k === 'doErp';
      await q(
        `insert into core.cliente (id, tenant_id, razao_social, nome_fantasia, logradouro, numero, bairro, cidade, uf, cep, latitude, longitude, coordenada_origem)
         values ($1, $2, $3, $3, $4, $5, 'Centro', 'Manaus', 'AM', $6, $7, $8, $9)`,
        [g.id, tenant, `Cliente T191 ${k}`, g.logradouro, g.numero, g.cep, comCoordenada ? -3.2 : null, comCoordenada ? -60.1 : null, comCoordenada ? 'erp' : null],
      );
      if (tenant === A.tenantId) await q("insert into core.carteira (id, tenant_id, cliente_id, usuario_id, papel) values ($1, $2, $3, $4, 'vendedor')", [id(200 + Number(g.id.slice(-2))), A.tenantId, g.id, U.vendedor2]);
    }
  });
  afterAll(async () => {
    await api?.fechar();
    await nominatim?.fechar();
  });

  // ---------------------------------------------------------------- critério 8: permissões, escopo e tenant
  describe('critério 8 — perfil sem a ação = 403, fora do escopo = 404, outro tenant = 404 (RLS)', () => {
    it('RN-CORE-76/77: supervisor, vendedor e promotor recebem 403 PERFIL_SEM_ACESSO na prévia, no lote, na base e no Gerar coordenada', async () => {
      const corpoPrevia = { usuario_id: U.vendedor1, de: DIA(0), ate: DIA(5) };
      const corpoLote = { usuario_id: U.vendedor1, rotas: [{ id: id(900), data: DIA(0), paradas: [{ cliente_id: COM[0]!.id }] }] };
      for (const t of [tk.supervisor, tk.vendedor, tk.promotor]) {
        for (const [m, url, corpo] of [
          ['POST', 'rotas/previa', corpoPrevia],
          ['POST', 'rotas/lote', corpoLote],
          ['PUT', `usuarios/${U.vendedor1}/base`, { tipo: 'outro', endereco: OUTRO }],
          ['GET', `usuarios/${U.vendedor1}/base`, undefined],
          ['POST', `clientes/${G.numero.id}/coordenada/gerar`, undefined],
        ] as const) {
          const r = await chamar(t, m, url, corpo);
          expect(r.statusCode, `${m} ${url}: ${r.body}`).toBe(403);
          expect(erroDe(r).codigo).toBe('PERFIL_SEM_ACESSO');
        }
      }
      // gerente edita rota, mas não aprova coordenada (cliente.aprovar_coordenada = analista e admin)
      const g = await gerar(tk.gerente, G.numero.id);
      expect(g.statusCode, g.body).toBe(403);
      // casa do cadastro: usuario.editar (o vendedor não edita)
      const casa = await chamar(tk.vendedor, 'PUT', `usuarios/${U.vendedor1}/endereco`, { endereco: CASA });
      expect(casa.statusCode, casa.body).toBe(403);
      expect(await rotasDe(U.vendedor1, DIA(0), DIA(5))).toEqual([]);
      expect(nominatim.requisicoes).toHaveLength(0);
      expect((await cliente(G.numero.id)).geocodificacao_tentada_em).toBeNull();
    });

    it('RN-CORE-04: vendedor fora da equipe do gerente = 404 na base, na prévia e no lote (nada gravado)', async () => {
      // vendedor-2 sai da regional do gerente para uma equipe sem pai (o gerente deixa de vê-lo)
      const fora = id(950);
      await q("insert into core.equipe (id, tenant_id, nome) values ($1, $2, 'Equipe fora T191')", [fora, A.tenantId]);
      const [{ equipe_id: antes }] = (await q<{ equipe_id: string }>('select equipe_id::text from core.usuario where id = $1', [U.vendedor2])) as [{ equipe_id: string }];
      await q('update core.usuario set equipe_id = $2 where id = $1', [U.vendedor2, fora]);
      try {
        const casos = [
          await chamar(tk.gerente, 'GET', `usuarios/${U.vendedor2}/base`),
          await chamar(tk.gerente, 'PUT', `usuarios/${U.vendedor2}/base`, { tipo: 'outro', endereco: OUTRO }),
          await chamar(tk.gerente, 'POST', 'rotas/previa', { usuario_id: U.vendedor2, de: DIA(0), ate: DIA(5) }),
          await chamar(tk.gerente, 'POST', 'rotas/lote', { usuario_id: U.vendedor2, rotas: [{ id: id(901), data: DIA(0), paradas: [{ cliente_id: G.numero.id }] }] }),
        ];
        for (const r of casos) expect(r.statusCode, r.body).toBe(404);
        // o admin (escopo da empresa) alcança o mesmo vendedor: o 404 é do escopo, não do usuário
        expect((await chamar(tk.admin, 'GET', `usuarios/${U.vendedor2}/base`)).statusCode).toBe(200);
        expect(await rotasDe(U.vendedor2, DIA(0), DIA(5))).toEqual([]);
        expect((await q<{ base_tipo: string | null }>('select base_tipo from core.usuario where id = $1', [U.vendedor2]))[0]!.base_tipo).toBeNull();
      } finally {
        await q('update core.usuario set equipe_id = $2 where id = $1', [U.vendedor2, antes]);
      }
    });

    it('RN-CORE-05: o admin do outro tenant não lê nem grava base, prévia, lote nem coordenada do tenant A (404, nada vaza nem grava)', async () => {
      const casos = [
        await chamar(tk.adminB, 'GET', `usuarios/${U.vendedor1}/base`),
        await chamar(tk.adminB, 'PUT', `usuarios/${U.vendedor1}/base`, { tipo: 'outro', endereco: OUTRO }),
        await chamar(tk.adminB, 'PUT', `usuarios/${U.vendedor1}/endereco`, { endereco: CASA }),
        await chamar(tk.adminB, 'POST', 'rotas/previa', { usuario_id: U.vendedor1, de: DIA(0), ate: DIA(5) }),
        await chamar(tk.adminB, 'POST', 'rotas/lote', { usuario_id: U.vendedor1, rotas: [{ id: id(902), data: DIA(0), paradas: [{ cliente_id: COM[0]!.id }] }] }),
        await gerar(tk.adminB, G.numero.id),
      ];
      for (const r of casos) {
        expect(r.statusCode, r.body).toBe(404);
        expect(r.body).not.toMatch(/Palmeiras|Quinze|Vendedor Um/);
      }
      expect(await rotasDe(U.vendedor1, DIA(0), DIA(5))).toEqual([]);
      expect((await q<{ base_tipo: string | null; casa_cep: string | null }>('select base_tipo, casa_cep from core.usuario where id = $1', [U.vendedor1]))[0]).toEqual({ base_tipo: null, casa_cep: null });
      expect((await cliente(G.numero.id)).geocodificacao_tentada_em).toBeNull();
      expect(nominatim.requisicoes).toHaveLength(0);
      // e o A também não alcança o cliente do B
      const r = await gerar(tk.admin, G.outroTenant.id);
      expect(r.statusCode, r.body).toBe(404);
      expect(nominatim.requisicoes).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------- critérios 3 e 4: base, prévia e valor × regra
  describe('critérios 3 e 4 — base, prévia (não grava) e valor × regra dos números', () => {
    it('RN-CORE-75/76: sem base, a prévia não traz base e o km de cada dia conta do 1º cliente (nenhum ponto fixo de Manaus)', async () => {
      const p = await previa(tk.gerente, { usuario_id: U.vendedor1, de: DIA(0), ate: DIA(5) });
      expect(p.base).toBeNull();
      expect(p.dias.length).toBeGreaterThan(0);
      for (const d of p.dias) {
        const pontos = d.paradas.map((x) => ({ lat: x.lat, lng: x.lng }));
        expect(d.km, d.data).toBe(routeDistanceKm(pontos[0]!, pontos));
      }
    });

    it('RN-CORE-75: base e casa só para vendedor e promotor — supervisor e gerente = 422 USUARIO_SEM_ENDERECO, nada gravado', async () => {
      for (const alvo of [U.supervisor, U.gerente]) {
        const base = await chamar(tk.admin, 'PUT', `usuarios/${alvo}/base`, { tipo: 'outro', endereco: OUTRO });
        expect(base.statusCode, base.body).toBe(422);
        expect(erroDe(base).codigo).toBe('USUARIO_SEM_ENDERECO');
        const casa = await chamar(tk.admin, 'PUT', `usuarios/${alvo}/endereco`, { endereco: CASA });
        expect(casa.statusCode, casa.body).toBe(422);
        expect(erroDe(casa).codigo).toBe('USUARIO_SEM_ENDERECO');
      }
      const linhas = await q<{ base_tipo: string | null; casa_cep: string | null }>('select base_tipo, casa_cep from core.usuario where id = any($1::uuid[])', [[U.supervisor, U.gerente]]);
      expect(linhas).toEqual([
        { base_tipo: null, casa_cep: null },
        { base_tipo: null, casa_cep: null },
      ]);
      // o promotor tem base (mesma regra do vendedor)
      const prom = await chamar(tk.admin, 'PUT', `usuarios/${U.promotor}/base`, { tipo: 'outro', endereco: OUTRO });
      expect(prom.statusCode, prom.body).toBe(200);
    });

    it('RN-CORE-75: casa no cadastro (admin, usuario.editar) e base Casa (gerente, rota.editar); GET rotas devolve a base do vendedor; auditoria sem endereço', async () => {
      const semPonto = await chamar(tk.gerente, 'PUT', `usuarios/${U.vendedor1}/base`, { tipo: 'casa' });
      expect(semPonto.statusCode, semPonto.body).toBe(422);
      expect(erroDe(semPonto).codigo).toBe('BASE_SEM_PONTO');
      const casa = await chamar(tk.admin, 'PUT', `usuarios/${U.vendedor1}/endereco`, { endereco: CASA });
      expect(casa.statusCode, casa.body).toBe(200);
      expect(casa.json()).toEqual({ endereco: { ...CASA, cep: '69053000', uf: 'AM' } });
      const base = await chamar(tk.gerente, 'PUT', `usuarios/${U.vendedor1}/base`, { tipo: 'casa' });
      expect(base.statusCode, base.body).toBe(200);
      expect(base.json()).toMatchObject({ tipo: 'casa', lat: CASA.lat, lng: CASA.lng, logradouro: CASA.logradouro });
      // a tela Rotas recebe a base pelo GET rotas (o mapa troca o CD pela Base)
      await q("insert into core.rota (id, tenant_id, usuario_id, data, situacao, origem) values ($1, $2, $3, $4, 'planejada', 'bko')", [id(960), A.tenantId, U.vendedor1, DIA(5)]);
      const lista = RotasListaSchema.parse((await chamar(tk.gerente, 'GET', `rotas?usuario_id=${U.vendedor1}&de=${DIA(5)}&ate=${DIA(5)}`)).json());
      // a base do GET rotas leva só o que o mapa usa: tipo, lat e lng (sem endereço)
      expect(lista.bases[U.vendedor1]).toEqual({ tipo: 'casa', lat: CASA.lat, lng: CASA.lng });
      const bruto = (await chamar(tk.gerente, 'GET', `rotas?usuario_id=${U.vendedor1}&de=${DIA(5)}&ate=${DIA(5)}`)).json() as { bases: Record<string, Record<string, unknown>> };
      expect(Object.keys(bruto.bases[U.vendedor1]!).sort()).toEqual(['lat', 'lng', 'tipo']);
      // o outro tenant não recebe a base do A
      const listaB = RotasListaSchema.parse((await chamar(tk.adminB, 'GET', `rotas?de=${DIA(5)}&ate=${DIA(5)}`)).json());
      expect(Object.keys(listaB.bases)).not.toContain(U.vendedor1);
      await q('delete from core.rota where id = $1', [id(960)]);
      const aud = await q<{ acao: string; antes: unknown; depois: unknown }>("select acao, antes, depois from plataforma.auditoria where entidade_id = $1 and acao in ('usuario.endereco_editar', 'usuario.base_editar')", [U.vendedor1]);
      expect(aud.map((a) => a.acao).sort()).toEqual(['usuario.base_editar', 'usuario.endereco_editar']);
      expect(JSON.stringify(aud)).not.toMatch(/Palmeiras|69053|Bairro Casa|-3\.1|-60/);
    });

    it('RN-CORE-76: a prévia não grava nada, traz a base, e cada dia conta o km a partir da base (ordem do optimizeRoute)', async () => {
      const antes = await q<{ n: number }>('select count(*)::int as n from core.rota');
      const p = await previa(tk.gerente, { usuario_id: U.vendedor1, de: DIA(0), ate: DIA(5) });
      expect((await q<{ n: number }>('select count(*)::int as n from core.rota'))[0]!.n).toBe(antes[0]!.n);
      expect(p.base).toMatchObject({ tipo: 'casa', lat: CASA.lat, lng: CASA.lng });
      const base = { lat: CASA.lat, lng: CASA.lng };
      for (const d of p.dias) {
        const pontos = d.paradas.map((x) => ({ lat: x.lat, lng: x.lng }));
        expect(d.km, d.data).toBe(routeDistanceKm(base, pontos));
        // vizinho mais próximo: a 1ª parada é a mais perto da base no dia
        const dist = (x: { lat: number; lng: number }) => Math.hypot(x.lat - base.lat, x.lng - base.lng);
        expect(dist(pontos[0]!)).toBe(Math.min(...pontos.map(dist)));
      }
      // todos os clientes da carteira com coordenada entram (limite padrão 11) e nenhum dia é domingo
      expect(p.dias.flatMap((d) => d.paradas.map((x) => x.cliente_id)).sort()).toEqual(await carteiraComPonto());
      expect(await carteiraComPonto()).toEqual(expect.arrayContaining(COM.map((c) => c.id)));
      expect(p.dias.every((d) => dow(d.data) !== 0)).toBe(true);
    });

    it('valor × regra: "N rotas · N visitas · N km" do cabeçalho = a soma dos dias da prévia (rotas = dias com parada, visitas = Σ paradas, km = Σ km inteiro das linhas)', async () => {
      const p = await previa(tk.gerente, { usuario_id: U.vendedor1, de: DIA(0), ate: DIA(5) });
      const comParada = p.dias.filter((d) => d.paradas.length > 0);
      expect(p.totais.rotas).toBe(comParada.length);
      expect(p.dias.every((d) => d.visitas === d.paradas.length)).toBe(true);
      expect(p.totais.visitas).toBe(comParada.reduce((s, d) => s + d.paradas.length, 0));
      // D2: o km do cabeçalho é a soma do km inteiro que cada linha mostra (formatKm(d.km, 0))
      expect(p.totais.km).toBe(comParada.reduce((s, d) => s + Math.round(d.km), 0));
      expect(p.totais.visitas).toBe((await carteiraComPonto()).length);
    });
  });

  // ---------------------------------------------------------------- calendário e limite (critério 5 pela API)
  describe('critério 5 pela API — calendário com feriado e limite visitas_dia', () => {
    it('RN-CORE-76 (D3): semana útil do tenant seg–sex, feriado nacional e feriado do tenant ficam fora e aparecem em "feriados"; domingo nunca', async () => {
      const dias = Array.from({ length: 7 }, (_, i) => somarDias(SEMANA_FERIADO, i));
      const nacional = dias.find((d) => ehFeriado(d))!;
      const doTenant = dias.find((d) => !ehFeriado(d) && dow(d) >= 1 && dow(d) <= 5 && d !== nacional)!;
      await parametro('metas.dias_uteis_semana', [1, 2, 3, 4, 5]);
      await parametro('metas.feriados', [doTenant]);
      try {
        const p = await previa(tk.gerente, { usuario_id: U.vendedor1, de: dias[0]!, ate: dias[6]! });
        const usados = p.dias.map((d) => d.data);
        expect(usados).not.toContain(nacional);
        expect(usados).not.toContain(doTenant);
        expect(usados.some((d) => dow(d) === 6 || dow(d) === 0)).toBe(false);
        expect([...p.feriados].sort()).toEqual([nacional, doTenant].sort());
        expect(usados.length).toBeLessThanOrEqual(3);
        // a tela recebe o mesmo calendário no GET rotas (lista de dias com feriado)
        const lista = RotasListaSchema.parse((await chamar(tk.gerente, 'GET', `rotas?usuario_id=${U.vendedor1}&de=${dias[0]}&ate=${dias[6]}`)).json());
        expect(lista.calendario).toEqual({ dias_uteis_semana: [1, 2, 3, 4, 5], feriados: [doTenant] });
      } finally {
        await tirarParametro('metas.dias_uteis_semana');
        await tirarParametro('metas.feriados');
      }
    });

    it('RN-CORE-76: dias passados não entram (período que já passou = prévia sem dias)', async () => {
      const ontem = somarDias(HOJE, -1);
      const p = await previa(tk.gerente, { usuario_id: U.vendedor1, de: somarDias(HOJE, -7), ate: ontem });
      expect(p.dias).toEqual([]);
      expect(p.totais).toEqual({ rotas: 0, visitas: 0, km: 0 });
    });

    it('RN-CORE-76 (D2): meta visitas_dia do vendedor = 1,0 → no máximo 1 visita por dia e o excedente em "não couberam"', async () => {
      const mes = HOJE.slice(0, 7);
      const r = await chamar(tk.admin, 'PUT', 'metas-produtividade', { escopo: 'usuario', usuario_id: U.vendedor1, vigencia_inicio: mes, metas: [{ indicador: 'visitas_dia', valor: 10 }] });
      expect(r.statusCode, r.body).toBe(200);
      try {
        const p = await previa(tk.gerente, { usuario_id: U.vendedor1, de: DIA(0), ate: DIA(5) });
        expect(p.dias.every((d) => d.paradas.length <= 1)).toBe(true);
        expect(p.dias).toHaveLength(6); // seg a sáb (padrão do tenant)
        const total = (await carteiraComPonto()).length;
        expect(p.fora_limite).toHaveLength(total - 6);
        expect(new Set([...p.dias.flatMap((d) => d.paradas.map((x) => x.cliente_id)), ...p.fora_limite.map((x) => x.cliente_id)]).size).toBe(total);
        expect(p.totais.visitas + p.fora_limite.length).toBe(total);
      } finally {
        await q("update core.meta_produtividade set deleted_at = now() where usuario_id = $1 and indicador = 'visitas_dia' and deleted_at is null", [U.vendedor1]);
      }
    });
  });

  // ---------------------------------------------------------------- critério 6: lote idempotente e protegidas
  describe('critério 6 — lote idempotente; Substituir nunca toca rota com visita nem do ERP', () => {
    it('RN-CORE-76: salvar duas vezes o mesmo lote não duplica rotas nem paradas (2ª = repetidas); origem bko; auditado', async () => {
      const p = await previa(tk.gerente, { usuario_id: U.vendedor1, de: DL(0), ate: DL(5) });
      const lote = loteDaPrevia(p, U.vendedor1, 'so_vazios', 300);
      const r1 = await chamar(tk.gerente, 'POST', 'rotas/lote', lote);
      expect(r1.statusCode, r1.body).toBe(200);
      expect(r1.json()).toEqual({ salvas: lote.rotas.length, repetidas: 0 });
      const r2 = await chamar(tk.gerente, 'POST', 'rotas/lote', lote);
      expect(r2.statusCode, r2.body).toBe(200);
      expect(r2.json()).toEqual({ salvas: lote.rotas.length, repetidas: lote.rotas.length });
      const gravadas = await rotasDe(U.vendedor1, DL(0), DL(5));
      expect(gravadas.map((g) => g.id).sort()).toEqual(lote.rotas.map((x) => x.id).sort());
      expect(gravadas.every((g) => g.origem === 'bko')).toBe(true);
      expect(gravadas.reduce((s, g) => s + g.paradas, 0)).toBe(p.totais.visitas);
      // a ordem gravada é a da prévia
      for (const d of p.dias) {
        const seq = await q<{ cliente_id: string }>('select cliente_id::text from core.rota_parada where rota_id = $1 and deleted_at is null order by sequencia', [lote.rotas.find((x) => x.data === d.data)!.id]);
        expect(seq.map((x) => x.cliente_id)).toEqual(d.paradas.map((x) => x.cliente_id));
      }
      const aud = await q<{ n: number }>("select count(*)::int as n from plataforma.auditoria where acao = 'rota.lote' and usuario_id = $1", [U.gerente]);
      expect(aud[0]!.n).toBe(2);
    });

    // D1 (corrigido; modulo-core, trava advisory no lote de modules/core/api/rotas-criar.ts): o envio concorrente voltava 500 (`rota_pkey`).
    it('D1 — RN-CORE-76: 4 envios do mesmo lote ao mesmo tempo (outro período) = 4 × 200, sem 500 e sem duplicar', async () => {
      const semana = segunda(somarDias(SEMANA_LOTE, 35), (d) => !d.some((x) => ehFeriado(x)));
      const p = await previa(tk.gerente, { usuario_id: U.vendedor1, de: semana, ate: somarDias(semana, 5) });
      expect(p.dias.length).toBeGreaterThan(0);
      const lote = loteDaPrevia(p, U.vendedor1, 'so_vazios', 700);
      const rs = await Promise.all([0, 1, 2, 3].map(() => chamar(tk.gerente, 'POST', 'rotas/lote', lote)));
      expect(rs.map((r) => r.statusCode), rs.map((r) => r.body).join(' | ')).toEqual([200, 200, 200, 200]);
      // exatamente um envio salva; os outros três voltam tudo repetido
      const corpos = rs.map((r) => r.json() as { salvas: number; repetidas: number });
      expect(corpos.filter((c) => c.repetidas === 0)).toHaveLength(1);
      expect(corpos.filter((c) => c.repetidas === lote.rotas.length)).toHaveLength(3);
      const gravadas = await rotasDe(U.vendedor1, semana, somarDias(semana, 5));
      expect(gravadas.map((g) => g.id).sort()).toEqual(lote.rotas.map((x) => x.id).sort());
      expect(gravadas.reduce((s, g) => s + g.paradas, 0)).toBe(p.totais.visitas);
      // e o reenvio depois (já sem corrida) é 200 com tudo repetido
      const r5 = await chamar(tk.gerente, 'POST', 'rotas/lote', lote);
      expect(r5.statusCode, r5.body).toBe(200);
      expect(r5.json()).toEqual({ salvas: lote.rotas.length, repetidas: lote.rotas.length });
    });

    it('RN-CORE-76 (D4): "só nos dias sem rota" mantém os dias com rota; "Substituir" troca só a do BKO sem visita; ERP e com visita = 422 ROTA_PROTEGIDA e o lote inteiro volta atrás', async () => {
      const semana = segunda(somarDias(SEMANA_LOTE, 21), (d) => !d.some((x) => ehFeriado(x)));
      const D = (n: number) => somarDias(semana, n);
      const [c1, c2, c3] = [COM[0]!.id, COM[1]!.id, COM[2]!.id];
      // seg: rota do ERP; ter: rota do BKO com visita feita; qua: rota do BKO sem visita
      for (const [n, origem, rid] of [[0, 'erp', id(500)], [1, 'bko', id(501)], [2, 'bko', id(502)]] as const) {
        await q("insert into core.rota (id, tenant_id, usuario_id, data, situacao, origem) values ($1, $2, $3, $4, 'planejada', $5)", [rid, A.tenantId, U.vendedor1, D(n), origem]);
        await q('insert into core.rota_parada (tenant_id, rota_id, usuario_id, data, cliente_id, sequencia) values ($1, $2, $3, $4, $5, 1)', [A.tenantId, rid, U.vendedor1, D(n), [c1, c2, c3][n]]);
      }
      await q(
        `insert into core.visita (id, tenant_id, usuario_id, cliente_id, data_local, checkin_em, checkout_em, resultado, fechada_por, sem_gps, fora_do_raio, sugere_coordenada, extra)
         values ($1, $2, $3, $4, $5::date, $5::date + interval '13 hours', $5::date + interval '14 hours', 'atendido', 'usuario', true, false, false, false)`,
        [id(510), A.tenantId, U.vendedor1, c2, D(1)],
      );

      const manter = await previa(tk.gerente, { usuario_id: U.vendedor1, de: D(0), ate: D(5) });
      expect(manter.mantidas.map((m) => [m.data, m.protegida])).toEqual([[D(0), true], [D(1), true], [D(2), false]]);
      expect(manter.dias.map((d) => d.data)).not.toContain(D(2));

      const trocar = await previa(tk.gerente, { usuario_id: U.vendedor1, de: D(0), ate: D(5), modo: 'substituir' });
      // só a do BKO sem visita (qua) sai das mantidas e volta como dia da prévia
      expect(trocar.mantidas.map((m) => m.data)).toEqual([D(0), D(1)]);
      expect(trocar.dias.map((d) => d.data)).toContain(D(2));

      // lote forjado com o dia do ERP no meio: 422 e nada gravado (nem os dias livres do mesmo lote)
      const forjado: SalvarRotasLote = {
        usuario_id: U.vendedor1,
        modo: 'substituir',
        rotas: [
          { id: id(520), data: D(2), paradas: [{ cliente_id: c3 }, { cliente_id: c1 }] },
          { id: id(521), data: D(3), paradas: [{ cliente_id: c2 }] },
          { id: id(522), data: D(0), paradas: [{ cliente_id: c3 }] },
        ],
      };
      const r = await chamar(tk.gerente, 'POST', 'rotas/lote', forjado);
      expect(r.statusCode, r.body).toBe(422);
      expect(erroDe(r).codigo).toBe('ROTA_PROTEGIDA');
      const comVisita = await chamar(tk.gerente, 'POST', 'rotas/lote', { ...forjado, rotas: [{ id: id(523), data: D(1), paradas: [{ cliente_id: c3 }] }] });
      expect(comVisita.statusCode, comVisita.body).toBe(422);
      expect(erroDe(comVisita).codigo).toBe('ROTA_PROTEGIDA');
      const depois = await rotasDe(U.vendedor1, D(0), D(5));
      expect(depois.map((x) => [x.id, x.data, x.origem, x.paradas])).toEqual([
        [id(500), D(0), 'erp', 1],
        [id(501), D(1), 'bko', 1],
        [id(502), D(2), 'bko', 1],
      ]);

      // o lote da prévia "substituir" grava: troca só a rota do BKO sem visita (quarta, D2); a do ERP (seg) e a com visita (ter) ficam
      const ok = await chamar(tk.gerente, 'POST', 'rotas/lote', loteDaPrevia(trocar, U.vendedor1, 'substituir', 530));
      expect(ok.statusCode, ok.body).toBe(200);
      const fim = await rotasDe(U.vendedor1, D(0), D(5));
      expect(fim.find((x) => x.data === D(0))).toMatchObject({ id: id(500), origem: 'erp', paradas: 1 });
      expect(fim.find((x) => x.data === D(1))).toMatchObject({ id: id(501), paradas: 1 });
      const paradasTer = await q<{ cliente_id: string }>('select cliente_id::text from core.rota_parada where rota_id = $1 and deleted_at is null', [id(501)]);
      expect(paradasTer.map((x) => x.cliente_id)).toEqual([c2]);
      const qua = trocar.dias.find((d) => d.data === D(2))!;
      const paradasQua = await q<{ cliente_id: string }>('select cliente_id::text from core.rota_parada where rota_id = $1 and deleted_at is null order by sequencia', [id(502)]);
      expect(paradasQua.map((x) => x.cliente_id)).toEqual(qua.paradas.map((x) => x.cliente_id));
    });

    it('RN-CORE-04/76: o servidor revalida o lote — cliente fora da carteira, feriado e dia passado são recusados (422; o dia = ROTA_DIA_INVALIDO) sem gravar', async () => {
      const fora = await chamar(tk.gerente, 'POST', 'rotas/lote', { usuario_id: U.vendedor1, rotas: [{ id: id(600), data: DIA(0), paradas: [{ cliente_id: G.numero.id }] }] });
      expect(fora.statusCode, fora.body).toBe(422);
      const nacional = Array.from({ length: 7 }, (_, i) => somarDias(SEMANA_FERIADO, i)).find((d) => ehFeriado(d))!;
      const feriado = await chamar(tk.gerente, 'POST', 'rotas/lote', { usuario_id: U.vendedor1, rotas: [{ id: id(601), data: nacional, paradas: [{ cliente_id: COM[0]!.id }] }] });
      expect(feriado.statusCode, feriado.body).toBe(422);
      expect(erroDe(feriado)).toMatchObject({ codigo: 'ROTA_DIA_INVALIDO' });
      const passado = await chamar(tk.gerente, 'POST', 'rotas/lote', { usuario_id: U.vendedor1, rotas: [{ id: id(602), data: somarDias(HOJE, -2), paradas: [{ cliente_id: COM[0]!.id }] }] });
      expect(passado.statusCode, passado.body).toBe(422);
      expect(erroDe(passado)).toMatchObject({ codigo: 'ROTA_DIA_INVALIDO' });
      expect(await q('select id from core.rota where id = any($1::uuid[])', [[id(600), id(601), id(602)]])).toEqual([]);
    });
  });

  // ---------------------------------------------------------------- Coordenadas sugeridas com o botão Gerar coordenada (R5)
  describe('R5 — Coordenadas sugeridas (a tela que leva o botão Gerar coordenada)', () => {
    it('RN-CORE-10: a fixture tem cliente sem coordenada com sugestão de check-in (c3), sem origem de coordenada', async () => {
      const r = await chamar(tk.analista, 'GET', 'coordenadas-sugeridas');
      expect(r.statusCode, r.body).toBe(200);
      const itens = (r.json() as { itens: Array<{ cliente_id: string }> }).itens;
      expect(itens.map((i) => i.cliente_id)).toContain(A.clientes.c3);
      expect((await cliente(A.clientes.c3)).coordenada_origem).toBeNull();
    });

    // D4 (corrigido; modulo-core, modules/core/api/rotas.ts: `geocodificada` deixava de ser booleano quando a origem é nula): a tela
    // Coordenadas sugeridas mostrava "Os dados chegaram num formato inesperado" (print 10 da 1ª rodada).
    it('D4 — RN-CORE-77: a resposta de GET coordenadas-sugeridas passa no contrato (geocodificada é booleano, nunca null)', async () => {
      const r = await chamar(tk.analista, 'GET', 'coordenadas-sugeridas');
      expect(r.statusCode, r.body).toBe(200);
      expect(CoordenadasSugeridasSchema.safeParse(r.json()).success, r.body.slice(0, 300)).toBe(true);
      const itens = (r.json() as { itens: Array<{ cliente_id: string; geocodificada?: unknown }> }).itens;
      for (const i of itens) expect(typeof i.geocodificada === 'boolean' || i.geocodificada === undefined, `${i.cliente_id}: ${String(i.geocodificada)}`).toBe(true);
      expect(itens.find((i) => i.cliente_id === A.clientes.c3)!.geocodificada ?? false).toBe(false);
    });
  });

  // ---------------------------------------------------------------- critério 7: Gerar coordenada
  describe('critério 7 — Gerar coordenada (Nominatim simulado, implementação real)', () => {
    it('RN-CORE-77: localizado com número grava a coordenada (origem geocodificacao, precisão), sai com User-Agent genérico e countrycodes=br', async () => {
      const antes = nominatim.requisicoes.length;
      const r = await gerar(tk.analista, G.numero.id);
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json()).toEqual({ cliente_id: G.numero.id, lat: -3.123457, lng: -60.019877, precisao: 'numero' });
      expect(await cliente(G.numero.id)).toMatchObject({ lat: -3.123457, lng: -60.019877, coordenada_origem: 'geocodificacao', coordenada_precisao: 'numero' });
      const novas = nominatim.requisicoes.slice(antes);
      expect(novas).toHaveLength(1);
      expect(novas[0]!.headers['user-agent']).toBe('MacuxiFDV/1.0');
      expect(novas[0]!.params).toMatchObject({ countrycodes: 'br', format: 'jsonv2', limit: '1', city: 'Manaus' });
      expect(novas[0]!.params.street).toContain('Quinze');
    });

    it('RN-CORE-77: o mesmo endereço (escrito de outro jeito, em outro cliente) sai do cache, sem nova requisição', async () => {
      const antes = nominatim.requisicoes.length;
      const r = await gerar(tk.admin, G.mesmoEndereco.id);
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json()).toMatchObject({ precisao: 'numero', lat: -3.123457 });
      expect(nominatim.requisicoes.length).toBe(antes);
    });

    it('RN-CORE-77: nunca sobrescreve — cliente que já tem coordenada (gerada ou do ERP) = 422 JA_TEM_COORDENADA, sem requisição', async () => {
      const antes = nominatim.requisicoes.length;
      for (const cid of [G.numero.id, G.doErp.id]) {
        const r = await gerar(tk.analista, cid);
        expect(r.statusCode, r.body).toBe(422);
        expect(erroDe(r).codigo).toBe('JA_TEM_COORDENADA');
      }
      expect(await cliente(G.doErp.id)).toMatchObject({ lat: -3.2, lng: -60.1, coordenada_origem: 'erp' });
      expect(nominatim.requisicoes.length).toBe(antes);
    });

    it('RN-CORE-77: fila de no máximo 1 requisição por segundo para toda a API (3 cliques ao mesmo tempo, 5 consultas, intervalo ≥ 1 s)', async () => {
      const antes = nominatim.requisicoes.length;
      const saidasAntes = saidas.length;
      const rs = await Promise.all([gerar(tk.analista, G.semResultado.id), gerar(tk.admin, G.rua.id), gerar(tk.analista, G.cep.id)]);
      const novas = nominatim.requisicoes.slice(antes);
      const t = saidas.slice(saidasAntes);
      // sem resultado: rua + CEP; via: só a rua; CEP: rua (vazia) + CEP
      expect(novas).toHaveLength(5);
      expect(t).toHaveLength(5);
      // Folga de 2 ms: Date.now trunca o ms e o setTimeout do Node pode disparar até 1 ms antes no relógio de parede.
      for (let i = 1; i < t.length; i++) expect(t[i]! - t[i - 1]!, `intervalo ${i}`).toBeGreaterThanOrEqual(998);
      expect(rs.map((r) => r.statusCode)).toEqual([422, 200, 200]);
      expect(erroDe(rs[0]!).codigo).toBe('NAO_LOCALIZADO');
      expect(rs[1]!.json()).toMatchObject({ precisao: 'rua' });
      expect(rs[2]!.json()).toMatchObject({ precisao: 'cep' });
      expect(novas.some((x) => x.params.postalcode === '69005-140')).toBe(true);
    }, 30_000);

    it('RN-CORE-77: não localizado grava só a tentativa; o 2º clique no mesmo endereço = 422 JA_TENTADO sem requisição; a prévia marca ja_tentado', async () => {
      const c = await cliente(G.semResultado.id);
      expect(c).toMatchObject({ lat: null, lng: null, coordenada_origem: null });
      expect(c.geocodificacao_chave).toMatch(/^[0-9a-f]{64}$/);
      const antes = nominatim.requisicoes.length;
      const r = await gerar(tk.analista, G.semResultado.id);
      expect(r.statusCode, r.body).toBe(422);
      expect(erroDe(r).codigo).toBe('JA_TENTADO');
      expect(nominatim.requisicoes.length).toBe(antes);
      const p = await previa(tk.admin, { usuario_id: U.vendedor2, de: DIA(0), ate: DIA(5) });
      const fora = new Map(p.fora_sem_coordenada.map((x) => [x.cliente_id, x]));
      expect(fora.get(G.semResultado.id)?.ja_tentado).toBe(true);
      expect(fora.get(G.cidade.id)?.ja_tentado).toBe(false);
      expect(fora.has(G.numero.id)).toBe(false); // ganhou coordenada: entrou na rota
      expect(p.dias.flatMap((d) => d.paradas.map((x) => x.cliente_id))).toContain(G.numero.id);
      // mudou o CEP: pode tentar de novo
      await q("update core.cliente set cep = '69005121' where id = $1", [G.semResultado.id]);
      const de2 = await gerar(tk.analista, G.semResultado.id);
      expect(de2.statusCode, de2.body).toBe(422);
      expect(erroDe(de2).codigo).toBe('NAO_LOCALIZADO');
      expect(nominatim.requisicoes.length).toBeGreaterThan(antes);
    }, 30_000);

    it('RN-CORE-77: resultado só da cidade = 422 NAO_LOCALIZADO (nada gravado na coordenada)', async () => {
      const r = await gerar(tk.analista, G.cidade.id);
      expect(r.statusCode, r.body).toBe(422);
      expect(erroDe(r).codigo).toBe('NAO_LOCALIZADO');
      expect(await cliente(G.cidade.id)).toMatchObject({ lat: null, lng: null, coordenada_origem: null, coordenada_precisao: null });
    }, 30_000);

    it('RN-CORE-77: serviço fora (500) = 503 GEOCODIFICADOR_INDISPONIVEL e a tentativa NÃO é gravada (o próximo clique tenta de novo)', async () => {
      const r = await gerar(tk.analista, G.caiu.id);
      expect(r.statusCode, r.body).toBe(503);
      expect(erroDe(r).codigo).toBe('GEOCODIFICADOR_INDISPONIVEL');
      expect(await cliente(G.caiu.id)).toMatchObject({ geocodificacao_chave: null, geocodificacao_tentada_em: null, lat: null });
      nominatim.definir((p) => ((p.street ?? '').includes('Servico Fora') ? { corpo: [itemNumero(-3.16, -60.05)] } : respostaDoSimulado(p)));
      const de2 = await gerar(tk.analista, G.caiu.id);
      expect(de2.statusCode, de2.body).toBe(200);
      nominatim.definir(respostaDoSimulado);
    }, 30_000);

    // Defeito c (corrigido; modulo-core, modules/core/api/rotas-criar.ts:341 com `enderecoPermiteGerar`): a API aceitava qualquer CEP não vazio
    // ("123") e chamava o serviço, enquanto a tela exige rua ou CEP de 8 dígitos para mostrar o botão.
    it('defeito c — RN-CORE-77: sem rua e com CEP incompleto = 422 NAO_LOCALIZADO "Sem rua nem CEP no cadastro.", sem requisição e sem tentativa gravada', async () => {
      const antes = nominatim.requisicoes.length;
      const r = await gerar(tk.analista, G.cepIncompleto.id);
      expect(r.statusCode, r.body).toBe(422);
      expect(erroDe(r)).toMatchObject({ codigo: 'NAO_LOCALIZADO', mensagem: 'Sem rua nem CEP no cadastro.' });
      expect(nominatim.requisicoes.length).toBe(antes);
      expect(await cliente(G.cepIncompleto.id)).toMatchObject({ lat: null, geocodificacao_chave: null, geocodificacao_tentada_em: null });
    });

    // D8 (corrigido em 21/11/2026; modulo-core): GET coordenadas-sugeridas passou a trazer `ja_tentado` (modules/core/api/rotas.ts:439,
    // contrato em modules/core/contracts/visita.ts:134) e coordenadas-page.tsx:78 passa `jaTentado` ao GerarCoordenada (print 10c).
    it('D8 — RN-CORE-77: GET coordenadas-sugeridas marca o cliente cujo endereço já foi tentado (a tela não oferece o botão de novo)', async () => {
      expect((await cliente(G.cidade.id)).geocodificacao_chave).toMatch(/^[0-9a-f]{64}$/);
      await q(
        `insert into core.visita (id, tenant_id, usuario_id, cliente_id, data_local, checkin_em, checkin_lat, checkin_lng, checkin_precisao_m, checkout_em, resultado, fechada_por, sem_gps, fora_do_raio, sugere_coordenada, extra)
         values ($1, $2, $3, $4, $5::date, $5::date + interval '13 hours', -3.111, -60.022, 18, $5::date + interval '14 hours', 'atendido', 'usuario', false, false, true, false)`,
        [id(530), A.tenantId, U.vendedor2, G.cidade.id, HOJE],
      );
      const r = await chamar(tk.admin, 'GET', 'coordenadas-sugeridas');
      expect(r.statusCode, r.body).toBe(200);
      const item = CoordenadasSugeridasSchema.parse(r.json()).itens.find((i) => i.cliente_id === G.cidade.id);
      expect(item).toBeDefined();
      expect(item).toMatchObject({ ja_tentado: true });
    });

    it('RN-CORE-77 e RN-AUD-01: a geração é auditada sem endereço; nenhum endereço, CEP ou URL do serviço aparece no log capturado da API', async () => {
      const aud = await q<{ antes: unknown; depois: unknown }>("select antes, depois from plataforma.auditoria where acao = 'cliente.gerar_coordenada'");
      expect(aud.length).toBeGreaterThanOrEqual(5);
      expect(JSON.stringify(aud)).not.toMatch(/Quinze|Resultado|Via Larga|69005|Manaus/);
      const texto = logs.join('');
      expect(texto).toMatch(/geocodifica/); // o log existe (origem, resultado, precisão)
      expect(texto).toMatch(/"geocodificacao":"cache"/);
      for (const t of TEXTOS_DE_ENDERECO) expect(texto, t).not.toContain(t);
      expect(texto).not.toContain(nominatim.url);
      expect(texto).not.toMatch(/-3\.12345|-60\.0198/); // nem a coordenada
    });
  });
});
