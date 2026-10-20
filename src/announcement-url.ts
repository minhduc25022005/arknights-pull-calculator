/** A locator is not proof of content; both the official host and human review
 * are checked separately. Shared by the browser exporter and the Node importer. */
export function hasAnnouncementLocator(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return false;
    const path = url.pathname.replace(/\/+$/, "");
    if (path && !/^\/index\.(?:html?|php)$/i.test(path)) return true;
    const route = url.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    if (route.length >= 2) return true;
    return [...url.searchParams].some(
      ([key, item]) =>
        item.trim() &&
        !/^(?:utm_.*|ref|source|fbclid|gclid|lang|language|locale|hl)$/i.test(
          key,
        ),
    );
  } catch {
    return false;
  }
}
