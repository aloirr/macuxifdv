/**
 * T-0156 (RN-CORE-13; desenho `tracking.md` §3.4 e §5.2) — o ponto do trajeto gravado no SQLite do aparelho chega ao servidor,
 * de ponta a ponta: SQLite real (node:sqlite em memória, adaptador do platform-sdk) com a migração do Core
 * (`core__ponto_trajeto`) → `gravarPontosDoTrajeto` (a escrita da tarefa `macuxi-trajeto`) → motor de sync REAL embrulhado
 * por `comPontosDoTrajeto` (apps/mobile, o mesmo do app aberto e do segundo plano) → depois do envio do motor,
 * `enviarPontosDoTrajeto` (Core) manda os pontos direto pelo `push` do transporte, fora da fila do motor →
 * `POST /v1/sync/push` do `createApp` REAL (Postgres como macuxi_app, fixture dois-tenants) → `receberPontosTrajeto` →
 * `core.ponto_trajeto` e `core.deslocamento_dia`.
 *
 * Relógio: as rotas e a rotina do aparelho usam um instante fixo de dia útil, dentro do expediente (qua 18/11/2026 11h em
 * Manaus), só no envio; o login segue o relógio real. O parâmetro `rastreamento` do tenant A é ligado com expediente de
 * 00:00 a 23:59 todos os dias, para o portão de 7 condições só depender do que o teste controla.
 * Cenários E-01, E-02 e E-06.
 */
import { ENTIDADE_PONTO_TRAJETO, PARAMETROS_RASTREAMENTO_PADRAO, TRAJETO_DIAS_MAX, type PontoTrajeto } from '@macuxi/core/contracts';
import { manifest as manifestoCore } from '@macuxi/core/manifest';
import { semBanco } from '@macuxi/db/teste/estado';
import { criarArmazenamentoSqlite, criarMotorSync, criarRegistroSync, type ItemPush, type LinhaSync, type MotorSync, type PaginaSync, type ResultadoItemPush, type TransporteSync } from '@macuxi/platform-sdk';
import { criarDriverNode } from '@macuxi/platform-sdk/sqlite-node';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { comPontosDoTrajeto } from '../../../apps/mobile/src/lib/envio-do-trajeto';
import { gravarPontosDoTrajeto } from '../../../apps/mobile/src/lib/trajeto';
import { entidadesRastreamento } from '../../../modules/core/app/lib/entidades-rastreamento';
import { migracoesAparelho } from '../../../modules/core/db/aparelho';
import { A, subirApi, type ApiDeTeste } from '../apoio/api';

// O barril `@macuxi/core/app` também exporta as telas (react-native, que o Node não carrega). O envio do shell só usa dele a
// rotina do Core: o barril vira o arquivo REAL da rotina (nada simulado).
vi.mock('@macuxi/core/app', () => import('../../../modules/core/app/lib/enviar-pontos-trajeto'));

