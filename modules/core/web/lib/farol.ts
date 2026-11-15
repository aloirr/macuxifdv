/**
 * Visão da tela "Farol de clientes" do BKO (RN-CORE-28; T-0081): funções puras sobre `GET /v1/core/farol`.
 * Sem React e sem rede. As cores e as regras moram no domain; aqui só apresentação, filtros da URL, CSV e formulário dos parâmetros.
 */
import { BOM_CSV, celulaCsv } from '@macuxi/comum/csv';
import type {
  CorFarol,
  ErroParametroFarol,
  Farol,
  FarolCliente,
  FarolResumo,
  ParametrosFarol,
} from '../../contracts';
import { CAMPOS_PARAMETROS_FAROL } from '../../contracts';
import { validarParametrosFarol } from '../../domain';

export const ROTULO_COR: Record<CorFarol, string> = {
  verde: 'Verde',
  amarelo: 'Amarelo',
  vermelho: 'Vermelho',
  sem_compra: 'Sem compra',
};
export type TomDoFarol = 'success' | 'warning' | 'danger' | 'neutral';
export const TOM_DA_COR: Record<CorFarol, TomDoFarol> = {
  verde: 'success',
  amarelo: 'warning',
  vermelho: 'danger',
  sem_compra: 'neutral',
};
export const ORDEM_DAS_CORES: readonly CorFarol[] = ['vermelho', 'amarelo', 'verde', 'sem_compra'];

/** Cor sempre acompanhada de texto (acessibilidade): "Vermelho", nunca só a bolinha. */
/** Rótulo no plural para os cartões e a ação de filtrar ("Clientes verdes", "Clientes sem compra"). */
export const ROTULO_COR_PLURAL: Record<CorFarol, string> = {
  verde: 'Clientes verdes',
  amarelo: 'Clientes amarelos',
  vermelho: 'Clientes vermelhos',
  sem_compra: 'Clientes sem compra',
};

export function rotuloDaCor(cor: CorFarol | null): string {
  return cor ? ROTULO_COR[cor] : 'Sem carteira';
}

export function tomDaCor(cor: CorFarol | null): TomDoFarol {
  return cor ? TOM_DA_COR[cor] : 'neutral';
}

/** Dias sem compra para a célula: "—" (nunca comprou; o selo já diz "Sem compra"), "hoje", "1 dia", "46 dias". */
export function textoDeDias(dias: number | null): string {
  if (dias === null) return '—';
  if (dias === 0) return 'hoje';
  return dias === 1 ? '1 dia' : `${dias} dias`;
}

/** Dias sem compra na lista (RD-0360): só o número ("43"); nunca comprou = "—". A data da última compra vai no `title` da célula. */
export function diasEmNumero(dias: number | null): string {
  return dias === null ? '—' : String(dias);
}

/** Texto do `title` da célula de dias: "Última compra: 02/10/2026"; sem compra, "Sem compra registrada". */
export function textoDaUltimaCompra(iso: string | null): string {
  return iso ? `Última compra: ${textoDeData(iso)}` : 'Sem compra registrada';
}

/** Pontos-base (10000 = 100,00%) para texto: 3333 -> "33,3%"; 10000 -> "100%". */
export function textoDePositivacao(pontosBase: number): string {
  const pct = pontosBase / 100;
  const texto = Number.isInteger(pct) ? String(pct) : pct.toFixed(1).replace('.', ',');
  return `${texto}%`;
}

/** AAAA-MM-DD -> DD/MM/AAAA (sem passar por Date: não muda de dia por fuso). */
export function textoDeData(iso: string | null): string {
  if (!iso) return '—';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

export function textoDoResumo(r: FarolResumo): string {
  return `${r.positivados} de ${r.carteira} clientes positivados no mês (${textoDePositivacao(r.positivacao_pct)})`;
}

export function textoDaFonte(fonte: Farol['fonte_positivacao']): string {
  if (fonte === 'pedido') return 'Positivação pelos pedidos do Vendedor.';
  if (fonte === 'nota_erp') return 'Positivação pelas notas fiscais do ERP.';
  return 'Sem dados de positivação neste mês: os clientes aparecem só pelos dias sem compra.';
}

/** Filtros que vivem na URL (`?mes=&equipe=&vendedor=&cor=&q=`); só o que está preenchido vai para a API. */
export interface FiltrosDoFarol {
  mes: string;
  equipe: string;
  vendedor: string;
  cor: string;
  busca: string;
}

export function filtrosDaUrl(params: { get(nome: string): string | null }): FiltrosDoFarol {
  const cor = params.get('cor') ?? '';
  return {
    mes: params.get('mes') ?? '',
    equipe: params.get('equipe') ?? '',
    vendedor: params.get('vendedor') ?? '',
    cor: (['verde', 'amarelo', 'vermelho', 'sem_compra'] as const).includes(cor as CorFarol) ? cor : '',
    busca: (params.get('q') ?? '').slice(0, 60),
  };
}

export function consultaDoFarol(f: FiltrosDoFarol, cursor?: string): Record<string, string> {
  const q: Record<string, string> = {};
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(f.mes)) q.periodo = f.mes;
  if (f.equipe) q.equipe_id = f.equipe;
  if (f.vendedor) q.usuario_id = f.vendedor;
  if (f.cor) q.cor = f.cor;
  if (f.busca.trim()) q.busca = f.busca.trim();
  if (cursor) q.cursor = cursor;
  return q;
}

/** Equipe e vendedor escolhidos juntos: a escolha mais nova vence, para a combinação nunca ficar sem resultado por engano. */
export function aoEscolherEquipe(equipe: string): Record<string, string | null> {
  return { equipe: equipe || null, vendedor: null };
}

