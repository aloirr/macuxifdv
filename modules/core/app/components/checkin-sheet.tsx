/**
 * Folha do check-in: registra horário/local e confirma o início do atendimento.
 * O resultado da visita (com pedido / sem pedido + motivo) fica para o checkout (components/visit-sheets.tsx).
 */
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, colors, fonts, Icon, type as t } from '@macuxi/ui/mobile';

export type CheckinPhase =
  | { kind: 'locating' }
  /** RN-CORE-10: fora do raio do cliente — a justificativa é obrigatória para registrar o check-in. */
  | { kind: 'justificar'; distancia_m: number; raio_m: number }
  | { kind: 'done'; visitId: string; at: string; gps: boolean; foraDoRaio?: boolean; sugereCoordenada?: boolean };

/** Ação de destaque do slot `cliente.acoes` (ex.: "Novo pedido" do Vendedor); sem ela, a folha só tem "Continuar". */
export interface AcaoDaFolha {
  rotulo: string;
  testID: string;
  onPress: () => void;
}

export function CheckinSheet({ phase, customerName, onClose, acao, onJustificar }: { phase: CheckinPhase | null; customerName: string; onClose: () => void; acao?: AcaoDaFolha; onJustificar?: (texto: string) => void }) {
  const insets = useSafeAreaInsets();
  const [texto, setTexto] = useState('');
  return (
    <Modal visible={phase !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={phase?.kind === 'locating' ? undefined : onClose} accessibilityLabel="Fechar" />
      <View style={[styles.sheet, { paddingBottom: 20 + insets.bottom }]} testID="checkin-sheet">
        <View style={styles.handle} />
        {phase?.kind === 'locating' ? (
          <View style={{ alignItems: 'center', gap: 12, paddingVertical: 24 }}>
            <ActivityIndicator color={colors.accent} />
            <Text style={t.sub}>Registrando check-in e localização…</Text>
          </View>
        ) : phase?.kind === 'justificar' ? (
          <View style={{ gap: 12 }} testID="checkin-justificar">
            <Text style={[t.h2, { fontSize: 18 }]}>Você está longe do cliente</Text>
            <Text style={t.sub}>
              Você está a cerca de {phase.distancia_m.toLocaleString('pt-BR')} m de {customerName} (o limite é {phase.raio_m.toLocaleString('pt-BR')} m). Explique por que o atendimento é aqui; o gestor vê esta justificativa.
            </Text>
            <TextInput
              testID="checkin-justificativa"
              value={texto}
              onChangeText={setTexto}
              placeholder="Ex.: cliente atendeu no depósito ao lado"
              accessibilityLabel="Justificativa do check-in fora do raio"
              multiline
              maxLength={500}
              style={styles.input}
            />
            <Button testID="checkin-confirmar-justificativa" label="Registrar check-in" variant="accent" height={52} disabled={texto.trim().length < 3} onPress={() => onJustificar?.(texto.trim())} />
            <Pressable testID="checkin-cancelar" onPress={onClose} style={styles.later} accessibilityRole="button">
              <Text style={styles.laterText}>Cancelar</Text>
            </Pressable>
          </View>
        ) : phase ? (
          <View style={{ gap: 14 }}>
            <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
              <View style={styles.ok}>
                <Icon name="check" size={18} color={colors.success} strokeWidth={2.4} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[t.h2, { fontSize: 18 }]}>Check-in às {phase.at}</Text>
                <Text style={t.small} numberOfLines={2}>
                  {customerName} · {phase.gps ? 'GPS do aparelho' : 'sem GPS neste check-in'}
                </Text>
              </View>
            </View>
            {phase.foraDoRaio ? <Text style={t.small}>Check-in fora do raio do cliente: ficou sinalizado com a sua justificativa.</Text> : null}
            {phase.sugereCoordenada ? <Text style={t.small}>Este cliente ainda não tem coordenada. Sugerimos esta posição ao gestor para aprovação.</Text> : null}
            <Text style={t.sub}>Você está em atendimento. Outros check-ins ficam bloqueados até o checkout; pedidos para outros clientes continuam liberados.</Text>
            {acao ? <Button testID={acao.testID} label={acao.rotulo} icon="plus" variant="accent" height={52} onPress={acao.onPress} /> : null}
            <Pressable testID="checkin-continue" onPress={onClose} style={styles.later} accessibilityRole="button">
              <Text style={styles.laterText}>Continuar</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(22,32,42,0.45)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 20, paddingTop: 10, maxWidth: 560, alignSelf: 'center', width: '100%' },
  input: { minHeight: 72, borderRadius: 12, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, padding: 12, fontFamily: fonts.body, fontSize: 15, color: colors.ink, textAlignVertical: 'top' },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.lineStrong, marginBottom: 14 },
  ok: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.successBg, alignItems: 'center', justifyContent: 'center' },
  later: { height: 44, alignItems: 'center', justifyContent: 'center' },
  laterText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink2 },
});
