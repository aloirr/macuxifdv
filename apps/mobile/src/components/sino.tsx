/**
 * Sino do shell (T-0170; desenho `docs/desenho/tarefas-consultor.md` §7.2; imagem `2026-11-12-T0170-final-inicio-sino-aberto.png`).
 * Fica no cabeçalho de todas as telas do Campo e do Gestão: o shell entrega o `<Sino />` ao `CabecalhoTela` do kit pelo
 * `ProvedorSinoCabecalho` ((tabs)/_layout.tsx) e o põe à mão no Início (que não usa o `CabecalhoTela`).
 * - Bolinha (sem número, dono do produto 14/11/2026): acesa quando `useInicioCampo().sino.total` do Core (recados não lidos +
 *   tarefas novas, `contarSino`) passa de 0; o total é lido uma vez no layout (`ProvedorContagemSino`) e repartido por contexto
 *   com todos os sinos montados, inclusive o do Início (`temNovoNoSino`, `lib/sino.ts`). Premissa da Gestão: o layout é das duas variantes e o hook roda nas duas. A contagem sai só do
 *   aparelho (notificações + pull `tarefa`); a parte de Performance do hook não se aplica ao supervisor/gerente (a consulta de
 *   renovação recebe recusa do servidor, que o hook engole) e não afeta a bolinha. Enquanto o hook não tem dados (null), o sino fica sem bolinha.
 * - Toque: abre o balão com o `BalaoRecadosETarefas` do Core (no máximo 5 itens e "Ver todos"). Sem o balão exportado pelo Core,
 *   o toque abre direto a lista.
 * - "Ver todos" abre `/m/recados-e-tarefas` (ou a central antiga, se a página ainda não existe); a tarefa abre `/m/tarefa?id=`.
 * - `sobreFaixa` (MC-0009): ligado quando o sino vem do `CabecalhoTela` (faixa Azul noite); cores em `coresDoSino`.
 * Formulário alterado (RN-VEN-38): a navegação do shell passa por `bloqueioDoShell.tentarSair`.
 */
import * as appCore from '@macuxi/core/app';
import { useVisaoShell } from '@macuxi/platform-sdk/react';
import { colors, Icon, Pressionavel, radius, shadow } from '@macuxi/ui/mobile';
import { router } from 'expo-router';
import { createContext, useContext, useState, type ComponentType, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { coresDoSino, destinoDaTarefa, destinoVerTodos, leituraDoSino, temNovoNoSino } from '@/lib/sino';
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

/** Conta o sino uma vez para todos os sinos montados (o `sino.total` do Core; nenhuma contagem por tela). */
export function ProvedorContagemSino({ children }: { children: ReactNode }) {
  const total = appCore.useInicioCampo()?.sino.total ?? 0;
  return <ContagemCtx.Provider value={total}>{children}</ContagemCtx.Provider>;
}

const cor = (token: 'transparente' | keyof typeof colors) => (token === 'transparente' ? 'transparent' : colors[token]);

export function Sino({ testID = 'sino', sobreFaixa = false }: { testID?: string; sobreFaixa?: boolean }) {
  const total = useContext(ContagemCtx);
  const visao = useVisaoShell();
  const insets = useSafeAreaInsets();
  const [aberto, setAberto] = useState(false);
  const novo = temNovoNoSino(total);
  const c = coresDoSino(sobreFaixa);

  const ir = (href: string) => bloqueioDoShell.tentarSair(() => router.navigate(href as never));
  const verTodos = () => ir(destinoVerTodos((c) => visao.pagina(c) !== null));

  return (
    <>
      <Pressionavel
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={leituraDoSino(total)}
        onPress={() => (BalaoDoCore ? setAberto(true) : verTodos())}
        style={[s.botao, { backgroundColor: cor(c.botaoFundo), borderColor: cor(c.botaoBorda) }]}>
        <Icon name="bell" size={22} color={cor(c.icone)} />
        {novo ? (
          <View style={[s.bolinha, { backgroundColor: cor(c.bolinhaFundo), borderColor: cor(c.bolinhaAro) }]} testID={`${testID}-bolinha`} />
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
  // canto superior direito do ícone de 22 no botão de 48
  bolinha: { position: 'absolute', top: 10, right: 10, width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
  fundo: { flex: 1, backgroundColor: colors.scrim, paddingHorizontal: 16 },
  balao: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden', ...shadow.aviso },
});
