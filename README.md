# Adaptivity Chat
Полноценный сервис чатов с серверами, каналами, ролями, инвайтами, личными сообщениями, медиа, реакциями и админ-панелью.


## 1. Что это за сервис
Adaptivity Chat — это мессенджер в стиле «серверы + каналы»:
- у пользователя есть список серверов;
- внутри сервера есть текстовые и голосовые каналы;
- есть роли сервера и ограничения видимости каналов по ролям;
- есть личные сообщения с друзьями;
- есть инвайты на сервер;
- есть админка для модерации и системных публикаций.

## 2. Текущий стек
- Backend: `Node.js + Express + PostgreSQL + ws`
- Frontend: `React + TypeScript + Zustand + Vite + Tailwind`
- Realtime: WebSocket события (новые сообщения, реакции, обновления)
- Auth: JWT в cookie + OAuth провайдеры + локальный onboarding
- Безопасность данных: шифрование сообщений и медиа на сервере

## 3. Полный пользовательский путь (от А до Б)
###  Запуск системы
1. Поднимается PostgreSQL.
2. Поднимается backend (`/api`, `/auth`, `/admin/api`, `/ws`).
3. Поднимается frontend (`/auth`, `/app`, `/admin`).
4. При старте backend создает/обновляет схему БД и дефолтный сервер `Adaptivity`.

###  Авторизация
1. Пользователь открывает `/auth/`.
2. Входит через OAuth или локальную форму.
3. Backend выставляет `auth_token` cookie.
4. Пользователь попадает в `/app/`.

###  Работа в чате
1. В левом сайдбаре: `DM` + список серверов.
2. Можно создать сервер через UI-модалку (имя + иконка сервера).
3. В сервере можно:
- создавать категории;
- создавать каналы (текст/голос) с привязкой к категории;
- настраивать видимость канала по ролям.
4. Сообщения:
- текст;
- медиа (изображения/видео/аудио);
- реакции;
- редактирование/удаление своих сообщений;
- контекстное меню по правому клику;
- ответы (reply):
  - выбранный reply показывается над полем ввода,
  - в отправленном сообщении рисуется «хвостик» ответа,
  - клик по хвостику делает переход/подсветку исходного сообщения.

###  Друзья и личные сообщения
1. В режиме `DM` отправляются заявки в друзья.
2. После подтверждения открывается личный чат.
3. Работают сообщения, медиа, реакции, редактирование/удаление.

###  Инвайты
1. В меню сервера можно создать invite-ссылку.
2. Ссылка ведет на `/app/?invite=...`.
3. После принятия инвайта сервер добавляется пользователю.

###  Роли и доступ
1. В настройках сервера (для `creator/admin`):
- создание/редактирование/удаление кастомных ролей;
- назначение ролей участникам;
- настройка прав роли (permission map).
2. Видимость каналов:
- если список ролей видимости пустой — канал виден всем участникам сервера;
- если список заполнен — канал видят только участники с подходящей ролью.

## 4. Основные модули проекта
- `backend/src/routes/api-modules/*` — доменная API-логика (servers/channels/messages/friends/media).
- `backend/src/routes/admin.js` — API админки.
- `backend/src/db-modules/*` — миграции и схема workspace/messages.
- `frontend/src/store/chatStore.ts` — основной клиентский state и действия.
- `frontend/src/components/*` — UI серверов, каналов, сообщений, настроек.

## 5. Схема данных (ключевое)
Главные таблицы:
- `users`, `auth_identities`, `friendships`
- `servers`, `server_participants`
- `channels`, `channel_participants`
- `server_categories`
- `server_roles`, `server_member_roles`
- `channel_visibility_roles`
- `messages`, `direct_messages`
- `message_reactions`, `direct_message_reactions`
- `media_files`
- `server_invites`

## 6. Локальный запуск
### Требования
- Node.js 18+
- PostgreSQL 16+

### Шаги
1. Установить зависимости:
```bash
npm install
```
2. Запустить backend + frontend:
```bash
npm run dev
```
3. Открыть:
- `http://localhost:5173/auth/` (frontend dev)
- `http://localhost:5173/app/`
- `http://localhost:5173/admin`

## 7. Docker запуск
```bash
docker-compose up --build
```
После старта сервис доступен через Caddy-прокси (по порту из `docker-compose.yml`).

## 8. Конфигурация backend (`backend/.env`)
Минимально важные переменные:
- `PORT` — порт backend (по умолчанию 8000)
- `DATABASE_URL` — строка подключения PostgreSQL
- `DOMAIN` — домен для генерации invite-ссылок
- `JWT_SECRET`, `COOKIE_SECRET`
- `ADMIN_LOGIN`, `ADMIN_PASSWORD`
- OAuth переменные (`YANDEX_*`, `GOOGLE_*`, `TELEGRAM_*`) при необходимости
- параметры шифрования сообщений (`MESSAGE_ENCRYPTION_*`)

## 9. Тесты
Frontend:
```bash
npm run test --workspace matrix-discord-chat
```

Backend:
```bash
npm run test --workspace messenger-backend
```

Все вместе:
```bash
npm run --workspaces=false test:all
```
