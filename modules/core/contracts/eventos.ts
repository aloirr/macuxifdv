/**
 * Eventos publicados pelo Core (nome `<modulo>.<entidade>.<fato>@vN`; payload validado na outbox).
 * - `core.usuario.modulos_alterados@1`: uma licença mudou (tenant, perfil ou exceção de usuário). Quem guarda
 *   estado por módulo (ex.: filas, caches) reage; o aparelho descobre pelo `versao_licencas` do `/v1/me/modulos`.
 */
import { definirEvento } from '@macuxi/platform-sdk';
import { ModulosAlteradosSchema } from './licencas';

export const EVENTO_MODULOS_ALTERADOS = definirEvento('core.usuario.modulos_alterados@1', ModulosAlteradosSchema);
