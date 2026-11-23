/**
 * Pré-cadastro de cliente no Campo (v1.0.28; RN-CORE-78 e RN-CORE-79): funções puras para o formulário offline e para a API revalidar.
 * Os campos e os rótulos são os dos contratos (`cliente-pre-cadastro`); CNPJ/CPF e CEP vêm de `@macuxi/comum` (fonte única do dígito verificador).
 * Uma regra, um lugar (v1.0.29, ADR 0069): os obrigatórios vêm da lista única da RN-CORE-16 (`camposExigidos`, `cadastroCompleto` em
 * `cadastro.ts`); aqui ficam só o recorte do pré-cadastro, os formatos e a projeção para o APK v1.0.28.
 */
import { cepValido, cnpjValido, cpfValido, somenteDigitos } from '@macuxi/comum';
import { ehEmail } from '@macuxi/comum/email';
import { CAMPOS_CADASTRO_CLIENTE, CAMPOS_CADASTRO_FIXOS, type CampoCadastroCliente } from '../contracts/cadastro';
import {
  CAMPOS_PRE_CADASTRO_CONFIGURAVEIS,
  CAMPOS_PRE_CADASTRO_SEMPRE,
  COLUNAS_ENDERECO_PRE_CADASTRO,
  MENSAGENS_CAMPO_FALTANTE,
  type CampoPreCadastro,
  type CampoPreCadastroConfiguravel,
  type StatusCadastro,
} from '../contracts/cliente-pre-cadastro';
import { cadastroCompleto, type DadosCadastro } from './cadastro';

const ORDEM: readonly CampoPreCadastro[] = [...CAMPOS_PRE_CADASTRO_SEMPRE, ...CAMPOS_PRE_CADASTRO_CONFIGURAVEIS];

/**
 * RN-CORE-79: obrigatórios efetivos = sempre obrigatórios ∪ os do parâmetro, sem repetir, na ordem canônica.
 * @deprecated v1.0.29 (ADR 0069): use `obrigatoriosDoPreCadastro(camposExigidos(parametro))`; sai com a versão mínima > 1.0.28.
 */
export function camposObrigatoriosPreCadastro(doParametro: readonly CampoPreCadastroConfiguravel[]): CampoPreCadastro[] {
  const conjunto = new Set<string>([...CAMPOS_PRE_CADASTRO_SEMPRE, ...doParametro]);
  return ORDEM.filter((c) => conjunto.has(c));
}

/** Campos que o vendedor não pode destravar (RN-CORE-79). */
export const ehSempreObrigatorio = (campo: string): boolean => (CAMPOS_PRE_CADASTRO_SEMPRE as readonly string[]).includes(campo);

export const FALTA_OBRIGATORIO_PRE_CADASTRO = 'Obrigatório';

export interface ResultadoValidacaoPreCadastro {
  ok: boolean;
  /** Texto curto por coluna do formulário com problema (`endereco` vale pelas colunas do grupo). */
  erros: Record<string, string>;
}

const vazio = (v: unknown): boolean => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/** Fora do pré-cadastro: o cliente não tem a coluna `complemento` e a geolocalização vem do aparelho (pode faltar). */
const FORA_DO_PRE_CADASTRO = new Set<CampoCadastroCliente>(['complemento', 'geolocalizacao']);

/**
 * RN-CORE-16 e RN-CORE-79: obrigatórios do pré-cadastro = a lista exigida pelo tenant (`camposExigidos`) menos complemento e
 * geolocalização; razão social e CPF/CNPJ entram sempre. Sem repetir, na ordem canônica.
 */
export function obrigatoriosDoPreCadastro(exigidos: readonly CampoCadastroCliente[]): CampoCadastroCliente[] {
  const conjunto = new Set<CampoCadastroCliente>([...CAMPOS_CADASTRO_FIXOS, ...exigidos]);
  return CAMPOS_CADASTRO_CLIENTE.filter((c) => conjunto.has(c) && !FORA_DO_PRE_CADASTRO.has(c));
}

const ENDERECO: readonly CampoCadastroCliente[] = COLUNAS_ENDERECO_PRE_CADASTRO;

/** Aceita a lista nova e, até o app sair da v1.0.28, a antiga (`endereco` = o grupo todo). */
function paraCamposCadastro(lista: readonly (CampoCadastroCliente | CampoPreCadastro)[]): CampoCadastroCliente[] {
  return lista.flatMap((c) => (c === 'endereco' ? [...ENDERECO] : [c]));
}

const textoOuNulo = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null);
const numeroOuNulo = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * RN-CORE-16 e RN-CORE-79: obrigatório faltando pela `cadastroCompleto` (IE só para CNPJ, "isento" vale; CPF/CNPJ com dígito válido),
 * sobre `obrigatoriosDoPreCadastro`, mais os formatos de qualquer valor preenchido (CNPJ/CPF, CEP, telefone, e-mail).
 */
