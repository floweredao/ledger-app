import {
  ArrowDownLeft,
  ArrowLeftRight,
  Baby,
  BadgeCheck,
  BadgePercent,
  Banknote,
  Beer,
  Bike,
  BookOpen,
  Bot,
  Briefcase,
  Building2,
  Bus,
  Car,
  CarTaxiFront,
  CirclePlus,
  CircleQuestionMark,
  Clapperboard,
  Coffee,
  CreditCard,
  Dog,
  Dumbbell,
  Ellipsis,
  Fuel,
  Gamepad2,
  Gift,
  GraduationCap,
  HandCoins,
  HeartPulse,
  House,
  Landmark,
  type LucideIcon,
  Monitor,
  Music,
  Package,
  Percent,
  PiggyBank,
  Pill,
  Pizza,
  Plane,
  Receipt,
  Repeat,
  RotateCcw,
  Scissors,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Stethoscope,
  Store,
  Tag,
  Ticket,
  TrainFront,
  TramFront,
  Undo2,
  Utensils,
  UtensilsCrossed,
  Wallet,
  Wifi,
  Zap,
} from "lucide-react";

/** Every lucide icon a category may use (seed icons plus the T21 picker set); unknown names fall back. */
export const CATEGORY_ICONS: Readonly<Record<string, LucideIcon>> = {
  "arrow-down-left": ArrowDownLeft,
  "arrow-left-right": ArrowLeftRight,
  baby: Baby,
  "badge-check": BadgeCheck,
  "badge-percent": BadgePercent,
  banknote: Banknote,
  beer: Beer,
  bike: Bike,
  "book-open": BookOpen,
  bot: Bot,
  briefcase: Briefcase,
  "building-2": Building2,
  bus: Bus,
  car: Car,
  "car-taxi-front": CarTaxiFront,
  "circle-question-mark": CircleQuestionMark,
  "circle-plus": CirclePlus,
  clapperboard: Clapperboard,
  coffee: Coffee,
  "credit-card": CreditCard,
  dog: Dog,
  dumbbell: Dumbbell,
  ellipsis: Ellipsis,
  fuel: Fuel,
  "gamepad-2": Gamepad2,
  gift: Gift,
  "graduation-cap": GraduationCap,
  "hand-coins": HandCoins,
  "heart-pulse": HeartPulse,
  house: House,
  landmark: Landmark,
  monitor: Monitor,
  music: Music,
  package: Package,
  percent: Percent,
  "piggy-bank": PiggyBank,
  pill: Pill,
  pizza: Pizza,
  plane: Plane,
  receipt: Receipt,
  repeat: Repeat,
  "rotate-ccw": RotateCcw,
  scissors: Scissors,
  shirt: Shirt,
  "shopping-bag": ShoppingBag,
  "shopping-cart": ShoppingCart,
  smartphone: Smartphone,
  stethoscope: Stethoscope,
  store: Store,
  tag: Tag,
  ticket: Ticket,
  "train-front": TrainFront,
  "tram-front": TramFront,
  "undo-2": Undo2,
  utensils: Utensils,
  "utensils-crossed": UtensilsCrossed,
  wallet: Wallet,
  wifi: Wifi,
  zap: Zap,
};

export const CATEGORY_ICON_NAMES = Object.keys(CATEGORY_ICONS);

/** `cat-3` -> `var(--cat-3)`; anything else uses the slate slot. */
export function categoryColor(color: string | null | undefined): string {
  const match = /^cat-(\d{1,2})$/.exec(color ?? "");
  const slot = match ? Number(match[1]) : 12;
  return `var(--cat-${slot >= 1 && slot <= 12 ? slot : 12})`;
}

type Props = {
  readonly icon: string | null | undefined;
  readonly color: string | null | undefined;
  /** When set, the icon is announced; leave unset when the category name is shown next to it. */
  readonly label?: string;
};

export function CategoryIcon({ icon, color, label }: Props) {
  const Glyph = CATEGORY_ICONS[icon ?? ""] ?? CircleQuestionMark;
  return (
    <span
      className="category-icon"
      style={{ backgroundColor: categoryColor(color) }}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <Glyph aria-hidden="true" size={18} strokeWidth={2.25} />
    </span>
  );
}
