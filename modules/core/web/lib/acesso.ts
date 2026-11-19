/**
 * Telas "Usuários" e "Perfis de acesso" do BKO (pedido do dono do produto, R-20261114-144500/150500): funções puras da
 * lista de módulos, dos rótulos de permissão, da contagem de usuários por perfil e da conferência perfil × módulos.
 * Sem React e sem rede; a regra da licença (RN-CORE-01/03) continua no domain e a API revalida.
 */
import type { ModuloId, Perfil } from '@macuxi/platform-sdk';
import { travaDaChave } from '@macuxi/platform-sdk';
import { modulosContrataveis, nomeDoModulo, type IdDoModulo } from '@macuxi/ui/web';
import type { UsuarioItem } from '../../contracts';
import type { Edicao } from './perfis';
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

/** Os módulos da tabela de um novo perfil: o Core primeiro, depois os licenciados em ordem alfabética (o Catálogo e a Integração não entram). */
export function modulosDaGrade(licenciados: Iterable<string>): ModuloExibivel[] {
  return [{ id: 'core', nome: nomeDoModulo('core') }, ...modulosExibiveis(licenciados)];
}

// ---------------------------------------------------------------- rótulos das permissões

/** Rótulo simples de cada ação (chave do manifesto). Cada chave tem rótulo próprio: uma linha, uma permissão. */
export const ROTULO_DA_PERMISSAO: Readonly<Record<string, string>> = {
  // Geral (Core e plataforma)
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
  'inicio.ver': 'Ver Início do app',
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
  'trajeto.ver_proprio': 'Ver o próprio trajeto',
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
  'forma_pagamento.gerenciar': 'Cadastrar formas de pagamento',
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
};

/** Rótulo de uma chave: o do mapa; senão a descrição do manifesto cortada no primeiro " (" ou ";" (a mesma regra da tela antiga). */
export function rotuloDaPermissao(chave: string, descricao = ''): string {
  return ROTULO_DA_PERMISSAO[chave] ?? rotuloDaChave(chave, descricao || chave);
}

/** Uma linha da tabela do módulo: um rótulo e as chaves que ele liga juntas. */
export interface LinhaDeAcesso {
  rotulo: string;
  chaves: string[];
}

export interface ChaveDoCatalogo {
  chave: string;
  modulo: string;
  descricao: string;
  nivel: unknown;
  alvos: boolean;
}

/** Chaves com nível ou com alvos têm controle próprio (escopo de dados, redefinir senha) e não entram na grade de caixas. */
export const entraNaGrade = (c: Pick<ChaveDoCatalogo, 'nivel' | 'alvos'>): boolean => !c.nivel && !c.alvos;

/**
 * Linhas de cada módulo da grade, na ordem do catálogo, SEM rótulo repetido: chaves com o mesmo rótulo viram uma linha só e
 * um rótulo que cairia em duas chaves de módulos diferentes fica no primeiro módulo em que aparece.
 */
export function linhasPorModulo(catalogo: readonly ChaveDoCatalogo[], modulos: readonly string[]): Record<string, LinhaDeAcesso[]> {
  const saida: Record<string, LinhaDeAcesso[]> = Object.fromEntries(modulos.map((m) => [m, []]));
  for (const c of catalogo) {
    if (!entraNaGrade(c)) continue;
    const linhas = saida[c.modulo];
    if (!linhas) continue;
    const rotulo = rotuloDaPermissao(c.chave, c.descricao);
    const existente = linhas.find((l) => l.rotulo === rotulo);
    if (existente) existente.chaves.push(c.chave);
    else linhas.push({ rotulo, chaves: [c.chave] });
  }
  return saida;
}

// ---------------------------------------------------------------- grupos da coluna Geral

/** Subtítulos da coluna Geral, nesta ordem (RD-0266). */
export const GRUPOS_DO_GERAL = ['Entrar em', 'Usuários', 'Clientes', 'Metas e RV', 'Fotos', 'Recados', 'Tarefas', 'Ajustes', 'Cadastros'] as const;
export type GrupoDoGeral = (typeof GRUPOS_DO_GERAL)[number];

