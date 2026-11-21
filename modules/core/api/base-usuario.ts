/**
 * Casa e base do usuário no banco (T-0191; RN-CORE-75): leitura das colunas `casa_*` e `base_*` de `core.usuario` e a base
 * resolvida pelo domain. Endereço é dado pessoal do trabalhador: nunca vai para log nem para a auditoria (só o tipo da base).
 */
import type { ClienteBanco } from '@macuxi/platform-sdk';
import { PARAMETRO_DIAS_UTEIS, PARAMETRO_FERIADOS, type BaseNoMapa, type CalendarioRotas, type EnderecoBase } from '../contracts';
import { baseResolvida, calendarioDoTenant, casaDoUsuario, feriadosDasLinhas, type EnderecoCru } from '../domain';
import { lerParametrosCore } from './parametro-tenant';

interface LinhaEnderecoUsuario {
  id: string;
  perfil: string;
  base_tipo: 'casa' | 'outro' | null;
  casa_cep: string | null;
  casa_logradouro: string | null;
  casa_numero: string | null;
  casa_bairro: string | null;
  casa_cidade: string | null;
  casa_uf: string | null;
  casa_lat: number | null;
  casa_lng: number | null;
  base_cep: string | null;
  base_logradouro: string | null;
  base_numero: string | null;
  base_bairro: string | null;
  base_cidade: string | null;
  base_uf: string | null;
  base_lat: number | null;
  base_lng: number | null;
}

const COLUNAS = `id, perfil, base_tipo, casa_cep, casa_logradouro, casa_numero, casa_bairro, casa_cidade, casa_uf, casa_lat::float8 as casa_lat, casa_lng::float8 as casa_lng,
  base_cep, base_logradouro, base_numero, base_bairro, base_cidade, base_uf, base_lat::float8 as base_lat, base_lng::float8 as base_lng`;

const cru = (l: LinhaEnderecoUsuario, p: 'casa' | 'base'): EnderecoCru => ({
  cep: l[`${p}_cep`],
  logradouro: l[`${p}_logradouro`],
  numero: l[`${p}_numero`],
  bairro: l[`${p}_bairro`],
  cidade: l[`${p}_cidade`],
  uf: l[`${p}_uf`],
  lat: l[`${p}_lat`],
  lng: l[`${p}_lng`],
});

export function casaDaLinha(l: LinhaEnderecoUsuario) {
  return casaDoUsuario(cru(l, 'casa'));
}

export function baseDaLinha(l: LinhaEnderecoUsuario): EnderecoBase | null {
  return baseResolvida({ base_tipo: l.base_tipo, casa: cru(l, 'casa'), base: cru(l, 'base') });
}

/** A linha de endereço do usuário vivo (RLS limita ao tenant); `null` se não existe. */
export async function lerEnderecoDoUsuario(db: ClienteBanco, usuarioId: string): Promise<LinhaEnderecoUsuario | null> {
  return (await db.query<LinhaEnderecoUsuario>(`select ${COLUNAS} from core.usuario where id = $1 and deleted_at is null`, [usuarioId])).rows[0] ?? null;
}

/** RN-CORE-75: a base de cada usuário pedido (`null` = sem base). */
export async function basesDosUsuarios(db: ClienteBanco, ids: readonly string[]): Promise<Record<string, BaseNoMapa | null>> {
  if (ids.length === 0) return {};
  const linhas = (await db.query<LinhaEnderecoUsuario>(`select ${COLUNAS} from core.usuario where id = any($1::uuid[]) and deleted_at is null`, [[...ids]])).rows;
  // só tipo e ponto: o endereço completo pode ser a casa (dado pessoal) e só sai em `GET usuarios/:id/base`
  return Object.fromEntries(
    linhas.map((l) => {
      const b = baseDaLinha(l);
      return [l.id, b ? { tipo: b.tipo, lat: b.lat, lng: b.lng } : null];
    }),
  );
}

/** RN-CORE-76 (D3): semana útil e feriados do tenant (`metas.dias_uteis_semana`, `metas.feriados`); padrão segunda a sábado. */
export async function calendarioDoTenantNaTransacao(db: ClienteBanco): Promise<CalendarioRotas> {
  const linhas = await lerParametrosCore(db, [PARAMETRO_DIAS_UTEIS, PARAMETRO_FERIADOS]);
  return { dias_uteis_semana: [...calendarioDoTenant(linhas).dias_uteis_semana], feriados: feriadosDasLinhas(linhas) };
}
