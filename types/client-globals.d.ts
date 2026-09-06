/*
 * Внешние глобальные имена для проверки `public/app.js`.
 *
 * Socket.IO приезжает отдельным тегом <script> с сервера и объявляет `io`
 * в window. Для проверки это единственное имя, которого нет в самом файле
 * и которое при этом не ошибка.
 */
declare const io: (...args: unknown[]) => {
  on: (event: string, handler: (...payload: never[]) => void) => void;
  emit: (event: string, ...payload: unknown[]) => void;
  disconnect: () => void;
  connected: boolean;
};
