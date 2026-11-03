// Runs while the HTML is parsed, before first paint, so a saved theme never flashes.
// Keep in sync with STORAGE_KEY in ./theme.tsx.
const THEME_SCRIPT = `(function(){try{var p=localStorage.getItem("qs-theme");var d=p==="dark"||(p!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light"}catch(e){}})()`;

// Server-rendered as an executable script; on the client React sees text/plain and leaves it alone.
export function ThemeScript() {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }}
    />
  );
}