/** Vendedor escolhido: a equipe sai do filtro (o vendedor pode ser de outra equipe e a lista ficaria vazia por engano). */
export function aoEscolherVendedor(vendedor: string): Record<string, string | null> {
  return { vendedor: vendedor || null, equipe: null };
}

/** Maior mês escolhível (AAAA-MM): o atual; mês futuro não tem compra. */
export function mesMaximo(hoje: string): string {
  return hoje.slice(0, 7);
}

/** Aviso da tela quando o mês escolhido é passado: só a positivação é do mês; carteira vigente e dias sem compra são de hoje (RN-CORE-28 item 2). */
export function avisoDoMesPassado(mes: string, hoje: string): string | null {
  if (mes >= hoje.slice(0, 7)) return null;
  return 'Mês anterior: a positivação é a do mês escolhido, mas a carteira e os dias sem compra são os de hoje.';
}

export const CABECALHO_CSV = [
  'Cliente',
  'Documento',
  'Vendedor',
  'Última compra',
  'Dias sem compra',
  'Positivado no mês',
  'Farol',
];

/** CSV (ponto e vírgula, Excel pt-BR) da lista na tela. */
export function csvDoFarol(
  clientes: readonly FarolCliente[],
  nomeDoVendedor: (id: string) => string,
): string {
  const linhas = clientes.map((c) =>
    [
      c.nome,
      c.documento_mascarado ?? '',
      nomeDoVendedor(c.usuario_id),
      textoDeData(c.ultima_compra_em),
      c.dias_sem_compra === null ? 'sem compra' : String(c.dias_sem_compra),
      c.positivado_mes ? 'Sim' : 'Não',
      rotuloDaCor(c.cor),
    ]
      .map(celulaCsv)
      .join(';'),
  );
  return BOM_CSV + `${[CABECALHO_CSV.map(celulaCsv).join(';'), ...linhas].join('\r\n')}\r\n`;
}

/* ---------- parâmetros ---------- */

export type TextosDosParametros = Record<(typeof CAMPOS_PARAMETROS_FAROL)[number], string>;

export function textosDosParametros(p: ParametrosFarol): TextosDosParametros {
  return {
    verde_ate_dias: String(p.verde_ate_dias),
    amarelo_ate_dias: String(p.amarelo_ate_dias),
    positivacao_verde_pct: String(p.positivacao_verde_pct),
    positivacao_amarelo_pct: String(p.positivacao_amarelo_pct),
  };
}

export type ResultadoDoFormulario =
  | { ok: true; valores: ParametrosFarol }
  | { ok: false; erros: Partial<Record<ErroParametroFarol['campo'], string>> };

/** Texto vazio ou não numérico vira NaN e é recusado pela regra do domain, no campo certo. */
export function validarFormularioDoFarol(t: TextosDosParametros): ResultadoDoFormulario {
  const n = (s: string) => (s.trim() === '' ? Number.NaN : Number(s));
  const r = validarParametrosFarol({
    verde_ate_dias: n(t.verde_ate_dias),
    amarelo_ate_dias: n(t.amarelo_ate_dias),
    positivacao_verde_pct: n(t.positivacao_verde_pct),
    positivacao_amarelo_pct: n(t.positivacao_amarelo_pct),
  });
  if (r.ok) return r;
  const erros: Partial<Record<ErroParametroFarol['campo'], string>> = {};
  for (const e of r.erros) erros[e.campo] = erros[e.campo] ? `${erros[e.campo]} ${e.mensagem}` : e.mensagem;
  return { ok: false, erros };
}

/** Frase que explica as faixas em vigor, para a legenda sob o resumo. */
export function legendaDasFaixas(p: ParametrosFarol): string {
  return `Verde: comprou até ${p.verde_ate_dias} dias atrás ou já positivou no mês. Amarelo: até ${p.amarelo_ate_dias} dias. Vermelho: mais que isso. Vendedor: verde a partir de ${p.positivacao_verde_pct}% de positivação e amarelo a partir de ${p.positivacao_amarelo_pct}%.`;
}

/** Legenda em linhas, cada faixa com a sua cor (o selo vem da tela): uma linha para o cliente e outra para o vendedor. */
export function legendaEmLinhas(
  p: ParametrosFarol,
): { rotulo: string; faixas: { cor: CorFarol; texto: string }[] }[] {
  return [
    {
      rotulo: 'Cliente',
      faixas: [
        { cor: 'verde', texto: `até ${p.verde_ate_dias} dias ou positivado no mês` },
        { cor: 'amarelo', texto: `até ${p.amarelo_ate_dias} dias` },
        { cor: 'vermelho', texto: `acima de ${p.amarelo_ate_dias} dias` },
      ],
    },
    {
      rotulo: 'Vendedor',
      faixas: [
        { cor: 'verde', texto: `a partir de ${p.positivacao_verde_pct}%` },
        { cor: 'amarelo', texto: `a partir de ${p.positivacao_amarelo_pct}%` },
        { cor: 'vermelho', texto: `abaixo de ${p.positivacao_amarelo_pct}%` },
      ],
    },
  ];
}

/** Rótulo do botão de exportar: diz quantos clientes saem e avisa quando há mais páginas. */
export function rotuloDoExportar(carregados: number, temMais: boolean): string {
  return temMais
    ? `Exportar CSV (${carregados} carregados; há mais)`
    : `Exportar CSV (${carregados} ${carregados === 1 ? 'cliente' : 'clientes'})`;
}
