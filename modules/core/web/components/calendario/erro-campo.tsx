/** Erro de um campo da página Calendário (Feriados e Almoço): 13/400, ligado ao campo por `id` (aria-describedby). */
export function ErroCampo({ id, texto }: { id: string; texto?: string }) {
  return texto ? (
    <span id={id} className="text-[13px] font-normal text-danger" data-testid={id}>
      {texto}
    </span>
  ) : null;
}