const GRUPO_DA_CHAVE: Readonly<Record<string, GrupoDoGeral>> = {
  'acesso.campo': 'Entrar em',
  'acesso.gestao': 'Entrar em',
  'acesso.bko': 'Entrar em',
  'acesso.portal': 'Entrar em',
  'usuario.ver': 'Usuários',
  'usuario.criar': 'Usuários',
  'usuario.editar': 'Usuários',
  'usuario.desativar': 'Usuários',
  'usuario.desbloquear': 'Usuários',
  'usuario.filial_editar': 'Usuários',
  'perfil.gerir': 'Usuários',
  'modulo.gerir_licencas': 'Usuários',
  'usuario_avatar.trocar': 'Usuários',
  'trajeto.ver_proprio': 'Usuários',
  'trajeto.ver_equipe': 'Usuários',
  'ausencia.cadastrar': 'Usuários',
  'rastreamento.configurar': 'Ajustes',
  'usuario_avatar.trocar_outro': 'Usuários',
  'dispositivo.bloquear': 'Usuários',
  'dispositivo.registrar_push': 'Usuários',
  'inicio.ver': 'Clientes',
  'farol.ver': 'Clientes',
  'rota.editar': 'Clientes',
  'carteira.editar': 'Clientes',
  'cliente.pagamento_editar': 'Clientes',
  'cliente.aprovar_coordenada': 'Clientes',
  'cliente.filial_editar': 'Clientes',
  'visita.dispensar_etapa': 'Clientes',
  'meta.ver': 'Metas e RV',
  'meta.editar': 'Metas e RV',
  'meta.fechar_periodo': 'Metas e RV',
  'meta_produtividade.editar': 'Metas e RV',
  'rv.ver': 'Metas e RV',
  'plano_rv.ver': 'Metas e RV',
  'plano_rv.editar': 'Metas e RV',
  'cliente_foto.ver': 'Fotos',
  'cliente_foto.enviar': 'Fotos',
  'foto_tipo.editar': 'Fotos',
  'notificacao.ler': 'Recados',
  'notificacao.enviar': 'Recados',
  'notificacao.recado_do_dia': 'Recados',
  'frase_dia.editar': 'Recados',
  'tarefa.criar': 'Tarefas',
  'tarefa.editar': 'Tarefas',
  'tarefa.cancelar': 'Tarefas',
  'tarefa.acompanhar': 'Tarefas',
  'tarefa.concluir': 'Tarefas',
  'parametro.promotor_ve_pedidos': 'Ajustes',
  'parametro.farol': 'Ajustes',
  'parametro.inicio': 'Ajustes',
  'parametro.curva_abc': 'Ajustes',
  'parametro.checkout_pendencia': 'Ajustes',
  'produto.parametros': 'Ajustes',
  'motivo.editar': 'Cadastros',
  'produto.editar_preco': 'Cadastros',
  'filial.ver': 'Cadastros',
  'filial.editar': 'Cadastros',
  'medida.gerenciar': 'Cadastros',
};

/** Grupo de uma chave da coluna Geral; chave nova sem grupo cai em "Cadastros", o último. */
export const grupoDaPermissao = (chave: string): GrupoDoGeral => GRUPO_DA_CHAVE[chave] ?? 'Cadastros';

/** As linhas da coluna Geral separadas por subtítulo, na ordem de `GRUPOS_DO_GERAL`, sem grupo vazio. */
export function gruposDoGeral(linhas: readonly LinhaDeAcesso[]): { titulo: GrupoDoGeral; linhas: LinhaDeAcesso[] }[] {
  return GRUPOS_DO_GERAL.map((titulo) => ({ titulo, linhas: linhas.filter((l) => grupoDaPermissao(l.chaves[0]!) === titulo) })).filter((g) => g.linhas.length > 0);
}

export type Marcacao = 'todas' | 'nenhuma' | 'parte';

/** Estado da caixa "Marcar todos de {módulo}". */
export function marcacaoDoModulo(linhas: readonly LinhaDeAcesso[], marcadas: ReadonlySet<string>): Marcacao {
  const n = linhas.filter((l) => l.chaves.every((c) => marcadas.has(c))).length;
  if (n === 0) return 'nenhuma';
  return n === linhas.length ? 'todas' : 'parte';
}

/** Marca ou desmarca todas as chaves das linhas. */
export function alternarModulo(linhas: readonly LinhaDeAcesso[], marcadas: ReadonlySet<string>, marcar: boolean): Set<string> {
  const novo = new Set(marcadas);
  for (const l of linhas) for (const c of l.chaves) {
      if (marcar) novo.add(c);
      else novo.delete(c);
    }
  return novo;
}

export function alternarLinha(linha: LinhaDeAcesso, marcadas: ReadonlySet<string>): Set<string> {
  const ligada = linha.chaves.every((c) => marcadas.has(c));
  return alternarModulo([linha], marcadas, !ligada);
}

/** `aria-label` da caixa que marca todos. */
export const rotuloMarcarTodos = (nomeDoModulo: string): string => `Marcar todos de ${nomeDoModulo}`;

// ---------------------------------------------------------------- novo perfil

const BASES_CANDIDATAS: readonly Perfil[] = ['vendedor', 'supervisor', 'gerente', 'analista', 'admin'];

/** Perfil base do perfil novo: o primeiro, do mais enxuto ao mais amplo, cujas travas (RN-CORE-33, RN-PRO-01) aceitam todas as chaves marcadas. */
export function baseDoNovoPerfil(marcadas: Iterable<string>, trava: (base: Perfil, chave: string) => unknown = travaDaChave): Perfil {
  const chaves = [...marcadas];
  return BASES_CANDIDATAS.find((b) => chaves.every((c) => !trava(b, c))) ?? 'admin';
}

/**
 * Edição do perfil novo: parte do que a base devolveu (escopo de dados e alvos ficam como estão) e põe cada chave da grade
 * concedida ou não conforme as caixas.
 */
export function edicaoDaGrade(inicial: Edicao, grade: readonly string[], marcadas: ReadonlySet<string>): Edicao {
  const novo: Edicao = { ...inicial };
  for (const c of grade) novo[c] = { concedida: marcadas.has(c), nivel: null, alvos: null };
  return novo;
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
