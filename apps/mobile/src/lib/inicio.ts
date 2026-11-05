/**
 * Textos e estados de desenho do Início (T-0076, referência aprovada R-20261104-164000-alexandre; substitui o layout da
 * T-0073 onde conflitar). Puro, roda em Node nos testes.
 * NENHUMA regra de negócio aqui: a meta do dia (RN-CORE-22/RN-CORE-26), a situação (`a_cumprir`, `dia_batido`…), a rota,
 * as notificações e a "Equipe agora" chegam prontas na `VisaoInicio` do Core (`useInicio()`). O shell só escolhe texto,
 * cor e ordem a partir delas. Dinheiro de centavos arredondado para reais inteiros; horas no fuso do tenant.
 */
import type { MembroAgoraContrato, MetaDoDia, VisaoInicio } from '@macuxi/core/contracts';
import { formatBRL0 } from '@macuxi/comum/money';
import { colors, localIsoDate, longDateLabel, zonedParts } from '@macuxi/ui/mobile/puro';

// ---------- Boas-vindas ----------

/** "Bom dia" 5h–11h59 · "Boa tarde" 12h–17h59 · "Boa noite" 18h–4h59, no fuso do tenant; só o primeiro nome. */
export function saudacao(agora: Date | string | number, tz: string, primeiroNome: string): string {
  const h = zonedParts(agora, tz).hour;
  const parte = h >= 5 && h < 12 ? 'Bom dia' : h >= 12 && h < 18 ? 'Boa tarde' : 'Boa noite';
  return primeiroNome ? `${parte}, ${primeiroNome}` : parte;
}

/** "Quarta, 4 de novembro" · na Gestão "Quarta, 4 de novembro · Equipe Manaus". */
export function dataDoCabecalho(agora: Date | string | number, tz: string, equipe?: string | null): string {
  const d = longDateLabel(agora, tz);
  return equipe ? `${d} · ${equipe}` : d;
}

/** "8h05" no fuso do tenant (textos corridos: "Em rota · saiu de um cliente às 9h40"). */
export function horaCurta(at: Date | string | number, tz: string): string {
  const p = zonedParts(at, tz);
  return `${p.hour}h${String(p.minute).padStart(2, '0')}`;
}

