import { SegmentedLinks } from "../../components/SegmentedControl";
import { useMessages } from "../../i18n";
import { useRoute } from "../../router";
import BudgetView from "./BudgetView";
import { statsMessages } from "./messages";
import StatsView from "./StatsView";

export default function StatsScreen() {
  const m = useMessages(statsMessages);
  const route = useRoute();
  const budget = route.name === "budget";
  const query = route.query.toString();
  return (
    <div className="screen">
      <header className="screen-header">
        <h1 className="screen-title">{m.statistics}</h1>
      </header>
      <SegmentedLinks
        label={m.statisticsView}
        items={[
          { label: m.statistics, to: `/stats${query && !budget ? `?${query}` : ""}`, current: !budget },
          { label: m.budget, to: `/budget${query && budget ? `?${query}` : ""}`, current: budget },
        ]}
      />
      {budget ? <BudgetView /> : <StatsView />}
    </div>
  );
}
