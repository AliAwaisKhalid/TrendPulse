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
  // Optional exact timestamps (ISO, UTC). Needed for sub-daily data: Google only returns
  // hourly (or finer) points when the window is shorter than 7 days AND the request
  // uses time-of-day boundaries (google-trends-api: granularTimeResolution).
  const startTime = searchParams.get("startTime");
  const endTime = searchParams.get("endTime");

  if (!keyword || ((!startDate || !endDate) && (!startTime || !endTime))) {
    return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
  }

  try {
    const st = startTime ? new Date(startTime) : new Date(`${startDate}T00:00:00Z`);
    const et = endTime ? new Date(endTime) : new Date(`${endDate}T23:59:59Z`);
    if (isNaN(st.getTime()) || isNaN(et.getTime())) {
      return NextResponse.json({ error: "Invalid date" }, { status: 400 });
    }
    const granular = (et.getTime() - st.getTime()) / 86400000 < 7;
    const options: any = {
      keyword,
      startTime: st,
      endTime: et,
      granularTimeResolution: granular,
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

    const stepMin = data.length > 1
      ? Math.round((Date.parse(data[1].datetime.replace(" ", "T") + ":00Z") - Date.parse(data[0].datetime.replace(" ", "T") + ":00Z")) / 60000)
      : null;
    return NextResponse.json({ data, keyword, source: "google-trends", granular, stepMin });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: "Google Trends API error", details: String(error) },
      { status: 500 }
    );
  }
}
