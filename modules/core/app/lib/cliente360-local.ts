/**
 * Cliente 360 e lista de Clientes montados SÓ com as linhas locais do aparelho (sem rede; RF-CORE-02, RF-CORE-04,
 * critério 2 da T-0017). As contas são as mesmas funções puras do `domain` que a API usa. O servidor já limitou as
 * linhas ao escopo do usuário (RN-CORE-04), então aqui não há filtro de carteira. Janelas do desenho §2: o que saiu
 * da janela (título liquidado antigo, histórico além de 12 meses) não aparece, mesmo que ainda esteja no aparelho.
 */
import type { ClienteContatoSync, ClienteFinanceiroSync, ClienteSync, HistoricoCompraSync, ResumoCompras, ResumoFinanceiro, TituloSync } from '../../contracts';
import { linksDeContato, listarClientes, resumoCompras, resumoFinanceiro, situacaoTitulo, type ClienteLista, type FiltroClientes, type SituacaoTitulo } from '../../domain';

export interface LinhasCliente {
  cliente: ClienteSync;
  contatos: ClienteContatoSync[];
  financeiro: ClienteFinanceiroSync | null;
  titulos: TituloSync[];
  historico: HistoricoCompraSync[];
}

export interface TituloLocal extends TituloSync {
  situacao_calculada: SituacaoTitulo;
  dias_atraso: number;
}

export interface ContatoLocal extends ClienteContatoSync {
  tel: string | null;
  whatsapp_url: string | null;
}

export interface Cliente360Local {
  cliente: ClienteSync;
  contatos: ContatoLocal[];
  financeiro: ClienteFinanceiroSync | null;
  titulos: TituloLocal[];
  historico: HistoricoCompraSync[];
  resumo_compras: ResumoCompras;
  resumo_financeiro: ResumoFinanceiro | null;
  /** Ligar e WhatsApp em 1 toque: do contato principal; cai no telefone do cadastro do cliente. */
  ligar: string | null;
  whatsapp: string | null;
}

/** Soma dias a uma data civil AAAA-MM-DD (UTC, sem fuso: é só calendário). */
export function somarDias(data: string, dias: number): string {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** Janela do título no aparelho: abertos + vencimento ≥ hoje − 90 (desenho §2). */
export function tituloNaJanela(t: Pick<TituloSync, 'situacao' | 'vencimento'>, hoje: string): boolean {
  return t.situacao === 'aberto' || t.vencimento >= somarDias(hoje, -90);
}

/** Janela do histórico: `ano_mes` ≥ 12 meses atrás. */
export function historicoNaJanela(h: Pick<HistoricoCompraSync, 'ano_mes'>, hoje: string): boolean {
  const [a, m] = hoje.slice(0, 7).split('-').map(Number) as [number, number];
  const idx = a * 12 + (m - 1) - 12;
  const inicio = `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
  return h.ano_mes >= inicio;
}

export function montarCliente360Local(l: LinhasCliente, hoje: string): Cliente360Local {
  const titulos: TituloLocal[] = l.titulos
    .filter((t) => tituloNaJanela(t, hoje))
    .map((t) => {
      const s = situacaoTitulo(t, hoje);
      return { ...t, situacao_calculada: s.situacao, dias_atraso: s.dias_atraso };
    })
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.id.localeCompare(b.id));
  const historico = l.historico.filter((h) => historicoNaJanela(h, hoje)).sort((a, b) => b.ano_mes.localeCompare(a.ano_mes));
  const contatos: ContatoLocal[] = [...l.contatos]
    .sort((a, b) => Number(b.principal) - Number(a.principal) || a.nome.localeCompare(b.nome, 'pt-BR'))
    .map((c) => {
      const links = linksDeContato(c);
      return { ...c, tel: links.tel, whatsapp_url: links.whatsapp };
    });
  const principal = contatos[0];
  const doCadastro = linksDeContato({ telefone: l.cliente.telefone, whatsapp: l.cliente.telefone });
  return {
    cliente: l.cliente,
    contatos,
    financeiro: l.financeiro,
    titulos,
    historico,
    resumo_compras: resumoCompras(historico, hoje),
    resumo_financeiro: resumoFinanceiro(l.financeiro, titulos, hoje),
    ligar: principal?.tel ?? doCadastro.tel,
    whatsapp: principal?.whatsapp_url ?? doCadastro.whatsapp,
  };
}

/** Agrupa as linhas locais de uma entidade por cliente. */
export function agruparPorCliente<L extends { cliente_id: string }>(linhas: readonly L[]): Map<string, L[]> {
  const m = new Map<string, L[]>();
  for (const l of linhas) m.set(l.cliente_id, [...(m.get(l.cliente_id) ?? []), l]);
  return m;
}

export interface FiltroClientesLocal extends FiltroClientes {
  /** "Sem compra há N dias": nunca comprou ou a última compra é de N dias atrás ou mais. */
  semCompraHa?: number;
}

export interface ItemClienteLocal extends ClienteLista {
  uf: string | null;
  bloqueado: boolean;
  vencidos_qtd: number;
  dias_sem_compra: number | null;
}

export interface BaseLocal {
  clientes: readonly ClienteSync[];
  financeiros: readonly ClienteFinanceiroSync[];
  titulos: readonly TituloSync[];
  historico: readonly HistoricoCompraSync[];
}

/** Lista de Clientes do aparelho com busca e filtros "vencidos", "sem compra há N dias" e "bloqueados" (desenho §3.4). */
export function listarClientesLocais(base: BaseLocal, hoje: string, filtro: FiltroClientesLocal = {}): ItemClienteLocal[] {
  const financeiroPorCliente = new Map(base.financeiros.map((f) => [f.cliente_id, f]));
  const titulosPorCliente = agruparPorCliente(base.titulos.filter((t) => tituloNaJanela(t, hoje)));
  const historicoPorCliente = agruparPorCliente(base.historico.filter((h) => historicoNaJanela(h, hoje)));
  const itens: ItemClienteLocal[] = base.clientes
    .filter((c) => c.deleted_at === null)
    .map((c) => ({
      id: c.id,
      razao_social: c.razao_social,
      nome_fantasia: c.nome_fantasia,
      documento: c.documento,
      cidade: c.cidade,
      segmento: c.segmento,
      uf: c.uf,
      bloqueado: financeiroPorCliente.get(c.id)?.bloqueado ?? false,
      vencidos_qtd: (titulosPorCliente.get(c.id) ?? []).filter((t) => situacaoTitulo(t, hoje).situacao === 'vencido').length,
      dias_sem_compra: resumoCompras(historicoPorCliente.get(c.id) ?? [], hoje).dias_sem_compra,
    }));
  const { semCompraHa, ...resto } = filtro;
  // as linhas locais já estão no escopo do usuário (o servidor filtrou): perfil de escopo "tenant" não corta nada aqui
  const filtrados = listarClientes(itens, 'admin', { propria: new Set(), equipe: new Set(), equipesAbaixo: new Set() }, resto, {
    bloqueados: new Set(itens.filter((i) => i.bloqueado).map((i) => i.id)),
    comVencidos: new Set(itens.filter((i) => i.vencidos_qtd > 0).map((i) => i.id)),
  });
  return filtrados.filter((i) => semCompraHa === undefined || i.dias_sem_compra === null || i.dias_sem_compra >= semCompraHa);
}
