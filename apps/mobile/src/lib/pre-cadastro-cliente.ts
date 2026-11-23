/**
 * Pré-cadastro de cliente no Campo (v1.0.28; decisão do dono do produto de 23/11/2026): o vendedor cadastra o cliente
 * novo sem sinal, o cadastro sobe pelo sync ao ERP e não passa por aprovação no BKO. As telas são do Core
 * (`TelaNovoClientePreCadastro` e a lista `TelaClientes` com `aoNovoCliente`); o shell só monta a rota e liga a navegação.
 * Puro (sem react-native): roda em Node (Vitest).
 *
 * - Rota `/m/cliente-novo` (cadastro novo) e `/m/cliente-novo?id=<clienteId>` ("Corrigir e reenviar"), só na variante
 *   campo, só para o perfil vendedor e com a ação `cliente.pre_cadastrar` do manifesto do Core. O promotor nunca abre
 *   (nenhuma RN deixa o promotor cadastrar cliente) e o Gestão não tem a rota.
 * - "Novo cliente" na lista só com a mesma condição; ao concluir, volta à lista (o histórico do shell volta até ela,
 *   sem deixar o formulário na pilha do voltar do Android).
 */
import type { AppShell, ModuloShell, PaginaShell, Perfil } from '@macuxi/platform-sdk';

export const CAMINHO_NOVO_CLIENTE = 'cliente-novo';
export const ACAO_PRE_CADASTRAR_CLIENTE = 'cliente.pre_cadastrar';
export const HREF_LISTA_CLIENTES = '/m/clientes';
const ID_PAGINA_LISTA = 'clientes';

/** Endereço do formulário: sem id, cliente novo; com id, "Corrigir e reenviar" daquele cliente. */
export function hrefNovoCliente(clienteId?: string): string {
  return clienteId ? `/m/${CAMINHO_NOVO_CLIENTE}?id=${encodeURIComponent(clienteId)}` : `/m/${CAMINHO_NOVO_CLIENTE}`;
}

/** Só o vendedor, no Campo, com a ação liberada vê "Novo cliente" (o promotor e o Gestão nunca). */
export function podeNovoCliente(v: { app: AppShell; perfil: Perfil | null; pode(acao: string): boolean }): boolean {
  return v.app === 'campo' && v.perfil === 'vendedor' && v.pode(ACAO_PRE_CADASTRAR_CLIENTE);
}

/** O id do cliente a corrigir, vindo da query (`?id=`): o primeiro valor, ou nada quando vazio. */
export function clienteIdDaRota(id: string | string[] | undefined): string | undefined {
  const v = Array.isArray(id) ? id[0] : id;
  return v ? v : undefined;
}

/**
 * Liga o pré-cadastro no módulo Core: troca a tela da lista pela versão com "Novo cliente" e acrescenta a rota do
 * formulário. Sem a tela do Core (export ainda ausente), o módulo segue como está. Não duplica a rota se o Core já a
 * registrar.
 */
export function comPreCadastroCliente<C>(m: ModuloShell<C>, telas: { lista?: C; formulario?: C }): ModuloShell<C> {
  if (m.manifesto.id !== 'core' || !telas.formulario) return m;
  if ((m.paginas ?? []).some((p) => p.caminho === CAMINHO_NOVO_CLIENTE)) return m;
  const lista = telas.lista;
  const paginas: PaginaShell<C>[] = (m.paginas ?? []).map((p) => (p.id === ID_PAGINA_LISTA && lista ? { ...p, componente: lista } : p));
  paginas.push({
    id: CAMINHO_NOVO_CLIENTE,
    caminho: CAMINHO_NOVO_CLIENTE,
    titulo: 'Novo cliente',
    apps: ['campo'],
    perfis: ['vendedor'],
    acao: ACAO_PRE_CADASTRAR_CLIENTE,
    componente: telas.formulario,
  });
  return { ...m, paginas };
}
