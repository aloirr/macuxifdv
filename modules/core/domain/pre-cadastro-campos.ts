/**
 * Pré-cadastro de cliente no Campo (v1.0.28, RN-CORE-16): funções puras para o formulário offline e para a API revalidar.
 * Genérico nos códigos de campo: pluga nos tipos de `contracts/cadastro` (CampoCadastroCliente) sem depender deles.
 * CNPJ/CPF vêm de `@macuxi/comum` (fonte única do dígito verificador).
 */
import { cnpjValido, cpfValido } from '@macuxi/comum';

/** Efetivos = sempre obrigatórios ∪ parâmetro do tenant (códigos desconhecidos e tipo inválido ignorados); ordem canônica, sem duplicados. */
export function camposObrigatoriosEfetivos<C extends string>(ordemCanonica: readonly C[], sempre: readonly C[], parametro: unknown): C[] {
  const conhecidos = new Set<string>(ordemCanonica);
  const doParametro = Array.isArray(parametro) ? parametro.filter((c): c is C => typeof c === 'string' && conhecidos.has(c)) : [];
  const conjunto = new Set<string>([...sempre, ...doParametro]);
  return ordemCanonica.filter((c) => conjunto.has(c));
}

export interface ResultadoValidacaoPreCadastro {
  ok: boolean;
  /** Mensagem em português por campo com problema (a ação seguinte vai no texto). */
  erros: Record<string, string>;
}

const vazio = (v: unknown): boolean => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/** Valida o formulário: obrigatório preenchido; documento CNPJ/CPF válido; e-mail com formato mínimo quando preenchido. */
export function validarPreCadastro(dados: Readonly<Record<string, unknown>>, obrigatorios: readonly string[]): ResultadoValidacaoPreCadastro {
  const erros: Record<string, string> = {};
  for (const campo of obrigatorios) if (vazio(dados[campo])) erros[campo] = 'Preencha este campo.';
  const doc = dados.documento;
  if (!vazio(doc) && !erros.documento && !(cnpjValido(String(doc)) || cpfValido(String(doc)))) erros.documento = 'CNPJ ou CPF inválido. Confira os números.';
  const email = dados.email;
  if (!vazio(email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) erros.email = 'E-mail inválido. Use o formato nome@empresa.com.';
  return { ok: Object.keys(erros).length === 0, erros };
}
