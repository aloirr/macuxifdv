/** `blob:` de uma imagem para o `<img>`, solto quando a imagem sai da tela (logo da empresa no portal e no shell do BKO). */
import { useEffect, useState } from 'react';

export function useUrlDoBlob(blob: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}
