// Dados fictícios (Distribuidora Norte): só para os prints.
const id = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const F = { belem: id(901), boaVista: id(902), macapa: id(903), manaus: id(904), portoVelho: id(905), rioBranco: id(906), santarem: id(907) };
const filial = (fid: string, nome: string) => ({ id: fid, codigo: nome.slice(0, 3).toUpperCase(), nome, cidade: nome, uf: 'AM', padrao: false, ativo: true, external_id: null, clientes_ativos: 10, incompleta: false });
const FILIAIS = [filial(F.santarem, 'Santarém'), filial(F.belem, 'Belém'), filial(F.boaVista, 'Boa Vista'), filial(F.macapa, 'Macapá'), filial(F.manaus, 'Manaus'), filial(F.portoVelho, 'Porto Velho'), filial(F.rioBranco, 'Rio Branco')];
const PERFIL = {
  vendedor: { codigo: 'vendedor', nome: 'Vendedor', base: 'vendedor', fabrica: true, onde_entra: [], cargo: 'vendedor' },
  promotor: { codigo: 'promotor', nome: 'Promotor', base: 'promotor', fabrica: true, onde_entra: [], cargo: 'promotor' },
  supervisor: { codigo: 'supervisor', nome: 'Supervisor', base: 'supervisor', fabrica: true, onde_entra: [], cargo: 'supervisor' },
} as const;
type P = keyof typeof PERFIL;
const usuario = (n: number, nome: string, perfil: P, cad: string | null, venda: string[], extra: Record<string, unknown> = {}) => ({
  id: id(n), nome, nome_curto: null, email: `${nome.split(' ')[0]!.toLowerCase()}@distnorte.com.br`, perfil, perfis: [{ codigo: perfil, nome: PERFIL[perfil].nome, base: perfil }], equipe_id: null, equipe_nome: null,
  superior_id: null, superior_nome: null, ativo: true, external_id: null, ultimo_login_em: null, trocar_senha: false, senha_expira_em: null, sem_senha: false,
  desconto_limita_item: true, desconto_limita_pedido: false, desconto_maximo_pedido_permil: null, cargo: perfil, supervisor_id: id(4), gerente_id: null,
  filial_cadastro_id: cad, filial_venda_ids: venda, sem_filial: cad === null, ...extra,
});
const USUARIOS = [
  usuario(1, 'Carla Souza', 'vendedor', F.boaVista, [F.boaVista, F.manaus, F.portoVelho]),
  usuario(2, 'Diego Matos', 'vendedor', null, []),
  usuario(3, 'João Lima', 'vendedor', F.manaus, [F.manaus]),
  usuario(4, 'Marta Reis', 'supervisor', F.boaVista, [F.boaVista]),
  usuario(5, 'Paulo Brito', 'promotor', null, []),
  usuario(6, 'Rita Alves', 'vendedor', F.macapa, [F.macapa, F.belem]),
];
const MODULOS = ['core', 'catalogo', 'vendedor', 'promotor', 'pesquisa'];
const LICENCAS = {
  modulos: MODULOS, dependencias: {}, tenant: Object.fromEntries(MODULOS.map((m) => [m, true])),
  perfis: { vendedor: MODULOS.filter((m) => m !== 'promotor'), promotor: ['core', 'promotor', 'pesquisa'], supervisor: MODULOS, admin: MODULOS },
  usuarios: USUARIOS.map((u) => ({ id: u.id, nome: u.nome, email: u.email, perfil: u.perfil, removidos: [] })),
};
export function responder(caminho: string): unknown {
  const [rota, qs = ''] = caminho.split('?');
  const q = new URLSearchParams(qs);
  if (rota === '/core/filiais') return { itens: FILIAIS };
  if (rota === '/core/perfis/opcoes') return { itens: Object.values(PERFIL) };
  if (rota === '/core/licencas') return LICENCAS;
  if (rota === '/core/usuarios') {
    const ativos = q.get('ativo');
    return { itens: USUARIOS.filter((u) => ativos === null || String(u.ativo) === ativos) };
  }
  throw new Error(`rota sem dublê: ${caminho}`);
}
