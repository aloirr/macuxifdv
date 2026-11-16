/**
 * Carga depois do login (rota `/sync`), Campo e Gestão, na tela única de entrada (T-0172: `TelaEntrada`, o logo da
 * splash parado e embaixo "Olá", a barra do total e as etapas nomeadas; proposta docs/marca/propostas/2026-11-12-entrada-sync).
 * Regras que continuam da T-0059:
 * - R-20261102-091336: a navegação depende do ESTADO do motor (`sincronizado_em` gravado e nada em andamento →
 *   `<Redirect href="/">`), não da promessa de `sincronizar()`; vale com a tela remontada e ao voltar do segundo plano. Se a
 *   carga já existia quando a tela abriu (entrar de novo com o mesmo usuário), o usuário entra na hora e a sincronização
 *   segue em segundo plano. Com tudo feito nesta tela, o Início abre sozinho depois de `ESPERA_PRONTO_MS`, sem botão (T-0172).
 * - R-20261102-090915: nenhum nome técnico; o detalhe da falha vai para o log e para o Diagnóstico do Perfil.
 * - R-20261102-090919 item 2: montar a tela (ou remontar) não reinicia a carga em andamento (`sincronizarSeNecessario`).
 * - ADR 0017: a barra é o percentual do total já gravado (`percentualDaCarga`), também na retomada.
 * As frases que se alternavam saíram (T-0172): fica só o nome da etapa e o percentual.
 * ADR 0054 (solução 5): com `liberado_em` (os essenciais da carga terminaram) o usuário entra na hora e a carga segue em
 * segundo plano. Aberta pelo indicador das abas (`?detalhe=1`), é o detalhe da carga e não volta sozinha às abas.
 */
import { progressoDaEntrada } from '@macuxi/core/app';
import { useMotorSync } from '@macuxi/platform-sdk/react';
import { firstName } from '@macuxi/ui/mobile';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { AcaoEntrada, ErroEntrada, TelaEntrada } from '@/components/tela-entrada';
import { percentualDaCarga, situacaoDaCarga } from '@/lib/carga';
import { liberadoPeloMotor } from '@/lib/carga-fundo';
import {
  criarMemoriaDaEntrada,
  erroDeSinal,
  ESPERA_PRONTO_MS,
  ROTULO_TENTAR_DE_NOVO,
  rotuloDaBarra,
  textoDoErro,
} from '@/lib/entrada';
import { usePlataforma } from '@/state/plataforma';

export function TelaCarga() {
  const {
    sessao,
    sincronizar,
    sincronizarSeNecessario,
    offline,
    setOffline,
    logout,
    modulosAtivos,
    variante,
    perfil,
  } = usePlataforma();
  const estado = useMotorSync().estado;
  const { detalhe } = useLocalSearchParams<{ detalhe?: string }>();
  // ADR 0054: entrada liberada pelo motor (sem a peça, `liberado_em` não vem e vale só a carga completa)
  const liberada = liberadoPeloMotor(estado) && detalhe !== '1';
  // RN-CORE-48: a etapa mostrada nunca volta (1, 2, 3... de N); tela montada de novo = carga nova, do zero
  const [lembrar] = useState(criarMemoriaDaEntrada);
  /** A carga já estava gravada quando a tela abriu: não prende o usuário enquanto a sincronização roda. */
  const tinhaCarga = useRef(Boolean(estado.sincronizado_em)).current;
  const situacao = situacaoDaCarga(estado, { tinhaCarga });
  // re-render ao voltar do segundo plano: o <Redirect> roda de novo se a carga terminou com o app fora da tela
  const [, setVolta] = useState(0);
  // a carga terminou nesta tela: o 100% fica à vista por ESPERA_PRONTO_MS e o Início abre sozinho (spec §1, estado 5)
  const [mostrouPronto, setMostrouPronto] = useState(false);
  const pronta = situacao === 'entrar';
  useEffect(() => {
    if (!pronta || tinhaCarga) return;
    // timer-permitido: uma vez, no fim da carga (passagem para o Início)
    const t = setTimeout(() => setMostrouPronto(true), ESPERA_PRONTO_MS);
    return () => clearTimeout(t);
  }, [pronta, tinhaCarga]);

  useEffect(() => {
    if (!sessao) return;
    void sincronizarSeNecessario('tela-carga');
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') setVolta((n) => n + 1);
    });
    return () => sub.remove();
  }, [sessao, sincronizarSeNecessario]);

  if (!sessao) return <Redirect href="/login" />;

  // RN-CORE-48 (domain do Core): etapas, situação e percentual. O shell entrega a sua leitura do motor: a situação da carga
  // (navegação, T-0059) e o percentual com as páginas gravadas (ADR 0017).
  const progresso = lembrar(`${sessao.user.id}|${sessao.tenant?.id ?? ''}`, (anterior) =>
    progressoDaEntrada({
      perfil,
      modulos: modulosAtivos,
      carga: estado.carga,
      progresso: percentualDaCarga(estado, situacao) / 100,
      sincronizando: situacao === 'carregando',
      erro: situacao === 'erro' ? (estado.erro ?? 'erro') : null,
      sincronizado: pronta,
      anterior,
    }),
  );
  const parou = progresso.parou_em;

  return (
    <>
      <TelaEntrada
        variante={variante}
        testID="tela-carga"
        saudacao={`Olá, ${firstName(sessao.user.name)}`}
        barra={parou ? null : { rotulo: rotuloDaBarra(progresso), pct: progresso.percentual }}
        etapas={progresso.etapas}
      >
        {parou
          ? (comLista: boolean) => (
              <>
                <ErroEntrada
                  variante={variante}
                  texto={textoDoErro(parou, progresso.total, erroDeSinal(estado.erro, offline), comLista)}
                />
                <AcaoEntrada
                  variante={variante}
                  tipo="principal"
                  testID="tentar-de-novo"
                  rotulo={ROTULO_TENTAR_DE_NOVO}
                  onPress={() => void sincronizar()}
                />
                {offline ? (
                  <AcaoEntrada
                    variante={variante}
                    tipo="secundario"
                    testID="desligar-sem-sinal"
                    rotulo="Desligar modo sem sinal"
                    onPress={() => void setOffline(false)}
                  />
                ) : null}
                <AcaoEntrada
                  variante={variante}
                  tipo="link"
                  testID="trocar-usuario"
                  rotulo="Trocar usuário"
                  onPress={() => {
                    void logout().then(() => router.replace('/login'));
                  }}
                />
              </>
            )
          : null}
      </TelaEntrada>
      {liberada || (pronta && (tinhaCarga || mostrouPronto)) ? <Redirect href="/" /> : null}
    </>
  );
}
