/**
 * Equipe do Gestor (RF-GES-01) e escopo por perfil (RN-CORE-04): árvore gerente → supervisor → vendedor/promotor,
 * montada a partir do cadastro de usuários do Core (`superior_id`). Funções puras; a API aplica o escopo em TODA consulta.
 */
import { perfilUsaApp } from '@macuxi/platform-sdk';
import type { MembroEquipe, PainelDia, ResumoEquipe } from '../contracts';
import { compararTexto, percentual } from './numeros';

export interface NoEquipe {
  membro: MembroEquipe;
  filhos: NoEquipe[];
}

/** Raízes da hierarquia (sem superior, ou com superior que não existe no cadastro), irmãos em ordem de nome. Ciclo = erro. */
export function construirArvore(membros: readonly MembroEquipe[]): NoEquipe[] {
  const nos = new Map<string, NoEquipe>(membros.map((mb) => [mb.id, { membro: mb, filhos: [] }]));
  const raizes: NoEquipe[] = [];
  for (const no of nos.values()) {
    const pai = no.membro.superior_id ? nos.get(no.membro.superior_id) : undefined;
    if (pai && pai !== no) pai.filhos.push(no);
    else raizes.push(no);
  }
  const ordenar = (xs: NoEquipe[]) => xs.sort((a, b) => compararTexto(a.membro.nome, b.membro.nome) || compararTexto(a.membro.id, b.membro.id));
  // ciclo: nenhum nó do ciclo é raiz, então sobram nós inalcançáveis a partir das raízes
  const vistos = new Set<string>();
  const percorrer = (xs: NoEquipe[]) => {
    ordenar(xs);
    for (const n of xs) {
      vistos.add(n.membro.id);
      percorrer(n.filhos);
    }
  };
  percorrer(raizes);
  if (vistos.size !== nos.size) throw new RangeError('A hierarquia da equipe tem um ciclo (alguém é superior de quem o chefia). Corrija o cadastro de superiores.');
  return raizes;
}

/** Subordinados diretos e indiretos de `id` (sem ele), em ordem de árvore. */
export function subordinadosDe(membros: readonly MembroEquipe[], id: string): MembroEquipe[] {
  const alvo = encontrar(construirArvore(membros), id);
  const out: MembroEquipe[] = [];
  const descer = (n: NoEquipe) => {
    for (const f of n.filhos) {
      out.push(f.membro);
      descer(f);
    }
  };
  if (alvo) descer(alvo);
  return out;
}

function encontrar(nos: NoEquipe[], id: string): NoEquipe | null {
  for (const n of nos) {
    if (n.membro.id === id) return n;
    const d = encontrar(n.filhos, id);
    if (d) return d;
  }
  return null;
}

/**
 * RN-GES-05: o check-in de `usuarioId` conta como visita de campo? Não, se o cadastro o mostra como supervisor ou gerente.
 * Usuário fora do cadastro conta (cadastro defasado não esconde visita).
 */
export function visitaContaParaCampo(membros: readonly MembroEquipe[], usuarioId: string): boolean {
  const m = membros.find((x) => x.id === usuarioId);
  return !m || perfilUsaApp(m.perfil, 'campo');
}

export type EscopoGestor = { tipo: 'equipe'; ids: ReadonlySet<string> } | { tipo: 'tenant' } | { tipo: 'nenhum' };

/**
 * RN-CORE-04: supervisor vê a equipe; gerente vê as equipes abaixo (ambos = subordinados diretos e indiretos, sem si);
 * analista e admin veem o tenant (leitura); vendedor, promotor e assistente não têm painel de equipe. Usuário gestor
 * que não consta no cadastro recebe escopo VAZIO (nunca o tenant inteiro).
 */
export function escopoDoUsuario(usuario: { id: string; perfil: MembroEquipe['perfil'] }, membros: readonly MembroEquipe[]): EscopoGestor {
  switch (usuario.perfil) {
    case 'supervisor':
    case 'gerente':
      return { tipo: 'equipe', ids: new Set(subordinadosDe(membros, usuario.id).map((x) => x.id)) };
    case 'analista':
    case 'admin':
      return { tipo: 'tenant' };
    default:
      return { tipo: 'nenhum' };
  }
}

export function podeVer(escopo: EscopoGestor, alvoId: string): boolean {
  if (escopo.tipo === 'tenant') return true;
  if (escopo.tipo === 'nenhum') return false;
  return escopo.ids.has(alvoId);
}

