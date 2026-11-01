/**
 * Validação da T-0018 (rotas e visitas reais; RF-CORE-05/06/07; RN-CORE-04/05/10/11/13/14; D-2) pelo agente `testes`,
 * de ponta a ponta: o app Campo (motor de sync REAL do platform-sdk + as funções de tela do Core —
 * `fazerCheckin`/`fazerCheckout` de `acoes-visita.ts` e o estado montado por `ArmazemCore` das linhas do aparelho ⊕ fila)
 * conversando com o `createApp` REAL (8 módulos, JWT de verdade, `tx.publicar` e `tx.registrarArquivo` reais,
 * `PUT /v1/arquivos/:id` com armazenamento em memória) sobre o Postgres como `macuxi_app` (RLS).
 * Só o que depende do hardware é trocado: `dispositivo.ts` (expo-crypto/expo-location) vira UUID do Node e um GPS
 * controlado pelo teste. Cenários S1-040..S1-049 de tests/plano/sprint-1.md (critérios §4.7 do desenho T-0016).
 */
import { randomUUID } from 'node:crypto';
import { semBanco } from '@macuxi/db/teste/estado';
import { caminhoFoto, type ItemPush, type LinhaSync, type ResultadoItemPush } from '@macuxi/platform-sdk';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { criarArmazenamentoEmMemoria as armazenamentoDeFotos } from '../../../apps/api/src/arquivos';
import { fazerCheckin, fazerCheckout, type ContextoAcao } from '../../../modules/core/app/lib/acoes-visita';
import { etapasCore } from '../../../modules/core/app/lib/cargas';
import { armazemDe } from '../../../modules/core/app/lib/estado';
import { etapasVendedor } from '../../../modules/vendedor/app/etapas';
import { A, B, erroDe, subirApi, type ApiDeTeste, type Tenant } from '../apoio/api';
import { aparelhoCampo, esperarHorizonte, jpeg, type AparelhoCampo, type OpcoesAparelho } from '../apoio/campo';

/** GPS do "aparelho": lido UMA vez por ação (RN-CORE-13); `null` = sem sinal de GPS. */
const gps = vi.hoisted(() => ({ posicao: null as null | { lat: number; lng: number; precisao_m: number | null } }));
vi.mock('../../../modules/core/app/lib/dispositivo', () => ({
  uuid: () => globalThis.crypto.randomUUID(),
  gpsAgora: async () => gps.posicao,
}));

const C = A.clientes;
const U = A.usuarios;
/** c1 (Auto Peças Um, Manaus) e ~900 m ao sul dele; c3 (Manacapuru) não tem coordenada. */
const EM_C1 = { lat: -3.1019, lng: -60.025, precisao_m: 8 };
const LONGE_C1 = { lat: -3.11, lng: -60.025, precisao_m: 15 };
const EM_C3 = { lat: -3.2995, lng: -60.6206, precisao_m: 12 };

interface Campo {
  ap: AparelhoCampo;
  acao: ContextoAcao;
  armazem: ReturnType<typeof armazemDe>;
}

