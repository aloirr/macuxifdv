/**
 * Trilhas, módulos e lições: progresso, pré-requisitos, público-alvo e trilhas obrigatórias pendentes
 * (RF-TRE-01, RF-TRE-02). Funções puras: recebem a estrutura da trilha e o conjunto de lições concluídas.
 */
import { diffDays } from '@macuxi/comum';
import { percentual } from './numeros';

export interface LicaoDef {
  id: string;
  ordem: number;
  /** Lições que precisam estar concluídas antes (além da anterior, em trilha sequencial). */
  pre_requisitos?: readonly string[];
  /** Quiz que precisa ser aprovado para concluir a lição (RN-TRE-02). */
  quiz_id?: string | null;
  /** Duração estimada da lição, em segundos (opcional): base do tempo mínimo proporcional (RN-TRE-04). */
  duracao_estimada_seg?: number | null;
}

export interface ModuloDef {
  id: string;
  ordem: number;
  /** Módulos que precisam estar concluídos antes (além do anterior, em trilha sequencial). */
  pre_requisitos?: readonly string[];
  licoes: readonly LicaoDef[];
}

/** Público-alvo (RF-TRE-01). Lista vazia = sem restrição naquele critério; os dois vazios = todo o tenant. */
export interface PublicoAlvo {
  perfis: readonly string[];
  equipes: readonly string[];
}

export type StatusTrilha = 'rascunho' | 'publicada' | 'arquivada';

export interface TrilhaDef {
  id: string;
  status: StatusTrilha;
  obrigatoria: boolean;
  /** true (padrão da UI): cada lição exige a anterior e cada módulo exige o módulo anterior. */
  sequencial: boolean;
  /** Prazo para concluir (data civil no fuso do tenant). */
  prazo: string | null;
  publico_alvo: PublicoAlvo;
  modulos: readonly ModuloDef[];
}

export interface UsuarioPublico {
  perfil: string;
  equipe_id: string | null;
}

type Concluidas = ReadonlySet<string> | readonly string[];
const comoConjunto = (c: Concluidas): ReadonlySet<string> => (c instanceof Set ? c : new Set(c));

/** Lições na ordem módulo → lição. */
export function licoesOrdenadas(trilha: TrilhaDef): (LicaoDef & { modulo_id: string })[] {
  return [...trilha.modulos]
    .sort((a, b) => a.ordem - b.ordem)
    .flatMap((m) => [...m.licoes].sort((a, b) => a.ordem - b.ordem).map((l) => ({ ...l, modulo_id: m.id })));
}

function modulosOrdenados(trilha: TrilhaDef): ModuloDef[] {
  return [...trilha.modulos].sort((a, b) => a.ordem - b.ordem);
}

export interface ProgressoModulo {
  modulo_id: string;
  concluidas: number;
  total: number;
  concluido: boolean;
}

export interface ProgressoTrilha {
  concluidas: number;
  total: number;
  /** % de lições concluídas, 2 casas; trilha sem lições = 0. */
  pct: number;
  concluida: boolean;
  modulos: ProgressoModulo[];
}

/** RF-TRE-02: lições concluídas ÷ total. Só contam lições que pertencem à trilha. */
export function progressoDaTrilha(trilha: TrilhaDef, concluidas: Concluidas): ProgressoTrilha {
  const feitas = comoConjunto(concluidas);
  const modulos = modulosOrdenados(trilha).map((m) => {
    const n = m.licoes.filter((l) => feitas.has(l.id)).length;
    return { modulo_id: m.id, concluidas: n, total: m.licoes.length, concluido: m.licoes.length > 0 && n === m.licoes.length };
  });
  const total = modulos.reduce((s, m) => s + m.total, 0);
  const n = modulos.reduce((s, m) => s + m.concluidas, 0);
  return { concluidas: n, total, pct: percentual(n, total) ?? 0, concluida: total > 0 && n === total, modulos };
}

export function trilhaConcluida(trilha: TrilhaDef, concluidas: Concluidas): boolean {
  return progressoDaTrilha(trilha, concluidas).concluida;
}

