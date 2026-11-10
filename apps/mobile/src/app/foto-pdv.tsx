/**
 * Visualizador da foto do PDV (T-0147, imagem aprovada docs/design/telas/T-0147-fotos-pdv.png, quadro 3): fundo escuro,
 * fechar (X) com o nome do cliente e "Fachada · data" no topo, a foto inteira no meio. Aberto pela porta do Core
 * (`abrirFotoPdv`, services/foto-pdv.ts). Foto deste aparelho abre sem sinal; a da nuvem precisa de sinal e fica só em
 * memória. Fontes e textos em `@/lib/foto-pdv`.
 */
import { colors, fonts, Icon } from '@macuxi/ui/mobile';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { pedidoDaRota, ROTULO_FECHAR_FOTO } from '@/lib/foto-pdv';
import { carregarFotoPdv, type FotoCarregada } from '@/services/foto-pdv';
import { usePlataforma } from '@/state/plataforma';

export default function FotoPdvScreen() {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const pedido = pedidoDaRota(params);
  const { sessao } = usePlataforma();
  const insets = useSafeAreaInsets();
  const [foto, setFoto] = useState<FotoCarregada | null>(null);
  const arquivo = pedido?.arquivo_id ?? null;

  useEffect(() => {
    if (!arquivo) return;
    let vivo = true;
    setFoto(null);
    void carregarFotoPdv(arquivo).then((r) => {
      if (vivo) setFoto(r);
    });
    return () => {
      vivo = false;
    };
  }, [arquivo]);

  if (!sessao) return <Redirect href="/login" />;
  if (!pedido) return <Redirect href="/" />;

  const fechar = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <View style={[s.tela, { paddingBottom: insets.bottom }]} testID="foto-pdv">
      <View style={s.topo}>
        <Pressable onPress={fechar} hitSlop={12} accessibilityRole="button" accessibilityLabel={ROTULO_FECHAR_FOTO} testID="foto-pdv-fechar">
          <Icon name="close" size={22} color={colors.surface} />
        </Pressable>
        <View style={s.titulos}>
          {pedido.titulo ? <Text style={s.titulo} numberOfLines={1}>{pedido.titulo}</Text> : null}
          {pedido.subtitulo ? <Text style={s.subtitulo} numberOfLines={1}>{pedido.subtitulo}</Text> : null}
        </View>
      </View>
      <View style={s.corpo}>
        {foto === null ? (
          <ActivityIndicator color={colors.surface} testID="foto-pdv-carregando" />
        ) : foto.tipo === 'ok' ? (
          <Image source={{ uri: foto.uri }} style={s.imagem} resizeMode="contain" accessibilityLabel={pedido.subtitulo ?? 'Foto do PDV'} testID="foto-pdv-imagem" />
        ) : (
          <Text style={s.erro} testID="foto-pdv-erro">{foto.mensagem}</Text>
        )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  tela: { flex: 1, backgroundColor: colors.ink },
  topo: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingVertical: 14 },
  titulos: { flex: 1, minWidth: 0 },
  titulo: { fontFamily: fonts.semibold, fontSize: 16, color: colors.surface },
  subtitulo: { fontFamily: fonts.body, fontSize: 12, color: colors.darkMuted, marginTop: 2 },
  corpo: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  imagem: { width: '100%', height: '100%' },
  erro: { fontFamily: fonts.body, fontSize: 14, color: colors.darkMuted, textAlign: 'center', paddingHorizontal: 20 },
});
