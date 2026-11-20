/**
 * Visão da tela de licenças (BKO, Parâmetros › Acesso › Módulos): funções puras sobre o estado devolvido por
 * `GET /v1/core/licencas`. Sem React e sem rede — testadas em Node. Regras: RN-CORE-01 (tenant ∩ perfil − exceções,
 * exceção do usuário só remove, core sempre ativo) e RN-CORE-03 (desligar um módulo desliga os dependentes).
 */
import { BOM_CSV } from '@macuxi/comum/csv';
import type { ModuloId, Perfil } from '@macuxi/platform-sdk';
import type { LicencasEstado, NivelLicenca } from '../../contracts';
import { dependentesDe, efetivosPelasDependencias, moduloListavel, modulosListaveis } from '../../domain/licencas';

export interface LinhaLicenca {
  modulo: ModuloId;
  ativo: boolean;
  /** `core` não desliga em nenhum nível (S0-045). */
  travado: boolean;
}

/** Linhas do nível escolhido. No nível usuário "ativo" = sem exceção que remova o módulo. */
export function linhasDoNivel(e: LicencasEstado, nivel: NivelLicenca, alvo: { perfil?: Perfil | null; usuarioId?: string | null } = {}): LinhaLicenca[] {
  return e.modulos.map((modulo) => {
    let ativo = modulo === 'core';
    if (nivel === 'tenant') ativo = modulo === 'core' || e.tenant[modulo] === true;
    else if (nivel === 'perfil') ativo = modulo === 'core' || (alvo.perfil ? (e.perfis[alvo.perfil] ?? []).includes(modulo) : false);
    else {
      const u = e.usuarios.find((x) => x.id === alvo.usuarioId);
      ativo = modulo === 'core' || (u ? !u.removidos.includes(modulo) : false);
    }
    return { modulo, ativo, travado: modulo === 'core' };
  });
}

/** Linhas que a tela mostra: sem o core (regra única `moduloListavel`, a mesma do app "Meus módulos"). A exportação CSV segue com todas. */
export function linhasListaveisDoNivel(e: LicencasEstado, nivel: NivelLicenca, alvo: { perfil?: Perfil | null; usuarioId?: string | null } = {}): LinhaLicenca[] {
  return linhasDoNivel(e, nivel, alvo).filter((l) => moduloListavel(l.modulo));
}

/** Efetivos que a tela mostra, sem o core. */
export function efetivosListaveisDoUsuario(e: LicencasEstado, usuarioId: string | null | undefined): ModuloId[] {
  return modulosListaveis(efetivosDoUsuario(e, usuarioId));
}

/** Módulos efetivos do usuário (RN-CORE-01/03), para a lista "Módulos efetivos do usuário". */
export function efetivosDoUsuario(e: LicencasEstado, usuarioId: string | null | undefined): ModuloId[] {
  const u = e.usuarios.find((x) => x.id === usuarioId);
  if (!u) return [];
  return efetivosPelasDependencias({
    modulos: e.modulos,
    dependencias: e.dependencias,
    ativosNoTenant: e.modulos.filter((m) => e.tenant[m] === true),
    doPerfil: e.perfis[u.perfil] ?? [],
    removidosDoUsuario: u.removidos,
  });
}

/** Aviso de dependência: o que mais desliga junto, considerando só os módulos hoje ligados no nível. */
export function modulosQueTambemDesligam(e: LicencasEstado, modulo: ModuloId, ligadosNoNivel: readonly ModuloId[]): ModuloId[] {
  const ligados = new Set(ligadosNoNivel);
  return dependentesDe(modulo, e.modulos, e.dependencias).filter((m) => ligados.has(m));
}

const aspas = (v: string) => `"${v.replace(/"/g, '""')}"`;

/** CSV (separador `;`, com BOM, para abrir direto no Excel pt-BR) das licenças dos três níveis. */
export function csvDeLicencas(e: LicencasEstado): string {
  const linhas: string[][] = [['nivel', 'alvo', 'modulo', 'estado']];
  for (const l of linhasDoNivel(e, 'tenant')) linhas.push(['tenant', 'empresa', l.modulo, l.ativo ? 'ativo' : 'inativo']);
  for (const perfil of Object.keys(e.perfis)) {
    for (const l of linhasDoNivel(e, 'perfil', { perfil: perfil as Perfil })) linhas.push(['perfil', perfil, l.modulo, l.ativo ? 'ativo' : 'inativo']);
  }
  for (const u of e.usuarios) {
    for (const m of u.removidos) linhas.push(['usuario', u.email, m, 'removido']);
    linhas.push(['efetivos', u.email, efetivosDoUsuario(e, u.id).join(' '), 'efetivo']);
  }
  return `${BOM_CSV}${linhas.map((l) => l.map(aspas).join(';')).join('\r\n')}\r\n`;
}

export const ROTULO_NIVEL: Record<NivelLicenca, string> = { tenant: 'Empresa', perfil: 'Perfil', usuario: 'Usuário' };
