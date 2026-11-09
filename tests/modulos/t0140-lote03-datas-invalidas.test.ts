/**
 * T-0140 lote 03 — RD-0042 e RD-0034: as datas civis do Core e do Gestor passaram a usar o @macuxi/comum (`exigirDataCivil`,
 * `somarDiasCivis`), e data inválida agora lança erro. O que se prova aqui, sem banco (roda local e no CI):
 *  D1 domínio: a data inválida lança com mensagem em português (nada de "Invalid time value" nem data rolada em silêncio);
 *  D2 rotas do Gestor que recebem data do usuário (`GET equipe?data=`, `GET equipe/:id?data=`, `GET ranking?data=`): a data
 *     impossível tem de sair como erro 4xx com mensagem, como a API responderia, e não como 500 genérico (`ERRO_INTERNO`);
 *  D3 rotas do Core que recebem data do usuário (`GET rotas?de=&ate=`, `GET visitas?de=&ate=`): idem.
 * A classificação das exceções é a do `setErrorHandler` de `apps/api/src/app.ts`: `ErroHttpModulo` = status do módulo,
 * `ZodError` = 400 VALIDACAO, qualquer outra = 500 ERRO_INTERNO. A mesma conferência pela API real (createApp × Postgres) fica
 * em `tests/integracao/api/datas-invalidas-t0140.test.ts` (roda no CI).
 * Divergência = defeito: o caso fica em `it.fails` com o motivo e vira recado `pedido` ao dono; volta para `it` na correção.
 * Matriz: docs/testes/T-0140.md, seção "Lote 03".
 */
import { criarRelogio } from '@macuxi/comum/relogio';
import { ErroHttpModulo, type ContextoRota, type ModuloId, type Perfil, type RotaModulo } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import moduloApiCore from '../../modules/core/api';
import { tituloNaJanela } from '../../modules/core/app/lib/cliente360-local';
import { criarApiGestor, criarRepositorioEmMemoria } from '../../modules/gestor/api';
import { ehDiaUtil, instanteDoHorarioLocal } from '../../modules/gestor/domain/horario-comercial';
import { GERENTE, SUPERVISOR, u, VENDEDOR } from '../../modules/gestor/domain/fixtures';
import { painelDoMes } from '../../modules/gestor/domain/painel';
import { estadoInicial } from '../../modules/gestor/domain/projecao';
import { intervaloDoPeriodo } from '../../modules/gestor/domain/ranking';

const TENANT = u(9101);
const IMPOSSIVEIS = ['2026-02-30', '2026-13-01', '2026-11-31', '2026-00-10'];
const PORTUGUES = /Data inválida|data inválida|AAAA-MM-DD/;

type Resposta = { status: number; codigo?: string; mensagem?: string; corpo?: unknown };
/** O que a API responderia (apps/api/src/app.ts, setErrorHandler). */
async function comoApi(f: () => unknown): Promise<Resposta> {
  try {
    return { status: 200, corpo: await f() };
  } catch (e) {
    if (e instanceof ErroHttpModulo) return { status: e.status, codigo: e.codigo, mensagem: e.message };
    if (e instanceof ZodError) return { status: 400, codigo: 'VALIDACAO', mensagem: 'Dados inválidos.' };
    return { status: 500, codigo: 'ERRO_INTERNO', mensagem: `(${e instanceof Error ? `${e.name}: ${e.message}` : String(e)})` };
  }
}

function chamador(rotas: readonly RotaModulo[], o: { db?: (sql: string, valores: unknown[]) => unknown; consultar?: (def: { nome: string }, e: Record<string, unknown>) => unknown }) {
  const relogio = criarRelogio({ agora: '2026-11-10T15:00:00Z' });
  const sqls: { sql: string; valores: unknown[] }[] = [];
  const chamar = (metodo: string, caminho: string, quem: { id: string; perfil: Perfil }, q: { query?: unknown; params?: unknown } = {}) =>
    comoApi(() => {
      const r = rotas.find((x) => x.metodo === metodo && x.caminho === caminho);
      if (!r) throw new Error(`rota ${metodo} ${caminho} não existe`);
      const db = {
        query: async (sql: string, valores: unknown[] = []) => {
          sqls.push({ sql, valores });
          return (o.db?.(sql, valores) as { rows: unknown[] } | undefined) ?? { rows: [], rowCount: 0 };
        },
      };
      const tx = {
        consultar: async (def: { nome: string }, e: Record<string, unknown>) => o.consultar?.(def, e) ?? {},
        auditar: async () => undefined,
        publicar: async () => undefined,
      };
      const ctx = {
        usuario: { id: quem.id, tenant_id: TENANT, perfil: quem.perfil, modulos: ['core', 'gestor', 'vendedor', 'promotor', 'catalogo'] as ModuloId[] },
        dependencias: {},
        requestId: 'req-t0140',
        agora: () => relogio.agora(),
        comTenant: async <T,>(fn: (db: never, tx: never) => Promise<T>) => fn(db as never, tx as never),
        carteira: async () => 'tenant' as const,
        usuariosVisiveis: async () => new Set([quem.id, VENDEDOR, SUPERVISOR]),
        parametros: () => ({}),
        fuso: () => 'America/Manaus',
        log: { info: () => {}, warn: () => {}, error: () => {} },
        query: r.query ? r.query.parse(q.query ?? {}) : undefined,
        params: r.params ? r.params.parse(q.params ?? {}) : undefined,
        corpo: undefined,
      } as unknown as ContextoRota;
      return r.executar(ctx);
    });
  return { chamar, sqls };
}

