/**
 * Banner "etapa pendente" da equipe na ficha do cliente do Gestão (T-0102; docs/design/checkout-pendencia.md §2.2;
 * RN-CORE-12). Mesmo `Banner` do §1.2 (warning, `clock`), com o texto do supervisor e SEM botão.
 * Lê só o aparelho (offline-first, RN-CORE-23): visitas da equipe do pull `visita` do Core e nomes da visão do Gestor;
 * relê quando o motor termina uma sincronização. Pendência zerada no pull ⇒ o Banner some, sem texto de "resolvido".
 * Registrado no slot `cliente.avisos` do Core (`registro-inicio.ts`): `apps: ['gestao']`, `acao: 'painel_equipe.ver'`.
 */
import type { ContextoCliente } from '@macuxi/core/contracts';
import { useAmbiente, useMotorSync } from '@macuxi/platform-sdk/react';
import { Banner, Strong } from '@macuxi/ui/mobile';
import { useEffect, useMemo, useState } from 'react';
import { avisoEtapaPendenteDaEquipe, type VisitaDaEquipe } from '../../domain/etapa-pendente-equipe';
import { nomesDaVisao } from '../lib/apresentacao';
import { criarCache } from '../lib/cache';
import type { VisaoEquipe } from '../../contracts';

export function AvisoEtapaEquipe({ contexto }: { contexto: ContextoCliente }) {
  const { motor, estado } = useMotorSync();
  const usuario = useAmbiente().usuario();
  const [visitas, setVisitas] = useState<VisitaDaEquipe[]>([]);
  const [visao, setVisao] = useState<VisaoEquipe | null>(null);

  useEffect(() => {
    if (!motor) return;
    let vivo = true;
    const cache = criarCache(motor.armazenamentoDoModulo('gestor'));
    void Promise.all([motor.linhas<VisitaDaEquipe>('visita').catch(() => []), cache.carregar()]).then(([v, d]) => {
      if (!vivo) return;
      setVisitas(v);
      setVisao(d.visao);
    });
    return () => {
      vivo = false;
    };
  }, [motor, estado.sincronizado_em]);

  const aviso = useMemo(
    () => avisoEtapaPendenteDaEquipe(visitas, { clienteId: contexto.clienteId, perfil: usuario?.perfil, usuarioId: usuario?.id, nomes: nomesDaVisao(visao) }),
    [visitas, visao, contexto.clienteId, usuario?.perfil, usuario?.id],
  );
  if (!aviso) return null;
  return (
    <Banner tone="warning" icon="clock" testID="gestor.cliente-etapa-pendente-equipe">
      <Strong>{aviso.linha1}</Strong>
      {'\n'}
      {aviso.linha2}
    </Banner>
  );
}
