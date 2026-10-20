export interface Resources {
  orundum: number;
  prime: number;
  tickets: number;
}
export interface Entry extends Resources {
  date: string;
}
export const totalPulls = (r: Resources, convert = true) =>
  Math.floor((r.orundum + (convert ? r.prime * 180 : 0)) / 600) + r.tickets;
export const dateKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export function daysBetween(start: string, end: string) {
  return Math.max(
    0,
    Math.round(
      (Date.parse(end + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) /
        86400000,
    ),
  );
}
export function forecast(
  r: Resources,
  days: number,
  daily: number,
  weekly: number,
  convert: boolean,
) {
  return totalPulls(
    { ...r, orundum: r.orundum + days * daily + Math.floor(days / 7) * weekly },
    convert,
  );
}
