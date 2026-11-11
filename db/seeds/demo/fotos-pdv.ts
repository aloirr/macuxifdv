/**
 * Base de DEMONSTRAÇÃO — fotos do PDV (migração 0057, T-0147; RN-CORE-38, ADR 0041; desenho docs/desenho/T-0147.md §3).
 * Dono: banco-dados. Arquivo próprio: o demo.ts chama `gravarDemoFotosPdv(admin, { tenantId, hoje, dados })` na MESMA
 * transação do carregarDemo, depois do laço (clientes e usuários já gravados).
 *
 * - Tipos: "Fachada" (a que o gatilho tenant_semear_foto_tipo cria: fachada, obrigatória, ordem 0), "CNH do sócio"
 *   (sensível, obrigatória, ordem 1) e "Contrato social" (sensível, ordem 2).
 * - Fachada em 5 clientes (CLIENTES_COM_FACHADA_DEMO, índices do demo.ts): Supermercado Bom Preço (0), Mercadinho São Jorge
 *   (1), Padaria Trigo Fino (7, filial Boa Vista) e Mini Box Japiim (13), da carteira do Lucas e na rota de hoje dele, e
 *   Supermercado Novo Horizonte (19, Camila). Os demais ficam sem fachada ("Ver foto do PDV" desligado) e sem documentos
 *   (resumo "falta"). Enviadas pelo vendedor da carteira, pela câmera, ontem às 10h (Manaus).
 * - Arquivos (plataforma.arquivo, finalidade 'pdv', entidade 'cliente_foto'): metadados com situacao 'aguardando' e sem
 *   chave — o seed só grava banco, os bytes não existem no armazenamento da demo. PENDÊNCIA (fora do banco): para a foto
 *   abrir na demo, subir um JPEG por arquivo pela rota PUT /v1/arquivos/:id (ou pelo workflow da demo), que completa a linha.
 *
 * Idempotente (upsert por id determinístico). Tipo cadastrado no ensaio com o MESMO nome (sem diferenciar maiúsculas) e outro
 * id = o seed pula o dele (foto_tipo_nome_uk). Banco sem a 0057 = nada a fazer. Só tenant demo (exigirBancoDemo).
 * CICLO DE IMPORT: o demo.ts importa este arquivo; daqui só o TIPO do demo.ts é importado.
 */
import type { ClientBase } from 'pg';
import { exigirBancoDemo, hostDoCliente } from '../../src/config';
import { somarDias } from '../../src/datas';
import { gravarLinhas, type Linha } from '../../src/gravar';
import { idDeterministico, idFotoTipoFachada } from '../../src/ids';
import type { ChaveUsuario, DadosDemo } from './demo';

const id = (chave: string) => idDeterministico(`demo:${chave}`);
const comuns = { deleted_at: null, external_id: null } as const;

/** Tipos de foto além da "Fachada" semeada: [chave, nome, obrigatório, sensível, ordem]. */
export const TIPOS_FOTO_DEMO: ReadonlyArray<readonly [string, string, boolean, boolean, number]> = [
  ['cnh', 'CNH do sócio', true, true, 1],
  ['contrato', 'Contrato social', false, true, 2],
];
/** Clientes (índices do demo.ts) com a fachada enviada, e quem enviou (o vendedor da carteira). */
export const CLIENTES_COM_FACHADA_DEMO: ReadonlyArray<readonly [number, ChaveUsuario]> = [
  [0, 'vendedor'],
  [1, 'vendedor'],
  [7, 'vendedor'],
  [13, 'vendedor'],
  [19, 'vendedor2'],
];

export interface DadosDemoFotosPdv {
  tipos: Linha[];
  arquivos: Linha[];
  fotos: Linha[];
}

