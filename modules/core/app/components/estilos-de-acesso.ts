/** Estilos comuns das telas de acesso (Login, Crie sua senha, Esqueci a senha; RD-0022): título e link. */
import { StyleSheet } from 'react-native';
import { colors, fonte, type as t } from '@macuxi/ui/mobile';

export const estilosDeAcesso = StyleSheet.create({
  titulo: t.h1Small,
  link: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  linkTexto: { ...fonte.semibold, fontSize: 14, color: colors.accentInk },
});
