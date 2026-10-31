/**
 * Formulário das alçadas de desconto (tela Parâmetros). Campos de % digitados em pt-BR ("5,5").
 */
import type { DiscountPolicy } from '../../contracts';
import { formatPctInput, parseDecimalInput } from '@macuxi/ui/web';

export interface PolicyForm {
  seller: string;
  supervisor: string;
  manager: string;
  above_manager: 'block' | 'director';
  exceptions: Array<{ seller_id: string; pct: string }>;
}

export interface PutPolicyBody {
  seller_pct: number;
  supervisor_pct: number;
  manager_pct: number;
  above_manager: 'block' | 'director';
  exceptions: Array<{ seller_id: string; max_discount_pct: number }>;
}

export function policyToForm(p: DiscountPolicy): PolicyForm {
  return {
    seller: formatPctInput(p.seller_pct),
    supervisor: formatPctInput(p.supervisor_pct),
    manager: formatPctInput(p.manager_pct),
    above_manager: p.above_manager,
    exceptions: p.exceptions.map((e) => ({ seller_id: e.seller_id, pct: formatPctInput(e.max_discount_pct) })),
  };
}

function pct(s: string): number | null {
  const n = parseDecimalInput(s);
  return n === null || n < 0 || n > 100 ? null : Math.round(n * 100) / 100;
}

/** Devolve o corpo do PUT ou a primeira mensagem de erro. */
export function validatePolicyForm(f: PolicyForm): { ok: true; body: PutPolicyBody } | { ok: false; error: string } {
  const seller = pct(f.seller);
  const supervisor = pct(f.supervisor);
  const manager = pct(f.manager);
  if (seller === null || supervisor === null || manager === null) return { ok: false, error: 'Use percentuais entre 0 e 100 (ex.: 5,0).' };
  if (!(seller <= supervisor && supervisor <= manager)) return { ok: false, error: 'As alçadas precisam crescer: vendedor ≤ supervisor ≤ gestor.' };
  const seen = new Set<string>();
  const exceptions: PutPolicyBody['exceptions'] = [];
  for (const e of f.exceptions) {
    if (!e.seller_id) return { ok: false, error: 'Escolha o vendedor de cada exceção.' };
    if (seen.has(e.seller_id)) return { ok: false, error: 'Há duas exceções para o mesmo vendedor.' };
    seen.add(e.seller_id);
    const v = pct(e.pct);
    if (v === null) return { ok: false, error: 'Exceção com percentual inválido.' };
    if (v > manager) return { ok: false, error: 'Exceção acima da alçada do gestor.' };
    exceptions.push({ seller_id: e.seller_id, max_discount_pct: v });
  }
  return { ok: true, body: { seller_pct: seller, supervisor_pct: supervisor, manager_pct: manager, above_manager: f.above_manager, exceptions } };
}
