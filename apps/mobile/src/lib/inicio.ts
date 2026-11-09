/**
 * Textos e estados de desenho do Início (T-0076, referência aprovada R-20261104-164000-alexandre; substitui o layout da
 * T-0073 onde conflitar). Puro, roda em Node nos testes.
 * NENHUMA regra de negócio aqui: a meta do dia (RN-CORE-22/RN-CORE-26), a situação (`a_cumprir`, `dia_batido`…), a rota,
 * as notificações e a "Equipe agora" chegam prontas na `VisaoInicio` do Core (`useInicio()`). O shell só escolhe texto,
 * cor e ordem a partir delas. Dinheiro de centavos arredondado para reais inteiros; horas no fuso do tenant.
 */
import type { MembroAgoraContrato, MetaDoDia, VisaoInicio } from '@macuxi/core/contracts';
import { formatBRL0 } from '@macuxi/comum/money';
import { linkInternoNavegavel } from '@macuxi/platform-sdk';
import { colors, localIsoDate, longDateLabel, zonedParts } from '@macuxi/ui/mobile/puro';

// ---------- Boas-vindas ----------

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

const visitas = (n: number) => `${n} ${n === 1 ? 'visita' : 'visitas'}`;

/**
 * "6 visitas hoje · 3 feitas" (rota do aparelho). Sem paradas: "Sem rota hoje", e em dia não útil (`dia_util` do Core)
 * "Sem rota hoje · não é dia útil" — o único lugar da tela que diz isso (T-0124/RD-0006; o cartão Meta não repete).
 */
