/**
 * BKO do pré-cadastro (v1.0.29; RN-CORE-16, RN-CORE-78 e RN-CORE-79; ADR 0069; docs/design/telas/bko-pre-cadastros-recusados.md e
 * pre-cadastro-campos.md): funções puras da lista única de campos obrigatórios (Parâmetros › Clientes) e da aba "Pré-cadastros
 * recusados" (filtros na URL, textos do histórico, erro do reenvio e o corpo da correção). Sem React e sem rede; a API revalida.
 */
import { ApiRequestError } from '@macuxi/platform-sdk/web';
import { formatDataHoraCurta, formatDateTimeFull } from '@macuxi/ui/web';
import {
  CAMPOS_CADASTRO_CLIENTE,
  CAMPOS_CADASTRO_FIXOS,
  COLUNAS_DO_CAMPO_PRE_CADASTRO,
  MENSAGENS_ERRO_PRE_CADASTRO,
  ROTULOS_CAMPOS_PRE_CADASTRO,
  SituacaoRecusadoSchema,
  type CampoCadastroCliente,
  type CampoPreCadastro,
  type CorrecaoPreCadastro,
  type HistoricoPreCadastro,
  type PreCadastroAtual,
  type RecusadoItem,
  type SituacaoRecusado,
  type TentativaPreCadastro,
} from '../../contracts';
import { dadosDoFormulario, errosDaRecusaPorColuna, type ColunaFormulario, type ValoresPreCadastro } from '../../app/lib/pre-cadastro-formulario';

// ------------------------------------------------------------ Parâmetros › Clientes › Campos obrigatórios

/** Uma linha do painel: o rótulo do contrato e as colunas que ela cobre (Endereço = o grupo todo). */
export interface LinhaCampoObrigatorio {
  id: CampoPreCadastro;
  rotulo: string;
  campos: readonly CampoCadastroCliente[];
  /** Razão social e CPF/CNPJ: marcados e travados (selo "Sempre"). */
  sempre: boolean;
}

const FIXOS = new Set<string>(CAMPOS_CADASTRO_FIXOS);

/** As 7 linhas, na ordem fixa da spec (§1): os sempre obrigatórios primeiro. */
export const LINHAS_CAMPOS_OBRIGATORIOS: readonly LinhaCampoObrigatorio[] = (Object.keys(COLUNAS_DO_CAMPO_PRE_CADASTRO) as CampoPreCadastro[]).map((id) => ({
  id,
  rotulo: ROTULOS_CAMPOS_PRE_CADASTRO[id],
  campos: COLUNAS_DO_CAMPO_PRE_CADASTRO[id] as readonly CampoCadastroCliente[],
  sempre: FIXOS.has(id),
}));

/** Marcada se a lista exige qualquer coluna da linha (o Endereço parcial aparece marcado, como na projeção da RN-CORE-79). */
export function linhaMarcada(lista: readonly CampoCadastroCliente[], linha: LinhaCampoObrigatorio): boolean {
  return linha.sempre || linha.campos.some((c) => lista.includes(c));
}

/**
 * RN-CORE-16/79: marca ou desmarca a linha inteira, na ordem canônica, sem mexer no resto da lista (complemento e geolocalização,
 * que o painel não mostra, ficam como estão). Os sempre obrigatórios ficam sempre.
 */
export function alternarLinhaObrigatoria(lista: readonly CampoCadastroCliente[], linha: LinhaCampoObrigatorio, ligado: boolean): CampoCadastroCliente[] {
  const conjunto = new Set<CampoCadastroCliente>(lista);
  if (!linha.sempre) {
    for (const c of linha.campos) {
      if (ligado) conjunto.add(c);
      else conjunto.delete(c);
    }
  }
  for (const c of CAMPOS_CADASTRO_FIXOS) conjunto.add(c);
  return CAMPOS_CADASTRO_CLIENTE.filter((c) => conjunto.has(c));
}

// ------------------------------------------------------------ Clientes › Pré-cadastros recusados

/** Valor do parâmetro `aba` da página Clientes para esta aba (`/clientes?aba=pre-cadastros`). */
export const ABA_PRE_CADASTROS = 'pre-cadastros';

export interface FiltrosRecusados {
  situacao: SituacaoRecusado;
  vendedor: string;
  q: string;
}

/** Filtros da URL (`?situacao=&vendedor=&q=`); situação inválida ou ausente = Recusado (o padrão). */
export function filtrosRecusadosDaUrl(params: { get(chave: string): string | null }): FiltrosRecusados {
  const s = SituacaoRecusadoSchema.safeParse(params.get('situacao'));
  return { situacao: s.success ? s.data : 'recusado', vendedor: params.get('vendedor') ?? '', q: (params.get('q') ?? '').trim() };
}

/** Busca da API: texto só com dígitos e a pontuação do CPF/CNPJ vai só com os dígitos (sem precisar da máscara). */
export function buscaParaApi(q: string): string | undefined {
  const t = q.trim();
  if (t === '') return undefined;
  return /^[\d.\-/\s]+$/.test(t) ? t.replace(/\D/g, '') : t;
}

export const temFiltroRecusados = (f: FiltrosRecusados): boolean => f.situacao !== 'recusado' || f.vendedor !== '' || f.q !== '';

/** Patch da URL que volta ao padrão (a aba fica). */
export const LIMPAR_FILTROS_RECUSADOS = { situacao: null, vendedor: null, q: null } as const;

