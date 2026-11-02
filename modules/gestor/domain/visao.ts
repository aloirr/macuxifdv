/**
 * Visões servidas pelas rotas e telas do Gestor (T-0055): escopo a partir dos usuários visíveis da plataforma
 * (RN-CORE-04), visão da equipe (RF-GES-01), ficha (RF-GES-02/05/10), alertas no escopo e dispensa (RF-GES-07) e
 * ajuste de regra de alerta (BKO). Funções puras: rodam na API, no app (offline, sobre o cache) e no BKO.
 */
import { PERFIS } from '@macuxi/platform-sdk';
import { AjusteRegraAlerta, type AjustesRegras, type Alerta, type FichaMembro, type MembroComPainel, type MembroEquipe, type StatusAlerta, type TipoAlerta, type VisaoEquipe } from '../contracts';
import { equipesAbaixo, podeVer, resumirEquipe, type EscopoGestor } from './equipe';
import { diaLocal, montarPainelDia } from './painel';
import { compararTexto } from './numeros';
import { disponibilidadePedidoEmNome } from './pedido-em-nome';
import { resolverParametros, type ParametrosGestor } from './parametros';
import type { EstadoProjecao } from './projecao';

type Perfil = MembroEquipe['perfil'];
export interface Viewer {
  id: string;
  perfil: Perfil;
}

const PERFIS_TENANT: ReadonlySet<Perfil> = new Set<Perfil>(['analista', 'admin']);
const PERFIS_EQUIPE: ReadonlySet<Perfil> = new Set<Perfil>(['supervisor', 'gerente']);
const DE_CAMPO: ReadonlySet<Perfil> = new Set<Perfil>(['vendedor', 'promotor']);

/**
 * RN-CORE-04 com a lista AUTORITATIVA da plataforma (`ctx.usuariosVisiveis()`, ADR 0009 §6): supervisor e gerente veem
 * os usuários visíveis menos eles mesmos; analista e admin veem o tenant (leitura, RN-GES-07). Falha fechada: perfil sem
 * painel de equipe, ou supervisor/gerente com "tenant" (incoerente), recebem escopo vazio.
 */
export function escopoDosVisiveis(usuario: Viewer, visiveis: ReadonlySet<string> | 'tenant'): EscopoGestor {
  if (PERFIS_TENANT.has(usuario.perfil)) return { tipo: 'tenant' };
  if (!PERFIS_EQUIPE.has(usuario.perfil) || visiveis === 'tenant') return { tipo: 'nenhum' };
  return { tipo: 'equipe', ids: new Set([...visiveis].filter((id) => id !== usuario.id)) };
}

/**
 * Equipe montada do cadastro resumido do Core (`core.cadastro_resumo@1`) enquanto a hierarquia completa não chega à API
 * por consulta: quem consulta fica no topo e os demais logo abaixo dele (o escopo já foi filtrado pela plataforma).
 * Perfil fora da lista da plataforma é descartado; o cadastro só devolve usuários não removidos (ativos).
 */
export function membrosDoCadastro(viewer: Viewer & { nome: string }, cadastro: readonly { id: string; nome: string; perfil: string }[]): MembroEquipe[] {
  const perfilValido = (p: string): p is Perfil => (PERFIS as readonly string[]).includes(p);
  const sob = PERFIS_EQUIPE.has(viewer.perfil) ? viewer.id : null;
  const outros = cadastro.filter((c) => c.id !== viewer.id && perfilValido(c.perfil) && c.nome.trim().length > 0);
  return [
    { id: viewer.id, nome: viewer.nome.trim() || 'Gestor', perfil: viewer.perfil, superior_id: null, ativo: true },
    ...outros.map((c) => ({ id: c.id, nome: c.nome.trim().slice(0, 200), perfil: c.perfil as Perfil, superior_id: sob, ativo: true })),
  ];
}

/** Dia da consulta: o informado, ou hoje no fuso do tenant (ADR 0002). */
export function dataDaConsulta(data: string | undefined, agora: string, fuso: string): string {
  return data ?? diaLocal(agora, fuso);
}

export interface EntradaVisao {
  estado: EstadoProjecao;
  membros: readonly MembroEquipe[];
  viewer: Viewer;
  escopo: EscopoGestor;
  data: string;
  modulos: ReadonlySet<string>;
  agora: string;
  params?: Partial<ParametrosGestor>;
}

/**
 * Árvore só com quem está no escopo, pendurada em quem consulta: quem perdeu o superior (fora do escopo ou fora do
 * cadastro) passa a responder direto ao viewer. Assim o resumo funciona igual para supervisor, gerente e tenant.
 */
function arvoreDoEscopo(e: Pick<EntradaVisao, 'membros' | 'viewer' | 'escopo'>): MembroEquipe[] {
  const dentro = e.membros.filter((m) => m.id !== e.viewer.id && podeVer(e.escopo, m.id));
  const ids = new Set(dentro.map((m) => m.id));
  const topo: MembroEquipe = e.membros.find((m) => m.id === e.viewer.id) ?? { id: e.viewer.id, nome: 'Gestor', perfil: e.viewer.perfil, superior_id: null, ativo: true };
  return [{ ...topo, superior_id: null }, ...dentro.map((m) => (m.superior_id && ids.has(m.superior_id) ? m : { ...m, superior_id: e.viewer.id }))];
}