/** Módulos exigidos por um módulo: os explícitos mais o anterior (em trilha sequencial). */
function modulosExigidos(trilha: TrilhaDef, moduloId: string): string[] {
  const ordenados = modulosOrdenados(trilha);
  const i = ordenados.findIndex((m) => m.id === moduloId);
  if (i < 0) throw new RangeError(`O módulo ${moduloId} não existe nesta trilha.`);
  const out = new Set<string>(ordenados[i]!.pre_requisitos ?? []);
  if (trilha.sequencial && i > 0) out.add(ordenados[i - 1]!.id);
  return [...out];
}

/** Ids das lições que precisam estar concluídas para liberar a lição (lições e módulos exigidos, já expandidos). */
export function requisitosDaLicao(trilha: TrilhaDef, licaoId: string): string[] {
  const todas = licoesOrdenadas(trilha);
  const lic = todas.find((l) => l.id === licaoId);
  if (!lic) throw new RangeError(`A lição ${licaoId} não existe nesta trilha.`);
  const out = new Set<string>(lic.pre_requisitos ?? []);
  if (trilha.sequencial) {
    const doModulo = todas.filter((l) => l.modulo_id === lic.modulo_id);
    const i = doModulo.findIndex((l) => l.id === licaoId);
    if (i > 0) out.add(doModulo[i - 1]!.id);
  }
  for (const mid of modulosExigidos(trilha, lic.modulo_id)) {
    for (const l of trilha.modulos.find((m) => m.id === mid)?.licoes ?? []) out.add(l.id);
  }
  return [...out];
}

export interface StatusLicao {
  status: 'concluida' | 'liberada' | 'bloqueada';
  /** Lições ainda não concluídas que seguram esta (vazio se liberada/concluída). */
  pendentes: string[];
}

/** RF-TRE-01: lição bloqueada até concluir os pré-requisitos (lição anterior, módulo anterior, explícitos). */
export function statusDaLicao(trilha: TrilhaDef, licaoId: string, concluidas: Concluidas): StatusLicao {
  const feitas = comoConjunto(concluidas);
  const pendentes = requisitosDaLicao(trilha, licaoId).filter((id) => !feitas.has(id));
  if (feitas.has(licaoId)) return { status: 'concluida', pendentes: [] };
  return { status: pendentes.length === 0 ? 'liberada' : 'bloqueada', pendentes };
}

export interface StatusModulo {
  status: 'concluido' | 'liberado' | 'bloqueado';
  /** Módulos exigidos que ainda não foram concluídos. */
  pendentes: string[];
}

/** RF-TRE-01: módulo bloqueado até concluir todas as lições dos módulos exigidos. */
export function statusDoModulo(trilha: TrilhaDef, moduloId: string, concluidas: Concluidas): StatusModulo {
  const feitas = comoConjunto(concluidas);
  const completo = (m: ModuloDef | undefined) => !!m && m.licoes.every((l) => feitas.has(l.id));
  const pendentes = modulosExigidos(trilha, moduloId).filter((id) => !completo(trilha.modulos.find((m) => m.id === id)));
  const modulo = trilha.modulos.find((m) => m.id === moduloId)!;
  if (modulo.licoes.length > 0 && completo(modulo)) return { status: 'concluido', pendentes: [] };
  return { status: pendentes.length === 0 ? 'liberado' : 'bloqueado', pendentes };
}

/** RF-TRE-02: "retomar de onde parou" — primeira lição liberada e ainda não concluída; null se não há. */
export function proximaLicao(trilha: TrilhaDef, concluidas: Concluidas): string | null {
  const feitas = comoConjunto(concluidas);
  for (const l of licoesOrdenadas(trilha)) {
    if (!feitas.has(l.id) && statusDaLicao(trilha, l.id, feitas).status === 'liberada') return l.id;
  }
  return null;
}

