export type SiteOptions = {
  site_name: string;
  tagline: string;
  welcome_text: string;
  accent: "purple" | "blue" | "green";
  default_mode: string;
  default_stream: boolean;
  default_retries: number;
  shared_models_enabled: boolean;
};
export const defaultSite: SiteOptions = {
  site_name: "Nexus",
  tagline: "Universal AI Gateway",
  welcome_text: "Your models. Your keys. One connection.",
  accent: "purple",
  default_mode: "auto",
  default_stream: true,
  default_retries: 2,
  shared_models_enabled: true,
};
