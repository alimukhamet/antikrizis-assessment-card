"use client";
import { useEffect, useState } from "react";
type Health = {
  checkedAt: string;
  version: string;
  events: {
    deal_id: string | null;
    action: string;
    code: string;
    occurrences: number;
    last_seen: string;
  }[];
  staleClients: unknown[];
  deliveryGaps: { deal_id: string; operation_id: string }[];
  stuck: {
    deal_id: string;
    action: string;
    state: string;
    operation_id: string;
  }[];
};
const actions: Record<string, string> = {
  page: "Открытие страницы",
  open_case: "Открытие сделки",
  draft: "Сохранение ответов",
  analysis: "Чтение документа",
  review: "Проверка документа",
  check: "Проверка анкеты",
  contract: "Подготовка договора",
  upload: "Загрузка файлов",
  credentials: "Передача ЭЦП",
  handoff: "Передача юристам",
  title_repair: "Название сделки",
  intake: "Передача в CRM",
};
export function AutomaticIncidents() {
  const [data, setData] = useState<Health | null>(null),
    [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    async function read() {
      try {
        const response = await fetch("/api/operations-monitor", {
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) throw Error();
        const next = (await response.json()) as Health;
        if (
          !Array.isArray(next.events) ||
          !Array.isArray(next.stuck) ||
          !Array.isArray(next.deliveryGaps) ||
          !Array.isArray(next.staleClients)
        )
          throw Error();
        if (active) {
          setData(next);
          setError(false);
        }
      } catch {
        if (active) setError(true);
      }
    }
    void read();
    const timer = setInterval(read, 60000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  return (
    <section
      className="ps-current feedback-item"
      aria-label="Автоматический контроль"
    >
      <h2>Автоматический контроль</h2>
      <p>Ошибки записываются без обращения сотрудника.</p>
      {error ? (
        <p role="alert">
          Не удалось получить состояние системы. Проверка повторится
          автоматически.
        </p>
      ) : !data ? (
        <p>Проверяем…</p>
      ) : null}
      {data ? (
        <>
          <p>
            За 24 часа: ошибок — {data.events.length}; незавершённых операций
            дольше 15 минут — {data.stuck.length}; замечено старых вкладок —{" "}
            {data.staleClients.length}.
          </p>
          <p>
            Проверено:{" "}
            {new Date(data.checkedAt).toLocaleString("ru-RU", {
              timeZone: "Asia/Almaty",
            })}
          </p>
          {data.deliveryGaps.length ? (
            <div role="status">
              <p>Неполная передача юристам — {data.deliveryGaps.length}.</p>
              {data.deliveryGaps.map((row) => (
                <p key={row.operation_id}>
                  <a href={"/assessment-review?dealId=" + row.deal_id}>Сделка {row.deal_id}</a>
                  {" "}· стадия изменена, сохранение анкеты не подтверждено.
                </p>
              ))}
            </div>
          ) : null}
          {data.stuck.map((row) => (
            <p key={row.operation_id}>
              <a href={"/assessment-review?dealId=" + row.deal_id}>
                Сделка {row.deal_id}
              </a>{" "}
              · {actions[row.action] || "Операция"}: требуется проверить
              сохранённый результат.
            </p>
          ))}
          {data.events.length ? (
            <details>
              <summary>Последние ошибки</summary>
              {data.events.map((row, i) => (
                <p key={i}>
                  {row.deal_id ? (
                    <a href={"/assessment-review?dealId=" + row.deal_id}>
                      Сделка {row.deal_id}
                    </a>
                  ) : (
                    "Страница"
                  )}{" "}
                  · {actions[row.action] || "Действие"} · {row.occurrences} раз{" "}
                  <code>{row.code}</code>
                </p>
              ))}
            </details>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
