/**
 * Leitura de perfis do modelo de hoje (com base e sobreposições), que o cadastro de usuário ainda usa (`usuarios.ts`, `usuario-perfis.ts`).
 * As ROTAS de `/v1/core/perfis` são as de `perfis-v2.ts` (ADR 0073, E6); a troca deste carregamento sai com a fase 2.
 */
import { matrizDeFabrica, type ClienteBanco, type ContextoBase, type DefinicaoChave, type MatrizFabrica, type NivelPermissao, type Perfil, type PerfilDeAcesso, type SobreposicaoPermissao } from '@macuxi/platform-sdk';
import type { Cargo } from '@macuxi/platform-sdk';

interface LinhaPerfil {
  id: string;
  codigo: string;
  nome: string;
  descricao: string | null;
  base: Perfil;
  fabrica: boolean;
  ativo: boolean;
  /** 0069: NOT NULL no banco; sem a coluna (leitura antiga), vale o cargo da base. */
  cargo?: Cargo | null;
}
interface LinhaPermissao {
  perfil_id: string;
  chave: string;
  concedida: boolean;
  nivel: NivelPermissao | null;
  alvos: string[] | null;
}

export const motorDe = (ctx: ContextoBase): { catalogo: readonly DefinicaoChave[]; matriz: MatrizFabrica } => ctx.permissoes ?? { catalogo: [], matriz: matrizDeFabrica([]) };

const sobreposicaoDe = (l: LinhaPermissao): SobreposicaoPermissao => ({
  chave: l.chave,
  concedida: l.concedida,
  ...(l.nivel ? { nivel: l.nivel } : {}),
  ...(l.alvos ? { alvos: l.alvos } : {}),
});

interface Carga {
  linhas: LinhaPerfil[];
  perfis: PerfilDeAcesso[];
  usuarios: { id: string; ativo: boolean; perfis: string[] }[];
}

/** Perfis vivos com as sobreposições e os usuários com seus perfis. `travar` = `for update` nos perfis (escrita). */
export async function carregar(db: ClienteBanco, travar: boolean): Promise<Carga> {
  const lock = travar ? ' for update' : '';
  const ps = await db.query<LinhaPerfil>(`select id, codigo, nome, descricao, base, fabrica, ativo, cargo from plataforma.perfil where deleted_at is null order by codigo${lock}`);
  const sobre = await db.query<LinhaPermissao>('select perfil_id, chave, concedida, nivel, alvos from plataforma.perfil_permissao where deleted_at is null order by chave');
  const us = await db.query<{ id: string; ativo: boolean; perfis: string[] }>(
    `select u.id, u.ativo, coalesce(array_agg(p.codigo order by p.codigo) filter (where p.codigo is not null), '{}') as perfis
       from core.usuario u
       left join plataforma.usuario_perfil up on up.usuario_id = u.id and up.deleted_at is null
       left join plataforma.perfil p on p.id = up.perfil_id and p.deleted_at is null
      where u.deleted_at is null group by u.id, u.ativo order by u.id`,
  );
  const porId = new Map<string, SobreposicaoPermissao[]>();
  for (const s of sobre.rows) porId.set(s.perfil_id, [...(porId.get(s.perfil_id) ?? []), sobreposicaoDe(s)]);
  const perfis: PerfilDeAcesso[] = ps.rows.map((p) => ({ codigo: p.codigo, base: p.base, ativo: p.ativo, fabrica: p.fabrica, sobreposicoes: porId.get(p.id) ?? [] }));
  return { linhas: ps.rows, perfis, usuarios: us.rows };
}
