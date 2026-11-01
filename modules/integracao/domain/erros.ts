/**
 * Erro por linha e resultado do lote (RN-INT-03).
 * A mensagem é montada a partir do schema (nome do campo, tipo esperado, valores aceitos) e
 * **nunca** inclui o valor recebido — pode ser dado pessoal (CPF, e-mail, telefone).
 */
import type { ZodError, ZodIssue } from 'zod';
import type { CodigoErroLinha, ContagensLote, EstadoLote, LinhaErro } from '../contracts';

const REPROCESSAVEIS: ReadonlySet<CodigoErroLinha> = new Set<CodigoErroLinha>(['referencia_ausente', 'falha_processamento']);

/** Reprocessável = basta tentar de novo (a dependência chegou / falha transitória). Os demais exigem reenvio corrigido. */
export function ehReprocessavel(codigo: CodigoErroLinha): boolean {
  return REPROCESSAVEIS.has(codigo);
}

/** `paradas[1].cliente_external_id`; vazio = o registro inteiro. */
export function caminhoDoCampo(path: readonly (string | number)[]): string | null {
  if (path.length === 0) return null;
  return path.reduce<string>((acc, p) => (typeof p === 'number' ? `${acc}[${p}]` : acc ? `${acc}.${p}` : p), '');
}

export interface ErroDescrito {
  codigo: CodigoErroLinha;
  campo: string | null;
  mensagem: string;
}

const TIPOS: Record<string, string> = {
  string: 'texto',
  number: 'número',
  integer: 'número inteiro',
  boolean: 'verdadeiro/falso',
  array: 'lista',
  object: 'objeto',
  date: 'data',
};

/** Traduz uma issue do Zod para código + mensagem legível, sem o valor recebido. */
export function descreverIssue(issue: ZodIssue): ErroDescrito {
  const campo = caminhoDoCampo(issue.path);
  const de = campo ? `O campo "${campo}"` : 'O registro';
  const e = (codigo: CodigoErroLinha, mensagem: string): ErroDescrito => ({ codigo, campo, mensagem });

  if (issue.path[0] === 'external_id') {
    return { codigo: 'external_id_invalido', campo: 'external_id', mensagem: 'O campo "external_id" é obrigatório: informe a chave do registro no ERP (texto de 1 a 100 caracteres).' };
  }

  switch (issue.code) {
    case 'invalid_type': {
      if (campo === null) return e('registro_invalido', 'Cada registro deve ser um objeto JSON com os campos do contrato.');
      if (issue.received === 'undefined' || issue.received === 'null') return e('campo_obrigatorio', `${de} é obrigatório e não pode ser nulo. Preencha e reenvie.`);
      const esperado = TIPOS[issue.expected] ?? issue.expected;
      const dica = issue.expected === 'integer' ? ' (em centavos, sem casas decimais)' : '';
      return e('tipo_invalido', `${de} deve ser ${esperado}${dica}. Corrija o tipo e reenvie.`);
    }
    case 'too_small': {
      if (issue.type === 'string' && Number(issue.minimum) <= 1) return e('campo_obrigatorio', `${de} não pode ficar vazio. Preencha e reenvie.`);
      return e('valor_fora_da_faixa', `${de} está abaixo do mínimo permitido (${String(issue.minimum)}). Corrija o valor e reenvie.`);
    }
    case 'too_big':
      return e('valor_fora_da_faixa', `${de} passa do máximo permitido (${String(issue.maximum)}). Corrija o valor e reenvie.`);
    case 'not_multiple_of':
    case 'not_finite':
      return e('valor_fora_da_faixa', `${de} tem um valor fora do permitido. Corrija e reenvie.`);
    case 'invalid_string':
    case 'invalid_date':
      return e('formato_invalido', `${de} está em formato inválido (datas em ISO 8601 UTC terminando em Z, ex.: 2026-10-31T14:00:00Z). Corrija e reenvie.`);
    case 'invalid_enum_value':
      return e('valor_nao_permitido', `${de} aceita apenas: ${issue.options.join(', ')}. Corrija e reenvie.`);
    case 'invalid_union_discriminator':
      return e('valor_nao_permitido', `${de} aceita apenas: ${issue.options.map(String).join(', ')}. Corrija e reenvie.`);
    case 'invalid_literal':
    case 'invalid_union':
      return e('valor_nao_permitido', `${de} tem um valor não permitido. Consulte o contrato e reenvie.`);
    case 'unrecognized_keys':
      return e('campo_desconhecido', `${de} contém campos que o contrato não conhece. Remova-os e reenvie.`);
    case 'custom':
      return e('regra_invalida', `${de}: ${issue.message}. Corrija e reenvie.`);
    default:
      return e('regra_invalida', `${de} não atende ao contrato. Corrija e reenvie.`);
  }
}

