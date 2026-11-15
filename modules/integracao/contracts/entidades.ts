/**
 * Payload canônico por entidade (RF-INT-01). Direção ERP → Macuxi.
 * Produto é o cadastro base do Core (ADR-0005); preço e estoque seguem para o Catálogo.
 * O Hub só define o formato do payload; não importa tipos internos de outros módulos.
 */
import { z } from 'zod';
import { cnpjValido } from '@macuxi/comum/documento';
import { CAMPOS_OBRIGATORIOS_FILIAL, LIMITES_FILIAL } from '@macuxi/core/contracts';
import {
  Centavos,
  CentavosNaoNegativos,
  CONTATOS_MAX,
  DataCivil,
  DataHoraUtc,
  ExternalId,
  PARADAS_MAX,
  Quantidade,
  RegistroBase,
  Texto,
  TextoOpcional,
} from './base';

/**
 * As 8 primeiras são as originais; as 4 seguintes entraram aditivas no v1 (ADR 0016, desenho T-0061 §4.4) e as 3 últimas na T-0089
 * (forma de pagamento, prazo e tabela escalonada; desenho T-0089 §4.2) e `filial` na T-0149 (RN-CORE-39, ADR 0040). No Hub o nome fica no singular, como nas demais.
 */
export const ENTIDADES = ['vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota', 'catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora', 'forma_pagamento', 'prazo_pagamento', 'tabela_escalonada', 'filial'] as const;
export const Entidade = z.enum(ENTIDADES, { errorMap: () => ({ message: 'entidade desconhecida' }) });
export type Entidade = z.infer<typeof Entidade>;

// ---------- vendedor ----------
export const VendedorPayload = RegistroBase.extend({
  nome: Texto(120),
  email: TextoOpcional(160),
  telefone: TextoOpcional(30),
  /**
   * Filial do vendedor, pela chave `external_id` da entidade `filial` (RN-CORE-39): o vendedor tem exatamente UMA, obrigatória.
   * Aditivo e opcional no v1 (ausente = não altera). Vendedor sem filial entra, com o aviso `vendedor_sem_filial`; o bloqueio é do Core.
   */
  filial_external_id: ExternalId.nullish(),
});
export type VendedorPayload = z.infer<typeof VendedorPayload>;

// ---------- cliente ----------
export const Endereco = z.object({
  logradouro: TextoOpcional(160),
  numero: TextoOpcional(20),
  complemento: TextoOpcional(80),
  bairro: TextoOpcional(80),
  cidade: TextoOpcional(80),
  uf: z.string().trim().length(2, 'UF deve ter 2 letras').toUpperCase().nullish(),
  cep: TextoOpcional(9),
});
export type Endereco = z.infer<typeof Endereco>;

export const ContatoCliente = z.object({
  nome: Texto(120),
  cargo: TextoOpcional(80),
  telefone: TextoOpcional(30),
  email: TextoOpcional(160),
});