/** Linhas das fotos do PDV (função pura; o teste do seed confere sem banco). `usuario` = id do usuário da demo pela chave. */
export function dadosDemoFotosPdv(p: { tenantId: string; hoje: string; dados: Pick<DadosDemo, 'core.cliente'>; usuario: (k: ChaveUsuario) => string }): DadosDemoFotosPdv {
  const T = p.tenantId;
  const tipos: Linha[] = [
    { id: idFotoTipoFachada(T), tenant_id: T, nome: 'Fachada', obrigatorio: true, sensivel: false, fachada: true, ordem: 0, ativo: true, ...comuns },
    ...TIPOS_FOTO_DEMO.map(([chave, nome, obrigatorio, sensivel, ordem]) => ({
      id: id(`foto_tipo:${chave}`), tenant_id: T, nome, obrigatorio, sensivel, fachada: false, ordem, ativo: true, ...comuns,
    })),
  ];
  // ontem 10:00 em Manaus (UTC−4) = 14:00Z
  const tirada = `${somarDias(p.hoje, -1)}T14:00:00Z`;
  const arquivos: Linha[] = [];
  const fotos: Linha[] = [];
  for (const [n, quem] of CLIENTES_COM_FACHADA_DEMO) {
    const cliente = p.dados['core.cliente'][n];
    if (!cliente) throw new Error(`[db] seed demo: cliente ${n} fora da base`);
    const fotoId = id(`cliente_foto:${n}:fachada`);
    const arquivoId = id(`arquivo:pdv:${n}:fachada`);
    arquivos.push({
      id: arquivoId, tenant_id: T, modulo: 'core', finalidade: 'pdv', entidade: 'cliente_foto', entidade_id: fotoId, cliente_id: cliente.id,
      enviado_por: p.usuario(quem), tipo: 'image/jpeg', situacao: 'aguardando', perfis_leitura: null, ...comuns,
    });
    fotos.push({
      id: fotoId, tenant_id: T, cliente_id: cliente.id, foto_tipo_id: idFotoTipoFachada(T), arquivo_id: arquivoId, origem: 'camera',
      enviado_por: p.usuario(quem), tirada_em: tirada, ...comuns,
    });
  }
  return { tipos, arquivos, fotos };
}

/** Grava tipos, arquivos e fotos do PDV da demo (dentro da transação do carregarDemo). Devolve quantas linhas gravou (0 = sem a 0057). */
export async function gravarDemoFotosPdv(
  admin: ClientBase,
  p: { tenantId: string; hoje: string; dados: Pick<DadosDemo, 'core.cliente'>; usuario: (k: ChaveUsuario) => string },
): Promise<number> {
  exigirBancoDemo(hostDoCliente(admin), 'Seed das fotos do PDV da demo');
  const existe = await admin.query<{ ok: boolean }>("select to_regclass('core.cliente_foto') is not null as ok");
  if (!existe.rows[0]?.ok) return 0;
  const T = p.tenantId;
  const d = dadosDemoFotosPdv(p);
  // nome já usado por outro tipo vivo (cadastrado no ensaio): o seed pula o dele
  const ocupados = new Set(
    (
      await admin.query<{ nome: string }>('select lower(nome) as nome from core.foto_tipo where tenant_id = $1 and deleted_at is null and id <> all($2::uuid[])', [
        T,
        d.tipos.map((t) => t.id),
      ])
    ).rows.map((r) => r.nome),
  );
  const tipos = d.tipos.filter((t) => !ocupados.has(String(t.nome).toLowerCase()));
  // foto viva do ensaio no mesmo (cliente, tipo) com outro id: fica a do ensaio (cliente_foto_vigente_uk)
  const doEnsaio = new Set(
    (
      await admin.query<{ chave: string }>(
        `select cliente_id || '|' || foto_tipo_id as chave from core.cliente_foto where tenant_id = $1 and deleted_at is null and id <> all($2::uuid[])`,
        [T, d.fotos.map((f) => f.id)],
      )
    ).rows.map((r) => r.chave),
  );
  const fotos = d.fotos.filter((f) => !doEnsaio.has(`${String(f.cliente_id)}|${String(f.foto_tipo_id)}`));
  const arquivosDasFotos = new Set(fotos.map((f) => String(f.arquivo_id)));
  let n = 0;
  n += await gravarLinhas(admin, 'core.foto_tipo', tipos);
  // situacao preservada: arquivo que já recebeu os bytes (PUT /v1/arquivos/:id) não volta a 'aguardando' na recarga
  n += await gravarLinhas(admin, 'plataforma.arquivo', d.arquivos.filter((a) => arquivosDasFotos.has(String(a.id))), { preservar: ['situacao'] });
  n += await gravarLinhas(admin, 'core.cliente_foto', fotos);
  return n;
}
