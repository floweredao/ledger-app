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
import { messages } from "../i18n";
import { componentMessages } from "./messages";

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

export const CATEGORY_ICON_LABELS: Readonly<Record<string, string>> = {
  get "arrow-down-left"() {
    return messages(componentMessages).iconReceive;
  },
  get "arrow-left-right"() {
    return messages(componentMessages).iconTransfer;
  },
  get baby() {
    return messages(componentMessages).iconChildcare;
  },
  get "badge-check"() {
    return messages(componentMessages).iconVerified;
  },
  get "badge-percent"() {
    return messages(componentMessages).iconDiscount;
  },
  get banknote() {
    return messages(componentMessages).iconCash;
  },
  get beer() {
    return messages(componentMessages).iconDrinks;
  },
  get bike() {
    return messages(componentMessages).iconBicycle;
  },
  get "book-open"() {
    return messages(componentMessages).iconReading;
  },
  get bot() {
    return messages(componentMessages).iconAutomation;
  },
  get briefcase() {
    return messages(componentMessages).iconWork;
  },
  get "building-2"() {
    return messages(componentMessages).iconBuilding;
  },
  get bus() {
    return messages(componentMessages).iconBus;
  },
  get car() {
    return messages(componentMessages).iconCar;
  },
  get "car-taxi-front"() {
    return messages(componentMessages).iconTaxi;
  },
  get "circle-question-mark"() {
    return messages(componentMessages).iconHelp;
  },
  get "circle-plus"() {
    return messages(componentMessages).iconAdd;
  },
  get clapperboard() {
    return messages(componentMessages).iconMovies;
  },
  get coffee() {
    return messages(componentMessages).iconCoffee;
  },
  get "credit-card"() {
    return messages(componentMessages).iconCard;
  },
  get dog() {
    return messages(componentMessages).iconPets;
  },
  get dumbbell() {
    return messages(componentMessages).iconExercise;
  },
  get ellipsis() {
    return messages(componentMessages).iconOther;
  },
  get fuel() {
    return messages(componentMessages).iconFuel;
  },
  get "gamepad-2"() {
    return messages(componentMessages).iconGames;
  },
  get gift() {
    return messages(componentMessages).iconGift;
  },
  get "graduation-cap"() {
    return messages(componentMessages).iconEducation;
  },
  get "hand-coins"() {
    return messages(componentMessages).iconAllowance;
  },
  get "heart-pulse"() {
    return messages(componentMessages).iconHealth;
  },
  get house() {
    return messages(componentMessages).iconHousing;
  },
  get landmark() {
    return messages(componentMessages).iconBank;
  },
  get monitor() {
    return messages(componentMessages).iconComputer;
  },
  get music() {
    return messages(componentMessages).iconMusic;
  },
  get package() {
    return messages(componentMessages).iconDelivery;
  },
  get percent() {
    return messages(componentMessages).iconPercentage;
  },
  get "piggy-bank"() {
    return messages(componentMessages).iconSavings;
  },
  get pill() {
    return messages(componentMessages).iconMedicine;
  },
  get pizza() {
    return messages(componentMessages).iconPizza;
  },
  get plane() {
    return messages(componentMessages).iconTravel;
  },
  get receipt() {
    return messages(componentMessages).iconReceipt;
  },
  get repeat() {
    return messages(componentMessages).iconRecurring;
  },
  get "rotate-ccw"() {
    return messages(componentMessages).iconRevert;
  },
  get scissors() {
    return messages(componentMessages).iconBeauty;
  },
  get shirt() {
    return messages(componentMessages).iconClothing;
  },
  get "shopping-bag"() {
    return messages(componentMessages).iconShopping;
  },
  get "shopping-cart"() {
    return messages(componentMessages).iconGroceries;
  },
  get smartphone() {
    return messages(componentMessages).iconPhone;
  },
  get stethoscope() {
    return messages(componentMessages).iconMedicalCare;
  },
  get store() {
    return messages(componentMessages).iconStore;
  },
  get tag() {
    return messages(componentMessages).iconCategory;
  },
  get ticket() {
    return messages(componentMessages).iconPass;
  },
  get "train-front"() {
    return messages(componentMessages).iconTrain;
  },
  get "tram-front"() {
    return messages(componentMessages).iconSubway;
  },
  get "undo-2"() {
    return messages(componentMessages).iconRefund;
  },
  get utensils() {
    return messages(componentMessages).iconMeals;
  },
  get "utensils-crossed"() {
    return messages(componentMessages).iconDiningOut;
  },
  get wallet() {
    return messages(componentMessages).iconWallet;
  },
  get wifi() {
    return messages(componentMessages).iconInternet;
  },
  get zap() {
    return messages(componentMessages).iconElectricity;
  },
};

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