export const ClientePayload = RegistroBase.extend({
  razao_social: Texto(160),
  nome_fantasia: TextoOpcional(160),
  /** CNPJ/CPF só dígitos ou formatado; dado pessoal quando CPF (nunca em log/mensagem de erro). */
  documento: TextoOpcional(18),
  /** Carteira: vendedor responsável no ERP (referência, RN-INT-04). */
  vendedor_external_id: ExternalId.nullish(),
  endereco: Endereco.nullish(),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  telefone: TextoOpcional(30),
  email: TextoOpcional(160),
  limite_credito_cents: CentavosNaoNegativos.nullish(),
  /** RN-CORE-16: inscrição estadual (ISENTO vale); só o Core decide se o cadastro está completo (RN-INT-14). */
  inscricao_estadual: TextoOpcional(20),
  /** Observação do ERP; o Macuxi nunca a altera (a linha de cadastro incompleto é montada na exibição). */
  observacao: TextoOpcional(1000),
  bloqueado: z.boolean().default(false),
  /**
   * T-0115 (RN-PES-05, aditivo e opcional no v1): canal do cliente (até 60 caracteres). Ausente = não altera; `null` ou em branco = limpa.
   * O Hub traduz o código do ERP pelo de-para `canal` (BKO) antes de publicar; sem de-para, vale o texto como veio.
   */
  canal: TextoOpcional(60),
  contatos: z.array(ContatoCliente).max(CONTATOS_MAX).default([]),
  /**
   * T-0089 (RN-VEN-25, aditivos e opcionais no v1): prazo médio máximo que o cliente aceita (dias) e códigos das formas de pagamento
   * permitidas. Ausente = não altera; `null` (ou `[]` nas formas) = limpa (sem teto / todas as formas ativas).
   * O Core guarda; a forma é referenciada pelo CÓDIGO, sem exigir que ela já exista (a ordem de carga põe a forma antes do cliente).
   */
  prazo_medio_max_dias: z.number().int('prazo_medio_max_dias deve ser inteiro').min(0).max(365).nullish(),
  formas_pagamento: z.array(Texto(20)).max(20, 'formas_pagamento aceita até 20 itens').nullish(),
  /**
   * T-0120 (aditivo e opcional no v1): tabela de preço do cliente no ERP, pela MESMA chave `tabela_external_id` da entidade `preco`.
   * Ausente = não altera; `null` = desvincula (volta à tabela padrão). A tabela pode ainda não existir (a ordem de carga põe `preco`
   * antes do cliente, mas o vínculo é guardado pela chave). Quem guarda o vínculo é o Catálogo (`cliente_tabela_preco`).
   */
  tabela_preco_external_id: ExternalId.nullish(),
  /**
   * T-0149 (RN-CORE-39, aditivo e opcional no v1): filial do cliente, pela chave `external_id` da entidade `filial`.
   * Ausente = não altera; `null` = filial padrão da empresa. A filial pode ainda não existir (a ordem de carga põe `filial` antes).
   */
  filial_external_id: ExternalId.nullish(),
});
export type ClientePayload = z.infer<typeof ClientePayload>;

/** RN-CORE-19: sigla de medida = 1 a 4 letras maiúsculas (a mesma do Core e do banco). Fora disso é erro de validação no ERP, não reprocessável. */
export const SIGLA_MEDIDA_FORMATO = /^[A-Z]{1,4}$/;
/** RN-CORE-19: teto da quantidade da embalagem (e do fator da produto_unidade); o mesmo número do Core e do banco. */
export const EMBALAGEM_QUANTIDADE_MAX = 9999;

// ---------- produto (cadastro base do Core, ADR-0005) ----------
/** Teto de proteção da aplicação no contrato; o teto de negócio (2.000) é aplicado por corte com aviso (RN-CAT-11). */
export const APLICACAO_PROTECAO_MAX = 20_000;
/** Tetos de negócio do Catálogo (RN-CAT-09/11): acima disso o Hub corta e avisa. */
export const LIMITES_CATALOGO_PRODUTO = { aplicacao: 2000, referencias: 3, ofereceJunto: 5, etiquetas: 4 } as const;

/** Referência cruzada do ERP: a marca vem pelo `external_id` ou pelo nome (o ERP não conhece os ids do Macuxi). */
export const ReferenciaCruzada = z.object({
  marca_external_id: z.string().nullish(),
  marca_nome: z.string().nullish(),
  codigo: z.string(),
});
/** Limites da referência válida; fora deles `limitarCatalogoDoProduto` descarta SÓ a referência, com aviso (a linha do produto segue). */
export const LIMITES_REFERENCIA = { codigo: 30, marcaNome: 120, etiqueta: 20 } as const;
export type ReferenciaCruzada = z.infer<typeof ReferenciaCruzada>;

