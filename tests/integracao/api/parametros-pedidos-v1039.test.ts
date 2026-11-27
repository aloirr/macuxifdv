/**
 * v1.0.39 — Parâmetros › Pedidos: pedido mínimo (RN-VEN-22), crédito excedido (RN-VEN-12, P-6) e estoque insuficiente (RN-VEN-20)
 * pela API REAL: `createApp` + os 8 módulos + Postgres efêmero (dois-tenants), parâmetros gravados pela rota
 * `PUT /v1/vendedor/parametros/pedidos` no armazenamento real do SDK (`plataforma.parametro`) e lidos pelo push do pedido.
 * Spec: docs/design/menu-parametros/spec.md §7.5 (decisões PA-1 a PA-10, R-20261126-212022-alexandre).
 *
 * Valor × regra (R-20261108-135639): o ORÁCULO é escrito aqui pelo texto da regra, sem chamar a função testada:
 *   RN-VEN-22 (PA-3, PA-4, PA-9): `pedido_minimo_cents` inteiro de 0 a 10.000.000 (R$ 100.000,00); 0 = sem mínimo (padrão).
 *     Total final do PEDIDO (preço × quantidade, com o desconto, sem frete) MENOR que o mínimo = recusado (só como orçamento);
 *     igual passa; o orçamento nunca é barrado. Fixture: ALFA-001 a R$ 1.000,00 na tabela Padrão do A.c1 (sem faixa até 9 un).
 *   RN-VEN-12 (P-6, PA-7): `credito_excedido_acao` = aprovacao (padrão) | orcamento | avisar. Só a prazo; à vista nunca conta.
 *   RN-VEN-20 (PA-6, PA-10): `estoque_insuficiente_acao` = orcamento (padrão) | aprovacao | avisar; com aprovacao, quem aprova é
 *     `aprovacao.estoque_nivel` de Alçadas (padrão gerente).
 *   PA-1: o passo Empresa NÃO grava as três chaves; sem linha vale o padrão.
 * Precedência no servidor (receber.ts): mínimo → crédito → estoque.
 * Convenção: `it` = critério da tarefa (vermelho = defeito em recado ao dono).
 */
import { PAGAMENTO_FIXTURE } from '@macuxi/db/teste';
import { semBanco } from '@macuxi/db/teste/estado';
import { CriarEmpresaRespostaSchema, linhasDosParametrosIniciais, ParametrosIniciaisSchema, type ResultadoItemPush } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { A, B, comToken, erroDe, licenca, SENHA, subirApi, type ApiDeTeste } from '../apoio/api';
import { criarSuperAdmin, criarUsuarioNoTenant, sessaoDoPortal } from '../apoio/portal';

const URL = '/v1/vendedor/parametros/pedidos';
const NOVAS = ['pedido_minimo_cents', 'credito_excedido_acao', 'estoque_insuficiente_acao'] as const;
const CHAVES = [...NOVAS, 'titulo_vencido_dias', 'validade_orcamento_dias', 'aprovacao.estoque_nivel'] as const;
/** Padrões do spec §7.5 (PA-1, PA-6): sem linha gravada. */
const PADRAO = { pedido_minimo_cents: 0, credito_excedido_acao: 'aprovacao', estoque_insuficiente_acao: 'orcamento' } as const;
const MSG_MINIMO = 'Use um valor de R$ 0,01 a R$ 100.000,00';
const MSG_CREDITO = 'Escolha Enviar para aprovação, Só como orçamento ou Avisar e enviar';
const MSG_ESTOQUE = 'Escolha Só como orçamento, Enviar para aprovação ou Avisar e enviar';
const MSG_RECUSA_CREDITO = 'Limite de crédito excedido. Envie como orçamento ou reduza o pedido.';
const MSG_RECUSA_ESTOQUE = 'Sem estoque na filial para um dos itens. Envie como orçamento ou reduza a quantidade.';
/** ALFA-001 na tabela Padrão do A.c1 (db/seeds/fixtures/dois-tenants.ts): R$ 1.000,00; a faixa escalonada só a partir de 10 un. */
const PRECO_ALFA = 100_000;
/** Saldo de ALFA-001 (e BETA-001 em B) posto pelo beforeAll: folga para os casos de crédito e mínimo; FALTA pede mais que isso. */
const SALDO = 1_000;
const FALTA = 5_000;
const SEGREDO_PLATAFORMA = 'segredo-de-plataforma-do-agente-testes-v1039-com-folga';
const SA = { email: 'operador.v1039@exemplo.com.br', nome: 'Operador Parâmetros Fictício', senha: 'Senha-Forte-do-Portal-v1039' };
const EMPRESA = { codigo: 'param-v1039', razao_social: 'Empresa Parâmetros V1039 Ltda', cnpj: '11444777000161' };
const ADMIN_INICIAL = { email: 'admin.inicial.v1039@exemplo.com.br', nome: 'Admin Inicial Fictício', senha: 'Inicial#Portal-v1039' };
const PA = PAGAMENTO_FIXTURE.A;
const PB = PAGAMENTO_FIXTURE.B;
const id = (n: number) => `0f103900-0000-4000-8000-${String(n).padStart(12, '0')}`;
const IDS = Array.from({ length: 60 }, (_, i) => id(i + 1));

