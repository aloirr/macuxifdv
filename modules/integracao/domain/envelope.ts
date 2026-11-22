/**
 * Validação do envelope do lote (RN-INT-01): o cabeçalho é conferido antes de qualquer linha.
 * Qualquer problema recusa o lote inteiro; as linhas só são validadas depois (RN-INT-03).
 */
import { Entidade, LoteEnvelope, type ErroEnvelope, type LoteEnvelopeValido } from '../contracts';
import { descreverIssue } from './erros';
import { PARAMETROS_PADRAO } from './parametros';
import { erroEntidadeDeOutroConector } from './topologia';
import { validarVersaoContrato } from './versao';

export interface OpcoesEnvelope {
  limiteRegistros?: number;
  versoesSuportadas?: readonly string[];
  /** P-6 (T-0027): entidades do Conector autenticado; omitido = não confere (testes). */
  entidadesDoConector?: readonly Entidade[];
}

export type ResultadoEnvelope = { ok: true; envelope: LoteEnvelopeValido } | { ok: false; erros: ErroEnvelope[] };

export function validarEnvelope(entrada: unknown, opcoes: OpcoesEnvelope = {}): ResultadoEnvelope {
  const limite = opcoes.limiteRegistros ?? PARAMETROS_PADRAO.limiteRegistrosLote;
  const suportadas = opcoes.versoesSuportadas ?? PARAMETROS_PADRAO.versoesSuportadas;
  const erros: ErroEnvelope[] = [];

  const base = LoteEnvelope.safeParse(entrada);
  if (!base.success) {
    for (const issue of base.error.issues) {
      const d = descreverIssue(issue);
      erros.push({ codigo: 'envelope_invalido', campo: d.campo, mensagem: d.mensagem });
    }
    return { ok: false, erros };
  }
  const env = base.data;

  const versao = validarVersaoContrato(env.versao_contrato, { suportadas });
  if (!versao.ok) erros.push({ codigo: 'versao_nao_suportada', campo: 'versao_contrato', mensagem: versao.mensagem });

  const entidade = Entidade.safeParse(env.entidade);
  if (!entidade.success) {
    erros.push({ codigo: 'entidade_desconhecida', campo: 'entidade', mensagem: `Entidade desconhecida. Use uma de: ${Entidade.options.join(', ')}.` });
  } else if (opcoes.entidadesDoConector) {
    const outro = erroEntidadeDeOutroConector(entidade.data, opcoes.entidadesDoConector);
    if (outro) erros.push(outro);
  }

  // Exceção da RN-INT-01 (T-0025): lote sem registros mas com linhas inválidas do Conector é aceito — os erros precisam chegar ao BKO.
  const trazInvalidas = (env.linhas_invalidas?.length ?? 0) > 0 || (env.linhas_invalidas_omitidas ?? 0) > 0;
  if (env.registros.length === 0 && !trazInvalidas) {
    erros.push({ codigo: 'lote_vazio', campo: 'registros', mensagem: 'O lote não tem registros. Envie ao menos um registro.' });
  } else if (env.registros.length > limite) {
    erros.push({ codigo: 'acima_do_limite', campo: 'registros', mensagem: `O lote tem ${env.registros.length} registros e o limite é ${limite}. Divida em lotes menores (na carga completa, use partes da mesma sessão).` });
  }

  if (env.modo === 'completo' && !env.sessao) {
    erros.push({ codigo: 'sessao_ausente', campo: 'sessao', mensagem: 'A carga completa exige "sessao" (id, parte e ultimo).' });
  }
  if (env.modo === 'delta' && env.sessao) {
    erros.push({ codigo: 'sessao_nao_se_aplica', campo: 'sessao', mensagem: 'Lote delta não usa "sessao". Remova o campo ou use o modo completo.' });
  }

  if (erros.length > 0 || !entidade.success) return { ok: false, erros };
  return { ok: true, envelope: { ...env, entidade: entidade.data } };
}
