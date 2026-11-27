/**
 * Rótulos e textos da página "Perfis de acesso" (ADR 0073): nome curto da permissão, do nível e do módulo, e as frases de uma recusa 422.
 * A REGRA (cadeado, teto, licença) vem da API e do domain; aqui só há texto.
 */
import { ALVO_TODOS_PERFIS } from '@macuxi/ui/web';

export { ALVO_TODOS_PERFIS };

/** Rótulos curtos das chaves que ficam em "Outras permissões" (spec §5.13). */
const ROTULO_DA_CHAVE: Readonly<Record<string, string>> = {
  'cliente.pagamento_editar': 'Editar prazo e formas de pagamento do cliente',
  'cliente.aprovar_coordenada': 'Aprovar a localização do cliente',
  'pedido.criar_em_nome': 'Criar pedido em nome do vendedor',
  'transportadora.ver': 'Ver transportadoras',
  'transportadora.gerenciar': 'Cadastrar transportadoras',
  'forma_pagamento.ver': 'Ver formas de pagamento',
  'tabela_preco.gerenciar': 'Cadastrar tabelas de preço',
  'ranking.ver': 'Ver o ranking dos treinamentos',
  'lote.reprocessar': 'Reprocessar lote',
  'mapeamento.editar': 'Editar o de-para de códigos',
  'conector.gerenciar': 'Cadastrar o Conector e a chave de acesso',
  'inativacao.decidir': 'Confirmar inativação em massa',
  'painel_equipe.ver': 'Ver o painel da equipe',
  'ranking_equipe.ver': 'Ver o ranking da equipe',
  'fila_aprovacao.ver': 'Ver a fila de aprovações',
  'fila_aprovacao.decidir': 'Aprovar ou rejeitar na fila',
  'alerta_equipe.ver': 'Ver os alertas da equipe',
  'alerta_equipe.dispensar': 'Dispensar alerta',
  'painel_tenant.ver': 'Ver os painéis da empresa (só leitura)',
  'alerta_regra.gerenciar': 'Ajustar as regras de alerta',
  'rota.editar': 'Montar a rota da semana',
  'modulo.gerir_licencas': 'Ligar e desligar módulos (Módulos)',
  'dispositivo.bloquear': 'Bloquear aparelho',
  'motivo.editar': 'Cadastrar motivos de não venda',
  'produto.editar_preco': 'Ver custo e editar preço do produto',
  'produto.parametros': 'Definir o desconto máximo padrão',
  'medida.gerenciar': 'Cadastrar medidas e embalagens',
  'filial.ver': 'Ver as filiais',
  'cliente_foto.ver': 'Ver as fotos do PDV do cliente',
  'foto_tipo.editar': 'Cadastrar os tipos de foto do PDV',
  'filial.editar': 'Cadastrar filiais',
  'cliente.filial_editar': 'Trocar a filial do cliente',
  'notificacao.enviar': 'Enviar recado à equipe',
  'notificacao.recado_do_dia': 'Marcar o recado do dia',
  'inicio.ver': 'Ver o Início do app',
  'inicio_bko.ver': 'Ver o Início do BKO',
  'farol.ver': 'Ver o farol de clientes',
  'parametro.farol': 'Ajustar o farol',
  'parametro.inicio': 'Ajustar o Início',
  'parametro.curva_abc': 'Ajustar as curvas ABC',
  'visita.checkin_fora_de_rota': 'Check-in fora de rota',
  'visita.registrar_gestao': 'Registrar visita no app Gestão',
  'visita.dispensar_etapa': 'Dispensar etapa pendente da visita',
  'parametro.checkout_pendencia': 'Ajustar o prazo do alerta de checkout',
  'parametro.campos_obrigatorios': 'Ver campos obrigatórios do cliente',
  'parametro.campos_obrigatorios_editar': 'Ajustar campos obrigatórios do cliente',
  'cliente.pre_cadastro_recusados': 'Ver pré-cadastros recusados',
  'cliente.pre_cadastro_corrigir': 'Corrigir pré-cadastros recusados',
};

/** Rótulo da chave: o da spec; senão a descrição do manifesto até o primeiro " (" ou ";". */
export function rotuloDaChave(chave: string, descricao: string): string {
  const r = ROTULO_DA_CHAVE[chave];
  if (r) return r;
  const corte = descricao.search(/ \(|;/);
  return (corte > 0 ? descricao.slice(0, corte) : descricao).trim() || chave;
}

const NIVEIS_ESCOPO_ROTULO: Readonly<Record<string, string>> = {
  proprio: 'Só o que é dele',
  carteira: 'Carteira própria',
  equipe: 'Equipe',
  equipes_abaixo: 'Equipes abaixo',
  tenant: 'Toda a empresa',
};
const NIVEIS_ALCADA_ROTULO: Readonly<Record<string, string>> = { ate_alcada: 'Até a alçada', acima_alcada: 'Acima da alçada' };
export const rotuloDoNivel = (nivel: string): string => NIVEIS_ESCOPO_ROTULO[nivel] ?? NIVEIS_ALCADA_ROTULO[nivel] ?? nivel;

/** Frases do resumo para uma recusa 422 (no máximo 3 e "e mais N"; nunca JSON, §7.2). */
export function frasesDaRecusa(detalhes: unknown, mensagem: string): string[] {
  const v = (detalhes as { violacoes?: { mensagem?: string }[] } | null)?.violacoes;
  const frases = [...new Set((v ?? []).map((x) => x.mensagem).filter((m): m is string => !!m))];
  if (frases.length === 0) return [mensagem];
  return frases.length <= 3 ? frases : [...frases.slice(0, 3), `e mais ${frases.length - 3}`];
}

const NOME_DO_MODULO: Readonly<Record<string, string>> = {
  core: 'Core',
  catalogo: 'Catálogo',
  vendedor: 'Vendedor',
  promotor: 'Promotor',
  gestor: 'Gestor',
  pesquisa: 'Pesquisa',
  treinamento: 'Treinamento',
  integracao: 'Integração com o ERP',
};
/** Nome do módulo para a tela (nunca o código). */
export const rotuloDoModulo = (m: string): string => NOME_DO_MODULO[m] ?? m;
