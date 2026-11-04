/**
 * Folhas das ações do pedido (detalhe do pedido):
 * - Excluir: confirmação com motivo opcional (excluir = cancelar; o pedido não é apagado);
 * - Exportar PDF: para o cliente (sem desconto) ou para o escritório (tabela, desconto, alçada, histórico).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Icon, colors, fonts, radius, type as t } from '@macuxi/ui/mobile';
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

export function DeleteOrderSheet({
  visible,
  title,
  queued,
  ehOrcamento = false,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  queued: boolean;
  ehOrcamento?: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (visible) setReason('');
  }, [visible]);
  const x = textoCancelarDocumento({ ehOrcamento, naFila: queued, titulo: title });
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
            accessibilityLabel={ehOrcamento ? 'Motivo do cancelamento' : 'Motivo da exclusão'}
          />
        </View>
      ) : null}
      {error ? (
        <Text style={[t.small, { color: colors.danger }]} testID="delete-error">
          {error}
        </Text>
      ) : null}
      <SheetButton testID="delete-confirm" label={busy ? x.ocupado : x.confirmar} bg={colors.danger} fg="#FFFFFF" height={50} disabled={busy} onPress={() => onConfirm(reason)} />
      <SheetButton testID="delete-cancel" label="Voltar" bg={colors.surface} fg={colors.ink} border={colors.lineStrong} height={46} onPress={onClose} />
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
      <SheetButton testID="reject-confirm" label={busy ? 'Rejeitando…' : 'Rejeitar pedido'} bg={colors.danger} fg="#FFFFFF" height={50} disabled={busy || !ok} onPress={() => onConfirm(motivo)} />
      <SheetButton testID="reject-cancel" label="Voltar" bg={colors.surface} fg={colors.ink} border={colors.lineStrong} height={46} onPress={onClose} />
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
      <PdfOption
        testID="pdf-customer"
        title={busy === 'customer' ? 'Gerando…' : 'Para o cliente'}
        text="Preço final por item e total. Sem percentual de desconto."
        disabled={busy !== null}
        onPress={() => onPick('customer')}
      />
      <PdfOption
        testID="pdf-bko"
        title={busy === 'bko' ? 'Gerando…' : 'Para o escritório'}
        text="Preço de tabela, desconto, líquido, alçada, status e histórico."
        disabled={busy !== null}
        onPress={() => onPick('bko')}
      />
      {error ? <Text style={[t.small, { color: colors.danger }]}>{error}</Text> : null}
      <Pressable testID="pdf-close" accessibilityRole="button" onPress={onClose} style={styles.textBtn}>
        <Text style={styles.textBtnLabel}>Fechar</Text>
      </Pressable>
    </BottomSheet>
  );
}

function PdfOption({ title, text, onPress, disabled, testID }: { title: string; text: string; onPress: () => void; disabled?: boolean; testID: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.option, pressed && { backgroundColor: colors.ground }, disabled && { opacity: 0.6 }]}>
      <View style={[styles.tile, { width: 38, height: 38, backgroundColor: colors.accentSoft }]}>
        <Icon name="file" size={18} color={colors.accentInk} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.optionTitle}>{title}</Text>
        <Text style={t.small}>{text}</Text>
      </View>
      <Icon name="chevron" size={16} color={colors.ink3} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(22,32,42,0.45)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 18, paddingTop: 20, gap: 12, maxWidth: 560, alignSelf: 'center', width: '100%' },
  sheetBtn: { borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  sheetBtnText: { fontFamily: fonts.semibold },
  tile: { width: 44, height: 44, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: fonts.display, fontSize: 20, color: colors.ink },
  overline: { fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.7, color: colors.ink2 },
  para: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.ink2 },
  input: { height: 46, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.md, paddingHorizontal: 12, fontFamily: fonts.body, fontSize: 15, color: colors.ink, backgroundColor: colors.surface },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, paddingVertical: 10, paddingHorizontal: 12 },
  optionTitle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  textBtn: { height: 44, alignItems: 'center', justifyContent: 'center' },
  textBtnLabel: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink2 },
});
