/**
 * Botão "Sincronizar" do Início e do Perfil, Campo e Gestão (estoque diário, parte E; ADR 0057; spec
 * docs/design/sincronizacao-completa.md §1 e §2): o `BotaoSincronizar` do kit com toque = parcial e segurar 10 s = completa,
 * e o `PopupSincronizacaoCompleta` com a barra da tela de carga. Limite manual de 30 s silencioso
 * (`lib/sincronizacao-manual`). O "puxar para baixo" não passa por aqui.
 */
import { progressoDaEntrada } from '@macuxi/core/app';
import { useMotorSync } from '@macuxi/platform-sdk/react';
import { BotaoSincronizar, PopupSincronizacaoCompleta } from '@macuxi/ui/mobile';
import { useRef, useState } from 'react';

import { percentualDaCarga } from '@/lib/carga';
import { criarMemoriaDaEntrada, erroDeSinal } from '@/lib/entrada';
import { criarSincronizacaoManual, popupDaCompleta, type FasePopupCompleta } from '@/lib/sincronizacao-manual';
import { usePlataforma } from '@/state/plataforma';

export function SincronizarDoShell({
  testID,
  avisoDados,
}: {
  testID?: string;
  avisoDados?: string | null;
}) {
  const { sincronizarManual, limiteManual, sessao, perfil, modulosAtivos, offline } = usePlataforma();
  const { estado } = useMotorSync();
  const [fase, setFase] = useState<FasePopupCompleta>('fechado');
  // cada completa começa a contagem das etapas do zero (RN-CORE-48: dentro dela, a etapa nunca volta)
  const [rodada, setRodada] = useState(0);
  const [lembrar] = useState(criarMemoriaDaEntrada);
  const sincronizarRef = useRef(sincronizarManual);
  sincronizarRef.current = sincronizarManual;
  const [manual] = useState(() =>
    criarSincronizacaoManual({
      limite: limiteManual,
      // a versão atual da plataforma (troca de sessão ou de modo), sem recriar o controle
      sincronizar: (modo) => sincronizarRef.current(modo),
      aoMudar: (f) => {
        if (f === 'andando') setRodada((n) => n + 1);
        setFase(f);
      },
    }),
  );

  const andando = fase === 'andando';
  const progresso = lembrar(`${sessao?.user.id ?? ''}|${sessao?.tenant?.id ?? ''}|${rodada}`, (anterior) =>
    progressoDaEntrada({
      perfil,
      modulos: modulosAtivos,
      carga: estado.carga,
      progresso: percentualDaCarga(estado, andando ? 'carregando' : 'erro') / 100,
      sincronizando: andando,
      erro: fase === 'erro' ? (estado.erro ?? 'erro') : null,
      sincronizado: fase === 'pronto',
      anterior,
    }),
  );
  const popup = popupDaCompleta(fase, progresso, erroDeSinal(estado.erro, offline));

  return (
    <>
      <BotaoSincronizar testID={testID} avisoDados={avisoDados} onPress={manual.tocar} onSegurar={manual.segurar} />
      <PopupSincronizacaoCompleta
        visivel={popup.visivel}
        rotulo={popup.rotulo}
        pct={popup.pct}
        erro={popup.erro}
        onTentarDeNovo={manual.tentarDeNovo}
        onFechar={manual.fechar}
      />
    </>
  );
}
