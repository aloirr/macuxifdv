/**
 * T-0107 (frente N14) — carga de 20 mil produtos com HTTP real (a API escuta numa porta local, `fetch` de verdade), contra o
 * `createApp` real (8 módulos de `MODULOS_API`, JWT, Postgres como `macuxi_app` com RLS, pool de 10 conexões como o padrão de
 * `MACUXI_API_POOL` do servidor), o despachante real da outbox (`macuxi_worker`) e a base gerada por tests/carga/t0107/
 * gerador.ts (semente fixa) gravada no tenant A da fixture dois-tenants (B fica como vizinho, RLS). Mede, nesta ordem:
 *
 *  1. sync inicial do catálogo em K aparelhos em paralelo (`/v1/sync/novidades` + `/v1/sync/pull` de cada entidade até o
 *     `proximo_cursor` nulo): duração total por aparelho (p95 vs meta) e latência por página (informativo);
 *  2. busca do catálogo (`/v1/catalogo/busca`, modo padrão `inteligente` SEM provedor de IA = regras locais sobre os 20 mil,
 *     como no servidor sem chave de IA) em rajada com concorrência fixa;
 *  3. 100 pedidos em paralelo (`/v1/sync/push`, 1 pedido por requisição, 3 vendedores, clientes das carteiras) com no máximo
 *     `MACUXI_CARGA_PEDIDOS_CONCORRENCIA` (padrão 5 = metade do pool) em voo — ver D-T0107a abaixo;
 *  4. retorno ao ERP pela fila: despachante → `GET /integracao/v1/pedidos/pendentes` até esvaziar → `POST .../retorno`
 *     `integrado` dos 100 → despachante → os 100 `integrated` em vendedor.pedido.
 *
 * O que REPROVA na suíte comum (convenção de tests/carga/fundacao.test.ts e sync-basico-t0078.test.ts): erro funcional —
 * status >= 400 ou falha de rede, sincronização incompleta (aparelho sem as 20 mil linhas, cliente fora da carteira, id
 * repetido entre páginas), busca por SKU que não acha o produto, pedido não aceito ou não aprovado, fila incompleta ou com
 * retenção, retorno recusado, pedido que não chega a `integrated`, evento com falha na outbox e `/v1/saude` com 5xx.
 * TEMPO só reprova com `MACUXI_CARGA_MEDIR=1` (job próprio, máquina sem outros testes; tests/plano/sprint-1.md, "Testes de
 * tempo"); os números saem SEMPRE no console, uma linha JSON por métrica com o prefixo `[carga T-0107]` (n, p50, p95, max,
 * meta). Os tetos de caso abaixo são folga de execução, não medida.
 *
 * Premissas (registradas no README desta pasta):
 *  - Tenant de teste = A (`DOIS_TENANTS.A`): já tem o Conector `erp-alfa` (recebe pedidos), a chave e o de-para AVISTA → 001.
 *  - Condição de pagamento: caminho LEGADO (sem forma/prazo no payload) → a padrão do tenant (AVISTA em A, `padrao = true`);
 *    os clientes da carga não têm `vendedor.cliente_condicao` (sem lista própria vale a padrão, RN-VEN-14). Nada a gravar.
 *  - Os external_id de cliente/vendedor/produto vêm do gerador (CLI-xxxxx, VEND-00n, ERP-<sku>): o pedido não fica retido.
 *  - Licença `integracao` ligada no tenant A pela rota real do Core; pepper do Hub = `PEPPER_HUB_FIXTURE` só neste processo.
 *  - O "ciclo da fila" roda o despachante em ciclos seguidos (sem o intervalo de 1 s do processo `worker`): mede o trabalho,
 *    não a espera do agendamento.
 *
 * D-T0107a (defeito ABERTO, caso 6 em `it.fails`): pedidos SIMULTÂNEOS em número >= pool da API travam o pool. O push abre a
 * transação do pedido (`ctx.comTenant` em modules/vendedor/api/receber.ts, `receberPedidos`) e, já dentro dela, chama
 * `ctx.carteira()` (apps/api/src/app.ts, `carteiraDe(token, acesso, …)`), que pede OUTRA conexão ao mesmo pool. Com 10 (= pool)
 * pushes em voo, as 10 conexões ficam "idle in transaction" esperando a 11ª, que nunca vem: sem `connectionTimeoutMillis` o
 * pool espera para sempre; no servidor (`idle_in_transaction_session_timeout=60000`) o Postgres derruba as sessões em 60 s e o
 * lote volta 5xx. Visto na 1ª rodada desta carga (100 pushes ao mesmo tempo: 10 sessões paradas no `select … from
 * vendedor.pedido where id = $1`, a consulta logo antes do `ctx.carteira()`). Por isso o caso 3 limita a concorrência e o
 * caso 6 reproduz os 100 ao mesmo tempo numa 2ª instância da API com `connectionTimeoutMillis` (falha em vez de travar).
 * Quando corrigir (ex.: resolver `ctx.carteira()` antes de abrir a transação), o caso 6 fica vermelho: vira `it` e o caso 3
 * pode voltar aos 100 ao mesmo tempo.
 *
 * D-T0107b (achado de TEMPO, não reprova a suíte comum): a busca carrega o catálogo INTEIRO do tenant a cada requisição
 * (modules/catalogo/api/rotas.ts `busca` → `repo.produtos()` + preços/saldos de todos os candidatos → `buscarProdutos` do
 * domain, ranking em memória). Com 20 mil produtos: ~0,7 s de SQL (40 mil atributos, 30 mil referências, 40 mil saldos) e
 * ~3-4 s de CPU do Node por busca, isolada (meta: 300 ms). Sendo CPU, a concorrência só enfileira no event loop (e atrasa as
 * outras rotas da mesma instância). Por isso o caso 2 tem orçamento de tempo e concorrência enxutos por padrão.
 *
 * Proibido: rodar contra a demo da VM ou produção; a URL é sempre a do servidor local que o próprio teste sobe.
 * Pula sem Postgres (aviso no fim); com MACUXI_PG_EXIGIR=1 (CI), a ausência do banco é erro.
 */
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { hashSenha } from '@macuxi/db';
import { PEPPER_HUB_FIXTURE } from '@macuxi/db/teste';
import { semBanco } from '@macuxi/db/teste/estado';
import { VERSAO_CONTRATO } from '@macuxi/integracao/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../apps/api/src/app';
import { criarBancoApp } from '../../../apps/api/src/banco';
import { criarDespachante } from '../../../apps/api/src/despachante';
import { A, licenca, poolComEncerramento, SENHA, subirApi, type ApiDeTeste } from '../../integracao/apoio/api';
import { gerarBaseCarga, gravarBaseCarga, impressaoDigital, ORDEM_TABELAS_CARGA, type BaseCarga, type ResumoBase } from './gerador';

