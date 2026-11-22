/**
 * API do módulo Integracao.
 *  - Hub `/integracao/v1` (chamado pelo Conector, chave de API por Conector, sem JWT): `conector` do `ModuloApi` (ADR 0013), ids e
 *    caminhos de `ROTAS_HUB`. Cada rota tem a regra no `domain`; aqui só SQL no schema `integracao`, transação e evento.
 *  - BKO `/v1/integracao/*` (JWT, perfil por ação do manifesto): monitor, Conectores, decisão da inativação em massa e carga por arquivo (RF-INT-03).
 * O pepper da chave (`MACUXI_HUB_CHAVE_PEPPER`) é lido a cada chamada; ausente ou curto = 503 (falha fechada).
 */
import { definirApiConector, definirModuloApi, type ContextoConector, type ModuloApi, type RotaConector } from '@macuxi/platform-sdk';
import type { z } from 'zod';
import manifest from '../manifest';
import { CabecalhosConector, ParamsLote, ParamsPedido, QueryConsultaLote, QueryPedidosPendentes, ReconciliacaoEnvio, ROTAS_HUB, RetornoErp, SinalConector } from '../contracts';
import { consumidorLoteRecebido } from './aplicar-lote';
import { consumidorMarcaDesconhecida } from './consumidor-marca-desconhecida';
import { rotaApagarMapeamento, rotaGravarMapeamento, rotaListarMapeamentos, rotaReprocessarRetidos } from './bko-mapeamento';
import { consumidorPedidoAprovado, consumidorPedidoCancelado, consumidorPedidoStatusAlterado } from './consumidores-pedido';
import { consultaCancelamentoErp } from './consulta-cancelamento';
import { criarAutenticacaoHub, type ConectorHub } from './autenticacao';
import { rotaCargaArquivo, rotaConferirArquivo, rotaErrosLote, rotaErrosLoteCsv, rotaLote, rotaOrdemCarga, rotaProgressoSessaoArquivo } from './bko-carga-arquivo';
import { rotaModeloCsv, rotaModeloDicionario } from './bko-modelos';
import { rotaDecidirInativacao } from './bko-inativacao';
import { criarLimiteTentativas, criarRotaReprocessarLote, rotaCancelarLote, rotaCodigosMacuxi, rotaListarAutorizadores, verificadorSenhaIndisponivel, type VerificadorSenha } from './bko-lotes-acoes';
import { criarRotasConectores } from './bko-conectores';
import { rotaDownloadConector } from './conector-download';
import { rotaMonitor } from './bko-monitor';
import { documentoOpenApiPublico } from './openapi/publico';
import { rotaGuiaPdf } from './guia-pdf-rota';
import { rotaGravarPolitica, rotaLerPolitica } from './bko-politica';
import { consultarCursor, consultarLote, enviarLote, enviarReconciliacao } from './rotas-lotes';
import { pedidosPendentes, retornoPedido, sinalDeVida } from './rotas-pedidos';

export { gerarOpenApiHub, openApiHub, type DocumentoOpenApi } from './openapi/gerar';
export { documentoOpenApiPublico } from './openapi/publico';
export type { VerificadorSenha } from './bko-lotes-acoes';

const LIMITE_CORPO_LOTE = 8 * 1024 * 1024;
const MAX_ELEMENTOS_LOTE = 1_000_000;

/** Caminho e método das rotas vêm do contrato (`ROTAS_HUB`): mudou lá, muda aqui. */
function doContrato(id: string): { id: string; metodo: 'GET' | 'POST'; caminho: string; cabecalhos: z.ZodTypeAny } {
  const r = ROTAS_HUB.find((x) => x.id === id);
  if (!r) throw new Error(`rota ${id} não existe em ROTAS_HUB`);
  return { id: r.id, metodo: r.metodo, caminho: r.caminho, cabecalhos: r.cabecalhos };
}

// as rotas têm tipos de corpo/query/params próprios; o array é homogêneo para a plataforma
const rota = (r: unknown) => r as RotaConector<ConectorHub>;

