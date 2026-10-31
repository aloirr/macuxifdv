import type { Role } from '@macuxi/core/contracts';

/**
 * Débito registrado (desenho T-0001 §5): `canApprove` é local até a pedido.aprovar vir do shell
 * (`usePode('pedido.aprovar')`, ADR 0004). Aprovar/recusar pedido fora da alçada: gestor (e admin).
 */
export const canApprove = (role: Role | undefined) => role === 'manager' || role === 'admin';

/** Alçadas de desconto: só o perfil analista edita (RN-VEN, doc 03). */
export const canEditParams = (role: Role | undefined) => role === 'analyst';