/**
 * Metas DECLARADAS (o que `MACUXI_CARGA_MEDIR=1` cobra). Sync, busca e pedido vêm do pedido da T-0107; as do retorno ao ERP
 * são PREMISSA desta tarefa (não há número no doc 06): o Conector consulta a fila a cada poucos segundos e o ERP confirma um
 * pedido por chamada, então 500 ms por retorno e 1 s por consulta de 50 pedidos deixam folga; o ciclo dos 100 (fila +
 * consultas + retornos + despacho) em 60 s.
 */
export const METAS = Object.freeze({
  /** p95 da duração TOTAL do sync inicial por aparelho (novidades + todas as páginas de todas as entidades). */
  syncInicialMs: 60_000,
  /** p95 de uma busca do catálogo. */
  buscaMs: 300,
  /** p95 de um push com 1 pedido. */
  pedidoMs: 500,
  /** Premissa: p95 de `POST /integracao/v1/pedidos/{uuid}/retorno`. */
  retornoMs: 500,
  /** Premissa: p95 de `GET /integracao/v1/pedidos/pendentes?limite=50`. */
  pendentesMs: 1_000,
  /** Premissa: ciclo da fila dos 100 pedidos (despacho → pendentes → retornos → despacho → integrated). */
  cicloFilaMs: 60_000,
});

const MEDIR = process.env.MACUXI_CARGA_MEDIR === '1';
const APARELHOS = Number(process.env.MACUXI_CARGA_APARELHOS ?? 5);
/**
 * Busca: alvo de buscas, concorrência e ORÇAMENTO de tempo (nenhuma busca nova depois dele). Padrão enxuto para caber no job
 * de integração (D-T0107b: hoje uma busca custa segundos de CPU com 20 mil produtos); o ensaio completo pedido na T-0107 é
 * `MACUXI_CARGA_BUSCAS=200 MACUXI_CARGA_BUSCA_CONCORRENCIA=10 MACUXI_CARGA_BUSCA_SEGUNDOS=900`.
 */
