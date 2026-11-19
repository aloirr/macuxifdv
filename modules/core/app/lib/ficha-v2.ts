/**
 * Cliente 360 v2 no app (T-0186, RN-CORE-40; spec docs/design/cliente-360-v2 §3 a §5): funções puras da ficha, as mesmas no Campo e no
 * Gestão. As regras vêm do `domain` (status da NF, abas, Performance, crédito); aqui só ficam a montagem das linhas e dos textos.
 * Sem alerta financeiro na ficha (R-20261119-0440): o atraso aparece só na tabela do Histórico.
 */
import { formatarDocumento, formatBRL } from '@macuxi/comum';
import type { LinhaRotuloValor } from '@macuxi/ui/mobile';

import {
  abasDaFicha,
  inicioDoPeriodoNf,
  periodoPrecisaDoServidor,
  rotuloStatusNf,
  type AbaFicha,
  type FiltroHistoricoNf,
  type PerformanceCalculada,
  type PeriodoNf,
} from '../../domain';
import type { PedidoQuePesaNoCredito } from '../../../vendedor/contracts';
import type { CartaoCredito, DocumentoLinhaContrato, LinhaHistoricoNfContrato, NotaDetalhe, StatusNf } from '../../contracts';
import { podeAbrirFormato } from './abrir-arquivo';

// ---------- formatos ----------

