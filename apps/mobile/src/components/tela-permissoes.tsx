/**
 * T-0145: tela "Permissões", por cima de tudo, antes do login e da sincronização (o shell não monta as rotas enquanto falta
 * permissão). Imagem aprovada pelo dono do produto (R-20261110-093125): `docs/design/telas/T-0145-permissoes.png`, medidas em
 * `docs/design/permissoes-e-fotos-pdv.md` §1. Marca, título, subtítulo, uma linha por permissão que falta (ícone, nome,
 * motivo e, só na negada, "Negada"), o cartão dos 2 passos da localização e UM botão no pé. R-20261120-052422: a tela só aparece quando,
 * depois das janelas do Android na abertura, alguma ficou negada; sem o link "Como usamos a localização".
 * Regras e textos em `lib/permissoes.ts`. O Voltar do Android fecha o app (não há "Agora não").
 */
import { Button, Card, colors, fonte, Icon, type as t, type IconName } from '@macuxi/ui/mobile';
import { useEffect } from 'react';
import { AccessibilityInfo, BackHandler, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ROTULO_NEGADA, type IdPermissao, type TelaDePermissoes } from '@/lib/permissoes';

/** Ícone da linha (T-0145). */
const ICONE: Readonly<Record<IdPermissao, IconName>> = {
  notificacoes: 'bell',
  localizacao: 'pin',
  camera: 'camera',
  galeria: 'galeria',
};
const ICONE_CONFIGURACOES: IconName = 'config';

export function TelaPermissoes({
  marca,
  tela,
  pedindo,
  onBotao,
}: {
  /** "Macuxi Campo" / "Macuxi Gestão". */
  marca: string;
  tela: TelaDePermissoes;
  /** Diálogo ou configurações abertos pelo botão (carregando, sem toque duplo). */
  pedindo: boolean;
  onBotao: () => void;
}) {
  const insets = useSafeAreaInsets();
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(tela.titulo);
  }, [tela.titulo]);
  // sem "Agora não": o Voltar do Android fecha o app
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      BackHandler.exitApp();
      return true;
    });
    return () => sub.remove();
  }, []);
  const passos = tela.passosLocalizacao;
  return (
    <View testID="tela-permissoes" style={[StyleSheet.absoluteFill, styles.root]} accessibilityViewIsModal>
      <ScrollView contentContainerStyle={[styles.conteudo, { paddingTop: Math.max(36, insets.top + 24) }]}>
        <View style={{ gap: 6 }}>
          <Text style={styles.marca}>{marca}</Text>
          <Text style={styles.titulo} accessibilityRole="header">
            {tela.titulo}
          </Text>
          <Text style={styles.subtitulo}>{tela.subtitulo}</Text>
        </View>
        <Card style={styles.cartao}>
          {tela.linhas.map((l, k) => (
            <View
              key={l.id}
              testID={`permissao-${l.id}`}
              style={[styles.linha, k > 0 ? styles.divisoria : null]}
              accessible
              accessibilityLabel={`${l.nome}. ${l.texto}${l.situacao === 'negada' ? ` ${ROTULO_NEGADA}.` : ''}`}
            >
              <View style={styles.circulo}>
                <Icon name={ICONE[l.id]} size={20} color={colors.ink2} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.nome}>{l.nome}</Text>
                <Text style={styles.motivo}>{l.texto}</Text>
              </View>
              {l.situacao === 'negada' ? (
                <Text style={styles.negada} testID={`permissao-${l.id}-situacao`}>
                  {ROTULO_NEGADA}
                </Text>
              ) : null}
            </View>
          ))}
        </Card>
        {passos ? (
          <Card testID="permissao-passos-localizacao" style={styles.cartao}>
            <View style={styles.passo} accessible accessibilityLabel={`Passo 1, feito: ${passos.feito}.`}>
              <View style={[styles.numero, { backgroundColor: colors.success }]}>
                <Icon name="check" size={14} color={colors.surface} strokeWidth={2.6} />
              </View>
              <Text style={[styles.passoTexto, { color: colors.ink2 }]}>{passos.feito}</Text>
            </View>
            <View style={[styles.passo, styles.divisoria]} accessible accessibilityLabel={`Passo 2: ${passos.falta}`}>
              <View style={[styles.numero, { backgroundColor: colors.ink }]}>
                <Text style={styles.numeroTexto}>2</Text>
              </View>
              <Text style={styles.passoTexto}>
                {passos.faltaTrechos.map((p, k) => (
                  <Text key={k} style={p.forte ? styles.forte : null}>
                    {p.texto}
                  </Text>
                ))}
              </Text>
            </View>
          </Card>
        ) : null}
      </ScrollView>
      {tela.botao ? (
        <View style={[styles.pe, { paddingBottom: Math.max(16, insets.bottom + 12) }]}>
          <Button
            testID="permissoes-botao"
            label={tela.botao.rotulo}
            variant="accent"
            height={52}
            icon={tela.botao.acao === 'pedir' ? undefined : ICONE_CONFIGURACOES}
            loading={pedindo}
            onPress={onBotao}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.ground, zIndex: 11 },
  conteudo: { flexGrow: 1, paddingHorizontal: 20, gap: 18, paddingBottom: 24 },
  marca: { ...fonte.bold, fontSize: 14, color: colors.accentInk },
  titulo: t.h1,
  subtitulo: { ...fonte.body, fontSize: 16, color: colors.ink2 },
  cartao: { padding: 0 },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, minHeight: 68, paddingVertical: 10 },
  divisoria: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  circulo: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.neutralBg, alignItems: 'center', justifyContent: 'center' },
  nome: { ...fonte.semibold, fontSize: 16, color: colors.ink },
  motivo: { ...fonte.body, fontSize: 14, color: colors.ink2 },
  negada: { ...fonte.semibold, fontSize: 14, color: colors.danger },
  passo: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  numero: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  numeroTexto: { ...fonte.semibold, fontSize: 12, color: colors.surface },
  passoTexto: { flex: 1, ...fonte.body, fontSize: 14, color: colors.ink },
  forte: { ...fonte.semibold },
  pe: { paddingHorizontal: 20, paddingTop: 8 },
});
