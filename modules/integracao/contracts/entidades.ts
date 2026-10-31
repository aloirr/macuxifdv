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

export const ENTIDADES = ['vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota'] as const;
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
  bloqueado: z.boolean().default(false),
  contatos: z.array(ContatoCliente).max(CONTATOS_MAX).default([]),
});
export type ClientePayload = z.infer<typeof ClientePayload>;

// ---------- produto (cadastro base do Core, ADR-0005) ----------
export const ProdutoPayload = RegistroBase.extend({
  sku: Texto(60),
  ean: z
    .string()
    .trim()
    .regex(/^\d{8}$|^\d{12,14}$/, 'EAN deve ter 8, 12, 13 ou 14 dígitos')
    .nullish(),
  nome: Texto(200),
  marca: TextoOpcional(80),
  categoria: TextoOpcional(80),
  unidade: Texto(10),
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
};