/** `verificarSenha`: conferência da senha do autorizador do reprocessamento (RN-INT-16); sem ela, a autorização por senha responde 503. */
export function criarModuloApiIntegracao(o: { pepper: () => string | undefined; verificarSenha?: VerificadorSenha }): ModuloApi {
  const auth = criarAutenticacaoHub(o);
  const rotasConector: RotaConector<ConectorHub>[] = [
    // sem `corpo` e com cabeçalhos base: o envelope e a Idempotency-Key são validados no módulo (400 chave_idempotencia_invalida /
    // envelope_invalido, 422 com `erros[]`, que o Conector lê)
    rota({ ...doContrato('enviar_lote'), cabecalhos: CabecalhosConector, status: 202, limiteCorpoBytes: LIMITE_CORPO_LOTE, maxElementosCorpo: MAX_ELEMENTOS_LOTE, executar: enviarLote }),
    rota({ ...doContrato('consultar_lote'), params: ParamsLote, query: QueryConsultaLote, executar: consultarLote }),
    // entidade desconhecida é 404 `entidade_desconhecida` (ROTAS_HUB), não 400: o módulo valida o parâmetro
    rota({ ...doContrato('consultar_cursor'), executar: consultarCursor }),
    rota({ ...doContrato('enviar_reconciliacao'), corpo: ReconciliacaoEnvio, executar: enviarReconciliacao }),
    rota({ ...doContrato('pedidos_pendentes'), query: QueryPedidosPendentes, executar: pedidosPendentes }),
    rota({ ...doContrato('retorno_pedido'), params: ParamsPedido, corpo: RetornoErp, executar: retornoPedido }),
    rota({ ...doContrato('sinal'), corpo: SinalConector, executar: (ctx: ContextoConector<ConectorHub, SinalConector>) => sinalDeVida(ctx, auth.politicaDaRequisicao(ctx as ContextoConector<ConectorHub>)) }),
  ];

  return definirModuloApi({
    manifesto: manifest,
    // A7 (aplica o lote recebido) e A8 (pedido aprovado entra na fila do ERP; saída de aprovado a retira): ADR 0007, hub-api.md §7/§11
    consumidores: [consumidorLoteRecebido, consumidorPedidoAprovado, consumidorPedidoStatusAlterado, consumidorPedidoCancelado, consumidorMarcaDesconhecida],
    consultas: [consultaCancelamentoErp],
    rotas: [rotaMonitor, ...criarRotasConectores(o), rotaLerPolitica, rotaGravarPolitica, rotaDecidirInativacao, rotaListarMapeamentos, rotaGravarMapeamento, rotaApagarMapeamento, rotaReprocessarRetidos, rotaCodigosMacuxi, rotaListarAutorizadores, rotaCancelarLote, criarRotaReprocessarLote({ verificarSenha: o.verificarSenha ?? verificadorSenhaIndisponivel, limite: criarLimiteTentativas() }), rotaCargaArquivo, rotaProgressoSessaoArquivo, rotaLote, rotaErrosLote, rotaErrosLoteCsv, rotaOrdemCarga, rotaConferirArquivo, rotaModeloCsv, rotaModeloDicionario, rotaDownloadConector],
    // T-0092: especificação e guia em PDF públicos (sem token); ETag, 304 e Cache-Control são da plataforma
    rotasPublicas: [{ metodo: 'GET', caminho: 'openapi.json', limite: { max: 60, janelaMs: 60_000 }, cache: { maxAgeSegundos: 3600 }, executar: async () => documentoOpenApiPublico() }, rotaGuiaPdf],
    conector: definirApiConector<ConectorHub>({ autenticar: auth.autenticar, antes: auth.antes, rotas: rotasConector }),
  });
}

export const moduloApi: ModuloApi = criarModuloApiIntegracao({ pepper: () => process.env.MACUXI_HUB_CHAVE_PEPPER });
export default moduloApi;
