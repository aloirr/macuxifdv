/**
 * Início (boas-vindas) só com as linhas do aparelho (offline-first, T-0073 §1.4; RN-CORE-26). Puro: recebe as linhas do pull
 * (`meta`, `rota_parada`, `visita`, `notificacao`, `parametro`, `cliente`), a fila e a cópia de `GET /v1/core/inicio` gravada pela
 * etapa `core-inicio`, e devolve a `VisaoInicio`. A conta é a das MESMAS funções puras do domain que a API roda (`metaDoDia`,
 * `metaDoDiaDaEquipe`, `recadoDoDia`, `equipeAgora`). Meta do mês vem sempre do pull; visitas e cobertura são 100% locais
 * (RN-CORE-20); vendas e positivação vêm da cópia, recalculada na virada do dia sem sinal. Sem relógio: `agora` vem de quem chama.
 */
import type { ItemSobreposicao } from '@macuxi/platform-sdk';

import type { ClienteSync, Inicio, InicioUsuario, MetaDoDia, MetaSync, NotificacaoSync, ParametroSync, RotaParadaSync, VisaoInicio, VisitaSync } from '../../contracts';
import {
  PARADO_MIN_PADRAO,
  aplicarPendentesVisita,
  calendarioDoTenant,
  dataLocal,
  ehDiaUtil,
  diasUteisRestantes,
  equipeAgora,
  indicadoresDoPeriodo,
  metaDoDia,
  metaDoDiaDaEquipe,
  recadoDoDia,
  recadosDeHoje,
  resumoMetaDeHoje,
  saudacaoDoDia,
  type IndicadorMeta,
  type ItemEquipe,
} from '../../domain';
import { linkInternoNavegavel as linkNavegavel } from '@macuxi/platform-sdk';
import { montarCaixa } from './notificacoes';
import { pendentesDaFila } from './rota-local';

export interface LinhasInicio {
  metas: readonly MetaSync[];
  paradas: readonly RotaParadaSync[];
  visitas: readonly VisitaSync[];
  notificacoes: readonly NotificacaoSync[];
  parametros: readonly ParametroSync[];
  clientes: readonly ClienteSync[];
}

const ORDEM: readonly IndicadorMeta[] = ['venda_cents', 'positivacao', 'visitas', 'cobertura_pct'];

const parametro = (ps: readonly ParametroSync[], chave: string): unknown => ps.find((p) => p.modulo === 'core' && p.chave === chave && !p.deleted_at)?.valor;

/** `inicio.parado_min` (minutos para a equipe ficar "parado"); ausente ou inválido = 60. */
function paradoMin(ps: readonly ParametroSync[]): number {
  const n = Number(parametro(ps, 'inicio.parado_min'));
  return Number.isInteger(n) && n > 0 ? n : PARADO_MIN_PADRAO;
}

/**
 * RN-CORE-26 (§1.4 item 4): vendas e positivação da cópia.
 * cópia de hoje (ou mais nova) = como veio; de dia anterior no mesmo mês = "hoje" soma em "até ontem" e hoje zera (defasado);
 * sem cópia ou de outro mês = sem realizado (`null`).
 */
function realizadoDaCopia(copia: Inicio | null, hoje: string): { usuarios: ReadonlyMap<string, InicioUsuario>; defasado: boolean } | null {
  if (!copia || copia.periodo !== hoje.slice(0, 7)) return null;
  const defasado = copia.dia < hoje;
  const virar = (r: InicioUsuario['venda_cents']): InicioUsuario['venda_cents'] => (r && defasado ? { ate_ontem: r.ate_ontem + r.hoje, hoje: 0 } : r);
  return { usuarios: new Map(copia.usuarios.map((u) => [u.usuario_id, { ...u, venda_cents: virar(u.venda_cents), positivacao: virar(u.positivacao) }])), defasado };
}

const realizadoDeFonte = (u: InicioUsuario | undefined, ind: IndicadorMeta) => (ind === 'venda_cents' ? (u?.venda_cents ?? null) : ind === 'positivacao' ? (u?.positivacao ?? null) : true);