/** RF-GES-01: resumo, equipes abaixo (gerente) e painel do dia de cada vendedor/promotor ativo do escopo, por nome. */
export function visaoDaEquipe(e: EntradaVisao): VisaoEquipe {
  const params = resolverParametros(e.params);
  const arvore = arvoreDoEscopo(e);
  const campo = arvore.filter((m) => m.id !== e.viewer.id && m.ativo && DE_CAMPO.has(m.perfil));
  const membros: MembroComPainel[] = campo
    .map((m) => ({ membro: m, painel: montarPainelDia(e.estado, { id: m.id, perfil: m.perfil }, e.data, { params, modulos: e.modulos, agora: e.agora }) }))
    .sort((a, b) => compararTexto(a.membro.nome, b.membro.nome) || compararTexto(a.membro.id, b.membro.id));
  const paineis = membros.map((x) => x.painel);
  return {
    data: e.data,
    resumo: resumirEquipe(e.viewer.id, arvore, paineis),
    equipes: equipesAbaixo(e.viewer.id, arvore, paineis),
    membros,
    calculado_em: e.agora,
  };
}

/** RF-GES-02/10 + RF-GES-05: ficha de UMA pessoa de campo do escopo; `null` = fora do escopo ou não é de campo (404). */
export function fichaDoMembro(e: EntradaVisao & { usuario_id: string }): FichaMembro | null {
  const membro = e.membros.find((m) => m.id === e.usuario_id);
  if (!membro || membro.id === e.viewer.id || !DE_CAMPO.has(membro.perfil) || !podeVer(e.escopo, membro.id)) return null;
  const painel = montarPainelDia(e.estado, { id: membro.id, perfil: membro.perfil }, e.data, { params: resolverParametros(e.params), modulos: e.modulos, agora: e.agora });
  const pedido_em_nome = disponibilidadePedidoEmNome({ autor: e.viewer, vendedor_id: membro.id, membros: arvoreDoEscopo(e), modulos: e.modulos });
  return { membro, painel, pedido_em_nome };
}

// ---------- alertas ----------
const ATIVOS: ReadonlySet<StatusAlerta> = new Set<StatusAlerta>(['aberto', 'dispensado']);

/**
 * RN-CORE-04: alertas cujo responsável está no escopo (sem responsável = só o tenant vê). `status` filtra; `ativos`
 * devolve abertos e dispensados (o padrão da tela). Ordem: abertos primeiro, depois por abertura e id.
 */
export function alertasDoEscopo(alertas: readonly Alerta[], escopo: EscopoGestor, f: { status?: StatusAlerta; ativos?: boolean }): Alerta[] {
  return alertas
    .filter((a) => (a.responsavel_id ? podeVer(escopo, a.responsavel_id) : escopo.tipo === 'tenant'))
    .filter((a) => (f.status ? a.status === f.status : f.ativos ? ATIVOS.has(a.status) : true))
    .sort((x, y) => Number(x.status !== 'aberto') - Number(y.status !== 'aberto') || compararTexto(x.aberto_em, y.aberto_em) || compararTexto(x.id, y.id));
}

export type ResultadoDispensa = { ok: true; alerta: Alerta; repetido?: true } | { ok: false; codigo: 'ALERTA_NAO_ENCONTRADO' | 'ALERTA_ENCERRADO' };

/**
 * RF-GES-07: dispensar silencia o alerta enquanto a condição persistir (a reconciliação não reabre; encerra quando a
 * condição normaliza). Fora do escopo = não encontrado (não revela). Já dispensado = repetição idempotente.
 */
export function dispensarAlerta(alerta: Alerta | null | undefined, escopo: EscopoGestor): ResultadoDispensa {
  if (!alerta || !(alerta.responsavel_id ? podeVer(escopo, alerta.responsavel_id) : escopo.tipo === 'tenant')) return { ok: false, codigo: 'ALERTA_NAO_ENCONTRADO' };
  if (alerta.status === 'encerrado') return { ok: false, codigo: 'ALERTA_ENCERRADO' };
  if (alerta.status === 'dispensado') return { ok: true, alerta, repetido: true };
  return { ok: true, alerta: { ...alerta, status: 'dispensado' } };
}

/** RF-GES-07 (BKO): aplica o ajuste de UM tipo sobre os ajustes do tenant, validado no contrato (mensagens em português). */
export function ajustarRegraAlerta(atuais: AjustesRegras, tipo: TipoAlerta, ajuste: unknown): { ok: true; ajustes: AjustesRegras } | { ok: false; erros: string[] } {
  const r = AjusteRegraAlerta.safeParse(ajuste);
  if (!r.success) return { ok: false, erros: r.error.issues.map((i) => `${i.path.join('.') || 'regra'}: ${i.message}`) };
  return { ok: true, ajustes: { ...atuais, [tipo]: { ...(atuais[tipo] ?? {}), ...r.data } } };
}
