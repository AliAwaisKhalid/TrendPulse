import { NextRequest, NextResponse } from "next/server";
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any */
const googleTrends = require("google-trends-api");

export const maxDuration = 25;
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const keyword = searchParams.get("keyword") ?? "";
  const startDate = searchParams.get("startDate") ?? "";
  const endDate = searchParams.get("endDate") ?? "";
  const geo = searchParams.get("geo") ?? "";

  if (!keyword || !startDate || !endDate) {
    return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
  }

  try {
    const options: any = {
      keyword,
      startTime: new Date(`${startDate}T00:00:00Z`),
      endTime: new Date(`${endDate}T23:59:59Z`),
      hl: "en-US",
      timezone: 0,
    };
    if (geo) options.geo = geo;

    const result = await googleTrends.interestOverTime(options);
    const parsed = JSON.parse(result);
    const timelineData: any[] = parsed?.default?.timelineData ?? [];

    const data = timelineData
      .map((pt: any) => {
        const ts = new Date(parseInt(pt.time) * 1000);
        const dateStr = ts.toISOString().slice(0, 10);
        const timeStr = ts.toISOString().slice(11, 16);
        const dow = ts.getUTCDay();
        const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
        return {
          datetime: `${dateStr} ${timeStr}`,
          date: dateStr,
          time: timeStr,
          year: ts.getUTCFullYear(),
          month: ts.getUTCMonth() + 1,
          day: ts.getUTCDate(),
          hour: ts.getUTCHours(),
          minute: ts.getUTCMinutes(),
          dow,
          dowName: DOW_NAMES[dow],
          quarter: Math.floor(ts.getUTCMonth() / 3) + 1,
          weekend: dow === 0 || dow === 6,
          hits: pt.value[0] ?? 0,
        };
      });

    if (!data.length) {
      return NextResponse.json({ error: "No data returned" }, { status: 404 });
    }

    return NextResponse.json({ data, keyword, source: "google-trends" });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: "Google Trends API error", details: String(error) },
      { status: 500 }
    );
  }
}
