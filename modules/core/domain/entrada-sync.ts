/**
 * RN-CORE-48 (T-0172): etapas nomeadas da carga na entrada do app. Função pura: recebe o que o motor de sync informa
 * (`EstadoMotorSync.carga`, `progresso`, `erro`) e devolve nome, número, total e percentual, por perfil e módulos efetivos.
 * A etapa 1 é sempre o envio do que ficou no aparelho; as demais agrupam as entidades puxadas.
 */
import type { EtapaEntrada, EtapaEntradaId, ParadaDiagnostico, ProgressoEntrada } from '../contracts/entrada-sync';

interface DefEtapa {
  id: EtapaEntradaId;
  nome: string;
  /** Aparece se o módulo estiver entre os efetivos; `undefined` = sempre (dados do Core). */
  modulo?: string;
}

const CAMPO: readonly DefEtapa[] = [
  { id: 'envio', nome: 'Envio do que ficou no aparelho' },
  { id: 'clientes_rota', nome: 'Clientes e rota' },
  { id: 'catalogo_precos', nome: 'Catálogo e preços', modulo: 'catalogo' },
  { id: 'pedidos_metas', nome: 'Pedidos e metas' },
  { id: 'fotos_materiais', nome: 'Fotos e materiais' },
];

const GESTAO: readonly DefEtapa[] = [
  { id: 'envio', nome: 'Envio do que ficou no aparelho' },
  { id: 'equipe', nome: 'Equipe' },
  { id: 'aprovacoes', nome: 'Aprovações', modulo: 'vendedor' },
  { id: 'metas', nome: 'Metas' },
  { id: 'alertas', nome: 'Alertas' },
];

const PERFIS_GESTAO: ReadonlySet<string> = new Set(['supervisor', 'gerente']);

/** Entidades/etapas do Core por etapa do Campo; fora daqui vale o módulo (`ETAPA_DO_MODULO_CAMPO`). */
const ENTIDADE_CAMPO: Record<string, EtapaEntradaId> = {
  meta: 'pedidos_metas',
  indicador_diario: 'pedidos_metas',
  parametro: 'pedidos_metas',
  notificacao: 'pedidos_metas',
  notificacao_leitura: 'pedidos_metas',
  produto: 'catalogo_precos',
  produto_unidade: 'catalogo_precos',
  medida: 'catalogo_precos',
  foto_tipo: 'fotos_materiais',
  cliente_foto: 'fotos_materiais',
  metas: 'pedidos_metas',
  'pedidos-da-visita': 'pedidos_metas',
  'core-inicio': 'pedidos_metas',
  'core-rv': 'pedidos_metas',
};
const ETAPA_DO_MODULO_CAMPO: Record<string, EtapaEntradaId> = {
  core: 'clientes_rota',
  catalogo: 'catalogo_precos',
  vendedor: 'pedidos_metas',
  promotor: 'fotos_materiais',
  pesquisa: 'fotos_materiais',
  treinamento: 'fotos_materiais',
  gestor: 'pedidos_metas',
};

const ENTIDADE_GESTAO: Record<string, EtapaEntradaId> = {
  meta: 'metas',
  indicador_diario: 'metas',
  parametro: 'metas',
  metas: 'metas',
  'core-inicio': 'metas',
  'core-rv': 'metas',
  notificacao: 'alertas',
  notificacao_leitura: 'alertas',
  alerta: 'alertas',
  alerta_ruptura: 'alertas',
  painel_vendedor_dia: 'equipe',
};
const ETAPA_DO_MODULO_GESTAO: Record<string, EtapaEntradaId> = {
  core: 'equipe',
  gestor: 'equipe',
  vendedor: 'aprovacoes',
  catalogo: 'aprovacoes',
  promotor: 'equipe',
  pesquisa: 'equipe',
  treinamento: 'equipe',
};

export interface CargaDoMotor {
  entidade: string | null;
  modulo: string | null;
  concluidas: number;
  total: number;
}