describe.skipIf(semBanco())('T-0018 — rota e visitas reais no app Campo × API real × Postgres', () => {
  let api: ApiDeTeste;
  let analista: string;
  let supervisor: string;
  const fotosNoServidor = armazenamentoDeFotos();

  const noCampo = async (email: string, op: OpcoesAparelho = {}): Promise<Campo> => {
    const ap = await aparelhoCampo(api, email, op);
    const armazem = armazemDe(ap.motor);
    return { ap, armazem, acao: { motor: ap.motor, armazem, tz: ap.sessao.tenant.fuso, vendedorId: ap.sessao.usuario.id } };
  };
  const visita = async (id: string) => (await api.admin.query('select * from core.visita where id = $1', [id])).rows[0] as Record<string, unknown> | undefined;
  const contarEventos = async (nome: string, agregado: string) =>
    Number((await api.admin.query('select count(*)::int as n from plataforma.evento where nome = $1 and agregado_id = $2', [nome, agregado])).rows[0].n);
  const parametroRaio = (tenant: Tenant, valor: number) =>
    api.admin.query("update plataforma.parametro set valor = $2::jsonb where tenant_id = $1 and modulo = 'core' and chave = 'checkin.raio_m'", [tenant.tenantId, JSON.stringify(valor)]);
  const push = async (token: string, itens: ItemPush[]): Promise<ResultadoItemPush[]> => {
    const r = await api.chamar(token, { method: 'POST', url: '/v1/sync/push', payload: { itens } });
    expect(r.statusCode, r.body).toBe(200);
    return (r.json() as { resultados: ResultadoItemPush[] }).resultados;
  };
  const checkinCru = (vid: string, cliente: string, extra: Record<string, unknown> = {}): ItemPush => ({
    id: vid,
    entidade: 'visita',
    operacao: 'upsert',
    payload: { id: vid, cliente_id: cliente, checkin_em: new Date().toISOString(), extra: true, ...extra },
  });
  const checkoutCru = (cmd: string, vid: string, extra: Record<string, unknown> = {}): ItemPush => ({
    id: cmd,
    entidade: 'visita_checkout',
    operacao: 'upsert',
    payload: { id: cmd, visita_id: vid, checkout_em: new Date().toISOString(), resultado: 'sem_pedido', motivo_id: A.motivos.estoqueAlto, etapas: [], ...extra },
  });
  /** Fecha o atendimento aberto do usuário pelo app (para o cenário seguinte começar sem visita aberta). */
  const fecharAberta = async (c: Campo) => {
    await c.armazem.carregar();
    const aberta = c.armazem.obter().visitas.find((v) => v.seller_id === c.ap.sessao.usuario.id && !v.checkout_at);
    if (aberta) await fazerCheckout(c.acao, aberta.id, { resultado: 'sem_pedido', motivo_id: A.motivos.estoqueAlto });
    expect(await c.ap.sincronizar()).toBe(true);
    expect(c.ap.motor.estado().fila).toEqual([]);
  };

  beforeAll(async () => {
    api = await subirApi({ arquivos: fotosNoServidor });
    analista = (await api.sessao('analista@exemplo.com.br')).access_token;
    supervisor = (await api.sessao('supervisor@exemplo.com.br')).access_token;
    await esperarHorizonte(); // a fixture acabou de entrar: o pull só devolve linhas com updated_at < now() − 2 s
  });
  afterAll(async () => {
    await api?.fechar();
  });
  // cada cenário começa sem atendimento aberto do vendedor-1 e do promotor (um cenário que falha não contamina o seguinte);
  // a visita aberta do vendedor-2 é da fixture e fica (S1-048)
  beforeEach(async () => {
    await api.admin.query(
      "update core.visita set checkout_em = now(), resultado = 'nao_finalizado', fechada_por = 'auto' where usuario_id = any($1::uuid[]) and checkout_em is null",
      [[U.vendedor1, U.promotor]],
    );
    gps.posicao = null;
  });

  it('S1-040 critério 1 (modo avião): abre a rota, faz check-in e checkout sem sinal; na volta sincroniza UMA visita com o UUID do aparelho; reenviar o lote não duplica', async () => {
    const c = await noCampo('vendedor@exemplo.com.br');
    expect(await c.ap.sincronizar()).toBe(true);
    await c.armazem.carregar();
    const rota = c.armazem.obter().rota;
    expect(rota, 'a rota de hoje do vendedor-1 chega pelo pull').not.toBeNull();
    expect(rota!.id).toBe(A.rotas.vendedor1);
    expect(new Set(rota!.stops.map((s) => s.customer.id))).toEqual(new Set([C.c1, C.c3]));
    const paradaC3 = rota!.stops.find((s) => s.customer.id === C.c3)!;
    expect(paradaC3.id).toBe(A.paradas.v1c3);
    expect(rota!.stops.find((s) => s.customer.id === C.c1)!.status, 'c1 já foi visitado hoje (fixture)').toBe('done');

    // ---- modo avião: nada sai do aparelho
    c.ap.online.valor = false;
    gps.posicao = EM_C3;
    const ci = await fazerCheckin(c.acao, paradaC3.customer, paradaC3.id);
    expect(ci.kind).toBe('created');
    if (ci.kind !== 'created') return;
    const vid = ci.visit.id;
    // RN-CORE-10: c3 não tem coordenada → o check-in segue e sugere a coordenada; GPS lido uma vez (RN-CORE-13)
    expect([ci.gps, ci.foraDoRaio, ci.sugereCoordenada]).toEqual([true, false, true]);
    expect(c.armazem.obter().rota!.stops.find((s) => s.id === paradaC3.id)!.status).toBe('in_progress');
    expect(await visita(vid), 'sem sinal nada chega ao servidor').toBeUndefined();

    const fechada = await fazerCheckout(c.acao, vid, { resultado: 'sem_pedido', motivo_id: A.motivos.estoqueAlto, cliente: 'Auto Peças Três' });
    expect(fechada?.checkout_at).toBeTruthy();
    expect(c.armazem.obter().rota!.stops.find((s) => s.id === paradaC3.id)!.status).toBe('done');
    const fila = c.ap.motor.estado().fila;
    expect(fila.map((i) => [i.entidade, i.situacao])).toEqual([
      ['visita', 'pendente'],
      ['visita_checkout', 'pendente'],
    ]);
    expect(fila[0]!.id, 'id do item = UUID da visita gerado no aparelho').toBe(vid);
    const comando = fila[1]!.id;
    expect(await c.ap.sincronizar()).toBe(false);
    expect(c.ap.motor.estado().erro).toMatch(/Sem sinal/);
    expect(c.ap.motor.estado().fila).toHaveLength(2);

    // ---- sinal de volta
    c.ap.online.valor = true;
    expect(await c.ap.sincronizar()).toBe(true);
    expect(c.ap.motor.estado().erro).toBeNull();
    expect(c.ap.motor.estado().fila).toEqual([]);
    const v = await visita(vid);
    expect(v).toMatchObject({
      id: vid,
      tenant_id: A.tenantId,
      usuario_id: U.vendedor1,
      cliente_id: C.c3,
      rota_parada_id: A.paradas.v1c3,
      checkout_id: comando,
      resultado: 'sem_pedido',
      motivo_id: A.motivos.estoqueAlto,
      fechada_por: 'usuario',
      fora_do_raio: false,
      sugere_coordenada: true,
      sem_gps: false,
      extra: false,
    });
    expect(Number(v!.checkin_lat)).toBeCloseTo(EM_C3.lat, 4);
    expect(await contarEventos('core.visita.checkin@1', vid)).toBe(1);
    expect(await contarEventos('core.visita.checkout@1', vid)).toBe(1);

    // reenvio do MESMO lote (o aparelho não recebeu a resposta, por exemplo): aceito, nada duplica
    const lote = c.ap.lotesEnviados.flat().filter((i) => i.id === vid || i.id === comando);
    expect(lote).toHaveLength(2);
    expect((await push(c.ap.token.valor, lote)).map((r) => r.status)).toEqual(['aceito', 'aceito']);
    expect(Number((await api.admin.query('select count(*)::int as n from core.visita where id = $1 or checkout_id = $2', [vid, comando])).rows[0].n)).toBe(1);
    expect(await contarEventos('core.visita.checkin@1', vid)).toBe(1);
    expect(await contarEventos('core.visita.checkout@1', vid)).toBe(1);
    expect(await visita(vid)).toMatchObject({ checkout_id: comando, resultado: 'sem_pedido' });

    // o pull seguinte traz a linha real e o aparelho mostra a parada feita, sem duplicar a visita
    await esperarHorizonte();
    expect(await c.ap.sincronizar()).toBe(true);
    await c.armazem.carregar();
    const linhas = (await c.ap.motor.linhas<LinhaSync & { checkout_id: string | null }>('visita')).filter((l) => l.id === vid);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]!.checkout_id).toBe(comando);
    expect(c.armazem.obter().visitas.filter((x) => x.id === vid)).toHaveLength(1);
    expect(c.armazem.obter().rota!.stops.find((s) => s.id === paradaC3.id)!.status).toBe('done');
  });

  it('S1-041 ADR 0009 §3: com o checkout ainda na fila (rede caiu só no envio), o pull NÃO reabre a visita; quando o envio passa, o servidor fecha com o checkout do aparelho', async () => {
    const c = await noCampo('vendedor@exemplo.com.br');
    expect(await c.ap.sincronizar()).toBe(true);
    await c.armazem.carregar();
    const paradaC1 = c.armazem.obter().rota!.stops.find((s) => s.customer.id === C.c1)!;
    gps.posicao = EM_C1;
    const ci = await fazerCheckin(c.acao, paradaC1.customer, paradaC1.id);
    expect(ci.kind).toBe('created');
    if (ci.kind !== 'created') return;
    const vid = ci.visit.id;
    expect(await c.ap.sincronizar()).toBe(true);
    expect(await visita(vid)).toMatchObject({ checkout_em: null, fora_do_raio: false });
    await esperarHorizonte();
    expect(await c.ap.sincronizar()).toBe(true); // a linha ABERTA já está no aparelho

    c.ap.rede.push = false; // o envio cai; o pull continua respondendo
    await fazerCheckout(c.acao, vid, { resultado: 'sem_pedido', motivo_texto: 'Comprador ausente' });
    expect(await c.ap.sincronizar()).toBe(true);
    expect(c.ap.motor.estado().fila.map((i) => [i.entidade, i.situacao])).toEqual([['visita_checkout', 'pendente']]);
    expect((await c.ap.motor.linhas<LinhaSync & { checkout_em: string | null }>('visita')).find((l) => l.id === vid)!.checkout_em, 'a linha do servidor segue aberta').toBeNull();
    await c.armazem.carregar();
    const local = c.armazem.obter().visitas.find((x) => x.id === vid)!;
    expect(local.checkout_at, 'a tela mostra fechada (item da fila vence a linha)').toBeTruthy();
    expect(c.armazem.obter().rota!.stops.find((s) => s.id === paradaC1.id)!.status).toBe('done');

    c.ap.rede.push = true;
    expect(await c.ap.sincronizar()).toBe(true);
    expect(c.ap.motor.estado().fila).toEqual([]);
    expect(await visita(vid)).toMatchObject({ resultado: 'sem_pedido', motivo_texto: 'Comprador ausente', fechada_por: 'usuario' });
  });

  // D-3 (corrigido: motor com `estado.aceitos` + `motor.sobreposicao()`, engenheiro-software R-20261031-215653; Core lendo a
  // sobreposição, modulo-core R-20261031-221100; ADR 0009 adendo §3): o item aceito segue sobreposto até o pull trazer a linha.
  it('S1-042 D-3 (ADR 0009 §3, adendo): depois que o check-in é aceito pelo servidor, o aparelho continua mostrando o atendimento aberto até o pull trazer a linha', async () => {
    const c = await noCampo('vendedor@exemplo.com.br');
    expect(await c.ap.sincronizar()).toBe(true);
    await c.armazem.carregar();
    const paradaC1 = c.armazem.obter().rota!.stops.find((s) => s.customer.id === C.c1)!;
    gps.posicao = EM_C1;
    const ci = await fazerCheckin(c.acao, paradaC1.customer, paradaC1.id);
    expect(ci.kind).toBe('created');
    if (ci.kind !== 'created') return;
    try {
      // o envio imediato que o próprio `fazerCheckin` dispara termina (aceito) antes de qualquer pull trazer a linha
      await c.ap.motor.enviar();
      expect(c.ap.motor.estado().fila).toEqual([]);
      expect(await visita(ci.visit.id)).toBeDefined();
      await c.armazem.carregar();
      const aberta = c.armazem.obter().visitas.find((v) => v.id === ci.visit.id);
      expect(aberta, 'o check-in aceito some do aparelho até o próximo pull trazer a linha (horizonte de 2 s do pull)').toBeDefined();
      // e o app segue barrando um 2º atendimento (RN-CORE-11)
      const c3 = c.armazem.obter().clientes.find((x) => x.id === C.c3)!;
      expect((await fazerCheckin(c.acao, c3, A.paradas.v1c3)).kind).toBe('blocked');
      expect(c.ap.motor.estado().aceitos.map((i) => [i.id, i.situacao]), 'o check-in aceito fica em aceitos até o pull').toEqual([[ci.visit.id, 'aceito']]);
      // depois do horizonte o pull traz a linha: o aceito sai da sobreposição e a visita segue aberta, agora pela linha
      await esperarHorizonte();
      expect(await c.ap.sincronizar()).toBe(true);
      expect(c.ap.motor.estado().aceitos).toEqual([]);
      expect((await c.ap.motor.linhas<LinhaSync & { checkout_em: string | null }>('visita')).find((l) => l.id === ci.visit.id)?.checkout_em).toBeNull();
      await c.armazem.carregar();
      expect(c.armazem.obter().visitas.find((v) => v.id === ci.visit.id)?.checkout_at ?? null).toBeNull();
    } finally {
      await esperarHorizonte();
      await c.ap.sincronizar();
      await fecharAberta(c);
    }
  });

  // D-4 (corrigido pelo modulo-vendedor, R-20261031-213012): as etapas REST da Fase M do Vendedor (/me, /discount-policy,
  // /customers, /products, /orders) recebem 404 da API real e agora viram etapa pulada (`toleraSemRota`).
  it('S1-043 critério 2 (D-2, D-4): o "Sincronizar" do Campo com as etapas de carga do shell termina sem erro e traz visita, rota e pedido reais', async () => {
    const c = await noCampo('vendedor@exemplo.com.br', { etapas: [...etapasCore, ...etapasVendedor] });
    const ok = await c.ap.sincronizar();
    const e = c.ap.motor.estado();
    expect({ ok, erro: e.erro }, `chamadas das etapas: ${JSON.stringify(c.ap.chamadasEtapas)}`).toEqual({ ok: true, erro: null });
    expect(e.avisos.map((a) => a.entidade)).toEqual([]);
    const visitas = await c.ap.motor.linhas<LinhaSync & { usuario_id: string; pedido_id: string | null }>('visita');
    expect(visitas.length).toBeGreaterThan(0);
    expect(new Set(visitas.map((v) => v.usuario_id))).toEqual(new Set([U.vendedor1]));
    expect(visitas.find((v) => v.id === A.visitas.v1c1Hoje)?.pedido_id).toBe(A.pedidos.p1);
    const pedidos = await c.ap.motor.linhas<LinhaSync & { vendedor_id: string }>('pedido');
    expect(pedidos.map((p) => p.id)).toContain(A.pedidos.p1);
    expect(new Set(pedidos.map((p) => p.vendedor_id))).toEqual(new Set([U.vendedor1]));
    expect((await c.ap.motor.linhas('rota')).map((r) => r.id)).toContain(A.rotas.vendedor1);
    expect((await c.ap.motor.linhas('motivo')).length).toBeGreaterThan(0);
    // as etapas do Vendedor foram de fato chamadas e receberam 404 (pulo tolerado), nunca 5xx
    const doVendedor = c.ap.chamadasEtapas.filter((x) => /^GET \/(me|discount-policy|customers|products)$/.test(x.caminho));
    expect(doVendedor.length, JSON.stringify(c.ap.chamadasEtapas)).toBeGreaterThan(0);
    expect(new Set(doVendedor.map((x) => x.status))).toEqual(new Set([404]));
  });

  // D-4, outro lado: o pulo vale só para "rota não existe" (404/501). Sessão (401), perfil (403) e aparelho bloqueado
  // (423, RN-CORE-15) e erro do servidor (5xx) têm de derrubar o "Sincronizar" com erro, sem apagar o que já está no aparelho.
  it('S1-043c D-4 (RN-CORE-15): nas etapas da Fase M do Vendedor, 401, 403 e 423 (e 5xx) não são engolidos; 404 e 501 seguem pulados', async () => {
    const c = await noCampo('vendedor@exemplo.com.br', { etapas: etapasVendedor });
    expect(await c.ap.sincronizar()).toBe(true);
    const visitasAntes = (await c.ap.motor.linhas('visita')).length;
    expect(visitasAntes).toBeGreaterThan(0);
    const casos: Array<[number, string, boolean]> = [
      [401, 'NAO_AUTENTICADO', false],
      [403, 'PERFIL_SEM_ACESSO', false],
      [403, 'MODULO_INATIVO', false],
      [423, 'DISPOSITIVO_BLOQUEADO', false],
      [500, 'ERRO_INTERNO', false],
      [404, 'NAO_ENCONTRADO', true],
      [501, 'SYNC_NAO_IMPLEMENTADO', true],
    ];
    for (const [status, codigo, passa] of casos) {
      c.ap.respostaEtapas.valor = { status, codigo };
      c.ap.chamadasEtapas.length = 0;
      const ok = await c.ap.sincronizar();
      const e = c.ap.motor.estado();
      expect(c.ap.chamadasEtapas.length, `${status} ${codigo}: as etapas rodaram`).toBeGreaterThan(0);
      expect(ok, `${status} ${codigo}`).toBe(passa);
      if (passa) expect(e.erro, `${status} ${codigo}`).toBeNull();
      else expect(e.erro, `${status} ${codigo}`).toContain(codigo);
      expect((await c.ap.motor.linhas('visita')).length, `${status} ${codigo}: nada some do aparelho`).toBe(visitasAntes);
    }
    c.ap.respostaEtapas.valor = null;
    expect(await c.ap.sincronizar()).toBe(true);
  });

  // DEFEITO D-5 (recado ao modulo-core): `ou4xxNulo` em modules/core/app/lib/cargas.ts trata QUALQUER 4xx como "vazio" →
  // 401 e 423 nas cargas do Core terminam o "Sincronizar" com sucesso. `it.fails` enquanto o defeito existir.
  it.fails('S1-043d DEFEITO D-5 (RN-CORE-15): nas cargas da Fase M do Core (metas, pedidos da visita), 401 e 423 também não são engolidos', async () => {
    const c = await noCampo('vendedor@exemplo.com.br', { etapas: etapasCore });
    expect(await c.ap.sincronizar()).toBe(true);
    for (const [status, codigo] of [
      [401, 'NAO_AUTENTICADO'],
      [423, 'DISPOSITIVO_BLOQUEADO'],
    ] as const) {
      c.ap.respostaEtapas.valor = { status, codigo };
      expect(await c.ap.sincronizar(), `${status} ${codigo}`).toBe(false);
      expect(c.ap.motor.estado().erro, `${status} ${codigo}`).toContain(codigo);
    }
    c.ap.respostaEtapas.valor = null;
  });

  it('S1-043b critério 2 sem as etapas da Fase M: o pull genérico (visita, rota, parada, motivo, parâmetro, pedido) termina sem erro e sem aviso', async () => {
    const c = await noCampo('vendedor@exemplo.com.br');
    expect(await c.ap.sincronizar()).toBe(true);
    expect(c.ap.motor.estado().erro).toBeNull();
    expect(c.ap.motor.estado().avisos).toEqual([]);
    expect((await c.ap.motor.linhas('visita')).map((v) => v.id)).toContain(A.visitas.v1c1Hoje);
    expect((await c.ap.motor.linhas('pedido')).map((p) => p.id)).toContain(A.pedidos.p1);
  });

  it('S1-044 critério 3 (RN-CORE-10): fora do raio o app pede justificativa e nada entra na fila; com ela o servidor grava sinalizado e o BKO vê; app adulterado sem justificativa é rejeitado', async () => {
    const c = await noCampo('vendedor@exemplo.com.br');
    expect(await c.ap.sincronizar()).toBe(true);
    await c.armazem.carregar();
    const paradaC1 = c.armazem.obter().rota!.stops.find((s) => s.customer.id === C.c1)!;
    gps.posicao = LONGE_C1;
    const sem = await fazerCheckin(c.acao, paradaC1.customer, paradaC1.id);
    expect(sem.kind).toBe('justificar');
    if (sem.kind !== 'justificar') return;
    expect(sem.raio_m, 'raio do parâmetro do tenant (200 m na fixture)').toBe(200);
    expect(sem.distancia_m).toBeGreaterThan(800);
    expect(c.ap.motor.estado().fila).toEqual([]);

    const com = await fazerCheckin(c.acao, paradaC1.customer, paradaC1.id, { justificativa: 'Cliente atendeu no depósito da outra rua', posicao: sem.posicao });
    expect(com.kind).toBe('created');
    if (com.kind !== 'created') return;
    expect(com.foraDoRaio).toBe(true);
    expect(await c.ap.sincronizar()).toBe(true);
    const v = await visita(com.visit.id);
    expect(v).toMatchObject({ fora_do_raio: true, justificativa_fora_raio: 'Cliente atendeu no depósito da outra rua', sugere_coordenada: false });
    expect(Number(v!.distancia_m)).toBeGreaterThan(800);
    const bko = await api.chamar(supervisor, { method: 'GET', url: `/v1/core/visitas?fora_do_raio=true&usuario_id=${U.vendedor1}` });
    expect(bko.statusCode, bko.body).toBe(200);
    expect((bko.json() as { itens: Array<{ id: string; fora_do_raio: boolean; justificativa_fora_raio: string | null }> }).itens).toContainEqual(
      expect.objectContaining({ id: com.visit.id, fora_do_raio: true, justificativa_fora_raio: 'Cliente atendeu no depósito da outra rua' }),
    );
    await esperarHorizonte();
    await fecharAberta(c);

    // app adulterado: o mesmo check-in longe, sem justificativa, direto no push → rejeitado/RN-CORE-10, nada gravado
    const cru = randomUUID();
    const [r] = await push(c.ap.token.valor, [checkinCru(cru, C.c1, { lat: LONGE_C1.lat, lng: LONGE_C1.lng })]);
    expect(r).toMatchObject({ id: cru, status: 'rejeitado', codigo: 'RN-CORE-10' });
    expect(await visita(cru)).toBeUndefined();
  });

  it('S1-045 RN-CORE-10: o raio vem do parâmetro do tenant — mudar core.checkin.raio_m muda o app (pelo próximo sync) e o servidor; o tenant B não muda', async () => {
    const c = await noCampo('vendedor@exemplo.com.br');
    const b = await noCampo('vendedor@exemplo.com.br', { tenant: B });
    try {
      // sem BKO de parâmetros na Sprint 1: a mudança é feita no banco (como o ERP/BKO fará), com updated_at novo
      await parametroRaio(A, 2000);
      await esperarHorizonte();
      expect(await c.ap.sincronizar()).toBe(true);
      expect(await b.ap.sincronizar()).toBe(true);
      await c.armazem.carregar();
      await b.armazem.carregar();
      expect(c.armazem.obter().raioCheckinM).toBe(2000);
      expect(b.armazem.obter().raioCheckinM, 'o parâmetro de A não vaza para B').toBe(200);
      const parametrosB = await b.ap.motor.linhas<LinhaSync & { modulo: string; chave: string }>('parametro');
      expect(parametrosB.map((p) => `${p.modulo}/${p.chave}`)).toEqual(['core/checkin.raio_m']);

      // a ~900 m: com raio de 2000 m o app NÃO pede justificativa e o servidor aceita sem sinalizar
      const paradaC1 = c.armazem.obter().rota!.stops.find((s) => s.customer.id === C.c1)!;
      gps.posicao = LONGE_C1;
      const ci = await fazerCheckin(c.acao, paradaC1.customer, paradaC1.id);
      expect(ci.kind).toBe('created');
      if (ci.kind !== 'created') return;
      expect(ci.foraDoRaio).toBe(false);
      expect(await c.ap.sincronizar()).toBe(true);
      expect(await visita(ci.visit.id)).toMatchObject({ fora_do_raio: false, justificativa_fora_raio: null });
      await esperarHorizonte();
      await fecharAberta(c);

      // 500 m: a mesma distância volta a exigir justificativa no app e no servidor
      await parametroRaio(A, 500);
      await esperarHorizonte();
      expect(await c.ap.sincronizar()).toBe(true);
      await c.armazem.carregar();
      expect(c.armazem.obter().raioCheckinM).toBe(500);
      const pede = await fazerCheckin(c.acao, paradaC1.customer, paradaC1.id);
      expect(pede).toMatchObject({ kind: 'justificar', raio_m: 500 });
      const cru = randomUUID();
      expect((await push(c.ap.token.valor, [checkinCru(cru, C.c1, { lat: LONGE_C1.lat, lng: LONGE_C1.lng })]))[0]).toMatchObject({ status: 'rejeitado', codigo: 'RN-CORE-10' });
      // tenant B segue com 200 m no servidor: a ~900 m do c1 de B (São Paulo) sem justificativa → rejeitado
      const cruB = randomUUID();
      expect((await push(b.ap.token.valor, [checkinCru(cruB, B.clientes.c1, { lat: -23.5585, lng: -46.6333 })]))[0]).toMatchObject({ status: 'rejeitado', codigo: 'RN-CORE-10' });
    } finally {
      await parametroRaio(A, 200);
    }
  });

  it('S1-046 RN-CORE-11: um atendimento aberto por vez — o app barra o 2º; o servidor fecha o anterior como auto/nao_finalizado; o índice único parcial impede duas abertas', async () => {
    const c = await noCampo('vendedor@exemplo.com.br');
    expect(await c.ap.sincronizar()).toBe(true);
    await c.armazem.carregar();
    const { rota, clientes } = c.armazem.obter();
    const paradaC1 = rota!.stops.find((s) => s.customer.id === C.c1)!;
    gps.posicao = EM_C1;
    const primeira = await fazerCheckin(c.acao, paradaC1.customer, paradaC1.id);
    expect(primeira.kind).toBe('created');
    if (primeira.kind !== 'created') return;
    // no aparelho: outro cliente com um atendimento aberto → bloqueado; o mesmo cliente → devolve o aberto
    const c3 = clientes.find((x) => x.id === C.c3)!;
    const segunda = await fazerCheckin(c.acao, c3, A.paradas.v1c3);
    expect(segunda).toMatchObject({ kind: 'blocked', open: { id: primeira.visit.id } });
    expect((await fazerCheckin(c.acao, paradaC1.customer, paradaC1.id)).kind).toBe('existing');
    expect(c.ap.motor.estado().fila.filter((i) => i.entidade === 'visita')).toHaveLength(1);
    expect(await c.ap.sincronizar()).toBe(true);

    // servidor (dois aparelhos ou app antigo): novo check-in em c3 fecha o aberto de c1 sozinho
    const outra = randomUUID();
    expect((await push(c.ap.token.valor, [checkinCru(outra, C.c3, { lat: EM_C3.lat, lng: EM_C3.lng })]))[0]).toMatchObject({ status: 'aceito' });
    expect(await visita(primeira.visit.id)).toMatchObject({ resultado: 'nao_finalizado', fechada_por: 'auto' });
    expect((await visita(primeira.visit.id))!.checkout_em).not.toBeNull();
    expect(await contarEventos('core.visita.checkout@1', primeira.visit.id)).toBe(1);
    const abertas = await api.admin.query('select id from core.visita where usuario_id = $1 and checkout_em is null and deleted_at is null', [U.vendedor1]);
    expect(abertas.rows.map((x) => x.id)).toEqual([outra]);
    // trava final no banco: uma 2ª aberta do mesmo usuário viola o único parcial (23505)
    const dup = await api.admin
      .query(
        `insert into core.visita (id, tenant_id, usuario_id, cliente_id, data_local, checkin_em, sem_gps, fora_do_raio, sugere_coordenada, extra)
         values ($1, $2, $3, $4, current_date, now(), true, false, false, true)`,
        [randomUUID(), A.tenantId, U.vendedor1, C.c1],
      )
      .then(
        () => 'gravou',
        (e: { code?: string }) => e.code,
      );
    expect(dup).toBe('23505');
    // o checkout do usuário vence o fechamento automático (é o fato real)
    const cmd = randomUUID();
    expect((await push(c.ap.token.valor, [checkoutCru(cmd, primeira.visit.id)]))[0]).toMatchObject({ status: 'aceito' });
    expect(await visita(primeira.visit.id)).toMatchObject({ resultado: 'sem_pedido', fechada_por: 'usuario', checkout_id: cmd });
    expect((await push(c.ap.token.valor, [checkoutCru(randomUUID(), outra)]))[0]).toMatchObject({ status: 'aceito' });
  });

  it('S1-047 critério 4 (RN-CORE-14): cliente fechado persiste o motivo e a foto da fachada, enviada pela rota de arquivos; reenvio idempotente; foto só no escopo', async () => {
    const c = await noCampo('vendedor@exemplo.com.br');
    expect(await c.ap.sincronizar()).toBe(true);
    await c.armazem.carregar();
    const paradaC1 = c.armazem.obter().rota!.stops.find((s) => s.customer.id === C.c1)!;
    gps.posicao = EM_C1;
    c.ap.online.valor = false; // feito sem sinal, como na rua
    const ci = await fazerCheckin(c.acao, paradaC1.customer, paradaC1.id);
    expect(ci.kind).toBe('created');
    if (ci.kind !== 'created') return;
    // o contrato do app recusa cliente fechado sem foto (RN-CORE-14): nada entra na fila
    await expect(fazerCheckout(c.acao, ci.visit.id, { resultado: 'cliente_fechado', motivo_id: A.motivos.lojaFechada })).rejects.toThrow(/foto da fachada/);
    expect(c.ap.motor.estado().fila.map((i) => i.entidade)).toEqual(['visita']);

    const foto = randomUUID();
    const bytes = jpeg(47);
    c.ap.fotos.set(caminhoFoto(foto), bytes); // a câmera do shell grava em fotos/<id>.jpg
    const fechada = await fazerCheckout(c.acao, ci.visit.id, { resultado: 'cliente_fechado', motivo_id: A.motivos.lojaFechada, foto_fachada_id: foto, cliente: 'Auto Peças Um' });
    expect(fechada).toMatchObject({ resultado: 'cliente_fechado', foto_fachada_id: foto });
    expect(c.ap.motor.arquivosPendentes().map((a) => a.id), '"Fotos pendentes: 1" na tela de sync').toEqual([foto]);

    c.ap.online.valor = true;
    expect(await c.ap.sincronizar()).toBe(true);
    expect(c.ap.motor.estado().fila).toEqual([]);
    expect(c.ap.motor.arquivosPendentes()).toEqual([]);
    expect(await visita(ci.visit.id)).toMatchObject({ resultado: 'cliente_fechado', motivo_id: A.motivos.lojaFechada, foto_fachada_id: foto, fechada_por: 'usuario' });
    const arq = (await api.admin.query('select * from plataforma.arquivo where id = $1', [foto])).rows[0];
    expect(arq).toMatchObject({ tenant_id: A.tenantId, modulo: 'core', finalidade: 'fachada', entidade: 'visita', entidade_id: ci.visit.id, cliente_id: C.c1, enviado_por: U.vendedor1, situacao: 'recebido' });
    expect(Number(arq.tamanho_bytes)).toBe(bytes.length);
    expect(fotosNoServidor.chaves().filter((k) => k.endsWith(`${foto}.jpg`))).toEqual([`${A.tenantId}/core/${new Date().toISOString().slice(0, 7)}/${foto}.jpg`]);

    // reenvio da foto (mesmo UUID e mesmos bytes) → 200 repetido; bytes diferentes → 409 ARQUIVO_DIVERGENTE
    const de = (b: Uint8Array) =>
      api.chamar(c.ap.token.valor, { method: 'PUT', url: `/v1/arquivos/${foto}`, headers: { 'content-type': 'image/jpeg' }, payload: Buffer.from(b) });
    const repetido = await de(bytes);
    expect([repetido.statusCode, (repetido.json() as { repetido: boolean }).repetido]).toEqual([200, true]);
    const outra = await de(jpeg(48));
    expect([outra.statusCode, erroDe(outra).codigo]).toEqual([409, 'ARQUIVO_DIVERGENTE']);

    // quem vê a foto: o vendedor e o supervisor da equipe (carteira de c1); o vendedor-2 (sem c1) e o tenant B não
    const baixar = (token: string) => api.chamar(token, { method: 'GET', url: `/v1/arquivos/${foto}` });
    for (const t of [c.ap.token.valor, supervisor, analista]) {
      const r = await baixar(t);
      expect(r.statusCode, r.body).toBe(200);
      expect(new Uint8Array(r.rawPayload)).toEqual(bytes);
    }
    const v2 = await baixar((await api.sessao('vendedor2@exemplo.com.br')).access_token);
    expect(v2.statusCode).toBeGreaterThanOrEqual(403);
    expect(v2.statusCode).toBeLessThan(500);
    const adminB = await baixar((await api.sessao('admin.b@exemplo.com.br', B)).access_token);
    expect([adminB.statusCode, erroDe(adminB).codigo]).toEqual([404, 'ARQUIVO_NAO_ENCONTRADO']);

    // o BKO lista a visita com motivo e foto
    const bko = await api.chamar(supervisor, { method: 'GET', url: `/v1/core/visitas?usuario_id=${U.vendedor1}&cliente_id=${C.c1}` });
    expect((bko.json() as { itens: Array<{ id: string }> }).itens).toContainEqual(expect.objectContaining({ id: ci.visit.id, resultado: 'cliente_fechado', motivo_codigo: 'loja_fechada', foto_fachada_id: foto }));
  });

  it('S1-048 RN-CORE-04/05: carteira e tenant — fora da carteira é rejeitado; B não vê nem fecha visita de A; o mesmo UUID em B não sobrescreve A; vendedor-2 e supervisor veem só o escopo', async () => {
    const v1 = await noCampo('vendedor@exemplo.com.br');
    const b = await noCampo('vendedor@exemplo.com.br', { tenant: B });
    const v2 = await noCampo('vendedor2@exemplo.com.br');
    for (const x of [v1, v2, b]) expect(await x.ap.sincronizar()).toBe(true);

    // c2 é do vendedor-2: o vendedor-1 não faz check-in nele (nem o cliente de B)
    for (const cliente of [C.c2, B.clientes.c1]) {
      const id = randomUUID();
      expect((await push(v1.ap.token.valor, [checkinCru(id, cliente, { lat: -3.0874, lng: -60.0172 })]))[0]).toMatchObject({ status: 'rejeitado', codigo: 'FORA_DA_CARTEIRA' });
      expect(await visita(id)).toBeUndefined();
    }
    // pull: cada aparelho só com as próprias visitas/rotas/paradas; B nunca recebe um id de A
    const idsA = new Set<string>((await api.admin.query('select id from core.visita where tenant_id = $1 union all select id from core.rota where tenant_id = $1 union all select id from core.rota_parada where tenant_id = $1', [A.tenantId])).rows.map((r) => r.id));
    for (const ent of ['visita', 'rota', 'rota_parada']) {
      const linhasB = await b.ap.motor.linhas<LinhaSync & { usuario_id: string }>(ent);
      expect(linhasB.length, `B tem ${ent}`).toBeGreaterThan(0);
      expect(linhasB.filter((l) => idsA.has(l.id)), `${ent} de A no aparelho de B`).toEqual([]);
      expect(new Set(linhasB.map((l) => l.usuario_id))).toEqual(new Set([B.usuarios.vendedor]));
      expect(new Set((await v2.ap.motor.linhas<LinhaSync & { usuario_id: string }>(ent)).map((l) => l.usuario_id))).toEqual(new Set([U.vendedor2]));
      expect(new Set((await v1.ap.motor.linhas<LinhaSync & { usuario_id: string }>(ent)).map((l) => l.usuario_id))).toEqual(new Set([U.vendedor1]));
    }
    // B não fecha visita de A (mesma resposta de inexistente) e o UUID de uma visita de A enviado por B não a altera
    expect((await push(b.ap.token.valor, [checkoutCru(randomUUID(), A.visitas.v2c2Aberta, { motivo_id: B.motivos.estoqueAlto })]))[0]).toMatchObject({ status: 'rejeitado', codigo: 'VISITA_NAO_ENCONTRADA' });
    const antes = await visita(A.visitas.v2c2Aberta);
    const [mesmoId] = await push(b.ap.token.valor, [checkinCru(A.visitas.v2c2Aberta, B.clientes.c1, { lat: -23.5505, lng: -46.6333 })]);
    expect(mesmoId!.status).toBe('rejeitado');
    expect('mensagem' in mesmoId! ? mesmoId.mensagem : '').not.toMatch(/Alfa|Dois|Auto Peças/);
    expect(await visita(A.visitas.v2c2Aberta)).toEqual(antes);
    // vendedor-1 não fecha a visita aberta do vendedor-2 (mesmo tenant)
    expect((await push(v1.ap.token.valor, [checkoutCru(randomUUID(), A.visitas.v2c2Aberta)]))[0]).toMatchObject({ status: 'rejeitado', codigo: 'VISITA_NAO_ENCONTRADA' });

    // BKO: supervisor (equipe 1) vê vendedor-1 e promotor, não o vendedor-2; vendedor não abre a lista; admin B não vê A
    const sup = await api.chamar(supervisor, { method: 'GET', url: '/v1/core/visitas' });
    expect(sup.statusCode, sup.body).toBe(200);
    const usuariosSup = new Set((sup.json() as { itens: Array<{ usuario_id: string }> }).itens.map((i) => i.usuario_id));
    expect(usuariosSup.has(U.vendedor2)).toBe(false);
    expect([...usuariosSup].every((u) => [U.vendedor1, U.promotor, U.supervisor].includes(u))).toBe(true);
    const doV1 = await api.chamar(v1.ap.token.valor, { method: 'GET', url: '/v1/core/visitas' });
    expect([doV1.statusCode, erroDe(doV1).codigo]).toEqual([403, 'PERFIL_SEM_ACESSO']);
    const adminB = await api.chamar((await api.sessao('admin.b@exemplo.com.br', B)).access_token, { method: 'GET', url: '/v1/core/visitas' });
    expect(adminB.statusCode).toBe(200);
    expect((adminB.json() as { itens: Array<{ id: string }> }).itens.filter((i) => idsA.has(i.id))).toEqual([]);
  });

  it('S1-049 licença e sessão nas escritas de visita: sem token → 401; promotor fecha como "atendido"; sem o Core não há como desligar (RN-CORE-01)', async () => {
    const semToken = await api.chamar(null, { method: 'POST', url: '/v1/sync/push', payload: { itens: [checkinCru(randomUUID(), C.c1)] } });
    expect(semToken.statusCode).toBe(401);
    // promotor (sem Vendedor efetivo): "atendido" sem motivo é aceito; "sem_pedido" é RN-CORE-12
    const p = await noCampo('promotor@exemplo.com.br');
    expect(await p.ap.sincronizar()).toBe(true);
    const vid = randomUUID();
    expect((await push(p.ap.token.valor, [checkinCru(vid, C.c1, { lat: EM_C1.lat, lng: EM_C1.lng })]))[0]).toMatchObject({ status: 'aceito' });
    expect((await push(p.ap.token.valor, [checkoutCru(randomUUID(), vid, { resultado: 'sem_pedido', motivo_id: null, motivo_texto: null })]))[0]).toMatchObject({ status: 'rejeitado' });
    expect((await push(p.ap.token.valor, [checkoutCru(randomUUID(), vid, { resultado: 'atendido', motivo_id: null })]))[0]).toMatchObject({ status: 'aceito' });
    expect(await visita(vid)).toMatchObject({ resultado: 'atendido', usuario_id: U.promotor });
  });
}, 180_000);
