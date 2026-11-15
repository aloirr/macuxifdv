/**
 * Tela oculta de diagnóstico de carga e busca do SQLite (T-0008, critérios 1 e 2, e T-0084, critério 5: aplicação longa,
 * referências, reindexação completa e a busca do Novo pedido pela C9; medidos no aparelho de referência).
 * Só no bundle de desenvolvimento (`expo start`, `EXPO_PUBLIC_PERFIL_BUILD`); em produção a rota redireciona
 * para o Início. Abre com 7 toques na versão, no fim do Perfil.
 *
 * Usa um banco SEPARADO e temporário (`macuxi-diagnostico-carga.db`), nunca o do usuário: apagado antes de começar, ao
 * terminar e ao sair da tela (o nome fica fora da `ARQUIVO_DE_USUARIO_RE`: o bloqueio do aparelho não o confunde).
 * T-0088: mede pelo CAMINHO REAL do motor do usuário: o mesmo driver (`abrirDriverExpo`, o `SistemaSqlite` do app) e as
 * mesmas opções do adaptador (`opcoesDoAdaptador`: migrações, entidades, índices do shell desta variante e a busca que
 * não espera o L-1).
 * A regra (gerador, consultas, percentis, texto) está em `@/lib/diagnostico-carga`; aqui ficam o driver, o medidor de
 * quadros (`requestAnimationFrame` da thread JS) e o compartilhar (o Android oferece "Copiar" na folha).
 */
import { FUSO_PADRAO_TENANT } from '@macuxi/platform-sdk';
import { Button, Card, ChipEstado, colors, fonts, ProgressBar, Screen, SectionHeader, type as t } from '@macuxi/ui/mobile';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Redirect } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, Share, StyleSheet, Text, View } from 'react-native';

import {
  CONFIG_PADRAO,
  criarMedidorQuadros,
  diagnosticoDisponivel,
  DiagnosticoCancelado,
  LIMITE_QUADRO_MS,
  milhar,
  formatarMs,
  linhasDoVeredito,
  rodarDiagnosticoCarga,
  textoDoRelatorio,
  tituloDoProgresso,
  veredito,
  type ProgressoDiagnostico,
  type ResultadoQuadros,
  type Veredito,
} from '@/lib/diagnostico-carga';
import { opcoesDoAdaptador } from '@/lib/armazenamento-aparelho';
import { shellDaVariante } from '@/lib/modulos';
import { varianteAtual } from '@/lib/variante';
import { perfilBuildAtual } from '@/services/device';
import { abrirDriverExpo, apagarBancoExpo, expoSqliteDisponivel } from '@/services/sqlite-expo';
import { usePlataforma } from '@/state/plataforma';

const BANCO_TESTE = 'macuxi-diagnostico-carga.db';

type Estado =
  | { tipo: 'parado' }
  | { tipo: 'rodando'; progresso: ProgressoDiagnostico }
  | { tipo: 'pronto'; texto: string; veredito: Veredito }
  | { tipo: 'erro'; mensagem: string };

export default function DiagnosticoCargaScreen() {
  const perfil = perfilBuildAtual();
  if (!diagnosticoDisponivel(perfil)) return <Redirect href="/" />;
  return <Diagnostico perfil={perfil} />;
}

