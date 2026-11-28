/**
 * RN-CORE-32 (ADR 0078, D5): cada e-mail pertence a uma empresa só, comparado normalizado (minúsculas, sem espaços nas pontas). O
 * vendedor do lote com e-mail vivo em outra empresa é recusado com `VENDEDOR_EMAIL_EM_OUTRA_EMPRESA` e o resto do lote segue. O
 * e-mail técnico do provisório do ERP (`@sem-email.invalid`, RN-CORE-58) fica fora. Quem diz se o e-mail está em outra empresa é o
 * banco (`plataforma.email_em_outra_empresa`); aqui fica só a regra. O erro nunca leva o e-mail.
 */
import type { Entidade, LinhaErro } from '../contracts';

const SUFIXO_EMAIL_PROVISORIO = '@sem-email.invalid';
export const MENSAGEM_VENDEDOR_EMAIL_EM_OUTRA_EMPRESA = 'Este e-mail já está em uso em outra empresa. Use outro e-mail.';

export function normalizarEmailVendedor(email: string | null | undefined): string | null {
  const e = (email ?? '').trim().toLowerCase();
  return e === '' ? null : e;
}

function emailConferivel(registro: unknown): string | null {
  const e = normalizarEmailVendedor((registro as { email?: string | null }).email);
  return e === null || e.endsWith(SUFIXO_EMAIL_PROVISORIO) ? null : e;
}

/** E-mails normalizados, sem repetição, dos vendedores do lote que vão à conferência entre empresas. */
export function emailsDeVendedorParaConferir(entidade: Entidade, linhas: readonly { registro: unknown }[]): string[] {
  if (entidade !== 'vendedor') return [];
  const s = new Set<string>();
  for (const l of linhas) {
    const e = emailConferivel(l.registro);
    if (e !== null) s.add(e);
  }
  return [...s];
}

/** Recusa, por linha, o vendedor cujo e-mail normalizado está em `emOutraEmpresa`. */
export function recusarVendedoresComEmailEmOutraEmpresa<L extends { indice: number; external_id: string; registro: unknown }>(
  entidade: Entidade,
  linhas: readonly L[],
  emOutraEmpresa: ReadonlySet<string>,
): { aceitas: L[]; erros: LinhaErro[] } {
  if (entidade !== 'vendedor' || emOutraEmpresa.size === 0) return { aceitas: [...linhas], erros: [] };
  const aceitas: L[] = [];
  const erros: LinhaErro[] = [];
  for (const l of linhas) {
    const e = emailConferivel(l.registro);
    if (e === null || !emOutraEmpresa.has(e)) {
      aceitas.push(l);
      continue;
    }
    erros.push({ indice: l.indice, external_id: l.external_id, codigo: 'VENDEDOR_EMAIL_EM_OUTRA_EMPRESA', campo: 'email', mensagem: MENSAGEM_VENDEDOR_EMAIL_EM_OUTRA_EMPRESA, reprocessavel: false });
  }
  return { aceitas, erros };
}
