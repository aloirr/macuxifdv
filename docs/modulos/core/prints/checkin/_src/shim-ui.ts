// Reexporta o kit real e troca só o hook de sincronização (que precisa do shell).
export * from '@ui-real';
export const useSincronizacao = () => ({ naFila: 0 });
