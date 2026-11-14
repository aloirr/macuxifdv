/**
 * Push de visita (desenho T-0016 §4.3): check-in (`visita`, id = id da visita) e checkout (`visita_checkout`,
 * id = UUID do comando). O servidor sempre revalida:
 *  - RN-CORE-10: fora do raio exige justificativa (sinaliza `fora_do_raio`); cliente sem coordenada sugere a coordenada;
 *  - RN-CORE-52: cliente fora da rota do dia do usuário só com a ação `visita.checkin_fora_de_rota` (erro `CHECKIN_FORA_DE_ROTA`);
 *  - RN-CORE-11: um atendimento aberto por usuário (a anterior fecha como `auto`/`nao_finalizado`);
 *  - RN-CORE-12: com Vendedor efetivo, `sem_pedido` exige motivo; sem Vendedor o resultado é `atendido`;
 *  - RN-CORE-13: o GPS só chega no check-in e no checkout (nunca rastro);
 *  - RN-CORE-14: cliente fechado exige motivo `cliente_fechado` e a foto da fachada (`tx.registrarArquivo`, ADR 0010).
 * Idempotência pelo UUID do aparelho: reenviar o mesmo item é `aceito` sem duplicar nada. Cada item roda na sua
 * própria transação (`ctx.comTenant`); regra violada vira `rejeitado` só daquele item, erro de banco derruba o lote.
 * Sem dado pessoal em log.
 */
import {
  ErroHttpModulo,
  pode,
  type ClienteBanco,
  type ContextoBase,
  type ItemPush,
  type ResultadoItemPush,
  type TransacaoTenant,
} from '@macuxi/platform-sdk';
import type { CheckinVisita, CheckoutVisita } from '../contracts';
import { ACAO_CHECKIN_FORA_DE_ROTA, CODIGO_CHECKIN_FORA_DE_ROTA, EVENTO_VISITA_CHECKIN, EVENTO_VISITA_CHECKOUT, MENSAGEM_CHECKIN_FORA_DE_ROTA } from '../contracts';
import { avaliarCheckin, checkinPermitido, avaliarCheckoutTolerante, dataLocal, idDoPayloadConfere, RAIO_CHECKIN_PADRAO_M, resolverCheckin } from '../domain';

import { verificadorPorConsulta, type VerificarEtapas } from './etapas-checkout';
import { gravarEtapasDoCheckout } from './etapas-pendencia';

const aceito = (id: string): ResultadoItemPush => ({ id, status: 'aceito' });
const rejeitado = (id: string, codigo: string, mensagem: string): ResultadoItemPush => ({ id, status: 'rejeitado', codigo, mensagem });
const iso = (d: Date | string): string => new Date(d).toISOString();

/** Parâmetro `core.checkin.raio_m` (plataforma.parametro); inválido ou ausente = 200 m. */
export async function raioDoTenant(db: ClienteBanco): Promise<number> {
  const r = await db.query<{ valor: unknown }>("select valor from plataforma.parametro where modulo = 'core' and chave = 'checkin.raio_m' and deleted_at is null limit 1");
  const n = Number(r.rows[0]?.valor);
  return Number.isFinite(n) && n > 0 ? n : RAIO_CHECKIN_PADRAO_M;
}

/** Roda cada item na própria transação; 4xx do módulo (ex.: arquivo já referenciado) rejeita só o item. */
async function porItem(
  ctx: ContextoBase,
  itens: readonly ItemPush[],
  fn: (db: ClienteBanco, tx: TransacaoTenant, item: ItemPush) => Promise<ResultadoItemPush>,
): Promise<ResultadoItemPush[]> {
  const saida: ResultadoItemPush[] = [];
  for (const item of itens) {
    if (item.operacao === 'remover') {
      saida.push(rejeitado(item.id, 'OPERACAO_NAO_SUPORTADA', 'Visita não pode ser removida pelo aparelho.'));
      continue;
    }
    if (!idDoPayloadConfere(item.id, item.payload as { id?: unknown })) {
      saida.push(rejeitado(item.id, 'PAYLOAD_INVALIDO', 'O id do item da fila não confere com o id do payload.'));
      continue;
    }
    try {
      saida.push(await ctx.comTenant((db, tx) => fn(db, tx, item)));
    } catch (e) {
      if (!(e instanceof ErroHttpModulo) || e.status >= 500) throw e;
      saida.push(rejeitado(item.id, e.codigo, e.message));
    }
  }
  return saida;
}

interface AbertaLinha {
  id: string;
  cliente_id: string;
  checkin_em: Date;
}