export const SITUACOES_RECUSADO: readonly { id: SituacaoRecusado; texto: string; tom: 'danger' | 'warning' | 'success' }[] = [
  { id: 'recusado', texto: 'Recusado', tom: 'danger' },
  { id: 'reenviado', texto: 'Reenviado', tom: 'warning' },
  { id: 'aceito', texto: 'Aceito', tom: 'success' },
];
export const seloDaSituacao = (s: SituacaoRecusado) => SITUACOES_RECUSADO.find((x) => x.id === s)!;

/** O filtro de vendedor é aplicado sobre as páginas já carregadas (a consulta da API não filtra por vendedor). */
export function filtrarPorVendedor(itens: readonly RecusadoItem[], vendedor: string): RecusadoItem[] {
  return vendedor ? itens.filter((i) => i.vendedor?.id === vendedor) : [...itens];
}

/** Vendedores das linhas carregadas, em ordem alfabética, sem repetir (opções do filtro). */
export function vendedoresDosItens(itens: readonly RecusadoItem[]): { id: string; nome: string }[] {
  const m = new Map<string, string>();
  for (const i of itens) if (i.vendedor) m.set(i.vendedor.id, i.vendedor.nome);
  return [...m].map(([id, nome]) => ({ id, nome })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** Número da aba (só os da situação Recusado); com mais de uma página, sem número (o total não cabe numa página). */
export function contadorDaAba(pagina: { itens: readonly unknown[]; proximo_cursor: string | null } | undefined): number | null {
  if (!pagina || pagina.proximo_cursor) return null;
  return pagina.itens.length;
}

const ROTULOS_COLUNAS: Readonly<Record<string, string>> = { logradouro: 'Logradouro', numero: 'Número', bairro: 'Bairro', cidade: 'Cidade', uf: 'UF', cep: 'CEP' };

/** Rótulo do campo citado no erro (os do contrato e os do endereço); campo que o formulário não tem aparece com o nome que veio. */
export function rotuloDoCampo(campo: string): string {
  return ROTULOS_CAMPOS_PRE_CADASTRO[campo as CampoPreCadastro] ?? ROTULOS_COLUNAS[campo] ?? campo;
}

const ONDE: Readonly<Record<TentativaPreCadastro['origem'], string>> = { campo: 'no Campo', bko: 'no BKO' };

/** "Enviada por Ana, no Campo, em 20/11/2026 14:31" (revisão 1) ou "Corrigida por …" (da 2 em diante). */
export function textoDeQuemEnviou(t: TentativaPreCadastro, fuso: string): string {
  const verbo = t.revisao === 1 ? 'Enviada' : 'Corrigida';
  const quem = t.corrigido_por ? ` por ${t.corrigido_por.nome},` : '';
  return `${verbo}${quem} ${ONDE[t.origem]}, em ${formatDateTimeFull(t.enviado_em, fuso)}`;
}

/** O que o ERP fez com a revisão. */
export function textoDoResultado(t: TentativaPreCadastro, fuso: string): string {
  if (t.resultado === 'aguardando') return 'Aguardando ERP';
  const quando = t.respondido_em ? ` em ${formatDateTimeFull(t.respondido_em, fuso)}` : '';
  return t.resultado === 'recusado' ? `Recusada pelo ERP${quando}` : `Aceita pelo ERP${quando}`;
}

/** Tentativas da mais nova para a mais antiga. */
export const tentativasEmOrdem = (h: HistoricoPreCadastro): TentativaPreCadastro[] => [...h.tentativas].sort((a, b) => b.revisao - a.revisao);

/** 409 REVISAO_DESATUALIZADA: "<nome> já corrigiu este pré-cadastro em dd/mm hh:mm." pela tentativa mais nova; sem nome, o texto do contrato. */
export function textoDeQuemCorrigiuAntes(h: HistoricoPreCadastro | undefined, fuso: string): string {
  const ultima = h ? tentativasEmOrdem(h)[0] : undefined;
  if (!ultima?.corrigido_por) return MENSAGENS_ERRO_PRE_CADASTRO.REVISAO_DESATUALIZADA;
  return `${ultima.corrigido_por.nome} já corrigiu este pré-cadastro em ${formatDataHoraCurta(ultima.enviado_em, fuso)}.`;
}

/** Erro do reenvio: 409 de revisão desatualizada, ou erros por campo (422 com `detalhes.erros`) para marcar no formulário. */
export function erroDoReenvio(e: unknown): { revisaoDesatualizada: boolean; erros: Partial<Record<ColunaFormulario, string>> } {
  if (!(e instanceof ApiRequestError)) return { revisaoDesatualizada: false, erros: {} };
  const lista = e.details?.erros;
  const erros = Array.isArray(lista)
    ? errosDaRecusaPorColuna(lista.filter((x): x is { campo: string; mensagem: string } => typeof x?.campo === 'string' && typeof x?.mensagem === 'string'))
    : {};
  return { revisaoDesatualizada: e.status === 409 && e.code === 'REVISAO_DESATUALIZADA', erros };
}

/** Corpo do `PUT` da correção: o formulário, a localização e a filial já gravadas e a revisão em que a edição se baseou. */
export function corpoDaCorrecao(atual: PreCadastroAtual, valores: ValoresPreCadastro): CorrecaoPreCadastro {
  return {
    ...dadosDoFormulario(valores),
    latitude: atual.latitude ?? null,
    longitude: atual.longitude ?? null,
    filial_id: atual.filial_id ?? null,
    revisao_base: atual.revisao,
  };
}
