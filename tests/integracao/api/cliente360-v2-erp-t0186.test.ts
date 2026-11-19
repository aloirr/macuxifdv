/**
 * T-0186 (Cliente 360 v2) — notas e títulos do ERP com forma de pagamento e NF, ponta a ponta entre módulos: Conector simulado →
 * Hub (`POST /integracao/v1/lotes`) → despachante REAL → `integracao.nota.atualizado@1` / `integracao.titulo.atualizado@1` →
 * consumidores do Core (`core.nota_erp`, `core.titulo`; migração 0090) → `GET /v1/core/clientes/:id/notas` e a NF ao tocar.
 * createApp × Postgres como macuxi_app (RLS), banco efêmero do arquivo com a fixture dois-tenants (A = Manaus).
 *
 * Contrato do Hub (modules/integracao/contracts/entidades.ts, #511): `nota.forma_pagamento`, `nota.nf_origem_numero` e
 * `nota.nf_origem_serie` (só devolução); `titulo.nf_numero`, `titulo.nf_serie` e `titulo.forma_pagamento`. Decisão do dono do
 * produto (R-20261119-102943): a forma de pagamento é a DESCRIÇÃO em texto do ERP ("Boleto 28 dias"), gravada como veio.
 * Ausente = não informado = não altera (o reenvio sem o campo mantém o valor).
 *
 * ORÁCULO (RN-CORE-40, P3/P4, escrito aqui sem chamar o domain): NF 700101 de R$ 1.280,00, título único baixado (sem saldo) e
 * devolução de R$ 330,00 com NF de origem 700101/1 → status "devolvido_parcial", devolvido R$ 330,00, valor final R$ 950,00.
 * Convenção: `it` = critério (vermelho = defeito em recado ao dono). Matriz: docs/testes/T-0186.md (E-01..E-05).
 */
import { createHash, randomUUID } from 'node:crypto';
import { completarCnpj } from '@macuxi/comum/documento';
import { PEPPER_HUB_FIXTURE } from '@macuxi/db/teste';
import { semBanco } from '@macuxi/db/teste/estado';
import { LoteAceito, LoteResultado, VERSAO_CONTRATO } from '@macuxi/integracao/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarBancoApp } from '../../../apps/api/src/banco';
import { criarDespachante } from '../../../apps/api/src/despachante';
import { A, licenca, subirApi, type ApiDeTeste } from '../apoio/api';

const P = `T186${randomUUID().slice(0, 4).toUpperCase()}`;
const CLI = `${P}-C1`;
const EXT = { nf: `${P}-NF1`, dev: `${P}-ND1`, tit: `${P}-T1`, fatComOrigem: `${P}-NF2` } as const;
const NUMERO = '700101';
const FORMA = 'Boleto 28 dias';
const VERSAO_CONECTOR = '1.2.0';
const IP_A = '198.51.100.10';
const ENTIDADES = ['cliente', 'nota', 'titulo'] as const;
type Entidade = (typeof ENTIDADES)[number];
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
let seq = 0;
// hora-fixa-ok: alterado_em do Hub no relógio real (só ordena as versões da linha)
const alterado = () => new Date(Date.now() - 900_000 + (seq += 1) * 1_000).toISOString();
// hora-fixa-ok: notas de 10 dias atrás, dentro dos 90 dias padrão do Histórico em qualquer data do CI
const DIA_NF = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
const EMITIDA = `${DIA_NF}T15:00:00Z`;

const cliente = () => ({
  external_id: CLI,
  alterado_em: alterado(),
  razao_social: `Mercado ${P} Ltda`,
  nome_fantasia: `Mercado ${P}`,
  documento: completarCnpj('186186186001'),
  inscricao_estadual: 'ISENTO',
  vendedor_external_id: null,
  endereco: { logradouro: 'Av. Djalma Batista', numero: '186', bairro: 'Chapada', cidade: 'Manaus', uf: 'AM', cep: '69050-010' },
  latitude: -3.1,
  longitude: -60.02,
  telefone: '92999990186',
  email: null,
  limite_credito_cents: 10_000_000,
  contatos: [],
});
const nota = (ext: string, extra: Record<string, unknown>) => ({
  external_id: ext,
  alterado_em: alterado(),
  cliente_external_id: CLI,
  vendedor_external_id: null,
  tipo: 'faturamento',
  numero: NUMERO,
  serie: '1',
  emitida_em: EMITIDA,
  total_cents: 128_000,
  quantidade_itens: 4,
  pedido_uuid: null,
  cancelada: false,
  ...extra,
});
const titulo = (extra: Record<string, unknown>) => ({
  external_id: EXT.tit,
  alterado_em: alterado(),
  cliente_external_id: CLI,
  numero: `${NUMERO}/1`,
  parcela: 1,
  emissao: DIA_NF,
  vencimento: DIA_NF,
  valor_cents: 128_000,
  saldo_cents: 0,
  situacao: 'baixado',
  // hora-fixa-ok: baixa no dia da NF (passado)
  baixado_em: EMITIDA,
  ...extra,
});

