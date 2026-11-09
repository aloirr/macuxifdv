/** Estilos comuns das telas de acesso (Login, Crie sua senha, Esqueci a senha; RD-0022): entrada, rótulo, olho e link. */
import { StyleSheet } from 'react-native';
import { colors, fonts, radius } from '@macuxi/ui/mobile';

export const estilosDeAcesso = StyleSheet.create({
  titulo: { fontFamily: fonts.display, fontSize: 24, color: colors.ink },
  rotulo: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  olho: { position: 'absolute', right: 0, top: 0, bottom: 0, minWidth: 52, minHeight: 52, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  olhoTexto: { fontFamily: fonts.semibold, fontSize: 12, color: colors.accentInk },
  entrada: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  link: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  linkTexto: { fontFamily: fonts.semibold, fontSize: 14, color: colors.accentInk },
});
