/**
 * "Mais": as abas de módulo que não couberam na barra inferior (limite por variante, `lib/abas.ts`, T-0034/T-0170).
 * Só lista o que o shell já montou para o usuário (módulos efetivos: manifesto + licença + perfil + ação), então
 * nunca mostra tela sem licença ou perfil. Funciona offline (a visão vem dos módulos guardados no aparelho).
 * Cada item é uma aba: volta ao topo da pilha guardada dela (lib/historico-telas.ts, T-0071).
 * T-0182 (spec docs/design/telas/logo-cliente.md §5): no pé, "Licenciado para <nome fantasia>" (vazio = razão social) e, com a
 * logo guardada no aparelho, a placa 52/36 (decorativa: a frase já diz o nome). Sobe ao pé da tela quando sobra espaço.
 * Item 16 do teste de campo do Campo v1.0.16: a seção "Conta" com "Perfil", que abre o Perfil (rota `/profile` do
 * shell). No Gestão não há aba "Mais": o Perfil abre pelo nome no Início.
 */
import { useVisaoShell } from '@macuxi/platform-sdk/react';
import { Card, colors, Empty, Icon, PlacaLogoCliente, Screen, SectionHeader, type as t, type IconName } from '@macuxi/ui/mobile';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { abasDaVariante } from '@/lib/abas';
import { abrirAba } from '@/lib/historico-telas';
import { varianteAtual } from '@/lib/variante';
import { usePlataforma } from '@/state/plataforma';

export default function Mais() {
  const visao = useVisaoShell();
  const { mais } = abasDaVariante(visao.navegacao, varianteAtual());
  const { empresa } = usePlataforma();
  return (
    <Screen testID="tela-mais" cabecalho={{ titulo: 'Mais' }} contentStyle={{ flexGrow: 1 }}>
      <SectionHeader title="Outras telas" />
      {mais.length === 0 ? (
        <Empty text="Todas as suas telas já estão na barra de baixo." />
      ) : (
        mais.map((aba) => (
          <LinhaDoMais
            key={aba.href}
            testID={aba.testID.replace(/^tab-/, 'mais-')}
            icone={aba.icon}
            rotulo={aba.label}
            onPress={() => router.navigate(abrirAba(aba.href, false) as never)}
          />
        ))
      )}
      <SectionHeader title="Conta" />
      <LinhaDoMais testID="mais-perfil" icone="user" rotulo="Perfil" onPress={() => router.push('/profile')} />
      {empresa.nome ? (
        <View testID="mais-licenciado" style={{ marginTop: 'auto', paddingTop: 10, alignItems: 'center', gap: 10 }}>
          <Text style={[t.sub, { lineHeight: 18, textAlign: 'center' }]}>Licenciado para {empresa.nome}</Text>
          {empresa.logo ? <PlacaLogoCliente testID="mais-logo-cliente" fonte={empresa.logo.uri} tamanho="mais" proporcao={empresa.logo.proporcao} /> : null}
        </View>
      ) : null}
    </Screen>
  );
}

function LinhaDoMais({ testID, icone, rotulo, onPress }: { testID: string; icone: IconName; rotulo: string; onPress: () => void }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={rotulo} onPress={onPress}>
      <Card style={{ padding: 14, minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Icon name={icone} size={20} color={colors.ink2} />
        <View style={{ flex: 1 }}>
          <Text style={t.bodyStrong}>{rotulo}</Text>
        </View>
        <Icon name="chevron" size={18} color={colors.ink3} />
      </Card>
    </Pressable>
  );
}
