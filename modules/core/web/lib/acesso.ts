/**
 * Telas "Usuários" e "Perfis de acesso" do BKO (pedido do dono do produto, R-20261114-144500/150500): funções puras da
 * lista de módulos, dos rótulos de permissão, da contagem de usuários por perfil e da conferência perfil × módulos.
 * Sem React e sem rede; a regra da licença (RN-CORE-01/03) continua no domain e a API revalida.
 */
import type { ModuloId } from '@macuxi/platform-sdk';
import { modulosContrataveis, type IdDoModulo } from '@macuxi/ui/web';
import type { UsuarioItem } from '../../contracts';
import { rotuloDaChave } from './perfis';

export interface ModuloExibivel {
  id: IdDoModulo;
  nome: string;
}

/**
 * Módulos que aparecem para escolher: os contratáveis do kit (`modulosContrataveis`, bko-revisao.md §P10: sem os nativos Core,
 * Catálogo e Integração), em ordem alfabética, sem repetir. Nome e ícone vêm de `modulos.tsx`, o mapa único.
 */
export function modulosExibiveis(ids: Iterable<string>): ModuloExibivel[] {
  return modulosContrataveis([...new Set(ids)]).map(({ id, nome }) => ({ id, nome }));
}

// ---------------------------------------------------------------- rótulos das permissões

