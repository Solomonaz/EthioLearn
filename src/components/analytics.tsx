"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Google Analytics 4 + Meta Pixel. IDs come from the server at request time
 * (GA_MEASUREMENT_ID / META_PIXEL_ID in .env), so turning either on or off
 * needs a restart, not a rebuild. Nothing loads when an ID is unset, and the
 * admin consoles are never tracked.
 */
const UNTRACKED = /^\/admin/;

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    fbq?: (...args: unknown[]) => void;
  }
}

export function Analytics({ gaId, pixelId }: { gaId?: string; pixelId?: string }) {
  const pathname = usePathname() ?? "/";
  const tracked = !UNTRACKED.test(pathname);
  const firstPixelView = useRef(true);

  // The pixel's snippet sends the first PageView; client-side navigations need
  // their own. GA4's enhanced measurement already follows history changes.
  useEffect(() => {
    if (!pixelId || !tracked) return;
    if (firstPixelView.current) { firstPixelView.current = false; return; }
    window.fbq?.("track", "PageView");
  }, [pathname, pixelId, tracked]);

  if (!tracked) return null;

  return (
    <>
      {gaId && (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`} strategy="afterInteractive" />
          <Script id="ga4" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}window.gtag=gtag;gtag('js',new Date());gtag('config',${JSON.stringify(gaId)});`}
          </Script>
        </>
      )}
      {pixelId && (
        <Script id="meta-pixel" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init',${JSON.stringify(pixelId)});fbq('track','PageView');`}
        </Script>
      )}
    </>
  );
}

/** A new student account — the conversion ads are optimised for. */
export function trackSignUp(method: string) {
  window.gtag?.("event", "sign_up", { method });
  window.fbq?.("track", "CompleteRegistration", { content_name: method });
}
