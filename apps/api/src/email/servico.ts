/**
 * Porta `ServicoEmail` na API (T-0094; ADR 0032; desenho §10 itens 1, 2 e 6; RN-CORE-34) e as fábricas do adaptador.
 *
 * `enfileirar(db, m)`: valida (Zod), cifra (AES-256-GCM, AAD = id|tenant|modelo) e faz UM `insert` em
 * `plataforma.email_saida` pela conexão recebida — a da transação do tenant (`comTenant`, papel `macuxi_app`, RLS): a senha muda
 * ⇔ o e-mail entra na fila. `on conflict (tenant_id, chave_idempotencia) do nothing`: a mesma chave não gera 2º e-mail. Sem
 * adaptador (`desligado`): `disponivel() = false` e `'indisponivel'` sem gravar. Mensagem inválida ou banco fora: lança
 * (`ErroEmail`/erro do pg) e a rota desfaz a transação.
 *
 * O despachante (`despachante.ts`, papel `macuxi_worker`) entrega depois. Log: só `email_id`, `tenant_id`, `modelo`.
 */
import { randomUUID } from 'node:crypto';
import {
  CODIGOS_EMAIL,
  MensagemEmailSchema,
  type CargaEmail,
  type ClienteBanco,
  type LogRota,
  type ResultadoEnfileirarEmail,
  type ServicoEmail,
  type TransporteEmail,
} from '@macuxi/platform-sdk';
import { criarTransporteArquivo } from './arquivo';
import { criarCifraEmail, type AadEmail, type CifraEmail } from './cifra';
import { descreverConfigEmail, type ConfigEmail } from './config';
import { ErroEmail } from './erros';
import { criarTransporteSmtp } from './smtp';

const SQL_TENANT = 'select plataforma.tenant_atual() as tenant_id';
const SQL_INSERIR = `
  insert into plataforma.email_saida (id, tenant_id, usuario_id, modelo, chave_idempotencia, carga, expira_em)
  values ($1, $2, $3, $4, $5, $6, now() + make_interval(hours => $7))
  on conflict (tenant_id, chave_idempotencia) do nothing
  returning id`;

export interface OpcoesServicoEmail {
  /** `null` = desligado (`disponivel() = false`). */
  cifra: CifraEmail | null;
  log: LogRota;
  novoId?: () => string;
}

/**
 * A porta das rotas (`ctx.email`) e, só na API, `cifrar`: a rota do portal que redefine a senha do admin (T-0094) manda a carga
 * já cifrada à `sa_redefinir_senha_admin`, que grava a outbox na mesma transação (o `macuxi_portal` não escreve na tabela).
 */
export type ServicoEmailDaApi = ServicoEmail & { cifrar(carga: CargaEmail, aad: AadEmail): Buffer };

export function criarServicoEmail(op: OpcoesServicoEmail): ServicoEmailDaApi {
  const novoId = op.novoId ?? randomUUID;
  return {
    disponivel: () => op.cifra !== null,
    cifrar(carga, aad) {
      if (!op.cifra) throw new ErroEmail(CODIGOS_EMAIL.CONFIG_INVALIDA, 'e-mail desligado: nada a cifrar', { retentavel: false, etapa: 'config' });
      return op.cifra.cifrar(carga, aad);
    },
    async enfileirar(db: ClienteBanco, m): Promise<ResultadoEnfileirarEmail> {
      const cifra = op.cifra;
      if (!cifra) return 'indisponivel';
      const v = MensagemEmailSchema.safeParse(m);
      if (!v.success) {
        // só caminho e código do Zod (a mensagem pode trazer o valor recebido)
        const problemas = v.error.issues.slice(0, 10).map((i) => `${i.path.join('.')}:${i.code}`);
        op.log.warn({ tipo: 'email', evento: 'recusado', codigo: CODIGOS_EMAIL.DADOS_INVALIDOS, problemas }, 'pedido de e-mail inválido');
        throw new ErroEmail(CODIGOS_EMAIL.DADOS_INVALIDOS, `pedido de e-mail inválido (${problemas.join(', ')})`, { retentavel: false, etapa: 'validacao' });
      }
      const msg = v.data;
      const tenantId = (await db.query<{ tenant_id: string | null }>(SQL_TENANT)).rows[0]?.tenant_id;
      if (!tenantId) throw new ErroEmail(CODIGOS_EMAIL.DADOS_INVALIDOS, 'enfileirar fora da transação do tenant (comTenant)', { retentavel: false, etapa: 'validacao' });
      const id = novoId();
      const carga = cifra.cifrar({ para: msg.para, dados: msg.dados }, { id, tenant_id: tenantId, modelo: msg.modelo });
      // a linha vive até a senha temporária vencer; sem validade (admin inicial, P5), o padrão de 72 h para sair
      const horas = msg.dados.validade_horas ?? 72;
      const r = await db.query<{ id: string }>(SQL_INSERIR, [id, tenantId, msg.usuario_id, msg.modelo, msg.chave_idempotencia, carga, horas]);
      const novo = r.rows.length > 0;
      op.log.info({ tipo: 'email', evento: novo ? 'enfileirado' : 'duplicado', email_id: novo ? id : undefined, tenant_id: tenantId, modelo: msg.modelo }, novo ? 'e-mail na outbox' : 'e-mail já estava na outbox (mesma chave)');
      return 'enfileirado';
    },
  };
}

/** Adaptador a partir da configuração (`null` se desligado). */
export function criarTransporteDaConfig(cfg: ConfigEmail, op: { log: LogRota; agora?: () => Date }): TransporteEmail | null {
  if (cfg.transporte === 'desligado') return null;
  const agora = op.agora ? { agora: op.agora } : {};
  if (cfg.transporte === 'arquivo') return criarTransporteArquivo({ pasta: cfg.pasta, log: op.log, mascararSenha: cfg.mascararSenhaNoArquivo, ...agora });
  if (!cfg.smtp) throw new Error('configuração smtp ausente'); // lerConfigEmail garante; erro de programação
  return criarTransporteSmtp(cfg.smtp, agora);
}

/** O `ctx.email` da API a partir da configuração (registra a configuração sem segredo). */
export function criarServicoEmailDaConfig(cfg: ConfigEmail, log: LogRota): ServicoEmailDaApi {
  log.info({ tipo: 'email', evento: 'configuracao', ...descreverConfigEmail(cfg), avisos: cfg.avisos }, 'e-mail transacional');
  return criarServicoEmail({ cifra: cfg.transporte === 'desligado' ? null : criarCifraEmail(cfg.chave), log });
}

/** Porta desligada (padrão do `createApp` sem e-mail configurado: `disponivel() = false`). */
export const SERVICO_EMAIL_DESLIGADO: ServicoEmail = {
  disponivel: () => false,
  enfileirar: async () => 'indisponivel',
};
