/**
 * Etapas do login real (T-0094; spec docs/design/ciclo-de-senha.md §1 a §3). A "Crie sua senha" e a "Esqueci a senha" moram
 * na mesma rota `/login`: nenhuma rota do app abre antes da troca. A senha usada no login fica só no estado da tela
 * (`senha_atual` da etapa `trocar`), nunca em SecureStore, AsyncStorage, URL ou log, e some ao voltar ou entrar.
 *
 * Ao voltar da troca, do pedido ou pelo voltar do Android, o login reabre com o código da empresa E o e-mail preenchidos
 * (§2 item 8 e §3 Confirmação item 4; 🟡 2 da revisão de UX da fatia W, R-20261108-054817). A senha nunca volta.
 */
import type { DetalhesSenhaATrocar } from '@macuxi/core/contracts';

export type EtapaLogin =
  | { tipo: 'entrar'; aviso: string | null; codigo: string | null; email: string | null }
  | { tipo: 'trocar'; codigo_empresa: string; email: string; senha_atual: string; motivo: DetalhesSenhaATrocar['motivo'] }
  | { tipo: 'esqueci'; codigo_empresa: string; email: string };

/** A etapa do formulário de login (código, e-mail e senha). */
export type EtapaEntrar = Extract<EtapaLogin, { tipo: 'entrar' }>;

export const ETAPA_INICIAL: EtapaEntrar = { tipo: 'entrar', aviso: null, codigo: null, email: null };

/** Volta ao login com o aviso (se houver), o código e o e-mail; vazio (ou só espaços) vira "sem valor". */
export function etapaDeVolta(aviso: string | null | undefined, codigo: string | null | undefined, email: string | null | undefined): EtapaEntrar {
  const limpo = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  return { tipo: 'entrar', aviso: aviso ?? null, codigo: limpo(codigo), email: limpo(email) };
}

/**
 * Props da `TelaLogin` do Core na etapa `entrar`:
 * - `key` muda com o código e o e-mail, para a tela renascer preenchida ao voltar;
 * - `codigoSalvo`: o código que veio da troca ou do pedido; senão, o do último login neste aparelho;
 * - `emailInicial`: o e-mail que veio da troca ou do pedido. A prop é do Core (pedido R-20261108-054930 ao modulo-core);
 *   até ela existir na `TelaLogin`, o valor é ignorado pela tela e nada muda; quando existir, o login volta com o e-mail.
 */
export function propsDoLogin(
  etapa: EtapaEntrar,
  codigoSalvo: string | null | undefined,
): { key: string; codigoSalvo: string | null; aviso: string | null; emailInicial?: string } {
  const base = { key: `${etapa.codigo ?? 'salvo'}|${etapa.email ?? ''}`, codigoSalvo: etapa.codigo ?? codigoSalvo ?? null, aviso: etapa.aviso };
  return etapa.email ? { ...base, emailInicial: etapa.email } : base;
}