const gestor = () => {
  const api = criarApiGestor(criarRepositorioEmMemoria());
  const cadastro = [
    { id: GERENTE, nome: 'Gilda', perfil: 'gerente' },
    { id: SUPERVISOR, nome: 'Sara', perfil: 'supervisor' },
    { id: VENDEDOR, nome: 'Vera', perfil: 'vendedor' },
  ];
  return chamador(api.rotas!, {
    consultar: (def, e) =>
      def.nome === 'core.calendario_metas@1'
        ? { dias_uteis_semana: [1, 2, 3, 4, 5, 6], feriados: [] }
        : { clientes: [], produtos: [], usuarios: cadastro.filter((c) => ((e.usuario_ids as string[] | undefined) ?? []).includes(c.id)).map((c) => ({ ...c, external_id: null })) },
  });
};

const aceita = (r: Resposta, onde: string) => {
  expect(r.status, `${onde}: ${r.mensagem ?? ''}`).toBe(200);
};
/** Data do usuário inválida: 4xx com código e mensagem (nunca 500 genérico nem 200 com a data rolada). */
const recusaComMensagem = (r: Resposta, onde: string) => {
  expect(r.status, `${onde} devolveu ${r.status} ${r.codigo ?? ''} ${r.mensagem ?? ''}`).toBeGreaterThanOrEqual(400);
  expect(r.status, `${onde} devolveu ${r.status} ${r.codigo ?? ''} ${r.mensagem ?? ''}`).toBeLessThan(500);
  expect(r.mensagem, onde).toBeTruthy();
};

describe('T-0140 lote 03 — D1: data civil inválida no domínio do Core e do Gestor lança com mensagem em português', () => {
  const cal = { fuso: 'America/Manaus', horario_comercial: { dias_semana: [1, 2, 3, 4, 5], inicio: '08:00', fim: '18:00' }, feriados: [] };

  it.each(IMPOSSIVEIS)('D1a. Gestor (RD-0034): ranking, dia útil e horário local recusam %s com "Data inválida … (use AAAA-MM-DD)"', (d) => {
    for (const tipo of ['diario', 'semanal', 'mensal'] as const) expect(() => intervaloDoPeriodo(tipo, d), tipo).toThrow(PORTUGUES);
    expect(() => ehDiaUtil(d, cal as never)).toThrow(PORTUGUES);
    expect(() => instanteDoHorarioLocal(d, '08:00', 'America/Manaus')).toThrow(PORTUGUES);
  });

  it('D1b. Gestor: datas válidas seguem iguais (virada de mês, ano bissexto, semana de segunda a domingo)', () => {
    expect(intervaloDoPeriodo('semanal', '2026-11-01')).toEqual({ inicio: '2026-10-26', fim: '2026-11-01' });
    expect(intervaloDoPeriodo('mensal', '2028-02-10')).toEqual({ inicio: '2028-02-01', fim: '2028-02-29' });
    expect(intervaloDoPeriodo('diario', '2026-12-31')).toEqual({ inicio: '2026-12-31', fim: '2026-12-31' });
  });

  it('D1c. Gestor: painel do mês com data impossível lança (antes da RD-0034 lançava; não pode rolar para o mês seguinte em silêncio)', () => {
    expect(() => painelDoMes(estadoInicial(), VENDEDOR, '2026-02-30')).toThrow(PORTUGUES);
  });

  it('D1d. Core (RD-0042): a janela do título com "hoje" mal formado lança em português (antes: "Invalid time value")', () => {
    expect(() => tituloNaJanela({ situacao: 'liquidado', vencimento: '2026-01-01' }, '2026-1-5')).toThrow(PORTUGUES);
    expect(tituloNaJanela({ situacao: 'liquidado', vencimento: '2026-08-12' }, '2026-11-10')).toBe(true);
    expect(tituloNaJanela({ situacao: 'liquidado', vencimento: '2026-08-11' }, '2026-11-10')).toBe(false);
  });
});

