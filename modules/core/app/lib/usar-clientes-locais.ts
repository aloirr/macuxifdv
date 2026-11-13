/**
 * Hook das telas Clientes e Ficha: lê as entidades de cliente que o sync deixou no aparelho (`motor.linhas`) e
 * recarrega quando uma sincronização termina. Sem rede, sem chamada ao servidor (offline-first, RF-CORE-04).
 */
import type { ClienteContatoSync, ClienteEnderecoSync, ClienteFinanceiroSync, ClienteFotoSync, ClienteSync, FilialSync, FotoTipoSync, HistoricoCompraSync, ParametroSync, TituloSync } from '../../contracts';
import type { LinhaSync } from '@macuxi/platform-sdk';
import { useMotorSync } from '@macuxi/platform-sdk/react';
import { useEffect, useMemo, useState } from 'react';

import { dataLocal, fotosComPendentes, pedidosVisiveisNoAparelho, type FotoPdvPush } from '../../domain';
import { agruparPorCliente, montarCliente360Local, type BaseLocal, type Cliente360Local } from './cliente360-local';
import { fusoDe } from './estado';
import { useCore } from './usar-core';

export interface ClientesLocais extends BaseLocal {
  contatos: readonly ClienteContatoSync[];
  /** Endereços do cliente (T-0061): lidos do aparelho como o resto, sem rede. */
  enderecos: readonly ClienteEnderecoSync[];
  /** Filiais do tenant (RN-CORE-39): a ficha mostra a filial do cliente. */
  filiais: readonly FilialSync[];
  /** Fotos do PDV (RN-CORE-38): tipos do tenant e a foto vigente por cliente (arquivo_id nulo nos sensíveis). */
  fotoTipos: readonly FotoTipoSync[];
  clienteFotos: readonly ClienteFotoSync[];
  /** Fotos do PDV enviadas neste aparelho e ainda na fila (ou aceitas e não cobertas pelo pull): a ficha mostra "Tem" na hora. */
  fotosPendentes: readonly FotoPdvPush[];
  /** Há linhas de `cliente` no aparelho (o pull genérico já rodou); sem elas a tela cai na carga antiga da Fase M. */
  pronto: boolean;
  carregado: boolean;
  /**
   * RN-PRO-01 / RN-CORE-01: este usuário vê pedidos? Promotor com `promotor_ve_pedidos` desligado (parâmetro sincronizado) = false.
   * Vendedor, gestor e demais perfis: sempre true. Offline: vem das linhas do aparelho.
   */
  verPedidos: boolean;
}

const VAZIO: ClientesLocais = { clientes: [], financeiros: [], titulos: [], historico: [], contatos: [], enderecos: [], filiais: [], fotoTipos: [], clienteFotos: [], fotosPendentes: [], pronto: false, carregado: false, verPedidos: true };

export function useClientesLocais(): { dados: ClientesLocais; hoje: string } {
  const { motor, estado } = useMotorSync();
  const core = useCore();
  const [dados, setDados] = useState<ClientesLocais>(VAZIO);
  const hoje = dataLocal(new Date(), fusoDe(core.estado.me));

  useEffect(() => {
    if (!motor) return;
    let ativo = true;
    void (async () => {
      const [clientes, contatos, financeiros, titulos, historico, enderecos, parametros, filiais, fotoTipos, clienteFotos] = await Promise.all([
        motor.linhas<ClienteSync>('cliente'),
        motor.linhas<ClienteContatoSync>('cliente_contato'),
        motor.linhas<ClienteFinanceiroSync>('cliente_financeiro'),
        motor.linhas<TituloSync>('titulo'),
        motor.linhas<HistoricoCompraSync>('historico_compra'),
        motor.linhas<ClienteEnderecoSync>('cliente_endereco'),
        motor.linhas<ParametroSync & LinhaSync>('parametro'),
        motor.linhas<FilialSync>('filial'),
        motor.linhas<FotoTipoSync>('foto_tipo'),
        motor.linhas<ClienteFotoSync>('cliente_foto'),
      ]);
      const verPedidos = pedidosVisiveisNoAparelho(motor.ambiente.usuario()?.perfil, parametros);
      if (ativo) setDados({ clientes, contatos, financeiros, titulos, historico, enderecos, filiais, fotoTipos, clienteFotos, fotosPendentes: [], pronto: clientes.length > 0, carregado: true, verPedidos });
    })();
    return () => {
      ativo = false;
    };
  }, [motor, estado.sincronizado_em]);

  // offline primeiro (ADR 0009 §3): o que está na fila sobrepõe as linhas do pull
  const fotosPendentes = useMemo(
    () => (motor ? motor.sobreposicao(['cliente_foto']).map((i) => i.payload as FotoPdvPush) : []),
    [motor, estado.fila, estado.aceitos],
  );
  return { dados: useMemo(() => ({ ...dados, fotosPendentes }), [dados, fotosPendentes]), hoje };
}

/** Ficha 360 do cliente com as linhas do aparelho; `null` se o cliente não está no aparelho. */
export function montarFichaLocal(dados: ClientesLocais, clienteId: string, hoje: string): Cliente360Local | null {
  const cliente = dados.clientes.find((c) => c.id === clienteId && c.deleted_at === null);
  const pendentes = dados.fotosPendentes.filter((p) => p.cliente_id === clienteId);
  if (!cliente) return null;
  return montarCliente360Local(
    {
      cliente,
      contatos: agruparPorCliente(dados.contatos).get(clienteId) ?? [],
      financeiro: dados.financeiros.find((f) => f.cliente_id === clienteId) ?? null,
      titulos: agruparPorCliente(dados.titulos).get(clienteId) ?? [],
      historico: agruparPorCliente(dados.historico).get(clienteId) ?? [],
      enderecos: agruparPorCliente(dados.enderecos).get(clienteId) ?? [],
      filiais: [...dados.filiais],
      fotos_pdv: { tipos: [...dados.fotoTipos], fotos: fotosComPendentes(agruparPorCliente(dados.clienteFotos).get(clienteId) ?? [], pendentes, dados.fotoTipos) as ClienteFotoSync[], na_fila: pendentes.map((p) => p.foto_tipo_id) },
    },
    hoje,
    { verPedidos: dados.verPedidos },
  );
}