function Diagnostico({ perfil }: { perfil: ReturnType<typeof perfilBuildAtual> }) {
  const { me, sessao } = usePlataforma();
  const fuso = me?.tenant.timezone ?? sessao?.tenant?.fuso ?? FUSO_PADRAO_TENANT;
  const [estado, setEstado] = useState<Estado>({ tipo: 'parado' });
  const [quadrosAoVivo, setQuadrosAoVivo] = useState<ResultadoQuadros>({ quadros: 0, maiorMs: 0, acimaDoLimite: 0 });
  const cancelado = useRef(false);
  const rodando = useRef<Promise<void> | null>(null);
  const disponivel = expoSqliteDisponivel();

  // ao sair da tela: para no próximo ponto seguro e apaga o banco de teste
  useEffect(() => {
    cancelado.current = false;
    return () => {
      cancelado.current = true;
      void (rodando.current ?? Promise.resolve()).finally(() => apagarBancoExpo(BANCO_TESTE));
    };
  }, []);

  const rodar = () => {
    if (rodando.current) return;
    const medidor = criarMedidorQuadros();
    let quadro = 0;
    let ultimaTela = 0;
    // medidor de quadros da thread JS: cada intervalo entre dois requestAnimationFrame; a tela atualiza a cada 250 ms
    const passo = (agora: number) => {
      medidor.quadro(agora);
      if (agora - ultimaTela >= 250) {
        ultimaTela = agora;
        setQuadrosAoVivo(medidor.resultado());
      }
      quadro = requestAnimationFrame(passo);
    };
    setEstado({ tipo: 'rodando', progresso: { fase: 'abrindo', feito: 0, total: 1 } });
    const execucao = (async () => {
      quadro = requestAnimationFrame(passo);
      try {
        await apagarBancoExpo(BANCO_TESTE);
        const driver = await abrirDriverExpo(BANCO_TESTE);
        const shell = shellDaVariante(varianteAtual());
        const op = opcoesDoAdaptador(shell, (m) => console.warn(`[diagnóstico de carga] ${m}`));
        const resultado = await rodarDiagnosticoCarga(
          {
            driver,
            // a reindexação completa reabre o MESMO arquivo temporário (apagado no fim, como antes)
            reabrir: () => abrirDriverExpo(BANCO_TESTE),
            consultas: shell.consultas,
            migracoesModulos: op.migracoesModulos ?? {},
            entidades: op.entidades ?? [],
            indicesBusca: op.indicesBusca ?? [],
            opcoesAdaptador: { buscaSemEsperarIndexacao: op.buscaSemEsperarIndexacao, registrarErro: op.registrarErro },
            agora: () => performance.now(),
            cancelado: () => cancelado.current,
            aoProgresso: (progresso) => {
              if (!cancelado.current) setEstado({ tipo: 'rodando', progresso });
            },
          },
          CONFIG_PADRAO,
        );
        cancelAnimationFrame(quadro);
        const quadros = medidor.resultado();
        const texto = textoDoRelatorio(resultado, quadros, {
          quando: new Date(),
          fuso,
          app: String(Constants.expoConfig?.name ?? 'Macuxi'),
          versao: String(Constants.expoConfig?.version ?? '?'),
          perfil,
          aparelho: [Device.manufacturer, Device.modelName].filter(Boolean).join(' ') || 'aparelho ?',
          sistema: `${Device.osName ?? Platform.OS} ${Device.osVersion ?? '?'}${Device.platformApiLevel ? ` (API ${Device.platformApiLevel})` : ''}`,
          memoriaBytes: Device.totalMemory ?? null,
        });
        if (!cancelado.current) {
          setQuadrosAoVivo(quadros);
          setEstado({ tipo: 'pronto', texto, veredito: veredito(resultado, quadros) });
        }
      } catch (e) {
        if (!(e instanceof DiagnosticoCancelado) && !cancelado.current) setEstado({ tipo: 'erro', mensagem: e instanceof Error ? e.message : String(e) });
      } finally {
        cancelAnimationFrame(quadro);
        await apagarBancoExpo(BANCO_TESTE);
        rodando.current = null;
      }
    })();
    rodando.current = execucao;
  };

  const compartilhar = (texto: string) => {
    void Share.share({ message: texto }).catch(() => {});
  };

  const emCurso = estado.tipo === 'rodando';
  const pct = emCurso && estado.progresso.total > 0 ? (estado.progresso.feito / estado.progresso.total) * 100 : 0;

  return (
    <Screen testID="diagnostico-carga" cabecalho={{ titulo: 'Diagnóstico de carga', voltar: { label: 'Perfil', fallback: '/profile' } }}>
      <View style={{ gap: 4 }}>
        <Text style={t.sub}>
          {`Grava ${milhar(CONFIG_PADRAO.produtos)} produtos com aplicação longa e referências e ${milhar(CONFIG_PADRAO.clientes)} clientes de teste, refaz o índice de busca e mede ${CONFIG_PADRAO.buscasProduto + (CONFIG_PADRAO.buscasC9 ?? 0) + CONFIG_PADRAO.buscasCliente} buscas sem internet, incluindo a do Novo pedido.`}
        </Text>
        <Text style={t.small}>Usa um banco separado e temporário: seus dados não são tocados e o banco de teste é apagado ao sair desta tela. Leva alguns minutos.</Text>
        <Text style={t.bodyStrong}>Mantenha a tela ligada até terminar.</Text>
      </View>

      {!disponivel ? (
        <Card testID="diagnostico-sem-sqlite" style={{ padding: 14, gap: 6 }}>
          <Text style={[t.bodyStrong, { color: colors.danger }]}>Este APK não tem o SQLite do aparelho (expo-sqlite).</Text>
          <Text style={t.small}>Rode o app de novo depois da instalação do expo-sqlite e abra esta tela.</Text>
        </Card>
      ) : (
        <Button testID="diagnostico-rodar" label={emCurso ? 'Medindo…' : estado.tipo === 'parado' ? 'Rodar medição' : 'Rodar de novo'} loading={emCurso} onPress={rodar} />
      )}

      {emCurso ? (
        <Card testID="diagnostico-andamento" style={{ padding: 14, gap: 8 }}>
          <Text style={t.bodyStrong} testID="diagnostico-etapa">
            {tituloDoProgresso(estado.progresso)}
          </Text>
          <ProgressBar pct={pct} />
          <Text style={styles.mono} testID="diagnostico-quadros">
            {`Quadros ${milhar(quadrosAoVivo.quadros)} · maior ${formatarMs(quadrosAoVivo.maiorMs)} · acima de ${LIMITE_QUADRO_MS} ms: ${quadrosAoVivo.acimaDoLimite}`}
          </Text>
          <Text style={t.small}>Se estes números pararem de mudar, a tela travou.</Text>
          <Text style={t.small}>Mantenha a tela ligada até terminar.</Text>
        </Card>
      ) : null}

      {estado.tipo === 'erro' ? (
        <Card testID="diagnostico-erro" style={{ padding: 14, gap: 6 }}>
          <Text style={[t.bodyStrong, { color: colors.danger }]}>A medição parou com erro</Text>
          <Text selectable style={styles.mono}>
            {estado.mensagem}
          </Text>
          <Text style={t.small}>Toque em Rodar de novo. Se o erro voltar, copie a mensagem e mande no recado.</Text>
          <Button testID="diagnostico-compartilhar-erro" label="Copiar ou compartilhar" variant="outline" onPress={() => compartilhar(`Macuxi — diagnóstico de carga (T-0008): erro
${estado.mensagem}`)} />
        </Card>
      ) : null}

      {estado.tipo === 'pronto' ? (
        <View style={{ gap: 8 }}>
          <SectionHeader title="Resultado" />
          <Card testID="diagnostico-veredito" style={{ padding: 14, gap: 10 }}>
            {linhasDoVeredito(estado.veredito).map((l) => (
              <View key={l.id} style={styles.linhaVeredito}>
                <Text style={[t.body, { flex: 1 }]}>{l.texto}</Text>
                <ChipEstado testID={`diagnostico-${l.id}`} texto={l.rotulo} tom={l.tom} pequeno />
              </View>
            ))}
          </Card>
          <Card style={{ padding: 14 }}>
            <Text selectable style={styles.mono} testID="diagnostico-resultado">
              {estado.texto}
            </Text>
          </Card>
          <Button testID="diagnostico-compartilhar" label="Copiar ou compartilhar" variant="outline" onPress={() => compartilhar(estado.texto)} />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  mono: { fontFamily: fonts.mono, fontSize: 12, color: colors.ink2, lineHeight: 18 },
  linhaVeredito: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