/** Rótulo simples de cada ação (chave do manifesto). Cada chave tem rótulo próprio: uma linha, uma permissão. */
export const ROTULO_DA_PERMISSAO: Readonly<Record<string, string>> = {
  // Geral (Core e plataforma)
  'dados.escopo': 'Quais clientes e números vê',
  'acesso.campo': 'Entrar no app Campo',
  'acesso.gestao': 'Entrar no app Gestão',
  'acesso.bko': 'Entrar no backoffice',
  'acesso.portal': 'Entrar no portal de implantação',
  'usuario.ver': 'Ver usuários',
  'usuario.criar': 'Criar usuários',
  'usuario.editar': 'Editar usuários',
  'usuario.desativar': 'Desativar usuários',
  'usuario.desbloquear': 'Desbloquear usuários',
  'usuario.filial_editar': 'Informar a filial dos usuários',
  'perfil.gerir': 'Gerenciar perfis de acesso',
  'modulo.gerir_licencas': 'Ligar e desligar módulos',
  'meta.ver': 'Ver metas',
  'meta.editar': 'Editar metas',
  'meta.fechar_periodo': 'Fechar e reabrir o mês',
  'rv.ver': 'Ver RV',
  'plano_rv.ver': 'Ver plano de RV',
  'plano_rv.editar': 'Editar plano de RV',
  'rota.editar': 'Montar rotas',
  'carteira.editar': 'Transferir clientes de carteira',
  'farol.ver': 'Ver farol de clientes',
  'documento.ver': 'Ver documentos do cliente',
  'documento.permissoes': 'Definir quem vê cada documento',
  'inicio.ver': 'Ver Início do app',
  'inicio_bko.ver': 'Ver o Início do BKO',
  'notificacao.enviar': 'Enviar recados',
  'notificacao.recado_do_dia': 'Marcar o recado do dia',
  'tarefa.criar': 'Criar tarefas',
  'tarefa.editar': 'Editar tarefas',
  'tarefa.cancelar': 'Cancelar tarefas',
  'tarefa.acompanhar': 'Acompanhar tarefas',
  'dispositivo.bloquear': 'Bloquear aparelhos',
  'motivo.editar': 'Cadastrar motivos de não venda',
  'produto.editar_preco': 'Editar preço e custo de produtos',
  'filial.editar': 'Cadastrar filiais',
  'cliente.pagamento_editar': 'Editar pagamento do cliente',
  'cliente.aprovar_coordenada': 'Aprovar localização do cliente',
  'visita.dispensar_etapa': 'Dispensar etapa de visita',
  'dispositivo.registrar_push': 'Receber avisos no aparelho',
  'notificacao.ler': 'Ler recados',
  'frase_dia.editar': 'Cadastrar frases do dia',
  'meta_produtividade.editar': 'Editar metas de produtividade',
  'parametro.promotor_ve_pedidos': 'Promotor vê pedidos',
  'parametro.farol': 'Ajustar o farol',
  'parametro.inicio': 'Ajustar o Início',
  'parametro.curva_abc': 'Ajustar curvas ABC',
  'parametro.checkout_pendencia': 'Ajustar prazo do checkout',
  'parametro.campos_obrigatorios': 'Ver campos obrigatórios do cliente',
  'parametro.campos_obrigatorios_editar': 'Ajustar campos obrigatórios do cliente',
  'cliente.pre_cadastro_recusados': 'Ver pré-cadastros recusados',
  'cliente.pre_cadastro_corrigir': 'Corrigir pré-cadastros recusados',
  'produto.parametros': 'Definir desconto máximo padrão',
  'usuario_avatar.trocar': 'Trocar a própria foto',
  'usuario_avatar.trocar_outro': 'Trocar a foto de outro usuário',
  'tarefa.concluir': 'Concluir tarefas',
  'cliente_foto.ver': 'Ver fotos do PDV',
  'cliente_foto.enviar': 'Enviar fotos do PDV',
  'foto_tipo.editar': 'Cadastrar tipos de foto',
  'filial.ver': 'Ver filiais',
  'cliente.filial_editar': 'Trocar filial do cliente',
  'medida.gerenciar': 'Cadastrar medidas',
  'trajeto.ver_equipe': 'Ver o trajeto da equipe',
  'rastreamento.configurar': 'Configurar o rastreamento',
  'ausencia.cadastrar': 'Cadastrar ausências',
  // Vendedor
  'pedido.ver': 'Ver pedidos',
  'pedido.criar': 'Criar pedidos',
  'pedido.editar': 'Editar pedidos',
  'pedido.criar_em_nome': 'Criar pedidos em nome do vendedor',
  'pedido.cancelar': 'Cancelar pedidos',
  'pedido.excluir': 'Excluir pedidos',
  'pedido.aprovar': 'Aprovar pedidos',
  'transportadora.ver': 'Ver transportadoras',
  'transportadora.gerenciar': 'Cadastrar transportadoras',
  'forma_pagamento.ver': 'Ver formas de pagamento',
  // Gestor
  'painel_equipe.ver': 'Ver painel da equipe',
  'ranking_equipe.ver': 'Ver ranking da equipe',
  'fila_aprovacao.ver': 'Ver fila de aprovações',
  'fila_aprovacao.decidir': 'Decidir aprovações',
  'alerta_equipe.ver': 'Ver alertas da equipe',
  'alerta_equipe.dispensar': 'Dispensar alertas',
  'painel_tenant.ver': 'Ver painéis da empresa',
  'alerta_regra.gerenciar': 'Ajustar regras de alerta',
  // Promotor
  'coleta.registrar': 'Registrar coletas',
  'checklist_loja.responder': 'Responder checklist da loja',
  'gondola.registrar': 'Registrar gôndola',
  'share.registrar': 'Registrar share',
  'preco.registrar': 'Registrar preços',
  'ruptura.registrar': 'Registrar ruptura',
  'validade.registrar': 'Registrar validade',
  'ponto_extra.registrar': 'Registrar pontos extras',
  'concorrencia.registrar': 'Registrar concorrência',
  'tarefa_trade.concluir': 'Concluir tarefas de campanha',
  'mix_obrigatorio.gerenciar': 'Cadastrar mix obrigatório',
  'meta_share.gerenciar': 'Cadastrar metas de share',
  'categoria_gondola.gerenciar': 'Cadastrar categorias de gôndola',
  'concorrente.gerenciar': 'Cadastrar concorrentes',
  'foto_referencia.gerenciar': 'Cadastrar fotos de referência',
  'checklist_modelo.gerenciar': 'Cadastrar checklists',
  'ponto_extra_negociado.gerenciar': 'Cadastrar pontos extras negociados',
  'tarefa_trade.gerenciar': 'Criar tarefas de campanha',
  // Pesquisa
  'pesquisa.responder': 'Responder pesquisas',
  'questionario.criar': 'Criar pesquisas',
  'questionario.editar': 'Editar pesquisas',
  'questionario.publicar': 'Publicar pesquisas',
  'questionario.arquivar': 'Arquivar pesquisas',
  'resultado.ver': 'Ver resultados das pesquisas',
  'resultado.exportar': 'Exportar resultados das pesquisas',
  // Treinamento
  'trilha.baixar_offline': 'Baixar trilhas para estudar offline',
  'licao.concluir': 'Concluir lições',
  'quiz.responder': 'Responder quizzes',
  'ranking.ver': 'Ver ranking das trilhas',
  'adesao.ver': 'Ver adesão aos treinamentos',
  'notas.ver': 'Ver notas dos treinamentos',
  'trilha.criar': 'Criar trilhas',
  'trilha.editar': 'Editar trilhas',
  'trilha.publicar': 'Publicar trilhas',
  'quiz.gerenciar': 'Cadastrar quizzes',
  'desafio.gerenciar': 'Cadastrar desafios',
  'medalha.gerenciar': 'Cadastrar medalhas',
  // Integração, preços e visita
  'conector.gerenciar': 'Cadastrar o Conector e a chave de acesso',
  'inativacao.decidir': 'Confirmar inativação em massa',
  'lote.reprocessar': 'Reprocessar lote',
  'mapeamento.editar': 'Editar o de-para de códigos',
  'tabela_preco.gerenciar': 'Cadastrar tabelas de preço',
  'visita.checkin_fora_de_rota': 'Check-in fora de rota',
  'visita.registrar_gestao': 'Registrar visita no app Gestão',
};

