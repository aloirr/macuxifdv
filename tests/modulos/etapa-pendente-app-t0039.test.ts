/**
 * T-0039 (agente testes) — etapa pendente do checkout do LADO DO APARELHO, sem banco (RN-CORE-12 com o complemento de 05/11;
 * docs/design/checkout-pendencia.md §1.1 e §1.2). O ponta a ponta com a API real e o Postgres fica em
 * tests/integracao/api/etapa-pendente-app-t0039.test.ts (CI). Matriz: docs/testes/T-0039.md, bloco "Aparelho".
 *
 * Bloco E: o estado do Core no aparelho montado pelas funções reais (`montarEstadoLocal` das linhas ⊕ fila, `effectiveRoute`
 * que a `useCore` entrega à Rota, `visitaComEtapaPendente`/`avisoDeEtapaPendente` da ficha). A decisão do chip replica a
 * condição de modules/core/app/telas/rota.tsx (`StopRow`: parada `done` e `visit.etapas_pendentes > 0`).
 * Bloco F: `tentarCheckin` (lib/acoes-visita.ts) com o MOTOR DE SYNC real do platform-sdk e o `ArmazemCore` real sobre um
 * armazenamento em memória que o teste faz falhar ("disco cheio"). Só o hardware é trocado (ambiente do motor: UUID do Node e
 * GPS controlado em `posicaoAgora`).
 *
 * Relógio: as funções puras recebem `agora`/`hoje` por parâmetro; nenhum instante fixo é comparado com o relógio real.
 * Convenção: `it.fails` = defeito aberto com recado ao dono (vira `it` quando corrigir).
 */
import { manifest as manifestoCore } from '@macuxi/core/manifest';
import {
  criarArmazenamentoEmMemoria,
  criarClienteHttp,
  criarMotorSync,
  criarRegistroSync,
  type ArmazenamentoSync,
  type ItemSobreposicao,
  type MotorSync,
  type PaginaSync,
  type LinhaSync,
  type PosicaoDoAparelho,
} from '@macuxi/platform-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * GPS do "aparelho" (RN-CORE-13: lido uma vez por ação); `null` = sem GPS. Entra pelo ambiente do motor
 * (`posicaoAgora`, RD-0046), como o shell real faz; o `dispositivo.ts` do Core não existe mais.
 */
const gps: { posicao: null | { lat: number; lng: number; precisao_m: number | null } } = { posicao: null };
// hora-fixa-ok: lida_em do GPS falso só acompanha a posição; nenhum teste deste arquivo o compara
const posicaoAgora = async (): Promise<PosicaoDoAparelho | null> => (gps.posicao ? { ...gps.posicao, lida_em: new Date().toISOString() } : null);

import type { ClienteSync, CustomerSummary, MotivoSync, RotaParadaSync, RotaSync, RouteStop, VisitaSync } from '../../modules/core/contracts';
import { MSG_FALHA_CHECKIN, tentarCheckin, type ContextoAcao } from '../../modules/core/app/lib/acoes-visita';
import { entidadesCliente } from '../../modules/core/app/lib/entidades-cliente';
import { entidadesRota } from '../../modules/core/app/lib/entidades-rota';
import { armazemDe } from '../../modules/core/app/lib/estado';
import { avisoDeEtapaPendente, visitaComEtapaPendente } from '../../modules/core/app/lib/etapa-pendente';
import { montarEstadoLocal, type LinhasRota } from '../../modules/core/app/lib/rota-local';
import { effectiveRoute } from '../../modules/core/app/lib/route';

const FUSO = 'America/Manaus';
const EU = '0b000000-0000-4000-8000-000000000391';
const OUTRO = '0b000000-0000-4000-8000-000000000392';
const C1 = '0c000000-0000-4000-8000-000000000391';
const C2 = '0c000000-0000-4000-8000-000000000392';
const ROTA = '0d000000-0000-4000-8000-000000000391';
const P1 = '0e000000-0000-4000-8000-000000000391';
const P2 = '0e000000-0000-4000-8000-000000000392';
const MOTIVO = '0f000000-0000-4000-8000-000000000391';

