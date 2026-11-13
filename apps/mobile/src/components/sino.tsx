/**
 * Sino do shell (T-0170; desenho `docs/desenho/tarefas-consultor.md` §7.2; imagem `2026-11-12-T0170-final-inicio-sino-aberto.png`).
 * Fica no cabeçalho de todas as telas do Campo e do Gestão: o shell entrega o `<Sino />` ao `CabecalhoTela` do kit pelo
 * `ProvedorSinoCabecalho` ((tabs)/_layout.tsx) e o põe à mão no Início (que não usa o `CabecalhoTela`).
 * - Número: notificações não lidas do Core (`useNotificacoes().naoLidas`), lido uma vez no layout (`ProvedorContagemSino`), e
 *   não uma vez por tela montada; escondido com 0 e "9+" acima de 9 (`lib/sino.ts`).
 * - Toque: abre o balão com o `BalaoRecadosETarefas` do Core (no máximo 5 itens e "Ver todos"). Sem o balão exportado pelo Core,
 *   o toque abre direto a lista.
 * - "Ver todos" abre `/m/recados-e-tarefas` (ou a central antiga, se a página ainda não existe); a tarefa abre `/m/tarefa?id=`.
 * - `sobreFaixa` (MC-0009): ligado quando o sino vem do `CabecalhoTela` (faixa Azul noite); cores em `coresDoSino`.
 * Formulário alterado (RN-VEN-38): a navegação do shell passa por `bloqueioDoShell.tentarSair`.
 */
import * as appCore from '@macuxi/core/app';
import { useVisaoShell } from '@macuxi/platform-sdk/react';
import { colors, fonts, Icon, Pressionavel, radius, shadow } from '@macuxi/ui/mobile';
import { router } from 'expo-router';
import { createContext, useContext, useState, type ComponentType, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { coresDoSino, destinoDaTarefa, destinoVerTodos, leituraDoSino, numeroDoSino } from '@/lib/sino';
import { bloqueioDoShell } from '@/state/bloqueio-do-shell';

interface PropsBalaoCore {
  onVerTodos: () => void;
  abrirTarefa: (tarefaId: string) => void;
  onFechar?: () => void;
}

/** Conteúdo do balão, do Core (opcional até o Core exportar; a costura da T-0170 é em `modules/core/app/index.ts`). */
const BalaoDoCore = (appCore as unknown as { BalaoRecadosETarefas?: ComponentType<PropsBalaoCore> }).BalaoRecadosETarefas;

const ContagemCtx = createContext(0);
ContagemCtx.displayName = 'ContagemSino';

/** Lê as não lidas uma vez para todos os sinos montados (uma leitura do banco do aparelho, não uma por tela). */
export function ProvedorContagemSino({ children }: { children: ReactNode }) {
  const { naoLidas } = appCore.useNotificacoes();
  return <ContagemCtx.Provider value={naoLidas}>{children}</ContagemCtx.Provider>;
}

const cor = (token: 'transparente' | keyof typeof colors) => (token === 'transparente' ? 'transparent' : colors[token]);

export function Sino({ testID = 'sino', sobreFaixa = false }: { testID?: string; sobreFaixa?: boolean }) {
  const naoLidas = useContext(ContagemCtx);
  const visao = useVisaoShell();
  const insets = useSafeAreaInsets();
  const [aberto, setAberto] = useState(false);
  const numero = numeroDoSino(naoLidas);
  const c = coresDoSino(sobreFaixa);

  const ir = (href: string) => bloqueioDoShell.tentarSair(() => router.navigate(href as never));
  const verTodos = () => ir(destinoVerTodos((c) => visao.pagina(c) !== null));

  return (
    <>
      <Pressionavel
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={leituraDoSino(naoLidas)}
        onPress={() => (BalaoDoCore ? setAberto(true) : verTodos())}
        style={[s.botao, { backgroundColor: cor(c.botaoFundo), borderColor: cor(c.botaoBorda) }]}>
        <Icon name="bell" size={22} color={cor(c.icone)} />
        {numero ? (
          <View style={[s.numero, { backgroundColor: cor(c.contadorFundo), borderColor: cor(c.contadorAro) }]} testID={`${testID}-numero`}>
            <Text style={[s.numeroTexto, { color: cor(c.contadorNumero) }]} numberOfLines={1}>
              {numero}
            </Text>
          </View>
        ) : null}
      </Pressionavel>
      {BalaoDoCore ? (
        <Modal visible={aberto} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setAberto(false)}>
          <Pressable testID={`${testID}-fundo`} accessibilityLabel="Fechar recados e tarefas" style={s.fundo} onPress={() => setAberto(false)}>
            <Pressable style={[s.balao, { marginTop: insets.top + 72 }]} onPress={() => undefined}>
              <BalaoDoCore onVerTodos={verTodos} abrirTarefa={(id) => ir(destinoDaTarefa(id))} onFechar={() => setAberto(false)} />
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </>
  );
}

const s = StyleSheet.create({
  botao: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numero: {
    position: 'absolute',
    top: -8,
    right: -8,
    // MC-0009: 26 dp com aro de 2 deixam 22 dp por dentro, o bastante para o "9+" sem cortar
    minWidth: 26,
    height: 26,
    paddingHorizontal: 5,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numeroTexto: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, includeFontPadding: false, textAlignVertical: 'center' },
  fundo: { flex: 1, backgroundColor: colors.scrim, paddingHorizontal: 16 },
  balao: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden', ...shadow.aviso },
});
