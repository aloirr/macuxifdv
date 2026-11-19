/**
 * Documentação do Cliente 360 v2 (T-0186; decisões P5, P10, P11, P12, P15 e P16 de 19/11/2026). Funções puras, sem banco.
 * - A permissão é por TIPO e por PERFIL: "Não vê", "Vê" e "Vê e envia" ("Vê e envia" só nos tipos que o app captura, como Fotos do PDV).
 * - Administrador e Analista veem tudo. O tipo que o perfil não vê não aparece (P10).
 * - A exceção por documento só tira acesso do que o tipo libera (P11): a linha aparece com cadeado, "Sem permissão para abrir".
 * - O documento é só para ver (P15): a API devolve o arquivo do servidor; nada fica no aparelho. A API revalida tudo.
 */
import { diffDays } from '@macuxi/comum';
import { perfilRecebeHistoricoDeCompra } from './promotor-pedidos';

export type NivelDocumento = 'nao_ve' | 've' | 've_e_envia';
export type AcessoDocumento = 'oculto' | 'bloqueado' | 'abrir';

/** Perfis que veem tudo e não se configuram na matriz (spec §7). */
export const PERFIS_DOCUMENTO_VEEM_TUDO = ['admin', 'analista'] as const;
const veTudo = (perfil: string): boolean => (PERFIS_DOCUMENTO_VEEM_TUDO as readonly string[]).includes(perfil);

export interface TipoDocumento {
  id: string;
  nome: string;
  grupo: string;
  ordem: number;
  /** O app captura este tipo (Fotos do PDV): só ele aceita "Vê e envia". */
  permite_envio: boolean;
  ativo: boolean;
}

export interface DocumentoLinha {
  id: string;
  tipo_id: string;
  nome: string;
  formato: string | null;
  data: string;
  /** AAAA-MM-DD; nulo = não vence. */
  validade: string | null;
}

export interface PermissaoTipoDocumento {
  tipo_id: string;
  perfil: string;
  nivel: NivelDocumento;
}
export interface ExcecaoDocumento {
  documento_id: string;
  perfil: string;
}

/** Nível do perfil no tipo. Admin e analista: sempre o máximo do tipo; sem linha na matriz = "Não vê". */
export function nivelDoTipo(matriz: readonly PermissaoTipoDocumento[], tipo: Pick<TipoDocumento, 'id' | 'permite_envio'>, perfil: string): NivelDocumento {
  if (veTudo(perfil)) return tipo.permite_envio ? 've_e_envia' : 've';
  const n = matriz.find((m) => m.tipo_id === tipo.id && m.perfil === perfil)?.nivel ?? 'nao_ve';
  return n === 've_e_envia' && !tipo.permite_envio ? 've' : n;
}

const ORDEM_NIVEL: Record<NivelDocumento, number> = { nao_ve: 0, ve: 1, ve_e_envia: 2 };

/**
 * Nível do USUÁRIO no tipo: o maior entre os perfis dele (basta um perfil ver; basta um enviar). `perfis` são os CÓDIGOS
 * (`plataforma.perfil.codigo`), os mesmos que a matriz guarda, inclusive de perfil personalizado. Sem perfil = "Não vê".
 */
export function nivelDoUsuario(matriz: readonly PermissaoTipoDocumento[], tipo: Pick<TipoDocumento, 'id' | 'permite_envio'>, perfis: readonly string[]): NivelDocumento {
  return perfis.map((p) => nivelDoTipo(matriz, tipo, p)).reduce<NivelDocumento>((a, n) => (ORDEM_NIVEL[n] > ORDEM_NIVEL[a] ? n : a), 'nao_ve');
}

/** P11: a exceção do documento que pega QUALQUER perfil do usuário tira o acesso. Admin/analista (qualquer um dos perfis) não sofrem exceção. */
export function excecaoTiraAcesso(excecoes: readonly ExcecaoDocumento[], documentoId: string, perfis: readonly string[]): boolean {
  if (perfis.some(veTudo)) return false;
  return excecoes.some((e) => e.documento_id === documentoId && perfis.includes(e.perfil));
}

/** P10/P11: tipo "Não vê" = oculto; exceção por documento = bloqueado (cadeado); senão abre. */
export function acessoAoDocumento(nivelDoTipoNoPerfil: NivelDocumento, comExcecao: boolean): AcessoDocumento {
  if (nivelDoTipoNoPerfil === 'nao_ve') return 'oculto';
  return comExcecao ? 'bloqueado' : 'abrir';
}