/** Problemas da estrutura que impedem publicar a trilha (ids repetidos, pré-requisito inexistente, ciclo). */
export function validarTrilha(trilha: TrilhaDef): string[] {
  const erros: string[] = [];
  const lic = licoesOrdenadas(trilha);
  const idsL = new Set<string>();
  for (const l of lic) {
    if (idsL.has(l.id)) erros.push(`A lição ${l.id} está repetida na trilha.`);
    idsL.add(l.id);
  }
  const idsM = new Set<string>();
  for (const m of trilha.modulos) {
    if (idsM.has(m.id)) erros.push(`O módulo ${m.id} está repetido na trilha.`);
    idsM.add(m.id);
  }
  for (const m of trilha.modulos) {
    for (const p of m.pre_requisitos ?? []) if (!idsM.has(p)) erros.push(`O módulo ${m.id} exige o módulo ${p}, que não existe na trilha.`);
  }
  for (const l of lic) {
    for (const p of l.pre_requisitos ?? []) if (!idsL.has(p)) erros.push(`A lição ${l.id} exige a lição ${p}, que não existe na trilha.`);
  }
  if (erros.length > 0) return erros;
  // Ciclo: a lição precisaria de si mesma, direta ou indiretamente.
  const reqs = new Map(lic.map((l) => [l.id, requisitosDaLicao(trilha, l.id)]));
  const estado = new Map<string, 1 | 2>();
  const visita = (id: string): boolean => {
    if (estado.get(id) === 2) return false;
    if (estado.get(id) === 1) return true;
    estado.set(id, 1);
    for (const p of reqs.get(id) ?? []) if (visita(p)) return true;
    estado.set(id, 2);
    return false;
  };
  if (lic.some((l) => visita(l.id))) erros.push('Os pré-requisitos formam um ciclo: alguma lição nunca seria liberada.');
  return erros;
}

/** RF-TRE-01: o usuário está no público-alvo? Critérios preenchidos valem juntos (E); vazio = sem restrição. */
export function usuarioNoPublico(publico: PublicoAlvo, usuario: UsuarioPublico): boolean {
  const perfilOk = publico.perfis.length === 0 || publico.perfis.includes(usuario.perfil);
  const equipeOk = publico.equipes.length === 0 || (usuario.equipe_id !== null && publico.equipes.includes(usuario.equipe_id));
  return perfilOk && equipeOk;
}

/** Trilhas que o usuário enxerga: publicadas e dentro do público-alvo. */
export function trilhasDisponiveis(trilhas: readonly TrilhaDef[], usuario: UsuarioPublico): TrilhaDef[] {
  return trilhas.filter((t) => t.status === 'publicada' && usuarioNoPublico(t.publico_alvo, usuario));
}

export interface TrilhaPendente {
  trilha_id: string;
  prazo: string | null;
  /** hoje > prazo. */
  atrasada: boolean;
  /** Prazo − hoje em dias civis (negativo = vencido); null sem prazo. */
  dias_para_prazo: number | null;
  progresso_pct: number;
}

/**
 * RF-TRE-01: trilhas obrigatórias do público do usuário ainda não concluídas, mais urgentes primeiro
 * (prazo crescente, sem prazo por último, desempate por id). `hoje` = data civil no fuso do tenant.
 */
export function trilhasPendentes(trilhas: readonly TrilhaDef[], usuario: UsuarioPublico, concluidas: Concluidas, hoje: string): TrilhaPendente[] {
  const feitas = comoConjunto(concluidas);
  return trilhasDisponiveis(trilhas, usuario)
    .filter((t) => t.obrigatoria && !trilhaConcluida(t, feitas))
    .map((t) => {
      const dias = t.prazo ? diffDays(hoje, t.prazo) : null;
      return { trilha_id: t.id, prazo: t.prazo, atrasada: dias !== null && dias < 0, dias_para_prazo: dias, progresso_pct: progressoDaTrilha(t, feitas).pct };
    })
    .sort((a, b) => {
      if (a.prazo !== b.prazo) return a.prazo === null ? 1 : b.prazo === null ? -1 : a.prazo < b.prazo ? -1 : 1;
      return a.trilha_id < b.trilha_id ? -1 : a.trilha_id > b.trilha_id ? 1 : 0;
    });
}
