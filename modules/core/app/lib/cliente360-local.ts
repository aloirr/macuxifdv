/**
 * Cliente 360 e lista de Clientes montados SÓ com as linhas locais do aparelho (sem rede; RF-CORE-02, RF-CORE-04,
 * critério 2 da T-0017). As contas são as mesmas funções puras do `domain` que a API usa. O servidor já limitou as
 * linhas ao escopo do usuário (RN-CORE-04), então aqui não há filtro de carteira. Janelas do desenho §2: o que saiu
 * da janela (título liquidado antigo, histórico além de 12 meses) não aparece, mesmo que ainda esteja no aparelho.
 */
import { somarDiasCivis as somarDias } from '@macuxi/comum/relogio';
import type { ClienteContatoSync, ClienteEnderecoSync, ClienteFinanceiroSync, ClienteFotoSync, ClienteSync, FilialSync, FotoTipoSync, HistoricoCompraSync, ResumoCompras, ResumoFinanceiro, TituloSync } from '../../contracts';
import { fachadaDoPdv, resumoFotos, filialEfetiva, rotuloDaFilial, enderecoPadrao, linksDeContato, listarClientes, mesNaJanela12, listarEnderecosDoCliente, ultimaVisitaEntre, resumoCompras, resumoFinanceiro, situacaoTitulo, type ClienteLista, type EnderecoDoCliente, type FiltroClientes, type SituacaoTitulo } from '../../domain';

export interface LinhasCliente {
  cliente: ClienteSync;
  contatos: ClienteContatoSync[];
  financeiro: ClienteFinanceiroSync | null;
  titulos: TituloSync[];
  historico: HistoricoCompraSync[];
  /** Endereços do pull (`cliente_endereco`); ausente = cliente sem endereço de entrega no aparelho. */
  enderecos?: ClienteEnderecoSync[];
  /** Filiais do pull (`filial`, RN-CORE-39); ausente = ficha sem a linha de filial. */
  filiais?: FilialSync[];
  /** Fotos do PDV (RN-CORE-38): tipos do tenant e as fotos vigentes do cliente; ausente = sem a seção. */
  fotos_pdv?: { tipos: FotoTipoSync[]; fotos: ClienteFotoSync[]; /** tipos com foto só na fila de envio (ainda não aceita pelo servidor) */ na_fila?: readonly string[] };
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
  /**
   * RN-PRO-01 / RN-CORE-01: `false` quando o promotor não vê pedidos (opção `promotor_ve_pedidos` desligada). Aí `historico` vem
   * vazio e `resumo_compras` zerado: nem a contagem de pedidos nem os valores de compra chegam à tela.
   */
  pedidos_visiveis: boolean;
  /** T-0061 (RF-CORE-12, RN-VEN-17): endereços ativos do cliente, o padrão primeiro e marcado (`padrao`); offline. */
  enderecos: EnderecoDoCliente[];
  endereco_padrao_id: string | null;
  /** Ligar e WhatsApp em 1 toque: do contato principal; cai no telefone do cadastro do cliente. */
  ligar: string | null;
  whatsapp: string | null;
  /** RN-CORE-39: filial efetiva do cliente ("0002 · Boa Vista/RR"); nula quando as filiais ainda não vieram no sync. */
  filial_rotulo?: string | null;
  /** RN-CORE-38: resumo tem/falta por tipo; `null` quando não há tipo cadastrado (a seção não aparece). */
  fotos_pdv?: (Omit<ReturnType<typeof resumoFotos>, 'itens'> & { itens: Array<ReturnType<typeof resumoFotos>['itens'][number] & { na_fila: boolean }>; fachada_foto: { arquivo_id: string; tirada_em: string | null } | null }) | null;
}

/** RN-CORE-38: resumo tem/falta e o estado do "Ver foto do PDV" (fachada enviada); sem tipo cadastrado, `null`. */
export function resumoDeFotosDoPdv(l: { tipos: readonly FotoTipoSync[]; fotos: readonly ClienteFotoSync[]; na_fila?: readonly string[] } | undefined): Cliente360Local['fotos_pdv'] {
  const tipos = (l?.tipos ?? []).filter((t) => t.deleted_at === null);
  if (!l || tipos.length === 0) return null;
  const f = fachadaDoPdv(tipos, l.fotos);
  const r = resumoFotos(tipos, l.fotos);
  const fila = new Set(l.na_fila ?? []);
  return { ...r, itens: r.itens.map((i) => ({ ...i, na_fila: i.situacao === 'tem' && fila.has(i.tipo_id) })), fachada_foto: f?.arquivo_id ? { arquivo_id: f.arquivo_id, tirada_em: f.tirada_em } : null };
}

