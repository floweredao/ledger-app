import { useMessages } from "../../i18n";
import { useRoute } from "../../router";
import BudgetView from "./BudgetView";
import { statsMessages } from "./messages";
import StatsView from "./StatsView";

export default function StatsScreen() {
  const m = useMessages(statsMessages);
  const route = useRoute();
  const budget = route.name === "budget";
  return (
    <div className="screen">
      <header className="screen-header">
        <h1 className="screen-title">{budget ? m.budget : m.statistics}</h1>
      </header>
      {budget ? <BudgetView /> : <StatsView />}
    </div>
  );
}
