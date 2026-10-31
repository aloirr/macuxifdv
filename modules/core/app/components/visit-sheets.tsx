/**
 * Check-in único: folhas compartilhadas por Início, Rota e ficha do cliente.
 * - "Você já está em atendimento" (check-in bloqueado por outro atendimento aberto);
 * - Checkout ("Como terminou a visita?" com pedido / sem pedido + motivo);
 * - aviso rápido no topo (check-in feito, checkout feito, mensagens do servidor).
 * Depois do checkout o app volta sempre para a aba Rota (próximo cliente do dia).
 * Cada tela do Core é montada dentro do provider (`comVisitas`), então qualquer uma abre com useVisitSheets().
 * O checkout lista as etapas do slot `visita.etapas_checkout` e bloqueia a conclusão enquanto houver etapa
 * obrigatória pendente de módulo ativo (RN-CORE-12).
 */
import { useExtensoes, useMotorSync } from '@macuxi/platform-sdk/react';
import { colors, fonts, formatHHMM, Icon, radius, type as t } from '@macuxi/ui/mobile';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NO_ORDER_REASONS, type ContextoCheckout, type EtapaCheckout } from '../../contracts';
import { fazerCheckout } from '../lib/acoes-visita';
import { abrirRota } from '../lib/navegacao';
import { useCore } from '../lib/usar-core';
import { checkoutDuration, ordersInVisit, visitOrdersLabel } from '../lib/visit';

type Sheet = { kind: 'blocked'; target: string; serverMessage?: string; openName?: string; openAt?: string | null } | { kind: 'checkout' } | null;
type ToastTone = 'success' | 'warning';

interface VisitSheetsApi {
  /** abre o checkout do atendimento aberto */
  askCheckout: () => void;
  /** mostra o aviso de check-in bloqueado ao tentar iniciar `targetName` */
  showBlocked: (targetName: string) => void;
  toast: (message: string, tone?: ToastTone) => void;
}

const Ctx = createContext<VisitSheetsApi | null>(null);

export function useVisitSheets(): VisitSheetsApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useVisitSheets fora do VisitSheetsProvider');
  return v;
}

/** Itens de visita na fila do motor (para tratar rejeições do servidor). */
function useFilaDeVisitas() {
  const { estado } = useMotorSync();
  return useMemo(() => estado.fila.filter((i) => i.entidade === 'visita'), [estado.fila]);
}

export function VisitSheetsProvider({ children }: { children: ReactNode }) {
  const core = useCore();
  const insets = useSafeAreaInsets();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [toastState, setToast] = useState<{ message: string; tone: ToastTone } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback((message: string, tone: ToastTone = 'success') => {
    setToast({ message, tone });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 3800);
  }, []);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // avisos do servidor: item de visita REJEITADO na fila (check-in recusado porque há outro atendimento aberto,
  // por exemplo em outro aparelho; ou checkout de visita que o servidor já fechou na virada do dia).
  const { motor, armazem } = core;
  const fila = useFilaDeVisitas();
  useEffect(() => {
    if (!motor || !armazem) return;
    for (const item of fila) {
      if (item.situacao !== 'falhou') continue;
      const p = (item.payload ?? {}) as { id?: string; visit_id?: string };
      if (p.visit_id) {
        // checkout recusado: o servidor já fechou o atendimento; vale o fechamento automático
        const visitId = p.visit_id;
        void armazem.atualizarVisitas((l) => l.map((v) => (v.id === visitId ? { ...v, closed_by: 'auto' as const } : v)));
        toast(item.ultimo_erro || 'O servidor já havia fechado este atendimento na virada do dia.', 'warning');
      } else if (p.id) {
        // check-in recusado: sai do aparelho e mostra o bloqueio com a mensagem do servidor
        const visitId = p.id;
        const minha = armazem.obter().visitas.find((v) => v.id === visitId);
        void armazem.atualizarVisitas((l) => l.filter((v) => v.id !== visitId));
        setSheet({ kind: 'blocked', target: minha?.customer_name || item.detalhe, serverMessage: item.ultimo_erro });
      }
      void motor.descartar(item.id);
    }
  }, [fila, motor, armazem, toast]);

  const api = useMemo<VisitSheetsApi>(
    () => ({
      askCheckout: () => setSheet({ kind: 'checkout' }),
      showBlocked: (target) => setSheet({ kind: 'blocked', target }),
      toast,
    }),
    [toast],
  );

  return (
    <Ctx.Provider value={api}>
      <View style={{ flex: 1 }}>
        {children}
        {toastState ? (
          <View style={[styles.toast, { top: insets.top + 14, backgroundColor: toastState.tone === 'success' ? colors.success : colors.warning }]} pointerEvents="none" testID="visit-toast" accessibilityRole="alert">
            <Text style={styles.toastText}>{toastState.message}</Text>
          </View>
        ) : null}
      </View>
      <BlockedSheet sheet={sheet?.kind === 'blocked' ? sheet : null} onClose={() => setSheet(null)} onCheckout={() => setSheet({ kind: 'checkout' })} />
      <CheckoutSheet
        visible={sheet?.kind === 'checkout'}
        onClose={() => setSheet(null)}
        onDone={(name) => {
          setSheet(null);
          abrirRota();
          toast(`Checkout feito em ${name}. Check-in liberado para o próximo cliente.`);
        }}
      />
    </Ctx.Provider>
  );
}

