import { dayInZone, type Banner } from "./banners";
export type PlanDate = {
  label: string;
  instant: string;
  date: string;
  predicted: boolean;
  key: "early" | "central" | "late";
};
export function planDates(
  banner: Banner | undefined,
  timeZone: string,
): PlanDate[] {
  if (!banner) return [];
  if (banner.startAt)
    return [
      {
        key: "central",
        label: "Ngày chính thức",
        instant: banner.startAt,
        date: dayInZone(banner.startAt, timeZone),
        predicted: false,
      },
    ];
  if (!banner.estimate) return [];
  return (
    [
      ["early", "Sớm nhất", banner.estimate.earliest],
      ["central", "Trung tâm", banner.estimate.central],
      ["late", "Muộn nhất", banner.estimate.latest],
    ] as const
  ).map(([key, label, instant]) => ({
    key,
    label,
    instant,
    date: dayInZone(instant, timeZone),
    predicted: true,
  }));
}
export function bannerKey(banner: Banner): string {
  return `${banner.server}:${banner.eventId}`;
}
