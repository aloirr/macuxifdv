/**
 * T-0176 (RN-CORE-39 revista): com o PR do modulo-core no main, `POST /v1/core/usuarios` exige `filial_ids` para vendedor (exatamente 1)
 * e para promotor, supervisor e gerente (1 ou mais); antes dele, o contrato é estrito e RECUSA o campo. Os testes que criam gente pelo
 * BKO usam este apoio para valer nos dois estados (`FILIAL_USUARIO_CORE`, tests/modulos/apoio/estado-prs.ts): no estado novo, a filial
 * padrão do tenant (lida pela rota do BKO); no antigo, nada.
 */
import type { InjectOptions, LightMyRequestResponse } from 'fastify';
import { FILIAL_USUARIO_CORE } from '../../modulos/apoio/estado-prs';

interface ApiQueChama {
  chamar(token: string | null, op: InjectOptions): Promise<LightMyRequestResponse>;
}

/** Perfis de fábrica cujo cargo exige filial (RN-CORE-39): vendedor 1; promotor, supervisor e gerente 1 ou mais. */
const PERFIS_COM_FILIAL: ReadonlySet<string> = new Set(['vendedor', 'promotor', 'supervisor', 'gerente']);

/** Filiais vivas do tenant do token, pela rota do BKO (`GET /v1/core/filiais`, ação `filial.ver`); a padrão vem primeiro. */
export async function filiaisDoTenant(api: ApiQueChama, token: string): Promise<{ id: string; padrao: boolean; codigo: string; external_id: string | null }[]> {
  const r = await api.chamar(token, { method: 'GET', url: '/v1/core/filiais' });
  if (r.statusCode !== 200) throw new Error(`GET /v1/core/filiais: ${r.statusCode} ${r.body}`);
  return (r.json() as { itens: { id: string; padrao: boolean; codigo: string; external_id: string | null }[] }).itens;
}

/** Trecho do corpo de criação: `{ filial_ids: [padrão] }` quando o estado novo exige; `{}` no antigo ou para quem não precisa. */
export async function filialDoCadastro(api: ApiQueChama, token: string, perfil: string): Promise<{ filial_ids?: string[] }> {
  if (!FILIAL_USUARIO_CORE || !PERFIS_COM_FILIAL.has(perfil)) return {};
  const filiais = await filiaisDoTenant(api, token);
  const padrao = filiais.find((f) => f.padrao) ?? filiais[0];
  if (!padrao) throw new Error('o tenant não tem filial viva: a RN-CORE-39 não deixa criar vendedor, promotor, supervisor nem gerente');
  return { filial_ids: [padrao.id] };
}
