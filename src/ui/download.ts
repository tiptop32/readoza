/**
 * Отдать файл пользователю. Всё происходит в браузере: байты никуда не уезжают,
 * сервер про экспорт не знает и знать не должен.
 */
export function saveFile(bytes: Uint8Array, filename: string, type: string): void {
  const blob = new Blob([bytes as unknown as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Даём браузеру начать сохранение до того, как ссылка станет недействительной.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