/** Uma linha de erro por campo com problema (a primeira issue de cada campo basta). */
export function classificarErroZod(erro: ZodError, ctx: { indice: number; external_id: string | null }): LinhaErro[] {
  const vistos = new Set<string>();
  const saida: LinhaErro[] = [];
  for (const issue of erro.issues) {
    const d = descreverIssue(issue);
    const chave = d.campo ?? '';
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push({ indice: ctx.indice, external_id: ctx.external_id, ...d, reprocessavel: ehReprocessavel(d.codigo) });
  }
  return saida;
}

/** RN-INT-04: a linha cita um external_id de outra entidade que ainda não existe. */
export function erroReferenciaAusente(indice: number, externalId: string | null, campo: string, entidadeAlvo: string): LinhaErro {
  return {
    indice,
    external_id: externalId,
    codigo: 'referencia_ausente',
    campo,
    mensagem: `O campo "${campo}" aponta para um(a) ${entidadeAlvo} que ainda não foi carregado(a). Envie ${entidadeAlvo} antes; a linha será reprocessada.`,
    reprocessavel: true,
  };
}

/** Falha transitória ao gravar a linha (banco, timeout). */
export function erroFalhaProcessamento(indice: number, externalId: string | null): LinhaErro {
  return {
    indice,
    external_id: externalId,
    codigo: 'falha_processamento',
    campo: null,
    mensagem: 'Não foi possível gravar a linha por uma falha temporária. Use "Reprocessar" no monitor.',
    reprocessavel: true,
  };
}

export interface EntradaResultadoLote {
  recebidas: number;
  duplicadas_no_lote: number;
  erros: readonly LinhaErro[];
  novas: number;
  atualizadas: number;
  inalteradas: number;
  /** Falha do lote inteiro (ex.: banco indisponível) — `falhou` mesmo sem erro por linha. */
  falhaProcessamento?: boolean;
  /**
   * T-0025: linhas que o Conector recusou localmente (detalhadas + omitidas). Contam como recebidas e com erro; os índices delas
   * (posição em `linhas_invalidas`) não se misturam com os de `erros`. Lote só com elas termina `concluido_com_erros`.
   */
  invalidas_conector?: number;
}

export interface ResultadoLote {
  status: Extract<EstadoLote, 'concluido' | 'concluido_com_erros' | 'falhou'>;
  contagens: ContagensLote;
}

/**
 * RN-INT-03: `concluido` (nenhuma linha com erro), `concluido_com_erros` (parte) ou `falhou`
 * (todas as linhas efetivas com erro ou falha de processamento). Duplicadas no lote ficam de fora.
 * Exceção (RN-INT-01, T-0025): lote que só traz linhas inválidas do Conector (nenhum registro a validar) é `concluido_com_erros`,
 * porque os erros já estão reportados e `falhou` sem erro do Hub faria o Conector bloquear a entidade.
 */
export function calcularResultadoLote(e: EntradaResultadoLote): ResultadoLote {
  const doConector = Math.max(0, e.invalidas_conector ?? 0);
  const linhasComErroHub = new Set(e.erros.map((x) => x.indice)).size;
  const linhasComErro = linhasComErroHub + doConector;
  const recebidas = e.recebidas + doConector;
  const efetivasHub = e.recebidas - e.duplicadas_no_lote;
  let status: ResultadoLote['status'];
  if (e.falhaProcessamento) status = 'falhou';
  else if (linhasComErro === 0) status = 'concluido';
  else if (efetivasHub === 0 && doConector > 0) status = 'concluido_com_erros';
  else if (linhasComErro >= efetivasHub + doConector) status = 'falhou';
  else status = 'concluido_com_erros';
  return {
    status,
    contagens: {
      recebidas,
      duplicadas_no_lote: e.duplicadas_no_lote,
      com_erro: linhasComErro,
      novas: e.novas,
      atualizadas: e.atualizadas,
      inalteradas: e.inalteradas,
    },
  };
}