/** RN-CORE-39: rótulo da filial efetiva do cliente (nula, apagada ou inativa = padrão); sem filiais no aparelho, `null`. */
export function rotuloDaFilialDoCliente(filialId: string | null | undefined, filiais: readonly FilialSync[]): string | null {
  if (!filiais.some((f) => f.deleted_at === null && f.padrao)) return null;
  return rotuloDaFilial(filialEfetiva(filialId, filiais.filter((f) => f.deleted_at === null)));
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

export function montarCliente360Local(l: LinhasCliente, hoje: string, opcoes: { verPedidos?: boolean } = {}): Cliente360Local {
  const verPedidos = opcoes.verPedidos ?? true;
  const titulos: TituloLocal[] = l.titulos
    .filter((t) => tituloNaJanela(t, hoje))
    .map((t) => {
      const s = situacaoTitulo(t, hoje);
      return { ...t, situacao_calculada: s.situacao, dias_atraso: s.dias_atraso };
    })
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.id.localeCompare(b.id));
  const historico = (verPedidos ? l.historico : []).filter((h) => mesNaJanela12(h.ano_mes, hoje)).sort((a, b) => b.ano_mes.localeCompare(a.ano_mes));
  const contatos: ContatoLocal[] = [...l.contatos]
    .sort((a, b) => Number(b.principal) - Number(a.principal) || a.nome.localeCompare(b.nome, 'pt-BR'))
    .map((c) => {
      const links = linksDeContato(c);
      return { ...c, tel: links.tel, whatsapp_url: links.whatsapp };
    });
  const enderecos = listarEnderecosDoCliente(l.enderecos ?? [], l.cliente.id);
  const principal = contatos[0];
  const doCadastro = linksDeContato({ telefone: l.cliente.telefone, whatsapp: l.cliente.telefone });
  return {
    cliente: l.cliente,
    contatos,
    financeiro: l.financeiro,
    titulos,
    historico,
    resumo_compras: resumoCompras(historico, hoje),
    pedidos_visiveis: verPedidos,
    resumo_financeiro: resumoFinanceiro(l.financeiro, titulos, hoje),
    enderecos,
    endereco_padrao_id: enderecoPadrao(enderecos)?.id ?? null,
    ligar: principal?.tel ?? doCadastro.tel,
    whatsapp: principal?.whatsapp_url ?? doCadastro.whatsapp,
    filial_rotulo: rotuloDaFilialDoCliente(l.cliente.filial_id, l.filiais ?? []),
    fotos_pdv: resumoDeFotosDoPdv(l.fotos_pdv),
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
  /** RN-CORE-16/17: vem do pull do cliente; linha antiga sem o campo = completo. */
  cadastro_incompleto: boolean;
  /** RN-CORE-41: código do ERP; vazio = Pré-Cadastro. */
  external_id: string | null;
  /** RN-CORE-41: data (AAAA-MM-DD, fuso do tenant) do último check-in; nulo = nunca visitado. */
  ultima_visita: string | null;
}

export interface BaseLocal {
  clientes: readonly ClienteSync[];
  financeiros: readonly ClienteFinanceiroSync[];
  titulos: readonly TituloSync[];
  historico: readonly HistoricoCompraSync[];
  /** RN-CORE-41: último check-in por cliente (do sync de qualquer vendedor e do aparelho); várias linhas por cliente valem pela mais recente. */
  ultimasVisitas?: readonly { cliente_id: string; ultima_visita_data: string }[];
}

/** Lista de Clientes do aparelho com busca e filtros "vencidos", "sem compra há N dias" e "bloqueados" (desenho §3.4). */
export function listarClientesLocais(base: BaseLocal, hoje: string, filtro: FiltroClientesLocal = {}): ItemClienteLocal[] {
  const financeiroPorCliente = new Map(base.financeiros.map((f) => [f.cliente_id, f]));
  const titulosPorCliente = agruparPorCliente(base.titulos.filter((t) => tituloNaJanela(t, hoje)));
  const historicoPorCliente = agruparPorCliente(base.historico.filter((h) => historicoNaJanela(h, hoje)));
  const ultimaPorCliente = new Map<string, string>();
  for (const v of base.ultimasVisitas ?? []) ultimaPorCliente.set(v.cliente_id, ultimaVisitaEntre(ultimaPorCliente.get(v.cliente_id), v.ultima_visita_data)!);
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
      cadastro_incompleto: c.cadastro_incompleto ?? false,
      external_id: c.external_id,
      ultima_visita: ultimaPorCliente.get(c.id) ?? null,
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
