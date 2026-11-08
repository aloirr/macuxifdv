/**
 * Visão da tela "Usuários" do BKO (RF-CORE-02; T-0067): funções puras sobre `GET /v1/core/usuarios`. Sem React e sem rede.
 * A validação reaproveita as regras do domínio (a API revalida tudo).
 */
import { temPerfilDeBase, type Perfil } from '@macuxi/platform-sdk';
import type { CriarUsuarioRequest, EditarUsuarioRequest, EmailAcesso, EquipeOpcao, UsuarioItem } from '../../contracts';
import { faltasNaSenha, gerarSenhaTemporaria, validarDadosDeUsuario, validarSenhaInicial, type ErroDeCampo } from '../../domain';

const BOM = String.fromCharCode(0xfeff); // marca de ordem de bytes: o Excel abre o CSV em UTF-8
const aspas = (v: string) => `"${v.replace(/"/g, '""')}"`;

export const ROTULO_PERFIL: Record<Perfil, string> = {
  vendedor: 'Vendedor',
  promotor: 'Promotor',
  supervisor: 'Supervisor',
  gerente: 'Gerente',
  analista: 'Analista',
  assistente: 'Assistente',
  admin: 'Administrador',
};
export const PERFIS_DO_FORMULARIO: readonly Perfil[] = ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'];

export interface FormularioUsuario {
  nome: string;
  nome_curto: string;
  email: string;
  perfil: Perfil;
  /** T-0111: códigos dos perfis do usuário (um ou mais; o primeiro é o principal). */
  perfis: string[];
  equipe_id: string;
  external_id: string;
  senha: string;
}

export const FORMULARIO_VAZIO: FormularioUsuario = { nome: '', nome_curto: '', email: '', perfil: 'vendedor', perfis: [], equipe_id: '', external_id: '', senha: '' };

export function formularioDoUsuario(u: UsuarioItem): FormularioUsuario {
  return { nome: u.nome, nome_curto: u.nome_curto ?? '', email: u.email, perfil: u.perfil, perfis: u.perfis.length > 0 ? u.perfis.map((p) => p.codigo) : [u.perfil], equipe_id: u.equipe_id ?? '', external_id: u.external_id ?? '', senha: '' };
}

const ouNulo = (v: string): string | null => (v.trim() === '' ? null : v.trim());

/** Erros por campo, em português; vazio = pode enviar. Na criação a senha inicial é obrigatória. */
export function errosDoFormulario(f: FormularioUsuario, modo: 'criar' | 'editar'): ErroDeCampo[] {
  const erros = validarDadosDeUsuario({ nome: f.nome, email: f.email, perfil: f.perfil, external_id: f.external_id.trim() === '' ? null : f.external_id });
  if (f.perfis.length === 0) erros.push({ campo: 'perfil', mensagem: 'Escolha pelo menos um perfil.' });
  if (modo === 'criar') {
    const fraca = validarSenhaInicial(f.senha, f.email);
    if (fraca) erros.push({ campo: 'senha', mensagem: fraca });
  }
  return erros;
}

export function corpoDeCriacao(f: FormularioUsuario): CriarUsuarioRequest {
  return {
    nome: f.nome.trim(),
    nome_curto: ouNulo(f.nome_curto),
    email: f.email.trim(),
    perfis: f.perfis,
    equipe_id: ouNulo(f.equipe_id),
    external_id: ouNulo(f.external_id),
    ativo: true,
    senha: f.senha,
  };
}

export function corpoDeEdicao(f: FormularioUsuario): EditarUsuarioRequest {
  return { nome: f.nome.trim(), nome_curto: ouNulo(f.nome_curto), email: f.email.trim(), perfis: f.perfis, equipe_id: ouNulo(f.equipe_id), external_id: ouNulo(f.external_id) };
}

/** Superior resultante da equipe escolhida, para mostrar no formulário (o superior não é campo: deriva da equipe). */
export function textoDoSuperiorDaEquipe(equipes: readonly EquipeOpcao[], equipeId: string): string {
  if (!equipeId) return 'Sem equipe: sem superior imediato.';
  const e = equipes.find((x) => x.id === equipeId);
  if (!e) return 'Equipe não encontrada.';
  return e.superior_nome ? `Superior imediato: ${e.superior_nome} (responsável da equipe).` : 'Esta equipe não tem responsável definido: sem superior imediato.';
}

/** CSV com ponto e vírgula (Excel pt-BR). Sem senha nem hash (a API nunca os envia). */
export function csvDeUsuarios(itens: readonly UsuarioItem[]): string {
  const cab = ['Nome', 'E-mail', 'Perfil', 'Equipe', 'Superior imediato', 'Código do ERP', 'Situação'];
  const linhas = itens.map((u) =>
    [u.nome, u.email, ROTULO_PERFIL[u.perfil], u.equipe_nome ?? '', u.superior_nome ?? '', u.external_id ?? '', u.ativo ? 'Ativo' : 'Inativo'].map(aspas).join(';'),
  );
  return BOM + `${[cab.map(aspas).join(';'), ...linhas].join('\r\n')}\r\n`;
}

// ---------- T-0094: senha por e-mail, troca no 1º acesso, "Redefinir senha" / "Enviar acesso" (RN-CORE-34; docs/design/ciclo-de-senha.md §5) ----------

/** Faltas da senha digitada (campo vazio = as quatro), para o componente `RegrasDaSenha`. */
export const faltasDaSenhaDigitada = (senha: string): string[] => faltasNaSenha(senha);

