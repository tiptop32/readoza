import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import type { ChannelMeta } from "../core/model.js";
import { addChannel, ReadozaError } from "../core/reader/library.js";
import type { Source } from "../core/source/types.js";
import type { Channel, Repo } from "../core/storage/types.js";
import { formatCount } from "./format.js";
import { useOnline } from "./useOnline.js";

/** Пауза перед резолвом, чтобы не дёргать Telegram на каждую букву. */
const RESOLVE_DEBOUNCE_MS = 400;

type State = "idle" | "resolving" | "missing" | "failed";

/**
 * Одно поле ввода вместо поиска.
 *
 * Глобального поиска каналов у Telegram без авторизации нет: t.me/search это
 * страница пользователя с ником search, а не поиск. Зато существующий канал
 * резолвится одним дешёвым запросом (~11 KB), и живая карточка под полем даёт
 * ощущение поиска без стороннего индекса и без слива запросов на чужой сайт.
 */
export function AddChannel({
  repo,
  source,
  onAdded,
}: {
  repo: Repo;
  source: Source;
  onAdded: (channel: Channel) => void;
}): ReactElement {
  const [input, setInput] = useState("");
  const [meta, setMeta] = useState<ChannelMeta | null>(null);
  const [state, setState] = useState<State>("idle");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const online = useOnline();

  useEffect(() => {
    setError(undefined);
    const username = source.match(input);
    if (!username) {
      setMeta(null);
      setState("idle");
      return;
    }

    let cancelled = false;
    setState("resolving");
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const found = await source.fetchMeta(username);
          if (cancelled) return;
          setMeta(found);
          setState(found ? "idle" : "missing");
        } catch {
          if (!cancelled) setState("failed");
        }
      })();
    }, RESOLVE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [input, source]);

  async function start(): Promise<void> {
    setAdding(true);
    setError(undefined);
    try {
      onAdded(await addChannel(repo, source, input));
      setInput("");
      setMeta(null);
    } catch (cause) {
      setError(
        cause instanceof ReadozaError && cause.code === "not-a-channel"
          ? "That is a group or a user, not a channel. Readoza reads channels."
          : cause instanceof Error
            ? cause.message
            : String(cause),
      );
    } finally {
      setAdding(false);
    }
  }

  return (
    <section className="add">
      <input
        className="add__input"
        value={input}
        onChange={(event) => setInput(event.target.value)}
        placeholder="t.me/sys_sa"
        spellCheck={false}
        autoComplete="off"
        aria-label="Telegram channel"
      />

      {online ? null : (
        <p className="notice notice--offline">
          You are offline. Adding a new channel needs a connection; channels you already have stay
          readable.
        </p>
      )}

      {state === "resolving" ? <p className="add__hint">Looking up…</p> : null}
      {state === "missing" ? (
        <p className="add__hint">
          No such channel. Readoza reads public channels; private ones and invite links are not
          supported.
        </p>
      ) : null}
      {state === "failed" ? <p className="add__hint">Could not reach Telegram. Try again.</p> : null}

      {meta ? (
        <div className="card">
          {meta.avatar ? <img className="card__avatar" src={meta.avatar} alt="" /> : null}
          <div className="card__body">
            <b className="card__title">{meta.title}</b>
            <span className="card__meta">
              @{meta.username}
              {meta.subscribers ? ` · ${formatCount(meta.subscribers)} subscribers` : ""}
            </span>
            {meta.description ? <p className="card__description">{meta.description}</p> : null}
          </div>
          <button type="button" onClick={() => void start()} disabled={adding || !online}>
            {adding ? "Finding the first post…" : "Start from the beginning"}
          </button>
        </div>
      ) : null}

      {error ? <p className="notice notice--error">{error}</p> : null}
    </section>
  );
}
