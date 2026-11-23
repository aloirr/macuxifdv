/**
 * RN-CORE-78 e RN-CORE-79: pré-cadastro de cliente (o FDV só pré-cadastra; o ERP aprova). Funções puras; a API revalida.
 * Razão social e CPF/CNPJ são sempre obrigatórios; a empresa marca os demais em Parâmetros.
 */
import { mascararDadoPessoal } from '@macuxi/comum';
import {
  ERRO_CAMPO_LIMITES,
  ERROS_RECUSA_MAX,
  type ErroCampoCadastro,
  type SituacaoRecusado,
  type StatusCadastro,
} from '../contracts/cliente-pre-cadastro';

export type DadosPreCadastro = Readonly<Record<string, string | number | null | undefined>>;

/** Motivo da recusa do ERP guardado até 500 caracteres (RN-CORE-78); vazio vira nulo. */
export const MOTIVO_RECUSA_MAX = 500;
export function motivoRecusaCortado(motivo: string | null | undefined): string | null {
  const m = (motivo ?? '').trim();
  return m === '' ? null : m.slice(0, MOTIVO_RECUSA_MAX);
}

/**
 * Criação com o CPF/CNPJ de outro cliente vivo (RN-CORE-78): pendente, aprovado ou sem situação (legado) bloqueia com 409. Recusado não
 * bloqueia: é o `id` novo do APK v1.0.28 substituindo o recusado (ADR 0069 §4). O recusado sai (`remover`, deleted_at na mesma
 * transação) e o novo herda o histórico dele como revisão seguinte (`substituir`: o de maior revisão; pelo índice único há no máximo um).
 * Sai quando a versão mínima do Campo passar de 1.0.28 (volta a só bloquear).
 */
export function decidirDocumentoDuplicado(iguais: readonly { id: string; status_cadastro: StatusCadastro | null; revisao_cadastro?: number | null }[]): {
  bloqueia: boolean;
  remover: string[];
  substituir: { id: string; revisao: number } | null;
} {
  const bloqueia = iguais.some((c) => c.status_cadastro !== 'recusado');
  if (bloqueia || iguais.length === 0) return { bloqueia, remover: [], substituir: null };
  const alvo = iguais.reduce((a, b) => ((b.revisao_cadastro ?? 1) > (a.revisao_cadastro ?? 1) ? b : a));
  return { bloqueia, remover: iguais.map((c) => c.id), substituir: { id: alvo.id, revisao: alvo.revisao_cadastro ?? 1 } };
}

/** RN-CORE-78: o motivo e os erros por campo da recusa do ERP só vão ao vendedor. */
export function perfilVeRecusa(perfil: string): boolean {
  return perfil === 'vendedor';
}

/**
 * Chaves do hash v1, em ordem lexicográfica por ponto de código (ADR 0069 §2), que são também as colunas de dados do pré-cadastro em
 * `core.cliente` (fonte única da API). Mudar qualquer regra = ADR nova.
 */
export const COLUNAS_DADOS_PRE_CADASTRO = ['bairro', 'cep', 'cidade', 'documento', 'email', 'filial_id', 'inscricao_estadual', 'latitude', 'logradouro', 'longitude', 'nome_fantasia', 'numero', 'razao_social', 'telefone', 'uf'] as const;
type ChaveCanonica = (typeof COLUNAS_DADOS_PRE_CADASTRO)[number];
const SO_DIGITOS = new Set<ChaveCanonica>(['documento', 'cep', 'telefone']);
const MAIUSCULAS = new Set<ChaveCanonica>(['uf', 'inscricao_estadual']);

function texto(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
}

/** Casas das coordenadas no banco (`numeric(9, 6)`). */
const CASAS_COORDENADA = 6;

/**
 * Arredonda o texto decimal em 6 casas como o `numeric(9, 6)` do Postgres: o meio vai para longe do zero (-3.1234565 -> -3.123457), sobre
 * os dígitos do texto que chega ao banco, sem o erro do binário (`Math.round` levaria o meio negativo para +∞ e o hash divergiria do Hub).
 */
