import { SegmentedLinks } from "../../components/SegmentedControl";
import { useRoute } from "../../router";
import BudgetView from "./BudgetView";
import StatsView from "./StatsView";

export default function StatsScreen() {
  const route = useRoute();
  const budget = route.name === "budget";
  const query = route.query.toString();
  return (
    <div className="screen">
      <header className="screen-header">
        <h1 className="screen-title">통계</h1>
      </header>
      <SegmentedLinks
        label="통계 보기"
        items={[
          { label: "통계", to: `/stats${query && !budget ? `?${query}` : ""}`, current: !budget },
          { label: "예산", to: `/budget${query && budget ? `?${query}` : ""}`, current: budget },
        ]}
      />
      {budget ? <BudgetView /> : <StatsView />}
    </div>
  );
}
