/**
 * BKO do pré-cadastro (v1.0.30; RN-CORE-16, RN-CORE-78 e RN-CORE-79; ADR 0069; docs/design/telas/bko-pre-cadastros-recusados.md e
 * pre-cadastro-campos.md): funções puras da lista única de campos obrigatórios (Parâmetros › Clientes) e da aba "Pré-cadastros
 * recusados" (filtros na URL, textos do histórico, erro do reenvio e o corpo da correção). Sem React e sem rede; a API revalida.
 */
import { ApiRequestError } from '@macuxi/platform-sdk/web';
import { formatDataHoraCurta, formatDateTimeFull, type MascaraCampo } from '@macuxi/ui/web';
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
  type SituacaoRecusado,
  type TentativaPreCadastro,
} from '../../contracts';
import { FALTA_OBRIGATORIO_PRE_CADASTRO, situacaoDoRecusado } from '../../domain';
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
  q: string;
}

/** Filtros da URL (`?situacao=&q=`); situação inválida ou ausente = Recusado (o padrão). */
export function filtrosRecusadosDaUrl(params: { get(chave: string): string | null }): FiltrosRecusados {
  const s = SituacaoRecusadoSchema.safeParse(params.get('situacao'));
  return { situacao: s.success ? s.data : 'recusado', q: (params.get('q') ?? '').trim() };
}

/** Busca da API: texto só com dígitos e a pontuação do CPF/CNPJ vai só com os dígitos (sem precisar da máscara). */
export function buscaParaApi(q: string): string | undefined {
  const t = q.trim();
  if (t === '') return undefined;
  return /^[\d.\-/\s]+$/.test(t) ? t.replace(/\D/g, '') : t;
}

export const temFiltroRecusados = (f: FiltrosRecusados): boolean => f.situacao !== 'recusado' || f.q !== '';

/** Patch da URL que volta ao padrão (a aba fica). */
export const LIMPAR_FILTROS_RECUSADOS = { situacao: null, q: null } as const;

/** Rótulo da busca dos recusados: só o que a API casa (razão social e CPF/CNPJ); o Código FDV não entra nesta busca. */
export const ROTULO_BUSCA_RECUSADOS = 'Razão social ou CPF/CNPJ';

export const SITUACOES_RECUSADO: readonly { id: SituacaoRecusado; texto: string; tom: 'danger' | 'warning' | 'success' }[] = [
  { id: 'recusado', texto: 'Recusado', tom: 'danger' },
  { id: 'reenviado', texto: 'Reenviado', tom: 'warning' },
  { id: 'aceito', texto: 'Aceito', tom: 'success' },
];
export const seloDaSituacao = (s: SituacaoRecusado) => SITUACOES_RECUSADO.find((x) => x.id === s)!;