/** Qua 18/11/2026 11h em Manaus (UTC−4): dia útil, sem feriado nacional. */
const ENVIO = '2026-11-18T15:00:00.000Z';
const id = (n: number) => `0f156000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TODO_DIA = [{ inicio_min: 0, fim_min: 1439 }];
const EXPEDIENTE = Object.fromEntries(['0', '1', '2', '3', '4', '5', '6'].map((d) => [d, TODO_DIA]));
const ponto = (n: number, capturado_em: string, latitude: number, longitude: number): PontoTrajeto => ({ id: id(n), capturado_em, latitude, longitude, precisao_m: 10, velocidade_ms: null });
const PONTOS: PontoTrajeto[] = [ponto(1, '2026-11-18T14:40:00.000Z', -3.1019, -60.025), ponto(2, '2026-11-18T14:50:00.000Z', -3.1104, -60.0213)];
/** Capturado há mais de TRAJETO_DIAS_MAX dias do envio: a poda do aparelho apaga sem enviar. */
const ANTIGO = ponto(4, new Date(Date.parse(ENVIO) - (TRAJETO_DIAS_MAX + 1) * 86_400_000).toISOString(), -3.1, -60.02);

interface LinhaDoAparelho {
  id: string;
  enviado_em: string | null;
}

describe.skipIf(semBanco())('T-0156 — envio do trajeto: SQLite do aparelho → push direto → receberPontosTrajeto (createApp real × Postgres)', () => {
  let api: ApiDeTeste;
  let congelado: Date | null = null;
  let token = '';
  const enviados: ItemPush[] = [];
  const driver = criarDriverNode(':memory:');
  let motor: MotorSync;
  const registros: string[] = [];

  const noServidor = (ids: readonly string[]) =>
    api.admin
      .query<{ id: string; usuario_id: string; latitude: string; longitude: string }>(
        'select id, usuario_id, latitude::text as latitude, longitude::text as longitude from core.ponto_trajeto where tenant_id = $1 and id = any($2::uuid[]) order by capturado_em',
        [A.tenantId, ids],
      )
      .then((r) => r.rows);
  const noAparelho = () => driver.todas<LinhaDoAparelho>('SELECT id, enviado_em FROM core__ponto_trajeto ORDER BY capturado_em');
  const doTrajeto = () => enviados.filter((i) => i.entidade === ENTIDADE_PONTO_TRAJETO);
  const ligarRastreamento = async () => {
    await api.admin.query("delete from plataforma.parametro where tenant_id = $1 and modulo = 'core' and chave = 'rastreamento'", [A.tenantId]);
    await api.admin.query("insert into plataforma.parametro (tenant_id, modulo, chave, valor) values ($1, 'core', 'rastreamento', $2::jsonb)", [A.tenantId, JSON.stringify({ ...PARAMETROS_RASTREAMENTO_PADRAO, ativo: true, expediente: EXPEDIENTE })]);
  };
  /** O envio do motor (e, depois dele, o do trajeto), com as rotas e a rotina no instante ENVIO. */
  async function enviar(): Promise<void> {
    congelado = new Date(ENVIO);
    try {
      await motor.enviar();
    } finally {
      congelado = null;
    }
  }

  beforeAll(async () => {
    // hora-fixa-ok: login no relógio real (o JWT é verificado no real); só o envio usa o instante fixo
    const relogio = () => (congelado ? new Date(congelado.getTime()) : new Date());
    api = await subirApi({ relogio });
    await ligarRastreamento();
    token = (await api.sessao('vendedor@exemplo.com.br', A)).access_token;

    const transporte: TransporteSync = {
      async push(itens: ItemPush[]): Promise<ResultadoItemPush[]> {
        enviados.push(...itens);
        const r = await api.chamar(token, { method: 'POST', url: '/v1/sync/push', payload: { itens } });
        if (r.statusCode !== 200) throw new Error(`push: ${r.statusCode} ${r.body}`);
        return (r.json() as { resultados: ResultadoItemPush[] }).resultados;
      },
      async pull(): Promise<PaginaSync<LinhaSync>> {
        throw new Error('o teste do envio não faz pull');
      },
    };
    const registro = criarRegistroSync([manifestoCore]);
    for (const e of entidadesRastreamento) registro.registrar(e);
    const armazenamento = criarArmazenamentoSqlite(driver, { migracoesModulos: { core: migracoesAparelho }, entidades: entidadesRastreamento.map((e) => ({ nome: e.nome, modulo: 'core' as const })) });
    // como o motor do usuário (services/motor-do-usuario.ts): o mesmo push do transporte e o mesmo `online`
    motor = comPontosDoTrajeto(criarMotorSync({ registro, armazenamento, transporte, online: () => true }), {
      banco: () => driver,
      push: (itens) => transporte.push(itens),
      online: () => true,
      registrar: (m) => registros.push(m),
      agora: relogio,
    });
    await motor.carregar();
    await motor.aplicarModulosAtivos(['core']);
  }, 120_000);

  afterAll(async () => {
    await api?.admin.query("delete from plataforma.parametro where tenant_id = $1 and modulo = 'core' and chave = 'rastreamento'", [A.tenantId]).catch(() => undefined);
    await api?.fechar();
  });

  it('E-01: a migração do Core cria `core__ponto_trajeto` no SQLite do motor e a tarefa grava os pontos com `enviado_em` nulo', async () => {
    expect(await gravarPontosDoTrajeto(driver, PONTOS)).toBe(2);
    expect(await noAparelho()).toEqual(PONTOS.map((p) => ({ id: p.id, enviado_em: null })));
  });

  it('E-02: depois do envio do motor, os pontos vão pelo push como `ponto_trajeto`, fora da fila, e o servidor grava em core.ponto_trajeto do usuário da sessão', async () => {
    await enviar();
    expect(doTrajeto().map((i) => [i.id, i.operacao])).toEqual(PONTOS.map((p) => [p.id, 'upsert']));
    expect(doTrajeto().map((i) => i.payload)).toEqual(PONTOS);
    const linhas = await noServidor(PONTOS.map((p) => p.id));
    expect(linhas.map((l) => [l.id, l.usuario_id, Number(l.latitude), Number(l.longitude)])).toEqual(PONTOS.map((p) => [p.id, A.usuarios.vendedor1, p.latitude, p.longitude]));
    for (const l of await noAparelho()) expect(l.enviado_em, l.id).not.toBeNull();
    // o rastreamento é interno: nada na fila nem na contagem do vendedor
    expect(motor.estado().fila).toEqual([]);
    expect(registros).toEqual([]);
  });

  it(`E-06 (poda): o ponto capturado há mais de ${TRAJETO_DIAS_MAX} dias sai do aparelho sem ir ao servidor`, async () => {
    await gravarPontosDoTrajeto(driver, [ANTIGO]);
    const antes = doTrajeto().length;
    await enviar();
    expect(doTrajeto().slice(antes).map((i) => i.id)).not.toContain(ANTIGO.id);
    expect((await noAparelho()).map((l) => l.id)).not.toContain(ANTIGO.id);
    expect(await noServidor([ANTIGO.id])).toEqual([]);
  });
});
