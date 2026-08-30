import { useEffect, useState } from "react";

/**
 * Есть ли сеть.
 *
 * Для local-first читалки это не мелочь: без сети приложение обязано оставаться
 * рабочим и честно говорить, что показывает уже скачанное, а не притворяться,
 * будто канал закончился.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    const up = (): void => setOnline(true);
    const down = (): void => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  return online;
}
