import { Hono } from "hono";
import { z } from "zod";
import { daysInMonth, kstMonth } from "../../shared/dates";
import { TransactionTypeSchema } from "../../shared/schema";
import {
  statsAssets,
  statsCalendar,
  statsCategories,
  statsCompare,
  statsMerchants,
  statsSummary,
  statsTrend,
} from "../domain/stats";
import { ApiError, type AppBindings } from "../http";

const date = z.iso.date();
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const typeSchema = TransactionTypeSchema.optional();
const hidden = z
  .enum(["true", "false"])
  .transform((value) => value === "true")
  .optional();
const queryError = (error: z.ZodError) => {
  throw new ApiError(400, "invalid_request", error.issues.map((issue) => issue.message).join("; "));
};

function parseRange(from: string | undefined, to: string | undefined, type?: string) {
  const parsedType = typeSchema.safeParse(type);
  if (!parsedType.success) queryError(parsedType.error);
  if (from === undefined || to === undefined) throw new ApiError(400, "invalid_request", "from and to are required");
  const parsedFrom = date.safeParse(from);
  const parsedTo = date.safeParse(to);
  if (!parsedFrom.success) queryError(parsedFrom.error);
  if (!parsedTo.success) queryError(parsedTo.error);
  if (from > to) throw new ApiError(400, "invalid_request", "from must not be after to");
  return { from, to: new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) };
}

function settingsStartDay(db: AppBindings["Variables"]["db"]) {
  const setting = db.query<{ value: string }, []>("SELECT value FROM settings WHERE key='month_start_day'").get();
  return setting ? z.number().int().min(1).max(28).parse(JSON.parse(setting.value)) : 1;
}

export const statsRoutes = new Hono<AppBindings>()
  .get("/stats/summary", (c) => {
    const query = c.req.query();
    const range = parseRange(query.from, query.to, query.type);
    const includeHidden = hidden.safeParse(query.include_hidden);
    if (!includeHidden.success) queryError(includeHidden.error);
    const result = statsSummary(
      c.get("db"),
      range,
      query.type as z.infer<typeof typeSchema>,
      includeHidden.data ?? false,
    );
    return c.json(result);
  })
  .get("/stats/categories", (c) => {
    const query = c.req.query();
    const range = parseRange(query.from, query.to, query.type);
    const includeHidden = hidden.safeParse(query.include_hidden);
    if (!includeHidden.success) queryError(includeHidden.error);
    const categoryFilter = {
      ...range,
      ...(query.type ? { type: query.type as NonNullable<z.infer<typeof typeSchema>> } : {}),
      ...(includeHidden.data ? { include_hidden: true } : {}),
    };
    const result = statsCategories(c.get("db"), categoryFilter);
    return c.json(result);
  })
  .get("/stats/trend", (c) => {
    const query = c.req.query();
    const months = z.coerce
      .number()
      .int()
      .min(1)
      .max(60)
      .safeParse(query.months ?? "12");
    const end = month.safeParse(query.end ?? kstMonth());
    const parsedType = typeSchema.safeParse(query.type);
    const basis = z.enum(["accounting", "calendar"]).default("accounting").safeParse(query.basis);
    if (!months.success) queryError(months.error);
    if (!end.success) queryError(end.error);
    if (!parsedType.success) queryError(parsedType.error);
    if (!basis.success) queryError(basis.error);
    const monthCount = months.data;
    const endMonth = end.data;
    if (monthCount === undefined || endMonth === undefined)
      throw new ApiError(400, "invalid_request", "Invalid trend range");
    const startDay = basis.success && basis.data === "calendar" ? 1 : settingsStartDay(c.get("db"));
    const result = statsTrend(c.get("db"), monthCount, endMonth, startDay, parsedType.data);
    return c.json(result);
  })
  .get("/stats/compare", (c) => {
    const query = c.req.query();
    const range = parseRange(query.from, query.to, query.type);
    return c.json(statsCompare(c.get("db"), range, query.type as z.infer<typeof typeSchema>));
  })
  .get("/stats/merchants", (c) => {
    const query = c.req.query();
    const range = parseRange(query.from, query.to);
    const limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .safeParse(query.limit ?? "20");
    if (!limit.success) queryError(limit.error);
    const rowLimit = limit.data;
    if (rowLimit === undefined) throw new ApiError(400, "invalid_request", "Invalid merchant limit");
    const result = statsMerchants(c.get("db"), range, rowLimit);
    return c.json(result);
  })
  .get("/stats/assets", (c) => {
    const query = c.req.query();
    const range = parseRange(query.from, query.to);
    const result = statsAssets(c.get("db"), range);
    return c.json(result);
  })
  .get("/stats/calendar", (c) => {
    const parsedMonth = month.safeParse(c.req.query("month"));
    if (!parsedMonth.success) queryError(parsedMonth.error);
    const monthValue = parsedMonth.data;
    if (monthValue === undefined) throw new ApiError(400, "invalid_request", "Invalid calendar month");
    const [year, monthNum] = monthValue.split("-").map(Number);
    if (year === undefined || monthNum === undefined || daysInMonth(year, monthNum) < 1)
      throw new ApiError(400, "invalid_request", "Invalid calendar month");
    const result = statsCalendar(c.get("db"), monthValue, settingsStartDay(c.get("db")));
    return c.json(result);
  });
