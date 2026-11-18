/**
 * Apresentação da Integração ERP no BKO (T-0051, T-0173; RF-INT-04): rótulos em português, tons dos selos e o que a tela permite
 * fazer. Funções puras e testadas. As REGRAS vêm do domain (`autorizarAcaoIntegracao` — P-3; `statusDoLote` — RN-INT-15): aqui
 * só se compõe a resposta para a interface. A proteção real continua na API.
 */
import { PERFIS, type Perfil } from '@macuxi/platform-sdk';
import type { BadgeTone } from '@macuxi/ui/web';
import type { Entidade, EstadoLoteBko } from '../../contracts';
import { autorizarAcaoIntegracao, statusDoLote, type AcaoIntegracao, type StatusLote } from '../../domain';

/** RN-INT-15: os 5 status que a pessoa vê; o estado técnico do lote vira um deles em `statusDoLote` (domain). */
export const ROTULO_STATUS: Record<StatusLote, string> = {
  em_andamento: 'Em andamento',
  concluido: 'Concluído',
  concluido_com_avisos: 'Concluído com avisos',
  com_falha: 'Com falha',
  cancelado: 'Cancelado',
};

export const TOM_STATUS: Record<StatusLote, BadgeTone> = {
  em_andamento: 'pending',
  concluido: 'success',
  concluido_com_avisos: 'warning',
  com_falha: 'danger',
  cancelado: 'neutral',
};

/** Rótulo e tom do status da pessoa para o estado técnico do lote (RN-INT-15), via `statusDoLote` do domain. Aceita `EstadoLote` (v1) e `EstadoLoteBko`. */
export const rotuloDoLote = (estado: EstadoLoteBko): string => ROTULO_STATUS[statusDoLote(estado)];
export const tomDoLote = (estado: EstadoLoteBko): BadgeTone => TOM_STATUS[statusDoLote(estado)];

export const ROTULO_ENTIDADE: Record<Entidade, string> = {
  vendedor: 'Vendedores',
  cliente: 'Clientes',
  produto: 'Produtos',
  preco: 'Preços',
  estoque: 'Estoque',
  titulo: 'Títulos',
  nota: 'Notas fiscais',
  rota: 'Rotas',
  catalogo_no: 'Árvore do catálogo',
  produto_unidade: 'Unidades do produto',
  cliente_endereco: 'Endereços de clientes',
  transportadora: 'Transportadoras',
  forma_pagamento: 'Formas de pagamento',
  prazo_pagamento: 'Prazos de pagamento',
  tabela_escalonada: 'Tabela escalonada',
  filial: 'Filiais',
};

export const ROTULO_TIPO_MAPEAMENTO: Record<'condicao_pagamento' | 'deposito' | 'status' | 'canal', string> = {
  condicao_pagamento: 'Condição de pagamento',
  deposito: 'Depósito',
  status: 'Status',
  canal: 'Canal do cliente',
};

/** Perfil do login do Core (`useSession`), só se for um perfil conhecido. */
export function perfilDaSessao(p: string | null | undefined): Perfil | null {
  return (PERFIS as readonly string[]).includes(p ?? '') ? (p as Perfil) : null;
}

/** P-3: a ação aparece habilitada para o perfil? (mesma tabela do domain; a API revalida.) */
export function podeExecutar(acao: AcaoIntegracao, perfil: Perfil | null): boolean {
  return perfil !== null && autorizarAcaoIntegracao(acao, perfil).ok;
}

/** RD-0967: sem nenhum de-para cadastrado, filtros e busca não aparecem (o vazio só convida a cadastrar pelo cabeçalho). */
export const mostrarFiltrosDePara = (totalCadastrado: number): boolean => totalCadastrado > 0;
