/**
 * Folhas das ações do pedido (detalhe do pedido):
 * - Excluir: confirmação com motivo opcional (excluir = cancelar; o pedido não é apagado);
 * - Exportar PDF: para o cliente (sem desconto) ou para o escritório (tabela, desconto, alçada, histórico).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { BotaoFolha, Icon, LinhaOpcaoFolha, colors, fonte, radius, type as t } from '@macuxi/ui/mobile';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { OrderPdfView } from '../lib/order-pdf';
import { textoCancelarDocumento } from '../lib/textos-pedido';

/** Folha inferior (cópia local: o kit do Core não é importável pelo Vendedor). */
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

export function DeleteOrderSheet({
  visible,
  title,
  queued,
  ehOrcamento = false,
  solicitaAoErp = false,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  queued: boolean;
  ehOrcamento?: boolean;
  /** RN-VEN-31 (T-0114): pedido já enviado com o aceite do conector: o texto diz que o cancelamento é pedido ao ERP */
  solicitaAoErp?: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (visible) setReason('');
  }, [visible]);
  const x = textoCancelarDocumento({ ehOrcamento, naFila: queued, titulo: title, solicitaAoErp });
  return (
    <BottomSheet visible={visible} onClose={onClose} label={x.rotuloAcessivel} testID="delete-sheet">
      <View style={[styles.tile, { backgroundColor: colors.dangerBg }]}>
        <Icon name="trash" size={22} color={colors.danger} />
      </View>
      <Text style={styles.title}>{x.titulo}</Text>
      <Text style={styles.para}>{x.descricao}</Text>
      {!queued ? (
        <View style={{ gap: 4 }}>
          <Text style={t.label}>Motivo (opcional)</Text>
          <TextInput
            testID="delete-reason"
            value={reason}
            onChangeText={setReason}
            placeholder="Ex.: cliente desistiu"
            placeholderTextColor={colors.ink3}
            maxLength={500}
            style={styles.input}
            accessibilityLabel="Motivo do cancelamento"
          />
        </View>
      ) : null}
      {error ? (
        <Text style={[t.small, { color: colors.danger }]} testID="delete-error">
          {error}
        </Text>
      ) : null}
      <BotaoFolha tom="perigo" testID="delete-confirm" rotulo={busy ? x.ocupado : x.confirmar} desligado={busy} onPress={() => onConfirm(reason)} />
      <BotaoFolha tom="contorno" testID="delete-cancel" rotulo="Voltar" onPress={onClose} />
    </BottomSheet>
  );
}

/** Rejeitar pedido (RN-GES-08): o motivo é obrigatório (3+ caracteres) e o vendedor o vê no app. */
export function DecisionSheet({
  visible,
  title,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = useState('');
  useEffect(() => {
    if (visible) setMotivo('');
  }, [visible]);
  const ok = motivo.trim().length >= 3;
  return (
    <BottomSheet visible={visible} onClose={onClose} label="Rejeitar pedido" testID="reject-sheet">
      <View style={[styles.tile, { backgroundColor: colors.dangerBg }]}>
        <Icon name="close" size={22} color={colors.danger} />
      </View>
      <Text style={styles.title}>Rejeitar {title.toLowerCase()}?</Text>
      <Text style={styles.para}>O vendedor vê o motivo no aplicativo. Escreva o que ele precisa ajustar.</Text>
      <View style={{ gap: 4 }}>
        <Text style={t.label}>Motivo (obrigatório)</Text>
        <TextInput
          testID="reject-reason"
          value={motivo}
          onChangeText={setMotivo}
          placeholder="Ex.: desconto acima da política para este cliente"
          placeholderTextColor={colors.ink3}
          maxLength={500}
          style={styles.input}
          accessibilityLabel="Motivo da rejeição"
        />
        {motivo.length > 0 && !ok ? <Text style={[t.small, { color: colors.danger }]}>Escreva ao menos 3 caracteres.</Text> : null}
      </View>
      {error ? (
        <Text style={[t.small, { color: colors.danger }]} testID="reject-error">
          {error}
        </Text>
      ) : null}
      <BotaoFolha tom="perigo" testID="reject-confirm" rotulo={busy ? 'Rejeitando…' : 'Rejeitar pedido'} desligado={busy || !ok} onPress={() => onConfirm(motivo)} />
      <BotaoFolha tom="contorno" testID="reject-cancel" rotulo="Voltar" onPress={onClose} />
    </BottomSheet>
  );
}

export function PdfSheet({ visible, busy, error, onClose, onPick }: { visible: boolean; busy: OrderPdfView | null; error: string | null; onClose: () => void; onPick: (view: OrderPdfView) => void }) {
  return (
    <BottomSheet visible={visible} onClose={onClose} label="Exportar PDF" testID="pdf-sheet">
      <View style={{ gap: 2 }}>
        <Text style={styles.overline}>EXPORTAR PDF</Text>
        <Text style={styles.title}>Para quem é o PDF?</Text>
      </View>
      <LinhaOpcaoFolha
        testID="pdf-customer"
        titulo={busy === 'customer' ? 'Gerando…' : 'Para o cliente'}
        texto="Preço final por item e total. Sem percentual de desconto."
        desligado={busy !== null}
        onPress={() => onPick('customer')}
      />
      <LinhaOpcaoFolha
        testID="pdf-bko"
        titulo={busy === 'bko' ? 'Gerando…' : 'Para o escritório'}
        texto="Preço de tabela, desconto, líquido, alçada, status e histórico."
        desligado={busy !== null}
        onPress={() => onPick('bko')}
      />
      {error ? <Text style={[t.small, { color: colors.danger }]}>{error}</Text> : null}
      <Pressable testID="pdf-close" accessibilityRole="button" onPress={onClose} style={styles.textBtn}>
        <Text style={styles.textBtnLabel}>Fechar</Text>
      </Pressable>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(22,32,42,0.45)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 18, paddingTop: 20, gap: 12, maxWidth: 560, alignSelf: 'center', width: '100%' },
  tile: { width: 44, height: 44, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  title: { ...fonte.display, fontSize: 22, color: colors.ink },
  overline: { ...fonte.bold, fontSize: 12, letterSpacing: 0.7, color: colors.ink2 },
  para: { ...fonte.body, fontSize: 14, lineHeight: 20, color: colors.ink2 },
  input: { height: 46, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.md, paddingHorizontal: 12, ...fonte.body, fontSize: 16, color: colors.ink, backgroundColor: colors.surface },
  textBtn: { height: 44, alignItems: 'center', justifyContent: 'center' },
  textBtnLabel: { ...fonte.semibold, fontSize: 14, color: colors.ink2 },
});