describe('T-0140 lote 03 — D2: rotas do Gestor com data do usuário (data impossível = 4xx com mensagem, nunca 500)', () => {
  it('D2a. data válida e data omitida respondem 200 (controle)', async () => {
    const g = gestor();
    aceita(await g.chamar('GET', 'equipe', { id: SUPERVISOR, perfil: 'supervisor' }, { query: { data: '2026-11-10' } }), 'equipe');
    aceita(await g.chamar('GET', 'equipe', { id: SUPERVISOR, perfil: 'supervisor' }), 'equipe sem data');
    aceita(await g.chamar('GET', 'ranking', { id: SUPERVISOR, perfil: 'supervisor' }, { query: { data: '2026-02-28', periodo: 'semanal' } }), 'ranking');
  });

  it('D2b. mal formada ("10/11/2026", "2026-1-5"): 400 VALIDACAO pelo contrato', async () => {
    const g = gestor();
    for (const data of ['10/11/2026', '2026-1-5']) {
      const r = await g.chamar('GET', 'equipe', { id: SUPERVISOR, perfil: 'supervisor' }, { query: { data } });
      expect(r).toMatchObject({ status: 400, codigo: 'VALIDACAO' });
    }
  });

  // D-T0140-L03a (modulo-gestor) CORRIGIDO (R-20261109-131923): equipe, Ficha e ranking respondem 422 DATA_INVALIDA com mensagem.
  it.each(IMPOSSIVEIS)('D2c. GET equipe?data=%s', async (data) => {
    recusaComMensagem(await gestor().chamar('GET', 'equipe', { id: SUPERVISOR, perfil: 'supervisor' }, { query: { data } }), `equipe?data=${data}`);
  });

  it.each(IMPOSSIVEIS)('D2d. GET equipe/:usuario_id?data=%s (Ficha)', async (data) => {
    recusaComMensagem(await gestor().chamar('GET', 'equipe/:usuario_id', { id: SUPERVISOR, perfil: 'supervisor' }, { query: { data }, params: { usuario_id: VENDEDOR } }), `ficha?data=${data}`);
  });

  it.each(IMPOSSIVEIS)('D2e. GET ranking?data=%s', async (data) => {
    recusaComMensagem(await gestor().chamar('GET', 'ranking', { id: SUPERVISOR, perfil: 'supervisor' }, { query: { data } }), `ranking?data=${data}`);
  });
});

describe('T-0140 lote 03 — D3: rotas do Core com data do usuário (data impossível = 4xx com mensagem, nunca 500)', () => {
  const core = () => chamador(moduloApiCore.rotas!, {});
  const quem = { id: SUPERVISOR, perfil: 'supervisor' as Perfil };

  it('D3a. datas válidas: a consulta vai ao banco com as datas do usuário (controle)', async () => {
    const c = core();
    aceita(await c.chamar('GET', 'rotas', quem, { query: { de: '2026-11-09', ate: '2026-11-15' } }), 'rotas');
    aceita(await c.chamar('GET', 'visitas', quem, { query: { de: '2026-11-09', ate: '2026-11-15' } }), 'visitas');
  });

  // D-T0140-L03b (modulo-core) CORRIGIDO em 09/11 (contratos rota.ts/visita.ts no lote; conferido aqui, 4 datas × 2 rotas). Histórico: o contrato (`Data` de rota.ts e visita.ts, só o formato) deixa passar a data
  // impossível. Mês 13 ou 00: no main o `somarDias` próprio de `modules/core/api/rotas.ts:35` lança 'Invalid time value' (500); com o
  // `somarDiasCivis` do comum (RD-0042, em andamento) a data rola (2026-13-01 → 2027-01-07) e vai ao SQL. Dia 30/02 ou
  // 31/11: a data vai ao SQL (`$1::date`), que no Postgres dá 22008 (500). Volta a `it` na correção.
  /** Recusa com mensagem E a data impossível não chega ao SQL (no Postgres, `$1::date` com '2026-02-30' = 22008 = 500). */
  const recusaSemIrAoBanco = async (rota: string, query: Record<string, string>, data: string) => {
    const c = core();
    const r = await c.chamar('GET', rota, quem, { query });
    const onde = `${rota}?${new URLSearchParams(query).toString()}`;
    expect(c.sqls.some((x) => x.valores.includes(data)), `${onde}: a data foi ao SQL (${r.status})`).toBe(false);
    recusaComMensagem(r, onde);
  };

  // Um caso por rota com as 4 datas (uma data pode ser recusada por acaso, ex.: 2026-00-10 → PERIODO_INVALIDO; só vale com as 4).
  it('D3b. GET rotas?de=<impossível> (sem ate)', async () => {
    for (const de of IMPOSSIVEIS) await recusaSemIrAoBanco('rotas', { de }, de);
  });

  it('D3c. GET visitas?ate=<impossível> (sem de)', async () => {
    for (const ate of IMPOSSIVEIS) await recusaSemIrAoBanco('visitas', { ate }, ate);
  });

  it('D3d. GET rotas?de=<impossível>&ate=<o mesmo dia> e visitas?de=…&ate=…', async () => {
    for (const d of IMPOSSIVEIS) {
      await recusaSemIrAoBanco('rotas', { de: d, ate: d }, d);
      await recusaSemIrAoBanco('visitas', { de: d, ate: d }, d);
    }
  });
});