/** Base das linhas do pull (sem `deleted_at`). */
const base = (id: string) => ({ id, updated_at: '2026-11-05T10:00:00.000Z', deleted_at: null, external_id: null });
const cliente = (id: string, nome: string) =>
  ({ ...base(id), razao_social: nome, nome_fantasia: nome, documento: null, ativo: true, latitude: null, longitude: null }) as unknown as ClienteSync;
const rota = (data: string) => ({ ...base(ROTA), usuario_id: EU, data, situacao: 'em_andamento', regiao: 'Centro' }) as unknown as RotaSync;
const parada = (id: string, clienteId: string, sequencia: number, data: string) =>
  ({ ...base(id), rota_id: ROTA, usuario_id: EU, data, cliente_id: clienteId, sequencia, janela_inicio: null, janela_fim: null }) as unknown as RotaParadaSync;
const motivo = { ...base(MOTIVO), descricao: 'Estoque alto', ativo: true } as unknown as MotivoSync;

/** Visita como o pull a entrega (`etapas_pendentes` ausente = aparelho/servidor antigo = 0). */
function visita(o: { id: string; cliente: string; parada?: string | null; checkin: string; checkout?: string | null; usuario?: string; pendentes?: number }): VisitaSync {
  return {
    ...base(o.id),
    usuario_id: o.usuario ?? EU,
    cliente_id: o.cliente,
    rota_parada_id: o.parada ?? null,
    data_local: new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(new Date(o.checkin)),
    checkin_em: o.checkin,
    checkin_lat: null,
    checkin_lng: null,
    sem_gps: true,
    fora_do_raio: false,
    sugere_coordenada: false,
    extra: !o.parada,
    checkout_em: o.checkout ?? null,
    resultado: o.checkout ? 'sem_pedido' : null,
    motivo_id: o.checkout ? MOTIVO : null,
    fechada_por: o.checkout ? 'usuario' : null,
    ...(o.pendentes === undefined ? {} : { etapas_pendentes: o.pendentes }),
  } as VisitaSync;
}

/** "Agora" do aparelho e "hoje" no fuso do tenant: 05/11 11h em Manaus. */
const AGORA = new Date('2026-11-05T15:00:00.000Z');
const HOJE = '2026-11-05';

function linhas(visitas: VisitaSync[]): LinhasRota {
  return {
    clientes: [cliente(C1, 'Mercado Sol'), cliente(C2, 'Auto Peças Dois')],
    financeiros: [],
    titulos: [],
    historico: [],
    contatos: [],
    rotas: [rota(HOJE)],
    paradas: [parada(P1, C1, 1, HOJE), parada(P2, C2, 2, HOJE)],
    visitas,
    motivos: [motivo],
  };
}

/** O que a tela usa: estado do armazém (`montarEstadoLocal`) e a rota efetiva da `useCore` (`effectiveRoute`). */
function telaDoAparelho(visitas: VisitaSync[], fila: ItemSobreposicao[] = [], o: { naFila?: number } = {}) {
  const estado = montarEstadoLocal(linhas(visitas), fila, { usuarioId: EU, hoje: HOJE, fuso: FUSO, agora: AGORA });
  const rotaEfetiva = effectiveRoute(estado.rota, estado.visitas, AGORA, FUSO);
  /** Condição do chip em telas/rota.tsx (`StopRow`): parada feita com `etapas_pendentes > 0`. */
  const chip = (s: RouteStop) => s.status === 'done' && (s.visit?.etapas_pendentes ?? 0) > 0;
  const parada_ = (id: string) => rotaEfetiva!.stops.find((s) => s.id === id)!;
  /** Banner da ficha, como telas/cliente.tsx (linhas 59-62). */
  const aviso = (clienteId: string) => {
    const p = visitaComEtapaPendente(estado.visitas, clienteId);
    return p ? avisoDeEtapaPendente({ ...p, agora: AGORA, fuso: FUSO, naFila: o.naFila ?? 0 }) : null;
  };
  return { estado, rotaEfetiva, chip: (id: string) => chip(parada_(id)), status: (id: string) => parada_(id).status, aviso };
}