describe.skipIf(semBanco())('T-0186 — forma de pagamento e NF do ERP: Hub → despachante → consumidores do Core → Histórico (createApp real × Postgres)', () => {
  let api: ApiDeTeste;
  let worker: pg.Pool;
  let tkAdmin = '';
  let clienteId = '';
  const pepperAntes = process.env.MACUXI_HUB_CHAVE_PEPPER;
  let entidadesAntes: string[] = [];

  const q = async <T extends pg.QueryResultRow>(sql: string, p: unknown[] = []) => (await api.admin.query<T>(sql, p)).rows;
  const despachar = async () => {
    const d = criarDespachante({ worker, app: criarBancoApp(api.pool), modulos: api.modulos });
    for (let i = 0; i < 40; i += 1) if ((await d.ciclo()).lidos === 0) return;
    throw new Error('a outbox não esvaziou em 40 ciclos');
  };
  /** Envia o lote pelo Hub (mesmos cabeçalhos do apps/conector), despacha e devolve o resultado do lote. */
  async function enviar(entidade: Entidade, registros: object[]): Promise<LoteResultado> {
    const corpo = { versao_contrato: VERSAO_CONTRATO, entidade, modo: 'delta' as const, conector_id: A.integracao.identificador, versao_conector: VERSAO_CONECTOR, enviado_em: alterado(), registros };
    const headers = {
      authorization: `Bearer ${A.integracao.chave.chave}`,
      'x-macuxi-conector-id': A.integracao.identificador,
      'x-macuxi-conector-versao': VERSAO_CONECTOR,
      'user-agent': `macuxi-conector/${VERSAO_CONECTOR}`,
      'idempotency-key': sha256(JSON.stringify({ ...corpo, enviado_em: undefined })),
    };
    const r = await api.app.inject({ method: 'POST', url: '/integracao/v1/lotes', headers, remoteAddress: IP_A, payload: corpo });
    expect(r.statusCode, `${entidade}: ${r.body}`).toBe(202);
    const aceito = LoteAceito.parse(r.json());
    await despachar();
    const c = await api.app.inject({ method: 'GET', url: `/integracao/v1/lotes/${aceito.lote_id}`, headers, remoteAddress: IP_A });
    expect(c.statusCode, c.body).toBe(200);
    return LoteResultado.parse(c.json());
  }
  async function aplicar(entidade: Entidade, registros: object[]) {
    const res = await enviar(entidade, registros);
    expect(res.erros, `${entidade}: ${JSON.stringify(res.erros)}`).toEqual([]);
    expect(res.status, entidade).toBe('concluido');
    const falhas = await q<{ nome: string; ultimo_erro: string | null }>('select nome, ultimo_erro from plataforma.evento where tenant_id = $1 and publicado_em is null and tentativas > 0', [A.tenantId]);
    expect(falhas, 'eventos com falha no consumidor').toEqual([]);
  }
  const notaNoBanco = (ext: string) =>
    q<{ id: string; forma_pagamento: string | null; nf_origem_numero: string | null; nf_origem_serie: string | null }>('select id, forma_pagamento, nf_origem_numero, nf_origem_serie from core.nota_erp where tenant_id = $1 and external_id = $2 and deleted_at is null', [A.tenantId, ext]).then((r) => r[0]);
  const tituloNoBanco = () =>
    q<{ nf_numero: string | null; nf_serie: string | null; forma_pagamento: string | null }>('select nf_numero, nf_serie, forma_pagamento from core.titulo where tenant_id = $1 and external_id = $2 and deleted_at is null', [A.tenantId, EXT.tit]).then((r) => r[0]);

  beforeAll(async () => {
    process.env.MACUXI_HUB_CHAVE_PEPPER = PEPPER_HUB_FIXTURE;
    api = await subirApi();
    if (!api.banco.urlWorker) throw new Error('banco de teste sem urlWorker (MACUXI_PG_WORKER_SENHA): a carga do ERP precisa do despachante');
    worker = new pg.Pool({ connectionString: api.banco.urlWorker, max: 2 });
    tkAdmin = (await api.sessao('admin@exemplo.com.br', A)).access_token;
    const lic = await licenca(api, tkAdmin, 'tenant', 'integracao', true);
    expect(lic.statusCode, lic.body).toBe(200);
    const [orig] = await q<{ entidades: string[] }>('select entidades from integracao.conector where id = $1', [A.integracao.conector]);
    entidadesAntes = orig!.entidades;
    const faltam = ENTIDADES.filter((e) => !entidadesAntes.includes(e));
    if (faltam.length) await q('update integracao.conector set entidades = entidades || $2::text[] where id = $1', [A.integracao.conector, faltam]);
    await despachar();
    // hora-fixa-ok: concluido_em do lote antigo da fixture, nunca comparado
    await q("update integracao.lote set status = 'concluido', concluido_em = now() where status in ('recebido', 'processando')");
    await aplicar('cliente', [cliente()]);
    clienteId = (await q<{ id: string }>('select id from core.cliente where tenant_id = $1 and external_id = $2', [A.tenantId, CLI]))[0]!.id;
    await aplicar('nota', [nota(EXT.nf, { forma_pagamento: FORMA }), nota(EXT.dev, { tipo: 'devolucao', numero: '800101', total_cents: 33_000, quantidade_itens: 1, nf_origem_numero: NUMERO, nf_origem_serie: '1' })]);
    await aplicar('titulo', [titulo({ nf_numero: NUMERO, nf_serie: '1', forma_pagamento: FORMA })]);
  }, 240_000);

  afterAll(async () => {
    if (api) await q('update integracao.conector set entidades = $2::text[] where id = $1', [A.integracao.conector, entidadesAntes]).catch(() => undefined);
    await worker?.end();
    await api?.fechar();
    if (pepperAntes === undefined) delete process.env.MACUXI_HUB_CHAVE_PEPPER;
    else process.env.MACUXI_HUB_CHAVE_PEPPER = pepperAntes;
  });

  it('E-01 (nota de faturamento): o consumidor grava `forma_pagamento` com o texto que o ERP mandou ("Boleto 28 dias")', async () => {
    expect((await notaNoBanco(EXT.nf))?.forma_pagamento).toBe(FORMA);
  });

  it('E-02 (nota de devolução, P4): o consumidor grava `nf_origem_numero` e `nf_origem_serie`', async () => {
    expect(await notaNoBanco(EXT.dev)).toMatchObject({ nf_origem_numero: NUMERO, nf_origem_serie: '1' });
  });

  it('E-03 (título): o consumidor grava `nf_numero` e `nf_serie` (junta a parcela à NF)', async () => {
    expect(await tituloNoBanco()).toMatchObject({ nf_numero: NUMERO, nf_serie: '1' });
  });

  it('E-04 (título): o consumidor grava `forma_pagamento` com o texto que o ERP mandou', async () => {
    expect((await tituloNoBanco())?.forma_pagamento).toBe(FORMA);
  });

  const historico = async () => {
    const r = await api.chamar(tkAdmin, { method: 'GET', url: `/v1/core/clientes/${clienteId}/notas` });
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as { itens: { id: string; numero_nf: string; data: string; valor_cents: number; forma_pagamento: string | null; status: string }[]; formas_pagamento: string[] };
  };
  const detalhe = async (notaId: string) => {
    const d = await api.chamar(tkAdmin, { method: 'GET', url: `/v1/core/clientes/${clienteId}/notas/${notaId}` });
    expect(d.statusCode, d.body).toBe(200);
    return d.json() as Record<string, unknown>;
  };

  it('E-05 (valor × regra, RN-CORE-40 P3/P4): o Histórico e a NF ao tocar mostram o status devolvido parcial, o devolvido e o valor final', async () => {
    const corpo = await historico();
    // só a NF de faturamento entra na lista; a devolução abate dela
    expect(corpo.itens.map((n) => n.numero_nf)).toEqual([NUMERO]);
    const linha = corpo.itens[0]!;
    expect(linha).toMatchObject({ data: DIA_NF, valor_cents: 128_000, status: 'devolvido_parcial' });
    expect(await detalhe(linha.id)).toMatchObject({ devolvido_cents: 33_000, valor_final_cents: 128_000 - 33_000, em_atraso: false, parcelas: [{ parcela: '1', valor_cents: 128_000, saldo_cents: 0 }] });
  });

  it('E-05b (rótulo × valor, R-20261119-102943): a linha, o filtro de formas e a NF ao tocar mostram a forma do ERP em texto', async () => {
    const corpo = await historico();
    expect(corpo.itens[0]?.forma_pagamento).toBe(FORMA);
    expect(corpo.formas_pagamento).toEqual([FORMA]);
    expect((await detalhe(corpo.itens[0]!.id)).forma_pagamento).toBe(FORMA);
  });

  it('E-06 (ausente = não altera): o reenvio da nota e do título SEM os campos novos mantém a forma e a NF gravadas', async () => {
    const antesNota = await notaNoBanco(EXT.dev);
    const antesTitulo = await tituloNoBanco();
    await aplicar('nota', [nota(EXT.dev, { tipo: 'devolucao', numero: '800101', total_cents: 33_000, quantidade_itens: 1 })]);
    await aplicar('titulo', [titulo({})]);
    expect(await notaNoBanco(EXT.dev)).toEqual(antesNota);
    expect(await tituloNoBanco()).toEqual(antesTitulo);
  });

  it('E-07 (dado inválido da integração): NF de origem em nota de faturamento é recusada na linha do lote, sem gravar', async () => {
    const res = await enviar('nota', [nota(EXT.fatComOrigem, { nf_origem_numero: NUMERO })]);
    expect(res.erros.length, JSON.stringify(res)).toBe(1);
    expect(JSON.stringify(res.erros)).toContain('nf_origem_numero');
    expect(await notaNoBanco(EXT.fatComOrigem)).toBeUndefined();
  });
});