/** "Gerar senha": 12 caracteres sem ambíguos, gerada no navegador com `crypto.getRandomValues` (mesma regra do servidor). */
export function gerarSenhaNoNavegador(aleatorio: (n: number) => Uint8Array = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n))): string {
  return gerarSenhaTemporaria(aleatorio);
}

export interface EtiquetaDeSenha {
  texto: string;
  tom: 'warning' | 'danger' | 'neutral';
}

function diaEHora(iso: string, fuso: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return `${p.day}/${p.month} às ${p.hour}:${p.minute}`;
}

/** Etiqueta da coluna de situação, depois de Ativo/Inativo. Nenhuma para senha definitiva. */
export function etiquetaDeSenha(u: Pick<UsuarioItem, 'sem_senha' | 'trocar_senha' | 'senha_expira_em'>, fuso: string, agora: Date = new Date()): EtiquetaDeSenha | null {
  if (u.sem_senha) return { texto: 'Sem senha', tom: 'neutral' };
  if (!u.trocar_senha) return null;
  if (!u.senha_expira_em) return { texto: 'Troca de senha pendente', tom: 'warning' };
  if (new Date(u.senha_expira_em).getTime() <= agora.getTime()) return { texto: 'Senha temporária vencida', tom: 'danger' };
  return { texto: `Troca de senha pendente · vence em ${diaEHora(u.senha_expira_em, fuso)}`, tom: 'warning' };
}

export type RotuloAcaoDeSenha = 'Redefinir senha' | 'Enviar acesso';

/** Ação de senha da linha: nunca para admin (P7: admin recupera pelo "Esqueci a senha"); "Enviar acesso" para quem não tem senha. */
export function acaoDeSenha(u: Pick<UsuarioItem, 'perfil' | 'ativo' | 'sem_senha' | 'perfis'>): { rotulo: RotuloAcaoDeSenha } | null {
  // P7: perfil de base admin nunca tem a senha redefinida por aqui (os perfis de hoje são os de fábrica: código = base)
  if (temPerfilDeBase(u.perfis.length > 0 ? u.perfis : [{ base: u.perfil }], 'admin') || !u.ativo) return null;
  return { rotulo: u.sem_senha ? 'Enviar acesso' : 'Redefinir senha' };
}

/** Corpo do `PUT usuarios/:id/senha`: "Enviar acesso" não leva senha (o servidor gera e manda por e-mail). */
export const corpoDeRedefinicao = (senha: string): { senha?: string } => (senha === '' ? {} : { senha });

export type ResultadoDoEmail =
  | { tipo: 'enviado'; texto: string }
  /** E-mail não saiu: o aviso fica no topo da lista e mostra a senha UMA vez (da memória do formulário). */
  | { tipo: 'sem_email'; antes: string; senha: string; depois: string };

/** Depois de criar: toast quando o e-mail foi na fila; aviso com a senha quando não foi. */
export function resultadoDeCriar(email: EmailAcesso, destino: string, senha: string): ResultadoDoEmail {
  if (email === 'indisponivel') return { tipo: 'sem_email', antes: 'Usuário criado, mas não conseguimos enviar o e-mail. Passe a senha à pessoa: ', senha, depois: '. Ela cria a dela no primeiro acesso.' };
  return { tipo: 'enviado', texto: `Usuário criado. O acesso vai para ${destino} em alguns minutos.` };
}

/** Depois de redefinir (com senha definida na tela). */
export function resultadoDeRedefinir(email: EmailAcesso, destino: string, senha: string): ResultadoDoEmail {
  if (email === 'indisponivel') return { tipo: 'sem_email', antes: 'Senha redefinida, mas não conseguimos enviar o e-mail. Passe a senha à pessoa: ', senha, depois: '. Ela cria a dela no próximo acesso.' };
  return { tipo: 'enviado', texto: `Senha redefinida. A senha nova vai para ${destino} em alguns minutos.` };
}

export const textoAcessoEnviado = (destino: string): string => `Acesso enviado para ${destino}.`;
export const TEXTO_ENVIAR_ACESSO_SEM_EMAIL = 'Não conseguimos enviar o e-mail. Use "Redefinir senha" para definir uma senha e passá-la à pessoa.';
export const TEXTO_SENHA_NAO_REDEFINIVEL = 'Esta senha não pode ser redefinida aqui. O administrador usa "Esqueci a senha".';
export const AJUDA_SENHA_INICIAL = 'Ela vai para o e-mail da pessoa, que cria a dela no primeiro acesso. Vale por 72 horas.';

/** Onde a pessoa entra com os perfis escolhidos: apps = qualquer perfil; BKO e portal = todos (regra mais restritiva, RN-CORE-35). */
export function ondeEntraDosPerfis(escolhidos: readonly { onde_entra: readonly ('campo' | 'gestao' | 'bko' | 'portal')[] }[]): ('campo' | 'gestao' | 'bko' | 'portal')[] {
  if (escolhidos.length === 0) return [];
  const ok = (l: 'campo' | 'gestao' | 'bko' | 'portal') => (l === 'bko' || l === 'portal' ? escolhidos.every((p) => p.onde_entra.includes(l)) : escolhidos.some((p) => p.onde_entra.includes(l)));
  return (['campo', 'gestao', 'bko', 'portal'] as const).filter(ok);
}
