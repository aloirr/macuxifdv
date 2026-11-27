/**
 * Perfis em tabela (ADR 0073, etapa E5; simulação docs/design/simulacoes/2026-11-24/perfis-tabela.md): arrumação pura do que a API da E4b
 * devolve (`CatalogoResposta` + `PerfilDetalheV2`) no modelo da tabela com caixas. Sem regra nova: as travas, o teto e a licença
 * vêm da API (que revalida); aqui só se monta, se edita o rascunho e se monta o corpo do PUT.
 */
import { CHAVES_GESTAO_DO_ACESSO } from '@macuxi/platform-sdk';
import { textoDoTeto, textoSemLicenca } from '@macuxi/ui/web';
import type { CatalogoResposta, EditarPerfilRequestV2, PerfilDetalheV2 } from '../../contracts';
import { rotuloDaPermissao } from './acesso';
import { rotuloDoModulo, rotuloDoNivel } from './perfis';

export const ALVO_TODOS = '*';
const CHAVE_BKO = 'acesso.bko';
/** As 5 chaves que juntas são a "gestão do acesso": quem usa o perfil não as tira dele (autogestão, RN-CORE-35). */
export const CHAVES_DA_AUTOGESTAO: readonly string[] = [CHAVE_BKO, ...CHAVES_GESTAO_DO_ACESSO];
export const AVISO_AUTOGESTAO = 'Você usa este perfil. Por isso ele não pode perder a gestão de usuários e perfis.';
export const ERRO_SEM_ALVO = 'Marque pelo menos um perfil ou desligue esta permissão.';
export const MOTIVO_SEM_LICENCA_NA_LINHA = (modulo: string) => `O módulo ${rotuloDoModulo(modulo)} está sem licença.`;

type NivelDaApi = PerfilDetalheV2['permissoes'][number]['nivel'];
export interface ValorEdicao {
  concedida: boolean;
  nivel: NivelDaApi;
  alvos: string[] | null;
}
export type EdicaoTabela = Record<string, ValorEdicao>;
export type TipoDaLinha = 'caixa' | 'escopo' | 'alcada' | 'alvos';

export interface LinhaModelo {
  id: string;
  rotulo: string;
  tipo: TipoDaLinha;
  marcada: boolean;
  nivel: string | null;
  alvos: string[] | null;
  /** Cadeado: `motivo` ausente = autogestão (o motivo vai uma vez no aviso do topo). */
  trava: { motivo?: string } | null;
  /** A trava vem do cargo (a API não aceita a chave concedida). */
  travaDoCargo: boolean;
  /** Níveis do segmentado e o teto do cargo (só `escopo`). */
  niveis?: { valor: string; rotulo: string }[];
  teto?: string;
  motivoTeto?: string;
}
export interface GrupoModelo {
  id: string;
  titulo: string;
  linhas: LinhaModelo[];
  semLicenca: { mensagem: string } | null;
  semCaixa: boolean;
}

const NIVEIS_ESCOPO = ['proprio', 'carteira', 'equipe', 'equipes_abaixo', 'tenant'];
const NIVEIS_ALCADA = ['ate_alcada', 'acima_alcada'];

export const edicaoDoDetalhe = (d: PerfilDetalheV2): EdicaoTabela =>
  Object.fromEntries(d.permissoes.map((p) => [p.chave, { concedida: p.concedida, nivel: p.nivel, alvos: p.alvos }]));

/** O perfil que o usuário logado usa e que tem a gestão do acesso: as 5 chaves ficam com cadeado e o aviso aparece uma vez (RN-CORE-35). */
export function ehAutogestao(d: PerfilDetalheV2, codigoDoUsuario: string | null | undefined): boolean {
  if (!codigoDoUsuario || d.perfil.codigo !== codigoDoUsuario) return false;
  const tem = (c: string) => d.permissoes.some((p) => p.chave === c && p.concedida);
  return CHAVES_DA_AUTOGESTAO.every(tem);
}

