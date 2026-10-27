import { useEffect, useState } from "react";
import { readCacheSavedAt, subscribeCacheSavedAt } from "../../api/cache";
import { getLocale, INTL_TAG, useMessages } from "../../i18n";
import { offlineMessages } from "./messages";

/** Reads persisted server acknowledgements; reconnect events and offline edits never move this clock. */
export function CacheSavedTime() {
  const t = useMessages(offlineMessages);
  // undefined while the stored time is being read; null when nothing has been saved from the server yet.
  const [savedAt, setSavedAt] = useState<number | null>();
  useEffect(() => {
    let active = true;
    let version = 0;
    const read = () => {
      const request = ++version;
      void readCacheSavedAt().then(
        (time) => {
          if (active && request === version) setSavedAt(time ?? null);
        },
        (error: unknown) => {
          console.warn("cache save time unavailable", error);
          if (active && request === version) setSavedAt(null);
        },
      );
    };
    const unsubscribe = subscribeCacheSavedAt(read);
    read();
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  if (savedAt === undefined) return null;
  return (
    <span>
      {t.lastSaved}{" "}
      {savedAt === null ? (
        t.unknownTime
      ) : (
        <time dateTime={new Date(savedAt).toISOString()}>
          {new Intl.DateTimeFormat(INTL_TAG[getLocale()], {
            timeZone: "Asia/Seoul",
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
          }).format(savedAt)}
        </time>
      )}
    </span>
  );
}
