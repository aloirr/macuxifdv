/**
 * Credencial do Conector (RN-INT-10, proposta T-0025; decisão do Alexandre de 2026-10-31): UMA chave de API por Conector,
 * escopo só `integracao.v1`, guardada só como hash, rotacionável sem interrupção (a chave anterior vale por uma janela de
 * convivência) e revogável no BKO.
 *
 * O domain não toca no segredo: a API calcula o hash da chave apresentada, busca a linha em `integracao.credencial` e passa o
 * que achou para `avaliarChaveConector`. A recusa pública é genérica (não revela se a chave existe, foi revogada ou é de outro
 * Conector); o motivo exato só vai para o log e para o monitor.
 */
import { ESCOPO_CHAVE_CONECTOR } from '../contracts';
import { PARAMETROS_PADRAO } from './parametros';

export interface ChaveArmazenada {
  /** Identificador (slug) do Conector dono da chave. */
  conector_id: string;
  conector_ativo: boolean;
  escopo: string;
  /** `atual` = a vigente; `anterior` = substituída por uma rotação, válida só até `anterior_valida_ate`. */
  papel: 'atual' | 'anterior';
  criada_em: string;
  expira_em: string | null;
  anterior_valida_ate: string | null;
  revogada_em: string | null;
}

export type MotivoRecusaChave =
  | 'chave_desconhecida'
  | 'conector_id_ausente'
  | 'conector_divergente'
  | 'revogada'
  | 'expirada'
  | 'fora_da_convivencia'
  | 'escopo_invalido'
  | 'conector_inativo'
  | 'ip_nao_permitido'
  | 'modulo_inativo';

export type ResultadoChave =
  | { ok: true; situacao: 'ativa' | 'em_convivencia'; valida_ate: string | null; aviso?: 'chave_anterior_em_uso' }
  | { ok: false; status: 401 | 403; codigo: 'credencial_invalida' | 'acesso_negado' | 'modulo_inativo'; motivo: MotivoRecusaChave; mensagem: string };

const MSG_401 = 'Credencial inválida. Confira o identificador do Conector e a chave de API; ela pode ter sido rotacionada ou revogada (peça uma nova no BKO e grave com "conector trocar-chave").';
const MSG_403 = 'Acesso negado para este Conector. Fale com o administrador do Macuxi no BKO (Integração ERP > Conectores).';

const nega401 = (motivo: MotivoRecusaChave): ResultadoChave => ({ ok: false, status: 401, codigo: 'credencial_invalida', motivo, mensagem: MSG_401 });
const nega403 = (motivo: MotivoRecusaChave): ResultadoChave => ({ ok: false, status: 403, codigo: 'acesso_negado', motivo, mensagem: MSG_403 });

export interface EntradaChave {
  /** Linha achada pelo hash da chave apresentada; `null` = nenhuma. */
  chave: ChaveArmazenada | null;
  /** Valor de `X-Macuxi-Conector-Id`. */
  conector_id_cabecalho: string | null | undefined;
  agora: string;
  /** Resultado da conferência da lista de IPs do Conector (a API usa `net.BlockList`); omitido = sem lista. */
  ipPermitido?: boolean;
  /** Licença do módulo no tenant da chave (RN-CORE-02); omitido = ativo. */
  moduloAtivo?: boolean;
}

/** Ordem: existência → identificador → revogação → validade/convivência (401 genérico) e depois escopo, Conector, IP e licença (403). */
export function avaliarChaveConector(e: EntradaChave): ResultadoChave {
  const c = e.chave;
  if (c === null) return nega401('chave_desconhecida');
  if (!e.conector_id_cabecalho) return nega401('conector_id_ausente');
  if (e.conector_id_cabecalho !== c.conector_id) return nega401('conector_divergente');
  const agora = Date.parse(e.agora);
  if (c.revogada_em !== null) return nega401('revogada');
  if (c.expira_em !== null && agora >= Date.parse(c.expira_em)) return nega401('expirada');
  let validaAte: string | null = c.expira_em;
  if (c.papel === 'anterior') {
    if (c.anterior_valida_ate === null || agora >= Date.parse(c.anterior_valida_ate)) return nega401('fora_da_convivencia');
    validaAte = c.anterior_valida_ate;
  }
  if (c.escopo !== ESCOPO_CHAVE_CONECTOR) return nega403('escopo_invalido');
  if (!c.conector_ativo) return nega403('conector_inativo');
  if (e.ipPermitido === false) return nega403('ip_nao_permitido');
  if (e.moduloAtivo === false) {
    return { ok: false, status: 403, codigo: 'modulo_inativo', motivo: 'modulo_inativo', mensagem: 'O módulo Integração ERP não está ativo para esta empresa. Fale com o administrador do Macuxi.' };
  }
  return c.papel === 'anterior'
    ? { ok: true, situacao: 'em_convivencia', valida_ate: validaAte, aviso: 'chave_anterior_em_uso' }
    : { ok: true, situacao: 'ativa', valida_ate: validaAte };
}

