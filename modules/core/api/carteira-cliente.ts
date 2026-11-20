/**
 * `GET /v1/core/clientes/:id/carteira` (T-0186 v2, RN-CORE-04, T-0168): quem atende o cliente, só para o app Gestão. Nome e telefone
 * não vão ao aparelho pelo sync. Revalida perfil (só gestão), escopo de carteira e licença do Core (plataforma). Sem dado pessoal em log.
 */
import { ErroHttpModulo, type ClienteBanco, type RotaModulo } from '@macuxi/platform-sdk';
import { z } from 'zod';
import { CarteiraClienteRespostaSchema, ROTAS_CLIENTE360_V2, type CarteiraClienteResposta } from '../contracts';
import { dataLocal, montarCarteiraDoCliente, PERFIS_VEEM_CARTEIRA_DO_CLIENTE, perfilVeCarteiraDoCliente, type VinculoDaCarteira } from '../domain';
import { exigirCarteira } from './cliente360-v2';

const ClienteParam = z.object({ id: z.string().uuid() });

export interface RepositorioCarteiraCliente {
  vinculos(clienteId: string, hoje: string): Promise<VinculoDaCarteira[]>;
}

export const repositorioCarteiraClienteSql = (db: ClienteBanco): RepositorioCarteiraCliente => ({
  async vinculos(clienteId, hoje) {
    const r = await db.query<VinculoDaCarteira>(
      `select u.id as usuario_id, u.nome, u.telefone
         from core.carteira c join core.usuario u on u.id = c.usuario_id and u.tenant_id = c.tenant_id
        where c.cliente_id = $1 and c.deleted_at is null and u.deleted_at is null
          and (c.inicio is null or c.inicio <= $2::date) and (c.fim is null or c.fim >= $2::date)`,
      [clienteId, hoje],
    );
    return r.rows;
  },
});

export async function listarCarteiraDoCliente(repo: RepositorioCarteiraCliente, e: { perfil: string; clienteId: string; hoje: string }): Promise<CarteiraClienteResposta> {
  if (!perfilVeCarteiraDoCliente(e.perfil)) throw new ErroHttpModulo(403, 'CARTEIRA_SEM_ACESSO', 'Sem permissão para ver quem atende este cliente.');
  return CarteiraClienteRespostaSchema.parse(montarCarteiraDoCliente(await repo.vinculos(e.clienteId, e.hoje)));
}

export const rotasDeCarteiraDoCliente: RotaModulo[] = [
  {
    metodo: 'GET',
    caminho: ROTAS_CLIENTE360_V2.carteira,
    perfis: PERFIS_VEEM_CARTEIRA_DO_CLIENTE,
    carteira: 'filtrar_no_dominio',
    semCache: true,
    params: ClienteParam,
    executar: async (ctx) => {
      const { id } = ctx.params as z.infer<typeof ClienteParam>;
      await exigirCarteira(ctx, id);
      return ctx.comTenant((db) => listarCarteiraDoCliente(repositorioCarteiraClienteSql(db), { perfil: ctx.usuario.perfil, clienteId: id, hoje: dataLocal(ctx.agora(), ctx.fuso()) }));
    },
  },
];