/** Oráculo do texto em reais (pt-BR, "R$ 2.000,01"), escrito aqui. */
function reais(c: number): string {
  const inteiro = Math.floor(c / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${inteiro},${String(c % 100).padStart(2, '0')}`;
}
const recusaMinimo = (c: number) => new RegExp(`^Pedido abaixo do mínimo de ${reais(c).replace('R$ ', 'R\\$\\s').replace(/\./g, '\\.')}\\. Envie como orçamento ou aumente o pedido\\.$`);

type Linha = Record<string, unknown>;

describe.skipIf(semBanco())('v1.0.39 Parâmetros › Pedidos: pedido mínimo, crédito excedido e estoque insuficiente (RN-VEN-12, RN-VEN-20, RN-VEN-22)', () => {
  let api: ApiDeTeste;
  const tk = { admin: '', analista: '', gerente: '', supervisor: '', vendedor: '', promotor: '', adminB: '', vendedorB: '' };
  let prodA = '';
  let prodB = '';
  let seq = 0;
  const novo = () => IDS[seq++]!;

  const q = async <T extends pg.QueryResultRow = Linha>(sql: string, p: unknown[] = []) => (await api.admin.query<T>(sql, p)).rows;
  const chamar = async (t: string, method: 'GET' | 'PUT', payload?: object, url = URL) => {
    const r = await api.chamar(t, { method, url, ...(payload ? { payload } : {}) });
    return { status: r.statusCode, corpo: r.json() as Linha, r };
  };
  const gravar = async (t: string, corpo: object) => {
    const r = await chamar(t, 'PUT', corpo);
    expect(r.status, `PUT ${JSON.stringify(corpo)}: ${r.r.body}`).toBe(200);
    return r.corpo;
  };
  const auditorias = async (tenant: string) =>
    Number((await q<{ n: string }>("select count(*) as n from plataforma.auditoria where tenant_id = $1 and acao = 'alcada.gerenciar' and entidade = 'parametro'", [tenant]))[0]!.n);
  const noBanco = async (tenant: string, chaves: readonly string[] = NOVAS) =>
    Object.fromEntries((await q<{ chave: string; valor: unknown }>("select chave, valor from plataforma.parametro where tenant_id = $1 and modulo = 'vendedor' and chave = any($2::text[]) and deleted_at is null", [tenant, [...chaves]])).map((l) => [l.chave, l.valor]));
  const limparParametros = async () => {
    for (const t of [A.tenantId, B.tenantId]) await q("delete from plataforma.parametro where tenant_id = $1 and modulo = 'vendedor' and chave = any($2::text[])", [t, [...CHAVES]]);
  };
  const push = async (token: string, itens: object[]): Promise<ResultadoItemPush[]> => {
    const r = await api.chamar(token, { method: 'POST', url: '/v1/sync/push', payload: { itens } });
    expect(r.statusCode, r.body).toBe(200);
    return (r.json() as { resultados: ResultadoItemPush[] }).resultados;
  };
  const item = (pid: string, payload: Linha) => ({ entidade: 'pedido', id: pid, operacao: 'upsert', payload: { id: pid, created_offline_at: new Date().toISOString(), ...payload } });
  /** Pedido do A.c1 com ALFA-001: à vista (PIX) ou a prazo (BOLETO 28/56). */
  const pedidoA = (pid: string, o: { qtd?: number; prazo?: boolean; desconto?: number; tipo?: 'orcamento'; origem?: string } = {}) =>
    item(pid, {
      customer_id: A.clientes.c1,
      discount_pct: o.desconto ?? 0,
      items: [{ product_id: prodA, quantity: o.qtd ?? 1 }],
      ...(o.tipo === 'orcamento' ? { tipo: 'orcamento', payment_terms: '28 dias' } : { forma_pagamento_id: o.prazo ? PA.formas.boleto : PA.formas.pix, prazo_pagamento_id: o.prazo ? PA.prazos.bol2856 : PA.prazos.pixAvista }),
      ...(o.origem ? { orcamento_origem_id: o.origem } : {}),
    });
  const pedidoB = (pid: string, qtd = 1) =>
    item(pid, { customer_id: B.clientes.c1, discount_pct: 0, items: [{ product_id: prodB, quantity: qtd }], forma_pagamento_id: PB.formas.dinheiro, prazo_pagamento_id: PB.prazos.dinAvista });
  const doc = async (pid: string) =>
    (await q<{ status: string; tipo: string; total_cents: string; nivel_aprovacao: string | null; motivos_aprovacao: string[] | null }>('select status, tipo, total_cents::text, nivel_aprovacao, motivos_aprovacao from vendedor.pedido where id = $1', [pid]))[0];
  const aprovacoes = async (pid: string) =>
    (await q<{ motivo: string; nivel: string; estado: string }>('select motivo, nivel, estado from vendedor.pedido_aprovacao where pedido_id = $1 and deleted_at is null order by motivo', [pid])).map((a) => `${a.motivo}:${a.nivel}:${a.estado}`);
  const aceito = (r: ResultadoItemPush | undefined, pid: string) => expect(r, JSON.stringify(r)).toMatchObject({ id: pid, status: 'aceito' });
  const recusado = async (r: ResultadoItemPush | undefined, pid: string, codigo: string, mensagem?: string | RegExp) => {
    expect(r, JSON.stringify(r)).toMatchObject({ id: pid, status: 'rejeitado', codigo, ...(mensagem !== undefined ? { mensagem: typeof mensagem === 'string' ? mensagem : expect.stringMatching(mensagem) } : {}) });
    expect(await doc(pid), 'recusado: nada gravado').toBeUndefined();
  };
  /** A.c1 a prazo: o ERP manda o crédito disponível (como a Integração gravaria), o resto da linha fica. */
  const disponivelErpA = (cents: number | null) => q('update core.cliente_financeiro set credito_disponivel_cents = $2 where tenant_id = $3 and cliente_id = $1', [A.clientes.c1, cents, A.tenantId]);

  beforeAll(async () => {
    api = await subirApi({ plataforma: { segredo: () => SEGREDO_PLATAFORMA } });
    tk.admin = (await api.sessao('admin@exemplo.com.br')).access_token;
    tk.analista = (await api.sessao('analista@exemplo.com.br')).access_token;
    tk.gerente = (await api.sessao('gerente@exemplo.com.br')).access_token;
    tk.supervisor = (await api.sessao('supervisor@exemplo.com.br')).access_token;
    tk.vendedor = (await api.sessao('vendedor@exemplo.com.br')).access_token;
    tk.promotor = (await api.sessao('promotor@exemplo.com.br')).access_token;
    tk.adminB = (await api.sessao('admin.b@exemplo.com.br', B)).access_token;
    tk.vendedorB = (await api.sessao('vendedor@exemplo.com.br', B)).access_token;
    prodA = (await q<{ id: string }>("select id from core.produto where tenant_id = $1 and sku = 'ALFA-001'", [A.tenantId]))[0]!.id;
    prodB = (await q<{ id: string }>("select id from core.produto where tenant_id = $1 and sku = 'BETA-001'", [B.tenantId]))[0]!.id;
    // Banco próprio do arquivo: saldo folgado e controlado do ALFA-001 e do BETA-001 (os casos de estoque pedem FALTA > SALDO)
    await q('update catalogo.estoque_saldo set quantidade = $3 where tenant_id = $1 and produto_id = $2 and deleted_at is null', [A.tenantId, prodA, SALDO]);
    await q('update catalogo.estoque_saldo set quantidade = $3 where tenant_id = $1 and produto_id = $2 and deleted_at is null', [B.tenantId, prodB, SALDO]);
    await limparParametros();
    // Licença (RN-CORE-01): na fixture o admin de A não tem o Vendedor (nem o Catálogo) no perfil; o de B tem o Vendedor removido.
    for (const t of [tk.admin, tk.adminB]) {
      const semLicenca = await chamar(t, 'GET');
      expect([semLicenca.status, erroDe(semLicenca.r).codigo], 'admin sem o Vendedor').toEqual([403, 'MODULO_INATIVO']);
    }
    for (const m of ['catalogo', 'vendedor']) expect((await licenca(api, tk.admin, 'perfil', m, true, 'admin')).statusCode, m).toBe(200);
    expect((await licenca(api, tk.adminB, 'usuario', 'vendedor', true, B.usuarios.admin)).statusCode).toBe(200);
  }, 300_000);
  afterAll(async () => {
    await api?.fechar();
  });

  // ------------------------------------------------------------------------------------------------ rota
  describe('R. Rota GET|PUT: padrão sem linha, três valores de cada chave, faixa, mensagens e auditoria', () => {
    it('R1 PA-1: sem linha gravada, o GET devolve as cinco chaves com os padrões (0, aprovacao, orcamento) para admin, analista e gerente', async () => {
      for (const t of [tk.admin, tk.analista, tk.gerente]) {
        const r = await chamar(t, 'GET');
        expect([r.status, r.corpo]).toEqual([200, { titulo_vencido_dias: 5, validade_orcamento_dias: 7, ...PADRAO }]);
      }
      expect(await noBanco(A.tenantId), 'o GET não grava o padrão').toEqual({});
    });

    it('R2 RN-VEN-12 e RN-VEN-20: as três ações de cada chave gravam, voltam no GET e ficam no banco como texto; o PUT parcial mantém o resto', async () => {
      for (const credito of ['orcamento', 'avisar', 'aprovacao'] as const) {
        expect(await gravar(tk.gerente, { credito_excedido_acao: credito })).toMatchObject({ ...PADRAO, credito_excedido_acao: credito });
        expect((await noBanco(A.tenantId)).credito_excedido_acao).toBe(credito);
      }
      for (const estoque of ['aprovacao', 'avisar', 'orcamento'] as const) {
        expect(await gravar(tk.analista, { estoque_insuficiente_acao: estoque })).toMatchObject({ ...PADRAO, estoque_insuficiente_acao: estoque });
        expect((await noBanco(A.tenantId)).estoque_insuficiente_acao).toBe(estoque);
      }
      expect((await chamar(tk.admin, 'GET')).corpo).toMatchObject(PADRAO);
    });

    it('R3 RN-VEN-22 (PA-9): 0, 1, 150.000 e 10.000.000 centavos gravam como número inteiro; fora da faixa, fração, texto e nulo = 422 com a mensagem e nada muda', async () => {
      for (const v of [1, 10_000_000, 150_000, 0]) {
        expect(await gravar(tk.admin, { pedido_minimo_cents: v })).toMatchObject({ pedido_minimo_cents: v });
        expect((await noBanco(A.tenantId)).pedido_minimo_cents, `${v} no banco`).toBe(v);
      }
      await gravar(tk.admin, { pedido_minimo_cents: 150_000 });
      const estado = await noBanco(A.tenantId);
      for (const [corpo, codigo, mensagem] of [
        [{ pedido_minimo_cents: -1 }, 'RN-VEN-22', MSG_MINIMO],
        [{ pedido_minimo_cents: 10_000_001 }, 'RN-VEN-22', MSG_MINIMO],
        [{ pedido_minimo_cents: 1500.5 }, 'RN-VEN-22', MSG_MINIMO],
        [{ pedido_minimo_cents: '150000' }, 'RN-VEN-22', MSG_MINIMO],
        [{ pedido_minimo_cents: null }, 'RN-VEN-22', MSG_MINIMO],
        [{ credito_excedido_acao: 'cortar' }, 'RN-VEN-12', MSG_CREDITO],
        [{ credito_excedido_acao: 'APROVACAO' }, 'RN-VEN-12', MSG_CREDITO],
        [{ credito_excedido_acao: '' }, 'RN-VEN-12', MSG_CREDITO],
        [{ estoque_insuficiente_acao: 'cortar' }, 'RN-VEN-20', MSG_ESTOQUE],
        [{ estoque_insuficiente_acao: 1 }, 'RN-VEN-20', MSG_ESTOQUE],
        [{ credito_excedido_acao: 'avisar', pedido_minimo_cents: 10_000_001 }, 'RN-VEN-22', MSG_MINIMO],
        [{ pedido_minimo_cents: 200, estoque_insuficiente_acao: 'cortar' }, 'RN-VEN-20', MSG_ESTOQUE],
      ] as const) {
        const r = await chamar(tk.admin, 'PUT', corpo);
        const e = erroDe(r.r);
        expect([r.status, e.codigo, e.mensagem], JSON.stringify(corpo)).toEqual([422, codigo, mensagem]);
      }
      expect(await noBanco(A.tenantId), 'o 422 não grava nem a chave válida do mesmo corpo').toEqual(estado);
      expect((await chamar(tk.admin, 'PUT', { pedido_minimo_cents: 100, credito_excedido: 'avisar' })).status, 'campo estranho').toBe(400);
      expect((await chamar(tk.admin, 'PUT', {})).status, 'corpo vazio').toBe(422);
      await gravar(tk.admin, { pedido_minimo_cents: 0 });
    });

    it('R4 RN-AUD-01 e idempotência: o mesmo corpo reenviado responde 200 e não audita; mudar duas chaves audita só as duas, com antes e depois', async () => {
      await gravar(tk.admin, { pedido_minimo_cents: 50_000, credito_excedido_acao: 'aprovacao', estoque_insuficiente_acao: 'orcamento' });
      const antes = await auditorias(A.tenantId);
      for (let i = 0; i < 2; i += 1) await gravar(tk.admin, { pedido_minimo_cents: 50_000, credito_excedido_acao: 'aprovacao', estoque_insuficiente_acao: 'orcamento' });
      expect(await auditorias(A.tenantId), 'reenvio igual não audita').toBe(antes);
      await gravar(tk.gerente, { pedido_minimo_cents: 60_000, credito_excedido_acao: 'avisar', estoque_insuficiente_acao: 'orcamento' });
      const depois = await auditorias(A.tenantId);
      expect(depois - antes, 'uma auditoria por gravação que mudou algo').toBe(1);
      const [ult] = await q<{ antes: Linha; depois: Linha }>("select antes, depois from plataforma.auditoria where tenant_id = $1 and acao = 'alcada.gerenciar' and entidade = 'parametro' order by created_at desc limit 1", [A.tenantId]);
      expect(ult).toEqual({ antes: { pedido_minimo_cents: 50_000, credito_excedido_acao: 'aprovacao' }, depois: { pedido_minimo_cents: 60_000, credito_excedido_acao: 'avisar' } });
      await limparParametros();
    });
  });

  // ------------------------------------------------------------------------------------------------ permissões e licença
  describe('P. Permissões e licença (alcada.gerenciar, RN-CORE-01, RN-PRO-01)', () => {
    it('P1 vendedor, supervisor e promotor = 403 no GET e no PUT das três chaves; nada é gravado', async () => {
      for (const [quem, t] of [['vendedor', tk.vendedor], ['supervisor', tk.supervisor], ['promotor', tk.promotor]] as const) {
        expect((await chamar(t, 'GET')).status, `${quem} GET`).toBe(403);
        for (const corpo of [{ pedido_minimo_cents: 1 }, { credito_excedido_acao: 'avisar' }, { estoque_insuficiente_acao: 'avisar' }]) {
          expect((await chamar(t, 'PUT', corpo)).status, `${quem} PUT ${JSON.stringify(corpo)}`).toBe(403);
        }
      }
      expect(await noBanco(A.tenantId)).toEqual({});
    });

    it('P2 Vendedor desligado no tenant: GET e PUT = 403 MODULO_INATIVO e nada grava; religado, 200 com o padrão', async () => {
      expect((await licenca(api, tk.admin, 'tenant', 'vendedor', false)).statusCode).toBe(200);
      try {
        for (const r of [await chamar(tk.admin, 'GET'), await chamar(tk.gerente, 'PUT', { estoque_insuficiente_acao: 'avisar' })]) expect([r.status, erroDe(r.r).codigo]).toEqual([403, 'MODULO_INATIVO']);
      } finally {
        expect((await licenca(api, tk.admin, 'tenant', 'vendedor', true)).statusCode).toBe(200);
      }
      expect(await noBanco(A.tenantId)).toEqual({});
      expect((await chamar(tk.gerente, 'GET')).corpo).toMatchObject(PADRAO);
    });

    it('P3 RN-PRO-01: com estoque e crédito em "avisar", o promotor continua sem criar pedido pelo push (rejeitado, nada gravado)', async () => {
      await gravar(tk.admin, { credito_excedido_acao: 'avisar', estoque_insuficiente_acao: 'avisar' });
      try {
        const pid = novo();
        const [r] = await push(tk.promotor, [pedidoA(pid)]);
        expect(r, JSON.stringify(r)).toMatchObject({ id: pid, status: 'rejeitado' });
        expect(['RN-PRO-01', 'MODULO_INATIVO', 'PERFIL_SEM_ACESSO']).toContain((r as { codigo?: string }).codigo);
        expect(await doc(pid)).toBeUndefined();
      } finally {
        await limparParametros();
      }
    });

    it('P4 PA-10: o nível do estoque em Alçadas — gerente grava `aprovador_estoque` (GET /alcadas devolve; padrão gerente); vendedor = 403', async () => {
      expect((await chamar(tk.gerente, 'GET', undefined, '/v1/vendedor/alcadas')).corpo).toMatchObject({ aprovador_estoque: 'gerente' });
      const corpo = { aprovador_credito: 'gerente', aprovador_inadimplencia: 'gerente', aprovador_estoque: 'supervisor' };
      expect((await chamar(tk.vendedor, 'PUT', corpo, '/v1/vendedor/alcadas/aprovadores')).status).toBe(403);
      const r = await chamar(tk.gerente, 'PUT', corpo, '/v1/vendedor/alcadas/aprovadores');
      expect([r.status, r.corpo], r.r.body).toEqual([200, corpo]);
      expect((await chamar(tk.gerente, 'GET', undefined, '/v1/vendedor/alcadas')).corpo).toMatchObject({ aprovador_estoque: 'supervisor' });
      expect(await noBanco(A.tenantId, ['aprovacao.estoque_nivel'])).toEqual({ 'aprovacao.estoque_nivel': 'supervisor' });
      // sem `aprovador_estoque` o PUT não apaga o nível do estoque
      expect((await chamar(tk.gerente, 'PUT', { aprovador_credito: 'gerente', aprovador_inadimplencia: 'gerente' }, '/v1/vendedor/alcadas/aprovadores')).status).toBe(200);
      expect(await noBanco(A.tenantId, ['aprovacao.estoque_nivel'])).toEqual({ 'aprovacao.estoque_nivel': 'supervisor' });
      await limparParametros();
    });
  });

  // ------------------------------------------------------------------------------------------------ pedido mínimo
  describe('M. RN-VEN-22 pedido mínimo, pelo push real (A.c1, PIX à vista)', () => {
    it('M0 sonda × oráculo: 2 × ALFA-001 sem parâmetro = aceito, total R$ 2.000,00 (preço da tabela × quantidade)', async () => {
      const pid = novo();
      aceito((await push(tk.vendedor, [pedidoA(pid, { qtd: 2 })]))[0], pid);
      expect(await doc(pid)).toMatchObject({ tipo: 'pedido', total_cents: String(2 * PRECO_ALFA) });
    });

    it('M1 um centavo abaixo (mínimo R$ 2.000,01) = rejeitado RN-VEN-22 com o valor em reais na mensagem; igual (R$ 2.000,00) passa', async () => {
      const total = 2 * PRECO_ALFA;
      await gravar(tk.gerente, { pedido_minimo_cents: total + 1 });
      const abaixo = novo();
      await recusado((await push(tk.vendedor, [pedidoA(abaixo, { qtd: 2 })]))[0], abaixo, 'RN-VEN-22', recusaMinimo(total + 1));
      expect(reais(total + 1)).toBe('R$ 2.000,01');
      await gravar(tk.gerente, { pedido_minimo_cents: total });
      const igual = novo();
      aceito((await push(tk.vendedor, [pedidoA(igual, { qtd: 2 })]))[0], igual);
      expect((await doc(igual))!.total_cents).toBe(String(total));
    });

    it('M2 PA-4: a base é o total final com o desconto — 10% sobre R$ 2.000,00 = R$ 1.800,00, abaixo do mínimo de R$ 2.000,00', async () => {
      await gravar(tk.gerente, { pedido_minimo_cents: 2 * PRECO_ALFA });
      const pid = novo();
      await recusado((await push(tk.vendedor, [pedidoA(pid, { qtd: 2, desconto: 10 })]))[0], pid, 'RN-VEN-22', recusaMinimo(2 * PRECO_ALFA));
      // oráculo PA-4: 1.800,00 passa com o mínimo de 1.800,00
      await gravar(tk.gerente, { pedido_minimo_cents: 180_000 });
      const ok = novo();
      aceito((await push(tk.vendedor, [pedidoA(ok, { qtd: 2, desconto: 10 })]))[0], ok);
      expect((await doc(ok))!.total_cents).toBe('180000');
    });

    it('M3 idempotência (RN-VEN-33): o reenvio do recusado é recusado de novo, sem gravar; o aceito reenviado responde aceito e grava uma linha só', async () => {
      await gravar(tk.gerente, { pedido_minimo_cents: 10_000_000 });
      const rec = novo();
      const corpo = pedidoA(rec);
      for (let i = 0; i < 2; i += 1) await recusado((await push(tk.vendedor, [corpo]))[0], rec, 'RN-VEN-22', recusaMinimo(10_000_000));
      await gravar(tk.gerente, { pedido_minimo_cents: PRECO_ALFA });
      const ok = novo();
      const corpoOk = pedidoA(ok);
      aceito((await push(tk.vendedor, [corpoOk]))[0], ok);
      aceito((await push(tk.vendedor, [corpoOk]))[0], ok);
      expect((await q<{ n: number }>('select count(*)::int as n from vendedor.pedido where id = $1', [ok]))[0]!.n).toBe(1);
      expect((await q<{ n: number }>('select count(*)::int as n from vendedor.pedido_item where pedido_id = $1 and deleted_at is null', [ok]))[0]!.n).toBe(1);
    });

    it('M4 PA-3: o orçamento nunca é barrado pelo mínimo (R$ 100.000,00); o Transformar dele em pedido abaixo do mínimo é recusado com RN-VEN-22', async () => {
      await gravar(tk.gerente, { pedido_minimo_cents: 10_000_000 });
      const orc = novo();
      aceito((await push(tk.vendedor, [pedidoA(orc, { tipo: 'orcamento' })]))[0], orc);
      expect(await doc(orc)).toMatchObject({ tipo: 'orcamento', status: 'received' });
      const transformado = novo();
      await recusado((await push(tk.vendedor, [pedidoA(transformado, { origem: orc })]))[0], transformado, 'RN-VEN-22', recusaMinimo(10_000_000));
      await limparParametros();
    });
  });

  // ------------------------------------------------------------------------------------------------ crédito excedido
  describe('C. RN-VEN-12 crédito excedido (A.c1 a prazo, crédito disponível do ERP = R$ 0,01)', () => {
    beforeAll(async () => {
      // o título vencido do A.c1 (10 dias) não entra: só o crédito decide (RN-VEN-13 com 30)
      await q("insert into plataforma.parametro (tenant_id, modulo, chave, valor) values ($1, 'vendedor', 'titulo_vencido_dias', '30'::jsonb)", [A.tenantId]);
      await disponivelErpA(1);
    });
    afterAll(async () => {
      await disponivelErpA(null);
      await limparParametros();
    });

    it('C1 sem linha (padrão aprovacao): a prazo acima do crédito = pending_approval com a aprovação `credito` (gerente)', async () => {
      const pid = novo();
      aceito((await push(tk.vendedor, [pedidoA(pid, { prazo: true })]))[0], pid);
      expect(await doc(pid)).toMatchObject({ status: 'pending_approval', motivos_aprovacao: ['credito'], nivel_aprovacao: 'gerente' });
      expect(await aprovacoes(pid)).toEqual(['credito:gerente:pendente']);
    });

    it('C2 aprovacao gravada pela rota = o mesmo do padrão', async () => {
      await gravar(tk.gerente, { credito_excedido_acao: 'aprovacao' });
      const pid = novo();
      aceito((await push(tk.vendedor, [pedidoA(pid, { prazo: true })]))[0], pid);
      expect(await aprovacoes(pid)).toEqual(['credito:gerente:pendente']);
    });

    it('C3 orcamento: a prazo = rejeitado RN-VEN-12 (nada gravado, nenhuma aprovação); à vista passa (RN-VEN-12 só a prazo); orçamento passa', async () => {
      await gravar(tk.gerente, { credito_excedido_acao: 'orcamento' });
      const pid = novo();
      await recusado((await push(tk.vendedor, [pedidoA(pid, { prazo: true })]))[0], pid, 'RN-VEN-12', MSG_RECUSA_CREDITO);
      expect(await aprovacoes(pid)).toEqual([]);
      const avista = novo();
      aceito((await push(tk.vendedor, [pedidoA(avista)]))[0], avista);
      expect(await doc(avista)).toMatchObject({ status: 'approved' });
      const orc = novo();
      aceito((await push(tk.vendedor, [pedidoA(orc, { tipo: 'orcamento' })]))[0], orc);
      expect((await doc(orc))!.tipo).toBe('orcamento');
    });

    it('C4 avisar: a prazo acima do crédito segue aprovado, sem aprovação de crédito', async () => {
      await gravar(tk.gerente, { credito_excedido_acao: 'avisar' });
      const pid = novo();
      aceito((await push(tk.vendedor, [pedidoA(pid, { prazo: true })]))[0], pid);
      expect(await doc(pid)).toMatchObject({ status: 'approved', motivos_aprovacao: [] });
      expect(await aprovacoes(pid)).toEqual([]);
    });

    it('C5 precedência: mínimo acima do total com crédito em orcamento = a recusa é a do mínimo (RN-VEN-22)', async () => {
      await gravar(tk.gerente, { credito_excedido_acao: 'orcamento', pedido_minimo_cents: PRECO_ALFA + 1 });
      const pid = novo();
      await recusado((await push(tk.vendedor, [pedidoA(pid, { prazo: true })]))[0], pid, 'RN-VEN-22', recusaMinimo(PRECO_ALFA + 1));
      await q("delete from plataforma.parametro where tenant_id = $1 and modulo = 'vendedor' and chave = 'pedido_minimo_cents'", [A.tenantId]);
    });

    it('C6 com crédito folgado a ação orcamento não muda nada (aprovado)', async () => {
      await gravar(tk.gerente, { credito_excedido_acao: 'orcamento' });
      await disponivelErpA(100_000_000);
      try {
        const pid = novo();
        aceito((await push(tk.vendedor, [pedidoA(pid, { prazo: true })]))[0], pid);
        expect(await doc(pid)).toMatchObject({ status: 'approved' });
      } finally {
        await disponivelErpA(1);
      }
    });
  });

  // ------------------------------------------------------------------------------------------------ estoque insuficiente
  describe('E. RN-VEN-20 estoque insuficiente (A.c1 à vista, quantidade acima do saldo da filial)', () => {
    beforeAll(async () => {
      await q("insert into plataforma.parametro (tenant_id, modulo, chave, valor) values ($1, 'vendedor', 'titulo_vencido_dias', '30'::jsonb)", [A.tenantId]);
    });
    afterAll(async () => {
      await limparParametros();
    });

    it('E1 sem linha (padrão orcamento): rejeitado RN-VEN-20, nada gravado', async () => {
      const pid = novo();
      await recusado((await push(tk.vendedor, [pedidoA(pid, { qtd: FALTA })]))[0], pid, 'RN-VEN-20', MSG_RECUSA_ESTOQUE);
    });

    it('E2 orcamento gravado pela rota = o mesmo do padrão', async () => {
      await gravar(tk.analista, { estoque_insuficiente_acao: 'orcamento' });
      const pid = novo();
      await recusado((await push(tk.vendedor, [pedidoA(pid, { qtd: FALTA })]))[0], pid, 'RN-VEN-20');
    });

    it('E3 aprovacao: pending_approval com a aprovação `estoque` no nível padrão (gerente); o aprovacao_solicitada@2 leva o motivo; com o nível supervisor em Alçadas, supervisor', async () => {
      await gravar(tk.analista, { estoque_insuficiente_acao: 'aprovacao' });
      const pid = novo();
      aceito((await push(tk.vendedor, [pedidoA(pid, { qtd: FALTA })]))[0], pid);
      expect(await doc(pid)).toMatchObject({ status: 'pending_approval', nivel_aprovacao: 'gerente', motivos_aprovacao: ['estoque'] });
      expect(await aprovacoes(pid)).toEqual(['estoque:gerente:pendente']);
      const ev = await q<{ payload: Linha }>("select payload from plataforma.evento where agregado_id = $1 and nome = 'vendedor.pedido.aprovacao_solicitada@2'", [pid]);
      expect(ev, 'aprovacao_solicitada@2 publicado').toHaveLength(1);
      expect(ev[0]!.payload).toMatchObject({ motivos: ['estoque'], aprovacoes: [{ motivo: 'estoque', nivel: 'gerente' }] });
      const r = await chamar(tk.gerente, 'PUT', { aprovador_credito: 'gerente', aprovador_inadimplencia: 'gerente', aprovador_estoque: 'supervisor' }, '/v1/vendedor/alcadas/aprovadores');
      expect(r.status, r.r.body).toBe(200);
      const sup = novo();
      aceito((await push(tk.vendedor, [pedidoA(sup, { qtd: FALTA })]))[0], sup);
      expect(await aprovacoes(sup)).toEqual(['estoque:supervisor:pendente']);
    });

    it('E4 idempotência: o reenvio do pedido em aprovação por estoque responde aceito e não abre outra aprovação', async () => {
      await gravar(tk.analista, { estoque_insuficiente_acao: 'aprovacao' });
      const pid = novo();
      const corpo = pedidoA(pid, { qtd: FALTA });
      aceito((await push(tk.vendedor, [corpo]))[0], pid);
      aceito((await push(tk.vendedor, [corpo]))[0], pid);
      expect(await aprovacoes(pid)).toHaveLength(1);
    });

    it('E5 avisar: segue aprovado, sem aprovação de estoque; com saldo suficiente, nenhuma ação muda o pedido', async () => {
      await gravar(tk.analista, { estoque_insuficiente_acao: 'avisar' });
      const pid = novo();
      aceito((await push(tk.vendedor, [pedidoA(pid, { qtd: FALTA })]))[0], pid);
      expect(await doc(pid)).toMatchObject({ status: 'approved', motivos_aprovacao: [] });
      expect(await aprovacoes(pid)).toEqual([]);
      // os pedidos aceitos acima (avisar e aprovação) reservam o FALTA (RN-VEN-20: reserva = itens dos pedidos aceitos e abertos):
      // o saldo sobe para sobrar disponível de novo
      await q('update catalogo.estoque_saldo set quantidade = $3 where tenant_id = $1 and produto_id = $2 and deleted_at is null', [A.tenantId, prodA, 10_000_000]);
      await gravar(tk.analista, { estoque_insuficiente_acao: 'aprovacao' });
      const ok = novo();
      aceito((await push(tk.vendedor, [pedidoA(ok)]))[0], ok);
      expect(await doc(ok)).toMatchObject({ status: 'approved', motivos_aprovacao: [] });
    });
  });

  // ------------------------------------------------------------------------------------------------ multi-tenant
  describe('T. Multi-tenant (RN-CORE-05): dois tenants com parâmetros diferentes, sem herança', () => {
    afterAll(async () => {
      await limparParametros();
    });

    it('T1 A grava as três chaves; B lê só os padrões; B grava outras; cada tenant tem as próprias linhas', async () => {
      await gravar(tk.admin, { pedido_minimo_cents: 10_000_000, credito_excedido_acao: 'orcamento', estoque_insuficiente_acao: 'orcamento' });
      expect((await chamar(tk.adminB, 'GET')).corpo).toMatchObject(PADRAO);
      expect(await noBanco(B.tenantId)).toEqual({});
      const deB = { pedido_minimo_cents: 0, credito_excedido_acao: 'avisar', estoque_insuficiente_acao: 'avisar' };
      expect(await gravar(tk.adminB, deB)).toMatchObject(deB);
      expect(await noBanco(B.tenantId)).toEqual(deB);
      expect(await noBanco(A.tenantId)).toEqual({ pedido_minimo_cents: 10_000_000, credito_excedido_acao: 'orcamento', estoque_insuficiente_acao: 'orcamento' });
      expect((await chamar(tk.admin, 'GET')).corpo).toMatchObject({ pedido_minimo_cents: 10_000_000, credito_excedido_acao: 'orcamento', estoque_insuficiente_acao: 'orcamento' });
    });

    it('T2 o push de cada tenant usa os parâmetros dele: em A o mínimo de R$ 100.000,00 recusa e o estoque recusa; em B (avisar, sem mínimo) os mesmos casos passam', async () => {
      const a1 = novo();
      await recusado((await push(tk.vendedor, [pedidoA(a1)]))[0], a1, 'RN-VEN-22', recusaMinimo(10_000_000));
      const b1 = novo();
      aceito((await push(tk.vendedorB, [pedidoB(b1)]))[0], b1);
      const b2 = novo();
      aceito((await push(tk.vendedorB, [pedidoB(b2, FALTA)]))[0], b2);
      expect(await aprovacoes(b2)).toEqual([]);
      // B volta ao padrão (sem linha): o mesmo FALTA em B é recusado; A sem o mínimo e com estoque avisar passa
      await q("delete from plataforma.parametro where tenant_id = $1 and modulo = 'vendedor' and chave = any($2::text[])", [B.tenantId, [...NOVAS]]);
      await gravar(tk.admin, { pedido_minimo_cents: 0, estoque_insuficiente_acao: 'avisar' });
      const b3 = novo();
      await recusado((await push(tk.vendedorB, [pedidoB(b3, FALTA)]))[0], b3, 'RN-VEN-20');
      const a2 = novo();
      aceito((await push(tk.vendedor, [pedidoA(a2, { qtd: FALTA })]))[0], a2);
    });
  });

  // ------------------------------------------------------------------------------------------------ passo Empresa
  describe('Q. PA-1: o passo Empresa não grava as três chaves', () => {
    it('Q1 linhasDosParametrosIniciais (com e sem parâmetros) não traz nenhuma das três chaves', () => {
      for (const p of [{}, { validade_orcamento_dias: 12, alcada_vendedor_pct: 3 }]) {
        const chaves = linhasDosParametrosIniciais(ParametrosIniciaisSchema.parse(p)).map((l) => l.chave);
        for (const c of NOVAS) expect(chaves, JSON.stringify(p)).not.toContain(c);
      }
    });

    it('Q2 POST /v1/plataforma/empresas (portal real) cria a empresa sem as três chaves no banco; o gerente da empresa nova lê os padrões no GET', async () => {
      await criarSuperAdmin(api.admin, SA);
      const s = await sessaoDoPortal(api, SA.email, SA.senha);
      const r = await api.app.inject({
        method: 'POST',
        url: '/v1/plataforma/empresas',
        headers: { ...comToken(s.token), 'x-request-id': crypto.randomUUID() },
        payload: { ...EMPRESA, modulos: [{ modulo: 'catalogo', licencas: null }, { modulo: 'vendedor', licencas: null }], parametros: { validade_orcamento_dias: 12 }, admin: ADMIN_INICIAL },
      });
      expect(r.statusCode, r.body).toBe(201);
      const criada = CriarEmpresaRespostaSchema.parse(r.json());
      for (const c of NOVAS) expect(criada.parametros_gravados).not.toContain(c);
      const tenant = criada.tenant_id!;
      expect(await noBanco(tenant, [...NOVAS, 'validade_orcamento_dias'])).toEqual({ validade_orcamento_dias: 12 });
      // um gerente gravado pela administração (o admin inicial cria a senha no 1º uso, T-0094)
      const email = 'gerente.v1039@exemplo.com.br';
      await criarUsuarioNoTenant(api.admin, { tenantId: tenant, email, nome: 'Gerente Fictício V1039', senha: SENHA, perfil: 'gerente' });
      const login = await api.entrar(email, { tenant: { ...A, codigo: EMPRESA.codigo } as typeof A });
      expect(login.statusCode, login.body).toBe(200);
      const token = (login.json() as { access_token: string }).access_token;
      const g = await chamar(token, 'GET');
      expect([g.status, g.corpo], g.r.body).toEqual([200, { titulo_vencido_dias: 5, validade_orcamento_dias: 12, ...PADRAO }]);
    });
  });
});
