/** Estilos comuns das telas de acesso (Login, Crie sua senha, Esqueci a senha; RD-0022): entrada, rótulo e link. */
import { StyleSheet } from 'react-native';
import { colors, fonte, radius } from '@macuxi/ui/mobile';

export const estilosDeAcesso = StyleSheet.create({
  titulo: { ...fonte.display, fontSize: 22, color: colors.ink },
  rotulo: { ...fonte.semibold, fontSize: 14, color: colors.ink },
  entrada: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    ...fonte.body,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  link: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  linkTexto: { ...fonte.semibold, fontSize: 14, color: colors.accentInk },
});
