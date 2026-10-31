/**
 * Hook das telas do Core no app: estado do aparelho (carteira, rota, metas, visitas) lido do armazenamento do
 * módulo + derivados (atendimento aberto, rota efetiva). Só fala com o shell por `@macuxi/platform-sdk/react`.
 */
import { useMotorSync } from '@macuxi/platform-sdk/react';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { armazemDe, ESTADO_VAZIO, fusoDe, pedidosDaFila, vendedorDe, type ArmazemCore, type EstadoCore } from './estado';
import { effectiveRoute, type LocalVisit } from './route';
import { openLocalVisit, type OrderLike } from './visit';

const TICK_MS = 30_000;
const semAssinatura = () => () => {};

export interface UsoCore {
  armazem: ArmazemCore | null;
  motor: ReturnType<typeof useMotorSync>['motor'];
  estado: EstadoCore;
  tz: string;
  vendedorId: string;
  /** Atendimento (check-in) aberto do vendedor no aparelho, ou null. */
  atendimentoAberto: LocalVisit | null;
  /** Rota de hoje com as visitas do aparelho aplicadas (status efetivo das paradas). */
  rota: ReturnType<typeof effectiveRoute>;
  /** Pedidos do mês + pedidos ainda na fila (para ligar pedido à visita, RN-CORE-12). */
  pedidos: OrderLike[];
  sincronizando: boolean;
  /** Tenta sincronizar agora (envia a fila, puxa as cargas). */
  sincronizar: () => void;
}

export function useCore(): UsoCore {
  const { motor, estado: estadoMotor } = useMotorSync();
  const armazem = useMemo(() => (motor ? armazemDe(motor) : null), [motor]);
  const estado = useSyncExternalStore(
    armazem ? armazem.assinar : semAssinatura,
    armazem ? armazem.obter : () => ESTADO_VAZIO,
    () => ESTADO_VAZIO,
  );

  // recarrega do armazenamento quando o motor termina uma sincronização
  useEffect(() => {
    void armazem?.carregar();
  }, [armazem, estadoMotor.sincronizado_em]);

  const tz = fusoDe(estado.me);
  const vendedorId = vendedorDe(estado.me);

  // relógio do atendimento: tempo decorrido e fechamento na virada do dia sem depender de rede
  const [nowMs, setNowMs] = useState(() => Date.now());
  const temCandidata = estado.visitas.some((v) => !v.checkout_at);
  useEffect(() => {
    if (!temCandidata) return;
    setNowMs(Date.now());
    const h = setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => clearInterval(h);
  }, [temCandidata]);

  const atendimentoAberto = useMemo(() => openLocalVisit(estado.visitas, vendedorId, new Date(nowMs), tz), [estado.visitas, vendedorId, nowMs, tz]);
  const rota = useMemo(() => effectiveRoute(estado.rota, estado.visitas, new Date(nowMs), tz), [estado.rota, estado.visitas, nowMs, tz]);
  const pedidos = useMemo(() => {
    const fila = pedidosDaFila(estadoMotor.fila);
    const ids = new Set(fila.map((p) => p.id));
    return [...estado.pedidos.filter((p) => !ids.has(p.id)), ...fila];
  }, [estado.pedidos, estadoMotor.fila]);

  return {
    armazem,
    motor,
    estado,
    tz,
    vendedorId,
    atendimentoAberto,
    rota,
    pedidos,
    sincronizando: estadoMotor.sincronizando,
    sincronizar: () => {
      if (motor) void motor.sincronizar();
    },
  };
}
