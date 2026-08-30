/**
 * Доменная модель Readoza. Ничего специфичного для Telegram здесь быть не должно:
 * это то, во что любой источник (Telegram public HTML, TDLib, RSS) обязан себя уложить.
 */

export type MediaKind = "photo" | "video" | "document";

export interface Media {
  kind: MediaKind;
  /** Прямая ссылка на файл. У фото её нет: Telegram отдаёт только превью в CSS. */
  url?: string;
  /** Превью-картинка. Для фото это и есть единственный доступный источник. */
  thumb?: string;
  /** Ссылка на пост в Telegram, к которому относится этот элемент медиа. */
  postUrl?: string;
  /** Имя файла для документов. */
  title?: string;
  /** Человекочитаемый размер документа, как его отдал Telegram («3.9 MB»). */
  size?: string;
}

export interface LinkPreview {
  url: string;
  siteName?: string;
  title?: string;
  description?: string;
  image?: string;
}

export interface ForwardedFrom {
  name: string;
  url?: string;
}

export interface Reaction {
  emoji: string;
  count: number;
}

export interface Post {
  /** Канонический username канала, взятый из data-post, а НЕ из пользовательского ввода. */
  channel: string;
  /** message id внутри канала. Монотонный, но с пропусками. */
  id: number;
  /** ISO-8601 из <time datetime>. */
  date: string;
  /** Сырой HTML текстового блока. Санитайзится на слое отображения, не здесь. */
  html: string;
  /** Плоский текст для поиска и подсчёта длины. */
  text: string;
  media: Media[];
  /** id участников альбома, если пост это альбом. Пустой массив, если нет. */
  albumIds: number[];
  linkPreview?: LinkPreview;
  forwardedFrom?: ForwardedFrom;
  /** Служебное сообщение: «канал создан», «закреплено сообщение» и подобное. */
  isService: boolean;
  views?: number;
  reactions: Reaction[];
}

export interface ChannelMeta {
  /** Канонический username. Может отличаться от введённого: breakingmash -> mash. */
  username: string;
  title: string;
  description?: string;
  avatar?: string;
  subscribers?: number;
}

/**
 * Курсор пагинации. `before`/`after` приходят от самого Telegram, мы их не вычисляем.
 * `start` означает «от первого поста канала», `end` — «от последнего».
 */
export type Cursor =
  /**
   * `upTo` — самый большой известный id канала. Нужен, чтобы найти начало у
   * канала, где удалены первые сотни тысяч сообщений: без верхней границы
   * поиск упирается в фиксированный потолок и объявляет такой канал пустым.
   */
  | { kind: "start"; upTo?: number }
  | { kind: "end" }
  | { kind: "before"; id: number }
  | { kind: "after"; id: number };

export interface Page {
  /** Канонический username, определённый по содержимому страницы. */
  channel: string;
  posts: Post[];
  /** Курсор на предыдущее окно. Отсутствует — значит это начало канала. */
  prev?: Cursor;
  /** Курсор на следующее окно. Отсутствует — значит это конец канала. */
  next?: Cursor;
}
