/**
 * Perfis de acesso de um usuário no login (RN-CORE-01/35; ADR 0033): lê `plataforma.perfis_do_usuario` (0041) na transação do tenant e
 * resolve com o motor do SDK. Um perfil por usuário (RN-CORE-54): perfil de base vendedor/promotor/supervisor fecha o BKO.
 * Sem nenhuma linha (usuário antigo, banco sem a 0041 semeada) cai em `perfisDeFabrica` (domain/matriz.ts).
 * As chaves `acesso.*` são só da plataforma, então a matriz sem manifestos basta para as linhas numa rota pública.
 */
import { matrizDeFabrica, PERFIS, resolverPerfil, NIVEIS_ALCADA, NIVEIS_ESCOPO, type ClienteBanco, type MatrizFabrica, type NivelPermissao, type Perfil, type PerfilDaRequisicao, type SobreposicaoPermissao } from '@macuxi/platform-sdk';
import { perfisDeFabrica } from '../domain';

const MATRIZ = matrizDeFabrica([]);
const ehNivel = (n: unknown): n is NivelPermissao => typeof n === 'string' && ([...NIVEIS_ESCOPO, ...NIVEIS_ALCADA] as readonly string[]).includes(n);

export interface LinhaPerfilDoUsuario { codigo: string; base: string; fabrica: boolean; sobreposicoes: unknown }

function sobreposicoesDe(bruto: unknown): SobreposicaoPermissao[] {
  if (!Array.isArray(bruto)) return [];
  const saida: SobreposicaoPermissao[] = [];
  for (const i of bruto as { chave?: unknown; concedida?: unknown; nivel?: unknown; alvos?: unknown }[]) {
    if (typeof i?.chave !== 'string' || typeof i.concedida !== 'boolean') continue;
    const alvos = Array.isArray(i.alvos) ? i.alvos.filter((a): a is string => typeof a === 'string') : null;
    saida.push({ chave: i.chave, concedida: i.concedida, nivel: ehNivel(i.nivel) ? i.nivel : null, alvos });
  }
  return saida;
}

/** Mesma resolução do login e da API. `matriz` = a de fábrica COMPLETA (ações dos módulos) quando quem chama a tem; sem ela, as linhas usam só a da plataforma. */
export function resolverLinhasDePerfil(linhas: readonly LinhaPerfilDoUsuario[], principal: Perfil, matriz?: MatrizFabrica): PerfilDaRequisicao[] {
  const validas = linhas.filter((l) => (PERFIS as readonly string[]).includes(l.base));
  if (validas.length === 0) return perfisDeFabrica(principal, matriz);
  return validas.map((l) => resolverPerfil({ codigo: l.codigo, base: l.base as Perfil, ativo: true, fabrica: l.fabrica, sobreposicoes: sobreposicoesDe(l.sobreposicoes) }, matriz ?? MATRIZ));
}

export async function perfisEfetivosDoUsuario(db: ClienteBanco, usuarioId: string, principal: Perfil, matriz?: MatrizFabrica): Promise<PerfilDaRequisicao[]> {
  const r = await db.query<LinhaPerfilDoUsuario>('select codigo, base, fabrica, sobreposicoes from plataforma.perfis_do_usuario($1)', [usuarioId]);
  return resolverLinhasDePerfil(r.rows, principal, matriz);
}

export const perfisDoUsuarioNoLogin = (db: ClienteBanco, usuarioId: string, principal: Perfil): Promise<PerfilDaRequisicao[]> => perfisEfetivosDoUsuario(db, usuarioId, principal);