/** "07/11" (a faixa do mês já traz o ano). */
export const dataCurta = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
/** "07/11/2026". */
export const dataBr = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
/** "10/2026" (validade e vencimento de documento). */
export const mesAno = (iso: string): string => `${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
/** "1.280,00": o valor da célula, sem "R$" (a moeda vai no cabeçalho, "Valor (R$)"). */
export const valorSemMoeda = (cents: number): string => formatBRL(cents).replace(/^(-?)R\$\s?/, '$1');
/** "− 330,00": a devolução na 2ª linha do valor (P4). */
export const devolucaoNaCelula = (cents: number): string => `− ${valorSemMoeda(cents)}`;

const MESES = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
/** "NOVEMBRO DE 2026": a faixa que separa as notas por mês. */
export const faixaDoMes = (iso: string): string => `${MESES[Number(iso.slice(5, 7)) - 1]} DE ${iso.slice(0, 4)}`;

// ---------- abas ----------

const ROTULO_ABA: Record<AbaFicha, string> = { resumo: 'Resumo', historico: 'Histórico', documentacao: 'Documentação' };

/** P12: o promotor sem `promotor_ve_pedidos` fica com Resumo e Documentação. */
export function abasDoApp(perfil: string, verPedidos: boolean): Array<{ id: AbaFicha; rotulo: string }> {
  return abasDaFicha(perfil, verPedidos).map((id) => ({ id, rotulo: ROTULO_ABA[id] }));
}

/** O Gestão acrescenta "Visitada por" ao bloco Performance (spec §6). */
export const perfilDeGestao = (perfil: string | null | undefined): boolean => perfil === 'supervisor' || perfil === 'gerente';

// ---------- Resumo ----------

/** Spec §3.1: Razão social, CNPJ, Filial, Segmento e Cliente desde; a linha sem valor não aparece. */
export function linhasDadosCadastrais(c: { razao_social: string; documento: string | null; segmento: string | null }, filial: string | null | undefined, clienteDesde: string | null): LinhaRotuloValor[] {
  const linhas: Array<LinhaRotuloValor | null> = [
    { rotulo: 'Razão social', valor: c.razao_social, testID: 'cliente-razao-social' },
    c.documento ? { rotulo: 'CNPJ', valor: formatarDocumento(c.documento), testID: 'cliente-cnpj' } : null,
    filial ? { rotulo: 'Filial', valor: filial, testID: 'cliente-filial' } : null,
    c.segmento ? { rotulo: 'Segmento', valor: c.segmento, testID: 'cliente-segmento' } : null,
    clienteDesde ? { rotulo: 'Cliente desde', valor: mesAno(clienteDesde), testID: 'cliente-desde' } : null,
  ];
  return linhas.filter((l): l is LinhaRotuloValor => l !== null);
}

/**
 * RN-VEN-12: pedidos que reduzem o saldo (aprovados, enviados e integrados ao ERP) no formato do `creditoDisponivel` do Vendedor;
 * a conta (o integrado só pesa sem o crédito do ERP) é dele, não daqui.
 */
export function pedidosQuePesamNoCredito(pedidos: ReadonlyArray<{ status: string; total_cents: number; deleted_at?: string | null }>): PedidoQuePesaNoCredito[] {
  return pedidos.filter((p) => !p.deleted_at && STATUS_QUE_PESAM.has(p.status)).map((p) => ({ total_cents: p.total_cents, integrado: p.status === 'integrated' }));
}
const STATUS_QUE_PESAM: ReadonlySet<string> = new Set(['approved', 'sent_to_erp', 'integrated']);

/** Spec §3.2: Limite, Saldo disponível e Prazo médio; com o cliente bloqueado, o motivo entra no fim do cartão. `null` = sem cartão. */
export function linhasCartaoCredito(c: CartaoCredito | null | undefined): LinhaRotuloValor[] | null {
  if (!c) return null;
  const linhas: LinhaRotuloValor[] = [
    { rotulo: 'Limite', valor: formatBRL(c.limite_cents), testID: 'cliente-limite' },
    { rotulo: 'Saldo disponível', valor: formatBRL(c.saldo_disponivel_cents), testID: 'cliente-saldo-disponivel' },
    { rotulo: 'Prazo médio', valor: c.prazo_medio_dias === null ? '—' : `${c.prazo_medio_dias} dias`, testID: 'cliente-prazo-medio' },
  ];
  if (c.bloqueado && c.motivo_bloqueio) linhas.push({ rotulo: 'Bloqueado por', valor: c.motivo_bloqueio, testID: 'cliente-motivo-bloqueio', perigo: true });
  return linhas;
}

/**
 * Spec §3.6: o bloco Performance, na ordem das curvas, dos indicadores de compra e das visitas. Sem compra na janela, "Sem compras em
 * 12 meses" no lugar dos indicadores (RN-CORE-40); as linhas de visita ficam. "Visitada por" só no Gestão. Sem "Última compra".
 */
export function linhasPerformance(p: PerformanceCalculada, opcoes: { gestao: boolean }): { titulo: 'Performance' | 'Visitas'; linhas: LinhaRotuloValor[]; semCompras: boolean } {
  const linhas: LinhaRotuloValor[] = p.curvas.map((c) => ({ rotulo: c.rotulo, valor: c.curva, testID: `cliente-curva-${c.dimensao}` }));
  const semCompras = Boolean(p.compras?.sem_compras);
  if (p.compras && !p.compras.sem_compras) {
    linhas.push(
      { rotulo: 'Compra média/mês', valor: formatBRL(p.compras.compra_media_mes_cents) },
      { rotulo: 'Ticket médio', valor: formatBRL(p.compras.ticket_medio_cents) },
      { rotulo: 'Frequência', valor: p.compras.frequencia_media_dias === null ? '—' : `a cada ${Math.round(p.compras.frequencia_media_dias)} dias` },
    );
  }
  linhas.push({ rotulo: 'Visitas', valor: String(p.visitas_total), testID: 'cliente-visitas' });
  if (p.ultima_visita_em) linhas.push({ rotulo: 'Última visita', valor: dataBr(p.ultima_visita_em), testID: 'cliente-ultima-visita' });
  if (opcoes.gestao && p.ultima_visita_por) linhas.push({ rotulo: 'Visitada por', valor: p.ultima_visita_por, testID: 'cliente-visitada-por' });
  // P12: sem acesso a compras (nem curvas nem indicadores) o bloco é só "Visitas"
  return { titulo: p.compras === null ? 'Visitas' : 'Performance', linhas, semCompras };
}

// ---------- Histórico ----------

export type PeriodoDoFiltro = PeriodoNf | 'datas';

export interface FiltroDaFicha {
  periodo: PeriodoDoFiltro;
  /** Só com `periodo: 'datas'`. */
  de?: string;
  ate?: string;
  status: StatusNf[];
  formas: string[];
  numero: string;
}

/** P8: o padrão é 90 dias, todos os status; o padrão não conta no botão. */
export const FILTRO_PADRAO: FiltroDaFicha = { periodo: '90d', status: [], formas: [], numero: '' };

const ROTULO_PERIODO: Record<PeriodoNf, string> = { '30d': '30 dias', '90d': '90 dias', '12m': '12 meses' };
export const rotuloPeriodo = (p: PeriodoNf): string => ROTULO_PERIODO[p];

/** Início e fim do filtro; o fim é hoje salvo em "Escolher datas". */
export function intervaloDoFiltro(f: FiltroDaFicha, hoje: string): { de: string; ate: string } {
  if (f.periodo === 'datas' && f.de) return { de: f.de, ate: f.ate ?? hoje };
  return { de: inicioDoPeriodoNf(f.periodo === 'datas' ? '90d' : f.periodo, hoje), ate: hoje };
}

/** P17: o período além de 90 dias só se consulta no servidor, e só com internet. */
export const filtroPrecisaDoServidor = (f: FiltroDaFicha, hoje: string): boolean => periodoPrecisaDoServidor(intervaloDoFiltro(f, hoje).de, hoje);

export interface ChipDoFiltro {
  id: string;
  texto: string;
}

/** Um chip por filtro fora do padrão, com "×" na tela ("Em atraso", "NF 004655"). */
export function chipsDoFiltro(f: FiltroDaFicha): ChipDoFiltro[] {
  const chips: ChipDoFiltro[] = [];
  if (f.numero.trim()) chips.push({ id: 'numero', texto: `NF ${f.numero.trim()}` });
  if (f.periodo === 'datas' && f.de) chips.push({ id: 'periodo', texto: f.ate && f.ate !== f.de ? `${dataBr(f.de)} a ${dataBr(f.ate)}` : dataBr(f.de) });
  else if (f.periodo !== '90d' && f.periodo !== 'datas') chips.push({ id: 'periodo', texto: rotuloPeriodo(f.periodo) });
  for (const s of f.status) chips.push({ id: `status:${s}`, texto: rotuloStatusNf(s) });
  for (const forma of f.formas) chips.push({ id: `forma:${forma}`, texto: forma });
  return chips;
}

/** O círculo laranja do botão: quantos filtros fora do padrão (cada chip conta um). */
export const contarFiltros = (f: FiltroDaFicha): number => chipsDoFiltro(f).length;

/** Tirar um chip (o "×"). */
export function removerChip(f: FiltroDaFicha, id: string): FiltroDaFicha {
  if (id === 'numero') return { ...f, numero: '' };
  if (id === 'periodo') return { ...f, periodo: '90d', de: undefined, ate: undefined };
  if (id.startsWith('status:')) return { ...f, status: f.status.filter((s) => s !== id.slice(7)) };
  if (id.startsWith('forma:')) return { ...f, formas: f.formas.filter((x) => x !== id.slice(6)) };
  return f;
}

/** "19102026" → "19/10/2026": só dígitos, com as barras na digitação. */
export function mascararData(texto: string): string {
  const d = texto.replace(/\D/g, '').slice(0, 8);
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join('/');
}

/** "19/10/2026" → "2026-10-19"; nulo se faltar parte ou o dia não existir. */
export function lerDataBr(texto: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(texto.trim());
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso;
}

/** "Escolher datas": a data inicial é obrigatória; sem a final, vale até hoje. O erro diz o que corrigir. */
export function periodoEscolhido(deTexto: string, ateTexto: string, hoje: string): { ok: true; de: string; ate: string } | { ok: false; erro: string } {
  const de = lerDataBr(deTexto);
  if (!de) return { ok: false, erro: 'Informe a data inicial.' };
  const ate = ateTexto.trim() === '' ? hoje : lerDataBr(ateTexto);
  if (!ate) return { ok: false, erro: 'Informe a data final no formato dd/mm/aaaa.' };
  if (ate > hoje) return { ok: false, erro: 'A data final não pode ser depois de hoje.' };
  if (de > ate) return { ok: false, erro: 'A data inicial vem depois da final.' };
  return { ok: true, de, ate };
}

/** Spec §3.5: a coluna da tabela Carteira é "Vendedor"; com mais de uma pessoa, "Pessoa". */
export const tituloDaCarteira = (pessoas: number): string => (pessoas > 1 ? 'Pessoa' : 'Vendedor');

/** O filtro na forma do `filtrarNotas` (domain). */
export function filtroDeNotas(f: FiltroDaFicha, hoje: string): FiltroHistoricoNf {
  const { de, ate } = intervaloDoFiltro(f, hoje);
  return { de, ate, status: f.status, forma_pagamento: f.formas, numero_nf: f.numero };
}

const SO_STATUS: Record<StatusNf, [string, string]> = {
  em_atraso: ['em atraso', 'em atraso'],
  em_aberto: ['em aberto', 'em aberto'],
  pago: ['paga', 'pagas'],
  devolvido: ['devolvida', 'devolvidas'],
  devolvido_parcial: ['com devolução parcial', 'com devolução parcial'],
};
const PERIODO_NA_CONTAGEM = (f: FiltroDaFicha): string => (f.periodo === 'datas' ? 'no período' : `últimos ${rotuloPeriodo(f.periodo)}`);

/** A contagem à esquerda do botão: "8 notas · últimos 90 dias" ou, com um status só, "1 nota em atraso · últimos 90 dias". */
export function textoContagemNotas(n: number, f: FiltroDaFicha): string {
  const um = n === 1;
  const unico = f.status.length === 1 ? f.status[0] : undefined;
  const base = unico ? `${n} ${um ? 'nota' : 'notas'} ${SO_STATUS[unico][um ? 0 : 1]}` : `${n} ${um ? 'nota' : 'notas'}`;
  return `${base} · ${PERIODO_NA_CONTAGEM(f)}`;
}

export interface GrupoDeNotas<T> {
  faixa: string;
  notas: T[];
}

/** Notas já da mais recente para a mais antiga, uma faixa por mês. */
export function agruparNotasPorMes<T extends { data: string }>(notas: readonly T[]): Array<GrupoDeNotas<T>> {
  const grupos: Array<GrupoDeNotas<T>> = [];
  for (const n of notas) {
    const faixa = faixaDoMes(n.data);
    const g = grupos[grupos.length - 1];
    if (g && g.faixa === faixa) g.notas.push(n);
    else grupos.push({ faixa, notas: [n] });
  }
  return grupos;
}

/** Acessibilidade da linha da nota ("NF 004655, 07/11/2026, Boleto 28 dias, valor 1.280,00, Em atraso"). */
export function leituraDaNota(n: LinhaHistoricoNfContrato): string {
  return [`NF ${n.numero_nf}`, dataBr(n.data), n.forma_pagamento, `valor ${valorSemMoeda(n.valor_cents)}`, rotuloStatusNf(n.status)].filter(Boolean).join(', ');
}

/** Consulta online (P17): a nota e a lista de documentos vêm do servidor e não ficam guardadas. */
export type EstadoDaConsulta = 'ocioso' | 'carregando' | 'erro' | 'ok';

// ---------- Documentação ----------

export interface GrupoDeDocumentos<T> {
  grupo: string;
  documentos: T[];
}

/** Uma faixa por grupo, na ordem em que a lista já vem (grupo e ordem do cadastro de tipos). */
export function agruparDocumentos<T extends { grupo: string }>(docs: readonly T[]): Array<GrupoDeDocumentos<T>> {
  const grupos: Array<GrupoDeDocumentos<T>> = [];
  for (const d of docs) {
    const g = grupos.find((x) => x.grupo === d.grupo);
    if (g) g.documentos.push(d);
    else grupos.push({ grupo: d.grupo, documentos: [d] });
  }
  return grupos;
}

export interface SegundaLinhaDoDocumento {
  texto: string;
  perigo: boolean;
}

/** Spec §5: "PDF · válido até 03/2027", "Vencido em 10/2026" (vermelho) ou "Sem permissão para abrir". */
export function segundaLinhaDoDocumento(d: Pick<DocumentoLinhaContrato, 'formato' | 'validade' | 'validade_situacao' | 'acesso'>): SegundaLinhaDoDocumento {
  if (d.acesso === 'bloqueado') return { texto: 'Sem permissão para abrir', perigo: false };
  const formato = d.formato ? d.formato.toUpperCase() : null;
  if (d.validade && d.validade_situacao === 'vencido') return { texto: [formato, `Vencido em ${mesAno(d.validade)}`].filter(Boolean).join(' · '), perigo: true };
  if (d.validade) return { texto: [formato, `válido até ${mesAno(d.validade)}`].filter(Boolean).join(' · '), perigo: false };
  return { texto: formato ?? '', perigo: false };
}

/** Data da coluna: "—" na linha sem permissão. */
export const dataDoDocumento = (d: Pick<DocumentoLinhaContrato, 'data' | 'acesso'>): string => (d.acesso === 'bloqueado' ? '—' : dataBr(d.data));

/** Ação da última coluna: abrir, cadeado (sem permissão) ou nenhuma (o shell não abre o formato, ex.: PDF na v1.0.15). */
export function acaoDoDocumento(d: Pick<DocumentoLinhaContrato, 'formato' | 'acesso'>): 'abrir' | 'cadeado' | 'nenhuma' {
  if (d.acesso === 'bloqueado') return 'cadeado';
  return podeAbrirFormato(d.formato) ? 'abrir' : 'nenhuma';
}

/** Leitura da linha: a sem permissão termina em "sem permissão para abrir". */
export function leituraDoDocumento(d: Pick<DocumentoLinhaContrato, 'nome' | 'acesso'>): string {
  return d.acesso === 'bloqueado' ? `${d.nome}, sem permissão para abrir` : `${d.nome}. Toque para abrir.`;
}

// ---------- detalhe da NF (consulta online, P17) ----------

/** "10/10/2026 · Boleto 14/21 dias": a data e a forma, embaixo do título da folha. */
export const subtituloDaNota = (n: Pick<NotaDetalhe, 'data' | 'forma_pagamento'>): string => [dataBr(n.data), n.forma_pagamento].filter(Boolean).join(' · ');

/** Spec §4: "Valor da nota" e, só quando houver, "Em atraso" (vermelho), "Devolvido em 29/10" ("− R$ 330,00") e "Valor final". */
export function linhasDoDetalheDaNota(n: NotaDetalhe): LinhaRotuloValor[] {
  const linhas: LinhaRotuloValor[] = [{ rotulo: 'Valor da nota', valor: formatBRL(n.valor_cents) }];
  const atraso = n.parcelas.filter((p) => p.em_atraso).reduce((soma, p) => soma + p.saldo_cents, 0);
  if (n.em_atraso && atraso > 0) linhas.push({ rotulo: 'Em atraso', valor: formatBRL(atraso), perigo: true });
  if (n.devolvido_cents > 0) {
    linhas.push({ rotulo: n.devolvido_em ? `Devolvido em ${dataCurta(n.devolvido_em)}` : 'Devolvido', valor: `− ${formatBRL(n.devolvido_cents)}` });
    linhas.push({ rotulo: 'Valor final', valor: formatBRL(n.valor_final_cents) });
  }
  return linhas;
}

/** "4 itens · R$ 1.280,00": a soma dos itens, embaixo do título da folha de itens. */
export function resumoDosItens(itens: ReadonlyArray<{ total_cents: number }>): string {
  return `${itens.length} ${itens.length === 1 ? 'item' : 'itens'} · ${formatBRL(itens.reduce((soma, i) => soma + i.total_cents, 0))}`;
}
