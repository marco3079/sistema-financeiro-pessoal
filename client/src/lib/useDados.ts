import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

export function useDados<T>(caminho: string | null): {
  dados: T | null;
  carregando: boolean;
  erro: string | null;
  recarregar(): void;
} {
  const [dados, setDados] = useState<T | null>(null);
  const [carregando, setCarregando] = useState<boolean>(caminho !== null);
  const [erro, setErro] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    if (caminho === null) {
      setDados(null);
      setCarregando(false);
      setErro(null);
      return;
    }

    let cancelado = false;
    setCarregando(true);
    setErro(null);

    api
      .get<T>(caminho)
      .then((resposta) => {
        if (!cancelado) setDados(resposta);
      })
      .catch((e: unknown) => {
        if (!cancelado) setErro(e instanceof Error ? e.message : 'Erro inesperado');
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });

    return () => {
      cancelado = true;
    };
  }, [caminho, versao]);

  const recarregar = useCallback(() => setVersao((v) => v + 1), []);

  return { dados, carregando, erro, recarregar };
}