export function textoVisitasHoje(rota: { paradas_hoje: number; visitadas_hoje: number } | null, diaUtil = true): string | null {
  if (!rota) return null;
  if (rota.paradas_hoje === 0) return diaUtil ? 'Sem rota hoje' : 'Sem rota hoje · não é dia útil';
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

// ---------- Recados ----------

/**
 * Só navega para link interno de módulo (`/m/<caminho>`) cuja tela existe na visão do usuário (`telaExiste`, ligado a
 * `visao.pagina`); o resto abre a central de notificações. Link com tela inexistente (ex.: `/m/core-rota` gravado no
 * recado) caía em "Esta tela não está disponível para o seu perfil…" (T-0140, relato do dono do produto, 08/11).
 * RD-0032: a regra do link interno é do SDK (`linkInternoNavegavel`); aqui só o destino de reserva.
 */
export const destinoDaNotificacao = (link: string | null, telaExiste?: (caminho: string) => boolean): string => linkInternoNavegavel(link, telaExiste) ?? '/m/notificacoes';

/** Selo do bloco: "3 novos" · "1 novo" · nada com tudo lido. */
export function seloNovos(naoLidas: number): string | null {
  if (naoLidas <= 0) return null;
  return `${naoLidas > 99 ? '99+' : naoLidas} ${naoLidas === 1 ? 'novo' : 'novos'}`;
}

/** Ponto à esquerda: `destaque` = recado do dia (laranja), `sucesso` = pedido aprovado/faturado (verde), `novo`, `lido` (cinza). */
export type PontoRecado = 'destaque' | 'sucesso' | 'novo' | 'lido';

export interface ItemRecado {
  id: string;
  /** Título e corpo num texto só, em até 2 linhas: "Prioridade: Passe cedo no Mercadinho São Jorge…" (T-0124/RD-0009). */
  texto: string;
  /** "09:15" (hora pronta do Core, fuso do tenant). */
  hora: string;
  ponto: PontoRecado;
  /** Destino ao tocar (link interno de módulo ou a central). */
  destino: string;
  /** id da notificação a marcar como lida ao tocar; null se já lida. */
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

/** "Prioridade" + "Passe cedo…" → "Prioridade: Passe cedo…"; título que já termina em pontuação só ganha o espaço. */
export function textoDoRecado(titulo: string, corpo: string): string {
  const t = titulo.trim();
  const c = corpo.trim();
  if (!c) return t;
  if (!t) return c;
  return /[.:!?…—-]$/.test(t) ? `${t} ${c}` : `${t}: ${c}`;
}

/** `recados_hoje` (lista do Core): até 3 da caixa, o recado do dia primeiro e destacado; `total` = a caixa inteira (RD-0009). */
export type RecadosProntos = VisaoInicio['recados_hoje'];

export function recadosDoInicio(recados: RecadosProntos): ItemRecado[] {
  return recados.itens.map((r) => ({
    id: r.id,
    texto: textoDoRecado(r.titulo, r.subtitulo),
    hora: r.hora,
    ponto: r.destaque ? 'destaque' : r.lida ? 'lido' : TIPOS_SUCESSO.test(r.tipo) ? 'sucesso' : 'novo',
    // RD-0032: o Core já filtrou o formato (`inicio-local`); a tela confere se existe só no toque (`(tabs)/index.tsx`)
    destino: r.link ?? '/m/notificacoes',
    notificacao_id: r.lida ? null : r.id,
  }));
}

/** "Ver todos" só quando há mais na caixa do que o cartão mostra (RD-0009): `total` do Core maior que os itens. */
export function mostrarVerTodos(recados: RecadosProntos): boolean {
  return recados.total > recados.itens.length;
}

/** Bolinha só quando ajuda a distinguir itens: com 1 recado o selo "1 novo" já diz tudo (RD-0009). */
export function mostrarPontos(itens: readonly ItemRecado[]): boolean {
  return itens.length > 1;
}

// ---------- Meta do mês ----------

export const ROTULO_INDICADOR: Record<MetaDoDia['indicador'], string> = {
  venda_cents: 'Vendas',
  positivacao: 'Positivação',
  visitas: 'Visitas',
  cobertura_pct: 'Cobertura',
};

/** pontos-base (8500) → "85%". */
const pctDePontos = (pb: number) => `${Math.round(pb / 100)}%`;

/** Percentual do mês em pontos-base, pronto do Core: abaixo de 1% com 1 casa ("0,3%"), senão inteiro ("40%"). */
export function percentualDoMes(pb: number): string {
  const decimos = Math.round(pb / 10);
  if (pb > 0 && decimos < 10) return decimos === 0 ? '0%' : `0,${decimos}%`;
  return pctDePontos(pb);
}

/** Um número do indicador, com a unidade: "R$ 553" · "85%" · "6 visitas" · "1 cliente". */
function valorDe(indicador: MetaDoDia['indicador'], n: number): string {
  if (indicador === 'venda_cents') return formatBRL0(n);
  if (indicador === 'cobertura_pct') return pctDePontos(n);
  if (indicador === 'positivacao') return `${n} ${n === 1 ? 'cliente' : 'clientes'}`;
  return visitas(n);
}

/**
 * "x de y" com a unidade uma vez só, no fim, e só quando o rótulo não a diz (T-0124/RD-0005 e RD-0007):
 * "R$ 553 de R$ 180.000" · "1 de 15 clientes" · "0 de 90" (Visitas) · "0% de 90%" (Cobertura).
 */
export function xDeY(indicador: MetaDoDia['indicador'], feito: number, meta: number): { valor: string; de: string } {
  if (indicador === 'venda_cents' || indicador === 'cobertura_pct') return { valor: valorDe(indicador, feito), de: `de ${valorDe(indicador, meta)}` };
  if (indicador === 'positivacao') return { valor: String(feito), de: `de ${meta} ${meta === 1 ? 'cliente' : 'clientes'}` };
  return { valor: String(feito), de: `de ${meta}` };
}

/** Realizado do mês = até ontem + hoje, as duas partes prontas do Core (só soma para exibir). */
const realizadoDoMes = (m: MetaDoDia) => m.realizado_ate_ontem + m.realizado_hoje;

/**
 * Indicador do cartão grande: o que o Core escolheu em `meta_hoje.indicador`; sem ele, vendas quando há meta de vendas,
 * senão o primeiro com meta (promotor, RN-PRO-01).
 */
export function metaPrincipal(metas: readonly MetaDoDia[], escolhido?: MetaDoDia['indicador'] | null): { principal: MetaDoDia | null; outras: MetaDoDia[] } {
  const principal = (escolhido ? metas.find((m) => m.indicador === escolhido) : undefined) ?? metas.find((m) => m.indicador === 'venda_cents') ?? metas[0] ?? null;
  return { principal, outras: metas.filter((m) => m !== principal) };
}

/**
 * Números prontos do Core para o cartão (`meta_hoje`, core.inicio@1, RD-0002): `mes_pct`, `faltam_mes`, `por_dia_util` e
 * `dias_uteis_por_dia` (RN-CORE-22/26, os mesmos de Metas). O shell não faz conta: só escolhe o texto.
 */
export type MetaHojePronta = Pick<NonNullable<VisaoInicio['meta_hoje']>, 'mes_pct' | 'faltam_mes' | 'por_dia_util' | 'dias_uteis_por_dia'>;

export interface DesenhoMetaDoMes {
  /** Realizado do mês: "R$ 553" · "62%" · "1". */
  valor: string;
  /** "de R$ 180.000" · "de 15 clientes" · "de 80%". */
  de: string;
  /** "0,3%" (pronto do Core) · null sem o número do Core. */
  mes: string | null;
  /** 0–100 (a barra limita), do mesmo número do Core. */
  pct: number;
  corBarra: string;
  trilho: string;
  /**
   * Última linha (RD-0002): dia útil "Meta de hoje R$ 9.969" (meta do dia da RN-CORE-26, pronta do Core); dia não útil
   * "Faltam R$ 179.447 · R$ 9.445 por dia útil (19 dias)" (números do Core); dia batido "Meta de hoje batida"; mês batido
   * "Meta do mês batida" (docs/design/inicio.md §1.3); null sem o que dizer.
   */
  apoio: string | null;
  /** Mês batido: cartão e barra verdes. */
  verde: boolean;
  /** Dia ou mês batido: a última linha fica verde. */
  apoioVerde: boolean;
  /** Dia batido: ✓ antes da última linha (§1.3). */
  apoioMarca: boolean;
}

/**
 * Cartão "Meta do mês" do Início (T-0124/RD-0002, decisão do gerente R-20261108-161557 pela proposta do dono do produto;
 * substitui o §1.3 da T-0076): realizado do mês de meta do mês, barra e o % uma vez; a última linha muda conforme o dia.
 * Tudo vem pronto do Core (`MetaDoDia` e `meta_hoje`); aqui só se escolhe texto e cor pela `situacao`.
 */
export function desenhoMetaDoMes(m: MetaDoDia, pronto?: MetaHojePronta | null): DesenhoMetaDoMes {
  const { valor, de } = xDeY(m.indicador, realizadoDoMes(m), m.meta_mes);
  const mesPct = pronto?.mes_pct ?? null;
  const base = {
    valor,
    de,
    mes: mesPct != null ? percentualDoMes(mesPct) : null,
    pct: mesPct != null ? Math.min(100, mesPct / 100) : 0,
    corBarra: colors.accent,
    trilho: colors.lineSoft,
    verde: false,
    apoioVerde: false,
    apoioMarca: false,
  };
  switch (m.situacao) {
    case 'mes_batido':
      return { ...base, verde: true, apoioVerde: true, pct: 100, corBarra: colors.success, trilho: colors.successTrack, apoio: 'Meta do mês batida' };
    case 'dia_batido':
      return { ...base, apoioVerde: true, apoioMarca: true, apoio: 'Meta de hoje batida' };
    case 'a_cumprir':
      return { ...base, apoio: m.meta_dia != null ? `Meta de hoje ${valorDe(m.indicador, m.meta_dia)}` : null };
    case 'dia_nao_util':
      // RN-CORE-26: sem meta do dia. "não é dia útil" já está nas boas-vindas (RD-0006); aqui só quanto falta e por dia útil.
      return { ...base, corBarra: colors.ink3, apoio: linhaDoDiaNaoUtil(m.indicador, pronto) };
    case 'do_mes':
    default:
      // indicador só do mês (cobertura): o título já diz o período; nada a acrescentar.
      return { ...base, apoio: null };
  }
}

/** "Faltam R$ 179.447 · R$ 9.445 por dia útil (19 dias)", só com os números prontos do Core. */
function linhaDoDiaNaoUtil(indicador: MetaDoDia['indicador'], p?: MetaHojePronta | null): string | null {
  const partes: string[] = [];
  if (p?.faltam_mes != null && p.faltam_mes > 0) partes.push(`Faltam ${valorDe(indicador, p.faltam_mes)}`);
  if (p?.por_dia_util != null && p.por_dia_util > 0 && p.dias_uteis_por_dia != null && p.dias_uteis_por_dia > 0) {
    partes.push(`${valorDe(indicador, p.por_dia_util)} por dia útil (${p.dias_uteis_por_dia} ${p.dias_uteis_por_dia === 1 ? 'dia' : 'dias'})`);
  }
  return partes.length > 0 ? partes.join(' · ') : null;
}

/** Rótulo do cartão: "Meta do mês" (Gestão: "… da equipe"); indicador que não é vendas: " · Visitas". "Mês" só aqui (RD-0004). */
export function rotuloDaMeta(equipe: boolean, indicador?: MetaDoDia['indicador'] | null): string {
  const base = `Meta do mês${equipe ? ' da equipe' : ''}`;
  return indicador && indicador !== 'venda_cents' ? `${base} · ${ROTULO_INDICADOR[indicador]}` : base;
}

/** Linha compacta de um indicador secundário, sem barra (RD-0010): "Positivação  1 de 15 clientes". */
export interface DesenhoLinha {
  rotulo: string;
  valor: string;
  verde: boolean;
}

export function desenhoDaLinha(m: MetaDoDia): DesenhoLinha {
  const { valor, de } = xDeY(m.indicador, realizadoDoMes(m), m.meta_mes);
  return { rotulo: ROTULO_INDICADOR[m.indicador], valor: `${valor} ${de}`, verde: m.situacao === 'mes_batido' };
}

/** Nota da equipe: "1 de 3 já bateu a meta" (contagem pronta do Core; "mês" só no título, RD-0004). */
export function notaDaEquipe(m: MetaDoDia): string | null {
  return m.membros_mes_batido > 0 && m.membros_mes_batido < m.membros ? `${m.membros_mes_batido} de ${m.membros} já bateu a meta` : null;
}

/**
 * Aviso único de dado antigo (RD-0008), texto da prop `avisoDados` do `BotaoSincronizar` (docs/design/inicio.md §1.5): sem
 * cópia de vendas (`sem_realizado` do Core), "Sincronize para ver as vendas"; base defasada (`base.defasado`), "Dados de
 * 06/11, 6h28" no fuso do tenant; em dia, nada. Só com meta de vendas ou positivação (§2: o promotor só com visitas e
 * cobertura não recebe o aviso).
 */
export function avisoDosDados(visao: Pick<VisaoInicio, 'base' | 'sem_realizado' | 'metas'>, tz: string): string | null {
  // `sem_realizado` do Core já é só de vendas e positivação
  if (visao.sem_realizado.length > 0) return 'Sincronize para ver as vendas';
  if (!visao.metas.some((m) => m.indicador === 'venda_cents' || m.indicador === 'positivacao')) return null;
  const { base } = visao;
  if (!base.defasado || !base.calculado_em) return null;
  const dia = localIsoDate(base.calculado_em, tz);
  return `Dados de ${dia.slice(8, 10)}/${dia.slice(5, 7)}, ${horaCurta(base.calculado_em, tz)}`;
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
