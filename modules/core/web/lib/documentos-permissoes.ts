/**
 * BKO › Parâmetros › Documentos (T-0186, RN-CORE-40; prancha 05): funções puras da matriz tipo × perfil e das exceções por
 * documento. Sem React e sem rede. A regra do nível mora em `domain/documentos-cliente` (`nivelDoTipo`, `validarMatrizDocumentos`)
 * e a API revalida tudo.
 */
import { nivelDoTipo, PERFIS_DOCUMENTO_VEEM_TUDO, validarMatrizDocumentos, type NivelDocumento, type PermissaoTipoDocumento } from '../../domain/documentos-cliente';

export interface TipoDaMatriz {
  id: string;
  nome: string;
  permite_envio: boolean;
}
export interface ColunaPerfil {
  codigo: string;
  nome: string;
}

const ROTULO_NIVEL: Readonly<Record<NivelDocumento, string>> = { nao_ve: 'Não vê', ve: 'Vê', ve_e_envia: 'Vê e envia' };
const ROTULO_ORIGEM: Readonly<Record<string, string>> = { erp: 'ERP', escritorio: 'Escritório', app: 'App' };

export const rotuloDoNivel = (n: NivelDocumento): string => ROTULO_NIVEL[n];
export const rotuloDaOrigem = (origem: string): string => ROTULO_ORIGEM[origem] ?? origem;

/** Níveis que o tipo aceita: "Vê e envia" só onde o app captura (Fotos do PDV). */
export function niveisDoTipo(tipo: Pick<TipoDaMatriz, 'permite_envio'>): NivelDocumento[] {
  return tipo.permite_envio ? ['nao_ve', 've', 've_e_envia'] : ['nao_ve', 've'];
}

const ORDEM_BASE = ['vendedor', 'promotor', 'supervisor', 'gerente'];

/** Colunas da matriz: perfis ativos que entram no app Campo ou Gestão (Admin e Analista veem tudo e ficam fora); os de fábrica primeiro. */
export function colunasDePerfil(perfis: readonly { codigo: string; nome: string; onde_entra: readonly string[]; ativo: boolean }[]): ColunaPerfil[] {
  const fixos: readonly string[] = PERFIS_DOCUMENTO_VEEM_TUDO;
  return perfis
    .filter((p) => p.ativo && !fixos.includes(p.codigo) && p.onde_entra.some((o) => o === 'campo' || o === 'gestao'))
    .map((p) => ({ codigo: p.codigo, nome: p.nome }))
    .sort((a, b) => {
      const ia = ORDEM_BASE.indexOf(a.codigo);
      const ib = ORDEM_BASE.indexOf(b.codigo);
      if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      return a.nome.localeCompare(b.nome, 'pt-BR');
    });
}

/** Troca o nível de uma célula; a linha "Não vê" fica explícita (a API recebe o estado inteiro). */
export function aplicarNivel(matriz: readonly PermissaoTipoDocumento[], tipoId: string, perfil: string, nivel: NivelDocumento): PermissaoTipoDocumento[] {
  return [...matriz.filter((m) => !(m.tipo_id === tipoId && m.perfil === perfil)), { tipo_id: tipoId, perfil, nivel }];
}

export const celulaEditada = (salva: readonly PermissaoTipoDocumento[], atual: readonly PermissaoTipoDocumento[], tipo: Pick<TipoDaMatriz, 'id' | 'permite_envio'>, perfil: string): boolean =>
  nivelDoTipo(salva, tipo, perfil) !== nivelDoTipo(atual, tipo, perfil);

/** "Salvar permissões" só liga com alguma célula diferente da salva. */
export const temMudanca = (salva: readonly PermissaoTipoDocumento[], atual: readonly PermissaoTipoDocumento[], tipos: readonly TipoDaMatriz[], colunas: readonly ColunaPerfil[]): boolean =>
  tipos.some((t) => colunas.some((c) => celulaEditada(salva, atual, t, c.codigo)));

/** O corpo do PUT: todas as células tipo × coluna, mais as linhas de perfis que não são coluna (ficam como estão). */
export function matrizParaSalvar(atual: readonly PermissaoTipoDocumento[], tipos: readonly TipoDaMatriz[], colunas: readonly ColunaPerfil[]): PermissaoTipoDocumento[] {
  const codigos = new Set(colunas.map((c) => c.codigo));
  const resto = atual.filter((m) => !codigos.has(m.perfil));
  const celulas = tipos.flatMap((t) => colunas.map((c) => ({ tipo_id: t.id, perfil: c.codigo, nivel: nivelDoTipo(atual, t, c.codigo) })));
  return [...resto, ...celulas];
}

/** Confere a matriz com a regra do domain antes de enviar; devolve a mensagem em português ou null. */
export function erroDaMatriz(tipos: readonly TipoDaMatriz[], linhas: readonly PermissaoTipoDocumento[]): string | null {
  const r = validarMatrizDocumentos(tipos, linhas);
  return r.ok ? null : r.mensagem;
}

// ---------------------------------------------------------------- exceções por documento (P11: só tira acesso)

export const perfisSemAcesso = (colunas: readonly ColunaPerfil[], quemVe: readonly string[]): string[] => colunas.map((c) => c.codigo).filter((c) => !quemVe.includes(c));
export const perfisQueVeem = (colunas: readonly ColunaPerfil[], semAcesso: readonly string[]): string[] => colunas.map((c) => c.codigo).filter((c) => !semAcesso.includes(c));

/** Coluna "Quem vê" da exceção: os nomes dos perfis que sobram, ou "Ninguém". */
export function quemVeDaExcecao(colunas: readonly ColunaPerfil[], semAcesso: readonly string[]): string {
  const nomes = colunas.filter((c) => !semAcesso.includes(c.codigo)).map((c) => c.nome);
  return nomes.length ? nomes.join(', ') : 'Ninguém';
}

export const alternarQuemVe = (quemVe: readonly string[], perfil: string): string[] => (quemVe.includes(perfil) ? quemVe.filter((p) => p !== perfil) : [...quemVe, perfil]);