export function montarGrupos(entrada: { catalogo: CatalogoResposta; detalhe: PerfilDetalheV2; edicao: EdicaoTabela; autogestao: boolean; rotuloDoCargo: string }): GrupoModelo[] {
  const { catalogo, detalhe, edicao, autogestao } = entrada;
  const doDetalhe = new Map(detalhe.permissoes.map((p) => [p.chave, p]));
  const grupos: GrupoModelo[] = [];
  for (const area of catalogo.areas) {
    const linhas: LinhaModelo[] = [];
    const semLic = (c: { chave: string; disponivel: boolean }) => !(doDetalhe.get(c.chave)?.disponivel ?? c.disponivel);
    const todasSemLicenca = area.chaves.length > 0 && area.chaves.every(semLic);
    for (const c of area.chaves) {
      const p = doDetalhe.get(c.chave);
      const v = edicao[c.chave] ?? { concedida: false, nivel: null, alvos: null };
      const tipo: TipoDaLinha = c.nivel === 'escopo' ? 'escopo' : c.nivel === 'alcada' ? 'alcada' : c.alvos ? 'alvos' : 'caixa';
      const travaDoCargo = !!p?.trava;
      const trava: LinhaModelo['trava'] = travaDoCargo
        ? { motivo: p!.trava!.mensagem }
        : autogestao && CHAVES_DA_AUTOGESTAO.includes(c.chave)
          ? {}
          : null;
      const linha: LinhaModelo = { id: c.chave, rotulo: rotuloDaPermissao(c.chave, c.descricao), tipo, marcada: tipo === 'escopo' ? true : v.concedida, nivel: v.nivel, alvos: v.alvos, trava, travaDoCargo };
      if (tipo === 'escopo') {
        const teto = detalhe.teto_escopo;
        linha.niveis = NIVEIS_ESCOPO.filter((n) => n !== 'proprio' || teto === 'proprio' || v.nivel === 'proprio').map((n) => ({ valor: n, rotulo: rotuloDoNivel(n) }));
        linha.teto = teto;
        linha.motivoTeto = textoDoTeto(entrada.rotuloDoCargo, rotuloDoNivel(teto));
      } else if (tipo === 'alcada') linha.niveis = NIVEIS_ALCADA.map((n) => ({ valor: n, rotulo: rotuloDoNivel(n) }));
      // grupo misto: a linha sem licença leva o motivo no lugar do cadeado do cargo
      if (semLic(c) && !todasSemLicenca && !linha.trava) linha.trava = { motivo: MOTIVO_SEM_LICENCA_NA_LINHA(c.modulo) };
      linhas.push(linha);
    }
    grupos.push({
      id: area.area,
      titulo: area.rotulo,
      linhas,
      semLicenca: todasSemLicenca ? { mensagem: textoSemLicenca(rotuloDoModulo(area.chaves[0]!.modulo)) } : null,
      semCaixa: linhas.length > 0 && linhas.every((l) => l.tipo === 'escopo'),
    });
  }
  return grupos;
}

export function alternarLinha(e: EdicaoTabela, l: Pick<LinhaModelo, 'id' | 'tipo'>, marcada: boolean): EdicaoTabela {
  const v = e[l.id] ?? { concedida: false, nivel: null, alvos: null };
  const nivel = marcada && l.tipo === 'alcada' && !v.nivel ? 'ate_alcada' : v.nivel;
  const alvos = marcada && l.tipo === 'alvos' ? (v.alvos ?? []) : v.alvos;
  return { ...e, [l.id]: { concedida: marcada, nivel: nivel as NivelDaApi, alvos } };
}

export function escolherNivel(e: EdicaoTabela, chave: string, nivel: string): EdicaoTabela {
  return { ...e, [chave]: { concedida: true, nivel: nivel as NivelDaApi, alvos: e[chave]?.alvos ?? null } };
}

export function marcarAlvos(e: EdicaoTabela, chave: string, alvos: string[]): EdicaoTabela {
  return { ...e, [chave]: { concedida: e[chave]?.concedida ?? true, nivel: e[chave]?.nivel ?? null, alvos } };
}

/** Caixa do grupo: aplica só as linhas livres que o kit devolveu (`mudancasDaCaixaDoGrupo`). */
export function aplicarMarcacoes(e: EdicaoTabela, linhas: readonly GrupoModelo['linhas'][number][], mudancas: Record<string, boolean>): EdicaoTabela {
  let r = e;
  for (const l of linhas) if (Object.hasOwn(mudancas, l.id)) r = alternarLinha(r, l, mudancas[l.id]!);
  return r;
}

export const erroDeAlvos = (l: Pick<LinhaModelo, 'id' | 'tipo' | 'marcada'>, e: EdicaoTabela): string | null =>
  l.tipo === 'alvos' && e[l.id]?.concedida && (e[l.id]?.alvos?.length ?? 0) === 0 ? ERRO_SEM_ALVO : null;

