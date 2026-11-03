/**
 * Hook das telas Clientes e Ficha: lê as entidades de cliente que o sync deixou no aparelho (`motor.linhas`) e
 * recarrega quando uma sincronização termina. Sem rede, sem chamada ao servidor (offline-first, RF-CORE-04).
 */
import type { ClienteContatoSync, ClienteEnderecoSync, ClienteFinanceiroSync, ClienteSync, HistoricoCompraSync, TituloSync } from '../../contracts';
import { useMotorSync } from '@macuxi/platform-sdk/react';
import { useEffect, useState } from 'react';

import { dataLocal } from '../../domain';
import { agruparPorCliente, montarCliente360Local, type BaseLocal, type Cliente360Local } from './cliente360-local';
import { fusoDe } from './estado';
import { useCore } from './usar-core';

export interface ClientesLocais extends BaseLocal {
  contatos: readonly ClienteContatoSync[];
  /** Endereços do cliente (T-0061): lidos do aparelho como o resto, sem rede. */
  enderecos: readonly ClienteEnderecoSync[];
  /** Há linhas de `cliente` no aparelho (o pull genérico já rodou); sem elas a tela cai na carga antiga da Fase M. */
  pronto: boolean;
  carregado: boolean;
}

const VAZIO: ClientesLocais = { clientes: [], financeiros: [], titulos: [], historico: [], contatos: [], enderecos: [], pronto: false, carregado: false };

export function useClientesLocais(): { dados: ClientesLocais; hoje: string } {
  const { motor, estado } = useMotorSync();
  const core = useCore();
  const [dados, setDados] = useState<ClientesLocais>(VAZIO);
  const hoje = dataLocal(new Date(), fusoDe(core.estado.me));

  useEffect(() => {
    if (!motor) return;
    let ativo = true;
    void (async () => {
      const [clientes, contatos, financeiros, titulos, historico, enderecos] = await Promise.all([
        motor.linhas<ClienteSync>('cliente'),
        motor.linhas<ClienteContatoSync>('cliente_contato'),
        motor.linhas<ClienteFinanceiroSync>('cliente_financeiro'),
        motor.linhas<TituloSync>('titulo'),
        motor.linhas<HistoricoCompraSync>('historico_compra'),
        motor.linhas<ClienteEnderecoSync>('cliente_endereco'),
      ]);
      if (ativo) setDados({ clientes, contatos, financeiros, titulos, historico, enderecos, pronto: clientes.length > 0, carregado: true });
    })();
    return () => {
      ativo = false;
    };
  }, [motor, estado.sincronizado_em]);

  return { dados, hoje };
}

/** Ficha 360 do cliente com as linhas do aparelho; `null` se o cliente não está no aparelho. */
export function montarFichaLocal(dados: ClientesLocais, clienteId: string, hoje: string): Cliente360Local | null {
  const cliente = dados.clientes.find((c) => c.id === clienteId && c.deleted_at === null);
  if (!cliente) return null;
  return montarCliente360Local(
    {
      cliente,
      contatos: agruparPorCliente(dados.contatos).get(clienteId) ?? [],
      financeiro: dados.financeiros.find((f) => f.cliente_id === clienteId) ?? null,
      titulos: agruparPorCliente(dados.titulos).get(clienteId) ?? [],
      historico: agruparPorCliente(dados.historico).get(clienteId) ?? [],
      enderecos: agruparPorCliente(dados.enderecos).get(clienteId) ?? [],
    },
    hoje,
  );
}
