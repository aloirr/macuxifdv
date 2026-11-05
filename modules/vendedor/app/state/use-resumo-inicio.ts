/**
 * Dados dos cards do Início (T-0076): lê SÓ o banco do aparelho (linhas do pull + fila) e relê quando o motor termina
 * uma sincronização ou a fila muda. Sem timer nem consulta própria (RN-CORE-23); offline funciona igual.
 */
import { useAmbiente, useMotorSync } from '@macuxi/platform-sdk/react';
import { useEffect, useMemo, useState } from 'react';
import { validadeOrcamentoDias } from '../../domain/orcamento';
import { mergeOrders, pedidosNaFila, type PedidoDaLista } from '../lib/pedidos';
import { preVendaAtiva } from '../lib/pre-venda';
import { lerLinhas, listaDePedidos } from '../lib/pull';
import { criarRepositorio } from '../lib/repositorio';
import { resumoDoInicio, type ResumoDoInicio } from '../lib/resumo-inicio';

export function useResumoInicio(): ResumoDoInicio | null {
  const { motor, estado } = useMotorSync();
  const ambiente = useAmbiente();
  const usuario = ambiente.usuario();
  const parametros = ambiente.parametros('vendedor');
  const [pedidos, setPedidos] = useState<PedidoDaLista[] | null>(null);
  const filaVendedor = useMemo(() => estado.fila.filter((i) => i.modulo === 'vendedor'), [estado.fila]);

  useEffect(() => {
    if (!motor || !usuario) return;
    let vivo = true;
    void (async () => {
      const [linhas, dados] = await Promise.all([lerLinhas(motor), criarRepositorio(motor.armazenamentoDoModulo('vendedor')).carregar()]);
      if (!vivo) return;
      const eu = { id: usuario.id, name: usuario.nome, branch_id: '' };
      setPedidos(mergeOrders(listaDePedidos(linhas, parametros), pedidosNaFila(filaVendedor, dados.exibicoes), eu));
    })();
    return () => {
      vivo = false;
    };
    // `parametros` e `usuario` mudam de identidade a cada render do ambiente; o gatilho real é o sync e a fila
  }, [motor, estado.sincronizado_em, filaVendedor]);

  return useMemo(
    () =>
      pedidos && usuario
        ? resumoDoInicio(pedidos, { agora: new Date(), fuso: usuario.fuso || 'America/Sao_Paulo', diasValidade: validadeOrcamentoDias(parametros), vendedorId: usuario.id, preVendaLigada: preVendaAtiva(parametros) })
        : null,
    [pedidos, usuario?.id, usuario?.fuso],
  );
}
