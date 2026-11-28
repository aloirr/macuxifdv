/**
 * Hook das telas Clientes e Ficha: lê as entidades de cliente que o sync deixou no aparelho (`motor.linhas`) e
 * recarrega quando uma sincronização termina. Sem rede, sem chamada ao servidor (offline-first, RF-CORE-04).
 */
import type { ClienteContatoSync, ClienteEnderecoSync, ClienteVisitaResumoSync, ClienteFinanceiroSync, VisitaSync, ClienteFotoSync, ClienteSync, FilialSync, FotoTipoSync, HistoricoCompraSync, ParametroSync, TituloSync } from '../../contracts';
import type { LinhaSync } from '@macuxi/platform-sdk';
import type { PedidoItemSync, PedidoSync } from '../../../vendedor/contracts';
import { useMotorSync } from '@macuxi/platform-sdk/react';
import { useEffect, useMemo, useState } from 'react';

import { dataLocal, faixasCurvaAbcDasLinhas, PARAMETROS_CURVA_ABC_PADRAO, fotosComPendentes, pedidosVisiveisPelaLeitura, type FaixasPorDimensao, type FotoPdvPush } from '../../domain';
import { agruparPorCliente, montarCliente360Local, type BaseLocal, type Cliente360Local } from './cliente360-local';
import { fusoDe } from './estado';
import { leituraDePedidosGuardada } from './leitura-de-pedidos';
import { ENTIDADE_PRE_CADASTRO, sobreporPreCadastros } from './pre-cadastro-local';
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
   * RN-PRO-01 / RN-CORE-01 / ADR 0073 §2.4: este usuário vê pedidos? Tenant em `concessao`: a leitura guardada do usuário (cargo e
   * concessão). Em `legado`: promotor com `promotor_ve_pedidos` desligado = false; demais perfis, true. Offline: vem do aparelho.
   */
  verPedidos: boolean;
  /** Perfil da sessão (abas da ficha, "Visitada por" no Gestão); sem sessão, `vendedor`. */
  perfil: string;
  /** RN-CORE-49: faixas das curvas ABC do tenant (parâmetros `cliente.curva_abc.<dimensão>`; ausente = padrão por dimensão). */
  faixasCurva: FaixasPorDimensao;
  /** RN-CORE-50 (aba Performance): pedidos, itens e visitas já sincronizados no aparelho, para prazo médio, últimos itens e visitas. Contratos do Vendedor (só leitura). */
  pedidos: readonly PedidoSync[];
  pedidoItens: readonly PedidoItemSync[];
  visitasSync: readonly VisitaSync[];
  /** RN-CORE-50: total de visitas e quem visitou por último (servidor, qualquer usuário); vazio = vale o cálculo local. */
  resumosVisita: readonly ClienteVisitaResumoSync[];
}

const VAZIO: ClientesLocais = { clientes: [], financeiros: [], titulos: [], historico: [], contatos: [], enderecos: [], filiais: [], fotoTipos: [], clienteFotos: [], fotosPendentes: [], pronto: false, carregado: false, verPedidos: true, perfil: 'vendedor', faixasCurva: PARAMETROS_CURVA_ABC_PADRAO, pedidos: [], pedidoItens: [], visitasSync: [], resumosVisita: [] };

export function useClientesLocais(): { dados: ClientesLocais; hoje: string } {
  const { motor, estado } = useMotorSync();
  const core = useCore();
  const [dados, setDados] = useState<ClientesLocais>(VAZIO);
  const hoje = dataLocal(new Date(), fusoDe(core.estado.me));

  useEffect(() => {
    if (!motor) return;
    let ativo = true;
    void (async () => {
      const [clientes, contatos, financeiros, titulos, historico, enderecos, parametros, filiais, fotoTipos, clienteFotos, pedidos, pedidoItens, visitasSync, resumosVisita, leitura] = await Promise.all([
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
        motor.linhas<PedidoSync>('pedido'),
        motor.linhas<PedidoItemSync>('pedido_item'),
        motor.linhas<VisitaSync>('visita'),
        motor.linhas<ClienteVisitaResumoSync>('cliente_visita_resumo'),
        leituraDePedidosGuardada(motor.armazenamentoDoModulo('core')),
      ]);
      const usuario = motor.ambiente.usuario();
      const perfil = usuario?.perfil ?? 'vendedor';
      const verPedidos = pedidosVisiveisPelaLeitura({ usuarioId: usuario?.id, perfil, parametros, leitura });
      if (ativo) setDados({ clientes, contatos, financeiros, titulos, historico, enderecos, filiais, fotoTipos, clienteFotos, fotosPendentes: [], pronto: clientes.length > 0, carregado: true, verPedidos, perfil, faixasCurva: faixasCurvaAbcDasLinhas(parametros), pedidos: verPedidos ? pedidos.filter((p) => p.deleted_at === null) : [], pedidoItens: verPedidos ? pedidoItens.filter((i) => i.deleted_at === null) : [], visitasSync: visitasSync.filter((v) => v.deleted_at === null), resumosVisita: resumosVisita.filter((r) => r.deleted_at === null) });
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
  // v1.0.28 / RN-CORE-78: o pré-cadastro na fila aparece na hora na lista e na ficha, com o selo "Aguardando ERP"
  const clientes = useMemo(
    () => (motor ? sobreporPreCadastros(dados.clientes, motor.sobreposicao([ENTIDADE_PRE_CADASTRO]), new Date().toISOString()) : dados.clientes),
    [motor, dados.clientes, estado.fila, estado.aceitos],
  );
  return { dados: useMemo(() => ({ ...dados, clientes, pronto: dados.pronto || clientes.length > 0, fotosPendentes }), [dados, clientes, fotosPendentes]), hoje };
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
