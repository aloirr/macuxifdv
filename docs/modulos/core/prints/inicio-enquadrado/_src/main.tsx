// Entrada do gerador: a TelaInicioCampo REAL, com o sino simulado no ProvedorSinoCabecalho e a fonte do sistema escalada.
import { colors, fonts, Icon, ProvedorSinoCabecalho, Pressionavel } from '@macuxi/ui/mobile';
import { createRoot } from 'react-dom/client';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View, Text } from 'react-native';

import { TelaInicioCampo } from '@core/app/telas/inicio/tela-inicio-campo';

const q = new URLSearchParams(location.search);
const [L, A] = (q.get('t') ?? '360x640').split('x').map(Number);
const TOP = 24;
const BOTTOM = 24;
const ABAS = 64;

function Sino() {
  return (
    <Pressionavel testID="sino" accessibilityRole="button" accessibilityLabel="Sino" style={{ width: 48, height: 48, borderRadius: 24, borderWidth: 1, borderColor: colors.faixaTrilho, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="bell" size={22} color={colors.faixaTitulo} />
      <View style={{ position: 'absolute', top: 10, right: 11, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.graficoEscuro, borderWidth: 2, borderColor: colors.faixa }} />
    </Pressionavel>
  );
}

function Abas() {
  return (
    <View testID="abas" style={{ height: ABAS + BOTTOM, paddingBottom: BOTTOM, flexDirection: 'row', backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: colors.line }}>
      {['Início', 'Clientes', 'Pedidos', 'Mais'].map((n, i) => (
        <View key={n} style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 12, color: i === 0 ? colors.ink : colors.ink2 }}>{n}</Text>
        </View>
      ))}
    </View>
  );
}

createRoot(document.getElementById('raiz')!).render(
  <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: L, height: A }, insets: { top: TOP, bottom: BOTTOM, left: 0, right: 0 } }}>
    <ProvedorSinoCabecalho value={<Sino />}>
      <View style={{ width: L, height: A, flexDirection: 'column', backgroundColor: colors.ground }}>
        <View testID="barra-status" style={{ height: TOP, backgroundColor: colors.faixa, position: 'absolute', top: 0, left: 0, right: 0, zIndex: 5 }} />
        <View style={{ flex: 1 }}>
          <TelaInicioCampo onAbrirPerformance={() => undefined} onPerfil={() => undefined} />
        </View>
        <Abas />
      </View>
    </ProvedorSinoCabecalho>
  </SafeAreaProvider>,
);
