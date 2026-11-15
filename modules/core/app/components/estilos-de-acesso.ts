/** Estilos comuns das telas de acesso (Login, Crie sua senha, Esqueci a senha; RD-0022): título e link. */
import { StyleSheet } from 'react-native';
import { colors, fonte } from '@macuxi/ui/mobile';

export const estilosDeAcesso = StyleSheet.create({
  titulo: { ...fonte.display, fontSize: 22, color: colors.ink },
  link: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  linkTexto: { ...fonte.semibold, fontSize: 14, color: colors.accentInk },
});
