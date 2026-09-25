import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Att School Attendance",
    short_name: "Att",
    description: "Offline-first school arrival and departure attendance.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f7fb",
    theme_color: "#102a43",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" },
    ],
  };
}
