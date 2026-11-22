/**
 * Código de erro que o cadastro de usuário ainda usa (RN-CORE-34). O nome `CODIGOS_EQUIPE_CSV` fica
 * até a S8 tirar `apps/web/lib/equipe-csv.ts`; depois é renomeado.
 */
export const CODIGOS_EQUIPE_CSV = {
  /** 503 — o envio de e-mail não está configurado: ninguém conheceria as senhas geradas (RN-CORE-34). */
  emailIndisponivel: 'EMAIL_INDISPONIVEL',
} as const;
