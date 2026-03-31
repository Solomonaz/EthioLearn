import { defineRouting } from "next-intl/routing";
export const routing = defineRouting({
  locales: ["en", "am"],
  defaultLocale: "en",
  localePrefix: "never", // no /en/ prefix — use cookie-based locale
});