/** "Copiar permissões de…": troca as caixas marcadas pelas do perfil de origem; travadas e sem licença ficam como estão; o escopo respeita o teto. */
export function copiarDoPerfil(e: EdicaoTabela, grupos: readonly GrupoModelo[], origem: PerfilDetalheV2, teto: string): EdicaoTabela {
  const daOrigem = new Map(origem.permissoes.map((p) => [p.chave, p]));
  const pos = (n: string | null) => NIVEIS_ESCOPO.indexOf(n ?? '');
  let r = e;
  for (const g of grupos) {
    if (g.semLicenca) continue;
    for (const l of g.linhas) {
      if (l.trava) continue;
      const o = daOrigem.get(l.id);
      let nivel: string | null = o?.nivel ?? null;
      if (l.tipo === 'escopo' && nivel && pos(nivel) > pos(teto)) nivel = teto;
      r = { ...r, [l.id]: { concedida: !!o?.concedida, nivel: nivel as NivelDaApi, alvos: o?.alvos ?? null } };
    }
  }
  return r;
}

export interface Identificacao {
  nome: string;
  descricao: string;
  cargo: string;
}

/** Quantas coisas mudaram (permissões e identificação), para "n mudanças não salvas". */
export function contarMudancas(inicial: EdicaoTabela, atual: EdicaoTabela, identInicial: Identificacao, identAtual: Identificacao): number {
  const chaves = new Set([...Object.keys(inicial), ...Object.keys(atual)]);
  let n = 0;
  for (const c of chaves) if (JSON.stringify(inicial[c] ?? null) !== JSON.stringify(atual[c] ?? null)) n++;
  if (identInicial.nome !== identAtual.nome) n++;
  if (identInicial.descricao !== identAtual.descricao) n++;
  if (identInicial.cargo !== identAtual.cargo) n++;
  return n;
}

/** Corpo do PUT: o conjunto inteiro (o que não vem fica desmarcado) com a trava otimista. As travadas pelo cargo não vão (a API as recusa). */
export function corpoDoPut(d: PerfilDetalheV2, e: EdicaoTabela, ident: Identificacao, ativo?: boolean): EditarPerfilRequestV2 {
  const travadas = new Set(d.permissoes.filter((p) => p.trava).map((p) => p.chave));
  const permissoes = Object.entries(e)
    .filter(([c, v]) => v.concedida && !travadas.has(c))
    .map(([chave, v]) => ({ chave, ...(v.nivel ? { nivel: v.nivel as never } : {}), ...(v.alvos ? { alvos: v.alvos } : {}) }));
  return {
    nome: ident.nome.trim(),
    descricao: ident.descricao.trim() || null,
    ...(ident.cargo !== d.perfil.cargo ? { cargo: ident.cargo as never } : {}),
    ...(ativo === undefined ? {} : { ativo }),
    permissoes,
    atualizado_em: d.atualizado_em,
  };
}

/** Frases do histórico (auditoria `perfil.alterar`: `permissoes` guarda só o que saiu, mudou ou entrou). Nunca JSON, chave ou nível crus. */
export function frasesDoHistorico(antes: unknown, depois: unknown, rotuloDe: (chave: string) => string): string[] {
  const a = (antes ?? {}) as { nome?: string; ativo?: boolean; permissoes?: Record<string, unknown> };
  const d = (depois ?? {}) as { nome?: string; ativo?: boolean; permissoes?: Record<string, unknown> };
  const frases: string[] = [];
  if (a.nome && d.nome && a.nome !== d.nome) frases.push(`Nome: ${a.nome} → ${d.nome}`);
  if (a.ativo !== undefined && d.ativo !== undefined && a.ativo !== d.ativo) frases.push(d.ativo ? 'Perfil reativado.' : 'Perfil desativado.');
  const pa = a.permissoes ?? {};
  const pd = d.permissoes ?? {};
  for (const c of [...new Set([...Object.keys(pa), ...Object.keys(pd)])].sort()) {
    const r = rotuloDe(c);
    if (pa[c] && !pd[c]) frases.push(`${r}: desligada`);
    else if (!pa[c] && pd[c]) frases.push(`${r}: ligada`);
    else frases.push(`${r}: ajustada`);
  }
  return frases;
}