function arredondarComoPostgres(n: number, bruto: string): number {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(bruto) ?? /^(-?)(\d+)(?:\.(\d*))?$/.exec(n.toFixed(20));
  if (!m) return n;
  const [, sinal, inteiro = '', fracao = ''] = m;
  if (fracao.length <= CASAS_COORDENADA) return n;
  const escala = BigInt(`${inteiro || '0'}${fracao.slice(0, CASAS_COORDENADA)}`) + (fracao[CASAS_COORDENADA]! >= '5' ? 1n : 0n);
  const digitos = escala.toString().padStart(CASAS_COORDENADA + 1, '0');
  const r = Number(`${digitos.slice(0, -CASAS_COORDENADA)}.${digitos.slice(-CASAS_COORDENADA)}`);
  return sinal === '-' && r !== 0 ? -r : r;
}

function coordenada(v: unknown): number | null {
  const bruto = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
  const n = bruto === '' ? NaN : Number(bruto);
  return Number.isFinite(n) ? arredondarComoPostgres(n, bruto) : null;
}

function valorCanonico(chave: ChaveCanonica, v: unknown): string | number | null {
  if (chave === 'latitude' || chave === 'longitude') return coordenada(v);
  const t = texto(v);
  if (t === null) return null;
  if (SO_DIGITOS.has(chave)) return t.replace(/\D/g, '') || null;
  if (MAIUSCULAS.has(chave)) return t.toUpperCase();
  if (chave === 'email' || chave === 'filial_id') return t.toLowerCase();
  return t;
}

function objetoCanonico(dados: DadosPreCadastro): Record<ChaveCanonica, string | number | null> {
  return Object.fromEntries(COLUNAS_DADOS_PRE_CADASTRO.map((k) => [k, valorCanonico(k, dados[k])])) as Record<ChaveCanonica, string | number | null>;
}

/**
 * RN-CORE-78 (ADR 0069 §2, versão 1): texto canônico dos dados do pré-cadastro; a API faz o sha256 dele (`node:crypto`). Todas as chaves
 * presentes, em ordem fixa; texto com trim e vazio nulo; documento, CEP e telefone só dígitos; UF e IE em maiúsculas; e-mail e filial em
 * minúsculas; coordenadas em 6 casas. Fora do hash: id, origem, revisao_base e o que não é dado do cliente.
 */
export function canonicalPreCadastro(dados: DadosPreCadastro): string {
  return JSON.stringify(objetoCanonico(dados));
}

/** RN-CORE-78: nomes dos campos que mudaram entre duas revisões (pelos valores canônicos), na ordem canônica; nunca os valores. */
export function camposAlteradosPreCadastro(antes: DadosPreCadastro, depois: DadosPreCadastro): string[] {
  const a = objetoCanonico(antes);
  const d = objetoCanonico(depois);
  return COLUNAS_DADOS_PRE_CADASTRO.filter((k) => a[k] !== d[k]);
}

export type DecisaoReenvioPreCadastro =
  | { acao: 'nova_revisao'; revisao: number }
  | { acao: 'repetido' }
  | { acao: 'recusar'; http: 404 | 409 | 422; codigo: 'NAO_ENCONTRADO' | 'REVISAO_DESATUALIZADA' | 'CADASTRO_NAO_RECUSADO' };

/**
 * RN-CORE-78: correção do recusado com a `revisao_base` que a pessoa viu. Igual à atual (e recusado) = revisão nova; a anterior com o
 * mesmo hash da atual = repetição idempotente; outra = 409 REVISAO_DESATUALIZADA (dois corretores ao mesmo tempo); na revisão atual sem
 * estar recusado = 422 CADASTRO_NAO_RECUSADO; sem cliente = 404.
 */
export function decidirReenvioPreCadastro(
  atual: { status_cadastro: StatusCadastro | null; revisao_cadastro: number; hash_atual: string | null } | null,
  pedido: { revisao_base: number; hash: string },
): DecisaoReenvioPreCadastro {
  if (!atual) return { acao: 'recusar', http: 404, codigo: 'NAO_ENCONTRADO' };
  if (pedido.revisao_base === atual.revisao_cadastro - 1 && atual.hash_atual !== null && pedido.hash === atual.hash_atual) return { acao: 'repetido' };
  if (pedido.revisao_base !== atual.revisao_cadastro) return { acao: 'recusar', http: 409, codigo: 'REVISAO_DESATUALIZADA' };
  if (atual.status_cadastro !== 'recusado') return { acao: 'recusar', http: 422, codigo: 'CADASTRO_NAO_RECUSADO' };
  return { acao: 'nova_revisao', revisao: atual.revisao_cadastro + 1 };
}