export interface EntradaProgresso {
  perfil: string | null | undefined;
  /** Módulos efetivos do usuário (RN-CORE-01). */
  modulos: readonly string[];
  carga: CargaDoMotor;
  /** `EstadoMotorSync.progresso`, 0..1 (conta as etapas puladas na retomada). */
  progresso: number;
  sincronizando: boolean;
  erro: string | null;
  /** Há `sincronizado_em`: carga completa gravada. */
  sincronizado: boolean;
}

const ehGestao = (perfil: string | null | undefined): boolean => Boolean(perfil && PERFIS_GESTAO.has(perfil));

/** RN-CORE-48: etapas do perfil, só dos módulos efetivos, numeradas a partir de 1. */
export function etapasDaEntrada(perfil: string | null | undefined, modulos: readonly string[]): { id: EtapaEntradaId; nome: string; numero: number }[] {
  const ativos = new Set(modulos);
  const base = ehGestao(perfil) ? GESTAO : CAMPO;
  return base.filter((e) => !e.modulo || ativos.has(e.modulo)).map((e, i) => ({ id: e.id, nome: e.nome, numero: i + 1 }));
}

/** Etapa da lista a que a entidade em curso pertence; se a etapa é de módulo inativo, cai na anterior que existe. */
export function etapaDaEntidade(perfil: string | null | undefined, modulos: readonly string[], carga: Pick<CargaDoMotor, 'entidade' | 'modulo'>): EtapaEntradaId {
  const lista = etapasDaEntrada(perfil, modulos);
  if (!carga.entidade) return 'envio';
  const gestao = ehGestao(perfil);
  const porEntidade = gestao ? ENTIDADE_GESTAO : ENTIDADE_CAMPO;
  const porModulo = gestao ? ETAPA_DO_MODULO_GESTAO : ETAPA_DO_MODULO_CAMPO;
  const alvo = porEntidade[carga.entidade] ?? (carga.modulo ? porModulo[carga.modulo] : undefined) ?? lista[1]?.id ?? 'envio';
  if (lista.some((e) => e.id === alvo)) return alvo;
  const base = gestao ? GESTAO : CAMPO;
  const pos = base.findIndex((e) => e.id === alvo);
  for (let i = pos - 1; i >= 0; i--) if (lista.some((e) => e.id === base[i]!.id)) return base[i]!.id;
  return 'envio';
}

/**
 * RN-CORE-48: o que a tela de entrada mostra. Percentual = progresso do motor sobre o total da carga (entidades e etapas
 * extras), no máximo 99 enquanto não termina e 100 com a carga pronta. As etapas anteriores à atual ficam feitas; com erro,
 * a atual vira `parou` e vai ao Diagnóstico (`paradaParaDiagnostico`).
 */
export function progressoDaEntrada(e: EntradaProgresso): ProgressoEntrada {
  const lista = etapasDaEntrada(e.perfil, e.modulos);
  const pronta = e.sincronizado && !e.sincronizando && !e.erro;
  const parou = Boolean(e.erro) && !e.sincronizando;
  const idAtual = etapaDaEntidade(e.perfil, e.modulos, e.carga);
  const posAtual = pronta ? lista.length - 1 : Math.max(0, lista.findIndex((x) => x.id === idAtual));
  const etapas: EtapaEntrada[] = lista.map((x, i) => ({
    ...x,
    situacao: pronta || i < posAtual ? 'feita' : i === posAtual ? (parou ? 'parou' : 'atual') : 'pendente',
  }));
  const pct = Math.round(Math.max(0, Math.min(1, e.progresso)) * 100);
  const percentual = pronta ? 100 : Math.min(99, pct);
  const atual = etapas[posAtual]!;
  return { etapas, atual, total: etapas.length, percentual, pronta, parou_em: parou ? atual : null };
}

/** RN-CORE-48: a etapa em que a carga parou, para o Diagnóstico; `null` se não parou. */
export function paradaParaDiagnostico(p: ProgressoEntrada): ParadaDiagnostico | null {
  return p.parou_em ? { numero: p.parou_em.numero, total: p.total, nome: p.parou_em.nome } : null;
}
