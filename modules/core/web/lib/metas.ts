/**
 * Tela "Metas e RV" do BKO (T-0068; RN-CORE-20, RN-CORE-21): funções puras sobre `GET /v1/core/metas/painel`.
 * Na tela o valor é o que a pessoa entende (R$, contagem, %); no contrato é o inteiro do domínio
 * (centavos, contagem, pontos-base). Os textos de exibição vêm de `app/lib/metas-formato`, os mesmos do app.
 */
import type { LinhaMetaBko, PutMeta } from '../../contracts';
import { formatarIndicador, ROTULO_INDICADOR } from '../../app/lib/metas-formato';
import { centavosDoTexto } from './indicadores';

type Indicador = LinhaMetaBko['indicador'];

const BOM = String.fromCharCode(0xfeff);
const aspas = (v: string) => `"${v.replace(/"/g, '""')}"`;

export const CABECALHO_METAS = ['Vendedor ou promotor', 'Indicador', 'Tipo', 'Meta', 'Realizado', 'Atingimento'];
export const ROTULO_TIPO: Record<LinhaMetaBko['tipo'], string> = { pedido: 'Pedido aprovado', faturamento: 'Faturamento' };
export const UNIDADE_DO_CAMPO: Record<Indicador, string> = { venda_cents: 'R$', visitas: 'visitas', positivacao: 'clientes', cobertura_pct: '%', itens_por_pedido: 'itens por pedido' };

const pontosBase = (v: number): string => `${(v / 100).toFixed(2).replace('.', ',')}%`;

/** Meta 0 = sem meta definida (o painel devolve a linha mesmo sem meta). */
export const semMeta = (l: Pick<LinhaMetaBko, 'meta'>): boolean => l.meta === 0;

/** Texto da meta para a tabela: "—" quando não há meta. */
export const textoDaMeta = (l: LinhaMetaBko): string => (semMeta(l) ? '—' : formatarIndicador(l.indicador, l.meta));

export function celulasDaLinha(l: LinhaMetaBko): string[] {
  return [
    l.usuario_nome,
    ROTULO_INDICADOR[l.indicador],
    l.indicador === 'venda_cents' ? ROTULO_TIPO[l.tipo] : '—',
    textoDaMeta(l),
    formatarIndicador(l.indicador, l.realizado),
    l.atingimento_pct === null ? '—' : pontosBase(l.atingimento_pct),
  ];
}

export function csvDeMetas(linhas: readonly LinhaMetaBko[]): string {
  const corpo = linhas.map((l) => celulasDaLinha(l).map(aspas).join(';'));
  return BOM + `${[CABECALHO_METAS.map(aspas).join(';'), ...corpo].join('\r\n')}\r\n`;
}

/** Valor atual no campo de edição: reais com vírgula, contagem, ou percentual (pontos-base ÷ 100). Sem meta = vazio. */
export function textoDeEdicao(indicador: Indicador, valor: number): string {
  if (valor === 0) return '';
  if (indicador === 'venda_cents') return (valor / 100).toFixed(2).replace('.', ',');
  if (indicador === 'cobertura_pct' || indicador === 'itens_por_pedido') return String(valor / 100).replace('.', ',');
  return String(valor);
}

export type CorpoDaMeta = { ok: true; corpo: PutMeta } | { ok: false; erro: string };

/**
 * Texto digitado → corpo do contrato. Venda em R$ → centavos; cobertura em % (0 a 100) → pontos-base (RN-CORE-20);
 * itens por pedido com uma casa → centésimos; visitas e positivação, inteiros. `tipo` só vale para venda (RN-CORE-21).
 */
export function corpoDaMeta(indicador: Indicador, texto: string, tipo: LinhaMetaBko['tipo'] = 'pedido'): CorpoDaMeta {
  const t = texto.trim();
  if (indicador === 'venda_cents') {
    const c = centavosDoTexto(t);
    if (c === null) return { ok: false, erro: 'Informe a meta de venda em reais, por exemplo 25.000,00.' };
    return { ok: true, corpo: { indicador, valor: c, tipo } };
  }
  if (indicador === 'cobertura_pct') {
    if (!/^\d+([.,]\d{1,2})?$/.test(t)) return { ok: false, erro: 'Informe a cobertura de 0 a 100, por exemplo 85.' };
    const pb = Math.round(Number(t.replace(',', '.')) * 100);
    if (pb > 10000) return { ok: false, erro: 'A meta de cobertura vai de 0 a 100%. Informe um valor até 100.' };
    return { ok: true, corpo: { indicador, valor: pb } };
  }
  if (indicador === 'itens_por_pedido') {
    // T-0170 (A-4): média com uma casa → centésimos (8,5 → 850)
    if (!/^\d+([.,]\d)?$/.test(t)) return { ok: false, erro: 'Informe os itens por pedido com até uma casa decimal, por exemplo 8,5.' };
    return { ok: true, corpo: { indicador, valor: Math.round(Number(t.replace(',', '.')) * 100) } };
  }
  if (!/^\d+$/.test(t)) return { ok: false, erro: `Informe a meta de ${ROTULO_INDICADOR[indicador].toLowerCase()} como número inteiro, por exemplo 40.` };
  return { ok: true, corpo: { indicador, valor: Number(t) } };
}

/** Linhas visíveis conforme o filtro de indicador (vazio = todos). */
export const filtrarPorIndicador = (linhas: readonly LinhaMetaBko[], indicador: string): LinhaMetaBko[] => (indicador ? linhas.filter((l) => l.indicador === indicador) : [...linhas]);

/** Quantas linhas o usuário pode editar (habilita o botão "Meta da equipe"). */
export const totalEditavel = (linhas: readonly LinhaMetaBko[]): number => linhas.filter((l) => l.editavel).length;

/** Mensagem de sucesso do lote. */
export const avisoDoLote = (alterados: number, total: number): string =>
  alterados === 0 ? 'Nada mudou: as metas da equipe já estavam com esse valor.' : `Meta aplicada a ${total} pessoa${total === 1 ? '' : 's'} da equipe (${alterados} alterada${alterados === 1 ? '' : 's'}) e registrada na auditoria.`;

/** Mês anterior (AAAA-MM) a um mês AAAA-MM; entrada inválida devolve ''. */
export function mesAnterior(mes: string): string {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(mes);
  if (!m) return '';
  const ano = Number(m[1]);
  const n = Number(m[2]);
  return n === 1 ? `${ano - 1}-12` : `${ano}-${String(n - 1).padStart(2, '0')}`;
}

export const avisoDaCopia = (copiadas: number, ignoradas: number): string =>
  copiadas === 0 ? 'Nada a copiar: o mês anterior não tem metas novas para este mês.' : `${copiadas} meta${copiadas === 1 ? '' : 's'} copiada${copiadas === 1 ? '' : 's'}${ignoradas > 0 ? `; ${ignoradas} já existia${ignoradas === 1 ? '' : 'm'} e ficou como estava` : ''}.`;