export function filtrarPorEscopo<T>(escopo: EscopoGestor, itens: readonly T[], idDe: (item: T) => string): T[] {
  return itens.filter((i) => podeVer(escopo, idDe(i)));
}

const soma = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

/**
 * Resumo do dia de tudo que está abaixo de `gestorId` (só vendedores e promotores ativos). Quem não tem linha de
 * painel no dia conta como "sem check-in". Seções nulas (módulo desativado) não viram zero: o total fica `null`.
 * Cobertura (RN-GES-05) = Σ clientes da rota visitados ÷ Σ planejados, no máximo 100%; extras à parte.
 */
export function resumirEquipe(gestorId: string, membros: readonly MembroEquipe[], paineis: readonly PainelDia[]): ResumoEquipe {
  const campo = subordinadosDe(membros, gestorId).filter((x) => x.ativo && (x.perfil === 'vendedor' || x.perfil === 'promotor'));
  const porUsuario = new Map(paineis.map((p) => [p.usuario_id, p]));
  const linhas = campo.map((x) => porUsuario.get(x.id) ?? null);
  const status = (s: PainelDia['status_dia']) => linhas.filter((l) => (l?.status_dia ?? 'sem_checkin') === s).length;
  const comVendas = linhas.filter((l): l is PainelDia & { vendas: NonNullable<PainelDia['vendas']> } => !!l?.vendas);
  const comMeta = linhas.filter((l) => l?.mes?.meta_cents != null && l.mes.meta_cents > 0);
  const meta = soma(comMeta.map((l) => l!.mes!.meta_cents!));
  const planejadas = soma(linhas.map((l) => l?.visitas.planejadas ?? 0));
  const realizadas = soma(linhas.map((l) => l?.visitas.realizadas ?? 0));
  // RN-GES-05: a cobertura usa só os clientes DA ROTA visitados; as visitas fora da rota somam à parte
  const daRota = soma(linhas.map((l) => l?.visitas.planejadas_realizadas ?? 0));
  const comExtras = linhas.filter((l) => l?.visitas.visitas_extras != null);
  const cobertura = percentual(daRota, planejadas);
  // RN-GES-06: vendido × faturado só de quem tem a seção (Vendedor ativo)
  const comFat = linhas.filter((l): l is PainelDia & { faturamento: NonNullable<PainelDia['faturamento']> } => !!l?.faturamento);
  return {
    gestor_id: gestorId,
    membros: campo.length,
    sem_checkin: status('sem_checkin'),
    em_rota: status('em_rota'),
    em_visita: status('em_visita'),
    vendas_cents: comVendas.length > 0 ? soma(comVendas.map((l) => l.vendas.vendas_cents)) : null,
    pedidos: comVendas.length > 0 ? soma(comVendas.map((l) => l.vendas.pedidos)) : null,
    meta_cents: comMeta.length > 0 ? meta : null,
    atingimento_pct: comMeta.length > 0 ? percentual(soma(comMeta.map((l) => l!.mes!.vendas_cents)), meta) : null,
    visitas_realizadas: realizadas,
    visitas_planejadas: planejadas,
    visitas_planejadas_realizadas: daRota,
    visitas_extras: comExtras.length > 0 ? soma(comExtras.map((l) => l!.visitas.visitas_extras!)) : null,
    cobertura_pct: cobertura === null ? null : Math.min(100, cobertura),
    vendido_cents: comFat.length > 0 ? soma(comFat.map((l) => l.faturamento.vendido_cents)) : null,
    faturado_cents: comFat.length > 0 ? soma(comFat.map((l) => l.faturamento.faturado_cents)) : null,
    a_faturar_cents: comFat.length > 0 ? soma(comFat.map((l) => l.faturamento.a_faturar_cents)) : null,
  };
}

/** Um resumo por subordinado DIRETO que também lidera gente (ex.: cada supervisor de um gerente). */
export function equipesAbaixo(gestorId: string, membros: readonly MembroEquipe[], paineis: readonly PainelDia[]): ResumoEquipe[] {
  const no = encontrar(construirArvore(membros), gestorId);
  if (!no) return [];
  return no.filhos.filter((f) => f.filhos.length > 0).map((f) => resumirEquipe(f.membro.id, membros, paineis));
}
