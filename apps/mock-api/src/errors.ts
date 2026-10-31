/** Erro de negócio no formato da API: { code, message, details } */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new ApiError(404, 'not_found', `${what} não encontrado.`);
export const forbidden = (msg = 'Seu perfil não pode fazer esta ação.') => new ApiError(403, 'forbidden', msg);
export const badRequest = (code: string, msg: string, details?: Record<string, unknown>) => new ApiError(400, code, msg, details);
