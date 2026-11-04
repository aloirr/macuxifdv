/**
 * Sonda do armazenamento de arquivos (T-0074): grava, lê e apaga um objeto de teste com o MESMO adaptador e as MESMAS
 * variáveis da API (`lerArmazenamentoDoAmbiente`). O `implantar.sh` roda dentro do contêiner da API depois do deploy:
 *   node --import tsx apps/api/src/sonda-armazenamento.ts
 * A chave fica fora de qualquer tenant real: `00000000-0000-0000-0000-000000000000/sonda/<aaaa-mm>/<uuid>.jpg`.
 * Saída 0 = ok; 1 = falhou. Imprime só o driver, a operação, o status HTTP e o código S3, nunca a chave de acesso.
 */
import { randomUUID } from 'node:crypto';
import { ErroArmazenamentoS3, lerArmazenamentoDoAmbiente } from './armazenamento-s3';
import { chaveDoArquivo } from './arquivos';

const TENANT_NENHUM = '00000000-0000-0000-0000-000000000000';

async function principal(): Promise<void> {
  const { armazenamento, descricao } = lerArmazenamentoDoAmbiente(process.env);
  const chave = chaveDoArquivo({ tenant_id: TENANT_NENHUM, modulo: 'sonda', id: randomUUID() }, new Date());
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  await armazenamento.gravar(chave, bytes);
  const lido = await armazenamento.ler(chave);
  if (!lido || Buffer.compare(Buffer.from(lido), Buffer.from(bytes)) !== 0) throw new Error('o objeto gravado não voltou igual na leitura');
  await armazenamento.remover(chave);
  console.log(`[sonda] armazenamento ok (${descricao}): gravar, ler e remover`);
}

principal().catch((e: unknown) => {
  const msg = e instanceof ErroArmazenamentoS3 ? e.message : e instanceof Error ? e.message : String(e);
  console.error(`[sonda] armazenamento FALHOU: ${msg}`);
  process.exit(1);
});
