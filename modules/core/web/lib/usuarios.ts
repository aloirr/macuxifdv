/**
 * Visão da tela "Usuários" do BKO (RF-CORE-02; T-0067): funções puras sobre `GET /v1/core/usuarios`. Sem React e sem rede.
 * A validação reaproveita as regras do domínio (a API revalida tudo).
 */
import type { Perfil } from '@macuxi/platform-sdk';
import type { CriarUsuarioRequest, EditarUsuarioRequest, EquipeOpcao, UsuarioItem } from '../../contracts';
import { validarDadosDeUsuario, validarSenhaInicial, type ErroDeCampo } from '../../domain';

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
  equipe_id: string;
  external_id: string;
  senha: string;
}

export const FORMULARIO_VAZIO: FormularioUsuario = { nome: '', nome_curto: '', email: '', perfil: 'vendedor', equipe_id: '', external_id: '', senha: '' };

export function formularioDoUsuario(u: UsuarioItem): FormularioUsuario {
  return { nome: u.nome, nome_curto: u.nome_curto ?? '', email: u.email, perfil: u.perfil, equipe_id: u.equipe_id ?? '', external_id: u.external_id ?? '', senha: '' };
}

const ouNulo = (v: string): string | null => (v.trim() === '' ? null : v.trim());

/** Erros por campo, em português; vazio = pode enviar. Na criação a senha inicial é obrigatória. */
export function errosDoFormulario(f: FormularioUsuario, modo: 'criar' | 'editar'): ErroDeCampo[] {
  const erros = validarDadosDeUsuario({ nome: f.nome, email: f.email, perfil: f.perfil, external_id: f.external_id.trim() === '' ? null : f.external_id });
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
    perfil: f.perfil,
    equipe_id: ouNulo(f.equipe_id),
    external_id: ouNulo(f.external_id),
    ativo: true,
    senha: f.senha,
  };
}

export function corpoDeEdicao(f: FormularioUsuario): EditarUsuarioRequest {
  return { nome: f.nome.trim(), nome_curto: ouNulo(f.nome_curto), email: f.email.trim(), perfil: f.perfil, equipe_id: ouNulo(f.equipe_id), external_id: ouNulo(f.external_id) };
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
