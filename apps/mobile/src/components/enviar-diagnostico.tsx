/**
 * T-0158 (v1.0.4): "Enviar diagnóstico" no Diagnóstico do Perfil, igual à imagem aprovada
 * (`docs/design/telas/T-0158-diagnostico-app.png`, R-20261110-192152, sem a linha "Vai junto": o pacote técnico vai sempre,
 * sem aviso na tela). Botão secundário + folha com "O que aconteceu?" (até 1000 caracteres, com a ajuda de dado pessoal) e
 * "Anexar print (opcional)" (galeria, JPEG 1600 px q80 sem EXIF), que vira a linha "Print anexado · Remover". Enviar sempre
 * ligado; a folha troca de conteúdo para a confirmação ("Enviado · nº 0042", "Na fila" ou "Não enviado"), com vibração leve só
 * no Enviado. Embaixo do botão, "Últimos envios" (até 10, some sem envio; a linha não abre nada). O mesmo componente no
 * Campo e no Gestão. Regras e textos em `lib/diagnostico-envio.ts`; fila e envio em `services/diagnostico.ts`.
 */
import { caminhoFoto } from '@macuxi/platform-sdk';
import { useMotorSync } from '@macuxi/platform-sdk/react';
import { Badge, Button, Card, colors, dateTimeLabel, Folha, fonte, Icon, LinkTexto, radius, type as t, vibrarLeve } from '@macuxi/ui/mobile';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Image, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  ajudaDaSituacao,
  iconeDaSituacao,
  linhaDoHistorico,
  MAX_DESCRICAO_DIAGNOSTICO,
  tituloDaSituacao,
  TEXTOS_DIAGNOSTICO as T,
  type RegistroDiagnostico,
} from '@/lib/diagnostico-envio';
import { uriLocal } from '@/services/arquivos';
import { escolherFotoDaGaleria } from '@/services/camera';
import { uuid } from '@/services/device';
import { descartarPrint, enviarDiagnosticoDoBotao, montarDiagnosticoDoBotao, useDiagnosticos } from '@/services/diagnostico';

type Resultado = Pick<RegistroDiagnostico, 'situacao' | 'protocolo' | 'codigo' | 'ultimo_erro'>;
const NA_FILA: Resultado = { situacao: 'na_fila', protocolo: null, codigo: null, ultimo_erro: '' };