const ProdutoBase = RegistroBase.extend({
  sku: Texto(60),
  ean: z
    .string()
    .trim()
    .regex(/^\d{8}$|^\d{12,14}$/, 'EAN deve ter 8, 12, 13 ou 14 dígitos')
    .nullish(),
  nome: Texto(200),
  marca: TextoOpcional(80),
  /** Código da marca no ERP (ex.: 980), aditivo e opcional no v1; o Catálogo mostra no card e na ficha. Ausente = não altera. */
  marca_codigo: TextoOpcional(30),
  categoria: TextoOpcional(80),
  /** Sigla da medida cadastrada no tenant (RN-CORE-19); o A7 confere com `core.medidas@1` (ausente/inativa = `referencia_ausente`). */
  unidade: Texto(10),
  /**
   * Embalagem padrão do produto (T-0063, RN-CORE-19): sigla da medida da embalagem (ex.: `CX`) e quantas unidades ela traz (CX c/ 12 = 12).
   * Campos opcionais e aditivos (mesma versão do contrato). A sigla é conferida como a `unidade` (desconhecida/inativa = `referencia_ausente`).
   * Medida e quantidade andam juntas: uma sem a outra é recusada.
   */
  embalagem_medida: TextoOpcional(10),
  embalagem_quantidade: z
    .number()
    .int('embalagem_quantidade deve ser inteira')
    .min(2, 'embalagem_quantidade deve ser no mínimo 2')
    .max(EMBALAGEM_QUANTIDADE_MAX, `embalagem_quantidade deve ser no máximo ${EMBALAGEM_QUANTIDADE_MAX}`)
    .nullish(),
  /** Nó da árvore do catálogo; referência FRACA: nó ausente vira aviso e o produto entra sem nó. */
  catalogo_no_external_id: ExternalId.nullish(),
  /** RN-CORE-18 / RN-VEN-11: custo, preço de venda e desconto máximo próprio (o Core aplica). */
  custo_cents: CentavosNaoNegativos.nullish(),
  preco_venda_cents: CentavosNaoNegativos.nullish(),
  desconto_maximo_pct: z.number().min(0).max(100).nullish(),
  /**
   * T-0084/T-0085 (aditivos e opcionais no v1; ausente = não altera, `null`/`[]` = limpa). Os limites do contrato são de proteção:
   * o que passa dos tetos do Catálogo (aplicação 2.000, referências 3, oferece junto 5, etiquetas 4) é CORTADO pelo Hub, com aviso
   * no monitor, sem recusar a linha (`limitarCatalogoDoProduto`, RN-CAT-11/RN-CAT-09).
   */
  aplicacao: z.string().max(APLICACAO_PROTECAO_MAX, `aplicacao aceita até ${APLICACAO_PROTECAO_MAX} caracteres`).nullish(),
  referencias: z.array(ReferenciaCruzada).max(10, 'referencias aceita até 10 itens').nullish(),
  oferece_junto: z.array(ExternalId).max(20, 'oferece_junto aceita até 20 itens').nullish(),
  etiquetas: z.array(z.string()).max(10, 'etiquetas aceita até 10 itens').nullish(),
});
export const ProdutoPayload = ProdutoBase.superRefine((r, ctx) => {
  const tem = (v: unknown) => v !== undefined && v !== null && v !== '';
  if (tem(r.embalagem_medida) !== tem(r.embalagem_quantidade)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [tem(r.embalagem_medida) ? 'embalagem_quantidade' : 'embalagem_medida'],
      message: 'embalagem_medida e embalagem_quantidade devem ser informadas juntas',
    });
  }
});
export type ProdutoPayload = z.infer<typeof ProdutoPayload>;

// ---------- preço (item de tabela; um registro = um item, delta item a item) ----------
export const PrecoPayload = RegistroBase.extend({
  tabela_external_id: ExternalId,
  tabela_nome: Texto(120),
  vigencia_inicio: DataCivil,
  vigencia_fim: DataCivil.nullish(),
  produto_external_id: ExternalId,
  preco_cents: CentavosNaoNegativos,
  /** Sigla da medida a que o preço se refere (fila de corte); ausente = unidade base do produto. */
  unidade: TextoOpcional(6),
  /** T-0149 (RN-CORE-39, aditivo): filial do item de tabela. Ausente ou `null` = filial padrão. */
  filial_external_id: ExternalId.nullish(),
}).superRefine((r, ctx) => {
  if (r.vigencia_fim && r.vigencia_fim < r.vigencia_inicio) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['vigencia_fim'], message: 'fim da vigência anterior ao início' });
  }
});
export type PrecoPayload = z.infer<typeof PrecoPayload>;

// ---------- estoque (saldo por depósito e produto; reservas são do Macuxi) ----------
export const EstoquePayload = RegistroBase.extend({
  deposito_external_id: ExternalId,
  deposito_nome: TextoOpcional(120),
  produto_external_id: ExternalId,
  saldo: Quantidade,
  /** T-0149 (RN-CORE-39, aditivo): filial do depósito. Ausente em depósito novo = filial padrão; em depósito já conhecido = não altera. */
  filial_external_id: ExternalId.nullish(),
});
export type EstoquePayload = z.infer<typeof EstoquePayload>;