export function validarPreCadastro(dados: Readonly<Record<string, unknown>>, exigidos: readonly (CampoCadastroCliente | CampoPreCadastro)[]): ResultadoValidacaoPreCadastro {
  const erros: Record<string, string> = {};
  const d: DadosCadastro = {
    ...Object.fromEntries(CAMPOS_CADASTRO_CLIENTE.map((c) => [c, textoOuNulo(dados[c])])),
    latitude: numeroOuNulo(dados.latitude),
    longitude: numeroOuNulo(dados.longitude),
  };
  for (const campo of cadastroCompleto(d, obrigatoriosDoPreCadastro(paraCamposCadastro(exigidos))).campos_faltantes) erros[campo] = FALTA_OBRIGATORIO_PRE_CADASTRO;
  const doc = somenteDigitos(String(dados.documento ?? ''));
  if (doc !== '' && !(cnpjValido(doc) || cpfValido(doc))) erros.documento = doc.length > 11 ? 'CNPJ inválido' : 'CPF inválido';
  if (!vazio(dados.cep) && !cepValido(String(dados.cep))) erros.cep = 'CEP inválido';
  const fone = somenteDigitos(String(dados.telefone ?? ''));
  if (!vazio(dados.telefone) && fone.length !== 10 && fone.length !== 11) erros.telefone = 'Telefone inválido';
  if (!vazio(dados.email) && !ehEmail(String(dados.email).trim())) erros.email = 'E-mail inválido';
  return { ok: Object.keys(erros).length === 0, erros };
}

/**
 * RN-CORE-79 (compatibilidade com o APK v1.0.28): projeção da lista única na chave antiga `cliente.pre_cadastro.obrigatorios`, igual ou
 * mais exigente que a regra nova (o APK antigo não manda o que a API recusa). `endereco` entra se qualquer campo de endereço for exigido.
 * Sai com a versão mínima do Campo > 1.0.28.
 */
export function projecaoLegadaObrigatorios(exigidos: readonly CampoCadastroCliente[]): CampoPreCadastroConfiguravel[] {
  const conjunto = new Set<string>(exigidos);
  if (ENDERECO.some((c) => conjunto.has(c))) conjunto.add('endereco');
  return CAMPOS_PRE_CADASTRO_CONFIGURAVEIS.filter((c) => conjunto.has(c));
}

/** RN-CORE-78: só o vendedor pré-cadastra (a decisão do dono do produto não abre o promotor nem a gestão). A API revalida. */
export const podePreCadastrarCliente = (perfil: string): boolean => perfil === 'vendedor';

/** Texto do app quando o item da fila falhou sem motivo do servidor; no selo "Não enviado" ele não vira linha de motivo (o rótulo já diz). */
export const MOTIVO_ENVIO_FALHOU = 'Não foi possível enviar o cadastro.';

export type SituacaoDoPreCadastro = 'aguardando_erp' | 'recusado_erp' | 'aprovado_erp' | 'nao_enviado';

/**
 * RN-CORE-78: selo do cliente. Recusado (pelo ERP) = recusado com o motivo; pendente com motivo = não enviado (parou na fila, nunca chegou ao ERP); com código do ERP = aprovado (sem selo); pendente ou sem código = aguardando.
 */
export function situacaoDoPreCadastro(c: { status_cadastro?: StatusCadastro | null; external_id?: string | null; motivo_recusa?: string | null }): { situacao: SituacaoDoPreCadastro; motivo: string | null } {
  if (c.status_cadastro === 'recusado') return { situacao: 'recusado_erp', motivo: c.motivo_recusa?.trim() || null };
  // não enviado: o item da fila parou antes do ERP (422, 409, módulo inativo); o app o marca pendente com o motivo no `motivo_recusa`
  if (c.status_cadastro === 'pendente' && c.motivo_recusa?.trim()) return { situacao: 'nao_enviado', motivo: c.motivo_recusa.trim() === MOTIVO_ENVIO_FALHOU ? null : c.motivo_recusa.trim() };
  if (c.external_id && c.external_id.trim() !== '') return { situacao: 'aprovado_erp', motivo: null };
  return { situacao: 'aguardando_erp', motivo: null };
}

/**
 * RN-CORE-78 (422 CAMPOS_OBRIGATORIOS): o motivo é só a lista "Preencha ..." do servidor. Com o campo marcado na tela, a linha do topo
 * repete o campo e sai; os demais motivos (recusa do ERP, 409 de documento) ficam.
 */
export function motivoSoDeCamposFaltantes(motivo: string | null | undefined): boolean {
  const texto = (motivo ?? '').trim();
  if (texto === '') return false;
  return Object.values(MENSAGENS_CAMPO_FALTANTE).reduce((resto, m) => resto.split(m).join(''), texto).trim() === '';
}
