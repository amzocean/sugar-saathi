import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sugar Saathi", short_name: "Saathi", description: "Your private family diary",
    start_url: "/", display: "standalone", background_color: "#f7f7f0", theme_color: "#213c46",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
