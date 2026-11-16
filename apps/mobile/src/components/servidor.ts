import { colors, ESTILO_CAMPO, fonte } from '@macuxi/ui/mobile';
import { StyleSheet } from 'react-native';

/**
 * Campo "Servidor" do login e do perfil (RD-0955): a entrada é a do kit (`ESTILO_CAMPO.entrada`, 16, mesma altura) em
 * `fonte.mono`; o endereço salvo sai em mono 14.
 */
const estilos = StyleSheet.create({
  // várias linhas no login (endereço longo de túnel): o texto fica no meio, com folga em cima e embaixo
  entrada: { paddingVertical: 10, textAlignVertical: 'center' },
  endereco: { ...fonte.mono, fontSize: 14, color: colors.ink },
});

export const ENTRADA_SERVIDOR = [ESTILO_CAMPO.entrada, fonte.mono, estilos.entrada];
export const ENDERECO_SERVIDOR = estilos.endereco;
