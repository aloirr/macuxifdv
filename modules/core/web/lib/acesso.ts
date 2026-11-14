/**
 * Telas "Usuários" e "Perfis de acesso" do BKO (pedido do dono do produto, R-20261114-144500/150500): funções puras da
 * lista de módulos, dos rótulos de permissão, da contagem de usuários por perfil e da conferência perfil × módulos.
 * Sem React e sem rede; a regra da licença (RN-CORE-01/03) continua no domain e a API revalida.
 */
import type { ModuloId, Perfil } from '@macuxi/platform-sdk';
import { travaDaChave } from '@macuxi/platform-sdk';
import type { UsuarioItem } from '../../contracts';
import type { Edicao } from './perfis';
import { rotuloDaChave } from './perfis';

/** Módulos que o admin nunca escolhe por usuário: o Core é a base, o Catálogo e a Integração são da plataforma. */
export const MODULOS_OCULTOS: readonly ModuloId[] = ['core', 'catalogo', 'integracao'];

/** Nome de cada módulo na tela, sempre com a primeira letra maiúscula. Fonte única do mapa id → nome (o ícone fica em `icones-modulo.tsx`). */
export const NOME_DO_MODULO_ACESSO: Readonly<Record<string, string>> = {
  core: 'Geral',
  catalogo: 'Catálogo',
  gestor: 'Gestor',
  integracao: 'Integração',
  pesquisa: 'Pesquisa',
  promotor: 'Promotor',
  treinamento: 'Treinamento',
  vendedor: 'Vendedor',
};

const primeiraMaiuscula = (s: string): string => (s === '' ? s : s[0]!.toUpperCase() + s.slice(1));

export const nomeDoModuloAcesso = (id: string): string => NOME_DO_MODULO_ACESSO[id] ?? primeiraMaiuscula(id);

export interface ModuloExibivel {
  id: ModuloId;
  nome: string;
}

/** Módulos que aparecem para escolher (sem Core, Catálogo e Integração), em ordem alfabética, com a primeira letra maiúscula. */
export function modulosExibiveis(ids: Iterable<string>): ModuloExibivel[] {
  const vistos = new Set<string>();
  for (const id of ids) if (!MODULOS_OCULTOS.includes(id as ModuloId)) vistos.add(id);
  return [...vistos]
    .map((id) => ({ id: id as ModuloId, nome: nomeDoModuloAcesso(id) }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** Os módulos da tabela de um novo perfil: "Geral" (Core) primeiro, depois os licenciados em ordem alfabética (o Catálogo e a Integração não entram). */
export function modulosDaGrade(licenciados: Iterable<string>): { id: ModuloId; nome: string }[] {
  return [{ id: 'core', nome: nomeDoModuloAcesso('core') }, ...modulosExibiveis(licenciados)];
}

// ---------------------------------------------------------------- rótulos das permissões

/** Rótulo simples de cada ação (chave do manifesto). Chaves com o mesmo rótulo viram uma linha só. */
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
  'perfil.gerir': 'Gerenciar perfis de acesso',
  'modulo.gerir_licencas': 'Ligar e desligar módulos',
  'meta.ver': 'Ver metas',
  'meta.editar': 'Editar metas',
  'meta.fechar_periodo': 'Fechar e reabrir o mês',
  'rv.ver': 'Ver remuneração variável',
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
  'parametro.promotor_ve_pedidos': 'Promotor ver pedidos',
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
  // Vendedor
  'pedido.ver': 'Ver pedidos',
  'pedido.criar': 'Criar pedidos',
  'pedido.editar': 'Criar pedidos',
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
