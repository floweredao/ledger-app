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
import { useRoute } from "../../router";
import "./stats.css";

export default function StatsView() {
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
        title="통계 설정을 불러오지 못했어요"
        action={
          <Button variant="primary" onClick={settings.reload}>
            다시 시도
          </Button>
        }
      />
    );
  }
  if (!settings.data) return <Skeleton rows={2} label="통계 설정을 불러오는 중" />;

  return (
    <div className="stats-view">
      <StatsPeriodPicker period={period} range={range} type={type} monthStartDay={monthStartDay} />
      <StatsPanels key={route.query.toString()} period={period} range={range} type={type} />
      {settings.offline ? (
        <p className="stats-offline" role="status">
          오프라인에서 저장된 설정을 사용하고 있어요
        </p>
      ) : null}
    </div>
  );
}