export function montarInicio(
  l: LinhasInicio,
  copia: Inicio | null,
  fila: readonly ItemSobreposicao[],
  o: { usuarioId: string; perfil: string; fuso: string; agora: Date },
): VisaoInicio {
  const hoje = dataLocal(o.agora, o.fuso);
  const periodo = hoje.slice(0, 7);
  const equipe = o.perfil === 'supervisor' || o.perfil === 'gerente';
  const calendario = calendarioDoTenant(l.parametros.map((p) => ({ ...p, valor: p.valor })));
  const dias = diasUteisRestantes(periodo, hoje, calendario);

  const metasDoMes = l.metas.filter((m) => !m.deleted_at && m.periodo === periodo && m.valor > 0);
  const metaDe = (uid: string, ind: IndicadorMeta) => metasDoMes.find((m) => m.usuario_id === uid && m.indicador === ind);
  const base = realizadoDaCopia(copia, hoje);
  const membrosCopia = copia ? copia.usuarios : [];
  const ids = equipe ? (membrosCopia.length > 0 ? membrosCopia.map((u) => u.usuario_id) : [...new Set(metasDoMes.map((m) => m.usuario_id))]) : [o.usuarioId];

  // Visitas do pull ⊕ check-ins/checkouts ainda na fila (só os do próprio usuário nascem no aparelho).
  const minhas = l.visitas.filter((v) => !v.deleted_at && v.usuario_id === o.usuarioId);
  const minhasComFila = aplicarPendentesVisita([...minhas], pendentesDaFila(fila), { usuario_id: o.usuarioId, fuso: o.fuso });
  const visitas = [...l.visitas.filter((v) => !v.deleted_at && v.usuario_id !== o.usuarioId), ...minhasComFila];
  const paradas = l.paradas.filter((p) => !p.deleted_at);

  const porIndicador = new Map<IndicadorMeta, ItemEquipe[]>();
  for (const uid of ids) {
    const ps = paradas.filter((p) => p.usuario_id === uid).map((p) => ({ cliente_id: p.cliente_id, data: p.data }));
    const vs = visitas.filter((v) => v.usuario_id === uid);
    const ateOntem = indicadoresDoPeriodo({ periodo, usuario_id: uid, hoje, paradas: ps, visitas: vs.filter((v) => v.data_local < hoje) });
    const total = indicadoresDoPeriodo({ periodo, usuario_id: uid, hoje, paradas: ps, visitas: vs.filter((v) => v.data_local <= hoje) });
    const u = base?.usuarios.get(uid);
    const realizado: Record<IndicadorMeta, [number, number] | null> = {
      // Decisão do Alexandre (T-0073): indicador null (sem fonte) fica fora da visão, nunca como zero
      venda_cents: u?.venda_cents ? [u.venda_cents.ate_ontem, u.venda_cents.hoje] : null,
      positivacao: u?.positivacao ? [u.positivacao.ate_ontem, u.positivacao.hoje] : null,
      visitas: [ateOntem.visitados, total.visitados - ateOntem.visitados],
      cobertura_pct: [ateOntem.cobertura_pct, Math.max(0, total.cobertura_pct - ateOntem.cobertura_pct)],
    };
    for (const ind of ORDEM) {
      const meta = metaDe(uid, ind);
      const r = realizado[ind];
      if (!meta || !r) continue;
      const m = metaDoDia({ indicador: ind, periodo, hoje, calendario, meta_mes: meta.valor, realizado_ate_ontem: r[0], realizado_hoje: r[1] });
      porIndicador.set(ind, [...(porIndicador.get(ind) ?? []), { ...m, paradas_planejadas: total.planejados }]);
    }
  }
  const metas: MetaDoDia[] = [];
  for (const ind of ORDEM) {
    const itens = porIndicador.get(ind) ?? [];
    if (equipe) {
      const soma = metaDoDiaDaEquipe(ind, itens);
      if (soma) metas.push(soma);
    } else metas.push(...itens.map(({ paradas_planejadas: _p, ...m }) => m));
  }

  const caixa = montarCaixa(l.notificacoes, fila, o.agora);
  const recado = recadoDoDia(l.notificacoes, { usuario_id: o.usuarioId, hoje, agora: o.agora });

  // T-0076: indicadores com meta no mês e sem realizado (sem cópia de vendas/positivação) ≠ sem meta.
  const semRealizado = ORDEM.filter((ind) => ids.some((uid) => metaDe(uid, ind)) && !ids.some((uid) => realizadoDeFonte(base?.usuarios.get(uid), ind) !== null) && (ind === 'venda_cents' || ind === 'positivacao'));
  const vendaSemCopia = semRealizado.includes('venda_cents');
  const principal = metas.find((m) => m.indicador === 'venda_cents') ?? (vendaSemCopia ? undefined : metas[0]);

  const nomeDe = (cid: string) => {
    const c = l.clientes.find((x) => x.id === cid);
    return c ? c.nome_fantasia?.trim() || c.razao_social : '';
  };
  let rota: VisaoInicio['rota'] = null;
  if (!equipe) {
    const doDia = paradas.filter((p) => p.usuario_id === o.usuarioId && p.data === hoje).sort((a, b) => a.sequencia - b.sequencia);
    const doDiaVisitas = minhasComFila.filter((v) => v.data_local === hoje);
    const visitados = new Set(doDiaVisitas.map((v) => v.cliente_id));
    const planejados = [...new Map(doDia.map((p) => [p.cliente_id, p])).values()];
    const pendentes = planejados.filter((p) => !visitados.has(p.cliente_id));
    const aberta = doDiaVisitas.filter((v) => !v.checkout_em).sort((a, b) => (a.checkin_em < b.checkin_em ? 1 : -1))[0];
    rota = {
      paradas_hoje: planejados.length,
      visitadas_hoje: planejados.length - pendentes.length,
      restantes: pendentes.length,
      proxima: pendentes[0] ? { cliente_id: pendentes[0].cliente_id, nome: nomeDe(pendentes[0].cliente_id) } : null,
      visita_aberta: aberta ? { visita_id: aberta.id, cliente_id: aberta.cliente_id, nome: nomeDe(aberta.cliente_id) } : null,
    };
  }

  const equipeAgoraLista =
    equipe && membrosCopia.length > 0
      ? equipeAgora({
          hoje,
          agora: o.agora,
          parado_min: paradoMin(l.parametros),
          membros: membrosCopia.map((m) => ({ usuario_id: m.usuario_id, nome: m.nome, vendas_hoje_cents: base?.usuarios.get(m.usuario_id)?.venda_cents?.hoje ?? null })),
          visitas,
          paradas,
        })
      : equipe
        ? []
        : null;

  return {
    escopo: equipe ? 'equipe' : 'proprio',
    hoje,
    dia_util: ehDiaUtil(hoje, calendario),
    dias_uteis_restantes: dias,
    metas,
    rota,
    equipe_agora: equipeAgoraLista?.map((m) => (m.status === 'em_visita' && m.cliente_id ? { ...m, cliente_nome: nomeDe(m.cliente_id) || null } : m)) ?? null,
    saudacao: saudacaoDoDia(o.agora, o.fuso),
    equipe_nome: copia?.equipe_nome ?? null,
    recados_hoje: recadosDeHoje(
      caixa.map((n) => ({ id: n.id, titulo: n.titulo, corpo: n.corpo, tipo: n.tipo, updated_at: n.updated_at, lida: Boolean(n.lida_em), link: linkNavegavel(n.link) })),
      recado?.notificacao_id ?? null,
      o.fuso,
    ),
    meta_hoje: principal ? resumoMetaDeHoje(principal) : null,
    sem_realizado: semRealizado,
    base: { dia: base ? (copia as Inicio).dia : null, calculado_em: base ? (copia as Inicio).calculado_em : null, defasado: base?.defasado ?? false },
  };
}
