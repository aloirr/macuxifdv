/**
 * Pré-cadastro de cliente no Campo (v1.0.28; decisão do dono do produto de 23/11/2026): o vendedor cadastra o cliente
 * novo sem sinal e o cadastro sobe pelo sync ao ERP. As telas são do Core: a lista já traz "Novo cliente"
 * (`TelaClientesDoShell`, só para o vendedor, RN-CORE-78) e o formulário é `TelaNovoClientePreCadastro`. O shell só
 * registra a rota do formulário, no endereço que o Core navega (`ROTA_NOVO_CLIENTE`, `abrirNovoCliente`).
 * Puro (sem react-native): roda em Node (Vitest).
 *
 * A rota vale só na variante campo, só para o perfil vendedor e com a ação `cliente.pre_cadastrar` do manifesto do
 * Core: o promotor nunca abre o formulário e o Gestão não tem a rota.
 */
import type { ModuloShell } from '@macuxi/platform-sdk';

export const ACAO_PRE_CADASTRAR_CLIENTE = 'cliente.pre_cadastrar';
const PREFIXO_MODULO = '/m/';

/** O `caminho` da página a partir do endereço do Core (`/m/<caminho>`); nada quando o endereço foge da convenção. */
export function caminhoDaRota(rota: string | undefined): string | undefined {
  if (!rota?.startsWith(PREFIXO_MODULO)) return undefined;
  const caminho = rota.slice(PREFIXO_MODULO.length);
  return caminho && !/[/?#]/.test(caminho) ? caminho : undefined;
}

/** O id do cliente a corrigir, vindo da query (`?clienteId=`): o primeiro valor, ou nada quando vazio. */
export function clienteIdDaRota(id: string | string[] | undefined): string | undefined {
  const v = Array.isArray(id) ? id[0] : id;
  return v ? v : undefined;
}

/**
 * Acrescenta ao Core a página do formulário no caminho de `rota`. Sem a tela ou a rota do Core (export ainda ausente),
 * o módulo segue como está; não duplica a página se o Core já a registrar.
 */
export function comPreCadastroCliente<C>(m: ModuloShell<C>, tela: { rota?: string; formulario?: C }): ModuloShell<C> {
  const caminho = caminhoDaRota(tela.rota);
  if (m.manifesto.id !== 'core' || !caminho || !tela.formulario) return m;
  if ((m.paginas ?? []).some((p) => p.caminho === caminho)) return m;
  return {
    ...m,
    paginas: [
      ...(m.paginas ?? []),
      { id: caminho, caminho, titulo: 'Novo cliente', apps: ['campo'], perfis: ['vendedor'], acao: ACAO_PRE_CADASTRAR_CLIENTE, componente: tela.formulario },
    ],
  };
}
