// Sobe imagens para recados/anexos/ do repositório de recados (uma por commit, sem sobrescrever).
// Uso: node subir-anexos.mjs <prefixo> <arquivo.png> [...]
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO = 'aloirr/macuxifdv-recados';
const SP = 'C:/Users/domon/AppData/Local/Temp/claude/b5e741428393dd6e/dcc73486-2afb-480b-ae75-9b725bb97756/scratchpad';
const [prefixo, ...arquivos] = process.argv.slice(2);
for (const arq of arquivos) {
  const nome = `${prefixo}${basename(arq)}`;
  const caminho = `recados/anexos/${nome}`;
  const corpo = {
    message: `anexo: ${nome} (gerente-projetos, imagem para aprovação)`,
    content: readFileSync(arq).toString('base64'),
    branch: 'main',
  };
  const tmp = join(SP, 'anexo-corpo.json');
  writeFileSync(tmp, JSON.stringify(corpo));
  let ok = false;
  for (let i = 1; i <= 4 && !ok; i++) {
    try {
      execFileSync('gh', ['api', '-X', 'PUT', `repos/${REPO}/contents/${caminho}`, '--input', tmp, '--jq', '.content.path'], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
      ok = true;
    } catch (e) {
      const msg = String(e.stderr || e.message);
      // Só conta como "já existe" se o GET achar o arquivo; conflito de commit (409) tenta de novo.
      let existe = false;
      try { execFileSync('gh', ['api', `repos/${REPO}/contents/${caminho}`, '--jq', '.size'], { stdio: ['ignore', 'pipe', 'ignore'] }); existe = true; } catch { /* não existe */ }
      if (existe) { console.log(`JÁ EXISTE (não sobrescrevi): ${caminho}`); ok = true; break; }
      if (i === 4) { console.log(`FALHOU: ${caminho}: ${msg.split('\n')[0]}`); }
    }
  }
  if (ok) console.log(`https://github.com/${REPO}/blob/main/${caminho}`);
}