export type DecisaoConflitoUnicidade =
  | { resposta: 'ja_existia'; status_cadastro: StatusCadastro }
  | { resposta: 'erro'; codigo: 'CADASTRO_INDISPONIVEL' | 'DOCUMENTO_JA_CADASTRADO' }
  | { resposta: 'relancar' };

/**
 * RN-CORE-78 (ADR 0069 §5): 23505 no insert do pré-cadastro, decidido pela restrição depois da reconsulta. `cliente_pkey`: id vivo no
 * tenant = o outro pedido gravou primeiro (ja_existia); apagado ou invisível pela RLS = CADASTRO_INDISPONIVEL. `cliente_documento_uk`:
 * mesmo id = ja_existia; outro (ou já sumiu) = DOCUMENTO_JA_CADASTRADO. Outra restrição relança. Sem laço de nova tentativa.
 */
export function decidirConflitoUnicidade(e: {
  restricao: string | undefined;
  id: string;
  porId: { status_cadastro: StatusCadastro | null; apagado: boolean } | null;
  porDocumento: { id: string } | null;
}): DecisaoConflitoUnicidade {
  const vivo = e.porId && !e.porId.apagado ? e.porId : null;
  if (e.restricao === 'cliente_pkey') return vivo ? { resposta: 'ja_existia', status_cadastro: vivo.status_cadastro ?? 'aprovado' } : { resposta: 'erro', codigo: 'CADASTRO_INDISPONIVEL' };
  if (e.restricao === 'cliente_documento_uk') {
    return e.porDocumento?.id === e.id ? { resposta: 'ja_existia', status_cadastro: vivo?.status_cadastro ?? 'pendente' } : { resposta: 'erro', codigo: 'DOCUMENTO_JA_CADASTRADO' };
  }
  return { resposta: 'relancar' };
}

/**
 * RN-CORE-78: situação na lista de recusados do BKO (só clientes com ao menos uma tentativa recusada). Recusado = recusado; pendente
 * depois de corrigido (revisão > 1) = reenviado; aprovado = aceito. Fora disso (pendente da 1ª revisão, sem situação) = nulo.
 */
export function situacaoDoRecusado(c: { status_cadastro: StatusCadastro | null; revisao_cadastro: number | null }): SituacaoRecusado | null {
  if (c.status_cadastro === 'recusado') return 'recusado';
  if (c.status_cadastro === 'aprovado') return 'aceito';
  if (c.status_cadastro === 'pendente' && (c.revisao_cadastro ?? 1) > 1) return 'reenviado';
  return null;
}

/**
 * RN-CORE-78 e regra 8: erros por campo do ERP prontos para gravar. Só itens com campo, código e mensagem em texto; até 50 itens; a
 * mensagem passa por `mascararDadoPessoal` antes do corte em 300 caracteres (o corte nunca deixa meio CPF à vista).
 */
export function errosRecusaSeguros(erros: unknown): ErroCampoCadastro[] {
  if (!Array.isArray(erros)) return [];
  const seguros: ErroCampoCadastro[] = [];
  for (const e of erros) {
    if (seguros.length >= ERROS_RECUSA_MAX) break;
    if (typeof e !== 'object' || e === null) continue;
    const { campo, codigo, mensagem } = e as Record<string, unknown>;
    if (typeof campo !== 'string' || typeof codigo !== 'string' || typeof mensagem !== 'string') continue;
    const item = {
      campo: campo.trim().slice(0, ERRO_CAMPO_LIMITES.campo),
      codigo: codigo.trim().slice(0, ERRO_CAMPO_LIMITES.codigo),
      mensagem: mascararDadoPessoal(mensagem.trim()).slice(0, ERRO_CAMPO_LIMITES.mensagem).trim(),
    };
    if (item.campo !== '' && item.codigo !== '' && item.mensagem !== '') seguros.push(item);
  }
  return seguros;
}
