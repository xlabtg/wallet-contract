# PoC-харнесс аудита безопасности — TON Wallet V4 R2 + subscription plugin

Этот каталог содержит воспроизводимое окружение для аудита безопасности контрактов
`func/wallet-v4-code.fc` и `func/simple-subscription-plugin.fc` по запросу
[issue #1](https://github.com/xlabtg/wallet-contract/issues/1) в рамках
[TON Bug Bounty Program](https://github.com/ton-blockchain/bug-bounty).

Полный сводный отчёт с методологией и вердиктом: **[`REPORT.md`](./REPORT.md)**.
Отдельные submission-файлы по каждой находке лежат в **[`findings/`](./findings/)**:
для каждой находки есть ровно один `report.md` и один `self-check-report.md`.

> ⚠️ **Все эксперименты выполняются только в локальном TON Sandbox.** Ни один PoC не
> деплоится и не исполняется в mainnet или testnet (требование issue).

---

## Требования

- Node.js 18+ и npm.
- Доступ в сеть для `npm install` (тянет `@ton/*` и `@ton-community/func-js`).

## Установка и запуск

```bash
cd audit
npm install
npm run build   # компилирует контракты в build/*.cell.base64
npm test        # запускает все PoC-наборы (jest --runInBand)
```

Ожидаемый результат: **сборка успешна, 30 тестов / 7 наборов — зелёные**.

### О компиляции

`compile.ts` читает исходные `.fc` из `../func`, удаляет строку `#pragma version =0.2.0;`
**в памяти** (несовместима с используемым `func` 0.4.x) и компилирует код вместе со
stdlib в base64-ячейку. **Файлы на диске не изменяются** — аудируется ровно тот код, что
лежит в репозитории.

---

## Структура

| Путь | Назначение |
| --- | --- |
| `REPORT.md` | Сводный отчёт по аудиту (RU): методология, свойства безопасности, индекс находок, by-design, вердикт. |
| `findings/F-*/report.md` | Отдельный bug report по одной находке. |
| `findings/F-*/self-check-report.md` | Self-check по официальному TON skill для соседнего `report.md`. |
| `compile.ts` | Компиляция контрактов (func-js) в `build/`. |
| `wrappers/` | TS-обёртки `WalletV4`, `SubscriptionPlugin`, загрузка скомпилированного кода. |
| `tests/` | PoC-наборы Jest (см. ниже). |
| `build/` | Артефакты компиляции (в `.gitignore`). |
| `node_modules/` | Зависимости (в `.gitignore`). |

### Карта тестов

| Файл | Что доказывает |
| --- | --- |
| `tests/00-sanity.spec.ts` | Геттеры; валидная подпись двигает `seqno`; неверный ключ отвергнут (exit 35). |
| `tests/01-audit-poc.spec.ts` | Свойства плагина: forward к beneficiary (by-design); гейт оплаты по `op`+источнику; защита от двойной оплаты (exit 49); F-04 + MITIGATION; F-05 (bounce инертен); F-02 (period==0). |
| `tests/02-deploy-sweep.spec.ts` | By-design: stray-переводы пересылаются beneficiary; PoC к F-01 (остаток ~0.067 TON). |
| `tests/03-double-and-misc.spec.ts` | Двойной запрос (1-й платит, 2-й отскакивает); happy path; оплата в следующем периоде; extra-currency dict. |
| `tests/04-timeslot-arith.spec.ts` | F-03 (ранняя активация) + CONTROL (корректный init устраняет) + CHECK (штатный первый платёж). |
| `tests/98-lifecycle.spec.ts` | LC1 (деплой+установка op1); LC2 (только сам плагин удаляет себя; спуфинг невозможен). |
| `tests/99-audit-probe.spec.ts` | PROBE1–7 по кошельку: auth, порядок проверок, неизвестный op, replay, commit-семантика, контроль баланса, отсутствие malleability. |

---

## Итог аудита (кратко)

**Уязвимостей Critical / High / Medium не обнаружено.** По кошельку Wallet V4 (однозначно
in-scope) уязвимостей нет. По плагину подписки — 5 наблюдений Low/Informational, ни одно из
которых не квалифицируется как принимаемая находка bounty.

| ID | Severity | Описание | Self-check |
| --- | --- | --- | --- |
| F-01 | Informational | README обещает «1 Toncoin», код резервирует ~0.067 TON | [`DO NOT SEND!!!`](./findings/F-01-reserve-documentation-mismatch/self-check-report.md) |
| F-02 | Low (hardening) | `period == 0` не валидируется -> деление на ноль | [`DO NOT SEND!!!`](./findings/F-02-period-zero/self-check-report.md) |
| F-03 | Low (init-contingent) | `start_time` в будущем + `last_payment_time=0` -> ранняя активация | [`DO NOT SEND!!!`](./findings/F-03-future-start-time/self-check-report.md) |
| F-04 | Low | `failed_attempts` считается по запросам, а не по периодам | [`DO NOT SEND!!!`](./findings/F-04-failed-attempts-per-request/self-check-report.md) |
| F-05 | Informational | `recv_internal` не проверяет `flags & 1` (bounced) | [`DO NOT SEND!!!`](./findings/F-05-bounced-message-flag/self-check-report.md) |

Подробности, PoC-привязки и рекомендации — в [`REPORT.md`](./REPORT.md) и отдельных файлах
`findings/F-*/report.md`.

> **Замечание по области.** Официальный bounty относит *«Wallet plugins (for all versions)»*
> к out-of-scope, отдельно оставляя in-scope *«Wallet V4 and subscription smart contracts»*.
> Плагин подписки технически является «wallet plugin», поэтому находки F-01–F-05 (все по плагину)
> с высокой вероятностью вне области bounty. См. §10 отчёта.
