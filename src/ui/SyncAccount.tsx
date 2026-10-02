import { useState } from "react";
import type { ReactElement } from "react";
import { createIdbRepo } from "../core/storage/idb.js";
import {
  accountDbName, generateRecoveryCode, getSyncSession, migrateGuest,
  setSyncSession, SyncClient, validNickname,
} from "../core/storage/sync.js";
import type { Repo } from "../core/storage/types.js";

export function SyncAccount({
  repo, client, status,
}: {
  repo: Repo;
  client?: SyncClient;
  status: string;
}): ReactElement {
  const session = getSyncSession();
  const [nickname, setNickname] = useState("");
  const [code, setCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const syncUrl = import.meta.env.VITE_SYNC_URL as string | undefined;

  async function submit(): Promise<void> {
    const name = nickname.trim().toLowerCase();
    if (!syncUrl) { setMessage("Синхронизация пока не настроена"); return; }
    if (!validNickname(name) || !/^[0-9a-f]{32}$/.test(code)) {
      setMessage("Никнейм: 3–32 латинских символа, цифры, _ или -. Код: 32 символа.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`${syncUrl.replace(/\/$/, "")}/v1/sync/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: name, code }),
      });
      if (!response.ok) throw new Error(response.status === 401 ? "Неверный код для этого никнейма" : "Не удалось подключиться");
      const data = await response.json() as { created: boolean };
      if (data.created) {
        const accountRepo = await createIdbRepo(accountDbName(name));
        try {
          const sync = new SyncClient(accountRepo, { nickname: name, code }, syncUrl);
          await migrateGuest(repo, sync.repo);
          sync.stop();
        } finally { accountRepo.close(); }
      }
      setSyncSession({ nickname: name, code });
      window.location.reload();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Не удалось войти");
    } finally { setBusy(false); }
  }

  return (
    <section className="sync-account" aria-label="Синхронизация">
      <h2>Синхронизация</h2>
      {session ? (
        <>
          <p>Профиль: <b>{session.nickname}</b> · {status}</p>
          <div className="sync-account__actions">
            <button type="button" onClick={() => void client?.pull().catch(() => undefined)}>Синхронизировать</button>
            <button type="button" onClick={() => void (async () => {
              if (!client) return;
              const guest = await createIdbRepo();
              try {
                await migrateGuest(guest, client.repo);
                await client.flush();
                setMessage("Гостевая библиотека добавлена в профиль");
              } catch { setMessage("Не удалось добавить гостевую библиотеку"); }
              finally { guest.close(); }
            })()}>Добавить гостевую библиотеку</button>
            <button type="button" onClick={() => setShowCode((value) => !value)}>
              {showCode ? "Скрыть код" : "Показать код"}
            </button>
            <button type="button" onClick={() => { setSyncSession(undefined); window.location.reload(); }}>Выйти</button>
          </div>
          {showCode ? <output className="sync-account__code">{session.code}</output> : null}
        </>
      ) : (
        <>
          <p>Каналы и прогресс будут доступны на другом устройстве по никнейму и коду.</p>
          <label htmlFor="sync-nickname">Никнейм</label>
          <input id="sync-nickname" autoComplete="username" value={nickname}
            onChange={(event) => setNickname(event.target.value)} placeholder="my_name" />
          <label htmlFor="sync-code">Секретный код</label>
          <input id="sync-code" autoComplete="off" spellCheck={false} value={code}
            onChange={(event) => setCode(event.target.value.toLowerCase())} placeholder="32 символа" />
          <div className="sync-account__actions">
            <button type="button" disabled={busy} onClick={() => void submit()}>Подключить профиль</button>
            <button type="button" disabled={busy} onClick={() => {
              setCode(generateRecoveryCode());
              setMessage("Сохраните код. Без него восстановить профиль на другом устройстве нельзя.");
            }}>Создать код</button>
          </div>
        </>
      )}
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
