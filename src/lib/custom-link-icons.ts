import { Globe, X as XIcon, Mail, Phone, Link2 } from 'lucide-react';
import { InstagramIcon, FacebookIcon, YoutubeIcon, GithubIcon } from '@/components/ui/brand-icons';
import type { ComponentType, SVGProps } from 'react';

// lucide-react's own icons are ForwardRefExoticComponents while the
// hand-rolled brand icons above are plain function components — this
// looser type is the common shape both actually satisfy (a component
// callable with SVGProps), so the preset list below can mix the two.
type LinkIconComponent = ComponentType<SVGProps<SVGSVGElement>>;

/**
 * Preset icon choices for a visiting card's custom links (see
 * Member.cardSocials.customLinks in local-data.ts). Shared between the
 * edit-form picker (visiting-card/page.tsx) and the card renderer
 * (profile-card.tsx) so both stay in sync with the same key→icon mapping.
 * A member can also upload their own icon image instead of picking one of
 * these — see customIconUrl on the same type.
 *
 * lucide-react dropped all brand/logo icons from its set (same reason
 * linkedin-icon.tsx is a hand-rolled component instead of a lucide
 * import), so Instagram/Facebook/YouTube/GitHub here are the matching
 * hand-rolled equivalents in src/components/ui/brand-icons.tsx; X/Twitter
 * reuses lucide's generic "X" glyph since that's the platform's own mark.
 */
export const CUSTOM_LINK_ICONS: { key: string; label: string; Icon: LinkIconComponent }[] = [
  { key: 'globe', label: 'Website', Icon: Globe },
  { key: 'instagram', label: 'Instagram', Icon: InstagramIcon },
  { key: 'twitter', label: 'X / Twitter', Icon: XIcon },
  { key: 'facebook', label: 'Facebook', Icon: FacebookIcon },
  { key: 'youtube', label: 'YouTube', Icon: YoutubeIcon },
  { key: 'github', label: 'GitHub', Icon: GithubIcon },
  { key: 'mail', label: 'Email', Icon: Mail },
  { key: 'phone', label: 'Phone', Icon: Phone },
  { key: 'link', label: 'Other Link', Icon: Link2 },
];

const DEFAULT_ICON_KEY = 'globe';

/** Resolves a stored icon key to its component, falling back to the default (Globe) for an unknown/missing key. */
export function resolveCustomLinkIcon(key: string | undefined): LinkIconComponent {
  return (CUSTOM_LINK_ICONS.find(i => i.key === key) || CUSTOM_LINK_ICONS.find(i => i.key === DEFAULT_ICON_KEY)!).Icon;
}