export interface ChaveRef {
  id: string;
  /** Prefixo não secreto (aparece no BKO e nos logs). */
  prefixo: string;
  criada_em: string;
  expira_em: string | null;
  revogada_em: string | null;
  anterior_valida_ate: string | null;
}

/** As chaves de um Conector: no máximo duas válidas ao mesmo tempo (a atual e a anterior em convivência). */
export interface ChavesDoConector {
  atual: ChaveRef | null;
  anterior: ChaveRef | null;
}

export type ResultadoRotacao =
  | { ok: true; chaves: ChavesDoConector; anterior_valida_ate: string | null; revogadas: string[] }
  | { ok: false; codigo: 'convivencia_invalida'; mensagem: string };

const somarMin = (iso: string, min: number) => new Date(Date.parse(iso) + min * 60_000).toISOString();

/**
 * RN-INT-10: a nova chave vira a atual; a atual vira anterior, válida até agora + convivência (padrão 24 h; 0 = revoga na hora;
 * máximo 7 dias). A anterior que já existia (rotação dentro da convivência) é revogada: nunca mais de duas válidas.
 */
export function rotacionarChaves(
  chaves: ChavesDoConector,
  nova: { id: string; prefixo: string },
  agora: string,
  opcoes: { convivenciaMin?: number; convivenciaMaxMin?: number; expiraEm?: string | null } = {},
): ResultadoRotacao {
  const conv = opcoes.convivenciaMin ?? PARAMETROS_PADRAO.convivenciaChaveMin;
  const max = opcoes.convivenciaMaxMin ?? PARAMETROS_PADRAO.convivenciaChaveMaxMin;
  if (!Number.isInteger(conv) || conv < 0 || conv > max) {
    return { ok: false, codigo: 'convivencia_invalida', mensagem: `A convivência da chave anterior deve ser um número inteiro de minutos entre 0 e ${max}.` };
  }
  const revogadas: string[] = [];
  if (chaves.anterior && chaves.anterior.revogada_em === null) revogadas.push(chaves.anterior.id);
  const novaRef: ChaveRef = { id: nova.id, prefixo: nova.prefixo, criada_em: agora, expira_em: opcoes.expiraEm ?? null, revogada_em: null, anterior_valida_ate: null };
  if (chaves.atual === null) return { ok: true, chaves: { atual: novaRef, anterior: null }, anterior_valida_ate: null, revogadas };
  const validaAte = somarMin(agora, conv);
  const jaRevogada = chaves.atual.revogada_em !== null;
  const anterior: ChaveRef = {
    ...chaves.atual,
    anterior_valida_ate: validaAte,
    revogada_em: chaves.atual.revogada_em ?? (conv === 0 ? agora : null),
  };
  if (conv === 0 && !jaRevogada) revogadas.push(chaves.atual.id);
  return { ok: true, chaves: { atual: novaRef, anterior }, anterior_valida_ate: conv === 0 ? null : validaAte, revogadas };
}

/** Revoga a atual, a anterior ou as duas; repetir mantém o instante original (idempotente). */
export function revogarChaves(chaves: ChavesDoConector, alvo: 'atual' | 'anterior' | 'todas', agora: string): ChavesDoConector {
  const revoga = (c: ChaveRef | null): ChaveRef | null => (c === null ? null : { ...c, revogada_em: c.revogada_em ?? agora });
  return {
    atual: alvo === 'atual' || alvo === 'todas' ? revoga(chaves.atual) : chaves.atual,
    anterior: alvo === 'anterior' || alvo === 'todas' ? revoga(chaves.anterior) : chaves.anterior,
  };
}
