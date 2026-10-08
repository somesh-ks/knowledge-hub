import { sourceHost, sourceLinkLabel } from "../lib/sourceLabel";
import { usePlayerState } from "./hooks/usePlayer";
import Icon from "./ui/LazyIcon";

/**
 * Where the story being read came from: the bare host, opening in a new tab. Nothing is rendered
 * when the story has no address that is safe to link.
 */
export default function SourceLink() {
  const state = usePlayerState();
  const url = state.track?.timeline?.items[state.itemIndex]?.url;
  const host = sourceHost(url);
  if (!url || !host) return null;
  return (
    <p className="player-source">
      <a
        className="player-source-link"
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={sourceLinkLabel(host)}
      >
        <span>{host}</span>
        <Icon name="openInNew" />
      </a>
    </p>
  );
}
