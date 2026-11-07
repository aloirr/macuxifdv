/** Campo "Prazo médio máximo (dias)" do cliente no BKO (T-0089, RN-VEN-25): vazio = sem teto; senão inteiro de 0 a 365. */
export function prazoMedioDoCampo(texto: string): { ok: true; valor: number | null } | { ok: false; mensagem: string } {
  const t = texto.trim();
  if (t === '') return { ok: true, valor: null };
  if (!/^\d+$/.test(t) || Number(t) > 365) return { ok: false, mensagem: 'Informe o prazo médio em dias, de 0 a 365, ou deixe vazio para não ter teto.' };
  return { ok: true, valor: Number(t) };
}