describe('T-0039 — etapa pendente no aparelho: Rota (chip) e ficha (aviso) a partir das linhas do pull', () => {
  it('E-01 RN-CORE-12 §1.1/§1.2: parada feita com etapas_pendentes = 2 mostra o chip; a ficha do cliente mostra "2 etapas da visita de hoje…"; a outra parada não', () => {
    const t = telaDoAparelho([visita({ id: 'a1000000-0000-4000-8000-000000000001', cliente: C1, parada: P1, checkin: '2026-11-05T12:00:00.000Z', checkout: '2026-11-05T12:30:00.000Z', pendentes: 2 })]);
    expect(t.status(P1)).toBe('done');
    expect(t.chip(P1)).toBe(true);
    expect(t.chip(P2)).toBe(false);
    expect(t.aviso(C1)).toEqual({ linha1: '2 etapas da visita de hoje não chegaram', linha2: 'Fale com seu supervisor' });
    expect(t.aviso(C2)).toBeNull();
  });

  it('E-02 RN-CORE-12 §0 ("some sem festa"): com etapas_pendentes = 0 ou ausente (servidor antigo) não há chip nem aviso', () => {
    for (const pendentes of [0, undefined]) {
      const t = telaDoAparelho([visita({ id: 'a1000000-0000-4000-8000-000000000002', cliente: C1, parada: P1, checkin: '2026-11-05T12:00:00.000Z', checkout: '2026-11-05T12:30:00.000Z', pendentes })]);
      expect(t.status(P1)).toBe('done');
      expect(t.chip(P1), String(pendentes)).toBe(false);
      expect(t.aviso(C1), String(pendentes)).toBeNull();
    }
  });

  it('E-03 RN-CORE-12 §0 ("não há aviso na hora do checkout"): checkout ainda na fila (offline) fecha a parada no aparelho sem chip e sem aviso: a pendência só nasce no servidor', () => {
    const vid = 'a1000000-0000-4000-8000-000000000003';
    const fila: ItemSobreposicao[] = [
      {
        id: 'b1000000-0000-4000-8000-000000000003',
        entidade: 'visita_checkout',
        situacao: 'pendente',
        payload: { id: 'b1000000-0000-4000-8000-000000000003', visita_id: vid, checkout_em: '2026-11-05T12:40:00.000Z', resultado: 'sem_pedido', motivo_id: MOTIVO, etapas: [] },
      } as unknown as ItemSobreposicao,
    ];
    const t = telaDoAparelho([visita({ id: vid, cliente: C1, parada: P1, checkin: '2026-11-05T12:00:00.000Z' })], fila, { naFila: 1 });
    expect(t.status(P1)).toBe('done');
    expect(t.chip(P1)).toBe(false);
    expect(t.aviso(C1)).toBeNull();
  });

  it('E-04 RN-CORE-12 §2.2 (Gestão em backlog) / RN-CORE-04: visita com pendência de OUTRO usuário no aparelho (pull da equipe) não entra no estado: sem aviso na ficha do supervisor', () => {
    const t = telaDoAparelho([visita({ id: 'a1000000-0000-4000-8000-000000000004', usuario: OUTRO, cliente: C1, checkin: '2026-11-05T12:00:00.000Z', checkout: '2026-11-05T12:30:00.000Z', pendentes: 1 })]);
    expect(t.estado.visitas).toEqual([]);
    expect(t.aviso(C1)).toBeNull();
    expect(t.chip(P1)).toBe(false);
  });

  it('E-05 RN-CORE-12 §1.1: parada em atendimento (sem checkout) não mostra o chip, mesmo com contagem > 0 vinda do pull (o lugar é do botão de checkout)', () => {
    const t = telaDoAparelho([visita({ id: 'a1000000-0000-4000-8000-000000000005', cliente: C1, parada: P1, checkin: '2026-11-05T14:00:00.000Z', pendentes: 1 })]);
    expect(t.status(P1)).toBe('in_progress');
    expect(t.chip(P1)).toBe(false);
  });

  it('E-06 §1.2 (datas no fuso do tenant): check-in 23h30 de 04/11 em Manaus (03h30Z de 05/11) é "de 04/11"; 00h30 de 05/11 local é "de hoje"', () => {
    const ontem = telaDoAparelho([visita({ id: 'a1000000-0000-4000-8000-000000000006', cliente: C1, checkin: '2026-11-05T03:30:00.000Z', checkout: '2026-11-05T03:50:00.000Z', pendentes: 1 })]);
    expect(ontem.aviso(C1)?.linha1).toBe('Uma etapa da visita de 04/11 não chegou');
    const hoje = telaDoAparelho([visita({ id: 'a1000000-0000-4000-8000-000000000007', cliente: C1, checkin: '2026-11-05T04:30:00.000Z', checkout: '2026-11-05T04:50:00.000Z', pendentes: 1 })]);
    expect(hoje.aviso(C1)?.linha1).toBe('Uma etapa da visita de hoje não chegou');
  });

  // T-0166 (RD-0181, R-20261112-042519-modulo-core): com item na fila o aviso some (a fila já mostra o que falta subir); o sinal não muda o texto.
  // RD-0181 (#175): o parâmetro `semSinal` saiu de `avisoDeEtapaPendente` porque o sinal não muda o aviso; as asserções que
  // comparavam "com sinal" × "sem sinal" saíram junto (o sinal não é mais entrada da regra), e o aviso depende só da fila.
  it('E-07 §1.2 (T-0166): com a fila cheia não há aviso; com a fila vazia, "Fale com seu supervisor"', () => {
    const v = [visita({ id: 'a1000000-0000-4000-8000-000000000008', cliente: C1, parada: P1, checkin: '2026-11-05T12:00:00.000Z', checkout: '2026-11-05T12:30:00.000Z', pendentes: 1 })];
    expect(telaDoAparelho(v, [], { naFila: 2 }).aviso(C1)).toBeNull();
    expect(telaDoAparelho(v, [], { naFila: 0 }).aviso(C1)).toEqual({ linha1: 'Uma etapa da visita de hoje não chegou', linha2: 'Fale com seu supervisor' });
  });

  // D-T0039b (🟡 1 do designer-ux, R-20261105-150128-designer-ux) — corrigido pelo modulo-core em 05/11 (R-20261105-154625-modulo-core)
  it('E-08 D-T0039b §1.2 (esclarecido em 05/11): visita NOVA sem pendência não esconde a pendência de uma visita anterior do mesmo cliente; data e contagem vêm da mais recente COM pendência', () => {
    const t = telaDoAparelho([
      visita({ id: 'a1000000-0000-4000-8000-000000000009', cliente: C1, checkin: '2026-11-04T12:00:00.000Z', checkout: '2026-11-04T12:30:00.000Z', pendentes: 1 }),
      visita({ id: 'a1000000-0000-4000-8000-000000000010', cliente: C1, parada: P1, checkin: '2026-11-05T12:00:00.000Z', checkout: '2026-11-05T12:30:00.000Z', pendentes: 0 }),
    ]);
    expect(t.chip(P1), 'a parada de hoje não tem pendência').toBe(false);
    expect(t.aviso(C1)).toEqual({ linha1: 'Uma etapa da visita de 04/11 não chegou', linha2: 'Fale com seu supervisor' });
  });

  // D-T0039c (🟡 2 do designer-ux, R-20261105-150128-designer-ux) — corrigido pelo modulo-core em 05/11 (R-20261105-154625-modulo-core)
  it('E-09 D-T0039c §1.2 (concordância; T-0166): N etapas sem fila → "2 etapas … não chegaram" (plural); com fila, sem aviso', () => {
    const v = [visita({ id: 'a1000000-0000-4000-8000-000000000011', cliente: C1, parada: P1, checkin: '2026-11-05T12:00:00.000Z', checkout: '2026-11-05T12:30:00.000Z', pendentes: 2 })];
    expect(telaDoAparelho(v).aviso(C1)).toEqual({ linha1: '2 etapas da visita de hoje não chegaram', linha2: 'Fale com seu supervisor' });
    expect(telaDoAparelho(v, [], { naFila: 1 }).aviso(C1)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Bloco F: falha de gravação no check-in (tentarCheckin) com o motor real
// ---------------------------------------------------------------------------------------------------------------------

interface Aparelho {
  motor: MotorSync;
  acao: ContextoAcao;
  disco: { cheio: boolean };
  armazenamento: ReturnType<typeof criarArmazenamentoEmMemoria>;
}

/** Aparelho sem sinal: motor real, `ArmazemCore` real, armazenamento em memória que lança "disco cheio" quando o teste manda. */
async function aparelhoOffline(): Promise<Aparelho> {
  const registro = criarRegistroSync([manifestoCore]);
  for (const e of [...entidadesCliente, ...entidadesRota]) if (!registro.entidade(e.nome)) registro.registrar(e);
  const armazenamento = criarArmazenamentoEmMemoria();
  const disco = { cheio: false };
  const falha = () => new Error('SQLITE_FULL: database or disk is full');
  const comFalha: ArmazenamentoSync = {
    ler: (c) => armazenamento.ler(c),
    async gravar(c, v) {
      if (disco.cheio) throw falha();
      return armazenamento.gravar(c, v);
    },
    async remover(c) {
      if (disco.cheio) throw falha();
      return armazenamento.remover(c);
    },
    chaves: (p) => armazenamento.chaves(p),
  };
  const semRede = async (): Promise<never> => {
    throw new Error('sem sinal');
  };
  const motor = criarMotorSync({
    registro,
    armazenamento: comFalha,
    transporte: { push: semRede, pull: semRede as () => Promise<PaginaSync<LinhaSync>> },
    online: () => false,
    ambiente: {
      http: criarClienteHttp(semRede, { online: () => false }),
      online: () => false,
      novoId: () => globalThis.crypto.randomUUID(),
      posicaoAgora,
      usuario: () => ({ id: EU, nome: 'Vendedor', perfil: 'vendedor', fuso: FUSO }),
    },
  });
  await motor.carregar();
  const armazem = armazemDe(motor);
  await armazem.carregar();
  return { motor, disco, armazenamento, acao: { motor, armazem, tz: FUSO, vendedorId: EU } };
}

const clienteResumo = (id: string, nome: string, lat: number | null = null, lng: number | null = null) => ({ id, trade_name: nome, lat, lng }) as unknown as CustomerSummary;
const filaNoDisco = (a: Aparelho) => (a.armazenamento.conteudo()['sync:fila'] as Array<{ id: string; entidade: string }> | undefined) ?? [];
const abertas = (a: Aparelho) => a.acao.armazem.obter().visitas.filter((v) => !v.checkout_at);

describe('T-0039 — check-in que falha ao gravar no aparelho (tentarCheckin) com o motor de sync real', () => {
  beforeEach(() => {
    gps.posicao = null;
  });

  it('F-01 RN-CORE-10: disco cheio ao enfileirar → { kind: "erro" } com a mensagem da folha (nada lança); nada vai ao disco; com o disco livre, o Check-in seguinte grava UMA visita', async () => {
    const a = await aparelhoOffline();
    a.disco.cheio = true;
    const r = await tentarCheckin(a.acao, clienteResumo(C1, 'Mercado Sol'), P1);
    expect(r).toEqual({ kind: 'erro', mensagem: MSG_FALHA_CHECKIN });
    expect(MSG_FALHA_CHECKIN).toBe('Não foi possível registrar o check-in neste aparelho. Toque em Check-in para tentar de novo');
    expect(filaNoDisco(a), 'nada gravado no disco').toEqual([]);

    a.disco.cheio = false;
    // a tela (useCore) recarrega o armazém quando a fila do motor muda; aqui, explicitamente
    await a.acao.armazem.carregar();
    const de_novo = await tentarCheckin(a.acao, clienteResumo(C1, 'Mercado Sol'), P1);
    expect(['created', 'existing']).toContain(de_novo.kind);
    expect(abertas(a).filter((v) => v.customer_id === C1), 'um só atendimento aberto no cliente').toHaveLength(1);
  });

  // D-T0039d (corrigido pelo engenheiro-software em 05/11, R-20261105-155126-engenheiro-software): o motor grava no disco
  // ANTES de mudar a memória; com o disco cheio, nada de item "fantasma" na fila em memória nem atendimento aberto na tela.
  it('F-02 D-T0039d RN-CORE-10: depois do erro de gravação, a fila em memória e a tela ficam como o disco: sem item de check-in e sem atendimento aberto; o Check-in seguinte não duplica', async () => {
    const a = await aparelhoOffline();
    a.disco.cheio = true;
    expect((await tentarCheckin(a.acao, clienteResumo(C1, 'Mercado Sol'), P1)).kind).toBe('erro');
    a.disco.cheio = false;
    expect(a.motor.estado().fila, 'fila em memória igual ao disco').toEqual([]);
    await a.acao.armazem.carregar();
    expect(abertas(a), 'a tela não mostra atendimento que o aparelho disse não ter registrado').toEqual([]);
    await tentarCheckin(a.acao, clienteResumo(C1, 'Mercado Sol'), P1);
    expect(a.motor.estado().fila.filter((i) => i.entidade === 'visita')).toHaveLength(1);
    expect(filaNoDisco(a).filter((i) => i.entidade === 'visita')).toHaveLength(1);
  });

  it('F-03 RN-CORE-10: falha DEPOIS de enfileirar (releitura do armazém) → erro na folha; o item já está na fila e o Check-in seguinte devolve o MESMO atendimento (sem duplicar)', async () => {
    const a = await aparelhoOffline();
    const carregar = vi.spyOn(a.acao.armazem, 'carregar').mockRejectedValueOnce(new Error('falha ao ler o armazenamento'));
    const r = await tentarCheckin(a.acao, clienteResumo(C1, 'Mercado Sol'), P1);
    expect(r).toEqual({ kind: 'erro', mensagem: MSG_FALHA_CHECKIN });
    const fila = a.motor.estado().fila.filter((i) => i.entidade === 'visita');
    expect(fila).toHaveLength(1);
    expect(filaNoDisco(a).map((i) => i.id)).toEqual([fila[0]!.id]);
    carregar.mockRestore();
    // a useCore recarrega o armazém quando a fila do motor muda
    await a.acao.armazem.carregar();
    const de_novo = await tentarCheckin(a.acao, clienteResumo(C1, 'Mercado Sol'), P1);
    expect(de_novo.kind).toBe('existing');
    if (de_novo.kind === 'existing') expect(de_novo.visit.id).toBe(fila[0]!.id);
    expect(a.motor.estado().fila.filter((i) => i.entidade === 'visita')).toHaveLength(1);
  });

  it('F-04 RN-CORE-10/11: tentarCheckin não esconde os resultados da regra: outro atendimento aberto → "blocked"; fora do raio sem justificativa → "justificar" (não viram "erro")', async () => {
    const a = await aparelhoOffline();
    expect((await tentarCheckin(a.acao, clienteResumo(C1, 'Mercado Sol'), P1)).kind).toBe('created');
    const outro = await tentarCheckin(a.acao, clienteResumo(C2, 'Auto Peças Dois'), P2);
    expect(outro.kind).toBe('blocked');

    const b = await aparelhoOffline();
    gps.posicao = { lat: -3.2, lng: -60.1, precisao_m: 10 };
    const longe = await tentarCheckin(b.acao, clienteResumo(C2, 'Auto Peças Dois', -3.1019, -60.025), P2);
    expect(longe.kind).toBe('justificar');
    expect(b.motor.estado().fila).toEqual([]);
  });
});