// ---------- título (financeiro) ----------
export const SituacaoTitulo = z.enum(['aberto', 'baixado', 'cancelado']);
export const TituloPayload = RegistroBase.extend({
  cliente_external_id: ExternalId,
  numero: Texto(40),
  parcela: z.number().int().positive().nullish(),
  emissao: DataCivil.nullish(),
  vencimento: DataCivil,
  valor_cents: CentavosNaoNegativos,
  saldo_cents: CentavosNaoNegativos,
  situacao: SituacaoTitulo,
  baixado_em: DataHoraUtc.nullish(),
});
export type TituloPayload = z.infer<typeof TituloPayload>;

// ---------- nota / histórico (faturamento e devolução) ----------
export const TipoNota = z.enum(['faturamento', 'devolucao']);
export const NotaPayload = RegistroBase.extend({
  cliente_external_id: ExternalId,
  vendedor_external_id: ExternalId.nullish(),
  tipo: TipoNota,
  numero: Texto(40),
  serie: TextoOpcional(10),
  emitida_em: DataHoraUtc,
  total_cents: Centavos,
  quantidade_itens: z.number().int().nonnegative().nullish(),
  /** UUID do pedido do Macuxi, quando a nota veio de pedido integrado. */
  pedido_uuid: z.string().uuid().nullish(),
  cancelada: z.boolean().default(false),
});
export type NotaPayload = z.infer<typeof NotaPayload>;

// ---------- rota (paradas) ----------
export const ParadaRota = z.object({
  ordem: z.number().int().positive(),
  cliente_external_id: ExternalId,
});
export const RotaPayload = RegistroBase.extend({
  nome: Texto(120),
  vendedor_external_id: ExternalId,
  /** 0 = domingo … 6 = sábado; ausente = rota sem dia fixo. */
  dia_semana: z.number().int().min(0).max(6).nullish(),
  paradas: z.array(ParadaRota).max(PARADAS_MAX).default([]),
});
export type RotaPayload = z.infer<typeof RotaPayload>;

// ---------- árvore do catálogo (T-0061) ----------
export const CatalogoNoPayload = RegistroBase.extend({
  codigo: Texto(60),
  nome: Texto(120),
  /** Nó pai; ausente = raiz. Referência fraca (o Catálogo ordena a árvore). */
  pai_external_id: ExternalId.nullish(),
  nivel: z.number().int().min(1).max(8),
  ordem: z.number().int().default(0),
});
export type CatalogoNoPayload = z.infer<typeof CatalogoNoPayload>;

// ---------- medida/embalagem do produto (T-0061) ----------
export const ProdutoUnidadePayload = RegistroBase.extend({
  produto_external_id: ExternalId,
  /** Sigla da medida cadastrada no tenant (RN-CORE-19), maiúsculas. */
  unidade: z
    .string({ required_error: 'unidade é obrigatória' })
    .trim()
    .toUpperCase()
    .regex(SIGLA_MEDIDA_FORMATO, 'unidade deve ter de 1 a 4 letras'),
  /** Quantidade de unidades base em uma desta embalagem (CX com 12 = 12). */
  fator: z
    .number()
    .int('fator deve ser inteiro')
    .positive('fator deve ser maior que zero')
    .max(EMBALAGEM_QUANTIDADE_MAX, `fator deve ser no máximo ${EMBALAGEM_QUANTIDADE_MAX}`),
  ean: z
    .string()
    .trim()
    .regex(/^\d{8}$|^\d{12,14}$/, 'EAN deve ter 8, 12, 13 ou 14 dígitos')
    .nullish(),
  padrao: z.boolean().default(false),
});
export type ProdutoUnidadePayload = z.infer<typeof ProdutoUnidadePayload>;

