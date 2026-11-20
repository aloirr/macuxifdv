/**
 * Sino do shell (T-0170; desenho `docs/desenho/tarefas-consultor.md` §7.2; imagem `2026-11-12-T0170-final-inicio-sino-aberto.png`).
 * Fica no cabeçalho de todas as telas do Campo e do Gestão: o shell entrega o `<Sino />` ao `CabecalhoTela` do kit pelo
 * `ProvedorSinoCabecalho` ((tabs)/_layout.tsx) e o põe à mão no Início (que não usa o `CabecalhoTela`).
 * - Bolinha (sem número, dono do produto 14/11/2026): acesa quando `useInicioCampo().sino.total` do Core passa de 0, lido uma vez
 *   no layout (`ProvedorContagemSino`); a bolinha é do `SinoNotificacoes`.
 * - Toque: abre o balão com o `BalaoRecadosETarefas` do Core (no máximo 5 itens e "Ver todos"). Sem o balão exportado pelo Core,
 *   o toque abre direto a lista.
 * - "Ver todos" abre `/m/recados-e-tarefas` (ou a central antiga, se a página ainda não existe); a tarefa abre `/m/tarefa?id=`.
 * - Botão, cores (MC-0009) e leitura do TalkBack: o `SinoNotificacoes` do kit, o sino padrão de todas as telas
 *   (RD-2450, v1.0.17; `docs/design/componentes.md` §5.4). O shell só passa o total e o toque. `sobreFaixa` ligado quando o
 *   sino vem do `CabecalhoTela` (faixa Azul noite); desligado no Início do Gestão (Pérola).
 * Formulário alterado (RN-VEN-38): a navegação do shell passa por `bloqueioDoShell.tentarSair`.
 */
import * as appCore from '@macuxi/core/app';
import { useVisaoShell } from '@macuxi/platform-sdk/react';
import { colors, radius, shadow, SinoNotificacoes } from '@macuxi/ui/mobile';
import { router } from 'expo-router';
import { createContext, useContext, useState, type ComponentType, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { destinoDaTarefa, destinoVerTodos } from '@/lib/sino';
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

export function Sino({ testID = 'sino', sobreFaixa = false }: { testID?: string; sobreFaixa?: boolean }) {
  const total = useContext(ContagemCtx);
  const visao = useVisaoShell();
  const insets = useSafeAreaInsets();
  const [aberto, setAberto] = useState(false);

  const ir = (href: string) => bloqueioDoShell.tentarSair(() => router.navigate(href as never));
  const verTodos = () => ir(destinoVerTodos((c) => visao.pagina(c) !== null));

  return (
    <>
      <SinoNotificacoes testID={testID} total={total} sobreFaixa={sobreFaixa} onPress={() => (BalaoDoCore ? setAberto(true) : verTodos())} />
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
  fundo: { flex: 1, backgroundColor: colors.scrim, paddingHorizontal: 16 },
  balao: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden', ...shadow.aviso },
});
