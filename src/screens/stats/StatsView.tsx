import { AlertCircle } from "lucide-react";
import type { Settings } from "../../../shared/schema";
import { paths } from "../../api/client";
import { useApi } from "../../api/hooks";
import { Button } from "../../components/Button";
import { StatsPanels } from "../../components/charts/StatsPanels";
import {
  parseStatsPeriod,
  parseStatsType,
  StatsPeriodPicker,
  statsRange,
} from "../../components/charts/StatsPeriodPicker";
import { EmptyState } from "../../components/EmptyState";
import { Skeleton } from "../../components/Skeleton";
import { useMessages } from "../../i18n";
import { common } from "../../i18n/common";
import { useRoute } from "../../router";
import { statsMessages } from "./messages";
import "./stats.css";

export default function StatsView() {
  const m = useMessages(statsMessages);
  const c = useMessages(common);
  const route = useRoute();
  const period = parseStatsPeriod(route.query.get("period"));
  const type = parseStatsType(route.query.get("type"));
  const settings = useApi<Settings>(paths.settings);
  const monthStartDay = settings.data?.month_start_day ?? 1;
  const range = statsRange(period, route.query.get("from"), route.query.get("to"), monthStartDay);

  if (settings.error) {
    return (
      <EmptyState
        tone="error"
        icon={AlertCircle}
        title={m.settingsFailed}
        action={
          <Button variant="primary" onClick={settings.reload}>
            {c.retry}
          </Button>
        }
      />
    );
  }
  if (!settings.data) return <Skeleton rows={2} label={m.loadingSettings} />;

  return (
    <div className="stats-view">
      <StatsPeriodPicker period={period} range={range} type={type} monthStartDay={monthStartDay} />
      <StatsPanels key={route.query.toString()} period={period} range={range} type={type} />
      {settings.offline ? (
        <p className="stats-offline" role="status">
          {m.offlineSettings}
        </p>
      ) : null}
    </div>
  );
}
