// Reexporta o kit real e troca só o hook de atualização (que precisa do shell).
export * from '@ui-real';
export const useAtualizacaoAutomatica = () => ({ puxando: false, puxar: () => undefined, atualizadoEm: null, rodape: '' });