/** Número da aba (só os da situação Recusado); com mais de uma página, sem número (o total não cabe numa página). */
export function contadorDaAba(pagina: { itens: readonly unknown[]; proximo_cursor: string | null } | undefined): number | null {
  if (!pagina || pagina.proximo_cursor) return null;
  return pagina.itens.length;
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

const STATUS_DO_RESULTADO = { aguardando: 'pendente', aceito: 'aprovado', recusado: 'recusado' } as const;

/** RN-CORE-78: situação pela tentativa mais nova do histórico (`situacaoDoRecusado`); nula sem tentativa ou antes de qualquer recusa. */
export function situacaoDoHistorico(h: HistoricoPreCadastro): SituacaoRecusado | null {
  const ultima = tentativasEmOrdem(h)[0];
  return ultima ? situacaoDoRecusado({ status_cadastro: STATUS_DO_RESULTADO[ultima.resultado], revisao_cadastro: ultima.revisao }) : null;
}

/** 409 REVISAO_DESATUALIZADA: "<nome> já corrigiu este pré-cadastro em dd/mm hh:mm." pela tentativa mais nova; sem nome, o texto do contrato. */
export function textoDeQuemCorrigiuAntes(h: HistoricoPreCadastro | undefined, fuso: string): string {
  const ultima = h ? tentativasEmOrdem(h)[0] : undefined;
  if (!ultima?.corrigido_por) return MENSAGENS_ERRO_PRE_CADASTRO.REVISAO_DESATUALIZADA;
  return `${ultima.corrigido_por.nome} já corrigiu este pré-cadastro em ${formatDataHoraCurta(ultima.enviado_em, fuso)}.`;
}

/**
 * Erro do reenvio: 409 REVISAO_DESATUALIZADA, ou 422 CAMPOS_OBRIGATORIOS (a lista da empresa mudou depois que o formulário abriu): a API
 * manda em `detalhes.campos` só as chaves das colunas, que o formulário marca como "Obrigatório", como na validação local (RN-CORE-79).
 */
export function erroDoReenvio(e: unknown): { revisaoDesatualizada: boolean; erros: Partial<Record<ColunaFormulario, string>> } {
  if (!(e instanceof ApiRequestError)) return { revisaoDesatualizada: false, erros: {} };
  const campos = e.status === 422 ? e.details?.campos : undefined;
  const erros = Array.isArray(campos)
    ? errosDaRecusaPorColuna(campos.filter((c): c is string => typeof c === 'string').map((campo) => ({ campo, mensagem: FALTA_OBRIGATORIO_PRE_CADASTRO })))
    : {};
  return { revisaoDesatualizada: e.status === 409 && e.code === 'REVISAO_DESATUALIZADA', erros };
}

// ------------------------------------------------------------ Editar e reenviar (formulário)

/**
 * Grade do formulário do BKO (spec §4): ordem, largura (de 6 colunas) e máscara ao digitar (a do Campo). As colunas, os rótulos,
 * os valores e o corpo enviado são os do formulário do Campo (`app/lib/pre-cadastro-formulario.ts`, fonte única); aqui só a ordem
 * e o desenho da grade.
 */
export const GRADE_DA_CORRECAO: readonly { coluna: ColunaFormulario; largura: string; mascara?: MascaraCampo }[] = [
  { coluna: 'documento', largura: 'col-span-3', mascara: 'documento' },
  { coluna: 'inscricao_estadual', largura: 'col-span-3' },
  { coluna: 'razao_social', largura: 'col-span-6' },
  { coluna: 'nome_fantasia', largura: 'col-span-6' },
  { coluna: 'telefone', largura: 'col-span-3', mascara: 'telefone' },
  { coluna: 'email', largura: 'col-span-3' },
  { coluna: 'cep', largura: 'col-span-3', mascara: 'cep' },
  { coluna: 'bairro', largura: 'col-span-3' },
  { coluna: 'logradouro', largura: 'col-span-4' },
  { coluna: 'numero', largura: 'col-span-2' },
  { coluna: 'cidade', largura: 'col-span-4' },
  { coluna: 'uf', largura: 'col-span-2' },
];

/** Ordem da grade, para rolar até a primeira coluna marcada (`primeiraColunaMarcada(marcas, ORDEM_DA_GRADE)`). */
export const ORDEM_DA_GRADE: readonly ColunaFormulario[] = GRADE_DA_CORRECAO.map((g) => g.coluna);

/** Situação do selo da gaveta: a do histórico quando ele chega (alguém pode ter corrigido depois da lista); antes disso, ou se falhar, a da linha. */
export function situacaoDaGaveta(daLinha: SituacaoRecusado, historico: HistoricoPreCadastro | undefined): SituacaoRecusado | null {
  return historico ? situacaoDoHistorico(historico) : daLinha;
}

/**
 * Busca da lista: o `q` da URL só volta ao campo quando muda por fora (voltar, limpar filtros). O eco da própria busca (o `q` que o
 * campo acabou de mandar) não volta, senão apagaria o que foi digitado durante a espera. Devolve o novo texto do campo, ou nulo.
 */
export function buscaDoQDaUrl(q: string, ultimoEnviado: string): string | null {
  return q === ultimoEnviado ? null : q;
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