/** Monta uma tela do Core dentro do provider das folhas de visita. */
export function comVisitas(Tela: ComponentType): ComponentType {
  const Envolvida: ComponentType = () => (
    <VisitSheetsProvider>
      <Tela />
    </VisitSheetsProvider>
  );
  Envolvida.displayName = `comVisitas(${Tela.displayName ?? Tela.name ?? 'Tela'})`;
  return Envolvida;
}

export function BottomSheet({ visible, onClose, label, testID, children }: { visible: boolean; onClose: () => void; label: string; testID: string; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Fechar" />
      <View style={[styles.sheet, { paddingBottom: 24 + insets.bottom }]} testID={testID} accessibilityViewIsModal accessibilityLabel={label}>
        {children}
      </View>
    </Modal>
  );
}

function BlockedSheet({ sheet, onClose, onCheckout }: { sheet: Extract<Sheet, { kind: 'blocked' }> | null; onClose: () => void; onCheckout: () => void }) {
  const { atendimentoAberto: openVisit, tz } = useCore();
  const openName = openVisit?.customer_name || sheet?.openName || 'outro cliente';
  const openAt = openVisit?.checkin_at ?? sheet?.openAt ?? null;
  return (
    <BottomSheet visible={sheet !== null} onClose={onClose} label="Check-in bloqueado" testID="blocked-sheet">
      <View style={styles.lockTile}>
        <Icon name="lock" size={22} color={colors.warning} />
      </View>
      <Text style={styles.title}>Você já está em atendimento</Text>
      {sheet?.serverMessage ? (
        <>
          <Text style={styles.para}>{sheet.serverMessage}</Text>
          <Text style={styles.para}>
            O check-in em <Text style={styles.strong}>{sheet.target}</Text> foi descartado.
          </Text>
        </>
      ) : (
        <Text style={styles.para}>
          O check-in em <Text style={styles.strong}>{openName}</Text> está aberto{openAt ? ` desde ${formatHHMM(openAt, tz)}` : ''}. Só é possível um check-in por vez: faça o checkout antes de iniciar{' '}
          <Text style={styles.strong}>{sheet?.target ?? 'outro cliente'}</Text>.
        </Text>
      )}
      <Text style={styles.free}>Pedidos para outros clientes continuam liberados.</Text>
      <SheetButton testID="blocked-checkout" label={`Fazer checkout de ${openName}`} bg={colors.ink} fg="#FFFFFF" height={50} disabled={!openVisit} onPress={onCheckout} />
      <SheetButton testID="blocked-back" label="Voltar" bg={colors.surface} fg={colors.ink} border={colors.lineStrong} height={46} onPress={onClose} />
    </BottomSheet>
  );
}

