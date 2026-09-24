// Lets the owner "Add to Home Screen": opens full-screen like an app, straight to the home page.
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ร้านรู้กำไร",
    short_name: "ร้านรู้กำไร",
    description: "จดยอดขายวันละครั้ง รู้กำไร รู้เงินขาด รู้ว่าพรุ่งนี้ควรเตรียมเท่าไหร่",
    lang: "th",
    start_url: "/",
    display: "standalone",
    background_color: "#0f1115",
    theme_color: "#2563eb",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
    shortcuts: [{ name: "จดยอดวันนี้", url: "/record" }],
  };
}
