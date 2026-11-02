/**
 * Payload canônico por entidade (RF-INT-01). Direção ERP → Macuxi.
 * Produto é o cadastro base do Core (ADR-0005); preço e estoque seguem para o Catálogo.
 * O Hub só define o formato do payload; não importa tipos internos de outros módulos.
 */
import { z } from 'zod';
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

/** As 8 primeiras são as originais; as 4 últimas entraram aditivas no v1 (ADR 0016, desenho T-0061 §4.4). */
export const ENTIDADES = ['vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota', 'catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora'] as const;
export const Entidade = z.enum(ENTIDADES, { errorMap: () => ({ message: 'entidade desconhecida' }) });
export type Entidade = z.infer<typeof Entidade>;

// ---------- vendedor ----------
export const VendedorPayload = RegistroBase.extend({
  nome: Texto(120),
  email: TextoOpcional(160),
  telefone: TextoOpcional(30),
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
  contatos: z.array(ContatoCliente).max(CONTATOS_MAX).default([]),
});
export type ClientePayload = z.infer<typeof ClientePayload>;

// ---------- produto (cadastro base do Core, ADR-0005) ----------
const ProdutoBase = RegistroBase.extend({
  sku: Texto(60),
  ean: z
    .string()
    .trim()
    .regex(/^\d{8}$|^\d{12,14}$/, 'EAN deve ter 8, 12, 13 ou 14 dígitos')
    .nullish(),
  nome: Texto(200),
  marca: TextoOpcional(80),
  categoria: TextoOpcional(80),
  /** Sigla da medida cadastrada no tenant (RN-CORE-19); o A7 confere com `core.medidas@1` (ausente/inativa = `referencia_ausente`). */
  unidade: Texto(10),
  /**
   * Embalagem padrão do produto (T-0063, RN-CORE-19): sigla da medida da embalagem (ex.: `CX`) e quantas unidades ela traz (CX c/ 12 = 12).
   * Campos opcionais e aditivos (mesma versão do contrato). A sigla é conferida como a `unidade` (desconhecida/inativa = `referencia_ausente`).
   * Medida e quantidade andam juntas: uma sem a outra é recusada.
   */
  embalagem_medida: TextoOpcional(10),
  embalagem_quantidade: z.number().int('embalagem_quantidade deve ser inteira').positive('embalagem_quantidade deve ser maior que zero').nullish(),
  /** Nó da árvore do catálogo; referência FRACA: nó ausente vira aviso e o produto entra sem nó. */
  catalogo_no_external_id: ExternalId.nullish(),
  /** RN-CORE-18 / RN-VEN-11: custo, preço de venda e desconto máximo próprio (o Core aplica). */
  custo_cents: CentavosNaoNegativos.nullish(),
  preco_venda_cents: CentavosNaoNegativos.nullish(),
  desconto_maximo_pct: z.number().min(0).max(100).nullish(),
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
    .regex(/^[A-Z0-9]{1,6}$/, 'unidade deve ter de 1 a 6 letras ou números'),
  /** Quantidade de unidades base em uma desta embalagem (CX com 12 = 12). */
  fator: z.number().int('fator deve ser inteiro').positive('fator deve ser maior que zero'),
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
};
