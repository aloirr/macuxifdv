/**
 * Consumidor do cliente do ERP (`integracao.cliente.atualizado@1`; T-0060, RN-CORE-16/17). Aplica o plano puro de
 * `domain/cliente-erp.ts` em `core.cliente` (upsert por `external_id`, idempotente) e grava `cadastro_incompleto` e
 * `cadastro_campos_faltantes`; depois publica `core.cliente.atualizado@1` com os mesmos campos (só nomes, nunca valores).
 * O schema abaixo é estrutural (subconjunto do `ClientePayload` do Hub): o Core não depende de pacote do Integracao.
 * T-0066: depois do cadastro, aplica carteira (`vendedor_external_id`), contatos e financeiro (limite, bloqueio) do mesmo
 * payload (`consumidores-erp-cliente-extras.ts`). Vendedor ainda ausente = `ReferenciaAusenteErp` (a outbox repete, RN-INT-04).
 */
import { z } from 'zod';
import { definirConsumidor, definirEvento, type ConsumidorEvento, type ContextoConsumo } from '@macuxi/platform-sdk';
import { EVENTO_CLIENTE_ATUALIZADO, PARAMETRO_CAMPOS_OBRIGATORIOS } from '../contracts';
import { camposExigidos, planejarClienteDoErp, type EventoClienteAtualizado } from '../domain';
import { aplicarCarteiraDoErp, aplicarContatosDoErp, aplicarFinanceiroDoErp } from './consumidores-erp-cliente-extras';
import { consumidorProdutoDoErp } from './consumidores-erp-produto';
import { consumidorRotaDoErp } from './consumidores-erp-rota';
import { consumidorTituloDoErp } from './consumidores-erp-titulo';
import { consumidorVendedorDoErp } from './consumidores-erp-vendedor';
import { carteiraDoEvento } from './rotas';

const Texto = z.string().nullish();
const RegistroCliente = z.object({
  external_id: z.string(),
  alterado_em: z.string(),
  ativo: z.boolean().optional(),
  razao_social: z.string(),
  nome_fantasia: Texto,
  documento: Texto,
  inscricao_estadual: Texto,
  observacao: Texto,
  telefone: Texto,
  email: Texto,
  latitude: z.number().nullish(),
  longitude: z.number().nullish(),
  vendedor_external_id: Texto,
  limite_credito_cents: z.number().nullish(),
  bloqueado: z.boolean().optional(),
  contatos: z.array(z.object({ nome: z.string(), cargo: Texto, telefone: Texto, email: Texto })).optional(),
  endereco: z
    .object({ logradouro: Texto, numero: Texto, complemento: Texto, bairro: Texto, cidade: Texto, uf: Texto, cep: Texto })
    .nullish(),
});

export const EventoIntegracaoClienteAtualizado = definirEvento(
  'integracao.cliente.atualizado@1',
  z.object({
    external_id: z.string().min(1),
    acao: z.enum(['criado', 'atualizado', 'inativado']),
    registro: RegistroCliente.optional(),
    ocorrido_em: z.string(),
  }),
);

const COLUNAS_GRAVADAS = [
  'razao_social', 'nome_fantasia', 'documento', 'inscricao_estadual', 'observacao', 'telefone', 'email',
  'logradouro', 'numero', 'bairro', 'cidade', 'uf', 'cep', 'latitude', 'longitude', 'ativo',
  'cadastro_incompleto', 'cadastro_campos_faltantes',
] as const;

export const consumidorClienteDoErp: ConsumidorEvento = definirConsumidor({
  evento: EventoIntegracaoClienteAtualizado,
  async executar(p, ctx: ContextoConsumo) {
    const exigidos = camposExigidos(ctx.parametros()[PARAMETRO_CAMPOS_OBRIGATORIOS]);
    let evento = p as EventoClienteAtualizado;
    let plano = planejarClienteDoErp(evento, exigidos);

    if (plano.tipo === 'inativar') {
      const r = await ctx.db.query<{ id: string }>('update core.cliente set ativo = false where external_id = $1 and deleted_at is null and ativo returning id', [plano.external_id]);
      if (r.rows[0]) await ctx.publicar(EVENTO_CLIENTE_ATUALIZADO, { cliente_id: r.rows[0].id, campos: ['ativo'], origem: 'erp', ...(await carteiraDoEvento(ctx.db, r.rows[0].id)) }, r.rows[0].id);
      return;
    }
    if (plano.tipo === 'ignorar') return;

    // Documento já usado por outro cliente do tenant (índice único): entra sem documento e cai no cadastro incompleto.
    if (plano.linha.documento !== null) {
      const dono = await ctx.db.query('select 1 from core.cliente where documento = $1 and deleted_at is null and external_id is distinct from $2', [plano.linha.documento, plano.linha.external_id]);
      if (dono.rows.length > 0 && evento.registro) {
        evento = { ...evento, registro: { ...evento.registro, documento: null } };
        plano = planejarClienteDoErp(evento, exigidos);
        if (plano.tipo !== 'upsert') return;
      }
    }

    const l = plano.linha;
    const valores = [l.external_id, ...COLUNAS_GRAVADAS.map((c) => l[c])];
    const colunas = COLUNAS_GRAVADAS.join(', ');
    const marcas = COLUNAS_GRAVADAS.map((_, i) => `$${i + 2}`).join(', ');
    const atualizar = COLUNAS_GRAVADAS.map((c) => `${c} = excluded.${c}`).join(', ');
    const r = await ctx.db.query<{ id: string }>(
      `insert into core.cliente (tenant_id, external_id, ${colunas}) values (plataforma.tenant_atual(), $1, ${marcas})
         on conflict (tenant_id, external_id) where external_id is not null and deleted_at is null do update set ${atualizar}
       returning id`,
      valores,
    );
    const id = r.rows[0]?.id;
    if (!id) return;
    const bruto = (p as { registro?: z.infer<typeof RegistroCliente> }).registro;
    if (bruto) {
      await aplicarCarteiraDoErp(ctx.db, id, l.external_id, bruto.vendedor_external_id?.trim() || null, ctx.agora());
      await aplicarContatosDoErp(ctx.db, id, l.external_id, bruto.contatos ?? [], ctx.agora());
      await aplicarFinanceiroDoErp(ctx.db, id, l.external_id, bruto.limite_credito_cents, bruto.bloqueado, bruto.alterado_em);
    }
    await ctx.publicar(
      EVENTO_CLIENTE_ATUALIZADO,
      {
        cliente_id: id,
        campos: [...COLUNAS_GRAVADAS],
        origem: 'erp',
        ...(await carteiraDoEvento(ctx.db, id)),
        cadastro_incompleto: l.cadastro_incompleto,
        cadastro_campos_faltantes: l.cadastro_campos_faltantes,
      },
      id,
    );
  },
});

/** Todos os consumidores do ERP no Core (T-0066), na ordem de dependência (RN-INT-04); o `index.ts` só repassa. */
export const consumidoresDoErp: ConsumidorEvento[] = [
  consumidorVendedorDoErp,
  consumidorClienteDoErp,
  consumidorProdutoDoErp,
  consumidorTituloDoErp,
  consumidorRotaDoErp,
];