export function EnviarDiagnostico({ usuarioId, tenantId, tz }: { usuarioId: string; tenantId: string | null; tz: string }) {
  const { motor } = useMotorSync();
  const historico = useDiagnosticos(usuarioId, tenantId);
  const [aberta, setAberta] = useState(false);
  const [id, setId] = useState<string | null>(null);
  const [descricao, setDescricao] = useState('');
  const [print, setPrint] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const data = (iso: string) => dateTimeLabel(iso, new Date(), tz);

  // a confirmação é anunciada ao aparecer
  useEffect(() => {
    if (resultado) AccessibilityInfo.announceForAccessibility(`${tituloDaSituacao(resultado)}. ${ajudaDaSituacao(resultado)}`);
  }, [resultado]);

  const abrir = () => {
    // UUID gerado no aparelho quando a folha abre: tocar duas vezes em Enviar não duplica (idempotente pelo id)
    setId(uuid());
    setDescricao('');
    setPrint(null);
    setResultado(null);
    setFalha(null);
    setAberta(true);
  };

  // ✕, arrastar, toque fora ou Voltar: descarta o texto e o print, sem perguntar
  const fechar = () => {
    if (print && !resultado) void descartarPrint(print);
    setAberta(false);
  };

  const anexar = async () => {
    const foto = await escolherFotoDaGaleria().catch(() => null);
    if (!foto) return;
    if (print) void descartarPrint(print);
    setPrint(foto.id);
  };

  const enviar = async () => {
    if (!id || enviando) return;
    setEnviando(true);
    setFalha(null);
    try {
      const envio = await montarDiagnosticoDoBotao({ id, motor, descricao, printId: print });
      const r = (await enviarDiagnosticoDoBotao(envio, { usuarioId, tenantId })) ?? NA_FILA;
      if (r.situacao === 'enviado') vibrarLeve();
      setResultado(r);
    } catch {
      setFalha(T.recusadoAjuda);
    } finally {
      setEnviando(false);
    }
  };

  const miniatura = print ? uriLocal(caminhoFoto(print)) : null;

  return (
    <View style={{ gap: 8 }}>
      <Button testID="diagnostico-enviar" label={T.botao} icon="subir" variant="outlineDark" onPress={abrir} />
      {historico.length > 0 ? (
        <View testID="diagnostico-historico" style={{ gap: 8, marginTop: 8 }}>
          <Text style={t.rotulo} accessibilityRole="header">
            {T.historico}
          </Text>
          <Card style={{ paddingHorizontal: 14 }}>
            {historico.map((r, i) => {
              const l = linhaDoHistorico(r, data);
              return (
                <View
                  key={r.id}
                  testID={`diagnostico-${r.id}`}
                  accessible
                  accessibilityLabel={l.leitura}
                  style={[styles.linha, i > 0 ? styles.divisoria : null]}>
                  <Badge label={l.selo} tone={l.tom} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={l.destaque ? t.bodyStrong : t.small} numberOfLines={1}>
                      {l.principal}
                    </Text>
                    {l.automatico ? <Text style={t.small}>{l.automatico}</Text> : null}
                  </View>
                  <Text style={t.small}>{l.data}</Text>
                </View>
              );
            })}
          </Card>
        </View>
      ) : null}

      <Folha
        visivel={aberta}
        onFechar={fechar}
        rotuloFechar={T.fechar}
        titulo={resultado ? undefined : T.titulo}
        fechar={resultado ? undefined : { rotulo: T.fechar, testID: 'diagnostico-fechar' }}
        evitarTeclado={!resultado}
        testID="diagnostico-folha"
      >
        {resultado ? (
          <View style={styles.confirmacao}>
            <View style={[styles.selo, { backgroundColor: resultado.situacao === 'enviado' ? colors.successBg : resultado.situacao === 'falhou' ? colors.dangerBg : colors.warningBg }]}>
              <Icon
                name={iconeDaSituacao(resultado)}
                size={24}
                color={resultado.situacao === 'enviado' ? colors.success : resultado.situacao === 'falhou' ? colors.danger : colors.warning}
              />
            </View>
            <Text testID="diagnostico-resultado" style={styles.tituloConfirmacao} accessibilityRole="header">
              {tituloDaSituacao(resultado)}
            </Text>
            <Text style={[t.body, { color: colors.ink2, textAlign: 'center' }]}>{ajudaDaSituacao(resultado)}</Text>
            <Button testID="diagnostico-ok" label={T.fechar} variant="outlineDark" height={52} style={{ alignSelf: 'stretch', marginTop: 8 }} onPress={() => setAberta(false)} />
          </View>
        ) : (
          <View style={{ gap: 8, paddingBottom: 16 }}>
            <Text style={t.bodyStrong}>{T.pergunta}</Text>
            <TextInput
              testID="diagnostico-descricao"
              value={descricao}
              onChangeText={setDescricao}
              maxLength={MAX_DESCRICAO_DIAGNOSTICO}
              multiline
              textAlignVertical="top"
              placeholder={T.exemplo}
              placeholderTextColor={colors.ink3}
              style={styles.campo}
              accessibilityLabel={T.pergunta}
              accessibilityHint={T.aviso}
            />
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Text style={[t.small, { flex: 1 }]}>{T.aviso}</Text>
              <Text style={t.small}>
                {descricao.length}/{MAX_DESCRICAO_DIAGNOSTICO}
              </Text>
            </View>
            {print ? (
              <View testID="diagnostico-print" style={styles.print}>
                {miniatura ? <Image source={{ uri: miniatura }} style={styles.miniatura} accessibilityIgnoresInvertColors /> : <View style={styles.miniatura} />}
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={t.bodyStrong}>{T.printAnexado}</Text>
                  <Text style={t.small}>{T.printQuemVe}</Text>
                </View>
                <LinkTexto
                  testID="diagnostico-remover-print"
                  rotulo={T.remover}
                  rotuloAcessivel={`${T.remover} print`}
                  onPress={() => {
                    void descartarPrint(print);
                    setPrint(null);
                  }}
                />
              </View>
            ) : (
              <Button testID="diagnostico-anexar" label={T.anexar} icon="galeria" variant="outlineDark" style={{ marginTop: 8 }} onPress={() => void anexar()} />
            )}
            {falha ? <Text style={[t.small, { color: colors.danger }]}>{falha}</Text> : null}
            <Button
              testID="diagnostico-confirmar"
              label={enviando ? T.enviando : T.enviar}
              icon="subir"
              variant="accent"
              height={52}
              loading={enviando}
              style={{ marginTop: 16 }}
              onPress={() => void enviar()}
            />
          </View>
        )}
      </Folha>
    </View>
  );
}

const styles = StyleSheet.create({
  campo: {
    minHeight: 104,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radius.md,
    padding: 12,
    ...fonte.body,
    fontSize: 14,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  linha: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 14 },
  divisoria: { borderTopWidth: 1, borderTopColor: colors.lineSoft },
  print: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8, padding: 10, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md },
  miniatura: { width: 36, height: 64, borderRadius: 4, backgroundColor: colors.lineSoft },
  confirmacao: { alignItems: 'center', gap: 8, paddingTop: 16, paddingBottom: 16 },
  selo: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  tituloConfirmacao: { ...fonte.bold, fontSize: 22, color: colors.ink, textAlign: 'center' },
});
