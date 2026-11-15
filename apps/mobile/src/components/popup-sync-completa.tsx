/**
 * Popup da sincronização completa (R-20261115-100000; spec docs/design/sync-completa/spec.md §4), montado uma vez no shell
 * (`SincronizacaoDoShell`): vale no Início e no Perfil, no Campo e no Gestão. É o `Dialogo` do kit, sem botões e com o Voltar
 * bloqueado enquanto roda, com a `BarraProgresso` (a mesma da tela de carga, RD-0635) nas cores do tema Pérola. As etapas e o
 * percentual vêm do mesmo `progressoDaEntrada` (RN-CORE-48) da tela de carga; fases e textos em `lib/sync-completa.ts`.
 * Com erro: a linha de erro da carga, "Fechar" e "Tentar de novo", e o Voltar fecha. A tela fica acesa só enquanto roda.
 */
import { progressoDaEntrada } from '@macuxi/core/app';
import { useMotorSync } from '@macuxi/platform-sdk/react';
import {
  BarraProgresso,
  Dialogo,
  TEMAS_ENTRADA,
  TEXTOS_SYNC_COMPLETA,
  useReduzirMovimento,
} from '@macuxi/ui/mobile';
import { useKeepAwake } from 'expo-keep-awake';
import { useState } from 'react';

import { ErroEntrada } from '@/components/tela-entrada';
import { percentualDaCarga } from '@/lib/carga';
import { criarMemoriaDaEntrada, erroDeSinal, ROTULO_BARRA_ENTRADA } from '@/lib/entrada';
import {
  desenhoPopupCompleta,
  entradaDoProgressoCompleta,
  telaAcesaNaCompleta,
  type FaseCompleta,
} from '@/lib/sync-completa';
import { usePlataforma } from '@/state/plataforma';

const TEMA = TEMAS_ENTRADA.perola;

export function PopupSyncCompleta({
  fase,
  rodada,
  aoTentarDeNovo,
  aoFechar,
}: {
  fase: FaseCompleta;
  /** Número da rodada (cada "Tentar de novo" é outra): a etapa mostrada recomeça do 1. */
  rodada: number;
  aoTentarDeNovo: () => void;
  aoFechar: () => void;
}) {
  const { sessao, perfil, modulosAtivos, variante, offline } = usePlataforma();
  const { estado } = useMotorSync();
  const reduzir = useReduzirMovimento();
  // RN-CORE-48: a etapa mostrada nunca volta dentro da mesma rodada
  const [lembrar] = useState(criarMemoriaDaEntrada);
  const e = entradaDoProgressoCompleta(fase, estado, percentualDaCarga(estado, 'carregando'));
  const progresso = lembrar(`${sessao?.user.id ?? ''}|${rodada}`, (anterior) =>
    progressoDaEntrada({ perfil, modulos: modulosAtivos, carga: estado.carga, ...e, anterior }),
  );
  const d = desenhoPopupCompleta(fase, progresso, erroDeSinal(estado.erro, offline));
  return (
    <>
      {telaAcesaNaCompleta(fase) ? <TelaAcesa /> : null}
      <Dialogo
        visivel={d.visivel}
        titulo={TEXTOS_SYNC_COMPLETA.titulo}
        mensagem={TEXTOS_SYNC_COMPLETA.texto}
        bloqueado={d.bloqueado}
        onFechar={aoFechar}
        cancelar={
          d.botoes ? { rotulo: 'Fechar', onPress: aoFechar, testID: 'sync-completa-fechar' } : undefined
        }
        confirmar={
          d.botoes
            ? { rotulo: 'Tentar de novo', onPress: aoTentarDeNovo, testID: 'sync-completa-tentar' }
            : undefined
        }
        testID="sync-completa"
      >
        {d.barra ? (
          <BarraProgresso
            rotulo={d.barra.rotulo}
            pct={d.barra.pct}
            cores={TEMA}
            reduzirMovimento={reduzir}
            rotuloAcessivel={ROTULO_BARRA_ENTRADA}
            testID="sync-completa"
          />
        ) : null}
        {d.erro ? <ErroEntrada variante={variante} tema={TEMA} texto={d.erro} /> : null}
      </Dialogo>
    </>
  );
}

/** A tela não apaga enquanto a completa roda (spec §4); desmontado, o `expo-keep-awake` libera. */
function TelaAcesa() {
  useKeepAwake('sync-completa');
  return null;
}