/** RN-CORE-52: clientes das paradas da rota do dia (rota não cancelada) do usuário + a ação do perfil, pela regra pura do domínio. */
async function checkinNaRotaPermitido(ctx: ContextoBase, db: ClienteBanco, usuarioId: string, p: CheckinVisita): Promise<boolean> {
  const podeForaDeRota = pode(ctx.usuario.perfis, ACAO_CHECKIN_FORA_DE_ROTA);
  // com a ação, qualquer cliente da carteira passa: nem consulta a rota
  if (podeForaDeRota) return true;
  const dia = dataLocal(p.checkin_em, ctx.fuso());
  const r = await db.query<{ cliente_id: string }>(
    `select rp.cliente_id from core.rota_parada rp join core.rota r on r.id = rp.rota_id
      where rp.usuario_id = $1 and rp.data = $2::date and rp.cliente_id = $3 and rp.deleted_at is null and r.deleted_at is null and r.situacao <> 'cancelada'`,
    [usuarioId, dia, p.cliente_id],
  );
  return checkinPermitido({ clienteId: p.cliente_id, clientesDaRota: r.rows.map((x) => x.cliente_id), podeForaDeRota });
}

export async function receberCheckins(ctx: ContextoBase, itens: readonly ItemPush[]): Promise<ResultadoItemPush[]> {
  const visiveis = await ctx.carteira();
  const eu = ctx.usuario.id;
  return porItem(ctx, itens, async (db, tx, item) => {
    const p = item.payload as CheckinVisita;
    // serializa envios simultâneos do mesmo check-in (timeout + retentativa): o segundo espera o primeiro e cai na idempotência
    await db.query('select pg_advisory_xact_lock(hashtext($1))', [`visita:${p.id}`]);
    // 1) idempotência: mesmo id, mesmo usuário e cliente = reenvio
    const ja = (await db.query<{ usuario_id: string; cliente_id: string }>('select usuario_id, cliente_id from core.visita where id = $1', [p.id])).rows[0];
    if (ja) return ja.usuario_id === eu && ja.cliente_id === p.cliente_id ? aceito(item.id) : rejeitado(item.id, 'ID_EM_USO', 'Este identificador de visita já pertence a outro registro.');
    // 2) escopo (RN-CORE-04): promotor e vendedor só a própria carteira
    if (visiveis !== 'tenant' && !visiveis.has(p.cliente_id)) return rejeitado(item.id, 'FORA_DA_CARTEIRA', 'Este cliente não está na sua carteira. Atualize os dados e tente de novo.');
    const cli = (await db.query<{ lat: number | null; lng: number | null }>('select latitude::float8 as lat, longitude::float8 as lng from core.cliente where id = $1 and deleted_at is null', [p.cliente_id])).rows[0];
    if (!cli) return rejeitado(item.id, 'FORA_DA_CARTEIRA', 'Cliente não encontrado. Atualize os dados e tente de novo.');
    // 3) RN-CORE-52: fora da rota do dia, só com a ação no perfil (o dia é o do check-in, no fuso do tenant)
    if (!(await checkinNaRotaPermitido(ctx, db, eu, p))) return rejeitado(item.id, CODIGO_CHECKIN_FORA_DE_ROTA, MENSAGEM_CHECKIN_FORA_DE_ROTA);
    // 4) RN-CORE-10 / RN-CORE-13
    const posicao = p.lat != null && p.lng != null ? { lat: p.lat, lng: p.lng } : null;
    const aval = avaliarCheckin({ cliente: { lat: cli.lat, lng: cli.lng }, posicao, raio_m: await raioDoTenant(db), justificativa: p.justificativa_fora_raio });
    if (!aval.pode) return rejeitado(item.id, 'RN-CORE-10', 'Check-in fora do raio do cliente exige justificativa.');
    // 5) RN-CORE-11: fecha as abertas antes (o índice único parcial é a trava final)
    const fuso = ctx.fuso();
    const abertas = (await db.query<AbertaLinha>('select id, cliente_id, checkin_em from core.visita where usuario_id = $1 and checkout_em is null and deleted_at is null', [eu])).rows;
    const { fechar } = resolverCheckin(
      abertas.map((a) => ({ id: a.id, cliente_id: a.cliente_id, checkin_em: iso(a.checkin_em), checkout_em: null })),
      { id: p.id, cliente_id: p.cliente_id, checkin_em: p.checkin_em },
      ctx.agora(),
      fuso,
    );
    for (const f of fechar) {
      const v = abertas.find((a) => a.id === f.id)!;
      await db.query("update core.visita set checkout_em = $2, resultado = 'nao_finalizado', fechada_por = 'auto' where id = $1 and checkout_em is null", [f.id, f.checkout_em]);
      await tx.publicar(
        EVENTO_VISITA_CHECKOUT,
        {
          visita_id: f.id,
          usuario_id: eu,
          cliente_id: v.cliente_id,
          checkin_em: iso(v.checkin_em),
          checkout_em: iso(f.checkout_em),
          data_local: dataLocal(v.checkin_em, fuso),
          resultado: 'nao_finalizado',
          motivo_codigo: null,
          pedido_id: null,
          fechada_por: 'auto',
          permanencia_s: Math.max(0, Math.round((Date.parse(f.checkout_em) - v.checkin_em.getTime()) / 1000)),
        },
        f.id,
      );
    }
    // parada de outro usuário (ou inexistente) não vira vínculo
    const parada = p.rota_parada_id
      ? (await db.query('select 1 from core.rota_parada where id = $1 and usuario_id = $2 and deleted_at is null', [p.rota_parada_id, eu])).rows.length > 0
      : false;
    const dia = dataLocal(p.checkin_em, fuso);
    const ins = await db.query(
      `insert into core.visita (id, tenant_id, usuario_id, cliente_id, rota_parada_id, data_local, checkin_em, checkin_lat, checkin_lng,
                                checkin_precisao_m, sem_gps, distancia_m, fora_do_raio, justificativa_fora_raio, sugere_coordenada, extra)
       values ($1, plataforma.tenant_atual(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       on conflict (id) do nothing returning id`,
      [
        p.id, eu, p.cliente_id, parada ? p.rota_parada_id : null, dia, p.checkin_em,
        posicao?.lat ?? null, posicao?.lng ?? null, p.precisao_m == null ? null : Math.round(p.precisao_m),
        aval.sem_gps, aval.distancia_m, aval.fora_do_raio, aval.fora_do_raio ? (p.justificativa_fora_raio ?? '').trim() : null, aval.sugere_coordenada, p.extra,
      ],
    );
    if (ins.rows.length === 0) {
      const outra = (await db.query<{ usuario_id: string; cliente_id: string }>('select usuario_id, cliente_id from core.visita where id = $1', [p.id])).rows[0];
      return outra && outra.usuario_id === eu && outra.cliente_id === p.cliente_id ? aceito(item.id) : rejeitado(item.id, 'ID_EM_USO', 'Este identificador de visita já pertence a outro registro.');
    }
    await tx.publicar(
      EVENTO_VISITA_CHECKIN,
      {
        visita_id: p.id,
        usuario_id: eu,
        cliente_id: p.cliente_id,
        rota_parada_id: parada ? (p.rota_parada_id ?? null) : null,
        checkin_em: iso(p.checkin_em),
        data_local: dia,
        fora_do_raio: aval.fora_do_raio,
        distancia_m: aval.distancia_m,
        sem_gps: aval.sem_gps,
        extra: p.extra,
      },
      p.id,
    );
    return aceito(item.id);
  });
}