// ---------- endereço do cliente (T-0061) ----------
export const TIPOS_ENDERECO_CLIENTE = ['principal', 'entrega', 'cobranca'] as const;
export const ClienteEnderecoPayload = RegistroBase.extend({
  cliente_external_id: ExternalId,
  tipo: z.enum(TIPOS_ENDERECO_CLIENTE).default('entrega'),
  descricao: TextoOpcional(80),
  logradouro: Texto(160),
  numero: TextoOpcional(20),
  complemento: TextoOpcional(80),
  bairro: TextoOpcional(80),
  cidade: Texto(80),
  uf: z.string().trim().length(2, 'UF deve ter 2 letras').toUpperCase(),
  cep: TextoOpcional(9),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  principal: z.boolean().default(false),
});
export type ClienteEnderecoPayload = z.infer<typeof ClienteEnderecoPayload>;

// ---------- transportadora (T-0061; frete FOB) ----------
export const TransportadoraPayload = RegistroBase.extend({
  nome: Texto(120),
  documento: z
    .string()
    .trim()
    .regex(/^\d{14}$/, 'CNPJ da transportadora deve ter 14 dígitos')
    .nullish(),
  inscricao_estadual: TextoOpcional(20),
  telefone: TextoOpcional(30),
});
export type TransportadoraPayload = z.infer<typeof TransportadoraPayload>;

// ---------- forma de pagamento (T-0089; dono do dado: Vendedor) ----------
export const FormaPagamentoPayload = RegistroBase.extend({
  codigo: Texto(20),
  nome: Texto(60),
  ordem: z.number().int().default(0),
});
export type FormaPagamentoPayload = z.infer<typeof FormaPagamentoPayload>;

/** Parcelas em dias (0 = à vista), sem decrescer: 30/60/90 vale, 60/30 não (RN-VEN-24). */
export const ParcelasDias = z
  .array(z.number().int('cada parcela deve ser um número inteiro de dias').min(0, 'parcela não pode ser negativa').max(365, 'parcela aceita até 365 dias'))
  .min(1, 'informe ao menos uma parcela')
  .max(24, 'parcelas_dias aceita até 24 itens');

// ---------- prazo de pagamento (T-0089; dono do dado: Vendedor) ----------
export const PrazoPagamentoPayload = RegistroBase.extend({
  /** Referência à forma (RN-INT-04): forma ausente = `referencia_ausente`, reprocessável. */
  forma_external_id: ExternalId,
  codigo: Texto(20),
  /** Ausente = gerada pelo Macuxi ("28/56 dias"; [0] = "À vista"). */
  descricao: TextoOpcional(60),
  parcelas_dias: ParcelasDias,
  /** Informativo: o Macuxi CALCULA o prazo médio (RN-VEN-24); valor divergente vira o aviso `prazo_medio_divergente`. */
  prazo_medio_dias: z.number().int().min(0).max(365).nullish(),
  ordem: z.number().int().default(0),
}).superRefine((r, ctx) => {
  for (let i = 1; i < r.parcelas_dias.length; i++) {
    if ((r.parcelas_dias[i] ?? 0) < (r.parcelas_dias[i - 1] ?? 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['parcelas_dias'], message: 'parcelas_dias não pode decrescer (use 30/60/90, não 60/30)' });
      break;
    }
  }
});
export type PrazoPagamentoPayload = z.infer<typeof PrazoPagamentoPayload>;

// ---------- tabela escalonada (T-0089; dono do dado: Catálogo; RN-VEN-23) ----------
export const TabelaEscalonadaPayload = RegistroBase.extend({
  produto_external_id: ExternalId,
  /** Ausente = unidade base; a sigla é conferida com `core.medidas@1` (RN-CORE-19). */
  medida: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().trim().toUpperCase().regex(SIGLA_MEDIDA_FORMATO, 'medida deve ter de 1 a 4 letras').nullish(),
  ),
  quantidade_minima: z.number().int('quantidade_minima deve ser inteira').positive('quantidade_minima deve ser maior que zero'),
  /** Preço da UNIDADE BASE na faixa (RN-VEN-15: não existe preço de caixa). */
  preco_unidade_cents: CentavosNaoNegativos.refine((v) => v > 0, 'preco_unidade_cents deve ser maior que zero'),
  vigencia_inicio: DataCivil,
  vigencia_fim: DataCivil.nullish(),
  /** Ausente = vale para todas as tabelas de preço. */
  tabela_external_id: ExternalId.nullish(),
  /** T-0149 (RN-CORE-39, aditivo): ausente ou `null` = vale para todas as filiais. */
  filial_external_id: ExternalId.nullish(),
}).superRefine((r, ctx) => {
  if (r.vigencia_fim && r.vigencia_fim < r.vigencia_inicio) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['vigencia_fim'], message: 'fim da vigência anterior ao início' });
  }
});
export type TabelaEscalonadaPayload = z.infer<typeof TabelaEscalonadaPayload>;

