/**
 * Quem pode definir a meta de quem (RN-CORE-20; T-0068). Função pura: o escopo de EDIÇÃO é mais estreito que o de
 * leitura. Decisão do doc 03 (linha "Criar/editar/copiar metas do mês", T-0068): supervisor = ele + a equipe que
 * responde; gerente = + equipes abaixo (RN-CORE-04); analista e admin = tenant inteiro; assistente só lê;
 * vendedor e promotor nunca editam.
 */
import type { Perfil } from '@macuxi/platform-sdk';
import { escopoDeUsuarios } from './clientes';
import type { IndicadorMeta } from './metas';

export type DecisaoEdicaoMeta = { ok: true } | { ok: false; codigo: 'META_FORA_DA_EQUIPE' | 'META_SEM_PERMISSAO'; mensagem: string };

export interface EntradaEdicaoMeta {
  perfil: Perfil;
  alvoId: string;
  editorId: string;
  /** Usuários da(s) equipe(s) que o editor responde. */
  equipe: ReadonlySet<string>;
  /** Usuários das equipes abaixo (gerente). */
  equipesAbaixo: ReadonlySet<string>;
}

export function podeEditarMetaDe(e: EntradaEdicaoMeta): DecisaoEdicaoMeta {
  if (e.perfil !== 'supervisor' && e.perfil !== 'gerente' && e.perfil !== 'analista' && e.perfil !== 'admin') {
    return { ok: false, codigo: 'META_SEM_PERMISSAO', mensagem: 'Seu perfil só consulta metas. Peça a um supervisor ou gerente para definir.' };
  }
  const escopo = escopoDeUsuarios(e.perfil, { proprio: e.editorId, equipe: e.equipe, equipesAbaixo: e.equipesAbaixo });
  if (escopo === 'tenant' || escopo.has(e.alvoId)) return { ok: true };
  return { ok: false, codigo: 'META_FORA_DA_EQUIPE', mensagem: 'Este usuário não está na sua equipe. Escolha alguém da sua equipe para definir a meta.' };
}

export interface MembroMeta {
  id: string;
  perfil: Perfil;
  ativo: boolean;
}

/** Alvos válidos de uma meta por equipe: usuários ativos de perfil vendedor ou promotor, sem repetição. */
export function expandirEquipe(membros: readonly MembroMeta[]): string[] {
  const vistos = new Set<string>();
  for (const m of membros) if (m.ativo && (m.perfil === 'vendedor' || m.perfil === 'promotor')) vistos.add(m.id);
  return [...vistos];
}

export interface MetaCopiavel {
  usuario_id: string;
  indicador: IndicadorMeta;
  valor: number;
  tipo: 'pedido' | 'faturamento';
}

/** Metas do mês anterior que entram no mês de destino: só as que ainda não existem lá (usuário + indicador) e com valor > 0. */
export function copiarMetas(anterior: readonly MetaCopiavel[], destino: readonly Pick<MetaCopiavel, 'usuario_id' | 'indicador'>[]): MetaCopiavel[] {
  const existentes = new Set(destino.map((d) => `${d.usuario_id}|${d.indicador}`));
  return anterior.filter((a) => a.valor > 0 && !existentes.has(`${a.usuario_id}|${a.indicador}`));
}
