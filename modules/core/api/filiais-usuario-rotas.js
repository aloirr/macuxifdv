/**
 * `GET|PUT /v1/core/eu/filial-cadastro` (T-0176, RN-CORE-39, R-20261115-094500): destravamento mínimo. Admin ou analista SEM filial de
 * cadastro (por exemplo, o primeiro admin do tenant) informa a PRÓPRIA filial e segue; os demais perfis esperam o admin. São as únicas
 * rotas do Core liberadas a quem está sem filial (`liberadaSemFilial`, guarda global da ADR 0056); as outras respondem 403 `USUARIO_SEM_FILIAL`.
 * O PUT só serve a quem está bloqueado (409 se já tem filial: a troca é do cadastro de usuários). A de cadastro entra na lista de venda
 * e as outras de venda ficam. Auditado.
 */
import { ErroHttpModulo, pode } from '@macuxi/platform-sdk';
import { ACAO_FILIAL_USUARIO_EDITAR, CODIGOS_FILIAL_USUARIO, InformarFilialCadastroRequestSchema, MENSAGEM_FILIAL_JA_INFORMADA, MinhaFilialCadastroSchema, } from '../contracts';
import { auditar } from './auditoria';
import { conferirFiliaisDoUsuario, exigirQuemEditaFilial, filiaisDoUsuario, gravarFiliaisDoUsuario } from './filiais-usuario';
export const rotasDeFilialDoProprioUsuario = [
    {
        metodo: 'GET',
        caminho: 'eu/filial-cadastro',
        liberadaSemFilial: true,
        perfis: ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'],
        carteira: 'nao_se_aplica',
        executar: (ctx) => ctx.comTenant(async (db) => {
            const f = await filiaisDoUsuario(db, ctx.usuario.id);
            const podeInformar = pode(ctx.usuario.perfis, ACAO_FILIAL_USUARIO_EDITAR);
            const filiais = podeInformar && f.sem_filial ? (await db.query('select id, codigo, nome from core.filial where deleted_at is null and ativo order by padrao desc, codigo, id')).rows : [];
            return MinhaFilialCadastroSchema.parse({ ...f, pode_informar: podeInformar, filiais });
        }),
    },
    {
        metodo: 'PUT',
        caminho: 'eu/filial-cadastro',
        liberadaSemFilial: true,
        superficie: 'bko',
        acao: ACAO_FILIAL_USUARIO_EDITAR,
        carteira: 'nao_se_aplica',
        corpo: InformarFilialCadastroRequestSchema,
        executar: (ctx) => ctx.comTenant(async (db) => {
            exigirQuemEditaFilial(ctx.usuario.perfis);
            const c = ctx.corpo;
            const antes = await filiaisDoUsuario(db, ctx.usuario.id);
            if (!antes.sem_filial)
                throw new ErroHttpModulo(409, CODIGOS_FILIAL_USUARIO.jaInformada, MENSAGEM_FILIAL_JA_INFORMADA);
            const ok = await conferirFiliaisDoUsuario(db, { cadastro: c.filial_cadastro_id, venda: antes.filial_venda_ids });
            await gravarFiliaisDoUsuario(db, ctx.usuario.id, ok.cadastro, ok.venda);
            await auditar(db, ctx, { acao: 'usuario.filial_cadastro_propria', entidade: 'usuario', entidadeId: ctx.usuario.id, antes: { filial_cadastro_id: null }, depois: { filial_cadastro_id: ok.cadastro, filial_venda_ids: ok.venda } });
            return MinhaFilialCadastroSchema.parse({ ...(await filiaisDoUsuario(db, ctx.usuario.id)), pode_informar: true, filiais: [] });
        }),
    },
];