interface VisitaCheckout {
  id: string;
  cliente_id: string;
  checkin_em: Date;
  checkout_em: Date | null;
  checkout_id: string | null;
  fechada_por: string | null;
}

export async function receberCheckouts(ctx: ContextoBase, itens: readonly ItemPush[], verificarFixo?: VerificarEtapas): Promise<ResultadoItemPush[]> {
  const eu = ctx.usuario.id;
  const vendedorEfetivo = ctx.usuario.modulos.includes('vendedor');
  return porItem(ctx, itens, async (db, tx, item) => {
    const p = item.payload as CheckoutVisita;
    const verificar = verificarFixo ?? verificadorPorConsulta(tx);
    // 1) visita inexistente ou de outro usuário: mesma resposta nos dois casos
    const v = (
      await db.query<VisitaCheckout>(
        'select id, cliente_id, checkin_em, checkout_em, checkout_id, fechada_por from core.visita where id = $1 and usuario_id = $2 and deleted_at is null for update',
        [p.visita_id, eu],
      )
    ).rows[0];
    if (!v) return rejeitado(item.id, 'VISITA_NAO_ENCONTRADA', 'Visita não encontrada. Atualize os dados e tente de novo.');
    // 2) idempotência / conflito. A fechada sozinha (auto) cede ao checkout do usuário: é o fato real.
    if (v.checkout_id === p.id) return aceito(item.id);
    if (v.checkout_em && v.fechada_por !== 'auto') {
      return { id: item.id, status: 'conflito', mensagem: 'Esta visita já foi encerrada por outro checkout.', atual: { visita_id: v.id, checkout_em: iso(v.checkout_em), checkout_id: v.checkout_id } };
    }
    const comandoEmUso = await db.query('select 1 from core.visita where checkout_id = $1', [p.id]);
    if (comandoEmUso.rows.length > 0) return rejeitado(item.id, 'ID_EM_USO', 'Este identificador de checkout já pertence a outra visita.');
    // 3) RN-CORE-12 / RN-CORE-14: o servidor revalida tudo; as etapas dos outros módulos vêm da verificação deles, não do aparelho
    const motivo = p.motivo_id
      ? (await db.query<{ tipo: 'nao_venda' | 'cliente_fechado' | 'fora_do_raio'; codigo: string; ativo: boolean; updated_at: Date; deleted_at: Date | null }>('select tipo, codigo, ativo, updated_at, deleted_at from core.motivo where id = $1', [p.motivo_id])).rows[0]
      : undefined;
    const verificacoes = await verificar({ visita_id: v.id, cliente_id: v.cliente_id, usuario_id: eu, cliente_fechado: p.resultado === 'cliente_fechado' });
    const aval = avaliarCheckoutTolerante({
      resultadoInformado: p.resultado,
      vendedorEfetivo,
      motivoId: p.motivo_id ?? null,
      motivoTexto: p.motivo_texto ?? null,
      // RLS limita ao tenant; sem coluna de desativação, `deleted_at` (ou `updated_at` do motivo inativo) é o melhor marco
      motivo: motivo ? { tipo: motivo.tipo, ativo: motivo.ativo && !motivo.deleted_at, desativadoEm: motivo.deleted_at ? iso(motivo.deleted_at) : motivo.ativo ? null : iso(motivo.updated_at) } : null,
      checkoutEm: iso(p.checkout_em),
      fotoFachada: Boolean(p.foto_fachada_id),
      temPedido: Boolean(p.pedido_id),
      verificacoes,
    });
    if (aval.decisao === 'recusar') {
      if (aval.codigo === 'MOTIVO_INVALIDO') return rejeitado(item.id, 'MOTIVO_INVALIDO', 'Motivo não encontrado. Atualize os motivos e escolha de novo.');
      return rejeitado(item.id, aval.codigo ?? 'RN-CORE-12', `Checkout incompleto (${aval.pendencias.join(', ')}). Conclua o que falta e envie de novo.`);
    }
    const fechado = p.resultado === 'cliente_fechado';
    // 4) foto da fachada: linha em plataforma.arquivo ANTES do update (FK imediata); 409 se o id for de outra entidade
    if (fechado) await tx.registrarArquivo({ id: p.foto_fachada_id!, finalidade: 'fachada', entidade: 'visita', entidade_id: v.id, cliente_id: v.cliente_id });
    const checkoutEm = Date.parse(p.checkout_em) < v.checkin_em.getTime() ? v.checkin_em.toISOString() : iso(p.checkout_em);
    await db.query(
      `update core.visita
          set checkout_id = $2, checkout_em = $3, checkout_lat = $4, checkout_lng = $5, resultado = $6, motivo_id = $7,
              motivo_texto = $8, pedido_id = $9, foto_fachada_id = $10, fechada_por = 'usuario'
        where id = $1`,
      [v.id, p.id, checkoutEm, p.lat ?? null, p.lng ?? null, p.resultado, p.motivo_id ?? null, p.motivo_texto?.trim() || null, p.pedido_id ?? null, fechado ? p.foto_fachada_id : null],
    );
    // etapas gravadas: as verificadas pelo servidor (concluída/dispensada/PENDENTE: tolerância, RN-CORE-12 T-0039 §2); a referência vem do que o aparelho informou
    const referencias = new Map(p.etapas.map((x) => [`${x.modulo}|${x.etapa}`, x.referencia_id] as const));
    // etapas sem verificação no servidor (módulo ainda sem a consulta) ficam só como registro informado pelo aparelho; não liberam nada
    const doServidor = new Set(aval.etapasRegistro.map((x) => `${x.modulo}|${x.etapa}`));
    const informadas = p.etapas
      .filter((x) => !doServidor.has(`${x.modulo}|${x.etapa}`) && !verificacoes.some((vf) => vf.modulo === x.modulo && vf.etapa === x.etapa))
      .map((x) => ({ modulo: x.modulo, etapa: x.etapa, situacao: x.situacao, rotulo: null }));
    const registro = [...aval.etapasRegistro, ...informadas].map((e) => ({ ...e, referenciaId: referencias.get(`${e.modulo}|${e.etapa}`) ?? null }));
    // linha pendente e contagem na MESMA transação (sem rebaixar `concluida`)
    if (registro.length > 0) await gravarEtapasDoCheckout(db, v.id, registro, ctx.agora());
    const fuso = ctx.fuso();
    await tx.publicar(
      EVENTO_VISITA_CHECKOUT,
      {
        visita_id: v.id,
        usuario_id: eu,
        cliente_id: v.cliente_id,
        checkin_em: iso(v.checkin_em),
        checkout_em: checkoutEm,
        data_local: dataLocal(v.checkin_em, fuso),
        resultado: p.resultado,
        motivo_codigo: motivo?.codigo ?? null,
        pedido_id: p.pedido_id ?? null,
        fechada_por: 'usuario',
        permanencia_s: Math.max(0, Math.round((Date.parse(checkoutEm) - v.checkin_em.getTime()) / 1000)),
      },
      v.id,
    );
    return aceito(item.id);
  });
}
