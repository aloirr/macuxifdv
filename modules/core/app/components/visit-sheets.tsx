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
import { Botao, ChipEstado, colors, Folha, fonts, formatHHMM, Icon, radius, space, type as t } from '@macuxi/ui/mobile';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { CheckoutVisita, ContextoCheckout, EtapaCheckout, MotivoClienteFechado } from '../../contracts';
import { prepararCheckoutVisita } from '../../domain';
import { capturarFotoFachada } from '../lib/foto-fachada';
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

/** Itens de visita (check-in e checkout) na fila do motor, para tratar rejeições do servidor. */
function useFilaDeVisitas() {
  const { estado } = useMotorSync();
  return useMemo(() => estado.fila.filter((i) => i.entidade === 'visita' || i.entidade === 'visita_checkout'), [estado.fila]);
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

  // avisos do servidor: item de visita REJEITADO na fila. Check-in recusado (cliente fora da carteira, regra do raio…):
  // o item sai da fila, a visita some da tela e o aviso mostra o motivo. Checkout recusado: o item sai e o atendimento
  // volta a ficar aberto para refazer, com a mensagem do servidor (a tela recalcula das linhas ⊕ fila).
  const { motor, armazem } = core;
  const fila = useFilaDeVisitas();
  useEffect(() => {
    if (!motor || !armazem) return;
    for (const item of fila) {
      if (item.situacao !== 'falhou') continue;
      if (item.entidade === 'visita_checkout') {
        toast(item.ultimo_erro || 'O servidor não aceitou o checkout. Confira os dados e conclua de novo.', 'warning');
      } else {
        const minha = armazem.obter().visitas.find((v) => v.id === item.id);
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

export function BottomSheet({ visible, onClose, label, testID, children, rodape }: { visible: boolean; onClose: () => void; label: string; testID: string; children: ReactNode; rodape?: { rotulo: string; onPress: () => void; testID?: string } }) {
  return (
    <Folha visivel={visible} onFechar={onClose} rotuloFechar="Fechar" rotuloAcessivel={label} rodape={rodape} testID={testID}>
      <View style={{ gap: space.md }}>{children}</View>
    </Folha>
  );
}

function BlockedSheet({ sheet, onClose, onCheckout }: { sheet: Extract<Sheet, { kind: 'blocked' }> | null; onClose: () => void; onCheckout: () => void }) {
  const { atendimentoAberto: openVisit, tz } = useCore();
  const openName = openVisit?.customer_name || sheet?.openName || 'outro cliente';
  const openAt = openVisit?.checkin_at ?? sheet?.openAt ?? null;
  return (
    <BottomSheet visible={sheet !== null} onClose={onClose} label="Check-in bloqueado" testID="blocked-sheet" rodape={{ rotulo: 'Voltar', onPress: onClose, testID: 'blocked-back' }}>
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
      <Botao testID="blocked-checkout" nivel="principal" rotulo={`Fazer checkout de ${openName}`} desligado={!openVisit} onPress={onCheckout} />
    </BottomSheet>
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ETAPA_MODULO_RE = /^[a-z][a-z0-9-]*$/;
const ETAPA_ID_RE = /^[a-z][a-z0-9_.-]*$/;

function CheckoutSheet({ visible, onClose, onDone }: { visible: boolean; onClose: () => void; onDone: (customerName: string) => void }) {
  const core = useCore();
  const { estado: estadoMotor } = useMotorSync();
  const open = core.atendimentoAberto;
  const etapas = useExtensoes<EtapaCheckout<ComponentType<{ contexto: ContextoCheckout }>>>('visita.etapas_checkout');
  // RN-CORE-12: com o Vendedor efetivo o resultado é pedido / sem pedido; sem ele (promotor) é "atendido"
  const vendedorEfetivo = estadoMotor.modulosAtivos.includes('vendedor');
  const [result, setResult] = useState<'order' | 'no_order' | 'atendido' | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [fotoFachada, setFotoFachada] = useState<string | null>(null);
  const [erroFoto, setErroFoto] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const orders = useMemo(() => (open ? ordersInVisit(open, core.pedidos) : []), [open, core.pedidos]);
  const hasOrder = orders.length > 0;
  const motivos = core.estado.motivos;
  const naoVenda = motivos.filter((m) => m.tipo === 'nao_venda').sort((x, y) => x.ordem - y.ordem);
  const fechados = motivos.filter((m) => m.tipo === 'cliente_fechado').sort((x, y) => x.ordem - y.ordem);

  // ao abrir: "Com pedido" já marcado se houver pedido na visita; promotor começa em "atendido"
  const openedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!visible) {
      openedFor.current = null;
      return;
    }
    if (open && openedFor.current !== open.id) {
      openedFor.current = open.id;
      setResult(vendedorEfetivo ? (hasOrder ? 'order' : null) : 'atendido');
      setReason(null);
      setFotoFachada(null);
      setErroFoto(null);
      setErro(null);
    }
  }, [visible, open, hasOrder, vendedorEfetivo]);

  // atendimento fechado por fora (virada do dia, servidor): fecha a folha
  useEffect(() => {
    if (visible && !open) onClose();
  }, [visible, open, onClose]);

  if (!open) return null;

  const name = open.customer_name;
  const since = formatHHMM(open.checkin_at, core.tz);
  // RN-CORE-14: cliente fechado (motivo do tipo cliente_fechado) dispensa as etapas e exige a foto da fachada
  const motivoSel = motivos.find((m) => m.id === reason) ?? null;
  const fechado = motivoSel?.tipo === 'cliente_fechado';
  const contexto: ContextoCheckout = {
    clienteId: open.customer_id,
    nomeCliente: name,
    visitaId: open.id,
    paradaId: open.route_stop_id,
    clienteFechado: fechado,
    motivoClienteFechado: fechado ? (motivoSel!.codigo as MotivoClienteFechado) : null,
  };
  // RN-CORE-12 (e RN-CORE-14): resultado, motivo, pedido e etapas obrigatórias dos módulos ativos — regra pura no domain
  const preparo = prepararCheckoutVisita({
    escolha: result === 'order' ? 'pedido' : result === 'no_order' ? 'sem_pedido' : result,
    vendedorEfetivo,
    motivo: motivoSel ? { tipo: motivoSel.tipo } : null,
    fotoFachada: Boolean(fotoFachada),
    temPedido: hasOrder,
    etapas: etapas.map((e) => ({ modulo: e.modulo, id: e.id, rotulo: e.payload.rotulo, obrigatoria: e.payload.obrigatoria, concluida: e.payload.concluida(contexto) })),
  });
  const resultado = preparo.resultado;
  const canConfirm = !salvando && preparo.pode;

  const tirarFoto = async () => {
    const ref = await capturarFotoFachada();
    if (ref && UUID_RE.test(ref)) {
      setFotoFachada(ref);
      setErroFoto(null);
    } else {
      setErroFoto('Não foi possível abrir a câmera. Confira a permissão de câmera e tente de novo.');
    }
  };

  const confirm = async () => {
    if (!canConfirm || !core.motor || !core.armazem || !resultado) return;
    setSalvando(true);
    setErro(null);
    try {
      const acao = { motor: core.motor, armazem: core.armazem, tz: core.tz, vendedorId: core.vendedorId };
      // etapas do slot: concluídas vão como "concluida"; as obrigatórias dispensadas pelo cliente fechado, como "dispensada"
      const etapasPayload: CheckoutVisita['etapas'] = preparo.etapasRegistro.filter((e) => ETAPA_MODULO_RE.test(e.modulo) && ETAPA_ID_RE.test(e.etapa));
      const done = await fazerCheckout(acao, open.id, {
        resultado,
        motivo_id: reason,
        pedido_id: resultado === 'pedido' ? (open.order_id ?? orders[0]?.id ?? null) : null,
        foto_fachada_id: fechado ? fotoFachada : null,
        etapas: etapasPayload,
        cliente: name,
      });
      if (done) onDone(name);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível concluir o checkout. Confira os dados e tente de novo.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} label="Checkout" testID="checkout-sheet" rodape={{ rotulo: 'Continuar no atendimento', onPress: onClose, testID: 'checkout-continue' }}>
      <View style={{ gap: 2 }}>
        <Text style={styles.overline}>CHECKOUT</Text>
        <Text style={styles.title}>{name}</Text>
        <Text style={t.sub}>
          Check-in desde {since} · duração {checkoutDuration(open.checkin_at, new Date())}
        </Text>
      </View>
      <Text style={[t.bodyStrong, { fontSize: 13 }]}>Como terminou a visita?</Text>
      {vendedorEfetivo ? (
        <>
          <Pressable
            testID="checkout-with-order"
            accessibilityRole="radio"
            accessibilityState={{ checked: result === 'order', disabled: !hasOrder }}
            disabled={!hasOrder}
            onPress={() => {
              setResult('order');
              setReason(null);
            }}
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
        </>
      ) : (
        <View testID="checkout-atendido" style={[styles.option, styles.optionOrderOn, { minHeight: 52, justifyContent: 'center' }]}>
          <Text style={styles.optionTitle}>Atendimento concluído</Text>
        </View>
      )}
      {result === 'no_order' || !vendedorEfetivo ? (
        <View style={styles.reasons} accessibilityLabel={vendedorEfetivo ? 'Motivo de não venda' : 'Cliente fechado?'}>
          {[...(vendedorEfetivo ? naoVenda : []), ...fechados].map((m) => {
            const on = reason === m.id;
            return (
              <Pressable
                key={m.id}
                testID={`reason-${m.codigo}`}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                onPress={() => setReason(on && !vendedorEfetivo ? null : m.id)}
                style={[styles.reason, on ? { backgroundColor: colors.ink, borderColor: colors.ink } : null]}>
                <Text style={[styles.reasonText, on ? { color: '#FFFFFF' } : null]}>{m.descricao}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {fechado ? (
        <View testID="checkout-foto-fachada" style={styles.etapa}>
          <Text style={[t.bodyStrong, { flex: 1 }]}>Foto da fachada (obrigatória)</Text>
          <Text style={t.small}>Cliente fechado: as etapas obrigatórias da visita ficam dispensadas.</Text>
          <Botao testID="checkout-tirar-foto" nivel="secundario" rotulo={fotoFachada ? 'Foto tirada · refazer' : 'Tirar foto da fachada'} onPress={() => void tirarFoto()} />
          {erroFoto ? <Text style={styles.pendencia}>{erroFoto}</Text> : null}
        </View>
      ) : null}
      {(fechado ? [] : etapas).map((e) => {
        const Etapa = e.payload.componente;
        const ok = e.payload.concluida(contexto);
        return (
          <View key={`${e.modulo}-${e.id}`} testID={e.payload.testID} style={styles.etapa}>
            <View style={styles.etapaTop}>
              <Text style={[t.bodyStrong, { flex: 1 }]}>{e.payload.rotulo}</Text>
              <ChipEstado pequeno texto={ok ? 'Feita' : e.payload.obrigatoria ? 'Obrigatória' : 'Opcional'} tom={ok ? 'sucesso' : e.payload.obrigatoria ? 'erro' : 'neutro'} />
            </View>
            <Etapa contexto={contexto} />
          </View>
        );
      })}
      {preparo.etapasPendentes.length > 0 ? (
        <Text testID="checkout-pendencias" style={styles.pendencia}>
          Falta concluir: {preparo.etapasPendentes.map((e) => e.rotulo).join(', ')}.
        </Text>
      ) : null}
      {erro ? (
        <Text testID="checkout-erro" style={styles.pendencia}>
          {erro}
        </Text>
      ) : null}
      <Botao testID="checkout-confirm" nivel="principal" rotulo="Concluir checkout" desligado={!canConfirm} ocupado={salvando} onPress={() => void confirm()} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  lockTile: { width: 48, height: 48, borderRadius: radius.cartao, backgroundColor: colors.warningBg, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
  overline: { fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.7, color: colors.ink2 },
  para: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.ink2 },
  strong: { fontFamily: fonts.semibold, color: colors.ink },
  free: { fontFamily: fonts.semibold, fontSize: 13, color: colors.success },
  option: { borderRadius: radius.cartao, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, paddingVertical: 10, paddingHorizontal: 12 },
  optionOrderOn: { borderWidth: 2, borderColor: colors.success, backgroundColor: colors.successBg },
  optionNoOrderOn: { borderWidth: 2, borderColor: colors.ink, backgroundColor: colors.ground },
  optionTitle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  reason: { minHeight: 44, paddingHorizontal: 14, borderRadius: radius.pilula, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  reasonText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  etapa: { borderRadius: radius.cartao, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, padding: 12, gap: 8 },
  etapaTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pendencia: { fontFamily: fonts.semibold, fontSize: 13, color: colors.danger },
  toast: { position: 'absolute', left: 14, right: 14, borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 12, shadowColor: '#16202A', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
  toastText: { fontFamily: fonts.body, fontSize: 13, lineHeight: 17.5, color: '#FFFFFF' },
});
