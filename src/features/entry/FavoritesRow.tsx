import type { Template, TemplatePayload } from "../../../shared/schema";
import { api } from "../../api/client";
import { invalidate } from "../../api/hooks";
import { Button } from "../../components/Button";
import { Chip } from "../../components/Chip";
import { toast } from "../../components/Toast";

type Props = {
  readonly templates: readonly Template[];
  readonly onPick: (payload: TemplatePayload) => void;
  readonly currentAsTemplate: () => { readonly name: string; readonly payload: TemplatePayload };
};

export function FavoritesRow({ templates, onPick, currentAsTemplate }: Props) {
  const saveFavorite = async () => {
    try {
      await api.createTemplate(currentAsTemplate());
      invalidate("templates");
      toast({ message: "즐겨찾기에 저장했어요" });
    } catch (error) {
      console.warn("template save failed", error);
      toast({ message: "즐겨찾기를 저장하지 못했어요" });
    }
  };
  return (
    <fieldset className="entry-section entry-fieldset">
      <legend className="entry-label">자주 쓰는 내역</legend>
      <div className="chip-row">
        {templates.map((template) => (
          <Chip key={template.id} onClick={() => onPick(template.payload)}>
            {template.name}
          </Chip>
        ))}
        <Button size="sm" variant="ghost" onClick={() => void saveFavorite()}>
          즐겨찾기로 저장
        </Button>
      </div>
    </fieldset>
  );
}
