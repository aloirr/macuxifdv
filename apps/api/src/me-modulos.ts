/**
 * Corpo de `GET /v1/me/modulos` (RF-CORE-02, RN-CORE-01/02; contrato `MeusModulosRespostaSchema` do Core), montado
 * aqui para a rota e para `GET /v1/sync/novidades` (RN-CORE-23, ADR 0018), que devolve a mesma lista quando os
 * módulos efetivos mudam.
 *
 * Parâmetro de plataforma `core.sync_auto_min` (RN-CORE-23): sempre presente na resposta, padrão 30 e mínimo 15
 * (o tenant pode gravar outro valor em `plataforma.parametro`; abaixo de 15 vale 15).
 */
import { createHash } from 'node:crypto';
import { MeusModulosRespostaSchema, type MeusModulosResposta } from '@macuxi/core/contracts';
import { MODULOS, PARAMETRO_SYNC_AUTO_MIN, syncAutoMinEfetivo, type Manifesto, type ModuloId } from '@macuxi/platform-sdk';
import type { LicencasUsuario } from './licencas';

/** `versao_licencas`: muda quando a lista efetiva, as versões ou os parâmetros mudam (RN-CORE-02 no app). */
export function versaoLicencas(r: Pick<MeusModulosResposta, 'modulos'>): string {
  return createHash('sha256').update(JSON.stringify(r.modulos)).digest('hex').slice(0, 16);
}

/** Parâmetros do módulo como vão ao aparelho (o Core leva `sync_auto_min` já com padrão e mínimo). */
export function parametrosParaAparelho(modulo: ModuloId, p: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  if (modulo !== 'core') return { ...p };
  return { ...p, [PARAMETRO_SYNC_AUTO_MIN]: syncAutoMinEfetivo(p[PARAMETRO_SYNC_AUTO_MIN]) };
}

/**
 * ADR 0060: módulos contratados pelo tenant (`tenant_modulo` ativo), sempre com o core, sem perfil nem exceção de usuário,
 * na ordem canônica de `MODULOS`. Fica fora da `versao_licencas` (não muda o que o aparelho sincroniza).
 */
export function modulosContratados(ativosNoTenant: readonly ModuloId[]): ModuloId[] {
  const ativos = new Set<ModuloId>(['core', ...ativosNoTenant]);
  return MODULOS.filter((id) => ativos.has(id));
}

export function respostaMeusModulos(
  manifestos: readonly Manifesto[],
  efetivos: readonly ModuloId[],
  parametros: LicencasUsuario['parametros'],
  agora: Date,
  ativosNoTenant?: readonly ModuloId[],
): MeusModulosResposta {
  const porManifesto = new Map(manifestos.map((m) => [m.id, m] as const));
  const lista = efetivos.map((id) => ({ id, versao: porManifesto.get(id)!.versao, parametros: parametrosParaAparelho(id, parametros[id]) }));
  return MeusModulosRespostaSchema.parse({
    modulos: lista,
    versao_licencas: versaoLicencas({ modulos: lista }),
    calculado_em: agora.toISOString(),
    ...(ativosNoTenant ? { modulos_contratados: modulosContratados(ativosNoTenant) } : {}),
  });
}