/** Rótulo de uma chave: o do mapa; senão a descrição do manifesto cortada no primeiro " (" ou ";" (a mesma regra da tela antiga). */
export function rotuloDaPermissao(chave: string, descricao = ''): string {
  return ROTULO_DA_PERMISSAO[chave] ?? rotuloDaChave(chave, descricao || chave);
}

// ---------------------------------------------------------------- usuários × perfis × módulos

/** Quantos usuários cada perfil tem, contados da MESMA lista da tela Usuários (um usuário conta uma vez em cada perfil dele). */
export function contagemPorPerfil(usuarios: readonly Pick<UsuarioItem, 'perfil' | 'perfis'>[]): Record<string, number> {
  const saida: Record<string, number> = {};
  for (const u of usuarios) {
    const codigos = new Set(u.perfis.length > 0 ? u.perfis.map((p) => p.codigo) : [u.perfil]);
    for (const c of codigos) saida[c] = (saida[c] ?? 0) + 1;
  }
  return saida;
}

/** Módulos do usuário que o perfil dele NÃO tem (a contradição que a tela nunca deixa gravar). Vazio = coerente. */
export function modulosForaDoPerfil(modulosDoPerfil: Iterable<string>, modulosDoUsuario: Iterable<string>): string[] {
  const doPerfil = new Set(modulosDoPerfil);
  return [...modulosDoUsuario].filter((m) => !doPerfil.has(m));
}

/** Módulos do usuário já limpos: só os exibíveis e só os que o perfil tem. */
export function modulosCoerentes(modulosDoPerfil: Iterable<string>, modulosDoUsuario: Iterable<string>): ModuloExibivel[] {
  const doPerfil = new Set(modulosDoPerfil);
  return modulosExibiveis([...modulosDoUsuario].filter((m) => doPerfil.has(m)));
}

/** Exceções a gravar (só remove, RN-CORE-01): os módulos do perfil que o admin desmarcou. */
export function removidosDoFormulario(modulosDoPerfil: Iterable<string>, marcados: ReadonlySet<string>): ModuloId[] {
  return modulosExibiveis(modulosDoPerfil)
    .map((m) => m.id)
    .filter((m) => !marcados.has(m));
}

/** PUTs por módulo a mandar ao salvar o usuário: só a diferença entre as exceções de antes e as do formulário (RN-CORE-01). `ativo: false` = remover. */
export function mudancasDeExcecoes(antes: readonly string[], depois: readonly string[]): Array<{ modulo: string; ativo: boolean }> {
  const mudancas: Array<{ modulo: string; ativo: boolean }> = [];
  for (const modulo of new Set<string>([...antes, ...depois])) {
    const removerAgora = depois.includes(modulo);
    if (removerAgora !== antes.includes(modulo)) mudancas.push({ modulo, ativo: !removerAgora });
  }
  return mudancas;
}