export type SituacaoValidade = 'sem_validade' | 'valido' | 'vencido';
/** P16: o vencimento aparece só na linha do documento. Vence hoje ainda vale. */
export function situacaoValidadeDocumento(validade: string | null, hoje: string): SituacaoValidade {
  if (!validade) return 'sem_validade';
  return diffDays(validade, hoje) > 0 ? 'vencido' : 'valido';
}

export interface DocumentoDaFicha extends DocumentoLinha {
  grupo: string;
  acesso: Exclude<AcessoDocumento, 'oculto'>;
  validade_situacao: SituacaoValidade;
  /** O app captura este tipo e o perfil pode enviar (câmera na foto que falta). */
  pode_enviar: boolean;
}

/** Lista da aba Documentação para os perfis do usuário: só tipos ativos que ele vê, por grupo e ordem do cadastro de tipos, depois por data (mais nova primeiro). */
export function documentosDaFicha(
  perfis: readonly string[],
  tipos: readonly TipoDocumento[],
  documentos: readonly DocumentoLinha[],
  matriz: readonly PermissaoTipoDocumento[],
  excecoes: readonly ExcecaoDocumento[],
  hoje: string,
): DocumentoDaFicha[] {
  const porTipo = new Map(tipos.filter((t) => t.ativo).map((t) => [t.id, t]));
  const saida: Array<DocumentoDaFicha & { _ordem: number }> = [];
  for (const d of documentos) {
    const t = porTipo.get(d.tipo_id);
    if (!t) continue;
    const nivel = nivelDoUsuario(matriz, t, perfis);
    const comExcecao = excecaoTiraAcesso(excecoes, d.id, perfis);
    const acesso = acessoAoDocumento(nivel, comExcecao);
    if (acesso === 'oculto') continue;
    saida.push({ ...d, grupo: t.grupo, acesso, validade_situacao: situacaoValidadeDocumento(d.validade, hoje), pode_enviar: nivel === 've_e_envia', _ordem: t.ordem });
  }
  return saida.sort((a, b) => a._ordem - b._ordem || a.grupo.localeCompare(b.grupo) || b.data.localeCompare(a.data) || a.id.localeCompare(b.id)).map(({ _ordem, ...d }) => d);
}

export type CodigoErroMatrizDocumento = 'DOCUMENTO_NIVEL_INVALIDO' | 'DOCUMENTO_TIPO_DESCONHECIDO' | 'DOCUMENTO_PERFIL_FIXO';

/** Valida a matriz que o admin grava em BKO › Parâmetros › Documentos. */
export function validarMatrizDocumentos(
  tipos: readonly Pick<TipoDocumento, 'id' | 'nome' | 'permite_envio'>[],
  linhas: readonly PermissaoTipoDocumento[],
): { ok: true } | { ok: false; codigo: CodigoErroMatrizDocumento; mensagem: string } {
  for (const l of linhas) {
    const t = tipos.find((x) => x.id === l.tipo_id);
    if (!t) return { ok: false, codigo: 'DOCUMENTO_TIPO_DESCONHECIDO', mensagem: 'Tipo de documento não encontrado. Atualize a página e tente de novo.' };
    if (veTudo(l.perfil)) return { ok: false, codigo: 'DOCUMENTO_PERFIL_FIXO', mensagem: 'Administrador e Analista veem todos os documentos. Tire esse perfil da lista e salve de novo.' };
    if (l.nivel === 've_e_envia' && !t.permite_envio) return { ok: false, codigo: 'DOCUMENTO_NIVEL_INVALIDO', mensagem: `O tipo ${t.nome} não é enviado pelo app. Escolha "Vê" ou "Não vê".` };
  }
  return { ok: true };
}

export type AbaFicha = 'resumo' | 'historico' | 'documentacao';

/** P12: promotor sem `promotor_ve_pedidos` não vê o Histórico (nem o cartão de crédito do Resumo); fica com Resumo e Documentação. */
export function abasDaFicha(perfil: string, promotorVePedidos: boolean): AbaFicha[] {
  return perfilRecebeHistoricoDeCompra(perfil, promotorVePedidos) ? ['resumo', 'historico', 'documentacao'] : ['resumo', 'documentacao'];
}