function CheckoutSheet({ visible, onClose, onDone }: { visible: boolean; onClose: () => void; onDone: (customerName: string) => void }) {
  const core = useCore();
  const open = core.atendimentoAberto;
  const etapas = useExtensoes<EtapaCheckout<ComponentType<{ contexto: ContextoCheckout }>>>('visita.etapas_checkout');
  const [result, setResult] = useState<'order' | 'no_order' | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const orders = useMemo(() => (open ? ordersInVisit(open, core.pedidos) : []), [open, core.pedidos]);
  const hasOrder = orders.length > 0;

  // ao abrir: "Com pedido" já marcado se houver pedido na visita
  const openedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!visible) {
      openedFor.current = null;
      return;
    }
    if (open && openedFor.current !== open.id) {
      openedFor.current = open.id;
      setResult(hasOrder ? 'order' : null);
      setReason(null);
    }
  }, [visible, open, hasOrder]);

  // atendimento fechado por fora (virada do dia, servidor): fecha a folha
  useEffect(() => {
    if (visible && !open) onClose();
  }, [visible, open, onClose]);

  if (!open) return null;

  const name = open.customer_name;
  const since = formatHHMM(open.checkin_at, core.tz);
  // RN-CORE-12: etapas obrigatórias registradas por módulos ativos (ex.: pesquisa) precisam estar cumpridas
  const contexto: ContextoCheckout = { clienteId: open.customer_id, nomeCliente: name, visitaId: open.id, paradaId: open.route_stop_id };
  const pendentes = etapas.filter((e) => e.payload.obrigatoria && !e.payload.concluida(contexto));
  const canConfirm = !salvando && pendentes.length === 0 && ((result === 'order' && hasOrder) || (result === 'no_order' && Boolean(reason)));

  const confirm = async () => {
    if (!canConfirm || !core.motor || !core.armazem) return;
    setSalvando(true);
    try {
      const acao = { motor: core.motor, armazem: core.armazem, tz: core.tz, vendedorId: core.vendedorId };
      const done =
        result === 'order'
          ? await fazerCheckout(acao, open.id, { outcome: 'order', order_id: open.order_id ?? orders[0]!.id, order_total_cents: orders.reduce((s, o) => s + o.total_cents, 0) })
          : await fazerCheckout(acao, open.id, { outcome: 'no_order', no_order_reason: reason ?? '' });
      if (done) onDone(name);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} label="Checkout" testID="checkout-sheet">
      <View style={{ gap: 2 }}>
        <Text style={styles.overline}>CHECKOUT</Text>
        <Text style={styles.title}>{name}</Text>
        <Text style={t.sub}>
          Check-in desde {since} · duração {checkoutDuration(open.checkin_at, new Date())}
        </Text>
      </View>
      <Text style={[t.bodyStrong, { fontSize: 13 }]}>Como terminou a visita?</Text>
      <Pressable
        testID="checkout-with-order"
        accessibilityRole="radio"
        accessibilityState={{ checked: result === 'order', disabled: !hasOrder }}
        disabled={!hasOrder}
        onPress={() => setResult('order')}
        style={[styles.option, { minHeight: 56, gap: 2 }, result === 'order' ? styles.optionOrderOn : null, !hasOrder && { opacity: 0.55 }]}>
        <Text style={styles.optionTitle}>Com pedido</Text>
        <Text style={t.small}>{hasOrder ? `${visitOrdersLabel(orders)} ${orders.length > 1 ? 'feitos' : 'feito'} nesta visita` : 'Nenhum pedido feito nesta visita ainda'}</Text>
      </Pressable>
      <Pressable
        testID="checkout-no-order"
        accessibilityRole="radio"
        accessibilityState={{ checked: result === 'no_order' }}
        onPress={() => setResult('no_order')}
        style={[styles.option, { minHeight: 52, justifyContent: 'center' }, result === 'no_order' ? styles.optionNoOrderOn : null]}>
        <Text style={styles.optionTitle}>Sem pedido</Text>
      </Pressable>
      {result === 'no_order' ? (
        <View style={styles.reasons} accessibilityLabel="Motivo de não venda">
          {NO_ORDER_REASONS.map((r) => {
            const on = reason === r;
            return (
              <Pressable
                key={r}
                testID={`reason-${r}`}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                onPress={() => setReason(r)}
                style={[styles.reason, on ? { backgroundColor: colors.ink, borderColor: colors.ink } : null]}>
                <Text style={[styles.reasonText, on ? { color: '#FFFFFF' } : null]}>{r}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {etapas.map((e) => {
        const Etapa = e.payload.componente;
        const ok = e.payload.concluida(contexto);
        return (
          <View key={`${e.modulo}-${e.id}`} testID={e.payload.testID} style={styles.etapa}>
            <View style={styles.etapaTop}>
              <Text style={[t.bodyStrong, { flex: 1 }]}>{e.payload.rotulo}</Text>
              <Text style={[styles.etapaTag, { color: ok ? colors.success : e.payload.obrigatoria ? colors.danger : colors.ink2 }]}>{ok ? 'Feita' : e.payload.obrigatoria ? 'Obrigatória' : 'Opcional'}</Text>
            </View>
            <Etapa contexto={contexto} />
          </View>
        );
      })}
      {pendentes.length > 0 ? (
        <Text testID="checkout-pendencias" style={styles.pendencia}>
          Falta concluir: {pendentes.map((e) => e.payload.rotulo).join(', ')}.
        </Text>
      ) : null}
      <SheetButton testID="checkout-confirm" label="Concluir checkout" bg={canConfirm ? colors.accent : '#B9C0C8'} fg="#FFFFFF" height={50} disabled={!canConfirm} onPress={() => void confirm()} />
      <Pressable testID="checkout-continue" accessibilityRole="button" onPress={onClose} style={styles.textBtn}>
        <Text style={styles.textBtnLabel}>Continuar no atendimento</Text>
      </Pressable>
    </BottomSheet>
  );
}

export function SheetButton({ label, onPress, bg, fg, border, height, disabled, testID }: { label: string; onPress: () => void; bg: string; fg: string; border?: string; height: number; disabled?: boolean; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.sheetBtn, { height, backgroundColor: bg, borderColor: border ?? 'transparent', borderWidth: border ? 1 : 0 }, pressed && { opacity: 0.8 }]}>
      <Text style={[styles.sheetBtnText, { color: fg, fontSize: height >= 50 ? 15 : 14 }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(22,32,42,0.45)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 18, paddingTop: 20, gap: 12, maxWidth: 560, alignSelf: 'center', width: '100%' },
  lockTile: { width: 44, height: 44, borderRadius: radius.lg, backgroundColor: colors.warningBg, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
  overline: { fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.7, color: colors.ink2 },
  para: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.ink2 },
  strong: { fontFamily: fonts.semibold, color: colors.ink },
  free: { fontFamily: fonts.semibold, fontSize: 13, color: colors.success },
  sheetBtn: { borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  sheetBtnText: { fontFamily: fonts.semibold },
  option: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, paddingVertical: 10, paddingHorizontal: 12 },
  optionOrderOn: { borderWidth: 2, borderColor: colors.success, backgroundColor: colors.successBg },
  optionNoOrderOn: { borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.ground },
  optionTitle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  reason: { height: 36, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  reasonText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.ink },
  etapa: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, padding: 12, gap: 8 },
  etapaTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  etapaTag: { fontFamily: fonts.semibold, fontSize: 12 },
  pendencia: { fontFamily: fonts.semibold, fontSize: 13, color: colors.danger },
  textBtn: { height: 44, alignItems: 'center', justifyContent: 'center' },
  textBtnLabel: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink2 },
  toast: { position: 'absolute', left: 14, right: 14, borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 12, shadowColor: '#16202A', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
  toastText: { fontFamily: fonts.body, fontSize: 13, lineHeight: 17.5, color: '#FFFFFF' },
});
