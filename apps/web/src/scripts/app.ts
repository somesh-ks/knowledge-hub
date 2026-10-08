import { installDeviceBanners } from "./deviceBanners";
import { installCreateEntry } from "./createEntry";
import { installDisabledGuard } from "./disabledGuard";
import { installNavigation } from "./navigation";
import { registerServiceWorker } from "./serviceWorker";
import { installThemeColor } from "./themeColor";

/**
 * Page-level behavior that belongs to the shell, not to the player: navigation rules, device
 * banners, the disabled-control guard, the browser chrome colour and the service worker. Loaded once
 * from the layout. A bundled module script runs once per session, so per-page work listens for
 * astro:page-load.
 */
installDisabledGuard();
installNavigation();
installCreateEntry();
installDeviceBanners();
installThemeColor();
registerServiceWorker();
