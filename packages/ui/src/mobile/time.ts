/**
 * Datas e horas para exibição no fuso da empresa (padrão America/Manaus). A implementação mora em `@macuxi/comum/fuso`
 * (T-0029 E5): o `domain` dos módulos (ex.: PDF do pedido) formata no fuso sem importar a UI. Este arquivo só reexporta,
 * para as telas continuarem importando de `@macuxi/ui/mobile` (ou `/mobile/puro`).
 */
export * from '@macuxi/comum/fuso';
