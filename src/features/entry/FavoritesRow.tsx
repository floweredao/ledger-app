import type { Template, TemplatePayload } from "../../../shared/schema";
import { api } from "../../api/client";
import { invalidate } from "../../api/hooks";
import { Button } from "../../components/Button";
import { Chip } from "../../components/Chip";
import { toast } from "../../components/Toast";
import { useMessages } from "../../i18n";
import { entryMessages } from "./messages";

type Props = {
  readonly templates: readonly Template[];
  readonly onPick: (payload: TemplatePayload) => void;
  readonly currentAsTemplate: () => { readonly name: string; readonly payload: TemplatePayload };
};

export function FavoritesRow({ templates, onPick, currentAsTemplate }: Props) {
  const t = useMessages(entryMessages);
  const saveFavorite = async () => {
    try {
      await api.createTemplate(currentAsTemplate());
      invalidate("templates");
      toast({ message: t.favoriteSaved });
    } catch (error) {
      console.warn("template save failed", error);
      toast({ message: t.favoriteFailed, tone: "error" });
    }
  };
  return (
    <fieldset className="entry-section entry-fieldset">
      <legend className="entry-label">{t.favorites}</legend>
      <div className="chip-row">
        {templates.map((template) => (
          <Chip key={template.id} onClick={() => onPick(template.payload)}>
            {template.name}
          </Chip>
        ))}
        <Button size="sm" variant="ghost" onClick={() => void saveFavorite()}>
          {t.saveFavorite}
        </Button>
      </div>
    </fieldset>
  );
}