const BUSCAS = Number(process.env.MACUXI_CARGA_BUSCAS ?? 200);
const CONCORRENCIA_BUSCA = Number(process.env.MACUXI_CARGA_BUSCA_CONCORRENCIA ?? 4);
const BUSCA_SEGUNDOS = Number(process.env.MACUXI_CARGA_BUSCA_SEGUNDOS ?? 30);
const PEDIDOS = 100;
/** Pushes em voo no caso 3 (D-T0107a: >= pool da API trava; 5 = metade do pool de 10 deixa a conexão aninhada livre). */
const CONCORRENCIA_PEDIDOS = Number(process.env.MACUXI_CARGA_PEDIDOS_CONCORRENCIA ?? 5);
/** Pool da API (o padrão de `MACUXI_API_POOL` no servidor). */
const POOL_API = 10;
const CONCORRENCIA_RETORNO = 10;
const VERSAO_CONECTOR = '1.2.0';
/** Folgas de execução (não são medida): máquina dividida com outros arquivos no CI. */
const TETO = { preparo: 600_000, sync: 400_000, busca: BUSCA_SEGUNDOS * 1000 + 300_000, pedidos: 180_000, fila: 400_000, defeito: 120_000 } as const;

// ------------------------------------------------------------------------------------------------------------- medidas
const pct = (xs: readonly number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? NaN;
};
interface Medida {
  n: number;
  p50: number;
  p95: number;
  max: number;
  meta: number | null;
}
const medida = (xs: readonly number[], meta: number | null): Medida => ({
  n: xs.length,
  p50: Math.round(pct(xs, 0.5)),
  p95: Math.round(pct(xs, 0.95)),
  max: Math.round(xs.length ? Math.max(...xs) : NaN),
  meta,
});
const registrar = (rotulo: string, dados: object) => console.info(`[carga T-0107] ${rotulo} ${JSON.stringify(dados)}`);

/** Roda `fn` em `n` tarefas com no máximo `conc` ao mesmo tempo. */
async function emParalelo<T>(n: number, conc: number, fn: (i: number) => Promise<T>): Promise<T[]> {
  const saida = new Array<T>(n);
  let prox = 0;
  await Promise.all(
    Array.from({ length: Math.min(conc, n) }, async () => {
      while (prox < n) {
        const i = prox++;
        saida[i] = await fn(i);
      }
    }),
  );
  return saida;
}

interface RespostaHttp<T = unknown> {
  status: number;
  corpo: T;
  ms: number;
}