/** "09:15" no fuso do tenant (hora de relógio dos recados, como na referência). */
export function horaRelogio(at: Date | string | number, tz: string): string {
  const p = zonedParts(at, tz);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

const visitas = (n: number) => `${n} ${n === 1 ? 'visita' : 'visitas'}`;

/** "6 visitas hoje · 3 feitas" (rota do aparelho). Sem paradas: "Nenhuma visita na rota de hoje". */
export function textoVisitasHoje(rota: { paradas_hoje: number; visitadas_hoje: number } | null): string | null {
  if (!rota) return null;
  if (rota.paradas_hoje === 0) return 'Nenhuma visita na rota de hoje';
  return `${visitas(rota.paradas_hoje)} hoje · ${rota.visitadas_hoje} ${rota.visitadas_hoje === 1 ? 'feita' : 'feitas'}`;
}

/**
 * Gestão: as visitas da equipe somadas a partir da "Equipe agora" que o Core entrega (só contagem para exibir; o Core
 * já decidiu quem é da equipe e o que é parada). null sem a lista.
 */
export function visitasDaEquipe(membros: readonly MembroAgoraContrato[] | null): { paradas_hoje: number; visitadas_hoje: number } | null {
  if (!membros) return null;
  return membros.reduce((s, m) => ({ paradas_hoje: s.paradas_hoje + m.paradas_hoje, visitadas_hoje: s.visitadas_hoje + m.visitadas_hoje }), { paradas_hoje: 0, visitadas_hoje: 0 });
}

// ---------- Recados de hoje ----------

const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const;

/** Hora à direita do recado: "14:02" (hoje) · "ontem" · "seg" (na semana) · "28/10". */
export function quandoCurto(at: string, agora: Date | string | number, tz: string): string {
  const dia = localIsoDate(at, tz);
  const hoje = localIsoDate(agora, tz);
  const diff = Math.round((Date.parse(`${hoje}T12:00:00Z`) - Date.parse(`${dia}T12:00:00Z`)) / 86_400_000);
  if (diff <= 0) return horaRelogio(at, tz);
  if (diff === 1) return 'ontem';
  if (diff < 7) return DIAS_CURTOS[new Date(`${dia}T12:00:00Z`).getUTCDay()] ?? dia;
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
}

/** Só navega para link interno de módulo (`/m/<caminho>`); o resto abre a central de notificações. */
export function destinoDaNotificacao(link: string | null): string {
  return link && /^\/m\/[a-z0-9-]+/.test(link) ? link : '/m/notificacoes';
}

/** Selo do bloco: "3 novos" · "1 novo" · nada com tudo lido. */
export function seloNovos(naoLidas: number): string | null {
  if (naoLidas <= 0) return null;
  return `${naoLidas > 99 ? '99+' : naoLidas} ${naoLidas === 1 ? 'novo' : 'novos'}`;
}

/** Ponto à esquerda: `destaque` = recado do dia (laranja), `sucesso` = pedido aprovado/faturado (verde), `novo`, `lido` (cinza). */
export type PontoRecado = 'destaque' | 'sucesso' | 'novo' | 'lido';

export interface ItemRecado {
  id: string;
  titulo: string;
  /** "Marcos · 09:15" · "14:02" */
  apoio: string;
  ponto: PontoRecado;
  /** Destino ao tocar (link interno de módulo ou a central). */
  destino: string;
  /** id da notificação a marcar como lida ao tocar (quando o Core expuser a função). */
  notificacao_id: string | null;
}

export const COR_DO_PONTO: Record<PontoRecado, string> = {
  destaque: colors.accent,
  sucesso: colors.success,
  novo: colors.accent,
  lido: colors.ink3,
};

/** Tipos de notificação que são boa notícia (ponto verde). Só aparência; o tipo vem pronto do Core. */
const TIPOS_SUCESSO = /aprovad|faturad|meta_batida|batid/;

/**
 * "Recados de hoje" (premissa da T-0076): o recado do dia marcado pelo supervisor vem primeiro e destacado; depois as
 * notificações mais recentes (sem repetir a do recado), até 3 itens. A frase padrão (sem recado) não entra na lista.
 */
export function recadosDeHoje(visao: Pick<VisaoInicio, 'recado' | 'notificacoes' | 'recados_hoje'>, agora: Date | string | number, tz: string): ItemRecado[] {
  // T-0076: o Core já entrega a lista pronta (`recados_hoje`, aditivo no @1); o resto é o contorno para cópias antigas.
  if (visao.recados_hoje) {
    return visao.recados_hoje.itens.map((r) => ({
      id: r.id,
      titulo: r.titulo,
      apoio: [r.subtitulo, r.hora].filter(Boolean).join(' · '),
      ponto: r.destaque ? 'destaque' : r.lida ? 'lido' : TIPOS_SUCESSO.test(r.tipo) ? 'sucesso' : 'novo',
      destino: destinoDaNotificacao(r.link),
      notificacao_id: r.lida ? null : r.id,
    }));
  }
  const itens: ItemRecado[] = [];
  const { recado, notificacoes } = visao;
  if (recado.origem === 'recado') {
    const n = recado.notificacao_id ? notificacoes.ultimas.find((x) => x.id === recado.notificacao_id) : undefined;
    const apoio = [recado.autor_nome, n ? quandoCurto(n.criada_em, agora, tz) : null].filter(Boolean).join(' · ');
    itens.push({
      id: recado.notificacao_id ?? 'recado-do-dia',
      titulo: recado.texto,
      apoio,
      ponto: 'destaque',
      destino: destinoDaNotificacao(n?.link ?? null),
      notificacao_id: recado.notificacao_id,
    });
  }
  for (const n of notificacoes.ultimas) {
    if (itens.length >= 3) break;
    if (n.id === recado.notificacao_id) continue;
    itens.push({
      id: n.id,
      titulo: n.titulo,
      apoio: quandoCurto(n.criada_em, agora, tz),
      ponto: n.lida ? 'lido' : TIPOS_SUCESSO.test(n.tipo) ? 'sucesso' : 'novo',
      destino: destinoDaNotificacao(n.link),
      notificacao_id: n.id,
    });
  }
  return itens;
}

// ---------- Meta de hoje ----------

export const ROTULO_INDICADOR: Record<MetaDoDia['indicador'], string> = {
  venda_cents: 'Vendas',
  positivacao: 'Positivação',
  visitas: 'Visitas',
  cobertura_pct: 'Cobertura',
};

const pctInteiro = (parte: number, todo: number) => (todo > 0 ? Math.round((parte / todo) * 100) : 0);
/** pontos-base (8500) → "85%" */
const pctDePontos = (pb: number) => `${Math.round(pb / 100)}%`;

function valorDe(indicador: MetaDoDia['indicador'], n: number): string {
  if (indicador === 'venda_cents') return formatBRL0(n);
  if (indicador === 'cobertura_pct') return pctDePontos(n);
  if (indicador === 'positivacao') return `${n} ${n === 1 ? 'cliente' : 'clientes'}`;
  if (indicador === 'visitas') return visitas(n);
  return String(n);
}

/**
 * Indicador do cartão grande: o que o Core escolheu em `meta_hoje.indicador`; sem ele, vendas quando há meta de vendas,
 * senão o primeiro com meta (promotor, RN-PRO-01).
 */
export function metaPrincipal(metas: readonly MetaDoDia[], escolhido?: MetaDoDia['indicador'] | null): { principal: MetaDoDia | null; outras: MetaDoDia[] } {
  const principal = (escolhido ? metas.find((m) => m.indicador === escolhido) : undefined) ?? metas.find((m) => m.indicador === 'venda_cents') ?? metas[0] ?? null;
  return { principal, outras: metas.filter((m) => m !== principal) };
}

export interface DesenhoMetaDeHoje {
  /** "R$ 1.240" */
  valor: string;
  /** "de R$ 3.200" (meta do dia) · null sem meta do dia */
  de: string | null;
  /** 0–100 (a barra limita) */
  pct: number;
  corBarra: string;
  trilho: string;
  /** "Faltam R$ 1.960 hoje" · "Meta de hoje batida" · … */
  apoio: string;
  /** "mês 40%" */
  mes: string;
  verde: boolean;
}

/** Números já prontos do Core (`meta_hoje`, aditivo no @1): quando vêm, valem sobre a conta de exibição do shell. */
export type MetaHojePronta = Pick<NonNullable<VisaoInicio['meta_hoje']>, 'faltam_hoje' | 'mes_pct'>;

/** Cartão "Meta de hoje" (referência T-0076): realizado do dia × necessidade diária, barra, quanto falta e o % do mês. */
export function desenhoMetaDeHoje(m: MetaDoDia, pronto?: MetaHojePronta | null): DesenhoMetaDeHoje {
  const doMes = m.realizado_ate_ontem + m.realizado_hoje;
  const mes = `mês ${pronto?.mes_pct != null ? Math.round(pronto.mes_pct / 100) : pctInteiro(doMes, m.meta_mes)}%`;
  const base = { mes, trilho: colors.lineSoft, verde: false };
  const metaDia = m.meta_dia ?? 0;
  switch (m.situacao) {
    case 'dia_batido':
      return { ...base, verde: true, valor: valorDe(m.indicador, m.realizado_hoje), de: `de ${valorDe(m.indicador, metaDia)}`, pct: 100, corBarra: colors.success, trilho: colors.successTrack, apoio: 'Meta de hoje batida' };
    case 'mes_batido':
      return { ...base, verde: true, valor: valorDe(m.indicador, m.realizado_hoje), de: null, pct: 100, corBarra: colors.success, trilho: colors.successTrack, apoio: `Meta do mês batida · ${valorDe(m.indicador, doMes)} de ${valorDe(m.indicador, m.meta_mes)}` };
    case 'dia_nao_util': {
      const falta = Math.max(0, m.meta_mes - doMes);
      return { ...base, valor: valorDe(m.indicador, doMes), de: `de ${valorDe(m.indicador, m.meta_mes)} no mês`, pct: pctInteiro(doMes, m.meta_mes), corBarra: colors.ink3, apoio: falta > 0 ? `Hoje não é dia útil · faltam ${valorDe(m.indicador, falta)} no mês` : 'Hoje não é dia útil' };
    }
    case 'do_mes':
      return { ...base, valor: pctDePontos(doMes), de: `meta ${pctDePontos(m.meta_mes)}`, pct: pctInteiro(doMes, m.meta_mes), corBarra: colors.accent, apoio: 'Acumulado do mês' };
    case 'a_cumprir':
    default: {
      const pct = m.atingimento_hoje_pct != null ? Math.round(m.atingimento_hoje_pct / 100) : pctInteiro(m.realizado_hoje, metaDia);
      const falta = pronto?.faltam_hoje ?? Math.max(0, metaDia - m.realizado_hoje);
      return { ...base, valor: valorDe(m.indicador, m.realizado_hoje), de: `de ${valorDe(m.indicador, metaDia)}`, pct, corBarra: colors.accent, apoio: `Faltam ${valorDe(m.indicador, falta)} hoje` };
    }
  }
}

/** Linha compacta de um indicador secundário (e de cada indicador da equipe): "Positivação 2 clientes de 6 clientes". */
export interface DesenhoLinha {
  rotulo: string;
  valor: string;
  pct: number;
  verde: boolean;
}

export function desenhoDaLinha(m: MetaDoDia): DesenhoLinha {
  const d = desenhoMetaDeHoje(m);
  return { rotulo: ROTULO_INDICADOR[m.indicador], valor: d.de ? `${d.valor} ${d.de}` : d.valor, pct: d.pct, verde: d.verde };
}

/** Nota da equipe: "1 de 3 já bateu o mês" (contagem pronta do Core). */
export function notaDaEquipe(m: MetaDoDia): string | null {
  return m.membros_mes_batido > 0 && m.membros_mes_batido < m.membros ? `${m.membros_mes_batido} de ${m.membros} já bateu o mês` : null;
}

/** "Vendas até 02/11 às 18h40. Sincronize para atualizar." (`base.defasado`). */
export function textoBaseDefasada(base: VisaoInicio['base'], tz: string): string | null {
  if (!base.defasado || !base.calculado_em) return null;
  const dia = localIsoDate(base.calculado_em, tz);
  return `Vendas até ${dia.slice(8, 10)}/${dia.slice(5, 7)} às ${horaCurta(base.calculado_em, tz)}. Sincronize para atualizar.`;
}

// ---------- Equipe agora (Gestão) ----------

/** "1h40" · "45 min" */
export function duracaoCurta(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

export function situacaoDoMembro(m: MembroAgoraContrato, tz: string, nomeCliente?: string | null): { texto: string; cor: string } {
  switch (m.status) {
    case 'em_visita':
      return { texto: nomeCliente ? `Em visita · ${nomeCliente}` : 'Em visita', cor: colors.ink2 };
    case 'em_rota':
      return { texto: m.desde ? `Em rota · saiu de um cliente às ${horaCurta(m.desde, tz)}` : 'Em rota', cor: colors.ink2 };
    case 'parado':
      return { texto: m.minutos_sem_atividade != null ? `Sem check-in há ${duracaoCurta(m.minutos_sem_atividade)}` : 'Sem check-in', cor: colors.warning };
    case 'sem_checkin':
      return { texto: 'Sem check-in hoje', cor: colors.warning };
    case 'rota_concluida':
    default:
      return { texto: 'Rota concluída', cor: colors.success };
  }
}

/** "2/6 · R$ 1.240" (visitadas/paradas · vendas de hoje); sem vendas na cópia: "2/6". */
export function resumoDoMembro(m: MembroAgoraContrato): string {
  const rota = `${m.visitadas_hoje}/${m.paradas_hoje}`;
  return m.vendas_hoje_cents != null ? `${rota} · ${formatBRL0(m.vendas_hoje_cents)}` : rota;
}

// ---------- Cards do slot ----------

/** Cards do slot `inicio.cards` por `ordem` (menor primeiro; ausente = 100), estável na ordem do registro. */
export function ordenarCards<T extends { payload: { ordem?: number } }>(cards: readonly T[]): T[] {
  return cards
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (a.c.payload.ordem ?? 100) - (b.c.payload.ordem ?? 100) || a.i - b.i)
    .map(({ c }) => c);
}