// ---------- filial (T-0149, RN-CORE-39; dono do dado: Core; ADR 0040) ----------
/**
 * Unidade de onde saem as entregas. O Core casa pelo `external_id`; sem ele, pelo `codigo` (a filial padrão nasce `0001` sem
 * `external_id` e é adotada pela primeira carga com o mesmo código). O ERP não define a padrão: quem muda é o admin no BKO.
 */
export const FilialPayload = RegistroBase.extend({
  codigo: Texto(20),
  nome: Texto(80),
  cidade: TextoOpcional(80),
  uf: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'UF deve ter 2 letras (A-Z)').nullish(),
  // T-0159 (RN-CORE-39): CNPJ e endereço da filial (cabeçalho do PDF do pedido). Opcionais no shape (aditivo no v1); a CARGA os exige abaixo.
  cnpj: TextoOpcional(LIMITES_FILIAL.cnpj),
  logradouro: TextoOpcional(LIMITES_FILIAL.logradouro),
  numero: TextoOpcional(LIMITES_FILIAL.numero),
  complemento: TextoOpcional(LIMITES_FILIAL.complemento),
  bairro: TextoOpcional(LIMITES_FILIAL.bairro),
  cep: TextoOpcional(LIMITES_FILIAL.cep),
  telefone: TextoOpcional(LIMITES_FILIAL.telefone),
}).superRefine((r, ctx) => {
  const falta = (campo: string, mensagem: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [campo], message: mensagem });
  if (!r.cnpj) falta('cnpj', 'CNPJ da filial é obrigatório');
  else if (!cnpjValido(r.cnpj)) falta('cnpj', 'CNPJ da filial inválido (dígito verificador)');
  const ROTULO: Record<string, string> = { numero: 'número', cep: 'CEP', uf: 'UF' };
  for (const campo of CAMPOS_OBRIGATORIOS_FILIAL) {
    if (campo === 'cnpj') continue;
    if (!r[campo]) falta(campo, `${ROTULO[campo] ?? campo} da filial é obrigatório`);
  }
});
export type FilialPayload = z.infer<typeof FilialPayload>;

/** Schema do registro de cada entidade (validação linha a linha, RN-INT-03). */
export const SCHEMA_REGISTRO = {
  vendedor: VendedorPayload,
  cliente: ClientePayload,
  produto: ProdutoPayload,
  preco: PrecoPayload,
  estoque: EstoquePayload,
  titulo: TituloPayload,
  nota: NotaPayload,
  rota: RotaPayload,
  catalogo_no: CatalogoNoPayload,
  produto_unidade: ProdutoUnidadePayload,
  cliente_endereco: ClienteEnderecoPayload,
  transportadora: TransportadoraPayload,
  forma_pagamento: FormaPagamentoPayload,
  prazo_pagamento: PrazoPagamentoPayload,
  tabela_escalonada: TabelaEscalonadaPayload,
  filial: FilialPayload,
} as const satisfies Record<Entidade, z.ZodTypeAny>;

export type RegistroDe<E extends Entidade> = z.infer<(typeof SCHEMA_REGISTRO)[E]>;

/** Campo cuja soma o ERP informa na reconciliação (RN-INT-07); `null` = só contagem. */
export const CAMPO_SOMA_CONTROLE: Record<Entidade, string | null> = {
  vendedor: null,
  cliente: null,
  produto: null,
  rota: null,
  preco: 'preco_cents',
  estoque: 'saldo',
  titulo: 'saldo_cents',
  nota: 'total_cents',
  catalogo_no: null,
  produto_unidade: null,
  cliente_endereco: null,
  transportadora: null,
  forma_pagamento: null,
  prazo_pagamento: null,
  tabela_escalonada: 'preco_unidade_cents',
  filial: null,
};