describe.skipIf(semBanco())('T-0107 — carga de 20 mil produtos: sync inicial, busca, 100 pedidos e retorno do ERP (HTTP real × Postgres × despachante)', () => {
  let api: ApiDeTeste;
  let worker: ReturnType<typeof poolComEncerramento> | undefined;
  let url = '';
  let base: BaseCarga;
  let resumo: ResumoBase;
  /** token por vendedor de carga (mesma ordem de `resumo.vendedores`) */
  const tokens: string[] = [];
  const pepperAntes = process.env.MACUXI_HUB_CHAVE_PEPPER;
  /** pedidos aceitos na fase 3 (entrada da fase 4) */
  const pedidos: string[] = [];

  const http = async <T = unknown>(metodo: 'GET' | 'POST', caminho: string, cab: Record<string, string>, corpo?: object): Promise<RespostaHttp<T>> => {
    const t0 = performance.now();
    const r = await fetch(url + caminho, {
      method: metodo,
      headers: { ...cab, ...(corpo ? { 'content-type': 'application/json' } : {}) },
      ...(corpo ? { body: JSON.stringify(corpo) } : {}),
    });
    const texto = await r.text();
    const ms = performance.now() - t0;
    let json: unknown = texto;
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {
      /* corpo não-JSON: fica o texto, para o relatório do erro */
    }
    return { status: r.status, corpo: json as T, ms };
  };
  const doUsuario = (token: string) => ({ authorization: `Bearer ${token}` });
  const doConector = () => ({
    authorization: `Bearer ${A.integracao.chave.chave}`,
    'x-macuxi-conector-id': A.integracao.identificador,
    'x-macuxi-conector-versao': VERSAO_CONECTOR,
    'user-agent': `macuxi-conector/${VERSAO_CONECTOR}`,
  });
  const linhas = async <T extends pg.QueryResultRow>(sql: string, p: unknown[] = []) => (await api.admin.query<T>(sql, p)).rows;
  /** Ciclos do despachante real até a outbox esvaziar (consumidores encadeados entram nos ciclos seguintes). */
  const despachar = async (maxCiclos = 400) => {
    const d = criarDespachante({ worker: worker!.pool, app: criarBancoApp(api.pool), modulos: api.modulos, lote: 50 });
    let ciclos = 0;
    for (; ciclos < maxCiclos; ciclos += 1) if ((await d.ciclo()).lidos === 0) return ciclos;
    throw new Error(`a outbox não esvaziou em ${maxCiclos} ciclos`);
  };
  const eventosComFalha = () =>
    linhas<{ nome: string; ultimo_erro: string | null }>('select nome, ultimo_erro from plataforma.evento where tenant_id = $1 and publicado_em is null and tentativas > 0', [A.tenantId]);

  /** Espera o `horizonte` do pull (relógio do banco) passar de `instante` (padrão de catalogo-busca-t0052.test.ts). */
  const esperarHorizonte = async (token: string, instante: Date, prazoMs = 30_000) => {
    const fim = Date.now() + prazoMs;
    let ultimo = '';
    while (Date.now() < fim) {
      const r = await http<{ horizonte?: string }>('GET', '/v1/sync/pull?entidade=sinonimo', doUsuario(token));
      ultimo = String(r.corpo?.horizonte ?? '');
      if (r.status === 200 && Date.parse(ultimo) > instante.getTime()) return;
      await new Promise((ok) => setTimeout(ok, 200));
    }
    throw new Error(`horizonte do pull (${ultimo}) não passou de ${instante.toISOString()} em ${prazoMs} ms`);
  };

  beforeAll(async () => {
    process.env.MACUXI_HUB_CHAVE_PEPPER = PEPPER_HUB_FIXTURE;
    const t0 = performance.now();
    api = await subirApi({ poolMax: POOL_API });
    if (!api.banco.urlWorker) throw new Error('banco de teste sem urlWorker (MACUXI_PG_WORKER_SENHA): o retorno ao ERP precisa do despachante');
    worker = poolComEncerramento(new pg.Pool({ connectionString: api.banco.urlWorker, max: 2 }));
    await api.app.listen({ port: 0, host: '127.0.0.1' });
    url = `http://127.0.0.1:${(api.app.server.address() as AddressInfo).port}`;
    const tBanco = performance.now();

    // licença do Hub no tenant A (a fixture não a traz) e eventos antigos da fixture fora do caminho
    const adminA = (await api.sessao('admin@exemplo.com.br', A)).access_token;
    const lic = await licenca(api, adminA, 'tenant', 'integracao', true);
    expect(lic.statusCode, `licença integracao em A: ${lic.body}`).toBe(200);
    await despachar();

    // base de carga: instante = relógio do banco (as linhas entram com updated_at nele; o pull espera o horizonte passar)
    const [agora] = await linhas<{ agora: Date }>('select clock_timestamp() as agora');
    const tGerar = performance.now();
    const g = gerarBaseCarga({ tenantId: A.tenantId, instante: agora!.agora.toISOString(), senhaHash: hashSenha(SENHA) });
    base = g.base;
    resumo = g.resumo;
    const tGravar = performance.now();
    const gravadas = await gravarBaseCarga(api.admin, base);
    const tAnalyze = performance.now();
    await api.admin.query('analyze');
    const tFim = performance.now();
    registrar('preparo', {
      banco_e_api_ms: Math.round(tBanco - t0),
      gerar_ms: Math.round(tGravar - tGerar),
      gravar_ms: Math.round(tAnalyze - tGravar),
      analyze_ms: Math.round(tFim - tAnalyze),
      linhas: Object.values(gravadas).reduce((s, n) => s + n, 0),
      impressao: impressaoDigital(base).slice(0, 16),
    });
    // `on conflict do nothing` esconderia colisão com a fixture: tudo que foi gerado tem de ter entrado
    for (const tabela of ORDEM_TABELAS_CARGA) expect(gravadas[tabela], `linhas gravadas em ${tabela}`).toBe(base[tabela].length);

    for (const v of resumo.vendedores) tokens.push((await api.sessao(v.email, A)).access_token);
    const [depois] = await linhas<{ agora: Date }>('select clock_timestamp() as agora');
    await esperarHorizonte(tokens[0]!, depois!.agora);
  }, TETO.preparo);

  afterAll(async () => {
    if (pepperAntes === undefined) delete process.env.MACUXI_HUB_CHAVE_PEPPER;
    else process.env.MACUXI_HUB_CHAVE_PEPPER = pepperAntes;
    await worker?.encerrar();
    await api?.fechar();
  });

  // ------------------------------------------------------------------------------------------------ 1. sync inicial
  it(`1. sync inicial do catálogo em ${APARELHOS} aparelhos em paralelo: toda página 200, cada aparelho com as 20 mil linhas e só a própria carteira${MEDIR ? `; p95 < ${METAS.syncInicialMs} ms` : ''}`, async () => {
    const erros: string[] = [];
    const paginas: number[] = [];
    const duracoes: number[] = [];
    type Contagem = { linhas: Record<string, number>; produtoIds: Set<string>; clienteIds: Set<string>; requisicoes: number };

    const umAparelho = async (i: number): Promise<Contagem> => {
      const token = tokens[i % tokens.length]!;
      const cab = doUsuario(token);
      const c: Contagem = { linhas: {}, produtoIds: new Set(), clienteIds: new Set(), requisicoes: 0 };
      const t0 = performance.now();
      const nov = await http<{ entidades: string[] }>('GET', '/v1/sync/novidades', cab);
      c.requisicoes += 1;
      if (nov.status !== 200) {
        erros.push(`aparelho ${i} novidades ${nov.status}`);
        return c;
      }
      for (const entidade of nov.corpo.entidades) {
        let cursor: string | null = null;
        c.linhas[entidade] = 0;
        do {
          const q: string = `/v1/sync/pull?entidade=${encodeURIComponent(entidade)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
          const r: RespostaHttp<{ itens: { id: string }[]; proximo_cursor: string | null }> = await http('GET', q, cab);
          c.requisicoes += 1;
          paginas.push(r.ms);
          if (r.status !== 200) {
            erros.push(`aparelho ${i} pull ${entidade} ${r.status} ${JSON.stringify(r.corpo).slice(0, 200)}`);
            break;
          }
          c.linhas[entidade] += r.corpo.itens.length;
          if (entidade === 'produto') for (const x of r.corpo.itens) c.produtoIds.add(x.id);
          if (entidade === 'cliente') for (const x of r.corpo.itens) c.clienteIds.add(x.id);
          cursor = r.corpo.proximo_cursor;
        } while (cursor);
      }
      duracoes.push(performance.now() - t0);
      return c;
    };

    const tInicio = performance.now();
    const resultado = await Promise.all(Array.from({ length: APARELHOS }, (_, i) => umAparelho(i)));
    const total = performance.now() - tInicio;
    const m = medida(duracoes, METAS.syncInicialMs);
    registrar('sync inicial por aparelho (ms)', { ...m, aparelhos: APARELHOS, parede_ms: Math.round(total) });
    registrar('sync página (ms, informativo)', medida(paginas, null));
    registrar('sync linhas por entidade (aparelho 0)', resultado[0]?.linhas ?? {});
    registrar('sync requisições por aparelho', { requisicoes: resultado.map((r) => r.requisicoes) });

    expect(erros.slice(0, 5), 'páginas com erro').toEqual([]);
    for (const [i, c] of resultado.entries()) {
      const v = resumo.vendedores[i % resumo.vendedores.length]!;
      for (const e of ['produto', 'tabela_preco_item', 'produto_conteudo', 'produto_no', 'produto_atributo']) {
        expect(c.linhas[e] ?? 0, `aparelho ${i}: ${e}`).toBeGreaterThanOrEqual(20_000);
      }
      expect(c.linhas.estoque_saldo ?? 0, `aparelho ${i}: estoque_saldo`).toBeGreaterThanOrEqual(40_000);
      // nenhum id repetido entre páginas (cursor (updated_at, id) com 20 mil linhas no MESMO updated_at)
      expect(c.produtoIds.size, `aparelho ${i}: produtos distintos`).toBe(c.linhas.produto);
      // escopo de carteira (RN-CORE-04): exatamente os 100 clientes do vendedor
      expect(c.linhas.cliente, `aparelho ${i}: clientes`).toBe(100);
      expect([...c.clienteIds].sort()).toEqual([...resumo.clientesPorVendedor[v.id]!].sort());
      expect(c.linhas.carteira ?? 0, `aparelho ${i}: carteira`).toBe(100);
    }
    expect(duracoes).toHaveLength(APARELHOS);
    if (MEDIR) expect(m.p95, 'p95 do sync inicial').toBeLessThan(METAS.syncInicialMs);
  }, TETO.sync);

  // ------------------------------------------------------------------------------------------------ 2. busca
  it(`2. busca do catálogo (até ${BUSCAS} buscas em ${BUSCA_SEGUNDOS} s, ${CONCORRENCIA_BUSCA} concorrentes, modo padrão sem IA): todas 200 e a busca por SKU acha o produto${MEDIR ? `; p95 < ${METAS.buscaMs} ms` : ''}`, async () => {
    const porSku = new Map(base['core.produto'].map((p) => [p.sku as string, p.id as string]));
    const termos = resumo.termosDeBusca;
    const erros: string[] = [];
    const naoAchou: string[] = [];
    let skusConferidos = 0;
    const modos = new Set<string>();
    const buscar = async (i: number) => {
      const vi = i % tokens.length;
      const v = resumo.vendedores[vi]!;
      const cliente = resumo.clientesPorVendedor[v.id]![Math.floor(i / tokens.length) % 100]!;
      const termo = termos[i % termos.length]!;
      const x = await http<{ items: { id: string }[]; interpreted_by: string; total: number }>('GET', `/v1/catalogo/busca?q=${encodeURIComponent(termo)}&customer_id=${cliente}&limit=20`, doUsuario(tokens[vi]!));
      if (x.status !== 200) {
        erros.push(`${x.status} ${JSON.stringify(x.corpo).slice(0, 200)}`);
        return x.ms;
      }
      modos.add(x.corpo.interpreted_by);
      const esperado = porSku.get(termo);
      if (esperado) {
        skusConferidos += 1;
        if (!x.corpo.items.some((it) => it.id === esperado)) naoAchou.push(termo);
      }
      return x.ms;
    };
    // isoladas (1 em voo; a 1ª aquece): o custo de UMA busca sem disputa de CPU, para separar do efeito da concorrência
    const isoladas: number[] = [];
    for (let i = 0; i < 3; i += 1) isoladas.push(await buscar(i));
    registrar('busca isolada (ms, informativo; a 1ª aquece)', { ...medida(isoladas.slice(1), null), aquecimento_ms: Math.round(isoladas[0]!) });

    // rajada com orçamento de tempo: nenhuma busca nova depois de BUSCA_SEGUNDOS (as em voo terminam e contam)
    const fim = Date.now() + BUSCA_SEGUNDOS * 1000;
    const tempos: number[] = [];
    let prox = 0;
    const t0 = performance.now();
    await Promise.all(
      Array.from({ length: CONCORRENCIA_BUSCA }, async () => {
        while (prox < BUSCAS && Date.now() < fim) tempos.push(await buscar(prox++));
      }),
    );
    const m = medida(tempos, METAS.buscaMs);
    registrar('busca (ms)', { ...m, concorrencia: CONCORRENCIA_BUSCA, alvo: BUSCAS, parede_ms: Math.round(performance.now() - t0), modo: 'inteligente (padrão) sem provedor de IA', interpretado_por: [...modos] });
    expect(erros.slice(0, 5), 'buscas com erro').toEqual([]);
    expect(skusConferidos, 'nenhuma busca por SKU conferida').toBeGreaterThan(0);
    expect(naoAchou, 'busca por SKU sem o produto').toEqual([]);
    // sem provedor de IA o modo padrão cai nas regras locais (interpreted_by = 'regras'), sem aviso de degradação
    expect([...modos]).toEqual(['regras']);
    expect(tempos.length).toBeGreaterThan(0);
    if (MEDIR) expect(m.p95, 'p95 da busca').toBeLessThan(METAS.buscaMs);
  }, TETO.busca);

  // ------------------------------------------------------------------------------------------------ 3. 100 pedidos
  /** 1 pedido por push: vendedor i % 3, cliente da carteira dele, 2 itens de produtos com estoque, caminho legado de pagamento. */
  const montarPedidos = (n: number, deslocamento = 0) =>
    Array.from({ length: n }, (_, j) => {
      const i = j + deslocamento;
      const vi = i % tokens.length;
      const v = resumo.vendedores[vi]!;
      const produtos = resumo.produtosComEstoque;
      const id = randomUUID();
      const payload = {
        id,
        customer_id: resumo.clientesPorVendedor[v.id]![Math.floor(i / tokens.length) % 100]!,
        discount_pct: 0,
        created_offline_at: new Date().toISOString(),
        items: [0, 1].map((k) => ({ product_id: produtos[(i * 2 + k) % produtos.length]!.id, quantity: 1 + ((i + k) % 3) })),
      };
      return { id, token: tokens[vi]!, corpo: { itens: [{ entidade: 'pedido', id, operacao: 'upsert', payload }] } };
    });
  type RespostaPush = { resultados: { id: string; status: string; codigo?: string; mensagem?: string }[] };

  it(`3. ${PEDIDOS} pedidos em paralelo (1 por push, 3 vendedores, ${CONCORRENCIA_PEDIDOS} em voo): todos aceitos e approved${MEDIR ? `; p95 < ${METAS.pedidoMs} ms` : ''}`, async () => {
    const envios = montarPedidos(PEDIDOS);
    const t0 = performance.now();
    const respostas = await emParalelo(PEDIDOS, CONCORRENCIA_PEDIDOS, (i) => http<RespostaPush>('POST', '/v1/sync/push', doUsuario(envios[i]!.token), envios[i]!.corpo));
    const parede = performance.now() - t0;
    const m = medida(
      respostas.map((r) => r.ms),
      METAS.pedidoMs,
    );
    registrar('pedido push (ms)', { ...m, em_voo: CONCORRENCIA_PEDIDOS, parede_ms: Math.round(parede), vazao_pedidos_s: Math.round((PEDIDOS / parede) * 10_000) / 10 });

    const problemas: string[] = [];
    for (const [i, r] of respostas.entries()) {
      const res = r.status === 200 ? r.corpo.resultados[0] : undefined;
      if (r.status !== 200 || res?.status !== 'aceito') problemas.push(`${envios[i]!.id}: ${r.status} ${JSON.stringify(res ?? r.corpo).slice(0, 200)}`);
      else pedidos.push(envios[i]!.id);
    }
    expect(problemas.slice(0, 5), 'pedidos não aceitos').toEqual([]);
    const status = await linhas<{ status: string; n: string }>('select status, count(*) as n from vendedor.pedido where id = any($1::uuid[]) group by status', [pedidos]);
    expect(status.map((s) => ({ status: s.status, n: Number(s.n) }))).toEqual([{ status: 'approved', n: PEDIDOS }]);
    if (MEDIR) expect(m.p95, 'p95 do pedido').toBeLessThan(METAS.pedidoMs);
  }, TETO.pedidos);

  // ------------------------------------------------------------------------------------------------ 4. retorno ao ERP
  it(`4. retorno ao ERP: os ${PEDIDOS} pedidos vão à fila sem retenção, o Conector lê todos, confirma integrado e eles ficam integrated${MEDIR ? `; p95 retorno < ${METAS.retornoMs} ms, pendentes < ${METAS.pendentesMs} ms, ciclo < ${METAS.cicloFilaMs} ms` : ''}`, async () => {
    expect(pedidos, 'a fase 3 aceitou os pedidos').toHaveLength(PEDIDOS);
    const tCiclo = performance.now();

    // 4a. despachante → fila pendente
    const ciclos1 = await despachar();
    const tFila = performance.now();
    expect(await eventosComFalha(), 'eventos com falha na outbox').toEqual([]);
    const fila = await linhas<{ estado: string; retencao_codigo: string | null; n: string }>(
      'select estado, retencao_codigo, count(*) as n from integracao.pedido_fila_erp where pedido_uuid = any($1::uuid[]) group by 1, 2',
      [pedidos],
    );
    expect(fila.map((f) => ({ estado: f.estado, retencao_codigo: f.retencao_codigo, n: Number(f.n) }))).toEqual([{ estado: 'pendente', retencao_codigo: null, n: PEDIDOS }]);

    // 4b. Conector lê a fila até esvaziar (50 por consulta)
    const nossos = new Set(pedidos);
    const recebidos = new Set<string>();
    const tPend: number[] = [];
    const erros: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      const r = await http<{ pedidos: { pedido_uuid: string; condicao_pagamento_erp: string | null }[] }>('GET', '/integracao/v1/pedidos/pendentes?limite=50', doConector());
      tPend.push(r.ms);
      if (r.status !== 200) {
        erros.push(`pendentes ${r.status} ${JSON.stringify(r.corpo).slice(0, 200)}`);
        break;
      }
      if (r.corpo.pedidos.length === 0) break;
      for (const p of r.corpo.pedidos) {
        if (!nossos.has(p.pedido_uuid)) continue;
        expect(p.condicao_pagamento_erp, 'de-para AVISTA → 001').toBe('001');
        recebidos.add(p.pedido_uuid);
      }
    }
    expect(erros, 'consultas da fila com erro').toEqual([]);
    expect(recebidos.size, 'pedidos entregues ao Conector').toBe(PEDIDOS);

    // 4c. retorno integrado dos 100 (concorrência moderada; balde geral de 300/min por Conector)
    const tRet = await emParalelo(PEDIDOS, CONCORRENCIA_RETORNO, async (i) => {
      const id = pedidos[i]!;
      const r = await http<{ repetido?: boolean }>('POST', `/integracao/v1/pedidos/${id}/retorno`, doConector(), {
        versao_contrato: VERSAO_CONTRATO,
        pedido_uuid: id,
        status: 'integrado',
        numero_erp: `PV-T107-${String(i + 1).padStart(4, '0')}`,
        ocorrido_em: new Date().toISOString(),
      });
      if (r.status !== 200 || r.corpo.repetido !== false) erros.push(`retorno ${id}: ${r.status} ${JSON.stringify(r.corpo).slice(0, 200)}`);
      return r.ms;
    });
    expect(erros.slice(0, 5), 'retornos recusados').toEqual([]);

    // 4d. despachante → integrated no Vendedor
    const tDesp2 = performance.now();
    const ciclos2 = await despachar();
    const ciclo = performance.now() - tCiclo;
    expect(await eventosComFalha(), 'eventos com falha na outbox').toEqual([]);
    const status = await linhas<{ status: string; n: string }>('select status, count(*) as n from vendedor.pedido where id = any($1::uuid[]) group by status', [pedidos]);
    expect(status.map((s) => ({ status: s.status, n: Number(s.n) }))).toEqual([{ status: 'integrated', n: PEDIDOS }]);
    const filaFim = await linhas<{ estado: string; n: string }>('select estado, count(*) as n from integracao.pedido_fila_erp where pedido_uuid = any($1::uuid[]) group by 1', [pedidos]);
    expect(filaFim.map((f) => ({ estado: f.estado, n: Number(f.n) }))).toEqual([{ estado: 'integrado', n: PEDIDOS }]);

    const mPend = medida(tPend, METAS.pendentesMs);
    const mRet = medida(tRet, METAS.retornoMs);
    registrar('erp pendentes GET (ms)', mPend);
    registrar('erp retorno POST (ms)', { ...mRet, concorrencia: CONCORRENCIA_RETORNO });
    registrar('erp ciclo da fila (ms)', {
      n: 1,
      total_ms: Math.round(ciclo),
      meta: METAS.cicloFilaMs,
      despacho_para_fila_ms: Math.round(tFila - tCiclo),
      despacho_para_integrated_ms: Math.round(performance.now() - tDesp2),
      ciclos_despachante: [ciclos1, ciclos2],
    });
    if (MEDIR) {
      expect(mPend.p95, 'p95 do GET pendentes').toBeLessThan(METAS.pendentesMs);
      expect(mRet.p95, 'p95 do POST retorno').toBeLessThan(METAS.retornoMs);
      expect(ciclo, 'ciclo da fila').toBeLessThan(METAS.cicloFilaMs);
    }
  }, TETO.fila);

  it('5. depois da carga: /v1/saude sem 5xx e com o banco ok', async () => {
    const r = await http<{ alertas: string[]; dependencias: { banco: string }; metricas: { erros_5xx: number } }>('GET', '/v1/saude', {});
    expect(r.status).toBe(200);
    registrar('saude', { alertas: r.corpo.alertas, erros_5xx: r.corpo.metricas?.erros_5xx });
    expect(r.corpo.dependencias.banco).toBe('ok');
    expect(r.corpo.alertas).not.toContain('ERROS_5XX');
    expect(r.corpo.alertas).not.toContain('BANCO_FALHA');
    expect(r.corpo.metricas.erros_5xx).toBe(0);
  });
  /**
   * D-T0107a (aberto; ver o cabeçalho): os 100 pedidos AO MESMO TEMPO numa 2ª instância da API (mesmo banco, mesmos módulos e
   * tokens), pool de 10 com `connectionTimeoutMillis` de 2 s (folga: sem o defeito, a espera por conexão é de centenas de ms) para o travamento virar erro em vez de pendurar o arquivo.
   * Hoje: as 10 conexões ficam presas em transação esperando a conexão da carteira, e a rajada volta 5xx. `it.fails` = defeito
   * aberto (fica vermelho quando corrigir e vira `it`).
   */
  it.fails(`6. D-T0107a: ${PEDIDOS} pedidos ao MESMO TEMPO com pool de ${POOL_API} — todos aceitos (hoje o pool trava: conexão da carteira pedida dentro da transação)`, async () => {
    const pool2 = poolComEncerramento(new pg.Pool({ connectionString: api.banco.urlApp, max: POOL_API, connectionTimeoutMillis: 2_000 }));
    const app2 = createApp({ banco: criarBancoApp(pool2.pool), modulos: api.modulos, logger: false });
    try {
      await app2.listen({ port: 0, host: '127.0.0.1' });
      const url2 = `http://127.0.0.1:${(app2.server.address() as AddressInfo).port}`;
      const envios = montarPedidos(PEDIDOS, PEDIDOS);
      const t0 = performance.now();
      const respostas = await Promise.all(
        envios.map(async (e) => {
          const t = performance.now();
          const r = await fetch(`${url2}/v1/sync/push`, { method: 'POST', headers: { ...doUsuario(e.token), 'content-type': 'application/json' }, body: JSON.stringify(e.corpo) });
          const corpo = (await r.json().catch(() => null)) as RespostaPush | null;
          return { status: r.status, aceito: corpo?.resultados?.[0]?.status === 'aceito', ms: performance.now() - t };
        }),
      );
      const porStatus: Record<string, number> = {};
      for (const r of respostas) porStatus[r.status] = (porStatus[r.status] ?? 0) + 1;
      const aceitos = respostas.filter((r) => r.aceito).length;
      registrar('D-T0107a pedidos ao mesmo tempo (ms)', { ...medida(respostas.map((r) => r.ms), METAS.pedidoMs), simultaneos: PEDIDOS, pool: POOL_API, aceitos, por_status: porStatus, parede_ms: Math.round(performance.now() - t0) });
      expect(aceitos, `aceitos de ${PEDIDOS} simultâneos (status: ${JSON.stringify(porStatus)})`).toBe(PEDIDOS);
    } finally {
      await app2.close().catch(() => undefined);
      await pool2.encerrar();
    }
  }, TETO.defeito);
});
